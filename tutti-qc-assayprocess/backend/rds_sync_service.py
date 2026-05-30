"""
Sync newly imported assay_process_records from SQLite → RDS panel_production.assay_process_records.
Called after each successful CSV upload.
"""
import os
import re
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

    Logic:
    1. Match panel_dispatch where work_order_no or lot_no = mfg_lot_no
    2. Fallback: tutti_work_orders / tutti_work_orders_water by formTitle English + date
    3. If no match: return (None, '', '')
    """
    # Condition 1: panel_dispatch by work_order_no or mfg_lot_no
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

    # Build date range: analyze_date or analyze_date + 1
    try:
        ad = datetime.strptime(analyze_date, '%Y-%m-%d')
        date_range = [analyze_date, (ad + timedelta(days=1)).strftime('%Y-%m-%d')]
    except ValueError:
        date_range = [analyze_date]

    # Condition 2: tutti_work_orders by formTitle English part + date/date+1
    pg_cur.execute("""
        SELECT id, work_order_no, lot_no, form_data->'header'->>'formTitle' as form_title
        FROM panel_production.tutti_work_orders
        WHERE form_data->'header'->>'date' = ANY(%s)
    """, (date_range,))
    for wo in pg_cur.fetchall():
        if _panel_name_matches(wo[3], panel_name):
            return wo[0], wo[1] or '', wo[2] or ''

    # Condition 2b: tutti_work_orders_water
    pg_cur.execute("""
        SELECT id, work_order_no, lot_no, form_data->'header'->>'formTitle' as form_title
        FROM panel_production.tutti_work_orders_water
        WHERE form_data->'header'->>'date' = ANY(%s)
    """, (date_range,))
    for wo in pg_cur.fetchall():
        if _panel_name_matches(wo[3], panel_name):
            return None, wo[1] or '', wo[2] or ''

    return None, '', ''


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
                mfg_lot_no = row["mfg_lot_no"] or ""

                if not device_sn or not analyze_item:
                    skipped += 1
                    continue

                work_order_id, work_order_no, lot_no = _find_work_order(
                    pg_cur, mfg_lot_no, panel_name, analyze_date
                )

                # If no work_order_id found (no FK match), skip insert due to NOT NULL constraint
                if not work_order_id:
                    skipped += 1
                    continue

                # Use lot_no from work order as mfg_lot_no if CSV mfg_lot_no is empty
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
                        ON CONFLICT (work_order_id, device_sn, panel_name, analyze_date, analyze_time, patient_id, analyze_item, test_well)
                        DO UPDATE SET
                            work_order_no = EXCLUDED.work_order_no,
                            lot_no = EXCLUDED.lot_no,
                            analyze_result = EXCLUDED.analyze_result,
                            final_delta_od = EXCLUDED.final_delta_od,
                            cal_od = EXCLUDED.cal_od,
                            equation = EXCLUDED.equation,
                            eq_type = EXCLUDED.eq_type,
                            baseline = EXCLUDED.baseline,
                            baseline_equation = EXCLUDED.baseline_equation
                    """, (
                        work_order_id, work_order_no, lot_no, device_sn, panel_name,
                        analyze_date, analyze_time,
                        row["sample_type"] or "", row["species"] or "", patient_id,
                        row["lot_code"] or "", mfg_lot_no,
                        analyze_item, row["analyze_result"] or "", row["unit"] or "",
                        row["test_zone"] or "", test_well,
                        row["baseline"] or "false", row["baseline_equation"] or "",
                        row["final_delta_od"] or "", row["cal_od"] or "",
                        row["equation"] or "", row["eq_type"] or "",
                    ))
                    inserted += 1
                except psycopg2.errors.ForeignKeyViolation:
                    pg.rollback()
                    skipped += 1
                    continue
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
