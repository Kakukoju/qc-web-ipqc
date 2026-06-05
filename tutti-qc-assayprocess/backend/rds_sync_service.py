"""
Sync newly imported assay_process_records from SQLite → RDS panel_production.assay_process_records.
Called after each successful CSV upload.
"""
import os
import re
import json
import logging
from pathlib import Path
from datetime import datetime, timedelta

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

logger = logging.getLogger(__name__)

RDS_CONFIG = {
    "host": os.getenv("TUTTI_RDS_HOST", "database-1.cfutwrwyrxts.ap-northeast-1.rds.amazonaws.com"),
    "port": int(os.getenv("TUTTI_RDS_PORT", "5432")),
    "database": os.getenv("TUTTI_RDS_DATABASE", "beadsdb"),
    "user": os.getenv("TUTTI_RDS_USER", "harryguo"),
    "password": os.getenv("TUTTI_RDS_PASSWORD", "skyla168"),
}

# Cache for sub_panel_type → one_piece_box_panel_type mapping
_panels_cache: dict[str, str] | None = None


def _load_panels_map(pg_cur) -> dict[str, str]:
    """Load sub_panel_type → one_piece_box_panel_type from qbi_qr.panels."""
    global _panels_cache
    if _panels_cache is not None:
        return _panels_cache
    pg_cur.execute("SELECT sub_panel_type, one_piece_box_panel_type FROM qbi_qr.panels")
    _panels_cache = {row[0]: row[1] for row in pg_cur.fetchall()}
    return _panels_cache


def _lot_code_to_mfg_lot_no(lot_code: str, pg_cur) -> str:
    """
    Convert lot_code to mfg_lot_no format.
    - 12碼 (disc-level): {Line}{SubPanel3}{YYMMDDBB} → need panels lookup
    - 17碼 (QR box-level): {Sales3}{PanelType6}{YYMMDDBB} → direct convert
    - Already has dash: return as-is (already mfg_lot_no)
    - Other: return empty string
    """
    if not lot_code:
        return ""

    # Already mfg_lot_no format (has dashes)
    if "-" in lot_code:
        return lot_code

    # 17碼 QR box-level: {Sales3}{PanelType6}{YYMMDDBB}
    if len(lot_code) == 17:
        sales_code = str(int(lot_code[0:3]))  # "001" → "1"
        panel_type = lot_code[3:9]            # 6 digits
        date_batch = lot_code[9:17]           # YYMMDDBB
        return f"{sales_code}-{panel_type}-{date_batch}"

    # 12碼 disc-level: {Line1}{SubPanel3}{YYMMDDBB}
    if len(lot_code) == 12:
        sub_panel_type = lot_code[1:4]        # 3 digits
        date_batch = lot_code[4:12]           # YYMMDDBB
        panels_map = _load_panels_map(pg_cur)
        one_piece_box = panels_map.get(sub_panel_type)
        if not one_piece_box:
            return ""
        panel_type = _resolve_panel_type(sub_panel_type, one_piece_box)
        # sales_code default "1" (most common)
        return f"1-{panel_type}-{date_batch}"

    return ""


def _resolve_panel_type(sub_panel_type: str, one_piece_box_panel_type: str) -> str:
    """
    Resolve the correct 6-char panel_type for a given sub_panel_type.
    one_piece_box_panel_type rules:
    - 6碼: 2片/盒 (e.g. '053054') or 1片/盒 (e.g. '000001') → use as-is
    - >6碼: multiple boxes (e.g. '091092000093') → split into 6-char segments,
      find which segment contains the sub_panel_type
    """
    if len(one_piece_box_panel_type) <= 6:
        return one_piece_box_panel_type
    # Split into 6-char segments representing individual box panel_types
    segments = [one_piece_box_panel_type[i:i+6] for i in range(0, len(one_piece_box_panel_type), 6)]
    for seg in segments:
        # Each 6-char segment contains two 3-char sub_panel_types
        # 2片/盒: seg = sub1 + sub2 (e.g. '091092' = '091'+'092')
        # 1片/盒: seg = '000' + sub  (e.g. '000093' = '000'+'093')
        sub1 = seg[0:3]
        sub2 = seg[3:6]
        if sub_panel_type == sub1 or sub_panel_type == sub2:
            return seg
    # Fallback: return full value
    return one_piece_box_panel_type


def _extract_english(form_title: str) -> str:
    """Extract English portion from formTitle, normalize spaces."""
    if not form_title:
        return ""
    title = form_title.split("\n")[0] if "\n" in form_title else form_title
    title = re.sub(r'^\([^)]*\)\s*', '', title)
    title = re.sub(r'[\u4e00-\u9fff]+', '', title)
    return re.sub(r'\s+', ' ', title).strip()


