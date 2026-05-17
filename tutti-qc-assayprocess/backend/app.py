import os
import sqlite3
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from db import DB_PATH, init_db
from baseline_service import get_baseline_group, list_baseline_groups, update_baseline_equation
from import_status_service import get_import_status
from control_sheet_service import generate_control_sheet
from query_service import list_headers, query_records
from upload_service import import_assay_process_csv

load_dotenv()

SPEC_DB_PATH = Path(os.getenv("SPEC_DB_PATH", "/home/ubuntu/bead_ipqc_spec.db"))

app = FastAPI(title="Tutti QC AssayProcess", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()


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
    return import_assay_process_csv(
        content=content,
        source_file=source_file,
        source_file_name=source_file_name or file.filename or os.path.basename(source_file),
        file_mtime=file_mtime,
        baseline=baseline,
    )
