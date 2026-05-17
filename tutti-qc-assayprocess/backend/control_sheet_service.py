"""Generate Control sheet data from AssayProcess DB + bead_ipqc_spec.db."""

import os
import re
import sqlite3
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

SPEC_DB_PATH = Path(os.getenv("SPEC_DB_PATH", "/home/ubuntu/bead_ipqc_spec.db"))

# Mapping: analyze_item in assay_process_records -> csassign Marker name
# and TEa lookup name in bead_ipqc_spec
MARKER_TEA_MAP = {
    "Ca": ("Ca", "Ca-A"),
    "CK": ("CPK", "CK/ CK-AD"),
    "Cl": ("Cl", "Cl/ ClH"),
    "K": ("K", "K"),
    "LAC": ("LAC", "LAC (含LAC-AU)"),
    "Na": ("Na", "Na-AU/AD\nNa-BU/BD"),
    "TCO2": ("TCO2", "tCO2"),
    "BCl": ("Cl", "Cl-BCl"),
    "ALB": ("ALB", "ALB"),
    "ALP": ("ALP", "ALP"),
    "ALT": ("ALT", "ALT-A"),
    "AST": ("AST", "tASTi"),
    "BUN": ("BUN", "BUN"),
    "CREA": ("CREA", "tCREA"),
    "GLU": ("GLU", "tGLU/ GLU-A/ GLU-B"),
    "TP": ("TP", "TP"),
    "AMY": ("AMY", "AMY, AMY-A"),
    "GGT": ("GGT", "GGT (含RGT-D)"),
    "CHOL": ("CHOL", "TC"),
    "TBIL": ("TBIL", "TBIL"),
    "PHOS": ("PHOS", "PHOS/ PHOS-A\nPHOS-B/ PHOS-C"),
    "UA": ("UA", "UA"),
    "CRP": ("CRP", "CRP/ CRP-AU"),
}

CONTROL_LABELS = {
    "Control-1": "L1_89751",
    "Control-2": "L2_89752",
    "Control-3": "N1_45981",
    "Control-4": "N3_45983",
}

CONTROL_CS_COLUMNS = {
    "Control-1": "L1_89751",
    "Control-2": "L2_89752",
    "Control-3": "N1_45981",
    "Control-4": "N3_45983",
}


def _get_spec_conn():
    return sqlite3.connect(SPEC_DB_PATH)


def _parse_tea_value(tea_str: str, assigned_value: float) -> float | None:
    """Parse TEa string to absolute value. E.g. '8%' -> assigned*0.08, '1.0 mg/dL' -> 1.0"""
    if not tea_str:
        return None
    tea_str = tea_str.strip()
    # Handle "X or Y%" format - take the larger
    if " or " in tea_str:
        parts = tea_str.split(" or ")
        values = []
        for p in parts:
            v = _parse_tea_single(p.strip(), assigned_value)
            if v is not None:
                values.append(v)
        return max(values) if values else None
    return _parse_tea_single(tea_str, assigned_value)


def _parse_tea_single(tea_str: str, assigned_value: float) -> float | None:
    if tea_str.endswith("%"):
        try:
            pct = float(tea_str.rstrip("%")) / 100.0
            return abs(assigned_value) * pct
        except ValueError:
            return None
    # Absolute value like "1.0 mg/dL", "0.3 mmol/L", "4 mmol/L"
    match = re.match(r"^([\d.]+)", tea_str)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            return None
    return None





def get_spec_thresholds(markers: list[str]) -> dict[str, dict]:
    """Get merge_bias and merge_cv thresholds from bead_ipqc_spec."""
    conn = _get_spec_conn()
    try:
        rows = conn.execute("SELECT marker, merge_bias, merge_cv FROM bead_ipqc_spec").fetchall()
        spec_map = {r[0]: {"merge_bias": r[1] or "", "merge_cv": r[2] or ""} for r in rows}
        result = {}
        for marker in markers:
            tea_key = MARKER_TEA_MAP.get(marker, (marker, marker))[1]
            if tea_key in spec_map:
                result[marker] = spec_map[tea_key]
            else:
                for k, v in spec_map.items():
                    if marker.lower() in k.lower() or k.lower() in marker.lower():
                        result[marker] = v
                        break
                else:
                    result[marker] = {"merge_bias": "", "merge_cv": ""}
        return result
    finally:
        conn.close()


def _parse_threshold_pct(text: str) -> float | None:
    """Extract percentage threshold from spec text like '< ±2.5%' or '< 5%'."""
    if not text:
        return None
    # Find patterns like ±X%, <X%, < ±X%
    match = re.search(r'[±<\s]*(\d+\.?\d*)\s*%', text)
    if match:
        return float(match.group(1)) / 100.0
    return None


