import os
import logging
import sqlite3
from pathlib import Path
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from db import DB_PATH, init_db
from baseline_service import get_baseline_group, list_baseline_groups, update_baseline_equation
from import_status_service import get_import_status
from control_sheet_service import generate_control_sheet
from query_service import list_headers, query_records
from upload_service import import_assay_process_csv
from rds_sync_service import sync_to_rds
import skylai_fetch_service
from skylai_fetch_service import fetch_and_save as skylai_fetch_and_save, scheduled_fetch as skylai_scheduled_fetch, TARGET_DEVICES

load_dotenv()
logger = logging.getLogger(__name__)

SPEC_DB_PATH = Path(os.getenv("SPEC_DB_PATH", "/home/ubuntu/bead_ipqc_spec.db"))

_scheduler = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler
    init_db()
    # Start scheduler
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        _scheduler = BackgroundScheduler()
        _scheduler.add_job(skylai_scheduled_fetch, 'interval', minutes=5, id='skylai_fetch', replace_existing=True)
        _scheduler.start()
        logger.info("[Scheduler] SkylaiCloud fetch job started (every 5 min)")
    except ImportError:
        logger.warning("[Scheduler] apscheduler not installed, auto-fetch disabled")
    yield
    if _scheduler:
        _scheduler.shutdown(wait=False)

app = FastAPI(title="Tutti QC AssayProcess", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "service": "tutti-qc-assayprocess",
        "db_exists": DB_PATH.exists(),
    }


@app.get("/api/headers")
def headers() -> dict:
    return {"ok": True, "headers": list_headers()}


@app.get("/api/panel-names")
def panel_names() -> dict:
    try:
        conn = sqlite3.connect(SPEC_DB_PATH)
        rows = conn.execute(
            "SELECT panel_name_en, panel_name_cn FROM Tutti_panel_type WHERE category='CHEM' ORDER BY panel_name_en"
        ).fetchall()
        conn.close()
        return {
            "ok": True,
            "options": [{"value": r[0], "value_cn": r[1], "label": f"{r[0]} ({r[1]})"} for r in rows],
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/api/import-status")
def import_status() -> dict:
    try:
        return get_import_status()
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/api/query")
def query(payload: dict) -> dict:
    try:
        return query_records(
            logic=payload.get("logic", "AND"),
            conditions=payload.get("conditions", []),
            limit=payload.get("limit", 500),
            offset=payload.get("offset", 0),
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/api/query-baseline")
def query_baseline(payload: dict) -> dict:
    try:
        return query_records(
            logic=payload.get("logic", "AND"),
            conditions=payload.get("conditions", []),
            limit=payload.get("limit", 500),
            offset=payload.get("offset", 0),
            baseline="true",
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/api/baseline-groups")
def baseline_groups(limit: int = 200) -> dict:
    try:
        return list_baseline_groups(limit=limit)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/api/baseline-group")
def baseline_group(payload: dict) -> dict:
    try:
        return get_baseline_group(payload)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/api/baseline-equation")
def baseline_equation(payload: dict) -> dict:
    try:
        return update_baseline_equation(payload)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/api/control-sheet")
def control_sheet(payload: dict) -> dict:
    try:
        return generate_control_sheet(
            panel_name=payload.get("panel_name", ""),
            analyze_date=payload.get("analyze_date", ""),
            fw_version=payload.get("fw_version") or None,
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/api/upload-assay-process-csv")
async def upload_assay_process_csv(
    file: UploadFile = File(...),
    source_file: str = Form(...),
    source_file_name: str = Form(...),
    file_mtime: str = Form(""),
    baseline: str = Form("false"),
) -> dict:
    content = await file.read()
    result = import_assay_process_csv(
        content=content,
        source_file=source_file,
        source_file_name=source_file_name or file.filename or os.path.basename(source_file),
        file_mtime=file_mtime,
        baseline=baseline,
    )
    # After successful import, sync to RDS
    if result.get("ok") and result.get("status") != "skipped":
        sync_result = sync_to_rds(source_file=source_file)
        result["rds_sync"] = sync_result
    return result


@app.post("/api/sync-to-rds")
async def trigger_rds_sync() -> dict:
    """Manually trigger full sync from SQLite to RDS."""
    return sync_to_rds()


@app.post("/api/fetch-skylai-devices")
def fetch_skylai_devices(payload: dict = {}) -> dict:
    """Fetch AssayProcess data from SkylaiCloud for target devices and save to RDS."""
    try:
        devices = payload.get("device_sns") or None
        start_date = payload.get("start_date", "")
        end_date = payload.get("end_date", "")
        days_back = payload.get("days_back", 7)
        auto_detect = payload.get("auto_detect", False)
        return skylai_fetch_and_save(devices, start_date, end_date, days_back, auto_detect)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/api/fetch-skylai-status")
def fetch_skylai_status() -> dict:
    """Check scheduler status and last fetch time."""
    devices = skylai_fetch_service.get_devices_from_db()
    return {
        "ok": True,
        "last_fetch_time": skylai_fetch_service._last_fetch_time,
        "interval": "5min",
        "devices": devices,
        "scheduler_running": _scheduler is not None and _scheduler.running if _scheduler else False,
    }


@app.get("/api/abnormal-records")
def abnormal_records(limit: int = 100, offset: int = 0) -> dict:
    """Query abnormal data records from RDS."""
    try:
        import psycopg2
        import psycopg2.extras
        from rds_sync_service import RDS_CONFIG
        pg = psycopg2.connect(**RDS_CONFIG)
        cur = pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT id, source_table, lot_code, panel_name, analyze_date, device_sn,
                   patient_id, analyze_item, error_type, error_detail, action_taken,
                   source_file, created_at
            FROM panel_production.abnormal_data_records
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
        """, (limit, offset))
        rows = cur.fetchall()
        cur.execute("SELECT COUNT(*) FROM panel_production.abnormal_data_records")
        total = cur.fetchone()['count']
        cur.close()
        pg.close()
        return {"ok": True, "records": [{**r, "created_at": str(r["created_at"])} for r in rows], "total": total}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
