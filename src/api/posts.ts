import { apiUrl } from './base';

const BASE = apiUrl('/posts');

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`posts API ${res.status}: ${path}`);
  return res.json();
}

async function put<T>(path: string, body: Partial<PostRecord>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`posts API PUT ${res.status}: ${path}`);
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface PostRecord {
  id: number;
  bead_name: string;
  file_name: string;
  sheet_name: string;
  combo_idx: number;
  // header
  marker: string | null;
  pn_d: string | null;
  pn_bigD: string | null;
  pn_u: string | null;
  prod_date_d: string | null;
  prod_date_bigD: string | null;
  prod_date_u: string | null;
  insp_date: string | null;
  work_order_d: string | null;
  work_order_bigD: string | null;
  work_order_u: string | null;
  send_qty_d: string | null;
  send_qty_bigD: string | null;
  send_qty_u: string | null;
  sample_qty_d: string | null;
  sample_qty_bigD: string | null;
  sample_qty_u: string | null;
  // specs
  fw: string | null;
  cs_type_l1: string | null;
  cs_type_l2: string | null;
  tea_l1: string | null;
  tea_l2: string | null;
  mg_dl_l1: string | null;
  mg_dl_l2: string | null;
  lsl_l1: string | null;
  usl_l1: string | null;
  lsl_l2: string | null;
  usl_l2: string | null;
  conc_cv_spec: string | null;
  mean_bias_spec_l1: string | null;
  mean_bias_spec_l2: string | null;
  total_cv_spec: string | null;
  control_ref_l1: string | null;
  control_ref_l2: string | null;
  cs_name: string | null;
  cs_lot_l1: string | null;
  cs_lot_l2: string | null;
  // per-combo
  lot_d: string | null;
  lot_bigD: string | null;
  lot_u: string | null;
  crack: string | null;
  dirt: string | null;
  color: string | null;
  cv_conform: string | null;
  bias_conform: string | null;
  merge_judge: string | null;
  final_judge: string | null;
  // OD
  slope: string | null;
  intercept: string | null;
  od_mean_l1: string | null;
  od_mean_l2: string | null;
  od_mean_n1: string | null;
  od_mean_n3: string | null;
  od_cv_l1: string | null;
  od_cv_l2: string | null;
  od_cv_n1: string | null;
  od_cv_n3: string | null;
  od_bias_l1: string | null;
  od_bias_l2: string | null;
  od_bias_n1: string | null;
  od_bias_n3: string | null;
  // single-batch conc
  sb_judge_d: string | null;
  sb_judge_u: string | null;
  sb_judge_result: string | null;
  sb_conc_mean_l1: string | null;
  sb_conc_mean_l2: string | null;
  sb_conc_cv_l1: string | null;
  sb_conc_cv_l2: string | null;
  // full-batch conc
  fb_judge_l1: string | null;
  fb_judge_l2: string | null;
  fb_initial_judge: string | null;
  fb_conc_mean_l1: string | null;
  fb_conc_mean_l2: string | null;
  fb_conc_cv_l1: string | null;
  fb_conc_cv_l2: string | null;
  fb_bias_l1: string | null;
  fb_bias_l2: string | null;
}

export interface PostSheetSummary {
  sheet_name: string;
  insp_date: string | null;
  combo_count: number;
}

// ── API functions ──────────────────────────────────────────────────────────

export async function fetchPostMarkers(): Promise<string[]> {
  return get<string[]>('/markers');
}

export async function fetchPostSheets(bead_name: string): Promise<PostSheetSummary[]> {
  return get<PostSheetSummary[]>(`/sheets?bead_name=${encodeURIComponent(bead_name)}`);
}

export async function fetchPostRecords(bead_name: string, sheet_name: string): Promise<PostRecord[]> {
  return get<PostRecord[]>(
    `/records?bead_name=${encodeURIComponent(bead_name)}&sheet_name=${encodeURIComponent(sheet_name)}`
  );
}

export async function updatePostRecord(id: number, changes: Partial<PostRecord>): Promise<PostRecord> {
  return put<PostRecord>(`/${id}`, changes);
}
