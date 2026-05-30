"""
Phase 2B: Convert production.tutti_scan_records into build-line candidate format.

This module queries RDS for verified scan records and maps them to the same
BaselineGroup / BaselineFit format used by the existing build-lines page.

It does NOT re-parse Disk QR. It does NOT generate fake OD/Conc/R² data.
"""

import json
import os
import logging
from typing import Any

logger = logging.getLogger(__name__)

# ─── Analyze Item Alias Map ──────────────────────────────────────────────────
# Maps canonical analyze_item names to possible reagentName variants in form_data.
ANALYZE_ITEM_REAGENT_ALIAS_MAP: dict[str, list[str]] = {
    "ALB": ["ALB", "QALB-A", "QALB"],
    "CRE": ["CRE", "CRE-D", "CRE-d"],
    "CREA": ["CREA", "CREA-D", "CREA-U", "TCRE-D", "TCREA-D", "TCREA-U", "TCREA", "TCRE"],
    "BUN": ["BUN", "QBUN"],
    "PHOS": ["PHOS", "QPHOS-B", "QPHOS"],
    "TP": ["TP", "QTP"],
    "CA": ["CA", "QCA-B", "QCA"],
    "GLU": ["GLU", "GLU-B", "QGLU"],
    "ALP": ["ALP", "QALP-D", "QALP-U", "QALPD", "QALPU", "QALP"],
    "AST": ["AST", "QAST"],
    "ALT": ["ALT", "QALT"],
    "GGT": ["GGT", "QGGT"],
    "TBIL": ["TBIL", "QTBIL"],
    "AMY": ["AMY", "QAMY"],
    "CHOL": ["CHOL", "QCHOL"],
    "CK": ["CK", "QCK", "CPK"],
    "TRIG": ["TRIG", "QTRIG"],
    "NA": ["NA", "QNA"],
    "K": ["K", "QK"],
    "CL": ["CL", "QCL"],
    "TCO2": ["TCO2", "QTCO2"],
    "LAC": ["LAC", "QLAC"],
    "LDH": ["LDH", "QLDH"],
    "URIC": ["URIC", "QURIC"],
    "BA": ["BA", "QBA"],
    "P-LIPA": ["P-LIPA", "PLIPA", "QP-LIPA"],
    "MG": ["MG", "QMG"],
    "FRU": ["FRU", "QFRU"],
    "NH3": ["NH3", "QNH3"],
    "UCRE": ["UCRE", "QUCRE"],
    "UPRO": ["UPRO", "QUPRO"],
}


def _normalize_text(value: Any) -> str:
    """Normalize text: full-width spaces, tabs, newlines, trim."""
    return str(value or "").replace("\u3000", " ").replace("\t", " ").strip()


def _normalize_marker_name(value: Any) -> str:
    """Normalize marker name to uppercase for comparison."""
    return _normalize_text(value).upper()


def _normalize_batch(value: Any) -> str | None:
    """Normalize batch value, preserving multi-line batches."""
    cleaned = _normalize_text(value)
    lines = [x.strip() for x in cleaned.splitlines() if x.strip()]
    return "\n".join(lines) if lines else None


def _classify_reagent_batch_column(reagent_name: str) -> str:
    """
    Classify a reagentName into d / D / U column.

    Rules:
      tCRE-D  → d (小 d，小瓶)
      tCREA-D → D (大 D，大瓶)
      CRE-d   → d
      *-U     → U
      *-D     → D (general suffix)
      No suffix (單劑, e.g. ALB, QBUN) → D (大 D)
    """
    name = _normalize_marker_name(reagent_name)

    # --- Special cases for tCRE / tCREA ---
    if name == "TCRE-D" or name == "CRE-D":
        return "d"
    if name == "TCREA-D" or name == "CREA-D":
        return "D"

    # --- General rules ---
    if name.endswith("-U") or "CREA-U" in name or "ALPU" in name:
        return "U"
    if name.endswith("-D") or "ALPD" in name:
        return "D"

    # No suffix (單劑) → D
    return "D"


def _get_rds_connection():
    """Get a psycopg2 connection to beadsdb RDS."""
    import psycopg2
    import psycopg2.extras
    return psycopg2.connect(
        host=os.getenv("TUTTI_RDS_HOST", "database-1.cfutwrwyrxts.ap-northeast-1.rds.amazonaws.com"),
        port=int(os.getenv("TUTTI_RDS_PORT", "5432")),
        database=os.getenv("TUTTI_RDS_DATABASE", "beadsdb"),
        user=os.getenv("TUTTI_RDS_USER", "harryguo"),
        password=os.getenv("TUTTI_RDS_PASSWORD", "skyla168"),
        sslmode="require",
    )


def _build_alias_lookup() -> dict[str, str]:
    """Build a reverse lookup: normalized reagentName → canonical analyze_item."""
    lookup: dict[str, str] = {}
    for canonical, aliases in ANALYZE_ITEM_REAGENT_ALIAS_MAP.items():
        for alias in aliases:
            lookup[alias.upper()] = canonical
    return lookup


