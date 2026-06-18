import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
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
import personnelRoutes from './routes/personnel.js';
import templateRoutes from './routes/template.js';
import tuttiScanRecordsRoutes from './routes/tuttiScanRecords.js';
import rdBuildLineRoutes from './routes/rdBuildLine.js';
import reviewTaskRoutes from './routes/reviewTasks.js';
import tuttiSkuListRoutes from './routes/tuttiSkuList.js';
import tuttiShipmentRoutes from './routes/tuttiShipment.js';
import { ensureSchema } from './db/specRdsSync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
app.use('/api/personnel', personnelRoutes);
app.use('/api/template', templateRoutes);
app.use('/api/v1', tuttiScanRecordsRoutes);
app.use('/api/v1/pre-assignment', rdBuildLineRoutes);
app.use('/api/v1/pre-assignment', reviewTaskRoutes);
app.use('/api/tutti-sku-list', tuttiSkuListRoutes);
app.use('/api/tutti-shipment', tuttiShipmentRoutes);

// ── Proxy to assayprocess backend (port 8200) for baseline-group data ─────
app.post('/api/assayprocess-proxy/baseline-group', async (req, res) => {
  try {
    const upstream = await fetch('http://127.0.0.1:8200/api/baseline-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ ok: false, error: { code: 'PROXY_ERROR', message: err.message } });
  }
});

// ── Fetch baseline points from RDS for curve fitting ──────────────────────
import { queryWithRetry } from './db/pgPool.js';
import specDb from './db/specDb.js';

app.post('/api/v1/pre-assignment/baseline-points', async (req, res) => {
  const { lot_no, panel_name, analyze_item, analyze_date } = req.body;
  if (!lot_no || !panel_name || !analyze_item) {
    return res.status(400).json({ ok: false, error: 'lot_no, panel_name, analyze_item required' });
  }

  try {
    // 1. Fetch ALL baseline records from RDS (all individual wells, not averaged)
    const dateClause = analyze_date ? 'AND analyze_date = $4' : '';
    const params = [lot_no, panel_name, analyze_item];
    if (analyze_date) params.push(analyze_date);

    const result = await queryWithRetry(`
      SELECT patient_id, final_delta_od, test_well, analyze_date, test_zone
      FROM panel_production.assay_process_records
      WHERE baseline = 'true'
        AND (lot_no = $1 OR lot_code = $1)
        AND panel_name = $2
        AND analyze_item = $3
        ${dateClause}
        AND LOWER(TRIM(patient_id)) IN ('control-1','control-2','control-3','control-4')
      ORDER BY patient_id, test_well
    `, params);

    // 2. Fetch concentrations from csassign
    let concs = { 'control-1': null, 'control-2': null, 'control-3': null, 'control-4': null };
    try {
      const csRow = specDb.prepare('SELECT * FROM csassign WHERE Marker = ?').get(analyze_item);
      if (csRow) {
        for (const [col, val] of Object.entries(csRow)) {
          if (col === 'id' || col === 'Marker') continue;
          const numVal = parseFloat(val);
          if (!isFinite(numVal)) continue;
          const colLower = col.toLowerCase();
          if (colLower.startsWith('l1') && concs['control-1'] === null) concs['control-1'] = numVal;
          else if (colLower.startsWith('l2') && concs['control-2'] === null) concs['control-2'] = numVal;
          else if (colLower.startsWith('n1') && concs['control-3'] === null) concs['control-3'] = numVal;
          else if (colLower.startsWith('n3') && concs['control-4'] === null) concs['control-4'] = numVal;
        }
      }
    } catch { /* ignore csassign errors */ }

    // 3. Build points array — ALL individual points with conc + OD
    const points = result.rows.map((row, idx) => ({
      idx,
      patient_id: row.patient_id,
      conc: concs[row.patient_id.toLowerCase()] || null,
      final_delta_od: parseFloat(row.final_delta_od) || null,
      test_well: row.test_well,
      test_zone: row.test_zone || null,
    }));

    res.json({ ok: true, data: { points, concs, analyze_item, lot_no, panel_name } });
  } catch (err) {
    res.status(500).json({ ok: false, error: { code: 'RDS_QUERY_FAILED', message: err.message } });
  }
});

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

// ── Serve user manual static files ────────────────────────────────────────
app.use('/qc-web/usermanu', express.static(
  path.join(__dirname, '..', 'usermanu'),
  {
    index: 'index.html',
    extensions: ['html'],
    fallthrough: true,
  }
));

app.use('/tutti-shipment', express.static(
  path.join(__dirname, '..', 'tutti-shipment', 'dist'),
  {
    index: 'index.html',
    extensions: ['html'],
    fallthrough: true,
  }
));

// 404 fallback for user manual site
app.use('/qc-web/usermanu/*path', (req, res) => {
  res.status(404).sendFile(
    path.join(__dirname, '..', 'usermanu', '404.html')
  );
});

const PORT = process.env.PORT || 3201;
const server = app.listen(PORT, '127.0.0.1', () => {
  const address = server.address();
  const host = typeof address === 'object' && address ? address.address : 'localhost';
  const port = typeof address === 'object' && address ? address.port : PORT;
  console.log(`🚀 API server on http://${host}:${port}`);

  ensureSchema()
    .then((ready) => {
      if (ready) {
        console.log('[specRdsSync] Schema ready');
      } else {
        console.warn('[specRdsSync] Schema setup skipped or failed');
      }
    })
    .catch((error) => {
      console.warn(`[specRdsSync] Schema setup failed: ${error.message}`);
    });
});

server.on('error', (err) => {
  console.error('[server] listen error:', err);
  process.exit(1);
});

server.on('close', () => {
  console.error('[server] listener closed unexpectedly');
});
