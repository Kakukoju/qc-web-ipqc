import { apiUrl } from './base';

export interface Personnel {
  id: number;
  emp_no: string;
  department: string | null;
  cost_center: string | null;
  name: string | null;
  english_name: string | null;
}

type Table = 'qc_personnel' | 'line_personnel';

export async function fetchPersonnel(table: Table): Promise<Personnel[]> {
  const res = await fetch(apiUrl(`/personnel/${table}`));
  return res.json();
}

export async function addPersonnel(table: Table, data: Omit<Personnel, 'id'>) {
  const res = await fetch(apiUrl(`/personnel/${table}`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  return res.json();
}

export async function updatePersonnel(table: Table, id: number, data: Omit<Personnel, 'id'>) {
  const res = await fetch(apiUrl(`/personnel/${table}/${id}`), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  return res.json();
}

export async function deletePersonnel(table: Table, id: number) {
  const res = await fetch(apiUrl(`/personnel/${table}/${id}`), { method: 'DELETE' });
  return res.json();
}

export async function uploadPersonnelExcel(table: Table, file: File) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(apiUrl(`/personnel/${table}/upload`), { method: 'POST', body: fd });
  return res.json();
}
