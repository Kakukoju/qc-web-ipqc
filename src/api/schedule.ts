import { apiUrl } from './base';

const BASE = apiUrl('/schedule');

// ── 排產匯入 ──────────────────────────────────────────────────────────

export interface PendingItem {
  bead_name: string;
  work_order: string;
  prod_date: string;
  d_lot: string | null;
  d_wo: string | null;
  d_prod_date: string | null;
  bigD_lot: string | null;
  bigD_wo: string | null;
  bigD_prod_date: string | null;
  u_lot: string | null;
  u_wo: string | null;
  u_prod_date: string | null;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
  details: Array<{ bead_name: string; work_order: string; status: string; reason?: string }>;
}

export async function fetchPendingSchedule(): Promise<PendingItem[]> {
  const res = await fetch(`${BASE}/pending`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `schedule API ${res.status}`);
  }
  return res.json();
}

export async function importScheduleItems(items: PendingItem[]): Promise<ImportResult> {
  const res = await fetch(`${BASE}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `import API ${res.status}`);
  }
  return res.json();
}

// ── 待檢驗 ────────────────────────────────────────────────────────────

export interface PendingInspection {
  id: number;
  bead_name: string;
  sheet_name: string;
  insp_date: string;
  d_lot: string | null;
  bigD_lot: string | null;
  u_lot: string | null;
  d_work_order: string | null;
  bigD_work_order: string | null;
  u_work_order: string | null;
  crack: string | null;
  dirt: string | null;
  color: string | null;
}

export async function fetchPendingInspection(): Promise<PendingInspection[]> {
  const res = await fetch(`${BASE}/pending-inspection`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function activateInspection(
  id: number,
  visual: { crack: string; dirt: string; color: string },
  sheetName?: string,
): Promise<{ ok: boolean; bead_name: string; sheet_name: string }> {
  const res = await fetch(`${BASE}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...visual, sheet_name: sheetName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API ${res.status}`);
  }
  return res.json();
}
