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

// GET /api/rawdata/p01pn — machine PN list for dropdown (reads from specDb)
router.get('/p01pn', (_req, res) => {
  try {
    const rows = specDb.prepare("SELECT pn FROM machine_pn WHERE machine_type = 'P01' ORDER BY pn").all();
    res.json(rows.map(r => r.pn));
  } catch {
    // fallback to old db
    try {
      const rows = db.prepare('SELECT p01pn FROM p01pn ORDER BY p01pn').all();
      res.json(rows.map(r => r.p01pn));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
});

// GET /api/rawdata/markers
router.get('/markers', (req, res) => {
  const year = normalizeYear(req.query.year);
  const sql = year ? `
    SELECT DISTINCT r.bead_name
    FROM rawdata r
    WHERE EXISTS (
      SELECT 1
      FROM drbeadinspection d
      WHERE d.bead_name = r.bead_name
        AND d.sheet_name = r.sheet_name
        AND d.insp_date LIKE ?
    )
    ORDER BY r.bead_name
  ` : `
    SELECT DISTINCT bead_name FROM rawdata ORDER BY bead_name
  `;
  const rows = year ? db.prepare(sql).all(yearLike(year)) : db.prepare(sql).all();
  res.json(rows.map(r => r.bead_name));
});

// GET /api/rawdata/sheets?bead_name=X
router.get('/sheets', (req, res) => {
  const { bead_name } = req.query;
  const year = normalizeYear(req.query.year);
  if (!bead_name) return res.status(400).json({ error: 'bead_name required' });
  const sql = year ? `
    SELECT DISTINCT r.sheet_name
    FROM rawdata r
    WHERE r.bead_name = ?
      AND EXISTS (
        SELECT 1
        FROM drbeadinspection d
        WHERE d.bead_name = r.bead_name
          AND d.sheet_name = r.sheet_name
          AND d.insp_date LIKE ?
      )
    ORDER BY r.sheet_name DESC
  ` : `
    SELECT DISTINCT sheet_name FROM rawdata WHERE bead_name = ? ORDER BY sheet_name DESC
  `;
  const rows = year
    ? db.prepare(sql).all(bead_name, yearLike(year))
    : db.prepare(sql).all(bead_name);
  res.json(rows.map(r => r.sheet_name));
});

// GET /api/rawdata/data?bead_name=X&sheet_name=Y
// Returns all 4 table_types in one call
router.get('/data', (req, res) => {
  const { bead_name, sheet_name } = req.query;
  const year = normalizeYear(req.query.year);
  if (!bead_name || !sheet_name) return res.status(400).json({ error: 'bead_name and sheet_name required' });

  const rowsSql = year ? `
    SELECT *
    FROM rawdata
    WHERE bead_name = ? AND sheet_name = ?
      AND EXISTS (
        SELECT 1
        FROM drbeadinspection d
        WHERE d.bead_name = rawdata.bead_name
          AND d.sheet_name = rawdata.sheet_name
          AND d.insp_date LIKE ?
      )
    ORDER BY table_type, level, combo_idx
  ` : `
    SELECT * FROM rawdata
    WHERE bead_name = ? AND sheet_name = ?
    ORDER BY table_type, level, combo_idx
  `;
  const rows = year
    ? db.prepare(rowsSql).all(bead_name, sheet_name, yearLike(year))
    : db.prepare(rowsSql).all(bead_name, sheet_name);

  const meta = db.prepare(`
    SELECT * FROM rawdata_meta
    WHERE bead_name = ?
    ORDER BY table_type, well
  `).all(bead_name);

  res.json({ rows, meta });
});

// GET /api/rawdata/bead-reagents — n_reagents per bead_name (from drbeadinspection)
router.get('/bead-reagents', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT bead_name,
        CASE WHEN d_lot IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN bigD_lot IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN u_lot IS NOT NULL THEN 1 ELSE 0 END AS n_reagents
      FROM drbeadinspection
      GROUP BY bead_name, n_reagents
      ORDER BY bead_name
    `).all();
    // If a bead has multiple counts take the max
    const map = new Map();
    for (const r of rows) {
      const cur = map.get(r.bead_name) || 0;
      if (r.n_reagents > cur) map.set(r.bead_name, r.n_reagents);
    }
    res.json([...map.entries()].map(([bead_name, n_reagents]) => ({ bead_name, n_reagents })));
  } catch {
    res.json([]);  // fallback: all single-reagent
  }
});

// GET /api/rawdata/cal-rules — all beadscal_rules markers for well config dropdown
router.get('/cal-rules', (_req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM beadscal_rules ORDER BY marker`).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rawdata/cs-assign — CS concentration targets (from specDb)
router.get('/cs-assign', (_req, res) => {
  try {
    const rows = specDb.prepare('SELECT * FROM csassign ORDER BY Marker').all();
    res.json(rows);
  } catch {
    // Fallback to old db
    try {
      const rows = db.prepare('SELECT * FROM csassign ORDER BY Marker').all();
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
});

// POST /api/rawdata/sheets — create a new sheet with empty rows
// Body: { bead_name, sheet_name, combos: [{ lot_id, ctrl_lot }] }
router.post('/sheets', (req, res) => {
  const { bead_name, sheet_name, combos } = req.body;
  if (!bead_name || !sheet_name || !Array.isArray(combos) || combos.length === 0)
    return res.status(400).json({ error: 'bead_name, sheet_name, combos[] required' });

  const TABLE_DEFS = [
    { type: 'well_od',      levels: ['L1 OD', 'L2 OD', 'N1 OD', 'N3 OD'] },
    { type: 'od_corrected', levels: ['L1 OD', 'L2 OD', 'N1 OD', 'N3 OD'] },
    { type: 'ind_batch',    levels: ['L1 Conc.', 'L2 Conc.', 'N1 Conc.', 'N3 Conc.'] },
    { type: 'all_batch',    levels: ['L1 Conc.', 'L2 Conc.', 'N1 Conc.', 'N3 Conc.'] },
  ];
  const insert = db.prepare(`
    INSERT OR IGNORE INTO rawdata
      (bead_name, sheet_name, table_type, level, combo_idx, lot_id, ctrl_lot, d_lot, bigD_lot, u_lot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  try {
    let created = 0;
    db.transaction(() => {
      for (const { type, levels } of TABLE_DEFS) {
        for (const level of levels) {
          for (let i = 0; i < combos.length; i++) {
            const info = insert.run(
              bead_name, sheet_name, type, level, i,
              combos[i].lot_id ?? null, combos[i].ctrl_lot ?? null,
              combos[i].d_lot ?? null, combos[i].bigD_lot ?? null, combos[i].u_lot ?? null
            );
            created += info.changes;
          }
        }
      }
    })();
    res.json({ ok: true, created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/rawdata/meta — bulk update rawdata_meta for a bead_name
// Body: { bead_name, wells: [{ well, row1, row2, row3 }, ...] }
router.put('/meta', (req, res) => {
  const { bead_name, wells } = req.body;
  if (!bead_name || !Array.isArray(wells)) return res.status(400).json({ error: 'bead_name and wells required' });

  const upsert = db.prepare(`
    INSERT INTO rawdata_meta (bead_name, table_type, well, row1, row2, row3)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(bead_name, table_type, well) DO UPDATE SET row1=excluded.row1, row2=excluded.row2, row3=excluded.row3
  `);
  const del = db.prepare(`DELETE FROM rawdata_meta WHERE bead_name = ? AND table_type = ? AND well = ?`);

  const TABLE_TYPES = ['well_od', 'od_corrected', 'ind_batch', 'all_batch'];

  try {
    db.transaction(() => {
      for (const w of wells) {
        for (const tt of TABLE_TYPES) {
          if (w.row1 === null && w.row2 === null && w.row3 === null) {
            del.run(bead_name, tt, w.well);
          } else {
            upsert.run(bead_name, tt, w.well, w.row1, w.row2, w.row3);
          }
        }
      }
    })();

    const meta = db.prepare(`SELECT * FROM rawdata_meta WHERE bead_name = ? ORDER BY table_type, well`).all(bead_name);
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/rawdata/:id  — update cell values (MUST be after /meta to avoid catching it)
const READONLY = new Set(['id', 'bead_name', 'sheet_name', 'table_type', 'level', 'combo_idx']);

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  const updates = Object.entries(req.body).filter(([k]) => !READONLY.has(k));
  if (updates.length === 0) return res.status(400).json({ error: 'nothing to update' });

  const set = updates.map(([k]) => `${k} = @${k}`).join(', ');
  const params = Object.fromEntries(updates);
  params.id = id;

  try {
    const info = db.prepare(`UPDATE rawdata SET ${set} WHERE id = @id`).run(params);
    if (info.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json(db.prepare(`SELECT * FROM rawdata WHERE id = ?`).get(id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sync to QC tables (drbeadinspection + posts) ─────────────────────

const WELLS = ['w2','w3','w4','w5','w6','w7','w8','w9','w10','w11','w12','w13','w14','w15','w16','w17','w18','w19'];

function wellVals(row, wells) {
  return wells.map(w => row[w]).filter(v => v !== null && v !== undefined && Number.isFinite(Number(v))).map(Number);
}

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function cv(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  if (!m || Math.abs(m) < 1e-15) return null;
  const std = Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
  return std / Math.abs(m);
}
function linReg2(x1, y1, x2, y2) {
  if (Math.abs(x2 - x1) < 1e-15) return null;
  const m = (y2 - y1) / (x2 - x1);
  return { m, b: y1 - m * x1 };
}
function linRegN(pts) {
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const d = n * sxx - sx * sx;
  if (Math.abs(d) < 1e-15) return null;
  const m = (n * sxy - sx * sy) / d;
  return { m, b: (sy - m * sx) / n };
}

// POST /api/rawdata/sync-qc
// Body: { bead_name, sheet_name }
router.post('/sync-qc', (req, res) => {
  const { bead_name, sheet_name } = req.body;
  if (!bead_name || !sheet_name) return res.status(400).json({ error: 'bead_name and sheet_name required' });

  try {
    // 1. Get marker wells from meta
    const meta = db.prepare(`SELECT well, row1 FROM rawdata_meta WHERE bead_name = ? AND table_type = 'well_od'`).all(bead_name);
    const markerWells = meta.filter(m => m.row1 && m.row1 !== 'Blank' && m.row1 !== 'Bllank').map(m => m.well.toLowerCase());
    if (!markerWells.length) return res.json({ ok: true, synced: 0 });

    // 2. Get all rawdata
    const allRows = db.prepare(`SELECT * FROM rawdata WHERE bead_name = ? AND sheet_name = ?`).all(bead_name, sheet_name);
    const wellOd = allRows.filter(r => r.table_type === 'well_od');
    const indBatch = allRows.filter(r => r.table_type === 'ind_batch');
    const allBatch = allRows.filter(r => r.table_type === 'all_batch');

    // 3. Get CS concentrations
    const csRows = db.prepare('SELECT * FROM csassign').all();
    // fuzzy match bead_name to csassign marker
    const normKey = (s) => s.toUpperCase().replace(/-[A-Z]$/, '').replace(/^[TNGQ](?=[A-Z])/, '');
    const csRow = csRows.find(c => normKey(c.Marker) === normKey(bead_name));

    // 3b. For ISE / fixed-slope markers (Na, K, etc.), look up the closest
    //     slope & intercept from drbeadinspection by insp_date
    let fixedSlope = null;
    const inspDateRow = db.prepare(
      `SELECT insp_date FROM drbeadinspection WHERE bead_name = ? AND sheet_name = ? AND insp_date IS NOT NULL LIMIT 1`
    ).get(bead_name, sheet_name);
    const refDate = inspDateRow?.insp_date || new Date().toISOString().slice(0, 10);
    const nearestRow = db.prepare(`
      SELECT od_slope, od_intercept FROM drbeadinspection
      WHERE bead_name = ? AND od_slope IS NOT NULL AND od_intercept IS NOT NULL
      ORDER BY ABS(JULIANDAY(insp_date) - JULIANDAY(?)) LIMIT 1
    `).get(bead_name, refDate);
    if (nearestRow) {
      fixedSlope = { m: Number(nearestRow.od_slope), b: Number(nearestRow.od_intercept) };
    }

    // 4. Detect level pairs
    const odLevels = [...new Set(wellOd.map(r => r.level))];
    const levelPairs = [];
    const groups = {};
    for (const lv of odLevels) {
      const m = lv.match(/^([A-Z])(\d+)\s+OD$/i);
      if (!m) continue;
      const prefix = m[1].toUpperCase();
      let knownConc = null;
      if (csRow) {
        for (const [col, val] of Object.entries(csRow)) {
          if (col !== 'id' && col !== 'Marker' && col.toUpperCase().startsWith(prefix + m[2] + '_')) {
            knownConc = Number(val);
            break;
          }
        }
      }
      if (!groups[prefix]) groups[prefix] = [];
      groups[prefix].push({ level: lv, num: parseInt(m[2]), conc: knownConc });
    }
    for (const items of Object.values(groups)) {
      if (items.length < 2) continue;
      items.sort((a, b) => a.num - b.num);
      levelPairs.push({
        odA: items[0].level, odB: items[1].level,
        concA: items[0].level.replace(' OD', ' Conc.'), concB: items[1].level.replace(' OD', ' Conc.'),
        knownA: items[0].conc, knownB: items[1].conc,
      });
    }

    // 5. Group by lot_id (= combo)
    const lots = [...new Set(wellOd.map(r => r.lot_id))].filter(Boolean);
    const comboResults = [];

    for (const lot of lots) {
      const result = { lot_id: lot };

      for (const pair of levelPairs) {
        const pfx = pair.odA.match(/^([A-Z])(\d+)/i);
        const pA = pfx[1].toUpperCase() + pfx[0].match(/\d+/)[0];
        const pfxB = pair.odB.match(/^([A-Z])(\d+)/i);
        const pB = pfxB[1].toUpperCase() + pfxB[0].match(/\d+/)[0];

        // OD values for this lot, both levels
        const odRowA = wellOd.find(r => r.lot_id === lot && r.level === pair.odA);
        const odRowB = wellOd.find(r => r.lot_id === lot && r.level === pair.odB);
        const valsA = odRowA ? wellVals(odRowA, markerWells) : [];
        const valsB = odRowB ? wellVals(odRowB, markerWells) : [];

        const meanA = mean(valsA);
        const meanB = mean(valsB);
        result[`od_mean_${pA.toLowerCase()}`] = meanA;
        result[`od_mean_${pB.toLowerCase()}`] = meanB;
        result[`od_cv_${pA.toLowerCase()}`] = cv(valsA);
        result[`od_cv_${pB.toLowerCase()}`] = cv(valsB);

        // Slope/intercept (individual batch: 2-point from this lot's means)
        // For markers with CS concentrations → compute from OD means
        // For ISE markers (Na, K, etc.) without CS → use fixed slope from DB
        if (meanA !== null && meanB !== null && pair.knownA !== null && pair.knownB !== null) {
          const reg = linReg2(meanA, pair.knownA, meanB, pair.knownB);
          if (reg) {
            result.slope = reg.m;
            result.intercept = reg.b;
          }
        } else if (fixedSlope && !isNaN(fixedSlope.m)) {
          result.slope = fixedSlope.m;
          result.intercept = fixedSlope.b;
        }

        // ind_batch conc values
        const indRowA = indBatch.find(r => r.lot_id === lot && r.level === pair.concA);
        const indRowB = indBatch.find(r => r.lot_id === lot && r.level === pair.concB);
        const concValsA = indRowA ? wellVals(indRowA, markerWells) : [];
        const concValsB = indRowB ? wellVals(indRowB, markerWells) : [];
        result[`sb_conc_mean_${pA.toLowerCase()}`] = mean(concValsA);
        result[`sb_conc_mean_${pB.toLowerCase()}`] = mean(concValsB);
        result[`sb_conc_cv_${pA.toLowerCase()}`] = cv(concValsA);
        result[`sb_conc_cv_${pB.toLowerCase()}`] = cv(concValsB);

        // all_batch conc values
        const abRowA = allBatch.find(r => r.lot_id === lot && r.level === pair.concA);
        const abRowB = allBatch.find(r => r.lot_id === lot && r.level === pair.concB);
        const abValsA = abRowA ? wellVals(abRowA, markerWells) : [];
        const abValsB = abRowB ? wellVals(abRowB, markerWells) : [];
        result[`fb_conc_mean_${pA.toLowerCase()}`] = mean(abValsA);
        result[`fb_conc_mean_${pB.toLowerCase()}`] = mean(abValsB);
        result[`fb_conc_cv_${pA.toLowerCase()}`] = cv(abValsA);
        result[`fb_conc_cv_${pB.toLowerCase()}`] = cv(abValsB);

        // Bias = (fb_conc_mean - known) / known
        const fbMeanA = mean(abValsA);
        const fbMeanB = mean(abValsB);
        if (fbMeanA !== null && pair.knownA) result[`fb_bias_${pA.toLowerCase()}`] = (fbMeanA - pair.knownA) / pair.knownA;
        if (fbMeanB !== null && pair.knownB) result[`fb_bias_${pB.toLowerCase()}`] = (fbMeanB - pair.knownB) / pair.knownB;

        // OD bias (all_batch OD mean across all lots vs this lot)
        const allLotsValsA = wellOd.filter(r => r.level === pair.odA).flatMap(r => wellVals(r, markerWells));
        const allLotsValsB = wellOd.filter(r => r.level === pair.odB).flatMap(r => wellVals(r, markerWells));
        const totalMeanA = mean(allLotsValsA);
        const totalMeanB = mean(allLotsValsB);
        if (meanA !== null && totalMeanA) result[`od_bias_${pA.toLowerCase()}`] = (meanA - totalMeanA) / totalMeanA;
        if (meanB !== null && totalMeanB) result[`od_bias_${pB.toLowerCase()}`] = (meanB - totalMeanB) / totalMeanB;
      }

      comboResults.push(result);
    }

    // 6. Write to drbeadinspection
    const drFields = [
      'od_slope','od_intercept',
      'od_mean_l1','od_mean_l2','od_mean_n1','od_mean_n3',
      'od_cvpct_l1','od_cvpct_l2','od_cvpct_n1','od_cvpct_n3',
      'od_bias_l1','od_bias_l2','od_bias_n1','od_bias_n3',
      'conc_mean_l1','conc_mean_l2','conc_cvpct_l1','conc_cvpct_l2',
      'conc_tot_mean_l1','conc_tot_mean_l2','conc_tot_cvpct_l1','conc_tot_cvpct_l2',
      'conc_tot_bias_l1','conc_tot_bias_l2',
    ];
    // mapping: drbeadinspection field → comboResult key
    const drMap = {
      od_slope: 'slope', od_intercept: 'intercept',
      od_mean_l1: 'od_mean_l1', od_mean_l2: 'od_mean_l2', od_mean_n1: 'od_mean_n1', od_mean_n3: 'od_mean_n3',
      od_cvpct_l1: 'od_cv_l1', od_cvpct_l2: 'od_cv_l2', od_cvpct_n1: 'od_cv_n1', od_cvpct_n3: 'od_cv_n3',
      od_bias_l1: 'od_bias_l1', od_bias_l2: 'od_bias_l2', od_bias_n1: 'od_bias_n1', od_bias_n3: 'od_bias_n3',
      conc_mean_l1: 'sb_conc_mean_l1', conc_mean_l2: 'sb_conc_mean_l2',
      conc_cvpct_l1: 'sb_conc_cv_l1', conc_cvpct_l2: 'sb_conc_cv_l2',
      conc_tot_mean_l1: 'fb_conc_mean_l1', conc_tot_mean_l2: 'fb_conc_mean_l2',
      conc_tot_cvpct_l1: 'fb_conc_cv_l1', conc_tot_cvpct_l2: 'fb_conc_cv_l2',
      conc_tot_bias_l1: 'fb_bias_l1', conc_tot_bias_l2: 'fb_bias_l2',
    };

    const postFields = [
      'slope','intercept',
      'od_mean_l1','od_mean_l2','od_mean_n1','od_mean_n3',
      'od_cv_l1','od_cv_l2','od_cv_n1','od_cv_n3',
      'od_bias_l1','od_bias_l2','od_bias_n1','od_bias_n3',
      'sb_conc_mean_l1','sb_conc_mean_l2','sb_conc_cv_l1','sb_conc_cv_l2',
      'fb_conc_mean_l1','fb_conc_mean_l2','fb_conc_cv_l1','fb_conc_cv_l2',
      'fb_bias_l1','fb_bias_l2',
    ];

    // ── Helper: build update sets for a comboResult ──
    function buildDrSets(cr) {
      const sets = [];
      const params = {};
      for (const df of drFields) {
        const val = cr[drMap[df]];
        if (val !== undefined && val !== null) { sets.push(`${df} = @${df}`); params[df] = val; }
      }
      // Also write to the display fields used by DriedBeadsPage
      const displayMap = {
        od_cv_l1: 'od_cv_l1', od_cv_l2: 'od_cv_l2', od_cv_n1: 'od_cv_n1', od_cv_n3: 'od_cv_n3',
        rconc_cv_l1: 'sb_conc_cv_l1', rconc_cv_l2: 'sb_conc_cv_l2', rconc_cv_n1: 'sb_conc_cv_n1', rconc_cv_n3: 'sb_conc_cv_n3',
        mean_bias_l1: 'fb_bias_l1', mean_bias_l2: 'fb_bias_l2',
        total_cv_l1: 'fb_conc_cv_l1', total_cv_l2: 'fb_conc_cv_l2',
        initial_l1: 'fb_conc_mean_l1', initial_l2: 'fb_conc_mean_l2',
      };
      for (const [dbCol, srcKey] of Object.entries(displayMap)) {
        const val = cr[srcKey];
        if (val !== undefined && val !== null) { sets.push(`${dbCol} = @${dbCol}`); params[dbCol] = val; }
      }
      // machine from well_od ctrl_lot
      const machineRows = wellOd.filter(r => r.lot_id === cr.lot_id);
      for (const mr of machineRows) {
        if (!mr.ctrl_lot) continue;
        const lm = mr.level.match(/^([A-Z])(\d+)/i);
        if (lm) { const col = `machine_${lm[1].toUpperCase() + lm[2]}`; sets.push(`${col} = @${col}`); params[col] = mr.ctrl_lot; }
      }
      return { sets, params };
    }
    function buildPostSets(cr) {
      const sets = [];
      const params = {};
      for (const pf of postFields) {
        const val = cr[pf];
        if (val !== undefined && val !== null) { sets.push(`${pf} = @${pf}`); params[pf] = val; }
      }
      return { sets, params };
    }

    // ── Find existing rows ──
    // drbeadinspection: try exact batch_combo first, then lot-based fuzzy
    function findDrRows(lotId) {
      // Try exact batch_combo match
      let rows = db.prepare(`SELECT * FROM drbeadinspection WHERE bead_name = ? AND batch_combo = ?`).all(bead_name, lotId);
      if (rows.length) return rows;
      // Try with spaces (lot_id has no spaces, batch_combo has spaces)
      const lotWithSpaces = lotId.replace(/([A-Z]{2})/g, ' $1').trim();
      rows = db.prepare(`SELECT * FROM drbeadinspection WHERE bead_name = ? AND sheet_name = ? AND batch_combo = ?`).all(bead_name, sheet_name, lotWithSpaces);
      if (rows.length) return rows;
      // Try matching by replacing batch_combo spaces
      rows = db.prepare(`SELECT * FROM drbeadinspection WHERE bead_name = ? AND sheet_name = ? AND REPLACE(batch_combo, ' ', '') = ?`).all(bead_name, sheet_name, lotId);
      if (rows.length) return rows;
      return [];
    }
    function findPostRows(lotId) {
      // Try direct lot match
      let rows = db.prepare(`SELECT * FROM posts WHERE bead_name = ? AND sheet_name = ? AND (lot_d = ? OR lot_bigD = ? OR lot_u = ?)`).all(bead_name, sheet_name, lotId, lotId, lotId);
      if (rows.length) return rows;
      // lot_id is concatenated d+D+U lots; match by combo_idx from drbeadinspection
      const drRows = findDrRows(lotId);
      if (drRows.length) {
        rows = db.prepare(`SELECT * FROM posts WHERE bead_name = ? AND sheet_name = ? AND combo_idx = ?`).all(bead_name, sheet_name, drRows[0].batch_col - 16);
        if (rows.length) return rows;
      }
      return [];
    }

    // ── Pre-check: if drbeadinspection/posts has 1 combined row but rawdata has multiple lots, split first ──
    const allDrRows = db.prepare(`SELECT * FROM drbeadinspection WHERE bead_name = ? AND (sheet_name = ? OR sheet_name LIKE ?)`)
      .all(bead_name, sheet_name, `%${lots[0] || ''}%`);
    // Also check by lot content in bigD_lot/d_lot/u_lot
    const drByLot = lots.length > 0 ? db.prepare(
      `SELECT * FROM drbeadinspection WHERE bead_name = ? AND (d_lot LIKE ? OR bigD_lot LIKE ? OR u_lot LIKE ?)`
    ).all(bead_name, `%${lots[0]}%`, `%${lots[0]}%`, `%${lots[0]}%`) : [];
    const combinedDr = [...allDrRows, ...drByLot].filter((v, i, a) => a.findIndex(x => x.id === v.id) === i);

    const allPostRows = db.prepare(`SELECT * FROM posts WHERE bead_name = ? AND (sheet_name = ? OR sheet_name LIKE ?)`)
      .all(bead_name, sheet_name, `%${lots[0] || ''}%`);
    const postByLot = lots.length > 0 ? db.prepare(
      `SELECT * FROM posts WHERE bead_name = ? AND (lot_d LIKE ? OR lot_bigD LIKE ? OR lot_u LIKE ?)`
    ).all(bead_name, `%${lots[0]}%`, `%${lots[0]}%`, `%${lots[0]}%`) : [];
    const combinedPost = [...allPostRows, ...postByLot].filter((v, i, a) => a.findIndex(x => x.id === v.id) === i);

    let synced = 0;
    const drCols = db.prepare(`PRAGMA table_info(drbeadinspection)`).all().map(c => c.name).filter(c => c !== 'id');
    const postCols = db.prepare(`PRAGMA table_info(posts)`).all().map(c => c.name).filter(c => c !== 'id');

    db.transaction(() => {
      // If only 1 combined drbeadinspection row but multiple lots → split into per-lot rows
      if (combinedDr.length === 1 && lots.length > 1) {
        const tmpl = combinedDr[0];
        // Determine which lot field has the combined value
        const lotField = tmpl.d_lot && tmpl.d_lot.includes(',') ? 'd_lot'
          : tmpl.bigD_lot && tmpl.bigD_lot.includes(',') ? 'bigD_lot'
          : tmpl.u_lot && tmpl.u_lot.includes(',') ? 'u_lot' : 'bigD_lot';

        // Update first row to first lot
        db.prepare(`UPDATE drbeadinspection SET batch_combo = ?, ${lotField} = ?, sheet_name = ? WHERE id = ?`)
          .run(lots[0], lots[0], sheet_name, tmpl.id);

        // Insert cloned rows for remaining lots
        const insertCols = drCols.filter(c => c !== 'batch_combo' && c !== lotField);
        for (let i = 1; i < lots.length; i++) {
          const vals = insertCols.map(c => c === 'sheet_name' ? sheet_name : c === 'batch_col' ? i + 1 : tmpl[c]);
          const allCols = [...insertCols, 'batch_combo', lotField];
          const allVals = [...vals, lots[i], lots[i]];
          const placeholders = allCols.map(() => '?').join(',');
          db.prepare(`INSERT INTO drbeadinspection (${allCols.join(',')}) VALUES (${placeholders})`).run(...allVals);
        }
      }

      // Same for posts
      if (combinedPost.length === 1 && lots.length > 1) {
        const tmpl = combinedPost[0];
        const lotField = tmpl.lot_d && tmpl.lot_d.includes(',') ? 'lot_d'
          : tmpl.lot_bigD && tmpl.lot_bigD.includes(',') ? 'lot_bigD'
          : tmpl.lot_u && tmpl.lot_u.includes(',') ? 'lot_u' : 'lot_bigD';

        db.prepare(`UPDATE posts SET ${lotField} = ?, sheet_name = ? WHERE id = ?`)
          .run(lots[0], sheet_name, tmpl.id);

        const insertCols = postCols.filter(c => c !== lotField);
        for (let i = 1; i < lots.length; i++) {
          const vals = insertCols.map(c => c === 'sheet_name' ? sheet_name : c === 'combo_idx' ? i + 1 : tmpl[c]);
          const allCols = [...insertCols, lotField];
          const allVals = [...vals, lots[i]];
          const placeholders = allCols.map(() => '?').join(',');
          db.prepare(`INSERT INTO posts (${allCols.join(',')}) VALUES (${placeholders})`).run(...allVals);
        }
      }

      // Now update each lot's computed values
      for (const cr of comboResults) {
        // drbeadinspection: find by batch_combo or lot fields
        let drRow = db.prepare(`SELECT id FROM drbeadinspection WHERE bead_name = ? AND batch_combo = ?`).get(bead_name, cr.lot_id)
          || db.prepare(`SELECT id FROM drbeadinspection WHERE bead_name = ? AND sheet_name = ? AND REPLACE(batch_combo, ' ', '') = ?`).get(bead_name, sheet_name, cr.lot_id)
          || db.prepare(`SELECT id FROM drbeadinspection WHERE bead_name = ? AND (d_lot = ? OR bigD_lot = ? OR u_lot = ?)`).get(bead_name, cr.lot_id, cr.lot_id, cr.lot_id);
        if (drRow) {
          const { sets, params } = buildDrSets(cr);
          params.id = drRow.id;
          sets.push('sheet_name = @sheet_name'); params.sheet_name = sheet_name;
          if (sets.length) {
            db.prepare(`UPDATE drbeadinspection SET ${sets.join(', ')} WHERE id = @id`).run(params);
            synced++;
          }
        }

        // posts: find by lot fields
        let postRow = db.prepare(`SELECT id FROM posts WHERE bead_name = ? AND sheet_name = ? AND (lot_d = ? OR lot_bigD = ? OR lot_u = ?)`).get(bead_name, sheet_name, cr.lot_id, cr.lot_id, cr.lot_id)
          || db.prepare(`SELECT id FROM posts WHERE bead_name = ? AND sheet_name = ? AND combo_idx = ?`).get(bead_name, sheet_name, lots.indexOf(cr.lot_id) + 1);
        if (postRow) {
          const { sets, params } = buildPostSets(cr);
          params.id = postRow.id;
          sets.push('sheet_name = @sheet_name'); params.sheet_name = sheet_name;
          if (sets.length) {
            db.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = @id`).run(params);
            synced++;
          }
        }
      }
    })();

    res.json({ ok: true, synced });
  } catch (err) {
    console.error('sync-qc error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Well-position templates ───────────────────────────────────────────
// DDL: auto-create on first use
db.exec(`
  CREATE TABLE IF NOT EXISTS well_position_templates (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    wells TEXT NOT NULL   -- JSON: [{well,row1,row2,row3}, ...]
  )
`);

// GET /api/rawdata/well-templates
router.get('/well-templates', (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM well_position_templates ORDER BY name').all();
    res.json(rows.map(r => ({ ...r, wells: JSON.parse(r.wells) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rawdata/well-templates  — save new or overwrite
// Body: { name, wells: [{well,row1,row2,row3}, ...] }
router.post('/well-templates', (req, res) => {
  const { name, wells } = req.body;
  if (!name || !Array.isArray(wells)) return res.status(400).json({ error: 'name and wells required' });
  try {
    db.prepare(`
      INSERT INTO well_position_templates (name, wells) VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET wells = excluded.wells
    `).run(name, JSON.stringify(wells));
    res.json({ ok: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/rawdata/well-templates/:id
router.delete('/well-templates/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM well_position_templates WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rawdata/expand-combos — add more combo rows to an existing sheet
// Body: { bead_name, sheet_name, count } — adds `count` new combos
router.post('/expand-combos', (req, res) => {
  const { bead_name, sheet_name, count } = req.body;
  if (!bead_name || !sheet_name || !count || count < 1)
    return res.status(400).json({ error: 'bead_name, sheet_name, count required' });

  try {
    // Find current max combo_idx
    const maxRow = db.prepare(`SELECT MAX(combo_idx) as mx FROM rawdata WHERE bead_name = ? AND sheet_name = ?`).get(bead_name, sheet_name);
    const startIdx = (maxRow?.mx ?? -1) + 1;

    const TABLE_DEFS = [
      { type: 'well_od',      levels: ['L1 OD', 'L2 OD', 'N1 OD', 'N3 OD'] },
      { type: 'od_corrected', levels: ['L1 OD', 'L2 OD', 'N1 OD', 'N3 OD'] },
      { type: 'ind_batch',    levels: ['L1 Conc.', 'L2 Conc.', 'N1 Conc.', 'N3 Conc.'] },
      { type: 'all_batch',    levels: ['L1 Conc.', 'L2 Conc.', 'N1 Conc.', 'N3 Conc.'] },
    ];
    const insert = db.prepare(`
      INSERT OR IGNORE INTO rawdata
        (bead_name, sheet_name, table_type, level, combo_idx)
      VALUES (?, ?, ?, ?, ?)
    `);
    let created = 0;
    db.transaction(() => {
      for (const { type, levels } of TABLE_DEFS) {
        for (const level of levels) {
          for (let i = 0; i < count; i++) {
            const info = insert.run(bead_name, sheet_name, type, level, startIdx + i);
            created += info.changes;
          }
        }
      }
    })();
    res.json({ ok: true, created, startIdx });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