def get_panel_info(panel_name: str) -> dict:
    """Get panel info from Tutti_panel_type."""
    conn = _get_spec_conn()
    try:
        row = conn.execute(
            "SELECT panel_name_en, marker_list, code, product_code FROM Tutti_panel_type WHERE panel_name_en = ?",
            (panel_name,),
        ).fetchone()
        if not row:
            return {}
        return {
            "panel_name": row[0],
            "marker_list": [m.strip() for m in row[1].split(",") if m.strip()],
            "code": row[2],
            "product_code": row[3],
        }
    finally:
        conn.close()


def get_tea_values(markers: list[str]) -> dict[str, str]:
    """Get TEa for each marker from bead_ipqc_spec."""
    conn = _get_spec_conn()
    try:
        result = {}
        rows = conn.execute("SELECT marker, tea FROM bead_ipqc_spec").fetchall()
        tea_map = {r[0]: r[1] for r in rows}
        for marker in markers:
            tea_key = MARKER_TEA_MAP.get(marker, (marker, marker))[1]
            # Try exact match first, then partial
            if tea_key in tea_map:
                result[marker] = tea_map[tea_key]
            else:
                # Try matching with newline variants
                for k, v in tea_map.items():
                    if marker.lower() in k.lower() or k.lower() in marker.lower():
                        result[marker] = v
                        break
        return result
    finally:
        conn.close()


def get_assigned_values(markers: list[str]) -> dict[str, dict]:
    """Get assigned values for each control from csassign."""
    conn = _get_spec_conn()
    try:
        rows = conn.execute(
            "SELECT Marker, L1_89751, L2_89752, N1_45981, N3_45983 FROM csassign"
        ).fetchall()
        cs_map = {}
        for r in rows:
            cs_map[r[0]] = {
                "L1_89751": r[1],
                "L2_89752": r[2],
                "N1_45981": r[3],
                "N3_45983": r[4],
            }

        result = {}
        for marker in markers:
            cs_key = MARKER_TEA_MAP.get(marker, (marker, marker))[0]
            if cs_key in cs_map:
                result[marker] = cs_map[cs_key]
            else:
                result[marker] = {"L1_89751": None, "L2_89752": None, "N1_45981": None, "N3_45983": None}
        return result
    finally:
        conn.close()