ALIAS_LOOKUP = _build_alias_lookup()


def _match_analyze_item_to_reagent(analyze_item: str, reagent_name: str) -> bool:
    """Check if a reagentName corresponds to an analyze_item using the alias map only."""
    norm_item = _normalize_marker_name(analyze_item)
    norm_reagent = _normalize_marker_name(reagent_name)

    # Direct match
    if norm_item == norm_reagent:
        return True

    # Check alias map: does the reagent appear in this item's alias list?
    aliases = ANALYZE_ITEM_REAGENT_ALIAS_MAP.get(norm_item, [])
    for alias in aliases:
        if alias.upper() == norm_reagent:
            return True

    # Reverse lookup: does the reagent map to this item?
    canonical = ALIAS_LOOKUP.get(norm_reagent)
    if canonical and canonical == norm_item:
        return True

    return False


def resolve_analyze_item_batches_from_form_data(
    analyze_item: str,
    form_data: dict | None,
) -> dict[str, Any]:
    """
    Resolve d / D / U batches for an analyze_item from tutti_work_orders.form_data.

    Returns:
        {
            "d": str | None,
            "D": str | None,
            "U": str | None,
            "matchedRows": [...]
        }
    """
    result: dict[str, Any] = {"d": None, "D": None, "U": None, "matchedRows": []}

    if not form_data or not analyze_item:
        return result

    wells_data = form_data.get("wells", {})
    if not isinstance(wells_data, dict):
        return result

    # Scan L1, L2, L3
    for line_key in ["L1", "L2", "L3"]:
        rows = wells_data.get(line_key, [])
        if not isinstance(rows, list):
            continue

        for row in rows:
            if not isinstance(row, dict):
                continue

            reagent_name1 = _normalize_text(row.get("reagentName1"))
            reagent_name2 = _normalize_text(row.get("reagentName2"))
            batch1 = _normalize_batch(row.get("batch1"))
            batch2 = _normalize_batch(row.get("batch2"))
            well_position = _normalize_text(row.get("wellPosition"))
            slot1 = _normalize_text(row.get("slot1"))

            # Check reagentName1
            if reagent_name1 and _match_analyze_item_to_reagent(analyze_item, reagent_name1):
                col = _classify_reagent_batch_column(reagent_name1)
                if batch1 and result[col] is None:
                    result[col] = batch1
                result["matchedRows"].append({
                    "sourceLine": line_key,
                    "sourceWellPosition": well_position or None,
                    "sourceSlot": slot1 or None,
                    "sourceField": "reagentName1",
                    "reagentName": reagent_name1,
                    "batch": batch1,
                })

            # Check reagentName2
            if reagent_name2 and _match_analyze_item_to_reagent(analyze_item, reagent_name2):
                col = _classify_reagent_batch_column(reagent_name2)
                if batch2 and result[col] is None:
                    result[col] = batch2
                result["matchedRows"].append({
                    "sourceLine": line_key,
                    "sourceWellPosition": well_position or None,
                    "sourceSlot": slot1 or None,
                    "sourceField": "reagentName2",
                    "reagentName": reagent_name2,
                    "batch": batch2,
                })

    return result


def _fetch_work_order_form_data(lot_no: str, work_order_number: str, scan_time: str) -> dict | None:
    """
    Fetch form_data from panel_production.tutti_work_orders.
    Step 1: by lot_no. Step 2: fallback by work_order_no + closest created_at.
    """
    try:
        import psycopg2.extras
        conn = _get_rds_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Step 1: by lot_no
        cur.execute(
            """SELECT form_data FROM panel_production.tutti_work_orders
               WHERE lot_no = %s ORDER BY created_at DESC LIMIT 1""",
            (lot_no,),
        )
        row = cur.fetchone()
        if row and row.get("form_data"):
            cur.close()
            conn.close()
            fd = row["form_data"]
            return fd if isinstance(fd, dict) else json.loads(fd) if isinstance(fd, str) else None

        # Step 2: fallback by work_order_no + closest created_at
        if work_order_number:
            cur.execute(
                """SELECT form_data FROM panel_production.tutti_work_orders
                   WHERE work_order_no = %s
                   ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - %s::timestamptz))) ASC
                   LIMIT 1""",
                (work_order_number, scan_time),
            )
            row = cur.fetchone()
            if row and row.get("form_data"):
                cur.close()
                conn.close()
                fd = row["form_data"]
                return fd if isinstance(fd, dict) else json.loads(fd) if isinstance(fd, str) else None

        cur.close()
        conn.close()
        return None
    except Exception as exc:
        logger.warning("Failed to fetch work order form_data: %s", exc)
        return None


