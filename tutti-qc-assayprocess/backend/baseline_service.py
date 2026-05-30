import math
import os
import re
import json
import sqlite3
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras

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
        "lot_key": _as_text(payload.get("lot_key")) or _as_text(payload.get("mfg_lot_no")),
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


def _get_rds_connection():
    """Get a PostgreSQL connection to RDS."""
    from rds_sync_service import RDS_CONFIG
    return psycopg2.connect(**RDS_CONFIG)


SPECIAL_MAP = {"TBA": "BA", "TC": "CHOL", "TG": "TRIG", "LIPA": "P-LIPA"}


def _reagent_to_item(rn: str) -> str:
    """Convert reagentName to analyze_item (strip suffix/prefix)."""
    if not rn:
        return ""
    name = re.sub(r'-(AD|AU|BD|BU|D|U|B|A)$', '', rn.strip(), flags=re.IGNORECASE)
    if name.startswith('Q') and len(name) > 1:
        name = name[1:]
    elif name.startswith('t') and len(name) > 1 and name[1].isupper():
        name = name[1:]
    upper = name.upper()
    if upper in SPECIAL_MAP:
        return SPECIAL_MAP[upper]
    return name


def _fetch_batch_info(mfg_lot_no: str, panel_name: str, analyze_date: str, markers: list[str]) -> dict[str, dict[str, str]]:
    """
    Fetch batch info (d_lot, bigD_lot, u_lot, prod_date) from RDS work order form_data.
    Returns: { analyze_item: { d_lot, bigD_lot, u_lot, prod_date } }
    """
    if not markers:
        return {}
    try:
        pg = _get_rds_connection()
        cur = pg.cursor(cursor_factory=psycopg2.extras.DictCursor)

        # Find work order: first try direct match, then via assay_process_records.lot_code
        cur.execute("""
            SELECT work_order_no, lot_no, form_data
            FROM panel_production.tutti_work_orders
            WHERE lot_no = %s OR work_order_no = %s
            LIMIT 1
        """, (mfg_lot_no, mfg_lot_no))
        row = cur.fetchone()

        if not row:
            # Fallback: resolve mfg_lot_no from assay_process_records, then find work order
            cur.execute("""
                SELECT DISTINCT mfg_lot_no FROM panel_production.assay_process_records
                WHERE (lot_code = %s OR mfg_lot_no = %s OR lot_no = %s)
                  AND mfg_lot_no IS NOT NULL AND mfg_lot_no != ''
                LIMIT 1
            """, (mfg_lot_no, mfg_lot_no, mfg_lot_no))
            resolved = cur.fetchone()
            if resolved and resolved['mfg_lot_no'] != mfg_lot_no:
                cur.execute("""
                    SELECT work_order_no, lot_no, form_data
                    FROM panel_production.tutti_work_orders
                    WHERE lot_no = %s LIMIT 1
                """, (resolved['mfg_lot_no'],))
                row = cur.fetchone()
            # Still not found: try matching by same panel_type
            if not row:
                parts = (resolved['mfg_lot_no'] if resolved else mfg_lot_no).split('-')
                if len(parts) >= 2:
                    panel_type = parts[1]
                    cur.execute("""
                        SELECT work_order_no, lot_no, form_data
                        FROM panel_production.tutti_work_orders
                        WHERE split_part(lot_no, '-', 2) = %s
                          AND lot_no IS NOT NULL AND lot_no != ''
                        ORDER BY lot_no DESC LIMIT 1
                    """, (panel_type,))
                    row = cur.fetchone()

        if not row:
            # Try tutti_work_orders_water
            cur.execute("""
                SELECT work_order_no, lot_no, form_data
                FROM panel_production.tutti_work_orders_water
                WHERE lot_no = %s OR work_order_no = %s
                LIMIT 1
            """, (mfg_lot_no, mfg_lot_no))
            row = cur.fetchone()

        if not row:
            # Fallback: match by same panel_type (middle field of mfg_lot_no)
            parts = mfg_lot_no.split('-')
            if len(parts) >= 2:
                panel_type = parts[1]
                cur.execute("""
                    SELECT work_order_no, lot_no, form_data
                    FROM panel_production.tutti_work_orders
                    WHERE split_part(lot_no, '-', 2) = %s
                      AND lot_no IS NOT NULL AND lot_no != ''
                    ORDER BY lot_no DESC
                    LIMIT 1
                """, (panel_type,))
                row = cur.fetchone()

        cur.close()
        pg.close()

        if not row:
            return {}

        form_data = row['form_data'] if isinstance(row['form_data'], dict) else json.loads(row['form_data'])
        prod_date = form_data.get('header', {}).get('date', '')
        wells = form_data.get('wells', {})

        # Build marker -> {d_lot, bigD_lot, u_lot} from wells
        # d_lot (small d) = batch from reagentName starting with lowercase 't' (e.g. tCRE-D)
        # bigD_lot (big D) = batch from reagentName1 with -D/-AD suffix (all others)
        # u_lot (U) = batch from reagentName2 with -U/-AU/-BU suffix
        result: dict[str, dict[str, str]] = {}
        for _line_key, entries in wells.items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                rn1 = entry.get('reagentName1', '').strip()
                rn2 = entry.get('reagentName2', '').strip()
                b1 = entry.get('batch1', '').strip()
                b2 = entry.get('batch2', '').strip()

                if rn1:
                    item = _reagent_to_item(rn1).upper()
                    if item and b1:
                        if item not in result:
                            result[item] = {"d_lot": "", "bigD_lot": "", "u_lot": "", "prod_date": prod_date}
                        # lowercase t prefix -> d_lot (small d)
                        if rn1[0] == 't' and len(rn1) > 1 and rn1[1].isupper():
                            result[item]["d_lot"] = b1
                        else:
                            result[item]["bigD_lot"] = b1

                if rn2:
                    item = _reagent_to_item(rn2).upper()
                    if item and b2:
                        if item not in result:
                            result[item] = {"d_lot": "", "bigD_lot": "", "u_lot": "", "prod_date": prod_date}
                        result[item]["u_lot"] = b2

        # Normalize keys to match markers (case-insensitive)
        marker_set = {m.upper(): m for m in markers}
        final: dict[str, dict[str, str]] = {}
        for key_upper, info in result.items():
            if key_upper in marker_set:
                final[marker_set[key_upper]] = info
        return final

    except Exception:
        return {}


