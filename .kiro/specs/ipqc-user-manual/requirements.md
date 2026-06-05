# Requirements Document

## Introduction

本文件定義 qc-web-ipqc 系統使用說明網站（User Manual）的需求。該使用說明以靜態 HTML 網站形式部署於現有 EC2 主機的 `/home/ubuntu/qc-web-ipqc/usermanu` 目錄下，涵蓋 IPQC 管理儀表板、Tutti Beads Pre Assignment 管理、建線管理（PC 端與手機端）、以及 Skyla RD 建線等功能模組的操作說明。網站內容包含操作截圖（透過 Playwright 擷取）與工作流程圖。

## Glossary

- **Manual_Site**: 使用說明靜態 HTML 網站，部署於 `/home/ubuntu/qc-web-ipqc/usermanu`
- **Screenshot_Generator**: 使用 Playwright 自動擷取應用程式操作畫面截圖的工具
- **Workflow_Diagram**: 以圖片形式呈現操作流程的視覺化圖表
- **Navigation_System**: 使用說明網站中的目錄導覽系統，提供章節間快速跳轉
- **Section**: 使用說明中的獨立功能模組章節
- **EC2_Host**: 目前部署 qc-web-ipqc 應用程式的 AWS EC2 主機
- **IPQC_Dashboard**: IPQC 管理儀表板，包含表一（Dried Beads 檢驗）與表二（OD 化學特性分析）
- **Tutti_Module**: Tutti Beads Pre Assignment Management 功能模組
- **BuildLine_PC**: 建線管理 PC 端功能，URL 為 `/qc-web/pre-assignment/build-lines`
- **BuildLine_Mobile**: 手機端建立測試資料功能，URL 為 `/qc-web/pre-assignment/tutti-scan`
- **RD_Mobile**: Skyla RD 建線手機端功能，包含建線與曲線擬合，URL 為 `/qc-web/pre-assignment/rd-mobile`

## Requirements

### Requirement 1: 網站專案結構

**User Story:** As a 開發人員, I want 使用說明網站有清晰的專案結構, so that 可以方便維護與擴充內容。

#### Acceptance Criteria

1. THE Manual_Site SHALL 以獨立靜態 HTML 專案形式存在於 `/home/ubuntu/qc-web-ipqc/usermanu` 目錄下
2. THE Manual_Site SHALL 包含 `index.html` 作為首頁入口，且該檔案為結構完整的 HTML5 文件（包含 DOCTYPE 宣告、html、head、body 標籤）
3. THE Manual_Site SHALL 將截圖圖片存放於 `screenshots/` 子目錄
4. THE Manual_Site SHALL 將工作流程圖存放於 `images/` 子目錄
5. THE Manual_Site SHALL 將 CSS 樣式檔存放於 `css/` 子目錄
6. THE Manual_Site SHALL 支援使用者透過瀏覽器以 `file://` 協定直接開啟 `index.html` 時，頁面能正常顯示內容與樣式，無需任何伺服器環境
7. THE Manual_Site SHALL 在所有 HTML 檔案中使用相對路徑引用內部資源（CSS、圖片），不得使用絕對路徑或外部 CDN 連結

### Requirement 2: 導覽系統

**User Story:** As a 使用者, I want 使用說明網站有清楚的導覽目錄, so that 可以快速找到需要的操作說明。

#### Acceptance Criteria

1. THE Navigation_System SHALL 在首頁顯示所有功能模組的目錄連結，且每個連結包含該模組的名稱
2. WHEN 使用者點擊目錄連結, THE Navigation_System SHALL 於 2 秒內跳轉至對應的 Section 頁面
3. THE Navigation_System SHALL 在每個 Section 頁面提供返回首頁的連結
4. THE Navigation_System SHALL 在每個 Section 頁面提供前後章節的導覽連結；若為第一個章節則不顯示「上一章」連結，若為最後一個章節則不顯示「下一章」連結
5. THE Manual_Site SHALL 支援響應式設計，在最小視窗寬度 320px（手機）至 1920px（桌面）範圍內，所有導覽連結皆可見且可點擊，文字不溢出容器
6. IF 使用者點擊的目錄連結對應之 Section 頁面不存在, THEN THE Navigation_System SHALL 顯示錯誤提示訊息並保留使用者於當前頁面

### Requirement 3: IPQC 管理儀表板說明

**User Story:** As a IPQC 操作人員, I want 了解 Dashboard 與管理表的操作方式, so that 可以正確使用系統進行品質管控。

#### Acceptance Criteria

1. THE Manual_Site SHALL 包含 IPQC Dashboard 總覽功能的操作說明，涵蓋導覽入口、KPI 摘要卡片說明及資料更新方式
2. THE Manual_Site SHALL 包含「表一 · Dried Beads 檢驗」的操作說明，涵蓋資料檢視、搜尋與篩選功能
3. THE Manual_Site SHALL 包含「表二 · OD 化學特性分析」的操作說明，涵蓋 CSV 資料匯入、OD 數值檢視與濃度轉換分析功能
4. THE Manual_Site SHALL 包含 IPQC 工作站資料匯入操作的步驟說明，每個步驟須包含操作動作描述與預期結果，並說明支援的匯入檔案格式
5. WHEN 說明涉及操作步驟, THE Manual_Site SHALL 為每個獨立操作步驟搭配至少 1 張對應的操作截圖
6. THE Screenshot_Generator SHALL 使用 Playwright 以 1920x1080 像素視窗尺寸擷取 IPQC_Dashboard 各功能畫面的截圖
7. IF 資料匯入操作失敗, THEN THE Manual_Site SHALL 包含錯誤處理說明，描述常見錯誤情境及對應的排除方式

