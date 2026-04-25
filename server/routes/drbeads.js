/**
 * /api/drbeads  –  Dried Beads 半成品檢驗紀錄
 * reads from ipqcdrybeads.db  →  drbeadinspection table
 */
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

// ── PN lookup cache from EC2 Liquid form QC ──────────────────────────────
let _pnCache = null; // Map<markerName, { name, pn }[]>
let _pnCacheTime = 0;

function getEc2PnMap() {
  // Cache for 10 minutes
  if (_pnCache && Date.now() - _pnCacheTime < 600000) return _pnCache;
  try {
    const os = require('os');
    const path = require('path');
    const Database = require('better-sqlite3');
    const tmpPath = path.join(os.tmpdir(), 'P01_schedule_cache.db');
    const schedDb = new Database(tmpPath, { readonly: true });
    const rows = schedDb.prepare('SELECT [Marker name],[PN],[Name] FROM [Liquid form QC]').all();
    schedDb.close();
    const map = new Map();
    for (const r of rows) {
      const marker = (r['Marker name'] || '').trim();
      const pn = (r.PN || '').trim();
      const name = (r.Name || '').trim();
      if (!marker || !pn || marker === 'Marker name') continue;
      if (!map.has(marker)) map.set(marker, []);
      map.get(marker).push({ name, pn });
    }
    _pnCache = map;
    _pnCacheTime = Date.now();
    return map;
  } catch { return new Map(); }
}

/** Check if a PN value is valid (not null, not empty, not '0') */
function validPn(v) {
  return v && v !== '0' && v.trim() !== '';
}

/** Lookup QBi part numbers from p01_qbi_mapping table in specDb.
 *  Returns { d: pn_D, u: pn_U } by matching product_name or bead_name.
 *  Mapping has separate rows for D/U (e.g. QALP-D / QALP-U). */
function lookupQbiPn(beadName, productName) {
  // Build search keys: product_name, QBi-ALB→QALB, bead_name, stripped
  const tryNames = [];
  if (productName) tryNames.push(productName.trim());
  if (beadName.startsWith('QBi-')) tryNames.push('Q' + beadName.slice(4));
  tryNames.push(beadName);
  if (beadName.startsWith('QBi-')) tryNames.push(beadName.slice(4));

  // Try exact match first, then prefix match
  for (const name of tryNames) {
    // Find all rows whose qbi_marker starts with this name (e.g. 'QALP' matches QALP-D, QALP-U)
    const rows = specDb.prepare(
      `SELECT TRIM(qbi_marker) AS qm, qbi_pn FROM p01_qbi_mapping
       WHERE (TRIM(qbi_marker) = ? COLLATE NOCASE
              OR TRIM(qbi_marker) LIKE ? COLLATE NOCASE)
             AND qbi_pn IS NOT NULL AND qbi_pn != ''`
    ).all(name, name + '-%');
    if (rows.length === 0) continue;

    // Single row (no D/U split, e.g. QALB-A, QBUN)
    if (rows.length === 1) return { d: null, bigD: rows[0].qbi_pn, u: null };

    // Multiple rows: classify D vs U by suffix
    const result = { d: null, bigD: null, u: null };
    for (const r of rows) {
      const m = r.qm.toUpperCase();
      if (m.endsWith('-U') || m.endsWith('_U')) result.u = r.qbi_pn;
      else if (m.endsWith('-D') || m.endsWith('_D') || m.endsWith('-AD')) result.bigD = r.qbi_pn;
      else if (!result.bigD) result.bigD = r.qbi_pn; // default to bigD
    }
    if (result.bigD || result.u) return result;
  }
  return null;
}

/** Lookup part_no for a bead_name:
 *  1. QBi beads → p01_qbi_mapping table
 *  2. Find nearest date record in drbeadinspection that has PN
 *  3. Fallback: EC2 Liquid form QC table */
