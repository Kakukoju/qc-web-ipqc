"""
Comparison DB API Router — new endpoints only, no changes to existing app.py.

Mount this router in app.py with:
    from comparison_api import comparison_router
    app.include_router(comparison_router)
"""

from fastapi import APIRouter, Request
import json
import logging

from comparison_db_service import (
    collect_comparison_data,
    query_comparison_records,
    get_comparison_summary,
    sync_to_s3,
    export_for_rag,
)

logger = logging.getLogger(__name__)
comparison_router = APIRouter(prefix="/api/comparison", tags=["comparison"])


@comparison_router.post("/collect")
async def collect_endpoint(request: Request) -> dict:
    """
    Trigger data collection: joins human build-line decisions with AI curve-fit
    results and stores in comparison DB.

    Body (optional): { "since": "2026-01-01" }
    """
    try:
        body = await request.body()
        payload = json.loads(body) if body else {}
        since = payload.get("since")
        return collect_comparison_data(since=since)
    except Exception as exc:
        logger.exception("Comparison collect failed")
        return {"ok": False, "error": str(exc)}


@comparison_router.get("/records")
def query_records_endpoint(
    marker: str | None = None,
    lot_code: str | None = None,
    panel_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    decision_match: int | None = None,
    limit: int = 200,
    offset: int = 0,
) -> dict:
    """
    Query comparison records with filters.

    Query params:
    - marker: exact marker name
    - lot_code: partial lot code match
    - panel_name: partial panel name match
    - date_from / date_to: analyze_date range
    - decision_match: 0=mismatch, 1=match
    - limit / offset: pagination
    """
    try:
        return query_comparison_records(
            marker=marker,
            lot_code=lot_code,
            panel_name=panel_name,
            analyze_date_from=date_from,
            analyze_date_to=date_to,
            decision_match=decision_match,
            limit=limit,
            offset=offset,
        )
    except Exception as exc:
        logger.exception("Comparison query failed")
        return {"ok": False, "error": str(exc)}


@comparison_router.get("/summary")
def summary_endpoint() -> dict:
    """Get high-level summary statistics of the comparison DB."""
    try:
        return get_comparison_summary()
    except Exception as exc:
        logger.exception("Comparison summary failed")
        return {"ok": False, "error": str(exc)}


@comparison_router.post("/sync-s3")
def sync_s3_endpoint() -> dict:
    """Upload comparison DB to S3 for RAG consumption."""
    try:
        return sync_to_s3()
    except Exception as exc:
        logger.exception("S3 sync failed")
        return {"ok": False, "error": str(exc)}


@comparison_router.post("/export")
async def export_endpoint(request: Request) -> dict:
    """
    Export comparison records for RAG ingestion.
    Body (optional): { "format": "jsonl" | "json" }
    """
    try:
        body = await request.body()
        payload = json.loads(body) if body else {}
        fmt = payload.get("format", "jsonl")
        return export_for_rag(format=fmt)
    except Exception as exc:
        logger.exception("Export failed")
        return {"ok": False, "error": str(exc)}
