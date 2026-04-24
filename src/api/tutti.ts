export interface TuttiCurve {
  id: number;
  marker: string;
  work_order: string | null;
  lot_d: string | null;
  lot_bigD: string | null;
  lot_u: string | null;
  batch_combo: string | null;
  quantity: number | null;
  prod_date: string | null;
  fill_expiry: string | null;
  od_slope: number | null;
  od_intercept: number | null;
  od_r2: number | null;
  baseline_l1: number | null;
  baseline_l2: number | null;
  baseline_n1: number | null;
  baseline_n3: number | null;
  raw_od_json?: string;
  raw_od?: { l1: number[]; l2: number[]; n1: number[]; n3: number[] };
  status: 'pending' | 'confirmed';
  confirmed_by: string | null;
  confirmed_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface CsConcentrations {
  l1: number | null;
  l2: number | null;
  n1: number | null;
  n3: number | null;
}

export interface ImportResult extends TuttiCurve {
  concs: CsConcentrations;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error || `API error ${res.status}`);
  }
  return res.json();
}

export const fetchTuttiCurves = () =>
  apiFetch<TuttiCurve[]>(apiUrl('/tutti'));

export const fetchTuttiCurve = (id: number) =>
  apiFetch<TuttiCurve>(apiUrl(`/tutti/${id}`));

export const fetchCsConcentrations = (marker: string) =>
  apiFetch<CsConcentrations>(apiUrl(`/tutti/cs-concentrations?marker=${encodeURIComponent(marker)}`));

export async function importTuttiCurve(
  fields: {
    marker: string;
    work_order?: string;
    lot_d?: string; lot_bigD?: string; lot_u?: string;
    batch_combo?: string;
    quantity?: number;
    prod_date?: string;
    fill_expiry?: string;
    notes?: string;
    od_l1_json?: string;
    od_l2_json?: string;
    od_n1_json?: string;
    od_n3_json?: string;
  },
  file?: File,
): Promise<ImportResult> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v != null && v !== '') form.append(k, String(v));
  }
  if (file) form.append('file', file);
  return apiFetch<ImportResult>(apiUrl('/tutti/import'), { method: 'POST', body: form });
}

export const updateTuttiCurve = (id: number, fields: Partial<TuttiCurve>) =>
  apiFetch<TuttiCurve>(apiUrl(`/tutti/${id}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });

export const confirmTuttiCurve = (id: number, confirmed_by: string) =>
  apiFetch<TuttiCurve>(apiUrl(`/tutti/${id}/confirm`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmed_by }),
  });

export const deleteTuttiCurve = (id: number) =>
  apiFetch<{ ok: boolean }>(apiUrl(`/tutti/${id}`), { method: 'DELETE' });
import { apiUrl } from './base';
