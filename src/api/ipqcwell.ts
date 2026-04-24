import { apiUrl } from './base';

const BASE = apiUrl('/ipqcwell');

export interface IpqcWellRow {
  id: number;
  Marker: string;
  [well: string]: string | number | null;
}

export interface IpqcWellData {
  columns: string[];
  rows: IpqcWellRow[];
}

export async function fetchIpqcWell(): Promise<IpqcWellData> {
  const res = await fetch(BASE);
  return res.json();
}

export async function addIpqcWellRow(Marker: string): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Marker }),
  });
  return res.json();
}

export async function updateIpqcWellRow(id: number, data: Record<string, string | null>): Promise<{ ok?: boolean; error?: string; row?: IpqcWellRow }> {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteIpqcWellRow(id: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
  return res.json();
}
