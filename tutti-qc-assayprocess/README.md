# Tutti QC AssayProcess

Tutti QC AssayProcess 是獨立掛載在 `qc-web-ipqc` 底下的查詢系統。EC2 端使用 FastAPI、SQLite、React + Vite；Windows local 端使用 Python watcher 監控網路芳鄰資料夾，發現 `AssayProcess_YYYYMMDDHHMMSS.csv` 新增或變動後上傳到 EC2，由 backend 統一解析與入庫。

## 系統架構

- EC2 backend: FastAPI, SQLite, multipart CSV upload API, query API
- EC2 frontend: React + Vite, build 後由 Nginx 掛載在 `/tutti-assayprocess/`
- Local Windows watcher: Python watcher，initial scan 後常駐監控變更，只上傳 matching timestamp CSV

## SQLite DB 位置

```text
/home/ubuntu/qc-web-ipqc/tutti-qc-assayprocess/data/Tutti_QC_assayprocess.db
```

主要資料表：

- `assay_process_records`: 依 CSV header 動態建立欄位，所有 CSV 值以 TEXT 儲存
- `import_manifest`: 記錄每個來源檔案的 hash、size、mtime、匯入狀態與錯誤訊息

## EC2 Backend 安裝

```bash
cd /home/ubuntu/qc-web-ipqc/tutti-qc-assayprocess/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

## EC2 Backend 啟動

開發啟動：

```bash
cd /home/ubuntu/qc-web-ipqc/tutti-qc-assayprocess/backend
source .venv/bin/activate
uvicorn app:app --host 127.0.0.1 --port 8200
```

Backend 建議維持跑在 `127.0.0.1:8200`，由 Nginx 對外 proxy。

## EC2 Frontend 安裝

```bash
cd /home/ubuntu/qc-web-ipqc/tutti-qc-assayprocess/frontend
npm install
npm run dev
```

Vite 開發伺服器預設使用 port `5174`。

## EC2 Frontend Build

```bash
cd /home/ubuntu/qc-web-ipqc/tutti-qc-assayprocess/frontend
npm run build
```

Build 輸出路徑：

```text
/home/ubuntu/qc-web-ipqc/tutti-qc-assayprocess/frontend/dist
```

此 frontend 的 Vite `base` 已設定為：

```text
/tutti-assayprocess/
```

API base 已設定為：

```text
/api/assayprocess
```

## Local Python Watcher 使用方式

```powershell
cd local-watcher
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r .\requirements.txt
Copy-Item .\config.example.json .\config.json
notepad .\config.json
python .\watch_assayprocess.py
```

`config.json` 需要設定：

```json
{
  "watch_root": "\\\\fls341\\MBBU_FAB\\MB_QA\\Disc 首件檢查\\Tutti\\1. 生化盤",
  "upload_url": "https://52-192-28-39.sslip.io/api/assayprocess/upload-assay-process-csv",
  "manifest_path": "upload_manifest.json",
  "observer_mode": "polling",
  "polling_interval_seconds": 30,
  "stable_check_seconds": 2,
  "debounce_seconds": 5,
  "request_timeout_seconds": 120
}
```

Watcher 只負責監控與上傳；CSV 解析與資料庫寫入集中在 EC2 backend。檔名必須符合 `AssayProcess_YYYYMMDDHHMMSS.csv`，例如 `AssayProcess_20260505121541.csv`；`AssayProcess_merge.csv` 會被忽略。

若檔案位在資料夾名稱以 `建線` 結尾的路徑下，例如 `A建線`，watcher 會上傳 `baseline=true`；其他資料夾為 `baseline=false`。若要對既有資料補 baseline，請重新跑：

```powershell
python .\watch_assayprocess.py --once
```

backend 會用 natural key 去重，不會新增重複資料，並會更新既有資料的 `baseline` 欄位。

## API Endpoints

Health check:

```http
GET /api/health
```

取得 CSV headers:

```http
GET /api/headers
```

查詢資料:

```http
POST /api/query
Content-Type: application/json

{
  "logic": "AND",
  "conditions": [
    { "header": "Lot", "value": "A001" },
    { "header": "Marker", "value": "ALT" },
    { "header": "", "value": "" }
  ],
  "limit": 500,
  "offset": 0
}
```

上傳 AssayProcess CSV:

```http
POST /api/upload-assay-process-csv
Content-Type: multipart/form-data

file=<csv>
source_file=<full path>
source_file_name=<filename>
file_mtime=<mtime>
```

透過 Nginx 對外時，frontend 呼叫 `/api/assayprocess/*`，Nginx 會 proxy 到 backend 的 `/api/*`。

## Nginx Reverse Proxy 範例

```nginx
location /tutti-assayprocess/ {
    alias /home/ubuntu/qc-web-ipqc/tutti-qc-assayprocess/frontend/dist/;
    try_files $uri $uri/ /tutti-assayprocess/index.html;
}

location /api/assayprocess/ {
    proxy_pass http://127.0.0.1:8200/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

## systemd Service 範例

```ini
[Unit]
Description=Tutti QC AssayProcess FastAPI
After=network.target

[Service]
WorkingDirectory=/home/ubuntu/qc-web-ipqc/tutti-qc-assayprocess/backend
EnvironmentFile=/home/ubuntu/qc-web-ipqc/tutti-qc-assayprocess/backend/.env
ExecStart=/home/ubuntu/qc-web-ipqc/tutti-qc-assayprocess/backend/.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8200
Restart=always
RestartSec=5
User=ubuntu

[Install]
WantedBy=multi-user.target
```

安裝後可執行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tutti-qc-assayprocess
sudo systemctl status tutti-qc-assayprocess
```
