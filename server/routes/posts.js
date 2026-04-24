import { Router } from 'express';
import db from '../db/sqlite.js';
import specDb from '../db/specDb.js';

const router = Router();

function normalizeYear(year) {
  if (typeof year !== 'string') return null;
  const trimmed = year.trim();
  return /^\d{4}$/.test(trimmed) ? trimmed : null;
}

function yearLike(year) {
  return `${year}%`;
}

/** Lookup well position from ipqcwell table for a marker */
function lookupWell(marker) {
  let row = specDb.prepare('SELECT * FROM ipqcwell WHERE "Marker" = ?').get(marker);
  if (!row) row = specDb.prepare('SELECT * FROM ipqcwell WHERE "Marker" = ? COLLATE NOCASE').get(marker);
  if (!row) {
    const stripped = marker.replace(/^Q/i, '').replace(/-[A-Z]$/i, '');
    row = specDb.prepare('SELECT * FROM ipqcwell WHERE "Marker" = ? COLLATE NOCASE').get(stripped);
  }
  if (!row) return null;
  const nums = [];
  for (let i = 2; i <= 22; i++) { if (row[`w${i}`]) nums.push(i); }
  if (!nums.length) return null;
  const ranges = [];
  let s = nums[0], e = nums[0];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === e + 1) { e = nums[i]; } else { ranges.push(s === e ? `${s}` : `${s}~${e}`); s = e = nums[i]; }
  }
  ranges.push(s === e ? `${s}` : `${s}~${e}`);
  return ranges.join(', ');
}

// ── GET /api/posts/markers ────────────────────────────────────────────────
router.get('/markers', (req, res) => {
  const year = normalizeYear(req.query.year);
  const sql = year
    ? `SELECT DISTINCT bead_name FROM posts WHERE insp_date LIKE ? ORDER BY bead_name`
    : `SELECT DISTINCT bead_name FROM posts ORDER BY bead_name`;
  const rows = year ? db.prepare(sql).all(yearLike(year)) : db.prepare(sql).all();
  res.json(rows.map(r => r.bead_name));
});

// ── GET /api/posts/sheets?bead_name=X ────────────────────────────────────
router.get('/sheets', (req, res) => {
  const { bead_name } = req.query;
  const year = normalizeYear(req.query.year);
  if (!bead_name) return res.status(400).json({ error: 'bead_name required' });
  const sql = year ? `
    SELECT sheet_name,
           MIN(insp_date) AS insp_date,
           COUNT(*) AS combo_count
    FROM posts
    WHERE bead_name = ? AND insp_date LIKE ?
    GROUP BY sheet_name
    ORDER BY insp_date DESC, sheet_name DESC
  ` : `
    SELECT sheet_name,
           MIN(insp_date) AS insp_date,
           COUNT(*) AS combo_count
    FROM posts
    WHERE bead_name = ?
    GROUP BY sheet_name
    ORDER BY insp_date DESC, sheet_name DESC
  `;
  const rows = year
    ? db.prepare(sql).all(bead_name, yearLike(year))
    : db.prepare(sql).all(bead_name);
  res.json(rows);
});

// ── GET /api/posts/records?bead_name=X&sheet_name=Y ──────────────────────
router.get('/records', (req, res) => {
  const { bead_name, sheet_name } = req.query;
  const year = normalizeYear(req.query.year);
  if (!bead_name || !sheet_name) return res.status(400).json({ error: 'bead_name and sheet_name required' });
  const sql = year ? `
    SELECT * FROM posts
    WHERE bead_name = ? AND sheet_name = ? AND insp_date LIKE ?
    ORDER BY combo_idx
  ` : `
    SELECT * FROM posts
    WHERE bead_name = ? AND sheet_name = ?
    ORDER BY combo_idx
  `;
  const rows = year
    ? db.prepare(sql).all(bead_name, sheet_name, yearLike(year))
    : db.prepare(sql).all(bead_name, sheet_name);
  // Auto-fill fw from ipqcwell if missing
  for (const r of rows) {
    if (!r.fw) {
      r.fw = lookupWell(r.marker || r.bead_name);
    }
  }
  res.json(rows);
});

// ── GET /api/posts/:id ────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// ── PUT /api/posts/:id ────────────────────────────────────────────────────
// Body: partial object of columns to update (no id/bead_name/sheet_name overwrite)
const READONLY_COLS = new Set(['id', 'bead_name', 'file_name', 'sheet_name', 'combo_idx']);

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  const body = req.body;
  const updates = Object.entries(body).filter(([k]) => !READONLY_COLS.has(k));
  if (updates.length === 0) return res.status(400).json({ error: 'nothing to update' });

  const setClauses = updates.map(([k]) => `${k} = @${k}`).join(', ');
  const params = Object.fromEntries(updates);
  params.id = id;

  try {
    const info = db.prepare(`UPDATE posts SET ${setClauses} WHERE id = @id`).run(params);
    if (info.changes === 0) return res.status(404).json({ error: 'not found' });
    const updated = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
