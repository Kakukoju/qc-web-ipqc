import os
import sqlite3
import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable

from dotenv import load_dotenv

load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "Tutti_QC_assayprocess.db"
DB_PATH = Path(os.getenv("DB_PATH", str(DEFAULT_DB_PATH)))
TABLE_NAME = os.getenv("TABLE_NAME", "assay_process_records")
MANIFEST_TABLE = "import_manifest"
NATURAL_KEY_INDEX_NAME = "uq_assay_process_natural_key"

logger = logging.getLogger(__name__)

METADATA_COLUMNS = [
    "id",
    "source_file",
    "source_file_name",
    "source_file_mtime",
    "source_file_hash",
    "imported_at",
    "row_index",
]

NATURAL_KEY_COLUMN_ALIASES = [
    ("panel name", ("panel name", "panel_name")),
    ("analyze date", ("analyze date", "analyze_date")),
    ("analyze time", ("analyze time", "analyze_time")),
    ("sample type", ("sample type", "sample_type")),
    ("Species", ("Species",)),
    ("patient id", ("patient id", "patient_id")),
    ("F.W.", ("F.W.",)),
    ("Production Date", ("Production Date",)),
    ("analyze item", ("analyze item", "analyze_item")),
    ("Test Zone", ("Test Zone",)),
    ("Test Well", ("Test Well",)),
]


