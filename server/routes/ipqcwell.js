import { Router } from 'express';
import specDb from '../db/specDb.js';

const router = Router();

const WELL_COLS = [
  'Marker','w2','w3','w4','w5','w6','w7','w8','w9','w10',
  'w11','w12','w13','w14','w15','w16','w17','w18','w19','w20','w21','w22',
];

/** Summarise filled wells for a marker row → e.g. "4~6" or "8~19" */
function summariseWells(row) {
  const nums = [];
  for (let i = 2; i <= 22; i++) {
    if (row[`w${i}`]) nums.push(i);
  }
  if (!nums.length) return null;
  const ranges = [];
  let s = nums[0], e = nums[0];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === e + 1) { e = nums[i]; }
    else { ranges.push(s === e ? `${s}` : `${s}~${e}`); s = e = nums[i]; }
  }
  ranges.push(s === e ? `${s}` : `${s}~${e}`);
  return ranges.join(', ');
}

// Ensure table exists
specDb.exec(`
  CREATE TABLE IF NOT EXISTS ipqcwell (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    "Marker" TEXT NOT NULL UNIQUE,
    w2 TEXT, w3 TEXT, w4 TEXT, w5 TEXT, w6 TEXT, w7 TEXT,
    w8 TEXT, w9 TEXT, w10 TEXT, w11 TEXT, w12 TEXT, w13 TEXT,
    w14 TEXT, w15 TEXT, w16 TEXT, w17 TEXT, w18 TEXT, w19 TEXT,
    w20 TEXT, w21 TEXT, w22 TEXT,
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);

// GET all
router.get('/', (_req, res) => {
  const rows = specDb.prepare('SELECT * FROM ipqcwell ORDER BY id').all();
  res.json({ columns: WELL_COLS, rows });
});

// POST — add row
router.post('/', (req, res) => {
  const { Marker } = req.body;
  if (!Marker) return res.status(400).json({ error: 'Marker required' });
  try {
    specDb.prepare('INSERT INTO ipqcwell ("Marker") VALUES (?)').run(Marker.trim());
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message.includes('UNIQUE') ? '此 Marker 已存在' : err.message });
  }
});

// PUT /:id — update cell(s)
router.put('/:id', (req, res) => {
  const updates = req.body; // { col: val, ... }
  const allowed = [...WELL_COLS];
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(updates)) {
    if (!allowed.includes(k)) continue;
    sets.push(`"${k}" = ?`);
    vals.push(v ?? null);
  }
  if (!sets.length) return res.status(400).json({ error: 'No valid fields' });
  sets.push("updated_at = datetime('now','localtime')");
  vals.push(Number(req.params.id));
  try {
    specDb.prepare(`UPDATE ipqcwell SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const row = specDb.prepare('SELECT * FROM ipqcwell WHERE id = ?').get(Number(req.params.id));
    res.json({ ok: true, row });
  } catch (err) {
    res.status(400).json({ error: err.message.includes('UNIQUE') ? '此 Marker 已存在' : err.message });
  }
});

// DELETE /:id
router.delete('/:id', (req, res) => {
  specDb.prepare('DELETE FROM ipqcwell WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// GET /api/ipqcwell/lookup/:marker — return well summary string for a marker
router.get('/lookup/:marker', (req, res) => {
  const marker = req.params.marker;
  // Try exact match first, then case-insensitive, then strip prefix (Q, t, etc.)
  let row = specDb.prepare('SELECT * FROM ipqcwell WHERE "Marker" = ?').get(marker);
  if (!row) row = specDb.prepare('SELECT * FROM ipqcwell WHERE "Marker" = ? COLLATE NOCASE').get(marker);
  if (!row) {
    // Strip common prefixes: QPHOS→PHOS, QALT-A→ALT, tGLU-B→tGLU
    const stripped = marker.replace(/^Q/i, '').replace(/-[A-Z]$/i, '');
    row = specDb.prepare('SELECT * FROM ipqcwell WHERE "Marker" = ? COLLATE NOCASE').get(stripped);
  }
  if (!row) return res.json({ marker, well_position: null });
  res.json({ marker, well_position: summariseWells(row) });
});

export default router;
