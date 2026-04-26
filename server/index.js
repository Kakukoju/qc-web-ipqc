import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import drbeadsRoutes from './routes/drbeads.js';
import postsRoutes from './routes/posts.js';
import rawdataRoutes from './routes/rawdata.js';
import scheduleRoutes from './routes/schedule.js';
import specRoutes from './routes/spec.js';
import csassignRoutes from './routes/csassign.js';
import machinePnRoutes from './routes/machinePn.js';
import ipqcwellRoutes from './routes/ipqcwell.js';
import excelImportRoutes from './routes/excel-import.js';
import tuttiRoutes from './routes/tutti.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/drbeads', drbeadsRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/rawdata', rawdataRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/spec', specRoutes);
app.use('/api/csassign', csassignRoutes);
app.use('/api/machine-pn', machinePnRoutes);
app.use('/api/ipqcwell', ipqcwellRoutes);
app.use('/api/excel-import', excelImportRoutes);
app.use('/api/tutti', tuttiRoutes);

// ── Global search across drbeadinspection + posts ─────────────────────────
import db from './db/sqlite.js';
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);
  const like = `%${q}%`;
  const t1 = db.prepare(`
    SELECT DISTINCT bead_name, sheet_name, 'table1' AS tab,
           MAX(insp_date) AS insp_date
    FROM drbeadinspection
    WHERE bead_name LIKE @q OR sheet_name LIKE @q
       OR batch_combo LIKE @q OR d_lot LIKE @q
       OR bigD_lot LIKE @q OR u_lot LIKE @q
       OR d_work_order LIKE @q OR bigD_work_order LIKE @q OR u_work_order LIKE @q
    GROUP BY bead_name, sheet_name
    ORDER BY insp_date DESC LIMIT 20
  `).all({ q: like });
  const t2 = db.prepare(`
    SELECT DISTINCT bead_name, sheet_name, 'table2' AS tab,
           MAX(insp_date) AS insp_date
    FROM posts
    WHERE bead_name LIKE @q OR sheet_name LIKE @q
       OR marker LIKE @q OR lot_d LIKE @q
       OR lot_bigD LIKE @q OR lot_u LIKE @q
       OR work_order_d LIKE @q OR work_order_bigD LIKE @q OR work_order_u LIKE @q
    GROUP BY bead_name, sheet_name
    ORDER BY insp_date DESC LIMIT 20
  `).all({ q: like });
  res.json([...t1, ...t2].slice(0, 30));
});

// ── Migrations ────────────────────────────────────────────────────────────
(function migrate() {
  const cols = db.prepare("PRAGMA table_info(rawdata)").all().map(c => c.name);
  if (!cols.includes('d_lot'))    db.exec('ALTER TABLE rawdata ADD COLUMN d_lot TEXT');
  if (!cols.includes('bigD_lot')) db.exec('ALTER TABLE rawdata ADD COLUMN bigD_lot TEXT');
  if (!cols.includes('u_lot'))    db.exec('ALTER TABLE rawdata ADD COLUMN u_lot TEXT');
  // posts: add remarks + hold_reason columns
  const postCols = db.prepare("PRAGMA table_info(posts)").all().map(c => c.name);
  if (!postCols.includes('remarks'))     db.exec('ALTER TABLE posts ADD COLUMN remarks TEXT');
  if (!postCols.includes('hold_reason')) db.exec('ALTER TABLE posts ADD COLUMN hold_reason TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_dr_bead_sheet ON drbeadinspection(bead_name, sheet_name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_bead_sheet ON posts(bead_name, sheet_name)');
  db.exec(`CREATE TABLE IF NOT EXISTS tutti_curves (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    marker        TEXT NOT NULL,
    work_order    TEXT,
    lot_d         TEXT, lot_bigD TEXT, lot_u TEXT,
    batch_combo   TEXT,
    quantity      INTEGER,
    prod_date     TEXT,
    fill_expiry   TEXT,
    od_slope      REAL,
    od_intercept  REAL,
    od_r2         REAL,
    baseline_l1   REAL, baseline_l2 REAL,
    baseline_n1   REAL, baseline_n3 REAL,
    raw_od_json   TEXT,
    status        TEXT DEFAULT 'pending',
    confirmed_by  TEXT,
    confirmed_at  TEXT,
    notes         TEXT,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  )`);
})();

const PORT = process.env.PORT || 3201;
app.listen(PORT, () => console.log(`🚀 API server on http://localhost:${PORT}`));
