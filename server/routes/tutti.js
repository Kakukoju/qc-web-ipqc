import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import db from '../db/sqlite.js';
import specDb from '../db/specDb.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const XLSX_OPTS = {
  type: 'buffer', cellStyles: false, cellNF: false,
  cellHTML: false, cellFormula: false, sheetStubs: false, bookVBA: false,
};

// ── Helpers ───────────────────────────────────────────────────────────────

function linearRegression(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const xBar = xs.reduce((a, b) => a + b, 0) / n;
  const yBar = ys.reduce((a, b) => a + b, 0) / n;
  const ssxy = xs.reduce((s, x, i) => s + (x - xBar) * (ys[i] - yBar), 0);
  const ssxx = xs.reduce((s, x) => s + (x - xBar) ** 2, 0);
  if (ssxx === 0) return null;
  const slope = ssxy / ssxx;
  const intercept = yBar - slope * xBar;
  const yHats = xs.map(x => slope * x + intercept);
  const ssTot = ys.reduce((s, y) => s + (y - yBar) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - yHats[i]) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { slope, intercept, r2 };
}

// Parse a sheet for L1/L2/N1/N3 OD readings using flexible header search.
// Returns { l1: number[], l2: number[], n1: number[], n3: number[] }
function parseOdFromSheet(ws) {
  const ref = ws['!ref'];
  if (!ref) return {};
  const range = XLSX.utils.decode_range(ref);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      row.push(cell ? cell.v : null);
    }
    rows.push(row);
  }

  const LEVEL_KEYS = { l1: /^l1$/i, l2: /^l2$/i, n1: /^n1$/i, n3: /^n3$/i };
  const found = { l1: [], l2: [], n1: [], n3: [] };

  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const cell = String(rows[r][c] ?? '').trim();
      for (const [level, re] of Object.entries(LEVEL_KEYS)) {
        if (re.test(cell)) {
          // Collect numeric values in the same row to the right
          const rowVals = [];
          for (let cc = c + 1; cc < rows[r].length && rowVals.length < 16; cc++) {
            const v = rows[r][cc];
            if (typeof v === 'number' && isFinite(v) && v > 0) rowVals.push(v);
            else if (rowVals.length > 0 && v == null) break;
          }
          // Collect numeric values in the same column downward
          const colVals = [];
          for (let rr = r + 1; rr < rows.length && colVals.length < 16; rr++) {
            const v = rows[rr][c];
            if (typeof v === 'number' && isFinite(v) && v > 0) colVals.push(v);
            else if (colVals.length > 0 && v == null) break;
          }
          const vals = rowVals.length >= colVals.length ? rowVals : colVals;
          if (vals.length > 0 && found[level].length === 0) found[level] = vals;
        }
      }
    }
  }
  return found;
}

// Look up csassign concentrations for a marker.
// Returns { l1: number|null, l2: number|null, n1: number|null, n3: number|null }
function lookupConcentrations(marker) {
  let row;
  try {
    row = specDb.prepare('SELECT * FROM csassign WHERE Marker = ?').get(marker);
  } catch { return {}; }
  if (!row) return {};

  let meta;
  try {
    meta = specDb.prepare('SELECT col_name, cs_title FROM cs_meta').all();
  } catch { meta = []; }

  const result = { l1: null, l2: null, n1: null, n3: null };
  const LEVEL_RE = { l1: /^l1[_\s]/i, l2: /^l2[_\s]/i, n1: /^n1[_\s]/i, n3: /^n3[_\s]/i };

  for (const [col, val] of Object.entries(row)) {
    if (col === 'id' || col === 'Marker') continue;
    const numVal = typeof val === 'number' ? val : parseFloat(val);
    if (!isFinite(numVal)) continue;

    // Identify level from column name prefix or cs_title
    const metaRow = meta.find(m => m.col_name === col);
    const label = metaRow?.cs_title ?? col;
    for (const [level, re] of Object.entries(LEVEL_RE)) {
      if (re.test(col) || re.test(label)) {
        if (result[level] === null) result[level] = numVal;
        break;
      }
    }
  }
  return result;
}

