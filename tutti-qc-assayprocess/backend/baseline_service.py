import math
import os
import sqlite3
from pathlib import Path
from typing import Any

from db import TABLE_NAME, get_connection, quote_identifier, table_exists


SPEC_DB_PATH = Path(os.getenv("SPEC_DB_PATH", "/home/ubuntu/bead_ipqc_spec.db"))
CONTROL_CONC_COLUMNS = {
    "control-1": "L1",
    "control-2": "L2",
    "control-3": "N1",
    "control-4": "N3",
}
CONTROL_IDS = tuple(CONTROL_CONC_COLUMNS)
EXCLUDED_BUILD_LINE_MARKERS = {"BCl"}


def _as_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return number


def _lot_expression() -> str:
    return (
        f"COALESCE(NULLIF(TRIM({quote_identifier('mfg_lot_no')}), ''), "
        f"NULLIF(TRIM({quote_identifier('Lot code')}), ''), '')"
    )


def _empty_equation_clause() -> str:
    return f"COALESCE(TRIM({quote_identifier('baseline_equation')}), '') = ''"


def _control_clause() -> str:
    return "LOWER(TRIM(patient_id)) IN (?, ?, ?, ?)"


def _base_where() -> str:
    return f"baseline = 'true' AND {_control_clause()}"


def _marker_exclusion_clause() -> str:
    if not EXCLUDED_BUILD_LINE_MARKERS:
        return "1 = 1"
    placeholders = ", ".join("?" for _ in EXCLUDED_BUILD_LINE_MARKERS)
    return f"analyze_item NOT IN ({placeholders})"


def _marker_exclusion_params() -> list[str]:
    return sorted(EXCLUDED_BUILD_LINE_MARKERS)


def _group_key_from_payload(payload: dict) -> dict[str, str]:
    return {
        "mfg_lot_no": _as_text(payload.get("mfg_lot_no")),
        "panel_name": _as_text(payload.get("panel_name")),
        "analyze_date": _as_text(payload.get("analyze_date")),
        "Species": _as_text(payload.get("Species")),
    }


def _fetch_concentrations(markers: list[str]) -> dict[str, dict[str, float | None]]:
    if not markers or not SPEC_DB_PATH.exists():
        return {}

    placeholders = ",".join("?" for _ in markers)
    with sqlite3.connect(SPEC_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            f"SELECT * FROM csassign WHERE Marker IN ({placeholders})",
            markers,
        ).fetchall()

    concentrations: dict[str, dict[str, float | None]] = {}
    for row in rows:
        row_map = dict(row)
        marker = _as_text(row_map.get("Marker"))
        marker_conc: dict[str, float | None] = {}
        for control_id, prefix in CONTROL_CONC_COLUMNS.items():
            matched_value = None
            for column, value in row_map.items():
                if column.startswith(prefix):
                    matched_value = value
                    break
            marker_conc[control_id] = _as_float(matched_value)
        concentrations[marker] = marker_conc
    return concentrations


def _linear_fit(points: list[dict[str, Any]]) -> dict[str, Any] | None:
    valid = [
        (float(point["conc"]), float(point["final_delta_od"]))
        for point in points
        if point.get("conc") is not None and point.get("final_delta_od") is not None
    ]
    if len(valid) < 2:
        return None

    xs = [point[0] for point in valid]
    ys = [point[1] for point in valid]
    n = len(valid)
    x_mean = sum(xs) / n
    y_mean = sum(ys) / n
    denominator = sum((x - x_mean) ** 2 for x in xs)
    if denominator == 0:
        return None

    slope = sum((x - x_mean) * (y - y_mean) for x, y in valid) / denominator
    intercept = y_mean - slope * x_mean
    predictions = [slope * x + intercept for x in xs]
    ss_res = sum((y - pred) ** 2 for y, pred in zip(ys, predictions))
    ss_tot = sum((y - y_mean) ** 2 for y in ys)
    r_squared = 1 if ss_tot == 0 and ss_res == 0 else 1 - (ss_res / ss_tot if ss_tot else 0)
    equation = f"y = {slope:.10g}x + {intercept:.10g}; R2 = {r_squared:.6g}; n = {n}"

    return {
        "model": "linear",
        "slope": slope,
        "intercept": intercept,
        "r_squared": r_squared,
        "n": n,
        "equation": equation,
    }


def list_baseline_groups(limit: int = 200) -> dict:
    normalized_limit = max(1, min(int(limit or 200), 1000))
    lot_sql = _lot_expression()
    with get_connection() as conn:
        if not table_exists(conn, TABLE_NAME):
            return {"ok": True, "groups": []}

        rows = conn.execute(
            f"""
            SELECT
              {lot_sql} AS mfg_lot_no,
              panel_name,
              analyze_date,
              Species,
              COUNT(*) AS row_count,
              COUNT(DISTINCT analyze_item) AS analyze_item_count,
              GROUP_CONCAT(DISTINCT analyze_item) AS analyze_items
            FROM {quote_identifier(TABLE_NAME)}
            WHERE {_base_where()} AND {_marker_exclusion_clause()}
            GROUP BY {lot_sql}, panel_name, analyze_date, Species
            ORDER BY replace(analyze_date, '/', '-') DESC, mfg_lot_no, panel_name, Species
            LIMIT ?
            """,
            [*CONTROL_IDS, *_marker_exclusion_params(), normalized_limit],
        ).fetchall()

    return {
        "ok": True,
        "groups": [
            {
                "mfg_lot_no": _as_text(row["mfg_lot_no"]),
                "panel_name": _as_text(row["panel_name"]),
                "analyze_date": _as_text(row["analyze_date"]),
                "Species": _as_text(row["Species"]),
                "row_count": int(row["row_count"] or 0),
                "analyze_item_count": int(row["analyze_item_count"] or 0),
                "analyze_items": [item for item in _as_text(row["analyze_items"]).split(",") if item],
            }
            for row in rows
        ],
    }


