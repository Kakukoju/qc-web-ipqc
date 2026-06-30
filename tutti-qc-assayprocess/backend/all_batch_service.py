"""Production all-batch summary for Tutti AssayProcess records."""

import math
import os
import re
import sqlite3
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

import psycopg2.extras

from query_service import _get_conn
from app_config import SPEC_DB_PATH

VET_LAB_SPEC_DB_PATH = Path(os.getenv(
    "VET_LAB_SPEC_DB_PATH",
    "/home/ubuntu/vet-lab-spec-analyzer/backend/data/vet_lab_spec.db",
))


CUTOFF_DATE = date(2026, 6, 10)

CONTROL_LEVELS = {
    "Control-1": ("L1", "L1_89751"),
    "Control-2": ("L2", "L2_89752"),
    "Control-3": ("N1", "N1_45981"),
    "Control-4": ("N3", "N3_45983"),
}

# AssayProcess names do not carry the Qbi reagent suffix. Prefer the populated
# production spec when multiple Qbi rows exist for the same analyze item.
QBI_MARKER_MAP = {
    "ALB": "QALB-A",
    "ALP": "QALP-D",
    "ALT": "QALT-A",
    "AMY": "QAMY",
    "AST": "QAST",
    "BCL": "QBCl-D",
    "BNH3": "QBNH3",
    "BUN": "QBUN",
    "CA": "QCa-B",
    "CHOL": "QTC-D",
    "CK": "QCK-AD",
    "CL": "QCl-D",
    "CRE": "QCre-d",
    "CREA": "QCre-d",
    "FRU": "QFRU-D",
    "GGT": "QGGT-U",
    "GLU": "QGLU-B",
    "K": "QK-AD",
    "LAC": "QLAC-D",
    "LDH": "QLDH-D",
    "MG": "QMg-AD",
    "NA": "QNa-AU",
    "NH3": "QNH3",
    "PHOS": "QPHOS-B",
    "P-LIPA": "QLIPA-AU",
    "TBIL": "QTBIL-U",
    "TCO2": "QtCO2-U",
    "TP": "QTP",
    "TRIG": "QTG-D",
    "UA": "QUA-D",
    "URIC": "QUA-D",
}


def parse_production_date(mfg_lot_no: str, analyze_date: str = "") -> date | None:
    match = re.search(r"(\d{6})\d{2}$", (mfg_lot_no or "").strip())
    if match:
        try:
            return datetime.strptime(match.group(1), "%y%m%d").date()
        except ValueError:
            pass
    normalized = (analyze_date or "").strip().replace("/", "-")
    try:
        return date.fromisoformat(normalized)
    except ValueError:
        return None


def should_include_lot(mfg_lot_no: str, production_date: date | None) -> bool:
    if production_date is None or production_date <= CUTOFF_DATE:
        return True
    match = re.search(r"(\d{2})$", (mfg_lot_no or "").strip())
    return bool(match and int(match.group(1)) < 50)


