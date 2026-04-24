/**
 * /api/excel-import — Upload Excel (.xlsx) → parse → write drbeadinspection + posts
 *
 * Mirrors the logic of drbeadinspection_import.py + posts_import.py
 * Cell mapping based on the 2026 IPQC template (M1:AE142)
 */
import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import path from 'path';
import db from '../db/sqlite.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const XLSX_READ_OPTS = {
  type:        'buffer',
  cellStyles:  false,
  cellNF:      false,
  cellHTML:    false,
  cellFormula: false,
  sheetStubs:  false,
  bookVBA:     false,
};

// ── helpers ──────────────────────────────────────────────────────────────

/** Read cell value; Excel serial date → YYYY-MM-DD string */
function cv(ws, addr) {
  const cell = ws[addr];
  if (!cell) return null;
  if (cell.t === 'n' && cell.v > 40000 && cell.v < 60000) {
    // Excel date serial → JS Date
    const d = XLSX.SSF.parse_date_code(cell.v);
    return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const v = cell.v;
  if (v == null) return null;
  const s = String(v).trim();
  if (['#REF!','#VALUE!','#N/A','#NAME?','#DIV/0!'].includes(s)) return null;
  return s || null;
}

/** Numeric cell → string (preserve floats) */
function cvn(ws, addr) {
  const cell = ws[addr];
  if (!cell) return null;
  if (cell.t === 'e') return null;
  const v = cell.v;
  if (v == null || v === 0) return null;
  return String(v);
}

/** Column number (1-based) → letter(s) */
function colLetter(c) { return XLSX.utils.encode_col(c - 1); }

/** Build cell address from row (1-based) and col (1-based) */
function addr(r, c) { return colLetter(c) + r; }

/** Combine two spec cells into one string */
function specStr(ws, r, c1, c2) {
  const a = cv(ws, addr(r, c1));
  const b = cv(ws, addr(r, c2));
  const parts = [a, b].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

/** Extract bead_name from filename: "2026-FRU-使用F1、F2.xlsx" → "FRU" */
function extractBeadName(filename) {
  const stem = path.basename(filename, path.extname(filename));
  const after = stem.replace(/^2026-/, '');
  const m = after.match(/^([A-Za-z0-9-]+)/);
  return m ? m[1].replace(/-$/, '') : after;
}

/** Check if sheet is a data sheet (表一: M1 contains 'Dried Beads') */
function isDataSheet(ws) {
  const v = cv(ws, 'M1');
  return v && v.includes('Dried Beads');
}

/** Check if sheet has 表二 data (M88 contains 'Dried') */
function isPostsSheet(ws) {
  const v = cv(ws, 'M88');
  return v && v.includes('Dried');
}

// ── Parse Table 1 (drbeadinspection) — M1:X65 ──────────────────────────

const BATCH_COLS = [17, 18, 19, 20]; // Q, R, S, T

function parseTable1(ws, beadName, fileName) {
  const rows = [];
  const c = (r, col) => cv(ws, addr(r, col));

  const productName = c(4, 14);
  const inspDate    = c(4, 20);

  const reagent = (row) => ({
    part_no: c(row, 14), prod_date: c(row, 15),
    work_order: c(row, 20), send_qty: c(row, 21), sample_qty: c(row, 23),
    lots: [c(row, 16), c(row, 17), c(row, 18), c(row, 19)],
  });
  const d = reagent(8), D = reagent(10), U = reagent(12);

  const wellPos  = c(14, 14), stdName  = c(14, 16);
  const stdLotL1 = c(15, 16), stdLotL2 = c(16, 16);
  const machL1 = c(14, 23), machL2 = c(15, 23), machN1 = c(16, 23), machN3 = c(17, 23);

  let odCvSpec    = specStr(ws, 41, 15, 16);
  if (!odCvSpec || odCvSpec === '-') { const alt = specStr(ws, 43, 15, 16); if (alt && alt !== '-') odCvSpec = alt; }
  let rconcCvSpec = specStr(ws, 45, 15, 16);
  if (!rconcCvSpec || rconcCvSpec === '-') { const alt = specStr(ws, 47, 15, 16); if (alt && alt !== '-') rconcCvSpec = alt; }
  const meanBiasSpec = specStr(ws, 49, 15, 16);
  const totalCvSpec  = specStr(ws, 51, 15, 16);
  const initialSpec  = specStr(ws, 53, 15, 16);

  // OD analysis helpers
  const odRow = (row) => {
    const n = (r2, col) => cvn(ws, addr(r2, col));
    return {
      slope: n(row,18), intercept: n(row,19),
      mean_l1: n(row,20), mean_l2: n(row,21), mean_n1: n(row,22), mean_n3: n(row,23),
      cvpct_l1: n(row,24), cvpct_l2: n(row,25), cvpct_n1: n(row,26), cvpct_n3: n(row,27),
      bias_l1: n(row,28), bias_l2: n(row,29), bias_n1: n(row,30), bias_n3: n(row,31),
    };
  };
  const concBatchRow = (row) => {
    const n = (r2, col) => cvn(ws, addr(r2, col));
    return { mean_l1: n(row,20), mean_l2: n(row,21), cvpct_l1: n(row,24), cvpct_l2: n(row,25) };
  };
  const concFullRow = (row) => {
    const n = (r2, col) => cvn(ws, addr(r2, col));
    return { mean_l1: n(row,20), mean_l2: n(row,21), cvpct_l1: n(row,24), cvpct_l2: n(row,25),
             bias_l1: n(row,28), bias_l2: n(row,29) };
  };
  const odTotal   = odRow(122);
  const concTotal = concBatchRow(141);

  for (let i = 0; i < BATCH_COLS.length; i++) {
    const col = BATCH_COLS[i];
    const batchCombo = c(21, col);
    if (!batchCombo) continue;

    const od = odRow(114 + i);
    const cb = concBatchRow(124 + i);
    const cf = concFullRow(133 + i);

    rows.push({
      bead_name: beadName, file_name: fileName, sheet_name: ws['!sheetname'] || '',
      batch_col: col, product_name: productName, insp_date: inspDate,
      d_part_no: d.part_no, d_prod_date: d.prod_date, d_lot: d.lots[i],
      d_work_order: d.work_order, d_send_qty: d.send_qty, d_sample_qty: d.sample_qty,
      bigD_part_no: D.part_no, bigD_prod_date: D.prod_date, bigD_lot: D.lots[i],
      bigD_work_order: D.work_order, bigD_send_qty: D.send_qty, bigD_sample_qty: D.sample_qty,
      u_part_no: U.part_no, u_prod_date: U.prod_date, u_lot: U.lots[i],
      u_work_order: U.work_order, u_send_qty: U.send_qty, u_sample_qty: U.sample_qty,
      well_position: wellPos, std_name: stdName, std_lot_l1: stdLotL1, std_lot_l2: stdLotL2,
      machine_L1: machL1, machine_L2: machL2, machine_N1: machN1, machine_N3: machN3,
      batch_combo: batchCombo,
      crack: c(24, col), dirt: c(28, col), color: c(32, col),
      od_cv_spec: odCvSpec,
      od_cv_l1: c(41, col), od_cv_l2: c(42, col), od_cv_n1: c(43, col), od_cv_n3: c(44, col),
      rconc_cv_spec: rconcCvSpec,
      rconc_cv_l1: c(45, col), rconc_cv_l2: c(46, col), rconc_cv_n1: c(47, col), rconc_cv_n3: c(48, col),
      mean_bias_spec: meanBiasSpec,
      mean_bias_l1: c(49, col), mean_bias_l2: c(50, col),
      total_cv_spec: totalCvSpec, total_cv_l1: c(51, col), total_cv_l2: c(52, col),
      initial_spec: initialSpec, initial_l1: c(53, col), initial_l2: c(54, col),
      batch_decision: c(55, col), final_decision: c(57, col),
      defect_desc: c(59, col), remarks: c(61, col),
      // OD per batch
      od_slope: od.slope, od_intercept: od.intercept,
      od_mean_l1: od.mean_l1, od_mean_l2: od.mean_l2, od_mean_n1: od.mean_n1, od_mean_n3: od.mean_n3,
      od_cvpct_l1: od.cvpct_l1, od_cvpct_l2: od.cvpct_l2, od_cvpct_n1: od.cvpct_n1, od_cvpct_n3: od.cvpct_n3,
      od_bias_l1: od.bias_l1, od_bias_l2: od.bias_l2, od_bias_n1: od.bias_n1, od_bias_n3: od.bias_n3,
      // OD total
      od_tot_slope: odTotal.slope, od_tot_intercept: odTotal.intercept,
      od_tot_mean_l1: odTotal.mean_l1, od_tot_mean_l2: odTotal.mean_l2,
      od_tot_mean_n1: odTotal.mean_n1, od_tot_mean_n3: odTotal.mean_n3,
      od_tot_cvpct_l1: odTotal.cvpct_l1, od_tot_cvpct_l2: odTotal.cvpct_l2,
      od_tot_cvpct_n1: odTotal.cvpct_n1, od_tot_cvpct_n3: odTotal.cvpct_n3,
      od_tot_bias_l1: odTotal.bias_l1, od_tot_bias_l2: odTotal.bias_l2,
      od_tot_bias_n1: odTotal.bias_n1, od_tot_bias_n3: odTotal.bias_n3,
      // Conc per batch
      conc_mean_l1: cb.mean_l1, conc_mean_l2: cb.mean_l2,
      conc_cvpct_l1: cb.cvpct_l1, conc_cvpct_l2: cb.cvpct_l2,
      // Conc full batch
      conc_tot_mean_l1: cf.mean_l1, conc_tot_mean_l2: cf.mean_l2,
      conc_tot_cvpct_l1: cf.cvpct_l1, conc_tot_cvpct_l2: cf.cvpct_l2,
      conc_tot_bias_l1: cf.bias_l1, conc_tot_bias_l2: cf.bias_l2,
      // Conc total
      conc_total_mean_l1: concTotal.mean_l1, conc_total_mean_l2: concTotal.mean_l2,
      conc_total_cvpct_l1: concTotal.cvpct_l1, conc_total_cvpct_l2: concTotal.cvpct_l2,
    });
  }
  return rows;
}

// ── Parse Table 2 (posts) — L88:AE142 ───────────────────────────────────

const N_COMBOS = 8;
const VISUAL_START = 101, OD_START = 114, SB_START = 124, FB_START = 133;

function parseCrackDirt(ws, r, col) {
  const v = cv(ws, addr(r, col));
  if (!v) return null;
  if (v.includes('R有')) return '有';
  if (v.includes('R無')) return '無';
  return null;
}
function parseColor(ws, r, col) {
  const v = cv(ws, addr(r, col));
  if (!v) return null;
  if (v.includes('RPASS')) return 'PASS';
  if (v.includes('RNG')) return 'NG';
  return null;
}

function parseTable2(ws, beadName, fileName) {
  const rows = [];
  const c = (r, col) => cv(ws, addr(r, col));
  const n = (r, col) => cvn(ws, addr(r, col));

  const marker = c(91,14);
  const pn_d = c(93,14), pn_bigD = c(93,15), pn_u = c(93,16);
  const prod_date_d = c(94,14), prod_date_bigD = c(94,15), prod_date_u = c(94,16);
  const inspDate = c(95,14);
  const wo_d = c(96,14), wo_bigD = c(96,15), wo_u = c(96,16);
  const sq_d = c(97,14), sq_bigD = c(97,15), sq_u = c(97,16);
  const smq_d = c(98,14), smq_bigD = c(98,15), smq_u = c(98,16);

  const fw = c(95,18);
  const cs_type_l1 = c(95,19), cs_type_l2 = c(96,19);
  const tea_l1 = n(95,20), tea_l2 = n(96,20);
  const mg_dl_l1 = n(95,21), mg_dl_l2 = n(96,21);
  const lsl_l1 = n(95,22), usl_l1 = n(95,23), lsl_l2 = n(96,22), usl_l2 = n(96,23);
  const conc_cv_spec = n(95,24);
  const mean_bias_spec_l1 = n(95,25), mean_bias_spec_l2 = n(96,25);
  const total_cv_spec = n(95,26);
  const control_ref_l1 = c(95,27), control_ref_l2 = c(96,27);
  const cs_name = c(94,29), cs_lot_l1 = c(97,29), cs_lot_l2 = c(98,29);

  for (let i = 0; i < N_COMBOS; i++) {
    const vr = VISUAL_START + i, orw = OD_START + i, sr = SB_START + i, fr = FB_START + i;
    const lot_d = c(vr,14), lot_bigD = c(vr,15), lot_u = c(vr,16);
    if (!lot_d && !lot_bigD && !lot_u) continue;

    rows.push({
      bead_name: beadName, file_name: fileName, sheet_name: ws['!sheetname'] || '',
      combo_idx: i + 1, marker,
      pn_d, pn_bigD, pn_u, prod_date_d, prod_date_bigD, prod_date_u, insp_date: inspDate,
      work_order_d: wo_d, work_order_bigD: wo_bigD, work_order_u: wo_u,
      send_qty_d: sq_d, send_qty_bigD: sq_bigD, send_qty_u: sq_u,
      sample_qty_d: smq_d, sample_qty_bigD: smq_bigD, sample_qty_u: smq_u,
      fw, cs_type_l1, cs_type_l2, tea_l1, tea_l2,
      mg_dl_l1, mg_dl_l2, lsl_l1, usl_l1, lsl_l2, usl_l2,
      conc_cv_spec, mean_bias_spec_l1, mean_bias_spec_l2, total_cv_spec,
      control_ref_l1, control_ref_l2, cs_name, cs_lot_l1, cs_lot_l2,
      lot_d, lot_bigD, lot_u,
      crack: parseCrackDirt(ws, vr, 17), dirt: parseCrackDirt(ws, vr, 19), color: parseColor(ws, vr, 20),
      cv_conform: c(vr,24), bias_conform: c(vr,25), merge_judge: c(vr,26), final_judge: c(vr,27),
      slope: n(orw,18), intercept: n(orw,19),
      od_mean_l1: n(orw,20), od_mean_l2: n(orw,21), od_mean_n1: n(orw,22), od_mean_n3: n(orw,23),
      od_cv_l1: n(orw,24), od_cv_l2: n(orw,25), od_cv_n1: n(orw,26), od_cv_n3: n(orw,27),
      od_bias_l1: n(orw,28), od_bias_l2: n(orw,29), od_bias_n1: n(orw,30), od_bias_n3: n(orw,31),
      sb_judge_d: c(sr,17), sb_judge_u: c(sr,18), sb_judge_result: c(sr,19),
      sb_conc_mean_l1: n(sr,20), sb_conc_mean_l2: n(sr,21),
      sb_conc_cv_l1: n(sr,24), sb_conc_cv_l2: n(sr,25),
      fb_judge_l1: c(fr,17), fb_judge_l2: c(fr,18), fb_initial_judge: c(fr,19),
      fb_conc_mean_l1: n(fr,20), fb_conc_mean_l2: n(fr,21),
      fb_conc_cv_l1: n(fr,24), fb_conc_cv_l2: n(fr,25),
      fb_bias_l1: n(fr,28), fb_bias_l2: n(fr,29),
    });
  }
  return rows;
}

// ── Prepared statements ─────────────────────────────────────────────────

const drCols = db.prepare('PRAGMA table_info(drbeadinspection)').all().map(c => c.name).filter(c => c !== 'id');
const drInsert = db.prepare(`INSERT INTO drbeadinspection (${drCols.join(',')}) VALUES (${drCols.map(c => '@' + c).join(',')})`);

const postCols = db.prepare('PRAGMA table_info(posts)').all().map(c => c.name).filter(c => c !== 'id');
const postInsert = db.prepare(`INSERT INTO posts (${postCols.join(',')}) VALUES (${postCols.map(c => '@' + c).join(',')})`);

const existsStmt = db.prepare('SELECT 1 FROM drbeadinspection WHERE bead_name=? AND sheet_name=? LIMIT 1');
const postsExistsStmt = db.prepare('SELECT 1 FROM posts WHERE bead_name=? AND sheet_name=? LIMIT 1');

function safeParams(cols, obj) {
  const p = {};
  for (const c of cols) p[c] = obj[c] ?? null;
  return p;
}

// ── POST /api/excel-import/upload-batch ──────────────────────────────────
// Accept multiple 2026-*.xlsx files (from folder select)

router.post('/upload-batch', upload.array('files', 100), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'no files' });

  const summary = { total_files: 0, imported_files: 0, total_sheets: 0, skipped_sheets: 0, results: [] };

  // ── Phase 1: parse all xlsx files (CPU-intensive, outside transaction) ──
  const allT1Rows = [], allT2Rows = [];
  const seenThisChunk = new Set(); // within-chunk deduplicate

  for (const file of files) {
    const originalName = file.originalname || '';
    if (!originalName.startsWith('2026-') || !originalName.endsWith('.xlsx') || originalName.startsWith('~$')) continue;

    const beadName = extractBeadName(originalName);
    summary.total_files++;

    let wb;
    try { wb = XLSX.read(file.buffer, XLSX_READ_OPTS); } catch (e) { console.error('[xlsx]', originalName, e.message); continue; }

    const fileResult = { bead_name: beadName, imported: 0, skipped: 0 };

    for (const sheetName of wb.SheetNames) {
      if (sheetName === 'Temp' || sheetName === 'QBi Beads總表' || sheetName === 'OD趨勢' || sheetName === '變更歷程事項' || sheetName.startsWith('工作表')) continue;
      const ws = wb.Sheets[sheetName];
      ws['!sheetname'] = sheetName;

      const key = `${beadName}\x00${sheetName}`;
      const drExists = seenThisChunk.has(key) || !!existsStmt.get(beadName, sheetName);
      const postExists = !!postsExistsStmt.get(beadName, sheetName);

      if (drExists && postExists) {
        fileResult.skipped++;
        summary.skipped_sheets++;
        continue;
      }

      const t1Rows = (!drExists && isDataSheet(ws)) ? parseTable1(ws, beadName, originalName) : [];
      const t2Rows = (!postExists && isPostsSheet(ws)) ? parseTable2(ws, beadName, originalName) : [];
      if (!t1Rows.length && !t2Rows.length) continue;

      allT1Rows.push(...t1Rows);
      allT2Rows.push(...t2Rows);
      seenThisChunk.add(key);
      fileResult.imported++;
      summary.total_sheets++;
    }

    if (fileResult.imported > 0) summary.imported_files++;
    summary.results.push(fileResult);
  }

  // ── Phase 2: write to DB in a single short transaction ──
  try {
    db.transaction(() => {
      for (const row of allT1Rows) drInsert.run(safeParams(drCols, row));
      for (const row of allT2Rows) postInsert.run(safeParams(postCols, row));
    })();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
