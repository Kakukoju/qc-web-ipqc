from db import (
    MANIFEST_TABLE,
    NATURAL_KEY_INDEX_NAME,
    TABLE_NAME,
    get_connection,
    quote_identifier,
    resolve_natural_key_columns,
    table_exists,
)


def get_import_status() -> dict:
    with get_connection() as conn:
        manifest_exists = table_exists(conn, MANIFEST_TABLE)
        records_exists = table_exists(conn, TABLE_NAME)

        status_counts: dict[str, int] = {}
        error_reasons = []
        recent_errors = []
        manifest_total = 0
        last_imported_at = None

        if manifest_exists:
            status_rows = conn.execute(
                f"""
                SELECT COALESCE(status, 'unknown') AS status, COUNT(*) AS count
                FROM {quote_identifier(MANIFEST_TABLE)}
                GROUP BY COALESCE(status, 'unknown')
                ORDER BY count DESC
                """
            ).fetchall()
            status_counts = {row["status"]: row["count"] for row in status_rows}
            manifest_total = sum(status_counts.values())
            last_row = conn.execute(
                f"""
                SELECT MAX(last_imported_at) AS last_imported_at
                FROM {quote_identifier(MANIFEST_TABLE)}
                """
            ).fetchone()
            last_imported_at = last_row["last_imported_at"] if last_row else None
            error_reasons = [
                dict(row)
                for row in conn.execute(
                    f"""
                    SELECT COALESCE(error_message, '') AS error, COUNT(*) AS count
                    FROM {quote_identifier(MANIFEST_TABLE)}
                    WHERE status = 'error'
                    GROUP BY COALESCE(error_message, '')
                    ORDER BY count DESC
                    LIMIT 20
                    """
                ).fetchall()
            ]
            recent_errors = [
                dict(row)
                for row in conn.execute(
                    f"""
                    SELECT source_file_name, error_message, last_imported_at
                    FROM {quote_identifier(MANIFEST_TABLE)}
                    WHERE status = 'error'
                    ORDER BY id DESC
                    LIMIT 20
                    """
                ).fetchall()
            ]

        records_total = 0
        duplicate_groups = 0
        natural_key_columns = []
        missing_natural_key_columns = []
        if records_exists:
            records_total = conn.execute(
                f"SELECT COUNT(*) AS count FROM {quote_identifier(TABLE_NAME)}"
            ).fetchone()["count"]
            natural_key_columns, missing_natural_key_columns = resolve_natural_key_columns(conn)
            if not missing_natural_key_columns:
                group_by_sql = ", ".join(quote_identifier(column) for column in natural_key_columns)
                duplicate_groups = conn.execute(
                    f"""
                    SELECT COUNT(*) AS count
                    FROM (
                        SELECT {group_by_sql}, COUNT(*) AS row_count
                        FROM {quote_identifier(TABLE_NAME)}
                        GROUP BY {group_by_sql}
                        HAVING COUNT(*) > 1
                    )
                    """
                ).fetchone()["count"]

        unique_index_exists = bool(
            conn.execute(
                """
                SELECT COUNT(*) AS count
                FROM sqlite_master
                WHERE type = 'index' AND name = ?
                """,
                (NATURAL_KEY_INDEX_NAME,),
            ).fetchone()["count"]
        )

    return {
        "ok": True,
        "manifest_total_files": manifest_total,
        "status_counts": status_counts,
        "success_files": status_counts.get("success", 0),
        "error_files": status_counts.get("error", 0),
        "records_total": records_total,
        "natural_key_unique_index_exists": unique_index_exists,
        "natural_key_columns": natural_key_columns,
        "missing_natural_key_columns": missing_natural_key_columns,
        "duplicate_natural_key_groups": duplicate_groups,
        "last_imported_at": last_imported_at,
        "error_reasons": error_reasons,
        "recent_errors": recent_errors,
        "notes": [
            "PowerShell reported file count is the number of CSV files scanned or uploaded.",
            "UI total is SQLite assay record rows after backend validation and natural-key deduplication.",
            "Backend can report files that reached EC2; HTTP/network failures that never reached EC2 are only visible in PowerShell logs.",
        ],
    }
