import { apiUrl } from './base';

const BASE = apiUrl('/rawdata');

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`rawdata API ${res.status}: ${path}`);
  return res.json();
}

async function put<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`rawdata PUT ${res.status}: ${path}`);
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface RawDataRow {
  id: number;
  bead_name: string;
  sheet_name: string;
  table_type: 'well_od' | 'od_corrected' | 'ind_batch' | 'all_batch';
  level: string;
  combo_idx: number;
  lot_id: string | null;
  ctrl_lot: string | null;
  d_lot: string | null;
  bigD_lot: string | null;
  u_lot: string | null;
  w2: number | null;  w3: number | null;  w4: number | null;  w5: number | null;
  w6: number | null;  w7: number | null;  w8: number | null;  w9: number | null;
  w10: number | null; w11: number | null; w12: number | null; w13: number | null;
  w14: number | null; w15: number | null; w16: number | null; w17: number | null;
  w18: number | null; w19: number | null;
}

export interface ColMeta {
  id: number;
  bead_name: string;
  table_type: string;
  well: string;   // W2..W19
  row1: string | null;
  row2: string | null;
  row3: string | null;
}

export interface RawDataResponse {
  rows: RawDataRow[];
  meta: ColMeta[];
}

// ── API functions ──────────────────────────────────────────────────────────

export function fetchRawdataMarkers(): Promise<string[]> {
  return get<string[]>('/markers');
}

export function fetchRawdataSheets(bead_name: string): Promise<string[]> {
  return get<string[]>(`/sheets?bead_name=${encodeURIComponent(bead_name)}`);
}

export function fetchRawdata(bead_name: string, sheet_name: string): Promise<RawDataResponse> {
  return get<RawDataResponse>(
    `/data?bead_name=${encodeURIComponent(bead_name)}&sheet_name=${encodeURIComponent(sheet_name)}`
  );
}

export function updateRawdataRow(id: number, changes: Partial<RawDataRow>): Promise<RawDataRow> {
  return put<RawDataRow>(`/${id}`, changes);
}

export interface BeadReagentInfo { bead_name: string; n_reagents: number; }
export function fetchBeadReagents(): Promise<BeadReagentInfo[]> {
  return get<BeadReagentInfo[]>('/bead-reagents');
}

export interface SheetCombo { lot_id: string; ctrl_lot: string | null; }

export async function createSheet(
  bead_name: string,
  sheet_name: string,
  combos: SheetCombo[]
): Promise<{ ok: boolean; created: number }> {
  const res = await fetch(`${BASE}/sheets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bead_name, sheet_name, combos }),
  });
  if (!res.ok) throw new Error(`createSheet ${res.status}`);
  return res.json();
}

export async function syncQcTables(bead_name: string, sheet_name: string): Promise<{ ok: boolean; synced: number }> {
  const res = await fetch(`${BASE}/sync-qc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bead_name, sheet_name }),
  });
  if (!res.ok) throw new Error(`sync-qc ${res.status}`);
  return res.json();
}

// ── Cal rules (beadscal_rules) ─────────────────────────────────────────

export interface CalRule {
  id: number;
  marker: string;
  'blank well': string | null;
  '主波 (CH)': string | null;
  '副波 (CH)': string | null;
  'Seq 1 (圈數)': string | null;
  'Seq 2 (圈數)': string | null;
  moving: string | null;
  '扣n倍副波': string | null;
}

export function fetchCalRules(): Promise<CalRule[]> {
  return get<CalRule[]>('/cal-rules');
}

// ── Meta update ────────────────────────────────────────────────────────

export interface WellUpdate {
  well: string;
  row1: string | null;
  row2: string | null;
  row3: string | null;
}

export function updateRawdataMeta(bead_name: string, wells: WellUpdate[]): Promise<ColMeta[]> {
  return put<ColMeta[]>('/meta', { bead_name, wells });
}

// ── CS Assign (concentration targets) ──────────────────────────────────

export interface CsAssignRow {
  id: number;
  Marker: string;
  [col: string]: string | number; // L1_89751, L2_89752, N1_45981, N3_45983 etc.
}

export function fetchCsAssign(): Promise<CsAssignRow[]> {
  return get<CsAssignRow[]>('/cs-assign');
}

// ── Well-position templates ─────────────────────────────────────────────

export interface WellTemplate {
  id: number;
  name: string;
  wells: WellUpdate[];
}

export function fetchWellTemplates(): Promise<WellTemplate[]> {
  return get<WellTemplate[]>('/well-templates');
}

export async function saveWellTemplate(name: string, wells: WellUpdate[]): Promise<void> {
  const res = await fetch(`${BASE}/well-templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, wells }),
  });
  if (!res.ok) throw new Error(`save template ${res.status}`);
}

export async function deleteWellTemplate(id: number): Promise<void> {
  const res = await fetch(`${BASE}/well-templates/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete template ${res.status}`);
}

// ── P01 PN (machine dropdown) ──────────────────────────────────────────

export function fetchP01PN(): Promise<string[]> {
  return get<string[]>('/p01pn');
}
