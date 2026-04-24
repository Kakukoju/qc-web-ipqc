export interface ImportResult {
  bead_name: string;
  imported: number;
  skipped: number;
  sheets: { name: string; status: string; t1?: number; t2?: number }[];
}

export interface BatchImportResult {
  total_files: number;
  imported_files: number;
  total_sheets: number;
  skipped_sheets: number;
  results: ImportResult[];
}

export async function uploadExcelBatchChunked(
  files: File[],
  chunkSize: number,
  onProgress: (done: number, total: number) => void,
): Promise<BatchImportResult> {
  const total = files.length;
  const agg: BatchImportResult = {
    total_files: 0, imported_files: 0,
    total_sheets: 0, skipped_sheets: 0, results: [],
  };
  for (let start = 0; start < total; start += chunkSize) {
    const chunk = files.slice(start, start + chunkSize);
    const r = await uploadExcelBatch(chunk);
    agg.total_files    += r.total_files;
    agg.imported_files += r.imported_files;
    agg.total_sheets   += r.total_sheets;
    agg.skipped_sheets += r.skipped_sheets;
    agg.results.push(...r.results);
    onProgress(Math.min(start + chunkSize, total), total);
  }
  return agg;
}

export async function uploadExcelBatch(files: File[]): Promise<BatchImportResult> {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  const res = await fetch(apiUrl('/excel-import/upload-batch'), { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Upload failed: ${res.status}`);
  }
  return res.json();
}
import { apiUrl } from './base';
