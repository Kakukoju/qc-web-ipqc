/**
 * IPQC 化學特性批次紀錄 — 資料庫 Schema
 *
 * 資料來源: \\fls341\MBBU_FAB\MB_QA\Dora\2.Disk A\{year}年度IPQC化學特性批次紀錄\
 * 每個 Excel 檔 = 一個 marker (e.g. 2026-ALP.xlsx)
 * 每個 sheet (name=26*) = 一個批次 lot
 *
 * 三大區塊:
 *   L1:Y64    → 外部檢查 (Dried Beads 半成品檢驗紀錄)
 *   L88:AH144 → Skyla Dried Beads 半成品檢驗紀錄
 *   K166:AN300 → 機器測試結果與換算濃度值
 */

// ─── 判定結果 ───
export type Judgment = 'PASS' | 'NG' | 'PENDING' | 'NA';
export type BatchStatus = 'PENDING' | 'IN_REVIEW' | 'PASS' | 'FAIL';

// ─── 1. 批次主表 (每個 sheet = 一筆) ───
export interface IpqcBatch {
  id: string;                   // PK, e.g. "2026-ALP-261412"
  year: number;                 // 年度, e.g. 2026
  marker: string;               // 項目代碼, e.g. "ALP", "ALB"
  lotNo: string;                // 批號, e.g. "261412"
  sheetName: string;            // Excel sheet name, e.g. "261412"
  workOrder: string;            // 公單號
  productionDate: string;       // 生產日期 (ISO)
  inspectionDate: string;       // 檢驗日期 (ISO)
  expirationDate: string;       // 有效期限 (ISO)
  submittedQty: number;         // 送驗數量
  sampledQty: number;           // 抽樣數量
  machine: string;              // 使用機台
  controlSerum: string;         // 管制血清
  inspector: string;            // 檢驗人員
  reviewer: string;             // 覆核人員
  status: BatchStatus;          // 批次最終判定
  createdAt: string;
  updatedAt: string;
}

// ─── 2. 外部檢查 (L1:Y64) — Dried Beads 半成品檢驗紀錄 ───
export interface AppearanceInspection {
  id: string;
  batchId: string;              // FK → IpqcBatch.id
  item: string;                 // 檢驗項目, e.g. "碎裂/破孔", "髒汙/異物"
  method: string;               // 檢驗方法
  spec: string;                 // 規格
  resultA: Judgment;            // 批次A結果
  resultB: Judgment;            // 批次B結果
  resultC: Judgment;            // 批次C結果
  finalResult: Judgment;        // 最終判定
  remark: string;
}

// ─── 3. Skyla 測試結果 (L88:AH144) ───
export interface SkylaTestResult {
  id: string;
  batchId: string;              // FK → IpqcBatch.id
  subLot: string;               // 子批號, e.g. "261412-01"
  du: 'D' | 'U';               // D=Down, U=Up
  slope: number;
  intercept: number;
  odMean: number;               // OD 平均值
  odCv: number;                 // OD CV%
  odBias: number;               // OD Bias%
  singleLinear: Judgment;       // 單項線性判定
  allLinear: Judgment;          // 全項線性判定
  totalJudgment: Judgment;      // 總判定
  remark: string;
}

// ─── 4. 機器測試結果與濃度換算 (K166:AN300) ───
export interface MachineTestResult {
  id: string;
  batchId: string;              // FK → IpqcBatch.id
  subLot: string;               // 子批號
  level: string;                // 濃度水平, e.g. "L1", "L2", "L3"
  replicateNo: number;          // 重複測試序號
  rawOd: number;                // 原始 OD 值
  correctedOd: number;          // 校正後 OD 值
  concentration: number;        // 換算濃度值
  targetConc: number;           // 目標濃度
  concBias: number;             // 濃度 Bias%
  concCv: number;               // 濃度 CV%
  judgment: Judgment;
  remark: string;
}

