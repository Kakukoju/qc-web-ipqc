"""Production all-batch summary for Tutti AssayProcess records."""

import math
import re
import sqlite3
from collections import defaultdict
from datetime import date, datetime

import psycopg2.extras

from query_service import _get_conn
from app_config import SPEC_DB_PATH


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


def get_all_batch_summary() -> dict:
    specs, assignments = _load_reference_data()
    pg = _get_conn()
    try:
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
        cv_levels = _parse_level_thresholds(spec.get("single_cv") if spec else None)
        default_cv = _parse_threshold(spec.get("single_cv") if spec else None)
        bias_levels = _parse_level_thresholds(spec.get("merge_bias") if spec else None)
        default_bias = _parse_threshold(spec.get("merge_bias") if spec else None)
        tea_limit = _parse_threshold(spec.get("tea") if spec else None)
        od_ranges = {
            "L1": _parse_range(spec.get("spec_l1_od") if spec else None),
            "L2": _parse_range(spec.get("spec_l2_od") if spec else None),
            "N1": _parse_range(spec.get("spec_n1_od") if spec else None),
            "N3": None,
        }

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
                "od": od_range[0] <= od_mean <= od_range[1] if od_mean is not None and od_range else None,
            }
            all_checks.extend(value for value in checks.values() if value is not None)
            levels[level] = {
                "mean": _round(mean_value),
                "cv": _round(cv_value, 2),
                "bias": _round(bias_value, 2),
                "tea": _round(tea_value, 2),
                "od_mean": _round(od_mean, 4),
                "n": len(values),
                "checks": checks,
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
                "source": "Qbi",
                "marker": spec.get("marker") if spec else None,
                "tea": spec.get("tea") if spec else None,
                "single_cv": spec.get("single_cv") if spec else None,
                "merge_bias": spec.get("merge_bias") if spec else None,
                "spec_l1_od": spec.get("spec_l1_od") if spec else None,
                "spec_l2_od": spec.get("spec_l2_od") if spec else None,
                "spec_n1_od": spec.get("spec_n1_od") if spec else None,
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
