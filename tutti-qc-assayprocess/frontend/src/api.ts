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
