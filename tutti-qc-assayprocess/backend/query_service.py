import re
from datetime import date, time
from typing import Literal

from db import TABLE_NAME, get_connection, get_data_headers, quote_identifier, table_exists


MONTH_RE = re.compile(r"^\d{4}[-/]\d{2}$")
DATE_RE = re.compile(r"^\d{4}[-/]\d{2}[-/]\d{2}$")
TIME_RE = re.compile(r"^\d{1,2}(?::\d{2}){0,2}$")


def list_headers() -> list[str]:
    with get_connection() as conn:
        return get_data_headers(conn)


def _parse_date(value: str) -> date | None:
    normalized = value.strip().replace("/", "-")
    if not DATE_RE.match(normalized):
        return None
    year, month, day = (int(part) for part in normalized.split("-"))
    return date(year, month, day)


def _next_month(value: str) -> date:
    normalized = value.strip().replace("/", "-")
    year, month = (int(part) for part in normalized.split("-"))
    if month == 12:
        return date(year + 1, 1, 1)
    return date(year, month + 1, 1)


def _parse_time(value: str) -> time | None:
    normalized = value.strip()
    if not TIME_RE.match(normalized):
        return None
    parts = [int(part) for part in normalized.split(":")]
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
    hour = total_seconds // 3600
    return f"{hour:02d}:00:00"


def _time_upper_bound(value: time, original: str) -> tuple[str, bool]:
    parts = original.strip().split(":")
    if len(parts) == 1 or (len(parts) == 2 and parts[1] == "00"):
        return _one_hour_after(value), True
    if len(parts) == 2:
        return value.replace(second=59).strftime("%H:%M:%S"), False
    return _format_time(value), False


def _build_date_clause(header: str, value: str) -> tuple[str, list[str]] | None:
    expression = f"replace({quote_identifier(header)}, '/', '-')"
    normalized = value.strip().replace(" ", "")

    if "~" in normalized:
        start_raw, end_raw = normalized.split("~", 1)
        start = _parse_date(start_raw)
        end = _parse_date(end_raw)
        if not start or not end:
            return None
        return f"({expression} >= ? AND {expression} <= ?)", [start.isoformat(), end.isoformat()]

    if MONTH_RE.match(normalized):
        start = date.fromisoformat(normalized.replace("/", "-") + "-01")
        end = _next_month(normalized)
        return f"({expression} >= ? AND {expression} < ?)", [start.isoformat(), end.isoformat()]

    exact = _parse_date(normalized)
    if exact:
        return f"({expression} = ?)", [exact.isoformat()]

    return None


def _build_time_clause(header: str, value: str) -> tuple[str, list[str]] | None:
    expression = quote_identifier(header)
    normalized = value.strip().replace(" ", "")

    if "~" in normalized:
        start_raw, end_raw = normalized.split("~", 1)
        start = _parse_time(start_raw)
        end = _parse_time(end_raw)
        if not start or not end:
            return None
        end_bound, exclusive = _time_upper_bound(end, end_raw)
        operator = "<" if exclusive else "<="
        return f"({expression} >= ? AND {expression} {operator} ?)", [_format_time(start), end_bound]

    parsed = _parse_time(normalized)
    if not parsed:
        return None

    if ":" not in normalized or normalized.endswith(":00"):
        return f"({expression} >= ? AND {expression} < ?)", [
            parsed.replace(minute=0, second=0).strftime("%H:%M:%S"),
            _one_hour_after(parsed),
        ]

    if normalized.count(":") == 1:
        return f"({expression} >= ? AND {expression} <= ?)", [
            _format_time(parsed),
            parsed.replace(second=59).strftime("%H:%M:%S"),
        ]

    return f"({expression} = ?)", [_format_time(parsed)]


def _build_condition_clause(header: str, value: str) -> tuple[str, list[str]]:
    if header == "analyze_date":
        date_clause = _build_date_clause(header, value)
        if date_clause:
            return date_clause

    if header == "analyze_time":
        time_clause = _build_time_clause(header, value)
        if time_clause:
            return time_clause

    # panel_name: support "EN||CN" format for OR matching
    if header == "panel_name" and "||" in value:
        parts = value.split("||")
        col = quote_identifier(header)
        or_clauses = [f"{col} LIKE ?" for _ in parts]
        return f"({' OR '.join(or_clauses)})", [f"%{p.strip()}%" for p in parts]

    return f"({quote_identifier(header)} LIKE ?)", [f"%{value}%"]


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

    with get_connection() as conn:
        if not table_exists(conn, TABLE_NAME):
            return {
                "ok": True,
                "logic": normalized_logic,
                "total": 0,
                "limit": normalized_limit,
                "offset": normalized_offset,
                "columns": [],
                "rows": [],
            }

        headers = get_data_headers(conn)
        allowed_headers = set(headers)
        active_conditions: list[tuple[str, str]] = []

        for condition in raw_conditions:
            header = str(condition.get("header", "")).strip()
            value = str(condition.get("value", "")).strip()
            if not header or not value:
                continue
            if header not in allowed_headers:
                raise ValueError(f"Invalid query header: {header}")
            active_conditions.append((header, value))

        select_columns = ", ".join(quote_identifier(header) for header in headers)
        if not select_columns:
            select_columns = quote_identifier("id")

        params: list[str | int] = []
        where_parts: list[str] = []

        if baseline is not None:
            where_parts.append(f'({quote_identifier("baseline")} = ?)')
            params.append(baseline)

        if active_conditions:
            clauses = []
            for header, value in active_conditions:
                clause, clause_params = _build_condition_clause(header, value)
                clauses.append(clause)
                params.extend(clause_params)
            where_parts.append(f'({f" {normalized_logic} ".join(clauses)})')

        where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

        count_row = conn.execute(
            f"SELECT COUNT(*) AS total FROM {quote_identifier(TABLE_NAME)} {where_sql}",
            params,
        ).fetchone()

        order_sql = "ORDER BY replace(\"analyze_date\", '/', '-') DESC, \"analyze_time\" DESC, id DESC"
        params.extend([normalized_limit, normalized_offset])
        rows = conn.execute(
            f"""
            SELECT {select_columns}
            FROM {quote_identifier(TABLE_NAME)}
            {where_sql}
            {order_sql}
            LIMIT ? OFFSET ?
            """,
            params,
        ).fetchall()

    return {
        "ok": True,
        "logic": normalized_logic,
        "total": count_row["total"] if count_row else 0,
        "limit": normalized_limit,
        "offset": normalized_offset,
        "columns": headers,
        "rows": [{header: row[header] for header in headers} for row in rows],
    }