def _number(value) -> float | None:
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _cv(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    mean_value = _mean(values)
    if mean_value in (None, 0):
        return None
    variance = sum((value - mean_value) ** 2 for value in values) / len(values)
    return math.sqrt(variance) / abs(mean_value) * 100


def _parse_threshold(text: str | None) -> float | None:
    if not text:
        return None
    match = re.search(r"[<≤>≥]?\s*[±]?\s*([\d.]+)\s*%", text)
    return float(match.group(1)) if match else None


# ─── Vet-Lab Catalog Spec Lookup (CLIA → EFLM-BV → Species → Analyzer) ───────

ANALYTE_ALIASES: dict[str, list[str]] = {
    "PHOS": ["P", "PHOS"], "P": ["P", "PHOS"],
    "TRIG": ["TG", "TRIG"], "TG": ["TG", "TRIG"],
    "CHOL": ["CHOL", "TC"], "TC": ["TC", "CHOL"],
    "CREA": ["CREA", "CRE"], "CRE": ["CRE", "CREA"],
}


def _normalize_qbi_marker(name: str) -> str:
    """
    Strip Qbi reagent prefix/suffix to get standard analyte code.
    Examples: QALB-A → ALB, QCre-d → CRE, QTBIL-U → TBIL, Qbi-ALB → ALB
    """
    s = name.strip()
    # Strip "Qbi-" prefix (case-insensitive)
    if re.match(r'^[Qq]bi[-_]', s):
        s = re.sub(r'^[Qq]bi[-_]', '', s)
    # Strip leading "Q" followed by uppercase (Qbi reagent naming: QALB-A, QCre-d)
    elif re.match(r'^Q[A-Za-z]', s):
        s = s[1:]
    # Strip trailing suffix after dash (e.g. ALB-A → ALB, CRE-D → CRE)
    s = re.split(r'[-_]', s, maxsplit=1)[0]
    return s.upper()


# Build reverse map: Qbi marker name → standard analyte code
_QBI_TO_STANDARD: dict[str, str] = {}
for _std, _qbi in QBI_MARKER_MAP.items():
    _QBI_TO_STANDARD[_qbi.upper()] = _std.upper()
    # Also add without Q prefix
    _stripped = _normalize_qbi_marker(_qbi)
    if _stripped != _std.upper():
        _QBI_TO_STANDARD[_stripped] = _std.upper()


def _fetch_vetlab_spec(analyze_item: str) -> dict | None:
    """
    Fetch TEa/CV/Bias from vet-lab catalog DB with priority:
    1. CLIA (regulatory)
    2. EFLM-BV (desirable, includes CV + Bias)
    3. species_references (clinical_tea_goal)
    4. analyte_specs (analyzer manufacturer catalog)
    """
    if not VET_LAB_SPEC_DB_PATH.exists():
        return None

    code_upper = analyze_item.strip().upper()
    # Normalize Qbi marker names to standard code
    normalized = _normalize_qbi_marker(analyze_item)
    # Check reverse Qbi map
    from_qbi_map = _QBI_TO_STANDARD.get(code_upper)

    candidates_raw = [code_upper]
    if normalized != code_upper:
        candidates_raw.append(normalized)
    if from_qbi_map and from_qbi_map not in candidates_raw:
        candidates_raw.append(from_qbi_map)
    candidates_raw.append(analyze_item.strip())
    if code_upper in ANALYTE_ALIASES:
        candidates_raw.extend(ANALYTE_ALIASES[code_upper])
    if normalized in ANALYTE_ALIASES:
        candidates_raw.extend(ANALYTE_ALIASES[normalized])
    # Deduplicate preserving order
    seen: set[str] = set()
    candidates: list[str] = []
    for c in candidates_raw:
        if c not in seen:
            seen.add(c)
            candidates.append(c)

    try:
        conn = sqlite3.connect(str(VET_LAB_SPEC_DB_PATH))
        conn.row_factory = sqlite3.Row

        # Step 1: CLIA
        for code in candidates:
            row = conn.execute(
                """SELECT tea_percent, precision_cv_pct_limit, bias_pct_limit,
                          source_code, aps_level
                   FROM clinical_analyte_specs
                   WHERE analyte_code = ? AND is_active = 1 AND source_code = 'CLIA'
                   ORDER BY aps_level ASC LIMIT 1""",
                (code,),
            ).fetchone()
            if row and _as_float(row["tea_percent"]):
                conn.close()
                return _build_vetlab_result(row)

        # Step 2: EFLM-BV
        for code in candidates:
            row = conn.execute(
                """SELECT tea_percent, precision_cv_pct_limit, bias_pct_limit,
                          source_code, aps_level
                   FROM clinical_analyte_specs
                   WHERE analyte_code = ? AND is_active = 1 AND source_code = 'EFLM-BV'
                   ORDER BY aps_level ASC LIMIT 1""",
                (code,),
            ).fetchone()
            if row and _as_float(row["tea_percent"]):
                conn.close()
                return _build_vetlab_result(row)

        # Step 3: species_references
        for code in candidates:
            row = conn.execute(
                """SELECT clinical_tea_goal, tea_source, analyte_name, species
                   FROM species_references
                   WHERE analyte_name = ? AND clinical_tea_goal IS NOT NULL
                   ORDER BY CASE species WHEN 'DOG' THEN 0 WHEN 'CAT' THEN 1
                            WHEN 'HORSE' THEN 2 ELSE 3 END
                   LIMIT 1""",
                (code,),
            ).fetchone()
            if row and _as_float(row["clinical_tea_goal"]):
                conn.close()
                tea = _as_float(row["clinical_tea_goal"])
                return {
                    "tea": tea,
                    "cv": tea / 4.0 if tea else None,
                    "bias": tea / 3.0 if tea else None,
                    "source": f"Species Ref ({row['tea_source'] or ''} {row['species'] or ''})",
                }

        # Step 4: Analyzer catalog
        for code in candidates:
            row = conn.execute(
                """SELECT a.tae_percent, a.cv_percent, a.analyte_name, a.species,
                          az.manufacturer, az.model_name
                   FROM analyte_specs a
                   JOIN analyzer_specs az ON a.analyzer_id = az.id
                   WHERE a.analyte_name = ? AND a.tae_percent > 0
                   ORDER BY CASE a.species WHEN 'DOG' THEN 0 WHEN 'CAT' THEN 1
                            WHEN 'HORSE' THEN 2 ELSE 3 END
                   LIMIT 1""",
                (code,),
            ).fetchone()
            if row and _as_float(row["tae_percent"]):
                conn.close()
                tea = _as_float(row["tae_percent"])
                cv = _as_float(row["cv_percent"])
                bias = (tea - 2 * cv) if (tea and cv) else (tea / 3.0 if tea else None)
                return {
                    "tea": tea,
                    "cv": cv or (tea / 4.0 if tea else None),
                    "bias": max(0, bias) if bias else None,
                    "source": f"Analyzer: {row['manufacturer'] or ''} {row['model_name'] or ''}",
                }

        conn.close()
        return None
    except Exception:
        return None


def _as_float(value) -> float | None:
    if value is None:
        return None
    try:
        num = float(value)
        return num if math.isfinite(num) else None
    except (TypeError, ValueError):
        return None


def _build_vetlab_result(row: sqlite3.Row) -> dict:
    tea = _as_float(row["tea_percent"])
    cv = _as_float(row["precision_cv_pct_limit"])
    bias = _as_float(row["bias_pct_limit"])
    source = str(row["source_code"] or "")
    if tea and not cv:
        cv = tea / 4.0
    if tea and not bias:
        bias = tea / 3.0
    return {"tea": tea, "cv": cv, "bias": bias, "source": source}


def _parse_level_thresholds(text: str | None) -> dict[str, float]:
    if not text:
        return {}
    result = {}
    normalized = text.replace("\r\n", ";").replace("\n", ";")
    pattern = re.compile(r"([LN]\d)\s*(?:CV\s*)?[<≤>≥]\s*[±]?\s*([\d.]+)\s*%", re.I)
    for level, value in pattern.findall(normalized):
        result[level.upper()] = float(value)
    return result


def _parse_range(text: str | None) -> tuple[float, float] | None:
    if not text:
        return None
    match = re.search(r"([\d.]+)\s*[-~–—]\s*([\d.]+)", text)
    if not match:
        return None
    first, second = float(match.group(1)), float(match.group(2))
    return (min(first, second), max(first, second))


def _load_reference_data() -> tuple[dict[str, dict], dict[str, dict[str, float | None]]]:
    conn = sqlite3.connect(SPEC_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        specs = {}
        for row in conn.execute(
            """SELECT marker, tea, single_cv, spec_l1_od, spec_l2_od,
                      spec_n1_od, merge_bias, merge_cv
               FROM bead_ipqc_spec WHERE source = 'Qbi'"""
        ):
            specs[row["marker"].upper()] = dict(row)

        assignments = {}
        for row in conn.execute(
            """SELECT Marker, L1_89751, L2_89752, N1_45981, N3_45983
               FROM csassign"""
        ):
            assignments[row["Marker"].upper()] = {
                column: _number(row[column])
                for column in ("L1_89751", "L2_89752", "N1_45981", "N3_45983")
            }
        return specs, assignments
    finally:
        conn.close()


def _find_spec(analyze_item: str, specs: dict[str, dict]) -> dict | None:
    item = analyze_item.upper()
    mapped = QBI_MARKER_MAP.get(item)
    if mapped and mapped.upper() in specs:
        return specs[mapped.upper()]

    candidates = []
    for marker, spec in specs.items():
        base = re.sub(r"^Q", "", marker, flags=re.I)
        base = re.split(r"[-_]", base, maxsplit=1)[0]
        if base.upper() == item:
            score = sum(bool(spec.get(field)) for field in ("tea", "single_cv", "merge_bias", "merge_cv"))
            candidates.append((score, marker, spec))
    return max(candidates, default=(0, "", None))[2]


def _round(value: float | None, digits: int = 3) -> float | None:
    return round(value, digits) if value is not None else None


def _compute_dynamic_od_ranges(pg_conn) -> dict[str, dict[str, tuple[float, float] | None]]:
    """
    Compute dynamic OD ranges per (analyze_item, level) using Q1/Q3
    from baseline OD data in RDS. Uses all available data.
    Returns: { "MARKER": { "L1": (q1, q3), "L2": (q1, q3), ... }, ... }
    """
    cursor = pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cursor.execute(
        """SELECT analyze_item, patient_id,
                  CAST(NULLIF(TRIM(final_delta_od), '') AS DOUBLE PRECISION) AS od
           FROM panel_production.assay_process_records
           WHERE baseline = 'true'
             AND COALESCE(TRIM(analyze_item), '') <> ''
             AND LOWER(COALESCE(patient_id, '')) IN
                 ('control-1', 'control-2', 'control-3', 'control-4')
             AND NULLIF(TRIM(final_delta_od), '') IS NOT NULL
           ORDER BY analyze_item, patient_id"""
    )

    LEVEL_MAP = {
        "control-1": "L1", "control-2": "L2",
        "control-3": "N1", "control-4": "N3",
    }

    # Collect OD values per (marker, level)
    data: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for row in cursor:
        marker = (row["analyze_item"] or "").strip().upper()
        pid = (row["patient_id"] or "").strip().lower()
        level = LEVEL_MAP.get(pid)
        od = row["od"]
        if marker and level and od is not None and math.isfinite(od):
            data[marker][level].append(od)

    # Compute Q1/Q3 per (marker, level)
    result: dict[str, dict[str, tuple[float, float] | None]] = {}
    for marker, levels in data.items():
        result[marker] = {}
        for level, values in levels.items():
            if len(values) < 2:
                result[marker][level] = None
                continue
            sorted_vals = sorted(values)
            n = len(sorted_vals)
            q1_idx = (n - 1) * 0.25
            q3_idx = (n - 1) * 0.75
            # Linear interpolation for quartiles
            q1_lo, q1_hi = int(q1_idx), min(int(q1_idx) + 1, n - 1)
            q3_lo, q3_hi = int(q3_idx), min(int(q3_idx) + 1, n - 1)
            q1 = sorted_vals[q1_lo] + (q1_idx - q1_lo) * (sorted_vals[q1_hi] - sorted_vals[q1_lo])
            q3 = sorted_vals[q3_lo] + (q3_idx - q3_lo) * (sorted_vals[q3_hi] - sorted_vals[q3_lo])
            result[marker][level] = (round(q1, 6), round(q3, 6))
    return result


def get_all_batch_summary() -> dict:
    specs, assignments = _load_reference_data()
    pg = _get_conn()
    try:
        # Compute dynamic OD ranges (Q1/Q3 from past 30 days)
        dynamic_od_ranges = _compute_dynamic_od_ranges(pg)

        cursor = pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute(
            """SELECT panel_name, analyze_date, mfg_lot_no, analyze_item,
                      patient_id, analyze_result, final_delta_od
               FROM panel_production.assay_process_records
               WHERE COALESCE(TRIM(mfg_lot_no), '') <> ''
                 AND COALESCE(TRIM(analyze_item), '') <> ''
                 AND LOWER(COALESCE(patient_id, '')) IN
                     ('control-1', 'control-2', 'control-3', 'control-4')
               ORDER BY analyze_date DESC, mfg_lot_no, analyze_item"""
        )
        records = cursor.fetchall()
    finally:
        pg.close()

    groups = defaultdict(lambda: {
        "results": defaultdict(list),
        "ods": defaultdict(list),
        "analyze_dates": [],
    })

    for record in records:
        production_date = parse_production_date(record["mfg_lot_no"], record["analyze_date"])
        if not should_include_lot(record["mfg_lot_no"], production_date):
            continue
        control = CONTROL_LEVELS.get((record["patient_id"] or "").strip())
        if not control:
            continue
        level = control[0]
        key = (
            production_date.isoformat() if production_date else "",
            record["panel_name"] or "",
            record["mfg_lot_no"] or "",
            record["analyze_item"] or "",
        )
        result_value = _number(record["analyze_result"])
        od_value = _number(record["final_delta_od"])
        if result_value is not None:
            groups[key]["results"][level].append(result_value)
        if od_value is not None:
            groups[key]["ods"][level].append(od_value)
        groups[key]["analyze_dates"].append(record["analyze_date"] or "")

    rows = []
    for key, grouped in groups.items():
        production_date, panel_name, mfg_lot_no, analyze_item = key
        spec = _find_spec(analyze_item, specs)
        assigned = assignments.get(analyze_item.upper(), {})

        # ─── Primary: vet-lab catalog (CLIA → EFLM-BV → Species → Analyzer) ──
        vetlab = _fetch_vetlab_spec(analyze_item)

        if vetlab:
            # Use vet-lab thresholds (uniform across all levels)
            tea_limit = vetlab["tea"]
            default_cv = vetlab["cv"]
            default_bias = vetlab["bias"]
            cv_levels: dict[str, float] = {}
            bias_levels: dict[str, float] = {}
            spec_source = vetlab["source"]
        else:
            # Fallback: legacy bead_ipqc_spec.db (Qbi)
            cv_levels = _parse_level_thresholds(spec.get("single_cv") if spec else None)
            default_cv = _parse_threshold(spec.get("single_cv") if spec else None)
            bias_levels = _parse_level_thresholds(spec.get("merge_bias") if spec else None)
            default_bias = _parse_threshold(spec.get("merge_bias") if spec else None)
            tea_limit = _parse_threshold(spec.get("tea") if spec else None)
            spec_source = "Qbi"

        od_ranges = {}
        marker_upper = analyze_item.strip().upper()
        marker_dynamic = dynamic_od_ranges.get(marker_upper, {})
        for lvl in ("L1", "L2", "N1", "N3"):
            dyn = marker_dynamic.get(lvl)
            if dyn:
                od_ranges[lvl] = dyn  # (q1, q3) tuple from past 30 days
            else:
                # Fallback to static spec if no dynamic data available
                static_key = f"spec_{lvl.lower()}_od"
                od_ranges[lvl] = _parse_range(spec.get(static_key) if spec else None)

        levels = {}
        all_checks = []
        for patient_id, (level, assignment_column) in CONTROL_LEVELS.items():
            values = grouped["results"].get(level, [])
            od_values = grouped["ods"].get(level, [])
            mean_value = _mean(values)
            cv_value = _cv(values)
            assigned_value = assigned.get(assignment_column)
            bias_value = (
                (mean_value - assigned_value) / assigned_value * 100
                if mean_value is not None and assigned_value not in (None, 0)
                else None
            )
            cv_limit = cv_levels.get(level, default_cv)
            bias_limit = bias_levels.get(level, default_bias)
            od_mean = _mean(od_values)
            od_range = od_ranges[level]
            tea_value = (
                abs(bias_value) + 2 * cv_value
                if bias_value is not None and cv_value is not None
                else None
            )
            checks = {
                "bias": abs(bias_value) <= bias_limit if bias_value is not None and bias_limit is not None else None,
                "cv": cv_value <= cv_limit if cv_value is not None and cv_limit is not None else None,
                "tea": tea_value <= tea_limit if tea_value is not None and tea_limit is not None else None,
            }
            # OD is warning-only (does not affect overall PASS/FAIL)
            od_in_range = od_range[0] <= od_mean <= od_range[1] if od_mean is not None and od_range else None
            od_warning = od_in_range is False  # True = outside range (warning)
            all_checks.extend(value for value in checks.values() if value is not None)
            levels[level] = {
                "mean": _round(mean_value),
                "cv": _round(cv_value, 2),
                "bias": _round(bias_value, 2),
                "tea": _round(tea_value, 2),
                "od_mean": _round(od_mean, 4),
                "n": len(values),
                "checks": checks,
                "od_in_range": od_in_range,
                "od_warning": od_warning,
            }

        rows.append({
            "production_date": production_date,
            "analyze_date": max(grouped["analyze_dates"], default=""),
            "panel_name": panel_name,
            "mfg_lot_no": mfg_lot_no,
            "analyze_item": analyze_item,
            "levels": levels,
            "pass": all(all_checks) if all_checks else None,
            "spec": {
                "source": spec_source,
                "marker": spec.get("marker") if spec else None,
                "tea": f"{tea_limit}%" if tea_limit else (spec.get("tea") if spec else None),
                "single_cv": f"{default_cv}%" if (vetlab and default_cv) else (spec.get("single_cv") if spec else None),
                "merge_bias": f"{default_bias}%" if (vetlab and default_bias) else (spec.get("merge_bias") if spec else None),
                "spec_l1_od": f"{od_ranges.get('L1', (None,None))[0]:.4f} - {od_ranges.get('L1', (None,None))[1]:.4f}" if od_ranges.get('L1') else (spec.get("spec_l1_od") if spec else None),
                "spec_l2_od": f"{od_ranges.get('L2', (None,None))[0]:.4f} - {od_ranges.get('L2', (None,None))[1]:.4f}" if od_ranges.get('L2') else (spec.get("spec_l2_od") if spec else None),
                "spec_n1_od": f"{od_ranges.get('N1', (None,None))[0]:.4f} - {od_ranges.get('N1', (None,None))[1]:.4f}" if od_ranges.get('N1') else (spec.get("spec_n1_od") if spec else None),
                "od_source": "dynamic_q1q3" if marker_dynamic else "static_spec",
            },
        })

    rows.sort(
        key=lambda row: (
            row["production_date"],
            row["mfg_lot_no"],
            row["panel_name"],
            row["analyze_item"],
        ),
        reverse=True,
    )
    return {
        "ok": True,
        "cutoff_date": CUTOFF_DATE.isoformat(),
        "filter_rule": "production_date <= 2026-06-10 OR mfg_lot_no suffix < 50",
        "total": len(rows),
        "rows": rows,
    }
