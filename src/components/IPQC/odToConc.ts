/**
 * odToConc – OD → Concentration via linear regression
 *
 * For each well, given two OD levels (e.g. L2 OD & L3 OD) with known CS concentrations
 * from csassign table, compute: Conc = m * OD + b
 *
 * ── 個別批次 (ind_batch) ──
 * Per lot_id+combo_idx row: 2-point regression from that row's two-level OD values
 *
 * ── 全批次 (all_batch) ──
 * Collect ALL rows' two-level OD values → least-squares regression per well → apply to all
 *
 * Excluded: Na, K (skip concentration calculation)
 * tCREA: uses well_od (which stores Creatinine-Creatine subtraction result)
 */

import type { RawDataRow, CsAssignRow } from '../../api/rawdata';
import { normalizeMarkerName } from './markerRuleBook';

const WELL_FIELDS = [
  'w2','w3','w4','w5','w6','w7','w8','w9',
  'w10','w11','w12','w13','w14','w15','w16','w17','w18','w19',
] as const;
type WF = typeof WELL_FIELDS[number];

const EXCLUDED_BEADS = new Set(['Na', 'K']);

function isExcluded(beadName: string): boolean {
  return EXCLUDED_BEADS.has(beadName);
}

interface LevelPair {
  odA: string;    // e.g. "L2 OD"
  odB: string;    // e.g. "L3 OD"
  concA: string;  // e.g. "L2 Conc."
  concB: string;  // e.g. "L3 Conc."
  knownA: number; // CS concentration for level A
  knownB: number; // CS concentration for level B
}

/**
 * Match OD level name to csassign column.
 * "L2 OD" → prefix "L2" → find column starting with "L2_"
 */
