import { apiUrl } from './base';

const BASE = apiUrl('/csassign');

export interface CsMeta {
  id: number;
  col_name: string;
  cs_title: string | null;
  cs_lot: string | null;
  cs_expiry: string | null;
}

export interface CsData {
  columns: string[];
  rows: Record<string, unknown>[];
  meta: CsMeta[];
}

export async function fetchCsAssign(): Promise<CsData> {
  const res = await fetch(BASE);
  return res.json();
}

export async function fetchCsMeta(): Promise<CsMeta[]> {
  const res = await fetch(`${BASE}/meta`);
  return res.json();
}

export async function updateCsMeta(data: Partial<CsMeta> & { col_name: string }) {
  const res = await fetch(`${BASE}/meta`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function updateCsRow(id: number, changes: Record<string, unknown>) {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  return res.json();
}

export async function addCsRow(data: Record<string, unknown>) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteCsRow(id: number) {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function addCsColumn(col_name: string, meta?: Partial<CsMeta>) {
  const res = await fetch(`${BASE}/column`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ col_name, ...meta }),
  });
  return res.json();
}

export async function deleteCsColumn(col_name: string) {
  const res = await fetch(`${BASE}/column/${encodeURIComponent(col_name)}`, { method: 'DELETE' });
  return res.json();
}

export async function pasteCsData(startRow: number, startCol: string, data: (string | null)[][]) {
  const res = await fetch(`${BASE}/paste`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startRow, startCol, data }),
  });
  return res.json();
}