def _panel_name_matches(form_title: str, panel_name: str) -> bool:
    """Check if panel_name is contained in the English part of formTitle."""
    eng = _extract_english(form_title).lower()
    pn = re.sub(r'\s+', ' ', (panel_name or '').strip().lower())
    if not eng or not pn:
        return False
    return pn in re.sub(r'\s+', ' ', eng)


def _find_work_order(pg_cur, mfg_lot_no: str, panel_name: str, analyze_date: str):
    """
    Find work_order_id, work_order_no, lot_no for a record.
    Returns (work_order_id, work_order_no, lot_no) or (None, '', '').
    """
    if mfg_lot_no:
        pg_cur.execute("""
            SELECT pd.work_order_no, pd.lot_no, tw.id as work_order_id
            FROM panel_production.panel_dispatch pd
            LEFT JOIN panel_production.tutti_work_orders tw
                ON tw.work_order_no = pd.work_order_no
            WHERE pd.work_order_no = %s OR pd.lot_no = %s
            LIMIT 1
        """, (mfg_lot_no, mfg_lot_no))
        row = pg_cur.fetchone()
        if row and row[2]:
            return row[2], row[0] or '', row[1] or ''

    try:
        ad = datetime.strptime(analyze_date, '%Y-%m-%d')
        date_range = [analyze_date, (ad + timedelta(days=1)).strftime('%Y-%m-%d')]
    except ValueError:
        date_range = [analyze_date]

    pg_cur.execute("""
        SELECT id, work_order_no, lot_no, form_data->'header'->>'formTitle' as form_title
        FROM panel_production.tutti_work_orders
        WHERE form_data->'header'->>'date' = ANY(%s)
    """, (date_range,))
    for wo in pg_cur.fetchall():
        if _panel_name_matches(wo[3], panel_name):
            return wo[0], wo[1] or '', wo[2] or ''

    pg_cur.execute("""
        SELECT id, work_order_no, lot_no, form_data->'header'->>'formTitle' as form_title
        FROM panel_production.tutti_work_orders_water
        WHERE form_data->'header'->>'date' = ANY(%s)
    """, (date_range,))
    for wo in pg_cur.fetchall():
        if _panel_name_matches(wo[3], panel_name):
            return None, wo[1] or '', wo[2] or ''

    return None, '', ''


_LOT_CODE_INVALID_RE = re.compile(r'[eE][+\-]')


def _is_valid_lot_code(lot_code: str) -> bool:
    """Return False if lot_code looks like scientific notation or other invalid format."""
    if not lot_code:
        return True  # empty is acceptable (will be derived later)
    if _LOT_CODE_INVALID_RE.search(lot_code):
        return False
    return True