def quote_identifier(identifier: str) -> str:
    if not isinstance(identifier, str) or identifier == "":
        raise ValueError("SQLite identifier cannot be empty")
    return '"' + identifier.replace('"', '""') + '"'


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def get_connection():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_connection() as conn:
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {quote_identifier(MANIFEST_TABLE)} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_file TEXT UNIQUE,
                source_file_name TEXT,
                file_mtime TEXT,
                file_size INTEGER,
                file_hash TEXT,
                baseline TEXT,
                last_imported_at TEXT,
                status TEXT,
                error_message TEXT
            )
            """
        )
        _ensure_table_column(conn, MANIFEST_TABLE, "baseline", "TEXT")
        if table_exists(conn, TABLE_NAME):
            _ensure_table_column(conn, TABLE_NAME, "baseline", "TEXT DEFAULT 'false'")
            _ensure_table_column(conn, TABLE_NAME, "baseline_equation", "TEXT")
            _ensure_table_column(conn, TABLE_NAME, "mfg_lot_no", "TEXT")
            _ensure_table_column(conn, TABLE_NAME, "analyzt_item_lot", "TEXT")
            _ensure_table_column(conn, TABLE_NAME, "change_baseline", "INTEGER DEFAULT 0")
            _ensure_table_column(conn, TABLE_NAME, "device_sn", "TEXT")


def _ensure_table_column(
    conn: sqlite3.Connection, table_name: str, column_name: str, column_sql_type: str
) -> None:
    existing = set(get_table_columns(conn, table_name))
    if column_name not in existing:
        conn.execute(
            f"ALTER TABLE {quote_identifier(table_name)} "
            f"ADD COLUMN {quote_identifier(column_name)} {column_sql_type}"
        )


def table_exists(conn: sqlite3.Connection, table_name: str = TABLE_NAME) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def create_records_table(conn: sqlite3.Connection, headers: Iterable[str]) -> None:
    columns_sql = [
        "id INTEGER PRIMARY KEY AUTOINCREMENT",
        "source_file TEXT",
        "source_file_name TEXT",
        "source_file_mtime TEXT",
        "source_file_hash TEXT",
        "baseline TEXT DEFAULT 'false'",
        "imported_at TEXT",
        "row_index INTEGER",
    ]
    columns_sql.extend(f"{quote_identifier(header)} TEXT" for header in headers)
    conn.execute(
        f"CREATE TABLE IF NOT EXISTS {quote_identifier(TABLE_NAME)} ({', '.join(columns_sql)})"
    )


def get_table_columns(conn: sqlite3.Connection, table_name: str = TABLE_NAME) -> list[str]:
    if not table_exists(conn, table_name):
        return []
    rows = conn.execute(f"PRAGMA table_info({quote_identifier(table_name)})").fetchall()
    return [row["name"] for row in rows]


def get_data_headers(conn: sqlite3.Connection) -> list[str]:
    columns = get_table_columns(conn, TABLE_NAME)
    metadata = set(METADATA_COLUMNS)
    return [column for column in columns if column not in metadata]


def ensure_record_columns(conn: sqlite3.Connection, headers: list[str]) -> None:
    if not table_exists(conn, TABLE_NAME):
        create_records_table(conn, headers)
        return

    existing = set(get_table_columns(conn, TABLE_NAME))
    for header in headers:
        if header not in existing:
            conn.execute(
                f"ALTER TABLE {quote_identifier(TABLE_NAME)} "
                f"ADD COLUMN {quote_identifier(header)} TEXT"
            )
            existing.add(header)


def _normalize_column_name(column: str) -> str:
    return column.replace("_", " ").strip().casefold()


def _resolve_natural_key_columns_from(
    available_columns: Iterable[str],
) -> tuple[list[str], list[str]]:
    exact_columns = set(available_columns)
    normalized_columns = {_normalize_column_name(column): column for column in exact_columns}
    resolved_columns: list[str] = []
    missing_columns: list[str] = []

    for requested_name, aliases in NATURAL_KEY_COLUMN_ALIASES:
        resolved = None
        for alias in aliases:
            if alias in exact_columns:
                resolved = alias
                break
            normalized = _normalize_column_name(alias)
            if normalized in normalized_columns:
                resolved = normalized_columns[normalized]
                break

        if resolved is None:
            missing_columns.append(requested_name)
        else:
            resolved_columns.append(resolved)

    return resolved_columns, missing_columns


def resolve_natural_key_columns(conn: sqlite3.Connection) -> tuple[list[str], list[str]]:
    return _resolve_natural_key_columns_from(get_table_columns(conn, TABLE_NAME))


def remove_duplicate_natural_key_records(
    conn: sqlite3.Connection, natural_key_columns: list[str]
) -> int:
    if not natural_key_columns:
        return 0

    before = conn.total_changes
    group_by_sql = ", ".join(quote_identifier(column) for column in natural_key_columns)
    conn.execute(
        f"""
        DELETE FROM {quote_identifier(TABLE_NAME)}
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM {quote_identifier(TABLE_NAME)}
            GROUP BY {group_by_sql}
        )
        """
    )
    return conn.total_changes - before


def ensure_natural_key_unique_index(
    conn: sqlite3.Connection, import_headers: list[str] | None = None
) -> dict:
    resolved_columns, table_missing_columns = resolve_natural_key_columns(conn)
    import_missing_columns: list[str] = []
    if import_headers is not None:
        _, import_missing_columns = _resolve_natural_key_columns_from(import_headers)

    if table_missing_columns:
        logger.warning(
            "Skip natural key unique index; missing columns: %s",
            ", ".join(table_missing_columns),
        )
        return {
            "enabled": False,
            "missing_columns": table_missing_columns,
            "resolved_columns": resolved_columns,
            "duplicates_removed": 0,
        }

    duplicates_removed = remove_duplicate_natural_key_records(conn, resolved_columns)
    if duplicates_removed:
        logger.info("Removed %s duplicate natural key records", duplicates_removed)

    index_columns_sql = ", ".join(quote_identifier(column) for column in resolved_columns)
    conn.execute(
        f"""
        CREATE UNIQUE INDEX IF NOT EXISTS {quote_identifier(NATURAL_KEY_INDEX_NAME)}
        ON {quote_identifier(TABLE_NAME)} ({index_columns_sql})
        """
    )
    if import_missing_columns:
        logger.warning(
            "Natural key index exists, but current import is missing columns: %s",
            ", ".join(import_missing_columns),
        )

    return {
        "enabled": not import_missing_columns,
        "missing_columns": import_missing_columns,
        "resolved_columns": resolved_columns,
        "duplicates_removed": duplicates_removed,
    }


def upsert_manifest(
    conn: sqlite3.Connection,
    *,
    source_file: str,
    source_file_name: str,
    file_mtime: str,
    file_size: int,
    file_hash: str,
    baseline: str,
    last_imported_at: str,
    status: str,
    error_message: str | None,
) -> None:
    conn.execute(
        f"""
        INSERT INTO {quote_identifier(MANIFEST_TABLE)}
            (source_file, source_file_name, file_mtime, file_size, file_hash,
             baseline, last_imported_at, status, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_file) DO UPDATE SET
            source_file_name = excluded.source_file_name,
            file_mtime = excluded.file_mtime,
            file_size = excluded.file_size,
            file_hash = excluded.file_hash,
            baseline = excluded.baseline,
            last_imported_at = excluded.last_imported_at,
            status = excluded.status,
            error_message = excluded.error_message
        """,
        (
            source_file,
            source_file_name,
            file_mtime,
            file_size,
            file_hash,
            baseline,
            last_imported_at,
            status,
            error_message,
        ),
    )
