import { apiUrl } from './base';

const BASE = apiUrl('/tutti-sku-list');

export interface TuttiSkuColumn {
  key: string;
  label: string;
  ordinal: number;
}

export interface TuttiSkuTableSummary {
  name: string;
  displayName: string;
  rowCount: number;
  columns: TuttiSkuColumn[];
}

export interface TuttiSkuTableData {
  table: string;
  displayName: string;
  columns: TuttiSkuColumn[];
  rows: Record<string, unknown>[];
}

export interface UploadDifference {
  table: string;
  type: string;
  ordinal?: number;
  current?: string | null;
  incoming?: string | null;
  message: string;
}

export async function fetchTuttiSkuTables(): Promise<TuttiSkuTableSummary[]> {
  const res = await fetch(`${BASE}/tables`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '載入 table 失敗');
  return data.tables;
}

export async function fetchTuttiSkuTable(tableName: string, q = ''): Promise<TuttiSkuTableData> {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  params.set('limit', '1000');
  const res = await fetch(`${BASE}/tables/${encodeURIComponent(tableName)}?${params.toString()}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '載入資料失敗');
  return data.data;
}

export async function uploadTuttiSkuExcel(file: File) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/upload`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  if (!data.ok) {
    const error = new Error(data.error || '上傳失敗') as Error & { differences?: UploadDifference[] };
    error.differences = data.differences;
    throw error;
  }
  return data as { ok: true; sheetCount: number; rowCount: number };
}
