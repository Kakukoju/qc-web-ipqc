import { apiUrl } from './base';

const BASE = apiUrl('/spec');

export async function fetchSpecs() {
  const res = await fetch(BASE);
  return res.json();
}

export async function fetchSpecStatus() {
  const res = await fetch(`${BASE}/status`);
  return res.json();
}

export async function lookupSpec(beadName: string): Promise<SpecLookup> {
  const res = await fetch(`${BASE}/lookup/${encodeURIComponent(beadName)}`);
  return res.json();
}

export async function fetchDefaults(): Promise<SpecDefaults> {
  const res = await fetch(`${BASE}/defaults`);
  return res.json();
}

export async function syncFromPaths(paths: { P01: string; Qbi: string }) {
  const res = await fetch(`${BASE}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  return res.json();
}

export async function uploadSpecFile(file: File) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: form });
  return res.json();
}

export interface SpecRow {
  id: number;
  source: string;
  source_file: string | null;
  marker: string;
  pn: string | null;
  tea: string | null;
  single_cv: string | null;
  init_l1_od: string | null;
  init_l2_od: string | null;
  spec_l1_od: string | null;
  spec_l2_od: string | null;
  spec_l3: string | null;
  spec_n1_od: string | null;
  well_config: string | null;
  dilution: string | null;
  calc_method: string | null;
  merge_bias: string | null;
  merge_cv: string | null;
  remarks: string | null;
  updated_at: string;
}

export interface SpecStatus {
  p01: { cnt: number; last_update: string | null };
  qbi: { cnt: number; last_update: string | null };
}

export interface SpecLookup {
  p01: SpecRow | null;
  qbi: SpecRow | null;
}

export interface SpecDefaults {
  P01: { path: string; accessible: boolean };
  Qbi: { path: string; accessible: boolean };
}
