import hashlib
from datetime import datetime, timezone

from csv_loader import parse_assay_process_csv
from db import (
    MANIFEST_TABLE,
    TABLE_NAME,
    ensure_record_columns,
    ensure_natural_key_unique_index,
    get_connection,
    init_db,
    quote_identifier,
    upsert_manifest,
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def import_assay_process_csv(
    *,
    content: bytes,
    source_file: str,
    source_file_name: str,
    file_mtime: str,
    baseline: str = "false",
) -> dict:
    init_db()
    baseline_value = "true" if str(baseline).strip().lower() == "true" else "false"
    file_hash = hashlib.sha256(content).hexdigest()
    file_size = len(content)
    imported_at = _utc_now_iso()

    try:
        with get_connection() as conn:
            manifest = conn.execute(
                f"""
                SELECT file_hash, file_size, baseline, status
                FROM {quote_identifier(MANIFEST_TABLE)}
                WHERE source_file = ?
                """,
                (source_file,),
            ).fetchone()

            if (
                manifest
                and manifest["file_hash"] == file_hash
                and manifest["file_size"] == file_size
                and (manifest["baseline"] or "false") == baseline_value
                and manifest["status"] == "success"
            ):
                return {
                    "ok": True,
                    "status": "skipped",
                    "source_file_name": source_file_name,
                    "reason": "unchanged",
                }

            headers, records = parse_assay_process_csv(content)
            ensure_record_columns(conn, headers)
            natural_key = ensure_natural_key_unique_index(conn, headers)

            metadata_columns = [
                "source_file",
                "source_file_name",
                "source_file_mtime",
                "source_file_hash",
                "baseline",
                "imported_at",
                "row_index",
            ]
            insert_columns = metadata_columns + headers
            placeholders = ", ".join("?" for _ in insert_columns)
            column_sql = ", ".join(quote_identifier(column) for column in insert_columns)
            insert_sql = (
                f"INSERT OR IGNORE INTO {quote_identifier(TABLE_NAME)} ({column_sql}) "
                f"VALUES ({placeholders})"
            )

            rows_inserted = 0
            rows_ignored = 0
            for index, record in enumerate(records, start=1):
                values = [
                    source_file,
                    source_file_name,
                    file_mtime,
                    file_hash,
                    baseline_value,
                    imported_at,
                    index,
                ]
                values.extend(record.get(header, "") for header in headers)
                cursor = conn.execute(insert_sql, values)
                if cursor.rowcount == 1:
                    rows_inserted += 1
                else:
                    rows_ignored += 1
                    if natural_key["enabled"]:
                        update_existing_record_baseline(
                            conn,
                            natural_key["resolved_columns"],
                            record,
                            baseline_value,
                        )

            upsert_manifest(
                conn,
                source_file=source_file,
                source_file_name=source_file_name,
                file_mtime=file_mtime,
                file_size=file_size,
                file_hash=file_hash,
                baseline=baseline_value,
                last_imported_at=imported_at,
                status="success",
                error_message=None,
            )

        return {
            "ok": True,
            "status": "imported",
            "source_file_name": source_file_name,
            "rows_read": len(records),
            "rows_inserted": rows_inserted,
            "rows_ignored": rows_ignored,
            "columns": len(headers),
            "natural_key_enabled": natural_key["enabled"],
            "missing_natural_key_columns": natural_key["missing_columns"],
            "baseline": baseline_value,
        }
    except Exception as exc:
        error_message = str(exc)
        with get_connection() as conn:
            upsert_manifest(
                conn,
                source_file=source_file,
                source_file_name=source_file_name,
                file_mtime=file_mtime,
                file_size=file_size,
                file_hash=file_hash,
                baseline=baseline_value,
                last_imported_at=imported_at,
                status="error",
                error_message=error_message,
            )
        return {
            "ok": False,
            "status": "error",
            "source_file_name": source_file_name,
            "error": error_message,
        }


def update_existing_record_baseline(
    conn,
    natural_key_columns: list[str],
    record: dict[str, str],
    baseline_value: str,
) -> None:
    where_clauses = []
    where_params: list[str] = []
    for column in natural_key_columns:
        where_clauses.append(f"{quote_identifier(column)} = ?")
        where_params.append(record.get(column, ""))

    if not where_clauses:
        return

    conn.execute(
        f"""
        UPDATE {quote_identifier(TABLE_NAME)}
        SET {quote_identifier("baseline")} = ?
        WHERE {" AND ".join(where_clauses)}
        """,
        [baseline_value, *where_params],
    )