### Requirement 4: Tutti Beads Pre Assignment Management 說明

**User Story:** As a 生產管理人員, I want 了解 Tutti Beads 預建線管理的操作方式, so that 可以正確匯入與管理預建線資料。

#### Acceptance Criteria

1. THE Manual_Site SHALL 包含 Tutti_Module 資料匯入操作的步驟說明，涵蓋以下流程：開啟匯入介面、填寫必填欄位（Marker）與選填欄位（工單號、Lot d/D/u、生產日期、填藥期限、生產數量）、上傳 Excel 檔案或手動輸入 OD 值、執行匯入、以及確認（confirm）匯入結果
2. THE Manual_Site SHALL 說明匯入檔案的格式要求：檔案格式為 .xlsx 或 .xls，檔案內須包含 L1、L2、N1、N3 等 OD 讀數標頭，並提供可下載的範本檔案連結
3. THE Manual_Site SHALL 包含匯入失敗的處理說明，至少涵蓋以下 3 種情境：未填寫 Marker 名稱、上傳非 xlsx/xls 格式檔案、以及 csassign 中查無對應 Marker 濃度資料導致回歸線無法計算
4. WHEN 說明涉及操作步驟, THE Manual_Site SHALL 搭配對應的操作截圖，每個步驟至少 1 張截圖，且每張截圖須標註該步驟對應的 UI 區域
5. THE Screenshot_Generator SHALL 使用 Playwright 擷取 Tutti_Module 匯入操作流程的截圖，至少涵蓋以下畫面：匯入 Modal 開啟狀態、欄位填寫完成狀態、檔案上傳完成狀態、以及匯入成功後的列表顯示狀態

### Requirement 5: 建線管理 PC 端說明

**User Story:** As a 建線管理人員, I want 了解 PC 端建線管理的操作方式, so that 可以在電腦上建立測試資料。

#### Acceptance Criteria

1. THE Manual_Site SHALL 包含 BuildLine_PC 功能的操作說明，涵蓋以下範圍：查詢條件設定（panel_name、analyze_date）、建線結果檢視、以及「建線送 RD」提交操作
2. THE Manual_Site SHALL 說明如何透過 URL `https://52-192-28-39.sslip.io/qc-web/pre-assignment/build-lines` 存取 PC 端建線功能
3. THE Manual_Site SHALL 包含建立測試資料的步驟說明，至少涵蓋：設定查詢條件、執行查詢、檢視建線結果、以及點擊「建線送 RD」將資料提交至 RD 待建線清單
4. WHEN 說明涉及操作步驟, THE Manual_Site SHALL 搭配對應的操作截圖，每個步驟至少包含 1 張截圖
5. THE Manual_Site SHALL 包含操作流程的 Workflow_Diagram，呈現從存取頁面、設定查詢條件、檢視結果到提交 RD 的完整流程
6. THE Screenshot_Generator SHALL 使用 Playwright 以 1920x1080 像素視窗尺寸擷取 BuildLine_PC 操作畫面的截圖
7. IF 「建線送 RD」提交成功或失敗, THEN THE Manual_Site SHALL 說明成功與失敗時的系統回饋訊息及對應處理方式

### Requirement 6: 手機端建立測試資料說明

**User Story:** As a 現場操作人員, I want 了解手機端建線掃描的操作方式, so that 可以在現場使用手機建立測試資料。

#### Acceptance Criteria

1. THE Manual_Site SHALL 包含 BuildLine_Mobile 功能的操作說明，涵蓋掃描流程的 6 個步驟：機器 QR 掃描、Position 選擇、工單 QR 掃描、Disk QR 掃描、資料確認、送出建立
2. THE Manual_Site SHALL 說明如何透過 URL `https://52-192-28-39.sslip.io/qc-web/pre-assignment/tutti-scan` 存取手機端功能
3. THE Manual_Site SHALL 包含手機掃描操作的步驟說明，每個步驟須說明操作目的、預期輸入（QR 格式或選項）、以及成功後的畫面變化
4. THE Manual_Site SHALL 說明手機端與 PC 端的操作差異，至少涵蓋：輸入方式差異（手機使用 QR 掃描，PC 使用表單輸入）、操作流程差異（手機為逐步引導式，PC 為單頁表單式）、以及適用場景差異（手機用於現場掃描，PC 用於辦公室管理）
5. WHEN 說明涉及操作步驟, THE Manual_Site SHALL 搭配對應的操作截圖，每個步驟至少 1 張截圖
6. THE Screenshot_Generator SHALL 使用 Playwright 擷取 BuildLine_Mobile 操作畫面的截圖，使用 375x812 像素的視窗尺寸
7. THE Manual_Site SHALL 包含錯誤處理說明，涵蓋 QR 解析失敗時的錯誤提示、手動輸入 QR 內容的替代操作方式、以及工單與 Disk 批號不一致時的處理方式

