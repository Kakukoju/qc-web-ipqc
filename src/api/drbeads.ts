import { apiUrl } from './base';

const BASE = apiUrl('/drbeads');

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`drbeads API ${res.status}: ${path}`);
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface DrBeadRecord {
  id: number;
  bead_name: string;
  file_name: string;
  sheet_name: string;
  batch_col: number;
  product_name: string | null;
  insp_date: string | null;
  // d劑
  d_part_no: string | null;
  d_prod_date: string | null;
  d_lot: string | null;
  d_work_order: string | null;
  d_send_qty: string | null;
  d_sample_qty: string | null;
  // D劑 (capital)
  bigD_part_no: string | null;
  bigD_prod_date: string | null;
  bigD_lot: string | null;
  bigD_work_order: string | null;
  bigD_send_qty: string | null;
  bigD_sample_qty: string | null;
  // U劑
  u_part_no: string | null;
  u_prod_date: string | null;
  u_lot: string | null;
  u_work_order: string | null;
  u_send_qty: string | null;
  u_sample_qty: string | null;
  // well & standard
  well_position: string | null;
  std_name: string | null;
  std_lot_l1: string | null;
  std_lot_l2: string | null;
  machine_L1: string | null;
  machine_L2: string | null;
  machine_N1: string | null;
  machine_N3: string | null;
  // batch combo
  batch_combo: string | null;
  // visual
  crack: string | null;
  dirt: string | null;
  color: string | null;
  // OD CV
  od_cv_spec: string | null;
  od_cv_l1: string | null;
  od_cv_l2: string | null;
  od_cv_n1: string | null;
  od_cv_n3: string | null;
  // RConc CV
  rconc_cv_spec: string | null;
  rconc_cv_l1: string | null;
  rconc_cv_l2: string | null;
  rconc_cv_n1: string | null;
  rconc_cv_n3: string | null;
  // Mean Bias
  mean_bias_spec: string | null;
  mean_bias_l1: string | null;
  mean_bias_l2: string | null;
  // 全批次CV
  total_cv_spec: string | null;
  total_cv_l1: string | null;
  total_cv_l2: string | null;
  // 起始值
  initial_spec: string | null;
  initial_l1: string | null;
  initial_l2: string | null;
  // 判定
  batch_decision: string | null;
  final_decision: string | null;
  defect_desc: string | null;
  remarks: string | null;
  // OD analysis per batch
  od_slope: string | null;
  od_intercept: string | null;
  od_mean_l1: string | null;
  od_mean_l2: string | null;
  od_mean_n1: string | null;
  od_mean_n3: string | null;
  od_cvpct_l1: string | null;
  od_cvpct_l2: string | null;
  od_cvpct_n1: string | null;
  od_cvpct_n3: string | null;
  od_bias_l1: string | null;
  od_bias_l2: string | null;
  od_bias_n1: string | null;
  od_bias_n3: string | null;
  // OD total
  od_tot_slope: string | null;
  od_tot_intercept: string | null;
  od_tot_mean_l1: string | null;
  od_tot_mean_l2: string | null;
  od_tot_mean_n1: string | null;
  od_tot_mean_n3: string | null;
  od_tot_cvpct_l1: string | null;
  od_tot_cvpct_l2: string | null;
  od_tot_cvpct_n1: string | null;
  od_tot_cvpct_n3: string | null;
  od_tot_bias_l1: string | null;
  od_tot_bias_l2: string | null;
  od_tot_bias_n1: string | null;
  od_tot_bias_n3: string | null;
  // 個批次 Conc
  conc_mean_l1: string | null;
  conc_mean_l2: string | null;
  conc_cvpct_l1: string | null;
  conc_cvpct_l2: string | null;
  // 全批次 Conc per batch
  conc_tot_mean_l1: string | null;
  conc_tot_mean_l2: string | null;
  conc_tot_cvpct_l1: string | null;
  conc_tot_cvpct_l2: string | null;
  conc_tot_bias_l1: string | null;
  conc_tot_bias_l2: string | null;
  // 全批次 Conc total
  conc_total_mean_l1: string | null;
  conc_total_mean_l2: string | null;
  conc_total_cvpct_l1: string | null;
  conc_total_cvpct_l2: string | null;
}

export interface SheetSummary {
  sheet_name: string;
  insp_date: string | null;
  file_name: string;
  combo_count: number;
}

export interface BeadStat {
  bead_name: string;
  sheets: number;
  records: number;
  last_insp_date: string | null;
  passed: number;
  failed: number;
  hold: number;
  pending: number;
  pending_insp: number;
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function fetchBeadMarkers(): Promise<string[]> {
  return get<string[]>('/markers');
}

export async function fetchBeadSheets(bead_name: string): Promise<SheetSummary[]> {
  return get<SheetSummary[]>(`/sheets?bead_name=${encodeURIComponent(bead_name)}`);
}

export async function fetchBeadRecords(bead_name: string, sheet_name: string): Promise<DrBeadRecord[]> {
  return get<DrBeadRecord[]>(
    `/records?bead_name=${encodeURIComponent(bead_name)}&sheet_name=${encodeURIComponent(sheet_name)}`
  );
}

export async function fetchBeadStats(year?: string): Promise<BeadStat[]> {
  return get<BeadStat[]>(year ? `/stats?year=${year}` : '/stats');
}

export async function deleteBeadSheet(bead_name: string, sheet_name: string): Promise<{ deleted: number }> {
  const res = await fetch(`${BASE}/sheet?bead_name=${encodeURIComponent(bead_name)}&sheet_name=${encodeURIComponent(sheet_name)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`drbeads API ${res.status}`);
  return res.json();
}

// ── Dashboard APIs (SQLite) ───────────────────────────────────────────────

export interface KpiData {
  total_batches: number; total_records: number;
  passed: number; ng: number; markers: number;
}

export interface TrendRow {
  lot: string; odMean: number; cv: number; bias: number; pass: number; ng: number;
}

export interface AnomalyRow {
  id: number; type: string; description: string; status: string; created_at: string;
}

export async function fetchKpi(year?: string): Promise<KpiData> {
  return get<KpiData>(year ? `/kpi?year=${year}` : '/kpi');
}

export async function fetchTrend(bead_name: string, limit = 10, year?: string): Promise<TrendRow[]> {
  let url = `/trend?bead_name=${encodeURIComponent(bead_name)}&limit=${limit}`;
  if (year) url += `&year=${year}`;
  return get<TrendRow[]>(url);
}

export async function fetchAnomalies(year?: string): Promise<AnomalyRow[]> {
  return get<AnomalyRow[]>(year ? `/anomalies?year=${year}` : '/anomalies');
}

export async function fetchYears(): Promise<string[]> {
  return get<string[]>('/years');
}