def generate_control_sheet(
    panel_name: str,
    analyze_date: str,
    fw_version: str | None = None,
) -> dict:
    """Generate Control sheet data structure.

    Returns dict with:
    - header: panel info
    - controls: list of control sections (L1, L2, N1, N3), each with:
      - control_label
      - markers: list of marker names
      - tea_values: dict marker -> TEa display string
      - tea_abs: dict marker -> absolute TEa value
      - assigned: dict marker -> assigned value
      - upper: dict marker -> upper limit
      - lower: dict marker -> lower limit
      - measurements: list of {machine, zone, values: {marker: value}}
    """
    from db import DB_PATH as ASSAY_DB_PATH, TABLE_NAME

    assay_conn = sqlite3.connect(ASSAY_DB_PATH)
    assay_conn.row_factory = sqlite3.Row
    try:
        # Normalize date - handle both 2026/5/4 and 2026-05-04 formats
        norm_date = analyze_date.replace("/", "-")
        parts = norm_date.split("-")
        if len(parts) == 3:
            norm_date = f"{parts[0]}-{parts[1].zfill(2)}-{parts[2].zfill(2)}"

        # Get all records for this panel + date
        where = "WHERE panel_name = ? AND date(replace(analyze_date, '/', '-')) = ?"
        params = [panel_name, norm_date]
        if fw_version:
            where += ' AND "F.W." = ?'
            params.append(fw_version)

        rows = assay_conn.execute(
            f"""SELECT patient_id, analyze_item, analyze_result, "Test Zone",
                       source_file, "F.W.", "Production Date", "Lot code",
                       "Analyzer Serial"
                FROM {TABLE_NAME} {where}
                ORDER BY "Analyzer Serial", patient_id, analyze_item""",
            params,
        ).fetchall()

        if not rows:
            return {"ok": False, "error": "No data found"}

        # Determine markers from actual data
        markers = sorted(set(r["analyze_item"] for r in rows if r["analyze_result"]))

        # Get spec data
        tea_values = get_tea_values(markers)
        assigned_values = get_assigned_values(markers)
        panel_info = get_panel_info(panel_name)

        # Get FW and production date from first row
        first_row = rows[0]
        fw = first_row["F.W."] or ""
        prod_date = first_row["Production Date"] or ""
        lot_code = first_row["Lot code"] or ""

        # Build control sections
        controls = []
        for control_id, control_label in CONTROL_LABELS.items():
            control_rows = [r for r in rows if r["patient_id"] == control_id]
            if not control_rows:
                continue

            # Build TEa absolute values and limits
            tea_abs = {}
            assigned = {}
            upper = {}
            lower = {}
            for marker in markers:
                cs_col = CONTROL_CS_COLUMNS[control_id]
                av = assigned_values.get(marker, {}).get(cs_col)
                if av is not None:
                    try:
                        av_float = float(av)
                    except (ValueError, TypeError):
                        av_float = None
                else:
                    av_float = None

                assigned[marker] = av_float
                tea_str = tea_values.get(marker, "")
                if av_float is not None and tea_str:
                    tea_val = _parse_tea_value(tea_str, av_float)
                    tea_abs[marker] = tea_val
                    if tea_val is not None:
                        upper[marker] = av_float + av_float * 0.5 * (tea_val / av_float if av_float != 0 else 0)
                        # Actually per requirement: 上限= 定值 + 定值 * 1/2 TEa, 下限= 定值 - 定值 * 1/2 TEa
                        # Wait, re-read: 上限= 定值 + 定值 * 1/2, 下限= 定值 - 定值 * 1/2
                        # But looking at Excel: L1 Ca assigned=9.7, TEa=1, upper=10.7, lower=8.7
                        # 9.7 + 1 = 10.7, 9.7 - 1 = 8.7 -> so upper = assigned + TEa, lower = assigned - TEa
                        # Wait let me check CK: assigned=138, TEa=0.2 (20%), upper=165.6, lower=110.4
                        # 138 * 0.2 = 27.6, 138 + 27.6 = 165.6, 138 - 27.6 = 110.4 ✓
                        # So: upper = assigned + TEa_abs, lower = assigned - TEa_abs
                        upper[marker] = av_float + tea_val
                        lower[marker] = av_float - tea_val
                    else:
                        upper[marker] = None
                        lower[marker] = None
                else:
                    tea_abs[marker] = None
                    upper[marker] = None
                    lower[marker] = None

            # Group measurements by source_file (each file = one run)
            measurements = []
            seen_files = {}
            for r in control_rows:
                sf = r["source_file"]
                if sf not in seen_files:
                    seen_files[sf] = {
                        "machine": r["Analyzer Serial"] or "",
                        "zone": r["Test Zone"] or "",
                        "values": {},
                    }
                if r["analyze_result"]:
                    try:
                        seen_files[sf]["values"][r["analyze_item"]] = float(r["analyze_result"])
                    except (ValueError, TypeError):
                        pass
                if r["Test Zone"]:
                    seen_files[sf]["zone"] = r["Test Zone"]

            measurements = list(seen_files.values())

            controls.append({
                "control_label": control_label,
                "control_id": control_id,
                "markers": markers,
                "tea_display": {m: tea_values.get(m, "") for m in markers},
                "tea_abs": tea_abs,
                "assigned": assigned,
                "upper": upper,
                "lower": lower,
                "measurements": measurements,
            })

        # Get spec thresholds for comparison
        spec_thresholds = get_spec_thresholds(markers)

        # Calculate summary for each control
        summary = []
        for ctrl in controls:
            ctrl_summary = {"control_label": ctrl["control_label"], "markers": {}}
            for marker in markers:
                values = [m["values"].get(marker) for m in ctrl["measurements"] if marker in m["values"]]
                if not values:
                    ctrl_summary["markers"][marker] = {"mean": None, "bias": None, "cv": None}
                    continue
                n = len(values)
                mean_val = sum(values) / n
                assigned_val = ctrl["assigned"].get(marker)
                upper_val = ctrl["upper"].get(marker)
                lower_val = ctrl["lower"].get(marker)

                # Bias = mean - assigned (absolute)
                if assigned_val is not None:
                    bias_val = mean_val - assigned_val
                else:
                    bias_val = None

                # CV = std / mean
                if n > 1 and mean_val != 0:
                    variance = sum((v - mean_val) ** 2 for v in values) / (n - 1)
                    cv_val = (variance ** 0.5) / mean_val
                else:
                    cv_val = None

                # Bias alert: total mean must be within [lower, upper]
                bias_alert = False
                if bias_val is not None and lower_val is not None and upper_val is not None:
                    bias_alert = mean_val < lower_val or mean_val > upper_val

                # CV alert: compare with merge_cv from spec
                spec = spec_thresholds.get(marker, {})
                cv_limit = _parse_threshold_pct(spec.get("merge_cv", ""))
                cv_alert = cv_val is not None and cv_limit is not None and cv_val > cv_limit

                ctrl_summary["markers"][marker] = {
                    "mean": round(mean_val, 2) if mean_val is not None else None,
                    "bias": round(bias_val, 2) if bias_val is not None else None,
                    "cv": round(cv_val * 100, 1) if cv_val is not None else None,
                    "bias_alert": bias_alert,
                    "cv_alert": cv_alert,
                    "upper": round(upper_val, 2) if upper_val is not None else None,
                    "lower": round(lower_val, 2) if lower_val is not None else None,
                    "cv_limit": round(cv_limit * 100, 1) if cv_limit is not None else None,
                }
            summary.append(ctrl_summary)

        return {
            "ok": True,
            "panel_name": panel_name,
            "analyze_date": norm_date,
            "fw_version": fw,
            "production_date": prod_date,
            "lot_code": lot_code,
            "product_code": panel_info.get("product_code", ""),
            "markers": markers,
            "controls": controls,
            "summary": summary,
        }
    finally:
        assay_conn.close()
