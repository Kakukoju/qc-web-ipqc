"""
Excel Auto-Uploader (Local Windows/Mac)
========================================
部署在有 SMB 存取權限的 local 端電腦，監控 Excel 資料夾並自動上傳到 QC Web Server。

功能:
  1. Watchdog — 檔案新增/修改時即時上傳 (debounce 5 秒)
  2. 定時全量掃描 — 每天指定時間全部重新上傳 (確保不遺漏)

用法:
  pip install watchdog requests schedule
  python excel_uploader.py

設定:
  修改下方 config 或建立 config.json 覆寫
"""

import os
import sys
import json
import time
import glob
import logging
import threading
from pathlib import Path
from datetime import datetime

import requests
import schedule
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# ─── Config ───────────────────────────────────────────────────────────────────

DEFAULT_CONFIG = {
    # 遠端 API
    "api_url": "https://52-192-28-39.sslip.io/qc-web-api/api/excel-import/upload-batch",

    # 監控的資料夾 (可多個)
    "watch_dirs": [
        r"\\fls341\MBBU_FAB\MB_QA\Dora\6.QBi Beads IPQC",
        r"\\fls341\MBBU_FAB\MB_QA\Dora\2.Disk A",
    ],

    # 定時全量上傳 (每天幾點執行, 24h 格式)
    "scheduled_time": "00:30",

    # Watchdog debounce 秒數 (同一檔案短時間多次修改只上傳一次)
    "debounce_seconds": 5,

    # 上傳 chunk size
    "chunk_size": 10,

    # 只處理當年度 (True) 或所有年度 (False)
    "current_year_only": True,

    # log 檔路徑
    "log_file": "excel_uploader.log",
}


def load_config():
    config = DEFAULT_CONFIG.copy()
    config_path = Path(__file__).parent / "config.json"
    if config_path.exists():
        with open(config_path, "r", encoding="utf-8") as f:
            config.update(json.load(f))
    return config


