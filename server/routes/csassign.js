import { Router } from 'express';
import specDb from '../db/specDb.js';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────
function getCols() {
  return specDb.prepare('PRAGMA table_info(csassign)').all()
    .map(c => c.name).filter(c => c !== 'id');
}

// ── GET /api/csassign — all data + meta ───────────────────────────────
router.get('/', (_req, res) => {
  const rows = specDb.prepare('SELECT * FROM csassign ORDER BY Marker').all();
  const meta = specDb.prepare('SELECT * FROM cs_meta ORDER BY col_name').all();
  const columns = getCols();
  res.json({ columns, rows, meta });
});

// ── GET /api/csassign/meta — cs_meta only ─────────────────────────────
router.get('/meta', (_req, res) => {
  const meta = specDb.prepare('SELECT * FROM cs_meta ORDER BY col_name').all();
  res.json(meta);
});

// ── PUT /api/csassign/meta — update cs_meta (title, lot, expiry) ──────
// Body: { col_name, cs_title, cs_lot, cs_expiry }
router.put('/meta', (req, res) => {
  const { col_name, cs_title, cs_lot, cs_expiry } = req.body;
  if (!col_name) return res.status(400).json({ error: 'col_name required' });
  specDb.prepare(`
    INSERT INTO cs_meta (col_name, cs_title, cs_lot, cs_expiry, updated_at)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(col_name) DO UPDATE SET
      cs_title = excluded.cs_title,
      cs_lot = excluded.cs_lot,
      cs_expiry = excluded.cs_expiry,
      updated_at = datetime('now','localtime')
  `).run(col_name, cs_title ?? null, cs_lot ?? null, cs_expiry ?? null);
  const meta = specDb.prepare('SELECT * FROM cs_meta ORDER BY col_name').all();
  res.json(meta);
});

// ── PUT /api/csassign/:id — update single cell ───────────────────────
// Body: { field: value, ... }
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const cols = getCols();
  const updates = Object.entries(req.body).filter(([k]) => cols.includes(k));
  if (!updates.length) return res.status(400).json({ error: 'nothing to update' });
  const set = updates.map(([k]) => `"${k}" = ?`).join(', ');
  const vals = updates.map(([, v]) => v ?? null);
  specDb.prepare(`UPDATE csassign SET ${set} WHERE id = ?`).run(...vals, id);
  const row = specDb.prepare('SELECT * FROM csassign WHERE id = ?').get(id);
  res.json(row);
});