def list_baseline_groups(limit: int = 200) -> dict:
    normalized_limit = max(1, min(int(limit or 200), 1000))
    exclusions = sorted(EXCLUDED_BUILD_LINE_MARKERS)
    excl_clause = "AND analyze_item NOT IN (" + ",".join("%s" for _ in exclusions) + ")" if exclusions else ""

    try:
        pg = _get_rds_connection()
        cur = pg.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cur.execute(f"""
            SELECT
              COALESCE(NULLIF(lot_code, ''), NULLIF(mfg_lot_no, ''), '') AS lot_key,
              COALESCE(NULLIF(lot_code, ''), NULLIF(mfg_lot_no, ''), NULLIF(work_order_no, ''), '') AS display_id,
              panel_name,
              analyze_date,
              species AS "Species",
              COUNT(*) AS row_count,
              COUNT(DISTINCT analyze_item) AS analyze_item_count,
              STRING_AGG(DISTINCT analyze_item, ',') AS analyze_items
            FROM panel_production.assay_process_records
            WHERE LOWER(patient_id) IN ('control-1','control-2','control-3','control-4')
              AND analyze_item != ''
              {excl_clause}
            GROUP BY lot_key, display_id, panel_name, analyze_date, species
            ORDER BY analyze_date DESC, lot_key, panel_name, species
            LIMIT %s
        """, [*exclusions, normalized_limit])
        rows = cur.fetchall()
        cur.close()
        pg.close()
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    return {
        "ok": True,
        "groups": [
            {
                "mfg_lot_no": _as_text(row["display_id"]),
                "lot_key": _as_text(row["lot_key"]),
                "panel_name": _as_text(row["panel_name"]),
                "analyze_date": _as_text(row["analyze_date"]),
                "Species": _as_text(row["Species"]),
                "row_count": int(row["row_count"] or 0),
                "analyze_item_count": int(row["analyze_item_count"] or 0),
                "analyze_items": sorted([item for item in _as_text(row["analyze_items"]).split(",") if item]),
            }
            for row in rows
        ],
    }


def get_baseline_group(payload: dict) -> dict:
    key = _group_key_from_payload(payload)
    exclusions = sorted(EXCLUDED_BUILD_LINE_MARKERS)
    excl_clause = "AND analyze_item NOT IN (" + ",".join("%s" for _ in exclusions) + ")" if exclusions else ""

    try:
        pg = _get_rds_connection()
        cur = pg.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cur.execute(f"""
            SELECT
              id,
              COALESCE(NULLIF(lot_code, ''), NULLIF(mfg_lot_no, ''), '') AS mfg_lot_no,
              panel_name,
              analyze_date,
              species AS "Species",
              patient_id,
              analyze_item,
              test_well,
              final_delta_od,
              baseline_equation,
              0 AS change_baseline
            FROM panel_production.assay_process_records
            WHERE LOWER(patient_id) IN ('control-1','control-2','control-3','control-4')
              AND analyze_item != ''
              {excl_clause}
              AND COALESCE(NULLIF(lot_code, ''), NULLIF(mfg_lot_no, ''), '') = %s
              AND panel_name = %s
              AND analyze_date = %s
              AND species = %s
            ORDER BY analyze_item, test_well, patient_id, id
        """, [*exclusions, key["lot_key"], key["panel_name"], key["analyze_date"], key["Species"]])
        rows = cur.fetchall()
        cur.close()
        pg.close()
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

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

    # Fetch batch info from RDS
    batch_info = _fetch_batch_info(key["mfg_lot_no"], key["panel_name"], key["analyze_date"], markers)

    fits = []
    for analyze_item, item_rows in grouped.items():
        fit = _linear_fit(item_rows)
        test_wells = sorted({row["test_well"] for row in item_rows if row["test_well"]})
        bi = batch_info.get(analyze_item, {})
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
                "d_lot": bi.get("d_lot", ""),
                "bigD_lot": bi.get("bigD_lot", ""),
                "u_lot": bi.get("u_lot", ""),
                "prod_date": bi.get("prod_date", ""),
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
