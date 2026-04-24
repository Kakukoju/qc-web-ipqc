import { apiUrl } from './base';

const BASE = apiUrl('/machine-pn');

export interface MachinePn {
  id: number;
  machine_type: string;
  pn: string;
  updated_at: string;
}

export interface MachinePnData {
  types: string[];
  rows: MachinePn[];
}

export async function fetchMachinePn(): Promise<MachinePnData> {
  const res = await fetch(BASE);
  return res.json();
}

export async function addMachinePn(machine_type: string, pn: string): Promise<{ ok?: boolean; error?: string; rows?: MachinePn[] }> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine_type, pn }),
  });
  return res.json();
}

export async function updateMachinePn(id: number, pn: string): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pn }),
  });
  return res.json();
}

export async function deleteMachinePn(id: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
  return res.json();
}
