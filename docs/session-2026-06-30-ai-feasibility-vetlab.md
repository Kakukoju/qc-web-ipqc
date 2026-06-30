# Session 2026-06-30: AI Feasibility + Vet-Lab Spec 統一

## 概要

本次 session 為 RD Mobile 建線流程加入 AI 可行性分析，並統一 PC 建線管理頁面的 TEa/Bias/CV 規格來源為 vet-lab catalog DB。

---

## 1. RD Mobile — AI 可行性分析

### 新增功能

當 RD 在曲線調整頁面切換到「🧠 AI分析」tab 時，自動執行：

1. **Reference Range 解析度檢查** — 光學解析度 × slope 是否足以解析 reference range
2. **TEa 規格檢查** — 每個 control level 的 |Bias| + 2×CV ≤ TEa
3. **AI 分析**（不合格時觸發）— 呼叫 vet-lab AI gateway 產出 pattern analysis + recommended actions
4. **AI Auto-Fitting** — 迭代式讓 AI 建議移除離差點，直到 TEa 通過或收斂

### 新增檔案

| 檔案 | 說明 |
|------|------|
| `server/routes/aiFeasibility.js` | POST `/ai-feasibility-analysis` + POST `/ai-auto-fit` + GET `/vetlab-spec/:analyzeItem` |
| `src/api/aiFeasibility.ts` | Frontend API client (typed interfaces) |
| `src/components/RdMobile/AiFeasibilityPanel.tsx` | AI 分析 UI 組件，mount 時自動執行 |

### 修改檔案

| 檔案 | 變更 |
|------|------|
| `server/index.js` | 註冊 aiFeasibility routes |
| `src/components/RdMobile/CurveFitAdjust.tsx` | 新增 🧠 AI分析 tab + 光學解析度 input (預設 0.001 OD) |

---

## 2. PC 建線管理 — 統一 TEa 規格來源

### 改動邏輯

**之前**：TEa/CV/Bias 從 `bead_ipqc_spec.db`（Qbi source）取得

**之後**：統一使用 vet-lab catalog DB (`vet_lab_spec.db`)，優先序：

1. **CLIA** (regulatory) — 有 CLIA 就用 CLIA
2. **沒有 CLIA → 取最小 TEa**，來源包括：
   - EFLM-BV (biological variation)
   - Species References (ASVCP)
   - Analyzer Catalog (manufacturer)
3. **Qbi** (legacy fallback) — 以上都沒有才用

### Qbi Marker 正規化

`QALB-A` → `ALB`、`QCre-d` → `CRE`、`Qbi-ALB` → `ALB`

自動 strip Q prefix + reagent suffix，透過 `_normalize_qbi_marker()` 和 `QBI_MARKER_MAP` 反查。

### 修改檔案

| 檔案 | 變更 |
|------|------|
| `tutti-qc-assayprocess/backend/all_batch_service.py` | 新增 `_fetch_vetlab_spec()` + 動態 OD Q1/Q3 |
| `tutti-qc-assayprocess/backend/baseline_service.py` | `EXCLUDED_BUILD_LINE_MARKERS` 加入 `"CRE"` |

### Pre-assignment 端

| 檔案 | 變更 |
|------|------|
| `src/routes/spec.ts` | `/api/spec/lookup/:beadName` 改為先查 vet-lab (port 3201)，再 fallback RDS |
| `pc/src/components/ErrorMetricsPanel.tsx` | N3 OD range 支援 + OD 不計入 PASS/FAIL + 3 位小數 + 0.001 容差 |
| `pc/src/utils/metricsCalculator.ts` | `judgeOdRange` 加入 0.001 tolerance |
| `src/services/buildLineCandidateService.ts` | `EXCLUDED_MARKERS` 加入 `CRE` |

---

## 3. OD 範圍 — 動態 Q1~Q3

### 規則

- OD 範圍 = 該 marker 所有 baseline OD 資料的 **Q1（25th percentile）~ Q3（75th percentile）**
- 最少需要 2 筆資料，否則 fallback 到 static spec
- **OD 不計入 PASS/FAIL** — 僅作為 warning 參考
- 差異在第 3 位小數（0.001）以內算 PASS
- N3 (Control-4) 現在也有 OD 範圍

### 實作位置

- Backend: `server/routes/aiFeasibility.js` → `fetchDynamicOdRanges()` 查 RDS
- Python: `tutti-qc-assayprocess/backend/all_batch_service.py` → `_compute_dynamic_od_ranges()`

---

## 4. CRE 隱藏

CREA 的結果已包含 CRE，因此 CRE 不重複顯示。

- `baseline_service.py`: `EXCLUDED_BUILD_LINE_MARKERS = {"BCl", "CRE"}`
- `buildLineCandidateService.ts`: default `'BCl,CRE'`

---

## 5. LLM Gate Workflow

本次 session 中期開始執行 Dual-LLM Approval Workflow：

- Kiro 實作 → 寫 `kiro_report.md` → tests → Codex (GPT-5.5) review → `approval_gate.py`
- Hooks 改為 `PostFileSave` trigger（原本 `PostFileCreate` 不會對 overwrite 觸發）

### 已通過 Gate 的 Tasks

| Task | 說明 | Status |
|------|------|--------|
| 7.1 | AI tab auto-execute + 🧠 icon | APPROVE_MARKED |
| 7.2 | PC build-lines 用 vet-lab TEa | APPROVE_MARKED |
| 7.3 | 動態 OD Q1/Q3 + warning-only | APPROVE_MARKED |

---

## 6. 服務部署

| Port | 服務 | 重啟方式 |
|------|------|----------|
| 3201 | qc-web-ipqc Node server | `kill PID && nohup node server/index.js &` |
| 3000 | pre-assignment Node server | `npm run build && kill PID && nohup node dist/server.js &` |
| 8200 | tutti-qc-assayprocess uvicorn | `fuser -k 8200/tcp && .venv/bin/uvicorn app:app --port 8200 &` |
| 8100 | vet-lab-spec-analyzer uvicorn | 未動（已在運行） |
| 18790 | AI Gateway (Node) | 未動（已在運行） |

---

## 7. 未 Push 的 Git 變更

Branch: `feat/ai-feasibility-vetlab-spec` (created, not yet pushed)

待 push 的變更清單見 `git status`。