def get_baseline_group(payload: dict) -> dict:
    key = _group_key_from_payload(payload)
    lot_sql = _lot_expression()
    with get_connection() as conn:
        if not table_exists(conn, TABLE_NAME):
            return {"ok": True, "group": key, "rows": [], "fits": []}

        rows = conn.execute(
            f"""
            SELECT
              id,
              {lot_sql} AS mfg_lot_no,
              panel_name,
              analyze_date,
              Species,
              patient_id,
              analyze_item,
              {quote_identifier('Test Well')} AS test_well,
              {quote_identifier('Final Delta OD')} AS final_delta_od,
              baseline_equation,
              COALESCE(change_baseline, 0) AS change_baseline
            FROM {quote_identifier(TABLE_NAME)}
            WHERE {_base_where()} AND {_marker_exclusion_clause()}
              AND {lot_sql} = ?
              AND panel_name = ?
              AND analyze_date = ?
              AND Species = ?
            ORDER BY analyze_item, {quote_identifier('Test Well')}, patient_id, id
            """,
            [
                *CONTROL_IDS,
                *_marker_exclusion_params(),
                key["mfg_lot_no"],
                key["panel_name"],
                key["analyze_date"],
                key["Species"],
            ],
        ).fetchall()

    normalized_rows = [
        {
            "id": int(row["id"]),
            "mfg_lot_no": _as_text(row["mfg_lot_no"]),
            "panel_name": _as_text(row["panel_name"]),
            "analyze_date": _as_text(row["analyze_date"]),
            "Species": _as_text(row["Species"]),
            "patient_id": _as_text(row["patient_id"]),
            "analyze_item": _as_text(row["analyze_item"]),
            "test_well": _as_text(row["test_well"]),
            "final_delta_od": _as_float(row["final_delta_od"]),
            "baseline_equation": _as_text(row["baseline_equation"]),
            "change_baseline": int(row["change_baseline"] or 0),
        }
        for row in rows
    ]

    markers = sorted({row["analyze_item"] for row in normalized_rows if row["analyze_item"]})
    concentrations = _fetch_concentrations(markers)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in normalized_rows:
        control_id = row["patient_id"].lower()
        conc = concentrations.get(row["analyze_item"], {}).get(control_id)
        row["conc"] = conc
        grouped.setdefault(row["analyze_item"], []).append(row)

    fits = []
    for analyze_item, item_rows in grouped.items():
        fit = _linear_fit(item_rows)
        test_wells = sorted({row["test_well"] for row in item_rows if row["test_well"]})
        fits.append(
            {
                "mfg_lot_no": key["mfg_lot_no"],
                "panel_name": key["panel_name"],
                "analyze_date": key["analyze_date"],
                "Species": key["Species"],
                "analyze_item": analyze_item,
                "test_well": ", ".join(test_wells),
                "baseline_equation": fit["equation"] if fit else "",
                "current_baseline_equation": next((_as_text(row["baseline_equation"]) for row in item_rows if _as_text(row["baseline_equation"])), ""),
                "change_baseline": max((int(row.get("change_baseline") or 0) for row in item_rows), default=0),
                "fit": fit,
                "points": item_rows,
                "missing_concentration": any(row.get("conc") is None for row in item_rows),
            }
        )

    return {"ok": True, "group": key, "rows": normalized_rows, "fits": fits}


def update_baseline_equation(payload: dict) -> dict:
    key = _group_key_from_payload(payload)
    analyze_item = _as_text(payload.get("analyze_item"))
    equation = _as_text(payload.get("baseline_equation"))
    if not analyze_item:
        raise ValueError("analyze_item is required")
    if not equation:
        raise ValueError("baseline_equation is required")

    lot_sql = _lot_expression()
    with get_connection() as conn:
        result = conn.execute(
            f"""
            UPDATE {quote_identifier(TABLE_NAME)}
            SET baseline_equation = ?,
                change_baseline = CASE
                    WHEN COALESCE(TRIM(baseline_equation), '') <> ''
                     AND COALESCE(TRIM(baseline_equation), '') <> ?
                    THEN COALESCE(change_baseline, 0) + 1
                    ELSE COALESCE(change_baseline, 0)
                END
            WHERE baseline = 'true'
              AND {lot_sql} = ?
              AND panel_name = ?
              AND analyze_date = ?
              AND Species = ?
              AND analyze_item = ?
            """,
            [
                equation,
                equation,
                key["mfg_lot_no"],
                key["panel_name"],
                key["analyze_date"],
                key["Species"],
                analyze_item,
            ],
        )

    return {"ok": True, "updated": result.rowcount, "baseline_equation": equation}
