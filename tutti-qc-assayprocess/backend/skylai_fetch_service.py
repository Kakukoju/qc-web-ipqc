"""  
Fetch AssayProcess data from SkylaiCloud API for specified devices and save to RDS.
"""
import json
import logging
import sqlite3
from datetime import datetime, timedelta

import requests
import psycopg2
import psycopg2.extras

from rds_sync_service import RDS_CONFIG, _lot_code_to_mfg_lot_no, _find_work_order

logger = logging.getLogger(__name__)

SKYLAI_API_BASE = "https://api.skylaicloud.com.tw"
SKYLAI_API_TOKEN = "43488|TnN58D0tNwbwrRjFYXbavtBvrmzuDtATunXP3Jwy"
SKYLAI_PROJECT_ID = 1

SPEC_DB_PATH = "/home/ubuntu/bead_ipqc_spec.db"
TARGET_DEVICES = ["Q1H250619013", "Q1H250619026", "Q1H250619034", "Q1H250826021", "Q1H260316001"]

# Scheduler state
_last_fetch_totals: dict[str, int] = {}  # device_sn -> last known total
_last_fetch_time: str = ""


def get_devices_from_db() -> list[str]:
    """Read Tutti device_sn list from SQLite or SkylaiCloud device_list API."""
    # Try SQLite first
    try:
        conn = sqlite3.connect(SPEC_DB_PATH)
        rows = conn.execute("SELECT device_sn FROM machine_pn WHERE machine_type='Tutti' AND device_sn IS NOT NULL").fetchall()
        conn.close()
        devices = [r[0] for r in rows if r[0]]
        if devices:
            return devices
    except Exception:
        pass
    # Fallback: query SkylaiCloud device_list for QC group
    try:
        headers = {"Authorization": f"Bearer {SKYLAI_API_TOKEN}", "Content-Type": "application/json"}
        resp = requests.post(f"{SKYLAI_API_BASE}/api/get_device_list", headers=headers, json={
            "command": "get_device_list",
            "project_id": SKYLAI_PROJECT_ID,
            "group_name": "QC",
        }, timeout=10)
        if resp.status_code == 200:
            data = resp.json().get("data", [])
            devices = [d["device_sn"] for d in data if d.get("device_sn")]
            if devices:
                return devices
    except Exception:
        pass
    return TARGET_DEVICES


def get_active_devices() -> list[str]:
    """Query SkylaiCloud device_status to find devices that are online/running."""
    headers = {"Authorization": f"Bearer {SKYLAI_API_TOKEN}", "Content-Type": "application/json"}
    try:
        resp = requests.post(f"{SKYLAI_API_BASE}/api/get_device_status", headers=headers, json={
            "command": "get_device_status",
            "project_id": SKYLAI_PROJECT_ID,
            "group_name": "QC",
        }, timeout=15)
        if resp.status_code != 200:
            return get_devices_from_db()
        data = resp.json().get("data", [])
        active = [d["device_sn"] for d in data if d.get("last_heartbeat") and d.get("device_status") in ("online", "running")]
        return active if active else get_devices_from_db()
    except Exception:
        return get_devices_from_db()