### Requirement 7: Skyla RD 建線說明

**User Story:** As a RD 研發人員, I want 了解 Skyla RD 手機建線與曲線擬合的操作方式, so that 可以正確執行建線與曲線擬合作業。

#### Acceptance Criteria

1. THE Manual_Site SHALL 包含 RD_Mobile 功能的操作說明，涵蓋以下範圍：任務列表檢視與篩選（待建線、已完成、全部）、Panel 任務群組檢視、Marker 任務詳情、直接寫入建線、曲線擬合調整
2. THE Manual_Site SHALL 說明如何透過 URL `https://52-192-28-39.sslip.io/qc-web/pre-assignment/rd-mobile` 存取 RD 建線功能
3. THE Manual_Site SHALL 包含手機建線操作的步驟說明，依序涵蓋：開啟任務列表、選擇 Panel 群組、選擇 Marker 任務、輸入工號驗證身份、執行直接寫入或進入曲線調整
4. THE Manual_Site SHALL 包含曲線擬合（Curve Fit）功能的操作說明，涵蓋：擬合圖檢視（Scatter Chart 與擬合線）、殘差分布圖檢視、資料點移除與恢復、確認寫入建線
5. THE Manual_Site SHALL 包含曲線擬合參數調整的說明，涵蓋：垂直位移（Shift，範圍 -0.5 至 0.5，步進 0.001）、旋轉（Rotation，範圍 -15° 至 15°，步進 0.1°）、重置調整操作
6. WHEN 說明涉及操作步驟, THE Manual_Site SHALL 搭配對應的操作截圖，每個主要視圖（任務列表、Panel 詳情、Marker 詳情、曲線調整）至少包含 1 張截圖
7. THE Manual_Site SHALL 包含 RD 建線操作流程的 Workflow_Diagram
8. THE Screenshot_Generator SHALL 使用 Playwright 擷取 RD_Mobile 操作畫面的截圖，視窗尺寸設定為 390×844 像素（模擬手機螢幕）
9. IF 曲線擬合的有效資料點少於 2 筆, THEN THE Manual_Site SHALL 說明系統將顯示「資料點不足」提示且無法進行擬合操作

### Requirement 8: 截圖自動化

**User Story:** As a 文件維護人員, I want 截圖可以自動化產生, so that 當系統更新時可以快速更新使用說明的截圖。

#### Acceptance Criteria

1. THE Screenshot_Generator SHALL 提供 Playwright 腳本自動擷取所有功能模組（Dashboard、DriedBeads、IPQC、MobileScan、Posts、RdMobile、Settings、Tutti）所需的操作畫面截圖
2. THE Screenshot_Generator SHALL 將截圖儲存為 PNG 格式，並輸出至專案內固定的截圖目錄
3. THE Screenshot_Generator SHALL 以「功能模組名稱_操作描述_序號」格式命名截圖檔案（例如：Dashboard_overview_01.png）
4. WHEN 擷取手機端畫面截圖, THE Screenshot_Generator SHALL 使用 375x812 像素的視窗尺寸
5. WHEN 擷取 PC 端畫面截圖, THE Screenshot_Generator SHALL 使用 1920x1080 像素的視窗尺寸
6. THE Screenshot_Generator SHALL 支援透過單一指令重新產生所有截圖，且完整執行時間不超過 120 秒
7. IF 截圖過程中目標頁面載入失敗或目標元素於 10 秒內未出現, THEN THE Screenshot_Generator SHALL 跳過該截圖並於執行結束時輸出失敗清單，列出未成功擷取的截圖名稱與失敗原因
8. WHEN 截圖指令執行完成, THE Screenshot_Generator SHALL 輸出摘要報告，包含成功截圖數量、失敗截圖數量及總執行時間

### Requirement 9: 部署配置

**User Story:** As a 系統管理員, I want 使用說明網站可以透過現有 EC2 主機提供服務, so that 使用者可以透過瀏覽器存取使用說明。

#### Acceptance Criteria

1. THE Manual_Site SHALL 部署於 EC2_Host 的 `/home/ubuntu/qc-web-ipqc/usermanu` 目錄
2. THE Manual_Site SHALL 可透過現有 Web Server 配置提供靜態檔案服務，包含 HTML、CSS、PNG 及 JPG 檔案類型
3. WHEN 使用者存取 `/qc-web/usermanu/` URL 路徑, THE Manual_Site SHALL 回應 `index.html` 作為預設文件，且回應時間不超過 3 秒
4. IF 使用者存取不存在的頁面, THEN THE Manual_Site SHALL 顯示 404 錯誤頁面，頁面包含錯誤說明文字及一個可點擊的返回首頁連結（指向 `/qc-web/usermanu/`）
5. THE Manual_Site SHALL 透過與主應用程式相同的 HTTPS 協定提供服務