CONFIG = load_config()

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(CONFIG["log_file"], encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("excel_uploader")

# ─── Upload Logic ─────────────────────────────────────────────────────────────


def is_valid_xlsx(filepath: str) -> bool:
    """Check if file matches the expected YYYY-*.xlsx pattern."""
    name = os.path.basename(filepath)
    if name.startswith("~$"):
        return False
    if not name.endswith(".xlsx"):
        return False
    if CONFIG["current_year_only"]:
        year = str(datetime.now().year)
        return name.startswith(f"{year}-")
    # Accept any year pattern: 20XX-*.xlsx
    return bool(name[:4].isdigit() and name[4] == "-")


def upload_files(filepaths: list[str]) -> dict | None:
    """Upload a list of xlsx files to the API endpoint."""
    if not filepaths:
        return None

    url = CONFIG["api_url"]
    chunk_size = CONFIG["chunk_size"]
    total_result = {"total_files": 0, "imported_files": 0, "total_sheets": 0, "errors": []}

    for i in range(0, len(filepaths), chunk_size):
        chunk = filepaths[i : i + chunk_size]
        files_payload = []
        for fp in chunk:
            try:
                files_payload.append(("files", (os.path.basename(fp), open(fp, "rb"))))
            except OSError as e:
                log.warning(f"Cannot open {fp}: {e}")
                continue

        if not files_payload:
            continue

        try:
            resp = requests.post(url, files=files_payload, timeout=300)
            resp.raise_for_status()
            data = resp.json()
            total_result["total_files"] += data.get("total_files", 0)
            total_result["imported_files"] += data.get("imported_files", 0)
            total_result["total_sheets"] += data.get("total_sheets", 0)
            log.info(
                f"Chunk {i // chunk_size + 1}: uploaded {len(chunk)} files, "
                f"imported={data.get('imported_files', 0)}, sheets={data.get('total_sheets', 0)}"
            )
        except Exception as e:
            log.error(f"Upload failed for chunk {i // chunk_size + 1}: {e}")
            total_result["errors"].append(str(e))
        finally:
            for _, (_, fh) in files_payload:
                fh.close()

    return total_result


def collect_all_xlsx() -> list[str]:
    """Scan all watch_dirs and collect valid xlsx files."""
    files = []
    year = str(datetime.now().year)

    for watch_dir in CONFIG["watch_dirs"]:
        if not os.path.isdir(watch_dir):
            # Try appending year subdirectory
            for subdir in [year, f"{year}年度IPQC化學特性批次紀錄"]:
                candidate = os.path.join(watch_dir, subdir)
                if os.path.isdir(candidate):
                    watch_dir = candidate
                    break

        if not os.path.isdir(watch_dir):
            log.warning(f"Directory not accessible: {watch_dir}")
            continue

        for f in glob.glob(os.path.join(watch_dir, "*.xlsx")):
            if is_valid_xlsx(f):
                files.append(f)

        # Also check year subdirectories
        year_subdir = os.path.join(watch_dir, year)
        if os.path.isdir(year_subdir):
            for f in glob.glob(os.path.join(year_subdir, "*.xlsx")):
                if is_valid_xlsx(f):
                    files.append(f)

    return list(set(files))


# ─── Scheduled Full Upload ────────────────────────────────────────────────────


def scheduled_full_upload():
    """Full scan + upload all matching files."""
    log.info("=== Scheduled full upload started ===")
    files = collect_all_xlsx()
    if not files:
        log.info("No matching xlsx files found.")
        return
    log.info(f"Found {len(files)} files to upload")
    result = upload_files(files)
    log.info(f"=== Scheduled upload done: {result} ===")


# ─── Watchdog Handler ─────────────────────────────────────────────────────────


class ExcelChangeHandler(FileSystemEventHandler):
    """Watches for new/modified xlsx files and uploads after debounce."""

    def __init__(self):
        super().__init__()
        self._pending: dict[str, float] = {}  # filepath → timestamp
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None

    def _schedule_flush(self):
        if self._timer:
            self._timer.cancel()
        self._timer = threading.Timer(CONFIG["debounce_seconds"], self._flush)
        self._timer.daemon = True
        self._timer.start()

    def _flush(self):
        with self._lock:
            now = time.time()
            ready = [
                fp
                for fp, ts in self._pending.items()
                if now - ts >= CONFIG["debounce_seconds"]
            ]
            for fp in ready:
                del self._pending[fp]

        if not ready:
            return

        # Filter: only valid xlsx that still exist
        valid = [fp for fp in ready if os.path.isfile(fp) and is_valid_xlsx(fp)]
        if not valid:
            return

        log.info(f"[Watchdog] Uploading {len(valid)} changed file(s): {[os.path.basename(f) for f in valid]}")
        result = upload_files(valid)
        log.info(f"[Watchdog] Upload result: {result}")

    def on_created(self, event):
        if event.is_directory:
            return
        self._handle(event.src_path)

    def on_modified(self, event):
        if event.is_directory:
            return
        self._handle(event.src_path)

    def _handle(self, filepath: str):
        if not is_valid_xlsx(filepath):
            return
        with self._lock:
            self._pending[filepath] = time.time()
        self._schedule_flush()


# ─── Main ─────────────────────────────────────────────────────────────────────


def main():
    log.info("=" * 60)
    log.info("Excel Auto-Uploader starting")
    log.info(f"  API: {CONFIG['api_url']}")
    log.info(f"  Watch dirs: {CONFIG['watch_dirs']}")
    log.info(f"  Scheduled time: {CONFIG['scheduled_time']}")
    log.info("=" * 60)

    # 1. Setup scheduled job
    schedule.every().day.at(CONFIG["scheduled_time"]).do(scheduled_full_upload)

    # 2. Setup watchdog observers
    handler = ExcelChangeHandler()
    observer = Observer()
    watched = 0
    for watch_dir in CONFIG["watch_dirs"]:
        if os.path.isdir(watch_dir):
            observer.schedule(handler, watch_dir, recursive=True)
            log.info(f"[Watchdog] Watching: {watch_dir}")
            watched += 1
        else:
            log.warning(f"[Watchdog] Cannot watch (not accessible): {watch_dir}")

    if watched > 0:
        observer.start()
        log.info(f"[Watchdog] Started monitoring {watched} directories")
    else:
        log.warning("[Watchdog] No directories accessible — only scheduled mode active")

    # 3. Run initial upload on startup
    log.info("Running initial full upload...")
    scheduled_full_upload()

    # 4. Main loop
    try:
        while True:
            schedule.run_pending()
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("Shutting down...")
        if watched > 0:
            observer.stop()
            observer.join()


if __name__ == "__main__":
    main()