def _record_abnormal(pg_cur, row: dict, error_type: str, error_detail: str, source_file: str, action: str = 'blocked'):
    """Insert a record into panel_production.abnormal_data_records."""
    pg_cur.execute("""
        INSERT INTO panel_production.abnormal_data_records
            (source_table, lot_code, panel_name, analyze_date, device_sn, patient_id, analyze_item,
             error_type, error_detail, raw_data, action_taken, source_file)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, (
        'assay_process_records',
        str(row.get('lot_code', '')),
        str(row.get('panel_name', '')),
        str(row.get('analyze_date', '')),
        str(row.get('device_sn', '')),
        str(row.get('patient_id', '')),
        str(row.get('analyze_item', '')),
        error_type,
        error_detail,
        json.dumps(row, default=str),
        action,
        source_file,
    ))


def sync_to_rds(source_file: str | None = None) -> dict:
    """Push records from SQLite to RDS. If source_file given, only sync that batch."""
    import psycopg2
    import psycopg2.extras
    from db import get_connection, TABLE_NAME, quote_identifier

    try:
        pg = psycopg2.connect(**RDS_CONFIG)
        pg.autocommit = False
        pg_cur = pg.cursor()
    except Exception as e:
        logger.error(f"[RDS Sync] Cannot connect to RDS: {e}")
        return {"ok": False, "error": f"RDS connection failed: {e}"}

    inserted = 0
    skipped = 0
    errors = []

    try:
        with get_connection() as conn:
            where = ""
            params: tuple = ()
            if source_file:
                where = "WHERE source_file = ?"
                params = (source_file,)

            rows = conn.execute(f"""
                SELECT
                    "Analyzer Serial" as device_sn,
                    panel_name,
                    analyze_date,
                    analyze_time,
                    sample_type,
                    "Species" as species,
                    patient_id,
                    "Lot code" as lot_code,
                    mfg_lot_no,
                    analyze_item,
                    analyze_result,
                    unit,
                    "Test Zone" as test_zone,
                    "Test Well" as test_well,
                    "Final Delta OD" as final_delta_od,
                    "Cal. OD/Sec/RFU" as cal_od,
                    "Equation" as equation,
                    "Eq Type" as eq_type,
                    baseline,
                    baseline_equation
                FROM {quote_identifier(TABLE_NAME)}
                {where}
            """, params).fetchall()

            for row in rows:
                device_sn = row["device_sn"] or ""
                panel_name = row["panel_name"] or ""
                analyze_date = row["analyze_date"] or ""
                analyze_time = row["analyze_time"] or ""
                analyze_item = row["analyze_item"] or ""
                test_well = row["test_well"] or ""
                patient_id = row["patient_id"] or ""
                lot_code = row["lot_code"] or ""

                if not device_sn or not analyze_item:
                    skipped += 1
                    continue

                # Validate lot_code format
                if not _is_valid_lot_code(lot_code):
                    _record_abnormal(pg_cur, {
                        'lot_code': lot_code, 'panel_name': panel_name,
                        'analyze_date': analyze_date, 'device_sn': device_sn,
                        'patient_id': patient_id, 'analyze_item': analyze_item,
                    }, 'scientific_notation_lot_code',
                       f"lot_code '{lot_code}' is in scientific notation (Excel corruption)",
                       source_file or '')
                    skipped += 1
                    continue

                # Derive mfg_lot_no from lot_code
                mfg_lot_no = row["mfg_lot_no"] or ""
                if not mfg_lot_no:
                    mfg_lot_no = _lot_code_to_mfg_lot_no(lot_code, pg_cur)

                # Try to find work order (optional)
                work_order_id, work_order_no, lot_no = _find_work_order(
                    pg_cur, mfg_lot_no, panel_name, analyze_date
                )

                # Use lot_no from work order as mfg_lot_no if still empty
                if not mfg_lot_no and lot_no:
                    mfg_lot_no = lot_no

                try:
                    pg_cur.execute("""
                        INSERT INTO panel_production.assay_process_records
                            (work_order_id, work_order_no, lot_no, device_sn, panel_name,
                             analyze_date, analyze_time, sample_type, species, patient_id,
                             lot_code, mfg_lot_no, analyze_item, analyze_result, unit,
                             test_zone, test_well, baseline, baseline_equation,
                             final_delta_od, cal_od, equation, eq_type)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT (device_sn, panel_name, analyze_date, analyze_time, patient_id, analyze_item, test_well)
                        DO UPDATE SET
                            work_order_id = COALESCE(EXCLUDED.work_order_id, panel_production.assay_process_records.work_order_id),
                            work_order_no = COALESCE(NULLIF(EXCLUDED.work_order_no, ''), panel_production.assay_process_records.work_order_no),
                            lot_no = COALESCE(NULLIF(EXCLUDED.lot_no, ''), panel_production.assay_process_records.lot_no),
                            mfg_lot_no = COALESCE(NULLIF(EXCLUDED.mfg_lot_no, ''), panel_production.assay_process_records.mfg_lot_no),
                            analyze_result = EXCLUDED.analyze_result,
                            final_delta_od = EXCLUDED.final_delta_od,
                            cal_od = EXCLUDED.cal_od,
                            equation = EXCLUDED.equation,
                            eq_type = EXCLUDED.eq_type,
                            baseline = EXCLUDED.baseline,
                            baseline_equation = EXCLUDED.baseline_equation
                    """, (
                        work_order_id, work_order_no or '', lot_no or '', device_sn, panel_name,
                        analyze_date, analyze_time,
                        row["sample_type"] or "", row["species"] or "", patient_id,
                        lot_code, mfg_lot_no,
                        analyze_item, row["analyze_result"] or "", row["unit"] or "",
                        row["test_zone"] or "", test_well,
                        row["baseline"] or "false", row["baseline_equation"] or "",
                        row["final_delta_od"] or "", row["cal_od"] or "",
                        row["equation"] or "", row["eq_type"] or "",
                    ))
                    inserted += 1
                except Exception as e:
                    pg.rollback()
                    errors.append(str(e))
                    continue

        pg.commit()
    except Exception as e:
        pg.rollback()
        logger.error(f"[RDS Sync] Error: {e}")
        return {"ok": False, "error": str(e), "inserted": inserted, "skipped": skipped}
    finally:
        pg_cur.close()
        pg.close()

    result = {"ok": True, "inserted": inserted, "skipped": skipped}
    if errors:
        result["errors"] = errors[:5]
    logger.info(f"[RDS Sync] Done: {result}")
    return result