function findCsConc(level: string, csRow: CsAssignRow): number | null {
  const m = level.match(/^([A-Z]\d+)\s+OD$/i);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  for (const [col, val] of Object.entries(csRow)) {
    if (col === 'id' || col === 'Marker') continue;
    if (col.toUpperCase().startsWith(prefix + '_')) {
      const n = Number(val);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

/**
 * Find valid OD level pairs that have CS concentrations.
 * Groups by prefix letter (L, N, U), pairs first two levels with known conc.
 */
function findLevelPairs(odLevels: string[], csRow: CsAssignRow): LevelPair[] {
  const groups = new Map<string, { level: string; num: number; conc: number }[]>();
  for (const lv of odLevels) {
    const m = lv.match(/^([A-Z])(\d+)\s+OD$/i);
    if (!m) continue;
    const prefix = m[1].toUpperCase();
    const conc = findCsConc(lv, csRow);
    if (conc === null) continue;
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push({ level: lv, num: parseInt(m[2]), conc });
  }

  const pairs: LevelPair[] = [];
  for (const [, items] of groups) {
    if (items.length < 2) continue;
    items.sort((a, b) => a.num - b.num);
    pairs.push({
      odA: items[0].level,
      odB: items[1].level,
      concA: items[0].level.replace(' OD', ' Conc.'),
      concB: items[1].level.replace(' OD', ' Conc.'),
      knownA: items[0].conc,
      knownB: items[1].conc,
    });
  }
  return pairs;
}

function linReg2(x1: number, y1: number, x2: number, y2: number): { m: number; b: number } | null {
  if (Math.abs(x2 - x1) < 1e-15) return null;
  const m = (y2 - y1) / (x2 - x1);
  return { m, b: y1 - m * x1 };
}

function linRegN(pts: { x: number; y: number }[]): { m: number; b: number } | null {
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const d = n * sxx - sx * sx;
  if (Math.abs(d) < 1e-15) return null;
  const m = (n * sxy - sx * sy) / d;
  return { m, b: (sy - m * sx) / n };
}

function getVal(row: RawDataRow, f: WF): number | null {
  const v = row[f] as number | null;
  return v !== null && v !== undefined && Number.isFinite(v) ? v : null;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * Normalize a bead/marker name for matching: uppercase, strip -A/-B suffix, strip t/N/G/Q prefix.
 */
function toMatchKey(name: string): string {
  let s = normalizeMarkerName(name);  // uppercase + alias
  s = s.replace(/-[A-Z]$/, '');       // strip -A, -B suffix
  s = s.replace(/^[TNGQ](?=[A-Z])/, ''); // strip t/N/G/Q prefix
  return s;
}

/**
 * Find the matching csassign row for a bead_name.
 * Tries: exact → normalized → stripped bead matches stripped cs marker.
 */
function findCsRow(beadName: string, csData: CsAssignRow[]): CsAssignRow | undefined {
  if (!Array.isArray(csData)) return undefined;
  const beadKey = toMatchKey(beadName);

  for (const row of csData) {
    const csKey = toMatchKey(row.Marker);
    if (csKey === beadKey) return row;
  }
  return undefined;
}

/**
 * Compute concentration for ind_batch and all_batch rows.
 * Returns updated RawDataRow[] to be applied.
 */
export function computeConcentrations(
  allRows: RawDataRow[],
  beadName: string,
  csData: CsAssignRow[],
): RawDataRow[] {
  if (isExcluded(beadName)) return [];
  if (!Array.isArray(csData) || !csData.length) return [];

  const csRow = findCsRow(beadName, csData);
  if (!csRow) return [];

  const wellOd = allRows.filter(r => r.table_type === 'well_od');
  const odLevels = [...new Set(wellOd.map(r => r.level))];
  const pairs = findLevelPairs(odLevels, csRow);
  if (!pairs.length) return [];

  const keyOf = (r: RawDataRow) => `${r.lot_id}|${r.combo_idx}`;
  const result = new Map<number, RawDataRow>();

  const merge = (row: RawDataRow, field: WF, val: number) => {
    const existing = result.get(row.id) ?? { ...row };
    (existing as any)[field] = round6(val);
    result.set(row.id, existing);
  };

  for (const pair of pairs) {
    const rowsA = wellOd.filter(r => r.level === pair.odA);
    const rowsB = wellOd.filter(r => r.level === pair.odB);
    const mapA = new Map(rowsA.map(r => [keyOf(r), r]));
    const mapB = new Map(rowsB.map(r => [keyOf(r), r]));

    const indRows = allRows.filter(r => r.table_type === 'ind_batch');
    const indA = new Map(indRows.filter(r => r.level === pair.concA).map(r => [keyOf(r), r]));
    const indB = new Map(indRows.filter(r => r.level === pair.concB).map(r => [keyOf(r), r]));

    const allBatch = allRows.filter(r => r.table_type === 'all_batch');
    const abA = new Map(allBatch.filter(r => r.level === pair.concA).map(r => [keyOf(r), r]));
    const abB = new Map(allBatch.filter(r => r.level === pair.concB).map(r => [keyOf(r), r]));

    // ── ind_batch: 2-point regression per row per well ──
    for (const [key, odA] of mapA) {
      const odB = mapB.get(key);
      if (!odB) continue;
      const cRowA = indA.get(key);
      const cRowB = indB.get(key);
      if (!cRowA && !cRowB) continue;

      for (const f of WELL_FIELDS) {
        const x1 = getVal(odA, f);
        const x2 = getVal(odB, f);
        if (x1 === null || x2 === null) continue;
        const reg = linReg2(x1, pair.knownA, x2, pair.knownB);
        if (!reg) continue;
        if (cRowA) merge(cRowA, f, reg.m * x1 + reg.b);
        if (cRowB) merge(cRowB, f, reg.m * x2 + reg.b);
      }
    }

    // ── all_batch: least-squares regression per well across ALL rows ──
    for (const f of WELL_FIELDS) {
      const pts: { x: number; y: number }[] = [];
      for (const rA of rowsA) {
        const v = getVal(rA, f);
        if (v !== null) pts.push({ x: v, y: pair.knownA });
      }
      for (const rB of rowsB) {
        const v = getVal(rB, f);
        if (v !== null) pts.push({ x: v, y: pair.knownB });
      }
      const reg = linRegN(pts);
      if (!reg) continue;

      for (const [key, odA] of mapA) {
        const v = getVal(odA, f);
        if (v === null) continue;
        const cr = abA.get(key);
        if (cr) merge(cr, f, reg.m * v + reg.b);
      }
      for (const [key, odB] of mapB) {
        const v = getVal(odB, f);
        if (v === null) continue;
        const cr = abB.get(key);
        if (cr) merge(cr, f, reg.m * v + reg.b);
      }
    }
  }

  return [...result.values()];
}
