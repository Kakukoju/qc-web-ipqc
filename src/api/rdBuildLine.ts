import { apiUrl } from './base';

const BASE = apiUrl('/v1/pre-assignment');

// ── Types ─────────────────────────────────────────────────────────────────

export interface RdPerson {
  emp_no: string;
  department: string;
  cost_center: string;
  name: string;
  english_name: string;
}

export interface RdTask {
  id: number;
  panel_name: string;
  lot_no: string;
  marker: string | null;
  work_order: string | null;
  status: string;
  created_at: string;
  created_by: string | null;
  assigned_rd_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  action_type: string | null;
  source_fit_id: string | null;
  fit_data_json: string | null;
  error_message: string | null;
}

export interface RdTaskDetail extends RdTask {
  fit_data: FitData | null;
  curve_record: CurveRecord | null;
  result_json: string | null;
}

export interface FitData {
  equation?: string;
  baseline_equation?: string;
  slope?: number;
  intercept?: number;
  r2?: number;
  points?: FitPoint[];
  analyze_date?: string;
  Species?: string;
  analyze_item?: string;
  panel_name?: string;
  mfg_lot_no?: string;
  fit?: { slope: number; intercept: number; r2: number; equation: string };
  [key: string]: unknown;
}

export interface FitPoint {
  patient_id?: string;
  conc?: number | null;
  od?: number | null;
  [key: string]: unknown;
}

export interface CurveRecord {
  id: number;
  marker: string;
  work_order: string | null;
  od_slope: number | null;
  od_intercept: number | null;
  od_r2: number | null;
  baseline_l1: number | null;
  baseline_l2: number | null;
  baseline_n1: number | null;
  baseline_n3: number | null;
  status: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  raw_od?: Record<string, number[]>;
  [key: string]: unknown;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
  message?: string;
}

// ── API Functions ─────────────────────────────────────────────────────────

export async function verifyRdEmpNo(empNo: string): Promise<ApiResponse<RdPerson>> {
  const res = await fetch(`${BASE}/rd-auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emp_no: empNo }),
  });
  return res.json();
}

export async function fetchRdTasks(status = 'pending_rd,in_progress'): Promise<ApiResponse<RdTask[]>> {
  const res = await fetch(`${BASE}/rd-build-line-tasks?status=${encodeURIComponent(status)}`);
  return res.json();
}

export async function fetchRdTaskDetail(taskId: number): Promise<ApiResponse<RdTaskDetail>> {
  const res = await fetch(`${BASE}/rd-build-line-tasks/${taskId}`);
  return res.json();
}

export async function createRdTask(params: {
  panel_name: string;
  lot_no: string;
  marker?: string;
  work_order?: string;
  source_fit_id?: string;
  created_by?: string;
  fit_data?: FitData;
}): Promise<ApiResponse<{ task_id: number; status: string; existing?: boolean }>> {
  const res = await fetch(`${BASE}/rd-build-line-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function startAdjust(taskId: number, empNo: string): Promise<ApiResponse<{
  task_id: number;
  status: string;
  rd_person: RdPerson;
  fit_data: FitData | null;
}>> {
  const res = await fetch(`${BASE}/rd-build-line-tasks/${taskId}/start-adjust`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emp_no: empNo }),
  });
  return res.json();
}

export async function directWrite(taskId: number, empNo: string): Promise<ApiResponse<{
  task_id: number;
  status: string;
  action_type: string;
  confirmed_by: string;
  rd_person: RdPerson;
  rds_updated: number;
}>> {
  const res = await fetch(`${BASE}/rd-build-line-tasks/${taskId}/direct-write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emp_no: empNo, confirmed: true }),
  });
  return res.json();
}

export async function saveAdjustedFit(taskId: number, empNo: string, fitParams: {
  slope?: number;
  intercept?: number;
  r2?: number;
  equation?: string;
  points?: FitPoint[];
}): Promise<ApiResponse<{
  task_id: number;
  status: string;
  action_type: string;
  confirmed_by: string;
  rd_person: RdPerson;
  rds_updated: number;
}>> {
  const res = await fetch(`${BASE}/rd-build-line-tasks/${taskId}/save-adjusted-fit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emp_no: empNo, fit_params: fitParams }),
  });
  return res.json();
}

export async function fetchRdTaskCounts(): Promise<ApiResponse<Record<string, number>>> {
  const res = await fetch(`${BASE}/rd-build-line-tasks-counts`);
  return res.json();
}

export async function deleteRdTask(taskId: number): Promise<ApiResponse<{ id: number; deleted: boolean }>> {
  const res = await fetch(`${BASE}/rd-build-line-tasks/${taskId}`, {
    method: 'DELETE',
  });
  return res.json();
}

export function rdTaskEventsUrl() {
  return `${BASE}/rd-build-line-events`;
}