def list_scan_record_groups(limit: int = 100) -> list[dict[str, Any]]:
    """
    Query production.tutti_scan_records and return them as BaselineGroup-compatible dicts.
    Only returns records where verification_json.ok = true.
    """
    try:
        import psycopg2.extras
        conn = _get_rds_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cur.execute(
            """
            SELECT
                work_order_number,
                lot_no,
                finished_batch_no,
                disk_lot_no,
                panel_name,
                production_date,
                expiration_date,
                disk_markers_json,
                verification_json,
                scan_time,
                created_at,
                device_sn,
                machine_name,
                position
            FROM production.tutti_scan_records
            WHERE (verification_json->>'ok')::boolean = true
            ORDER BY scan_time DESC
            LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()

        groups: list[dict[str, Any]] = []
        seen_keys: set[str] = set()

        for row in rows:
            disk_lot_no = _normalize_text(row.get("disk_lot_no"))
            work_order_number = _normalize_text(row.get("work_order_number"))
            dedup_key = f"tutti_scan_record:{disk_lot_no}:{work_order_number}"

            if dedup_key in seen_keys:
                continue
            seen_keys.add(dedup_key)

            # Parse disk_markers_json
            markers_raw = row.get("disk_markers_json")
            if isinstance(markers_raw, str):
                markers = json.loads(markers_raw)
            elif isinstance(markers_raw, list):
                markers = markers_raw
            else:
                markers = []

            used_markers = [m for m in markers if m.get("used") is not False]
            marker_names = [_normalize_text(m.get("markerName")) for m in used_markers if m.get("markerName")]

            # Determine species
            species_set = set()
            for m in used_markers:
                sn = _normalize_text(m.get("speciesName"))
                if sn and sn != "Unknown":
                    species_set.add(sn)
            species = ", ".join(sorted(species_set)) if species_set else "Control"

            # Format date
            scan_time = row.get("scan_time")
            production_date = row.get("production_date")
            analyze_date = ""
            if production_date:
                analyze_date = str(production_date)[:10]
            elif scan_time:
                analyze_date = str(scan_time)[:10]

            groups.append({
                "mfg_lot_no": disk_lot_no,
                "panel_name": _normalize_text(row.get("panel_name")),
                "analyze_date": analyze_date,
                "Species": species,
                "row_count": 0,
                "analyze_item_count": len(marker_names),
                "analyze_items": marker_names,
                "baseline_exists": False,
                # Extra fields for scan record identification
                "_source": "tutti_scan_record",
                "_source_key": dedup_key,
                "_work_order_number": work_order_number,
                "_lot_no": _normalize_text(row.get("lot_no")),
                "_finished_batch_no": _normalize_text(row.get("finished_batch_no")),
                "_scan_time": str(scan_time) if scan_time else "",
                "_production_date": str(production_date)[:10] if production_date else "",
                "_expiration_date": str(row.get("expiration_date"))[:10] if row.get("expiration_date") else "",
                "_device_sn": _normalize_text(row.get("device_sn")),
                "_machine_name": _normalize_text(row.get("machine_name")),
                "_position": _normalize_text(row.get("position")),
                "_disk_markers_json": markers,
            })

        return groups
    except Exception as exc:
        logger.warning("Failed to list scan record groups: %s", exc)
        return []


def get_scan_record_group_detail(payload: dict) -> dict:
    """
    Get detail for a scan-record-sourced group.
    Returns fits[] with d/D/U from form_data, but no OD/Conc/R² (test data not imported).
    """
    source_key = payload.get("_source_key", "")
    mfg_lot_no = _normalize_text(payload.get("mfg_lot_no"))
    work_order_number = payload.get("_work_order_number", "")
    lot_no = payload.get("_lot_no", mfg_lot_no)
    scan_time = payload.get("_scan_time", "")
    production_date = payload.get("_production_date", "")
    disk_markers = payload.get("_disk_markers_json", [])

    # Fetch form_data from tutti_work_orders
    form_data = _fetch_work_order_form_data(lot_no, work_order_number, scan_time)

    used_markers = [m for m in disk_markers if m.get("used") is not False]

    fits = []
    for marker in used_markers:
        marker_name = _normalize_text(marker.get("markerName"))
        well_number = _normalize_text(marker.get("wellNumber"))

        if not marker_name or marker_name == "Unknown Marker":
            continue

        # Resolve d/D/U batches from form_data
        batch_info = resolve_analyze_item_batches_from_form_data(marker_name, form_data)

        fits.append({
            "mfg_lot_no": mfg_lot_no,
            "panel_name": _normalize_text(payload.get("panel_name")),
            "analyze_date": _normalize_text(payload.get("analyze_date")),
            "Species": _normalize_text(payload.get("Species")),
            "analyze_item": marker_name,
            "test_well": well_number,
            "baseline_equation": "缺少濃度資料",
            "current_baseline_equation": "",
            "change_baseline": 0,
            "fit": None,
            "points": [],
            "missing_concentration": True,
            "d_lot": batch_info["d"] or "",
            "bigD_lot": batch_info["D"] or "",
            "u_lot": batch_info["U"] or "",
            "prod_date": production_date,
            "_source": "tutti_scan_record",
        })

    return {
        "ok": True,
        "group": {
            "mfg_lot_no": mfg_lot_no,
            "panel_name": _normalize_text(payload.get("panel_name")),
            "analyze_date": _normalize_text(payload.get("analyze_date")),
            "Species": _normalize_text(payload.get("Species")),
        },
        "rows": [],
        "fits": fits,
    }
