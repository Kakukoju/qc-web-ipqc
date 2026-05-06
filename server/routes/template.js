/**
 * /api/template – 模板測試模式 API
 *
 * 模板 = 定義一盤裡哪些 well 屬於哪個 marker
 * 排產匯入：為模板中每個 marker 分別輸入 lot，自動建立 rawdata/drbeadinspection/posts
 * sheet_name：各 marker 共用格式如 K+lot末3碼-ALTA+lot末3碼
 * Load CSV：一盤 CSV 按模板 well 配置拆分，OD 寫入各 marker 各自的 rawdata
 */
import { Router } from 'express';
import db from '../db/sqlite.js';

const router = Router();

// ── Ensure measurement_templates table exists ─────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS measurement_templates (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL UNIQUE,
  markers TEXT NOT NULL,
  wells   TEXT NOT NULL
)`);

// ── CRUD ──────────────────────────────────────────────────────────────

// GET /api/template — list all templates
router.get('/', (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM measurement_templates ORDER BY name').all();
    res.json(rows.map(r => ({
      ...r,
      markers: JSON.parse(r.markers),
      wells: JSON.parse(r.wells),
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/template/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM measurement_templates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ ...row, markers: JSON.parse(row.markers), wells: JSON.parse(row.wells) });
});

// POST /api/template — create or update
// Body: { name, markers: string[], wells: [{wellNum, assignment}] }
router.post('/', (req, res) => {
  const { name, markers, wells } = req.body;
  if (!name || !Array.isArray(markers) || !Array.isArray(wells))
    return res.status(400).json({ error: 'name, markers[], wells[] required' });
  try {
    db.prepare(`
      INSERT INTO measurement_templates (name, markers, wells) VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET markers = excluded.markers, wells = excluded.wells
    `).run(name, JSON.stringify(markers), JSON.stringify(wells));
    res.json({ ok: true, name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/template/:id
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM measurement_templates WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Template-mode schedule import ─────────────────────────────────────
// POST /api/template/import
// Body: { templateId, markerLots: { [marker]: { lot, work_order?, prod_date? } }, inspDate? }
//
// For each marker in the template:
//   1. Build sheet_name from all markers' lot suffixes
//   2. Create drbeadinspection + posts + rawdata skeleton rows
router.post('/import', (req, res) => {
  const { templateId, markerLots, inspDate } = req.body;
  if (!templateId || !markerLots) return res.status(400).json({ error: 'templateId and markerLots required' });

  const tmpl = db.prepare('SELECT * FROM measurement_templates WHERE id = ?').get(templateId);
  if (!tmpl) return res.status(404).json({ error: 'template not found' });

  const markers = JSON.parse(tmpl.markers);
  const wells = JSON.parse(tmpl.wells);
  const today = inspDate || new Date().toISOString().slice(0, 10);

  // Build shared sheet_name: K+lot末3碼-ALTA+lot末3碼
  const sheetParts = markers.map(m => {
    const info = markerLots[m];
    if (!info?.lot) return m;
    const suffix = info.lot.slice(-3);
    const tag = m.replace(/-/g, '');
    return tag + suffix;
  });
  const sheetName = sheetParts.join('-');

  // Get wells per marker
  const wellsByMarker = new Map();
  for (const w of wells) {
    const a = w.assignment;
    if (!a || a === 'Blank') continue;
    if (!wellsByMarker.has(a)) wellsByMarker.set(a, []);
    wellsByMarker.get(a).push(w.wellNum);
  }

  const txn = db.transaction(() => {
    const results = [];

    for (const marker of markers) {
      const info = markerLots[marker];
      if (!info?.lot) { results.push({ marker, status: 'skipped', reason: '無 lot' }); continue; }

      const lot = info.lot;
      const wo = info.work_order || null;
      const prodDate = info.prod_date || null;

      // Check duplicate
      const exists = db.prepare(
        'SELECT 1 FROM drbeadinspection WHERE bead_name = ? AND sheet_name = ? LIMIT 1'
      ).get(marker, sheetName);
      if (exists) { results.push({ marker, status: 'skipped', reason: '已存在' }); continue; }

      // Insert drbeadinspection
      db.prepare(`
        INSERT INTO drbeadinspection (bead_name, sheet_name, batch_col, batch_combo, insp_date,
          bigD_work_order, bigD_lot, bigD_prod_date)
        VALUES (?, ?, 17, ?, ?, ?, ?, ?)
      `).run(marker, sheetName, lot, today, wo, lot, prodDate);

      // Insert posts
      db.prepare(`
        INSERT INTO posts (bead_name, sheet_name, combo_idx, marker, insp_date,
          work_order_bigD, lot_bigD, prod_date_bigD)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?)
      `).run(marker, sheetName, marker, today, wo, lot, prodDate);

      // Create rawdata skeleton — resolve levels from existing marker data or use defaults
      let tableLevels = db.prepare(`
        SELECT DISTINCT table_type, level FROM rawdata WHERE bead_name = ?
        ORDER BY table_type, level
      `).all(marker);

      if (!tableLevels.length) {
        tableLevels = [
          { table_type: 'well_od', level: 'L1 OD' }, { table_type: 'well_od', level: 'L2 OD' },
          { table_type: 'well_od', level: 'N1 OD' }, { table_type: 'well_od', level: 'N3 OD' },
          { table_type: 'od_corrected', level: 'L1 OD' }, { table_type: 'od_corrected', level: 'L2 OD' },
          { table_type: 'od_corrected', level: 'N1 OD' }, { table_type: 'od_corrected', level: 'N3 OD' },
          { table_type: 'ind_batch', level: 'L1 Conc.' }, { table_type: 'ind_batch', level: 'L2 Conc.' },
          { table_type: 'ind_batch', level: 'N1 Conc.' }, { table_type: 'ind_batch', level: 'N3 Conc.' },
          { table_type: 'all_batch', level: 'L1 Conc.' }, { table_type: 'all_batch', level: 'L2 Conc.' },
          { table_type: 'all_batch', level: 'N1 Conc.' }, { table_type: 'all_batch', level: 'N3 Conc.' },
        ];
      }

      const insertRaw = db.prepare(`
        INSERT OR IGNORE INTO rawdata
          (bead_name, sheet_name, table_type, level, combo_idx, lot_id, bigD_lot)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `);
      for (const { table_type, level } of tableLevels) {
        insertRaw.run(marker, sheetName, table_type, level, lot, lot);
      }

      // Copy rawdata_meta from base marker if not already present
      const existingMeta = db.prepare(
        'SELECT 1 FROM rawdata_meta WHERE bead_name = ? LIMIT 1'
      ).get(marker);
      if (!existingMeta) {
        // Try to find a base marker (strip Q prefix, -A suffix)
        const candidates = [marker];
        if (marker.startsWith('Q')) candidates.push(marker.slice(1));
        const noVer = marker.replace(/-[A-Z]$/, '');
        if (noVer !== marker) candidates.push(noVer);

        for (const c of candidates) {
          if (c === marker) continue;
          const baseMeta = db.prepare(
            'SELECT DISTINCT table_type, well, row1, row2, row3 FROM rawdata_meta WHERE bead_name = ?'
          ).all(c);
          if (baseMeta.length) {
            const ins = db.prepare(
              'INSERT OR IGNORE INTO rawdata_meta (bead_name, table_type, well, row1, row2, row3) VALUES (?,?,?,?,?,?)'
            );
            for (const m of baseMeta) ins.run(marker, m.table_type, m.well, m.row1, m.row2, m.row3);
            break;
          }
        }
      }

      results.push({ marker, status: 'imported', sheet_name: sheetName });
    }
    return results;
  });

  try {
    const results = txn();
    const imported = results.filter(r => r.status === 'imported').length;
    res.json({ ok: true, imported, sheet_name: sheetName, details: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/template/pending-inspection — template-mode pending items ──
router.get('/pending-inspection', (_req, res) => {
  try {
    // Find sheets that exist in drbeadinspection but have no rawdata values yet,
    // and where multiple markers share the same sheet_name (template indicator)
    const rows = db.prepare(`
      SELECT d.bead_name, d.sheet_name, d.insp_date, d.bigD_lot, d.bigD_work_order,
             d.crack, d.dirt, d.color, d.id
      FROM drbeadinspection d
      LEFT JOIN rawdata r ON d.bead_name = r.bead_name AND d.sheet_name = r.sheet_name
        AND (r.w2 IS NOT NULL OR r.w3 IS NOT NULL OR r.w4 IS NOT NULL OR r.w5 IS NOT NULL
          OR r.w6 IS NOT NULL OR r.w7 IS NOT NULL OR r.w8 IS NOT NULL OR r.w9 IS NOT NULL
          OR r.w10 IS NOT NULL OR r.w11 IS NOT NULL OR r.w12 IS NOT NULL OR r.w13 IS NOT NULL
          OR r.w14 IS NOT NULL OR r.w15 IS NOT NULL OR r.w16 IS NOT NULL OR r.w17 IS NOT NULL
          OR r.w18 IS NOT NULL OR r.w19 IS NOT NULL)
      WHERE d.file_name IS NULL AND r.id IS NULL
      ORDER BY d.insp_date DESC, d.sheet_name, d.bead_name
    `).all();

    // Group by sheet_name to identify template sheets (multiple markers)
    const bySheet = new Map();
    for (const r of rows) {
      if (!bySheet.has(r.sheet_name)) bySheet.set(r.sheet_name, []);
      bySheet.get(r.sheet_name).push(r);
    }

    // Only return sheets with multiple markers (template mode)
    const result = [];
    for (const [sheetName, items] of bySheet) {
      if (items.length < 2) continue;
      result.push({
        sheet_name: sheetName,
        insp_date: items[0].insp_date,
        markers: items.map(i => ({
          bead_name: i.bead_name,
          lot: i.bigD_lot,
          work_order: i.bigD_work_order,
          id: i.id,
          crack: i.crack,
          dirt: i.dirt,
          color: i.color,
        })),
      });
    }

    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