// ── GET /api/tutti — list all curves ─────────────────────────────────────
router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, marker, work_order, lot_d, lot_bigD, lot_u, batch_combo,
           quantity, prod_date, fill_expiry,
           od_slope, od_intercept, od_r2,
           baseline_l1, baseline_l2, baseline_n1, baseline_n3,
           status, confirmed_by, confirmed_at, notes, created_at
    FROM tutti_curves ORDER BY created_at DESC
  `).all();
  res.json(rows);
});

// ── GET /api/tutti/cs-concentrations?marker= — for import modal ──────────
router.get('/cs-concentrations', (req, res) => {
  const marker = (req.query.marker || '').trim();
  if (!marker) return res.json({});
  res.json(lookupConcentrations(marker));
});

// ── GET /api/tutti/:id — full record ─────────────────────────────────────
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM tutti_curves WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.raw_od_json) {
    try { row.raw_od = JSON.parse(row.raw_od_json); } catch { row.raw_od = {}; }
  }
  res.json(row);
});

// ── POST /api/tutti/import — upload Excel + batch info, calc regression ───
// multipart/form-data: file (optional), marker, work_order, lot_d, lot_bigD,
// lot_u, batch_combo, quantity, prod_date, fill_expiry,
// plus optional od_l1_json/od_l2_json/od_n1_json/od_n3_json (JSON arrays for manual entry)
router.post('/import', upload.single('file'), (req, res) => {
  const {
    marker, work_order, lot_d, lot_bigD, lot_u, batch_combo,
    quantity, prod_date, fill_expiry, notes,
  } = req.body;

  if (!marker) return res.status(400).json({ error: 'marker required' });

  // Parse OD readings: from Excel file or from manual JSON fields
  let odData = { l1: [], l2: [], n1: [], n3: [] };

  if (req.file) {
    try {
      const wb = XLSX.read(req.file.buffer, XLSX_OPTS);
      const ws = wb.Sheets[wb.SheetNames[0]];
      odData = parseOdFromSheet(ws);
    } catch (e) {
      console.error('[tutti] xlsx parse error:', e.message);
    }
  }

  // Allow manual OD override per level
  for (const level of ['l1', 'l2', 'n1', 'n3']) {
    const key = `od_${level}_json`;
    if (req.body[key]) {
      try { const parsed = JSON.parse(req.body[key]); if (Array.isArray(parsed)) odData[level] = parsed; }
      catch { /* ignore */ }
    }
  }

  // Look up known concentrations from csassign
  const concs = lookupConcentrations(marker);

  // Compute mean OD per level (for regression)
  const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const meanL1 = mean(odData.l1);
  const meanL2 = mean(odData.l2);
  const meanN1 = mean(odData.n1);
  const meanN3 = mean(odData.n3);

  // Build regression points: [conc, meanOD] where both are non-null
  const points = [
    [concs.l1, meanL1], [concs.l2, meanL2],
    [concs.n1, meanN1], [concs.n3, meanN3],
  ].filter(([x, y]) => x != null && y != null);

  let reg = null;
  if (points.length >= 2) {
    reg = linearRegression(points.map(p => p[0]), points.map(p => p[1]));
  }

  const batchCombo = batch_combo ||
    [lot_d, lot_bigD, lot_u].filter(Boolean).join('/') || null;

  const row = db.prepare(`
    INSERT INTO tutti_curves
      (marker, work_order, lot_d, lot_bigD, lot_u, batch_combo,
       quantity, prod_date, fill_expiry,
       od_slope, od_intercept, od_r2,
       baseline_l1, baseline_l2, baseline_n1, baseline_n3,
       raw_od_json, notes, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')
  `).run(
    marker,
    work_order || null, lot_d || null, lot_bigD || null, lot_u || null,
    batchCombo,
    quantity ? Number(quantity) : null,
    prod_date || null, fill_expiry || null,
    reg?.slope ?? null, reg?.intercept ?? null, reg?.r2 ?? null,
    meanL1, meanL2, meanN1, meanN3,
    JSON.stringify(odData),
    notes || null,
  );

  const saved = db.prepare('SELECT * FROM tutti_curves WHERE id = ?').get(row.lastInsertRowid);
  if (saved.raw_od_json) {
    try { saved.raw_od = JSON.parse(saved.raw_od_json); } catch { saved.raw_od = {}; }
  }
  res.json({ ...saved, concs });
});

// ── PUT /api/tutti/:id — update editable fields ───────────────────────────
const EDITABLE = new Set([
  'work_order', 'lot_d', 'lot_bigD', 'lot_u', 'batch_combo',
  'quantity', 'prod_date', 'fill_expiry',
  'od_slope', 'od_intercept', 'od_r2',
  'baseline_l1', 'baseline_l2', 'baseline_n1', 'baseline_n3',
  'notes',
]);

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const row = db.prepare('SELECT id, status FROM tutti_curves WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const updates = Object.entries(req.body).filter(([k]) => EDITABLE.has(k));
  if (!updates.length) return res.status(400).json({ error: 'nothing to update' });

  const set = updates.map(([k]) => `${k} = ?`).join(', ');
  const vals = updates.map(([, v]) => v ?? null);
  db.prepare(`UPDATE tutti_curves SET ${set} WHERE id = ?`).run(...vals, id);

  const updated = db.prepare('SELECT * FROM tutti_curves WHERE id = ?').get(id);
  if (updated.raw_od_json) {
    try { updated.raw_od = JSON.parse(updated.raw_od_json); } catch { updated.raw_od = {}; }
  }
  res.json(updated);
});

// ── PUT /api/tutti/:id/confirm — confirm ─────────────────────────────────
router.put('/:id/confirm', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const { confirmed_by } = req.body;
  if (!confirmed_by?.trim()) return res.status(400).json({ error: 'confirmed_by required' });

  const row = db.prepare('SELECT id FROM tutti_curves WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });

  db.prepare(`
    UPDATE tutti_curves
    SET status = 'confirmed', confirmed_by = ?, confirmed_at = datetime('now','localtime')
    WHERE id = ?
  `).run(confirmed_by.trim(), id);

  res.json(db.prepare('SELECT * FROM tutti_curves WHERE id = ?').get(id));
});

// ── DELETE /api/tutti/:id — delete (pending only) ─────────────────────────
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const row = db.prepare('SELECT id, status FROM tutti_curves WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.status === 'confirmed') return res.status(400).json({ error: 'cannot delete confirmed record' });
  db.prepare('DELETE FROM tutti_curves WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
