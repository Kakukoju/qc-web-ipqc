"""
Query service — reads from RDS panel_production.assay_process_records.
"""
import os
import re
from datetime import date, time
from typing import Literal

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent / ".env")

RDS_CONFIG = {
    "host": os.getenv("TUTTI_RDS_HOST", "database-1.cfutwrwyrxts.ap-northeast-1.rds.amazonaws.com"),
    "port": int(os.getenv("TUTTI_RDS_PORT", "5432")),
    "database": os.getenv("TUTTI_RDS_DATABASE", "beadsdb"),
    "user": os.getenv("TUTTI_RDS_USER", "harryguo"),
    "password": os.getenv("TUTTI_RDS_PASSWORD", "skyla168"),
}

TABLE = "panel_production.assay_process_records"

# Columns exposed to frontend (matching previous SQLite column names)
QUERY_COLUMNS = [
    "panel_name", "analyze_date", "analyze_time", "sample_type", "species",
    "patient_id", "lot_code", "mfg_lot_no", "analyze_item", "analyze_result",
    "unit", "test_zone", "test_well", "final_delta_od", "cal_od",
    "equation", "eq_type", "baseline", "baseline_equation", "device_sn",
]

TIME_RE = re.compile(r"^\d{1,2}(?::\d{2}){0,2}$")


def _get_conn():
    return psycopg2.connect(**RDS_CONFIG)


def list_headers() -> list[str]:
    return list(QUERY_COLUMNS)


def _parse_date(value: str) -> date | None:
    s = value.strip().replace("-", "/")
    parts = s.split("/")
    if len(parts) == 3:
        a, b, c = (int(p) for p in parts)
        if a > 31:
            return date(a, b, c)
        if c > 31:
            return date(c, a, b)
    return None


def _parse_time(value: str) -> time | None:
    normalized = value.strip()
    if not TIME_RE.match(normalized):
        return None
    parts = [int(p) for p in normalized.split(":")]
    if len(parts) == 1:
        parts.extend([0, 0])
    elif len(parts) == 2:
        parts.append(0)
    try:
        return time(parts[0], parts[1], parts[2])
    except ValueError:
        return None


def _format_time(value: time) -> str:
    return value.strftime("%H:%M:%S")


def _one_hour_after(value: time) -> str:
    total_seconds = value.hour * 3600 + 3600
    if total_seconds >= 24 * 3600:
        return "24:00:00"
    return f"{total_seconds // 3600:02d}:00:00"


def _build_date_clause(value: str) -> tuple[str, list[str]] | None:
    col = "analyze_date"
    normalized = value.strip().replace(" ", "")

    if "~" in normalized:
        start_raw, end_raw = normalized.split("~", 1)
        start = _parse_date(start_raw)
        end = _parse_date(end_raw)
        if not start or not end:
            return None
        return f"({col} >= %s AND {col} <= %s)", [start.isoformat(), end.isoformat()]

    month_match = re.match(r"^(\d{4})[-/](\d{1,2})$", normalized)
    if month_match:
        year, month = int(month_match.group(1)), int(month_match.group(2))
        start = date(year, month, 1)
        end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
        return f"({col} >= %s AND {col} < %s)", [start.isoformat(), end.isoformat()]

    exact = _parse_date(normalized)
    if exact:
        return f"({col} = %s)", [exact.isoformat()]
    return None


def _build_time_clause(value: str) -> tuple[str, list[str]] | None:
    col = "analyze_time"
    normalized = value.strip().replace(" ", "")

    if "~" in normalized:
        start_raw, end_raw = normalized.split("~", 1)
        start = _parse_time(start_raw)
        end = _parse_time(end_raw)
        if not start or not end:
            return None
        parts = end_raw.strip().split(":")
        if len(parts) == 1 or (len(parts) == 2 and parts[1] == "00"):
            return f"({col} >= %s AND {col} < %s)", [_format_time(start), _one_hour_after(end)]
        if len(parts) == 2:
            return f"({col} >= %s AND {col} <= %s)", [_format_time(start), end.replace(second=59).strftime("%H:%M:%S")]
        return f"({col} >= %s AND {col} <= %s)", [_format_time(start), _format_time(end)]

    parsed = _parse_time(normalized)
    if not parsed:
        return None

    if ":" not in normalized or normalized.endswith(":00"):
        return f"({col} >= %s AND {col} < %s)", [
            parsed.replace(minute=0, second=0).strftime("%H:%M:%S"),
            _one_hour_after(parsed),
        ]
    if normalized.count(":") == 1:
        return f"({col} >= %s AND {col} <= %s)", [
            _format_time(parsed),
            parsed.replace(second=59).strftime("%H:%M:%S"),
        ]
    return f"({col} = %s)", [_format_time(parsed)]


def _build_condition_clause(header: str, value: str) -> tuple[str, list[str]]:
    if header == "analyze_date":
        clause = _build_date_clause(value)
        if clause:
            return clause

    if header == "analyze_time":
        clause = _build_time_clause(value)
        if clause:
            return clause

    if header == "panel_name" and "||" in value:
        parts = value.split("||")
        or_clauses = [f"{header} ILIKE %s" for _ in parts]
        return f"({' OR '.join(or_clauses)})", [f"%{p.strip()}%" for p in parts]

    return f"({header} ILIKE %s)", [f"%{value}%"]


def query_records(
    *,
    logic: str = "AND",
    conditions: list[dict] | None = None,
    limit: int = 500,
    offset: int = 0,
    baseline: str | None = None,
) -> dict:
    normalized_logic: Literal["AND", "OR"] = "OR" if logic == "OR" else "AND"
    normalized_limit = max(1, min(int(limit or 500), 2000))
    normalized_offset = max(0, int(offset or 0))
    raw_conditions = (conditions or [])[:3]

    allowed_headers = set(QUERY_COLUMNS)
    active_conditions: list[tuple[str, str]] = []

    for condition in raw_conditions:
        header = str(condition.get("header", "")).strip()
        value = str(condition.get("value", "")).strip()
        if not header or not value:
            continue
        if header not in allowed_headers:
            raise ValueError(f"Invalid query header: {header}")
        active_conditions.append((header, value))

    params: list = []
    where_parts: list[str] = []

    if baseline is not None:
        where_parts.append("(baseline = %s)")
        params.append(baseline)

    if active_conditions:
        clauses = []
        for header, value in active_conditions:
            clause, clause_params = _build_condition_clause(header, value)
            clauses.append(clause)
            params.extend(clause_params)
        where_parts.append(f"({f' {normalized_logic} '.join(clauses)})")

    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""
    select_columns = ", ".join(QUERY_COLUMNS)

    try:
        conn = _get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cur.execute(f"SELECT COUNT(*) AS total FROM {TABLE} {where_sql}", params)
        total = cur.fetchone()["total"]

        cur.execute(f"""
            SELECT {select_columns}
            FROM {TABLE}
            {where_sql}
            ORDER BY analyze_date DESC, panel_name ASC, analyze_time DESC, id DESC
            LIMIT %s OFFSET %s
        """, params + [normalized_limit, normalized_offset])
        rows = cur.fetchall()

        cur.close()
        conn.close()
    except Exception as e:
        return {"ok": False, "error": str(e)}

    return {
        "ok": True,
        "logic": normalized_logic,
        "total": total,
        "limit": normalized_limit,
        "offset": normalized_offset,
        "columns": QUERY_COLUMNS,
        "rows": [{col: (row[col] or "") for col in QUERY_COLUMNS} for row in rows],
    }
