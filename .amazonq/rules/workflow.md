# 開發部署工作流程規則

## 修改後必要步驟

### 修改 server 程式碼（server/ 目錄）
修改 server/routes/*.js 或 server/index.js 後 **必須重啟 server**：
```bash
pkill -f "node.*server/index.js" 2>/dev/null
cd /home/ubuntu/qc-web-ipqc/server && nohup node index.js > /tmp/server.log 2>&1 &
sleep 2 && tail -3 /tmp/server.log
```

### 修改前端程式碼（src/ 目錄）
修改 src/**/*.tsx 或 src/**/*.ts 後 **必須 build**：
```bash
cd /home/ubuntu/qc-web-ipqc && npm run build
```
注意：
- `public/assets/` 內的檔案（如 year-filter-patched.js）會自動複製到 dist/
- build 後 dist/ 的 JS 檔名會變（hash），Vite 自動更新 index.html 引用

### 修改完成後必須用 Playwright 測試驗證
```bash
cd /home/ubuntu/qc-web-ipqc && npx playwright test tests/ --reporter=line
```
- 所有測試必須通過才算完成
- 新功能要加對應的測試到 tests/*.spec.cjs
- 測試檔案用 .cjs 副檔名（因為 package.json 是 type:module）

## 架構資訊

### 服務配置
- **API server**: Node.js Express, port 3201, 路徑 `/home/ubuntu/qc-web-ipqc/server/`
- **前端**: Vite build → `/home/ubuntu/qc-web-ipqc/dist/`
- **Nginx**: port 80, `/qc-web/` → dist/, `/qc-web-api/` → proxy to :3201
- **DB**: SQLite `/home/ubuntu/ipqcdrybeads.db`

### 前端外掛腳本
- `public/assets/year-filter-patched.js` — KPI 卡片互動（NG/異常 modal）
- 透過 `window.__navigateToQcLot(marker, sheet)` 與 React App 溝通

### 共享狀態
- QC管理 ↔ IPQC工作台 透過 App 層級 `sharedLot` state 雙向同步
- 使用 `selfTriggered` ref 防止無限迴圈

### Excel 匯入規則
- 檔名格式：`年份-beadname.xlsx`（如 `2025-QBi-ALB.xlsx`）
- 年份 regex：`/^20[2-9]\d-/`（2020~2099）
- QBi-X 轉換：`QBi-ALB` → `QALB`
- 重複處理：bead_name + sheet_name 重複 → 先刪再新增
- chunk size: 2 檔/批（QBi 檔案 7~13MB）
- nginx client_max_body_size: 200M

### 測試檔案
- `tests/kpi-nav.spec.cjs` — Dashboard year filter、NG/異常卡片導航、QC↔IPQC 同步
- `tests/sync-manual.spec.cjs` — 手動選擇同步、來回切換保留 lot

---
**最後更新**: 2025-04-25