function lookupPartNo(beadName, inspDate, productName) {
  // 1. QBi beads: lookup from p01_qbi_mapping
  const isQbi = /^Q/i.test(beadName);
  if (isQbi) {
    const qbiPn = lookupQbiPn(beadName, productName);
    if (qbiPn) return qbiPn;
  }

  // 2. DB: nearest date with valid PN
  const ref = inspDate || new Date().toISOString().slice(0, 10);
  const row = db.prepare(`
    SELECT d_part_no, bigD_part_no, u_part_no FROM drbeadinspection
    WHERE bead_name = ? AND (
      (d_part_no IS NOT NULL AND d_part_no != '0' AND d_part_no != '') OR
      (bigD_part_no IS NOT NULL AND bigD_part_no != '0' AND bigD_part_no != '') OR
      (u_part_no IS NOT NULL AND u_part_no != '0' AND u_part_no != '')
    )
    ORDER BY ABS(JULIANDAY(insp_date) - JULIANDAY(?)) LIMIT 1
  `).get(beadName, ref);
  if (row && (validPn(row.d_part_no) || validPn(row.bigD_part_no) || validPn(row.u_part_no))) {
    return {
      d: validPn(row.d_part_no) ? row.d_part_no : null,
      bigD: validPn(row.bigD_part_no) ? row.bigD_part_no : null,
      u: validPn(row.u_part_no) ? row.u_part_no : null,
    };
  }

  // 3. EC2 Liquid form QC
  const ec2 = getEc2PnMap();
  const nameMap = { tCREA:'CREA', tGlu:'GLU', CPK:'CK', tASTi:'ASTi', Cl:'Cl' };
  const tryKeys = [beadName];
  if (nameMap[beadName]) tryKeys.push(nameMap[beadName]);
  if (beadName.startsWith('Q') && beadName.length > 1) tryKeys.push('Q' + (nameMap[beadName.slice(1)] || beadName.slice(1)));
  const stripped = beadName.replace(/^[tQ]/i, '');
  if (!tryKeys.includes(stripped)) tryKeys.push(stripped);

  for (const key of tryKeys) {
    const entries = ec2.get(key);
    if (!entries) continue;
    const result = { d: null, bigD: null, u: null };
    for (const e of entries) {
      const t = e.name.trim();
      const last = t.slice(-1);
      if (last === 'U') result.u = e.pn;
      else if (last === 'd') result.d = e.pn;
      else result.bigD = e.pn;
    }
    if (result.d || result.bigD || result.u) return result;
  }
  return null;
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

// GET /api/drbeads/markers
// 所有 bead_name 清單
router.get('/markers', (req, res) => {
  const year = normalizeYear(req.query.year);
  const sql = year ? `
    SELECT DISTINCT bead_name
    FROM drbeadinspection
    WHERE insp_date LIKE ?
    ORDER BY bead_name
  ` : `
    SELECT DISTINCT bead_name
    FROM drbeadinspection
    ORDER BY bead_name
  `;
  const rows = year ? db.prepare(sql).all(yearLike(year)) : db.prepare(sql).all();
  res.json(rows.map(r => r.bead_name));
});

// GET /api/drbeads/sheets?bead_name=tCREA
// 該 marker 的所有 sheet（檢驗批次）
router.get('/sheets', (req, res) => {
  const { bead_name } = req.query;
  const year = normalizeYear(req.query.year);
  if (!bead_name) return res.status(400).json({ error: 'bead_name required' });
  const sql = year ? `
    SELECT DISTINCT sheet_name, insp_date, file_name,
           COUNT(*) AS combo_count
    FROM drbeadinspection
    WHERE bead_name = ? AND insp_date LIKE ?
    GROUP BY sheet_name, insp_date, file_name
    ORDER BY insp_date DESC, sheet_name DESC
  ` : `
    SELECT DISTINCT sheet_name, insp_date, file_name,
           COUNT(*) AS combo_count
    FROM drbeadinspection
    WHERE bead_name = ?
    GROUP BY sheet_name, insp_date, file_name
    ORDER BY insp_date DESC, sheet_name DESC
  `;
  const rows = year
    ? db.prepare(sql).all(bead_name, yearLike(year))
    : db.prepare(sql).all(bead_name);
  res.json(rows);
});

// GET /api/drbeads/records?bead_name=tCREA&sheet_name=26D1412U141234
// 該 sheet 的所有 batch-combo records (最多 4 筆)
router.get('/records', (req, res) => {
  const { bead_name, sheet_name } = req.query;
  const year = normalizeYear(req.query.year);
  if (!bead_name || !sheet_name)
    return res.status(400).json({ error: 'bead_name and sheet_name required' });
  const sql = year ? `
    SELECT *
    FROM drbeadinspection
    WHERE bead_name = ? AND sheet_name = ? AND insp_date LIKE ?
    ORDER BY batch_col
  ` : `
    SELECT *
    FROM drbeadinspection
    WHERE bead_name = ? AND sheet_name = ?
    ORDER BY batch_col
  `;
  const rows = year
    ? db.prepare(sql).all(bead_name, sheet_name, yearLike(year))
    : db.prepare(sql).all(bead_name, sheet_name);
  // Auto-fill well_position from ipqcwell if missing
  // Auto-fill part_no (料號) from nearest date record or EC2 Liquid form QC
  for (const r of rows) {
    if (!r.well_position) {
      r.well_position = lookupWell(r.bead_name);
    }
    // Fill missing/invalid part numbers
    const needD = !validPn(r.d_part_no);
    const needBigD = !validPn(r.bigD_part_no);
    const needU = !validPn(r.u_part_no);
    if (needD && needBigD && needU) {
      // All missing: full lookup
      const pn = lookupPartNo(r.bead_name, r.insp_date, r.product_name);
      if (pn) {
        r.d_part_no = pn.d;
        r.bigD_part_no = pn.bigD;
        r.u_part_no = pn.u;
      }
    } else if (/^Q/i.test(r.bead_name) && (needBigD || needU)) {
      // QBi: partially missing (e.g. bigD has value but U is '0')
      const pn = lookupQbiPn(r.bead_name, r.product_name);
      if (pn) {
        if (needBigD && pn.bigD) r.bigD_part_no = pn.bigD;
        if (needU && pn.u) r.u_part_no = pn.u;
      }
    }
    // Clean up '0' values
    if (r.d_part_no === '0') r.d_part_no = null;
    if (r.bigD_part_no === '0') r.bigD_part_no = null;
    if (r.u_part_no === '0') r.u_part_no = null;
  }
  res.json(rows);
});

// GET /api/drbeads/record/:id
// 單筆詳細
router.get('/record/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM drbeadinspection WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// GET /api/drbeads/summary?bead_name=tCREA
// 各批次通過/不通過統計
router.get('/summary', (req, res) => {
  const { bead_name } = req.query;
  const year = normalizeYear(req.query.year);
  if (!bead_name) return res.status(400).json({ error: 'bead_name required' });
  const sql = year ? `
    SELECT
      insp_date,
      sheet_name,
      COUNT(*) AS total,
      SUM(CASE WHEN final_decision LIKE '%Accept%' OR final_decision LIKE '%PASS%' THEN 1 ELSE 0 END) AS passed,
      SUM(CASE WHEN batch_decision LIKE '%可併%' OR batch_decision LIKE '%Pass%' THEN 1 ELSE 0 END) AS merged
    FROM drbeadinspection
    WHERE bead_name = ? AND insp_date LIKE ?
    GROUP BY insp_date, sheet_name
    ORDER BY insp_date DESC
  ` : `
    SELECT
      insp_date,
      sheet_name,
      COUNT(*) AS total,
      SUM(CASE WHEN final_decision LIKE '%Accept%' OR final_decision LIKE '%PASS%' THEN 1 ELSE 0 END) AS passed,
      SUM(CASE WHEN batch_decision LIKE '%可併%' OR batch_decision LIKE '%Pass%' THEN 1 ELSE 0 END) AS merged
    FROM drbeadinspection
    WHERE bead_name = ?
    GROUP BY insp_date, sheet_name
    ORDER BY insp_date DESC
  `;
  const rows = year
    ? db.prepare(sql).all(bead_name, yearLike(year))
    : db.prepare(sql).all(bead_name);
  res.json(rows);
});

// GET /api/drbeads/years
router.get('/years', (_req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT SUBSTR(insp_date, 1, 4) AS year
    FROM drbeadinspection
    WHERE insp_date GLOB '[0-9][0-9][0-9][0-9]-*'
    ORDER BY year DESC
  `).all();
  res.json(rows.map(r => r.year));
});

// GET /api/drbeads/stats
// 所有 marker 的總覽統計 (年度)
router.get('/stats', (req, res) => {
  const selectedYear = normalizeYear(req.query.year) || new Date().getFullYear().toString();
  const rows = db.prepare(`
    SELECT
      bead_name,
      COUNT(DISTINCT sheet_name) AS sheets,
      COUNT(*) AS records,
      MAX(insp_date) AS last_insp_date,
      SUM(CASE WHEN UPPER(final_decision) LIKE '%PASS%' OR UPPER(final_decision) LIKE '%ACCEPT%' THEN 1 ELSE 0 END) AS passed,
      SUM(CASE WHEN UPPER(final_decision) LIKE '%FAIL%' OR UPPER(final_decision) LIKE '%REJECT%' OR UPPER(final_decision) LIKE '%NG%' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN UPPER(COALESCE(final_decision,'')) LIKE '%HOLD%' THEN 1 ELSE 0 END) AS hold,
      SUM(CASE WHEN final_decision IS NULL OR final_decision = '' OR final_decision = '-' THEN 1 ELSE 0 END) AS pending
    FROM drbeadinspection
    WHERE insp_date LIKE ? OR insp_date IS NULL
    GROUP BY bead_name
    ORDER BY bead_name
  `).all(yearLike(selectedYear));

  // Add pending-inspection count (imported from schedule but no rawdata yet)
  const pendingInsp = db.prepare(`
    SELECT d.bead_name, COUNT(DISTINCT d.id) AS cnt
    FROM drbeadinspection d
    LEFT JOIN rawdata r ON d.bead_name = r.bead_name AND d.sheet_name = r.sheet_name
    WHERE d.file_name IS NULL AND r.id IS NULL AND (d.insp_date LIKE ? OR d.insp_date IS NULL)
    GROUP BY d.bead_name
  `).all(yearLike(selectedYear));
  const pendingMap = new Map(pendingInsp.map(r => [r.bead_name, r.cnt]));

  for (const r of rows) {
    r.pending_insp = pendingMap.get(r.bead_name) || 0;
  }
  // Add beads that only exist in pending (not yet in stats)
  for (const p of pendingInsp) {
    if (!rows.find(r => r.bead_name === p.bead_name)) {
      rows.push({ bead_name: p.bead_name, sheets: 0, records: 0, last_insp_date: null, passed: 0, failed: 0, hold: 0, pending: 0, pending_insp: p.cnt });
    }
  }
  rows.sort((a, b) => a.bead_name.localeCompare(b.bead_name));

  res.json(rows);
});

// GET /api/drbeads/kpi
router.get('/kpi', (req, res) => {
  const year = normalizeYear(req.query.year);
  const t1Sql = year ? `
    SELECT
      COUNT(DISTINCT bead_name || sheet_name) AS total_batches,
      SUM(CASE WHEN final_decision LIKE '%PASS%' OR final_decision LIKE '%Accept%' THEN 1 ELSE 0 END) AS passed,
      SUM(CASE WHEN final_decision LIKE '%FAIL%' OR final_decision LIKE '%Reject%' OR final_decision LIKE '%NG%' THEN 1 ELSE 0 END) AS ng,
      SUM(CASE WHEN final_decision IS NULL OR final_decision = '' OR final_decision = '-'
                   OR UPPER(COALESCE(final_decision,'')) LIKE '%HOLD%' THEN 1 ELSE 0 END) AS anomaly,
      COUNT(DISTINCT bead_name) AS markers
    FROM drbeadinspection
    WHERE insp_date LIKE ?
  ` : `
    SELECT
      COUNT(DISTINCT bead_name || sheet_name) AS total_batches,
      SUM(CASE WHEN final_decision LIKE '%PASS%' OR final_decision LIKE '%Accept%' THEN 1 ELSE 0 END) AS passed,
      SUM(CASE WHEN final_decision LIKE '%FAIL%' OR final_decision LIKE '%Reject%' OR final_decision LIKE '%NG%' THEN 1 ELSE 0 END) AS ng,
      SUM(CASE WHEN final_decision IS NULL OR final_decision = '' OR final_decision = '-'
                   OR UPPER(COALESCE(final_decision,'')) LIKE '%HOLD%' THEN 1 ELSE 0 END) AS anomaly,
      COUNT(DISTINCT bead_name) AS markers
    FROM drbeadinspection
  `;
  const t1 = year ? db.prepare(t1Sql).get(yearLike(year)) : db.prepare(t1Sql).get();
  const t2Sql = year ? `SELECT COUNT(*) AS total FROM posts WHERE insp_date LIKE ?` : `SELECT COUNT(*) AS total FROM posts`;
  const t2 = year ? db.prepare(t2Sql).get(yearLike(year)) : db.prepare(t2Sql).get();
  res.json({
    total_batches: t1.total_batches || 0,
    total_records: (t1.total_batches || 0) + (t2.total || 0),
    passed: t1.passed || 0,
    ng: t1.ng || 0,
    anomaly: t1.anomaly || 0,
    markers: t1.markers || 0,
  });
});

// GET /api/drbeads/trend?bead_name=tCREA&limit=10
router.get('/trend', (req, res) => {
  const bead = req.query.bead_name || 'tCREA';
  const limit = parseInt(req.query.limit) || 999;
  const year = normalizeYear(req.query.year);
  const cols = `
      sheet_name AS lot, insp_date,
      AVG(CAST(od_mean_l1 AS REAL)) AS od_l1, AVG(CAST(od_mean_l2 AS REAL)) AS od_l2,
      AVG(CAST(od_mean_n1 AS REAL)) AS od_n1, AVG(CAST(od_mean_n3 AS REAL)) AS od_n3,
      AVG(CAST(od_cvpct_l1 AS REAL)) AS cv_l1, AVG(CAST(od_cvpct_l2 AS REAL)) AS cv_l2,
      AVG(CAST(od_cvpct_n1 AS REAL)) AS cv_n1, AVG(CAST(od_cvpct_n3 AS REAL)) AS cv_n3,
      AVG(CAST(rconc_cv_l1 AS REAL)) AS ccv_l1, AVG(CAST(rconc_cv_l2 AS REAL)) AS ccv_l2,
      AVG(CAST(rconc_cv_n1 AS REAL)) AS ccv_n1, AVG(CAST(rconc_cv_n3 AS REAL)) AS ccv_n3,
      AVG(CAST(mean_bias_l1 AS REAL)) AS bias_l1, AVG(CAST(mean_bias_l2 AS REAL)) AS bias_l2`;
  const where = year
    ? `WHERE bead_name = ? AND insp_date LIKE ?`
    : `WHERE bead_name = ?`;
  const sql = `SELECT ${cols} FROM drbeadinspection ${where} GROUP BY sheet_name, insp_date ORDER BY insp_date DESC LIMIT ?`;
  const rows = year
    ? db.prepare(sql).all(bead, yearLike(year), limit)
    : db.prepare(sql).all(bead, limit);
  const pct = v => v ? parseFloat((Number(v) * 100).toFixed(2)) : null;
  const num = v => v ? parseFloat(Number(v).toFixed(4)) : null;
  res.json(rows.reverse().map(r => ({
    lot: r.lot,
    od_l1: num(r.od_l1), od_l2: num(r.od_l2), od_n1: num(r.od_n1), od_n3: num(r.od_n3),
    cv_l1: pct(r.cv_l1), cv_l2: pct(r.cv_l2), cv_n1: pct(r.cv_n1), cv_n3: pct(r.cv_n3),
    ccv_l1: pct(r.ccv_l1), ccv_l2: pct(r.ccv_l2), ccv_n1: pct(r.ccv_n1), ccv_n3: pct(r.ccv_n3),
    bias_l1: pct(r.bias_l1), bias_l2: pct(r.bias_l2),
  })));
});

// GET /api/drbeads/anomalies — pending/hold lots (異常追蹤)
router.get('/anomalies', (req, res) => {
  const year = normalizeYear(req.query.year);
  const pendingHoldWhere = `(final_decision IS NULL OR final_decision = '' OR final_decision = '-'
      OR UPPER(COALESCE(final_decision,'')) LIKE '%HOLD%')`;
  const sql = year ? `
    SELECT
      id,
      bead_name || ' / ' || sheet_name AS type,
      COALESCE(defect_desc, CASE
        WHEN UPPER(COALESCE(final_decision,'')) LIKE '%HOLD%' THEN 'Hold - ' || final_decision
        ELSE 'Pending'
      END) AS description,
      CASE WHEN UPPER(COALESCE(final_decision,'')) LIKE '%HOLD%' THEN 'HOLD' ELSE 'PENDING' END AS status,
      insp_date AS created_at
    FROM drbeadinspection
    WHERE ${pendingHoldWhere}
      AND (insp_date LIKE ? OR insp_date IS NULL)
    ORDER BY insp_date DESC
    LIMIT 20
  ` : `
    SELECT
      id,
      bead_name || ' / ' || sheet_name AS type,
      COALESCE(defect_desc, CASE
        WHEN UPPER(COALESCE(final_decision,'')) LIKE '%HOLD%' THEN 'Hold - ' || final_decision
        ELSE 'Pending'
      END) AS description,
      CASE WHEN UPPER(COALESCE(final_decision,'')) LIKE '%HOLD%' THEN 'HOLD' ELSE 'PENDING' END AS status,
      insp_date AS created_at
    FROM drbeadinspection
    WHERE ${pendingHoldWhere}
    ORDER BY insp_date DESC
    LIMIT 20
  `;
  const rows = year ? db.prepare(sql).all(yearLike(year)) : db.prepare(sql).all();
  res.json(rows);
});

// GET /api/drbeads/ng-lots — lots where final_decision is NG/FAIL/Reject
router.get('/ng-lots', (req, res) => {
  const year = normalizeYear(req.query.year);
  const ngWhere = `(final_decision LIKE '%FAIL%' OR final_decision LIKE '%NG%' OR final_decision LIKE '%Reject%')`;
  const sql = year ? `
    SELECT id, bead_name, sheet_name, batch_combo, final_decision, insp_date,
           COALESCE(defect_desc,'') AS defect_desc, d_lot, bigD_lot, u_lot
    FROM drbeadinspection
    WHERE ${ngWhere} AND insp_date LIKE ?
    ORDER BY insp_date DESC
  ` : `
    SELECT id, bead_name, sheet_name, batch_combo, final_decision, insp_date,
           COALESCE(defect_desc,'') AS defect_desc, d_lot, bigD_lot, u_lot
    FROM drbeadinspection
    WHERE ${ngWhere}
    ORDER BY insp_date DESC
  `;
  const rows = year ? db.prepare(sql).all(yearLike(year)) : db.prepare(sql).all();
  res.json(rows);
});

// GET /api/drbeads/anomaly-lots — lots where final_decision is pending or hold
router.get('/anomaly-lots', (req, res) => {
  const year = normalizeYear(req.query.year);
  const pendingHoldWhere = `(final_decision IS NULL OR final_decision = '' OR final_decision = '-'
      OR UPPER(COALESCE(final_decision,'')) LIKE '%HOLD%')`;
  const sql = year ? `
    SELECT id, bead_name, sheet_name, batch_combo, final_decision, insp_date,
           COALESCE(defect_desc,'') AS defect_desc, d_lot, bigD_lot, u_lot
    FROM drbeadinspection
    WHERE ${pendingHoldWhere} AND (insp_date LIKE ? OR insp_date IS NULL)
    ORDER BY insp_date DESC
  ` : `
    SELECT id, bead_name, sheet_name, batch_combo, final_decision, insp_date,
           COALESCE(defect_desc,'') AS defect_desc, d_lot, bigD_lot, u_lot
    FROM drbeadinspection
    WHERE ${pendingHoldWhere}
    ORDER BY insp_date DESC
  `;
  const rows = year ? db.prepare(sql).all(yearLike(year)) : db.prepare(sql).all();
  res.json(rows);
});

// DELETE /api/drbeads/sheet?bead_name=tCREA&sheet_name=26D1412U141234
router.delete('/sheet', (req, res) => {
  const { bead_name, sheet_name } = req.query;
  if (!bead_name || !sheet_name)
    return res.status(400).json({ error: 'bead_name and sheet_name required' });
  const del = db.transaction(() => {
    const t1 = db.prepare(
      'DELETE FROM drbeadinspection WHERE bead_name = ? AND sheet_name = ?'
    ).run(bead_name, sheet_name);
    const t2 = db.prepare(
      'DELETE FROM posts WHERE bead_name = ? AND sheet_name = ?'
    ).run(bead_name, sheet_name);
    const t3 = db.prepare(
      'DELETE FROM rawdata WHERE bead_name = ? AND sheet_name = ?'
    ).run(bead_name, sheet_name);
    return { table1: t1.changes, table2: t2.changes, rawdata: t3.changes };
  });
  const result = del();
  res.json({ deleted: result.table1 + result.table2 + result.rawdata, ...result });
});

export default router;
