export const API_BASE = '/api/assayprocess';

export type Logic = 'AND' | 'OR';

export interface QueryCondition {
  header: string;
  value: string;
}

export interface QueryPayload {
  logic: Logic;
  conditions: QueryCondition[];
  limit: number;
  offset: number;
}

export interface QueryResponse {
  ok: boolean;
  logic: Logic;
  total: number;
  limit: number;
  offset: number;
  columns: string[];
  rows: Record<string, string>[];
  error?: string;
}

export interface ImportStatus {
  ok: boolean;
  manifest_total_files: number;
  status_counts: Record<string, number>;
  success_files: number;
  error_files: number;
  records_total: number;
  natural_key_unique_index_exists: boolean;
  duplicate_natural_key_groups: number;
  last_imported_at: string | null;
  error_reasons: { error: string; count: number }[];
  recent_errors: { source_file_name: string; error_message: string; last_imported_at: string }[];
  notes: string[];
  error?: string;
}

export async function fetchHeaders(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/headers`);
  if (!response.ok) throw new Error(`Headers request failed: ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || 'Headers request failed');
  return data.headers || [];
}

export interface PanelNameOption {
  value: string;
  value_cn: string;
  label: string;
}

export async function fetchPanelNames(): Promise<PanelNameOption[]> {
  const response = await fetch(`${API_BASE}/panel-names`);
  if (!response.ok) throw new Error(`Panel names request failed: ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || 'Panel names request failed');
  return data.options || [];
}

export async function fetchImportStatus(): Promise<ImportStatus> {
  const response = await fetch(`${API_BASE}/import-status`);
  if (!response.ok) throw new Error(`Import status request failed: ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || 'Import status request failed');
  return data;
}

export async function queryAssayProcess(payload: QueryPayload): Promise<QueryResponse> {
  const response = await fetch(`${API_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Query request failed: ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || 'Query request failed');
  return data;
}

export interface ControlMeasurement {
  machine: string;
  zone: string;
  values: Record<string, number>;
}

export interface ControlSection {
  control_label: string;
  control_id: string;
  markers: string[];
  tea_display: Record<string, string>;
  tea_abs: Record<string, number | null>;
  assigned: Record<string, number | null>;
  upper: Record<string, number | null>;
  lower: Record<string, number | null>;
  measurements: ControlMeasurement[];
}

export interface ControlSummaryMarker {
  mean: number | null;
  bias: number | null;
  cv: number | null;
  bias_alert: boolean;
  cv_alert: boolean;
  upper: number | null;
  lower: number | null;
  cv_limit: number | null;
}

export interface ControlSummary {
  control_label: string;
  markers: Record<string, ControlSummaryMarker>;
}

export interface ControlSheetResponse {
  ok: boolean;
  panel_name: string;
  analyze_date: string;
  fw_version: string;
  production_date: string;
  lot_code: string;
  product_code: string;
  markers: string[];
  controls: ControlSection[];
  summary: ControlSummary[];
  error?: string;
}

export interface SkylaiDeviceFetchResult {
  ok: boolean;
  total_inserted?: number;
  total_skipped?: number;
  device_results?: { device_sn: string; inserted: number; error?: string }[];
  date_range?: { start: string; end: string };
  error?: string;
}

export async function fetchSkylaiDevices(payload?: {
  start_date?: string;
  end_date?: string;
  days_back?: number;
}): Promise<SkylaiDeviceFetchResult> {
  const response = await fetch(`${API_BASE}/fetch-skylai-devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!response.ok) throw new Error(`Fetch request failed: ${response.status}`);
  return response.json();
}