// ─── 5. 異常紀錄 ───
export interface Anomaly {
  id: string;
  batchId: string;              // FK → IpqcBatch.id
  sourceTable: 'appearance' | 'skyla' | 'machine';
  sourceRecordId: string;       // FK → 來源表的 id
  type: string;                 // e.g. "線性超規", "CV超規", "外觀髒汙"
  description: string;
  status: 'OPEN' | 'IN_REVIEW' | 'CLOSED';
  createdAt: string;
  resolvedAt: string | null;
}

// ─── 完整批次資料 (含所有子表) ───
export interface IpqcBatchFull extends IpqcBatch {
  appearances: AppearanceInspection[];
  skylaResults: SkylaTestResult[];
  machineResults: MachineTestResult[];
  anomalies: Anomaly[];
}

// ─── SQL DDL (PostgreSQL) ───
export const DDL = `
CREATE TABLE ipqc_batches (
  id            TEXT PRIMARY KEY,
  year          INT NOT NULL,
  marker        TEXT NOT NULL,
  lot_no        TEXT NOT NULL,
  sheet_name    TEXT NOT NULL,
  work_order    TEXT,
  production_date DATE,
  inspection_date DATE,
  expiration_date DATE,
  submitted_qty INT,
  sampled_qty   INT,
  machine       TEXT,
  control_serum TEXT,
  inspector     TEXT,
  reviewer      TEXT,
  status        TEXT NOT NULL DEFAULT 'PENDING',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(year, marker, lot_no)
);

CREATE TABLE appearance_inspections (
  id            TEXT PRIMARY KEY,
  batch_id      TEXT NOT NULL REFERENCES ipqc_batches(id),
  item          TEXT NOT NULL,
  method        TEXT,
  spec          TEXT,
  result_a      TEXT,
  result_b      TEXT,
  result_c      TEXT,
  final_result  TEXT,
  remark        TEXT
);

CREATE TABLE skyla_test_results (
  id              TEXT PRIMARY KEY,
  batch_id        TEXT NOT NULL REFERENCES ipqc_batches(id),
  sub_lot         TEXT NOT NULL,
  du              CHAR(1) NOT NULL,
  slope           NUMERIC(8,4),
  intercept       NUMERIC(8,4),
  od_mean         NUMERIC(8,4),
  od_cv           NUMERIC(6,2),
  od_bias         NUMERIC(6,2),
  single_linear   TEXT,
  all_linear      TEXT,
  total_judgment  TEXT,
  remark          TEXT
);

CREATE TABLE machine_test_results (
  id              TEXT PRIMARY KEY,
  batch_id        TEXT NOT NULL REFERENCES ipqc_batches(id),
  sub_lot         TEXT NOT NULL,
  level           TEXT NOT NULL,
  replicate_no    INT,
  raw_od          NUMERIC(10,4),
  corrected_od    NUMERIC(10,4),
  concentration   NUMERIC(10,4),
  target_conc     NUMERIC(10,4),
  conc_bias       NUMERIC(6,2),
  conc_cv         NUMERIC(6,2),
  judgment        TEXT,
  remark          TEXT
);

CREATE TABLE anomalies (
  id              TEXT PRIMARY KEY,
  batch_id        TEXT NOT NULL REFERENCES ipqc_batches(id),
  source_table    TEXT NOT NULL,
  source_record_id TEXT,
  type            TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'OPEN',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX idx_batch_year_marker ON ipqc_batches(year, marker);
CREATE INDEX idx_batch_lot ON ipqc_batches(lot_no);
CREATE INDEX idx_appearance_batch ON appearance_inspections(batch_id);
CREATE INDEX idx_skyla_batch ON skyla_test_results(batch_id);
CREATE INDEX idx_machine_batch ON machine_test_results(batch_id);
CREATE INDEX idx_anomaly_batch ON anomalies(batch_id);
CREATE INDEX idx_anomaly_status ON anomalies(status);
`;
