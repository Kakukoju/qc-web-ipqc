import { apiUrl } from './base';

const BASE = apiUrl('/template');

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`template API ${res.status}`);
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────

export interface WellAssignment {
  wellNum: number;
  assignment: string; // marker name or "Blank"
}

export interface TestTemplate {
  id: number;
  name: string;
  markers: string[];
  wells: WellAssignment[];
}

export interface MarkerLotInfo {
  lot: string;
  work_order?: string;
  prod_date?: string;
}

export interface TemplateImportResult {
  ok: boolean;
  imported: number;
  sheet_name: string;
  details: Array<{ marker: string; status: string; reason?: string }>;
}

export interface TemplatePendingItem {
  sheet_name: string;
  insp_date: string;
  markers: Array<{
    bead_name: string;
    lot: string | null;
    work_order: string | null;
    id: number;
    crack: string | null;
    dirt: string | null;
    color: string | null;
  }>;
}

// ── API ───────────────────────────────────────────────────────────────

export function fetchTemplates(): Promise<TestTemplate[]> {
  return get('/');
}

export async function saveTemplate(name: string, markers: string[], wells: WellAssignment[]): Promise<void> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, markers, wells }),
  });
  if (!res.ok) throw new Error(`save template ${res.status}`);
}

export async function deleteTemplate(id: number): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete template ${res.status}`);
}

export async function templateImport(
  templateId: number,
  markerLots: Record<string, MarkerLotInfo>,
  inspDate?: string,
): Promise<TemplateImportResult> {
  const res = await fetch(`${BASE}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId, markerLots, inspDate }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `import ${res.status}`);
  }
  return res.json();
}

export function fetchTemplatePendingInspection(): Promise<TemplatePendingItem[]> {
  return get('/pending-inspection');
}