export async function fetchControlSheet(payload: {
  panel_name: string;
  analyze_date: string;
  fw_version?: string;
}): Promise<ControlSheetResponse> {
  const response = await fetch(`${API_BASE}/control-sheet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Control sheet request failed: ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || 'Control sheet request failed');
  return data;
}


export interface LotReportFile {
  file_name: string;
  size: number;
  modified_at: string;
  download_url: string;
  has_preview: boolean;
}

export interface LotReportGroupPreview {
  id: string;
  panel_name: string;
  kind: string;
  display_lot_code: string;
  lot_codes: string[];
  production_date: string;
  analyze_date: string;
  record_count: number;
  marker_count: number;
  markers: string[];
}

export interface LotReportSheetRow {
  type: string;
  marker: string;
  tea?: number | null;
  assigned?: number | null;
  lcl?: number | null;
  ucl?: number | null;
  mean?: number | null;
  bias?: number | null;
  cv?: number | null;
  od_mean?: number | null;
  n?: number | null;
}

export interface LotReportSummaryRow {
  label: string;
  stat: string;
  values: Array<number | string | null>;
}

export interface LotReportSummaryTable {
  markers: string[];
  rows: LotReportSummaryRow[];
}

export interface LotReportDetailCell {
  original: number | string | null;
  changed: number | string | null;
}

export interface LotReportDetailRow {
  sample: string;
  device_sn: string;
  test_zone: string;
  analyze_time?: string;
  values: Record<string, LotReportDetailCell>;
}

export interface LotReportDetailTable {
  markers: string[];
  rows: LotReportDetailRow[];
  value_mode?: 'conc' | 'od';
}


export interface LotReportPageInfoItem {
  label: string;
  value: number | string | null;
}

export interface LotReportMakerBatch {
  markers: string[];
  values: Array<number | string | null>;
}

export interface LotReportSheetPreview {
  sheet_name: string;
  markers?: string[];
  test_count?: number;
  page_info?: LotReportPageInfoItem[];
  maker_batch?: LotReportMakerBatch;
  rows: LotReportSheetRow[];
  summary_conc?: LotReportSummaryTable;
  summary_od?: LotReportSummaryTable;
  detail_conc?: LotReportDetailTable;
  detail_od?: LotReportDetailTable;
}

export interface LotReportPreview {
  ok: boolean;
  file_name: string;
  download_url: string;
  generated_at: string;
  id?: string;
  panel_name?: string;
  display_lot_code?: string;
  lot_codes?: string[];
  production_date?: string;
  analyze_date?: string;
  record_count?: number;
  kinds?: string[];
  sheets?: Record<string, LotReportSheetPreview>;
  all_batch_rows?: number;
  group_count?: number;
  groups: LotReportGroupPreview[];
  error?: string;
}


export interface LotReportGroupRow {
  id: string;
  panel_name: string;
  display_lot_code: string;
  lot_codes: string[];
  production_date: string;
  analyze_date: string;
  record_count: number;
  kinds: string[];
}

export async function fetchLotReportGroups(): Promise<LotReportGroupRow[]> {
  const response = await fetch(`${API_BASE}/lot-report-groups`);
  if (!response.ok) throw new Error(`Lot report groups request failed: ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || "Lot report groups request failed");
  return data.rows || [];
}


export async function fetchLotReports(): Promise<LotReportFile[]> {
  const response = await fetch(`${API_BASE}/lot-reports`);
  if (!response.ok) throw new Error(`Lot reports request failed: ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || "Lot reports request failed");
  return data.reports || [];
}

export async function fetchLotReportPreview(fileName: string): Promise<LotReportPreview> {
  const response = await fetch(`${API_BASE}/lot-reports/${encodeURIComponent(fileName)}/preview`);
  if (!response.ok) throw new Error(`Lot report preview failed: ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || "Lot report preview failed");
  return data;
}

export async function generateLotReport(payload?: { id?: string; dataset_id?: string; lot_code?: string; output_date?: string }): Promise<LotReportPreview> {
  const response = await fetch(`${API_BASE}/lot-reports/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  if (!response.ok) throw new Error(`Lot report generate failed: ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || "Lot report generate failed");
  return data;
}