// ── POST /api/csassign — add row ─────────────────────────────────────
// Body: { Marker, ...values }
router.post('/', (req, res) => {
  const { Marker } = req.body;
  if (!Marker) return res.status(400).json({ error: 'Marker required' });
  const cols = getCols();
  const fields = Object.entries(req.body).filter(([k]) => cols.includes(k));
  const colNames = fields.map(([k]) => `"${k}"`).join(', ');
  const placeholders = fields.map(() => '?').join(', ');
  const vals = fields.map(([, v]) => v ?? null);
  try {
    const info = specDb.prepare(`INSERT INTO csassign (${colNames}) VALUES (${placeholders})`).run(...vals);
    const row = specDb.prepare('SELECT * FROM csassign WHERE id = ?').get(info.lastInsertRowid);
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── DELETE /api/csassign/:id — delete row ────────────────────────────
router.delete('/:id', (req, res) => {
  specDb.prepare('DELETE FROM csassign WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ── POST /api/csassign/column — add a new CS level column ────────────
// Body: { col_name, cs_title?, cs_lot?, cs_expiry? }
router.post('/column', (req, res) => {
  const { col_name, cs_title, cs_lot, cs_expiry } = req.body;
  if (!col_name) return res.status(400).json({ error: 'col_name required' });
  const existing = getCols();
  if (existing.includes(col_name)) return res.status(400).json({ error: 'column already exists' });
  try {
    specDb.exec(`ALTER TABLE csassign ADD COLUMN "${col_name}" TEXT`);
    specDb.prepare(`
      INSERT INTO cs_meta (col_name, cs_title, cs_lot, cs_expiry, updated_at)
      VALUES (?, ?, ?, ?, datetime('now','localtime'))
      ON CONFLICT(col_name) DO UPDATE SET
        cs_title = excluded.cs_title, cs_lot = excluded.cs_lot,
        cs_expiry = excluded.cs_expiry, updated_at = datetime('now','localtime')
    `).run(col_name, cs_title ?? null, cs_lot ?? null, cs_expiry ?? null);
    res.json({ ok: true, columns: getCols() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── DELETE /api/csassign/column/:name — remove a CS level column ─────
router.delete('/column/:name', (req, res) => {
  const col = req.params.name;
  if (col === 'Marker') return res.status(400).json({ error: 'cannot delete Marker column' });
  // SQLite doesn't support DROP COLUMN before 3.35, rebuild table
  const cols = getCols().filter(c => c !== col);
  if (cols.length === getCols().length) return res.status(404).json({ error: 'column not found' });
  try {
    const colDefs = cols.map(c => c === 'Marker' ? '"Marker" TEXT NOT NULL UNIQUE' : `"${c}" TEXT`).join(', ');
    const colList = cols.map(c => `"${c}"`).join(', ');
    specDb.exec(`
      CREATE TABLE csassign_new (id INTEGER PRIMARY KEY AUTOINCREMENT, ${colDefs});
      INSERT INTO csassign_new (${colList}) SELECT ${colList} FROM csassign;
      DROP TABLE csassign;
      ALTER TABLE csassign_new RENAME TO csassign;
    `);
    specDb.prepare('DELETE FROM cs_meta WHERE col_name = ?').run(col);
    res.json({ ok: true, columns: getCols() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/csassign/paste — bulk paste (Excel-like) ───────────────
// Body: { startRow: id, startCol: col_name, data: [[cell, ...], ...] }
router.post('/paste', (req, res) => {
  const { startRow, startCol, data } = req.body;
  if (!Array.isArray(data) || !data.length) return res.status(400).json({ error: 'data required' });

  const cols = getCols();
  const startIdx = cols.indexOf(startCol);
  if (startIdx < 0) return res.status(400).json({ error: 'invalid startCol' });

  // Get all rows sorted by Marker
  const allRows = specDb.prepare('SELECT * FROM csassign ORDER BY Marker').all();
  const startRowIdx = allRows.findIndex(r => r.id === startRow);
  if (startRowIdx < 0) return res.status(400).json({ error: 'invalid startRow' });

  let updated = 0;
  let inserted = 0;

  specDb.transaction(() => {
    for (let ri = 0; ri < data.length; ri++) {
      const rowData = data[ri];
      const targetRowIdx = startRowIdx + ri;

      if (targetRowIdx < allRows.length) {
        // Update existing row
        const row = allRows[targetRowIdx];
        for (let ci = 0; ci < rowData.length; ci++) {
          const colIdx = startIdx + ci;
          if (colIdx >= cols.length) break;
          const col = cols[colIdx];
          specDb.prepare(`UPDATE csassign SET "${col}" = ? WHERE id = ?`).run(rowData[ci] ?? null, row.id);
        }
        updated++;
      } else {
        // Insert new row
        const marker = rowData[0] || `NEW_${Date.now()}_${ri}`;
        const info = specDb.prepare('INSERT INTO csassign (Marker) VALUES (?)').run(marker);
        for (let ci = 1; ci < rowData.length; ci++) {
          const colIdx = startIdx + ci;
          if (colIdx >= cols.length) break;
          const col = cols[colIdx];
          specDb.prepare(`UPDATE csassign SET "${col}" = ? WHERE id = ?`).run(rowData[ci] ?? null, info.lastInsertRowid);
        }
        inserted++;
      }
    }
  })();

  const rows = specDb.prepare('SELECT * FROM csassign ORDER BY Marker').all();
  res.json({ ok: true, updated, inserted, rows });
});

export default router;