def fetch_and_save(device_sns: list[str] | None = None, start_date: str = "", end_date: str = "", days_back: int = 7, auto_detect: bool = False) -> dict:
    """Fetch data from SkylaiCloud for devices and upsert into RDS."""
    if auto_detect:
        devices = get_active_devices()
    else:
        devices = device_sns or get_devices_from_db()
    if not start_date:
        start_date = (datetime.now() - timedelta(days=days_back)).strftime("%Y-%m-%d")
    if not end_date:
        end_date = datetime.now().strftime("%Y-%m-%d")

    headers = {"Authorization": f"Bearer {SKYLAI_API_TOKEN}", "Content-Type": "application/json"}

    try:
        pg = psycopg2.connect(**RDS_CONFIG)
        pg.autocommit = False
        pg_cur = pg.cursor()
    except Exception as e:
        return {"ok": False, "error": f"RDS connection failed: {e}"}

    total_inserted = 0
    total_skipped = 0
    device_results = []

    try:
        for sn in devices:
            device_inserted = 0
            page = 1
            while True:
                resp = requests.post(f"{SKYLAI_API_BASE}/api/get_device_data", headers=headers, json={
                    "command": "get_device_data",
                    "project_id": SKYLAI_PROJECT_ID,
                    "device_sn": sn,
                    "start_date": start_date,
                    "end_date": end_date,
                    "per_page": 50,
                    "current_page": page,
                    "sort": ["-analyze_date"],
                }, timeout=30)

                if resp.status_code != 200:
                    device_results.append({"device_sn": sn, "error": f"API {resp.status_code}", "inserted": 0})
                    break

                body = resp.json()
                sessions = body.get("data", [])
                if not sessions:
                    break

                for session in sessions:
                    s_date = session.get("analyze_date", "")
                    s_time = session.get("analyze_time", "")
                    panel_name = session.get("panel_name", "")
                    lot_code = session.get("lot_code", "")
                    sample_type = session.get("sample_type", "")
                    species = session.get("species", "")
                    patient_id = session.get("patient_id", "")
                    serial_number = session.get("serial_number", "")
                    test_zone = session.get("test_zone", "")

                    # Derive mfg_lot_no
                    mfg_lot_no = _lot_code_to_mfg_lot_no(lot_code, pg_cur) if lot_code else ""
                    work_order_id, work_order_no, lot_no = _find_work_order(pg_cur, mfg_lot_no, panel_name, s_date)

                    for marker in session.get("markers", []):
                        analyze_item = marker.get("analyze_item", "")
                        test_well = str(marker.get("test_well", ""))
                        if not analyze_item or not test_well:
                            total_skipped += 1
                            continue

                        pg_cur.execute("""
                            INSERT INTO panel_production.assay_process_records
                                (work_order_id, work_order_no, lot_no, device_sn, panel_name,
                                 analyze_date, analyze_time, sample_type, species, patient_id,
                                 lot_code, mfg_lot_no, analyze_item, analyze_result, unit,
                                 test_zone, test_well, baseline, baseline_equation,
                                 final_delta_od, cal_od, equation, eq_type, raw_data)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                            ON CONFLICT (device_sn, panel_name, analyze_date, analyze_time, patient_id, analyze_item, test_well)
                            DO UPDATE SET
                                analyze_result = EXCLUDED.analyze_result,
                                raw_data = EXCLUDED.raw_data,
                                mfg_lot_no = COALESCE(NULLIF(EXCLUDED.mfg_lot_no,''), panel_production.assay_process_records.mfg_lot_no),
                                work_order_id = COALESCE(EXCLUDED.work_order_id, panel_production.assay_process_records.work_order_id),
                                work_order_no = COALESCE(NULLIF(EXCLUDED.work_order_no,''), panel_production.assay_process_records.work_order_no)
                        """, (
                            work_order_id, work_order_no or '', lot_no or '', sn, panel_name,
                            s_date, s_time, sample_type, species, patient_id or '',
                            lot_code, mfg_lot_no,
                            analyze_item, str(marker.get("analyze_result", "")), marker.get("unit", ""),
                            marker.get("test_zone", "") or test_zone, test_well,
                            "false", "",
                            str(marker.get("final_delta_od", "")) if marker.get("final_delta_od") is not None else "",
                            str(marker.get("cal_od_sec_rfu", "")) if marker.get("cal_od_sec_rfu") is not None else "",
                            str(marker.get("equation", "")) if marker.get("equation") else "",
                            str(marker.get("eq_type", "")) if marker.get("eq_type") else "",
                            json.dumps(marker),
                        ))
                        device_inserted += 1

                last_page = body.get("last_page", 1)
                if page >= last_page:
                    break
                page += 1

            total_inserted += device_inserted
            device_results.append({"device_sn": sn, "inserted": device_inserted})

        pg.commit()
    except Exception as e:
        pg.rollback()
        logger.error(f"[SkylaiCloud Fetch] Error: {e}")
        return {"ok": False, "error": str(e), "device_results": device_results}
    finally:
        pg_cur.close()
        pg.close()

    return {
        "ok": True,
        "total_inserted": total_inserted,
        "total_skipped": total_skipped,
        "device_results": device_results,
        "date_range": {"start": start_date, "end": end_date},
    }


def scheduled_fetch() -> dict:
    """Called every 5 minutes by scheduler. Only fetches today's data, skips if totals unchanged."""
    global _last_fetch_totals, _last_fetch_time

    devices = get_devices_from_db()
    today = datetime.now().strftime("%Y-%m-%d")
    headers = {"Authorization": f"Bearer {SKYLAI_API_TOKEN}", "Content-Type": "application/json"}

    # Quick check: get total for each device with per_page=1
    devices_to_fetch = []
    for sn in devices:
        try:
            resp = requests.post(f"{SKYLAI_API_BASE}/api/get_device_data", headers=headers, json={
                "command": "get_device_data",
                "project_id": SKYLAI_PROJECT_ID,
                "device_sn": sn,
                "start_date": today,
                "end_date": today,
                "per_page": 1,
                "current_page": 1,
                "sort": ["-analyze_date"],
            }, timeout=10)
            if resp.status_code == 200:
                total = resp.json().get("total", 0)
                if total > 0 and total != _last_fetch_totals.get(sn, 0):
                    devices_to_fetch.append(sn)
                    _last_fetch_totals[sn] = total
        except Exception:
            continue

    if not devices_to_fetch:
        _last_fetch_time = datetime.now().isoformat()
        logger.info(f"[Scheduler] No new data detected. Checked {len(devices)} devices.")
        return {"ok": True, "skipped": True, "checked": len(devices), "time": _last_fetch_time}

    # Fetch only devices with new data, today only
    result = fetch_and_save(devices_to_fetch, start_date=today, end_date=today)
    _last_fetch_time = datetime.now().isoformat()
    result["last_fetch_time"] = _last_fetch_time
    logger.info(f"[Scheduler] Fetched {result.get('total_inserted', 0)} records from {len(devices_to_fetch)} devices.")
    return result
