import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import specDb from '../db/specDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({ dest: path.resolve(__dirname, '../uploads') });
const router = Router();

// ── Parse helpers ─────────────────────────────────────────────────────
function norm(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' || s === '-' ? null : s;
}

function findSpecSheet(wb) {
  return wb.SheetNames.find(s => s.includes('允收') || s.includes('併批')) || null;
}

function detectSource(matrix) {
  // Qbi has PN in C3 (numeric) and Name in C4; P01 has Marker name in C3
  // Check row 2-3 headers for 'Qbi' or 'PN'
  for (let r = 0; r < Math.min(5, matrix.length); r++) {
    const row = matrix[r] || [];
    for (const cell of row) {
      if (cell && String(cell).includes('Qbi')) return 'Qbi';
    }
  }
  // Check if C3 row 3+ looks like a number (PN) → Qbi
  for (let r = 2; r < Math.min(6, matrix.length); r++) {
    const c3 = matrix[r]?.[2];
    if (c3 && /^\d{5,}$/.test(String(c3).trim())) return 'Qbi';
  }
  return 'P01';
}

function parseP01(matrix) {
  // Header row: find row with 'Marker' in C3 (col index 2)
  let startRow = 0;
  for (let r = 0; r < Math.min(10, matrix.length); r++) {
    const c3 = norm(matrix[r]?.[2]);
    if (c3 && /marker/i.test(c3)) { startRow = r + 1; break; }
  }
  // P01 also has a Hi section starting around row 44
  // Find second header row for Hi markers
  let hiStartRow = 0;
  for (let r = startRow; r < matrix.length; r++) {
    const c3 = norm(matrix[r]?.[2]);
    if (c3 && /marker/i.test(c3)) { hiStartRow = r + 1; break; }
  }

  const specs = [];

  // Parse P01 main section (rows after first 'Marker' header)
  const endMain = hiStartRow > 0 ? hiStartRow - 2 : matrix.length;
  for (let r = startRow; r < endMain; r++) {
    const row = matrix[r] || [];
    const marker = norm(row[2]); // C3
    if (!marker) continue;

    specs.push({
      source: 'P01',
      marker,
      pn: null,
      tea: norm(row[3]),           // C4
      single_cv: norm(row[4]),     // C5
      init_l1_od: norm(row[5]),    // C6
      init_l2_od: norm(row[6]),    // C7
      spec_l1_od: norm(row[7]),    // C8
      spec_l2_od: norm(row[8]),    // C9
      spec_n1_od: null,
      well_config: norm(row[10]),  // C11
      dilution: null,
      calc_method: norm(row[11]),  // C12
      merge_bias: norm(row[12]),   // C13
      merge_cv: norm(row[13]),     // C14
      remarks: norm(row[14]),      // C15
    });
  }

  // Parse Hi section if exists
  if (hiStartRow > 0) {
    for (let r = hiStartRow; r < matrix.length; r++) {
      const row = matrix[r] || [];
      const marker = norm(row[2]);
      if (!marker) continue;

      specs.push({
        source: 'P01',
        marker,
        pn: null,
        tea: norm(row[3]),
        single_cv: norm(row[4]),
        init_l1_od: norm(row[5]),
        init_l2_od: norm(row[6]),
        spec_l1_od: norm(row[7]),
        spec_l2_od: norm(row[8]),
        spec_n1_od: null,
        well_config: norm(row[10]),
        dilution: null,
        calc_method: norm(row[11]),
        merge_bias: norm(row[12]),
        merge_cv: norm(row[13]),
        remarks: norm(row[14]),
      });
    }
  }

  return specs;
}

function parseQbi(matrix) {
  // Header row: find row with 'Name' or 'Marker' or 'PN'
  let startRow = 0;
  for (let r = 0; r < Math.min(6, matrix.length); r++) {
    const c4 = norm(matrix[r]?.[3]);
    if (c4 && /name/i.test(c4)) { startRow = r + 1; break; }
    const c3 = norm(matrix[r]?.[2]);
    if (c3 && /pn/i.test(c3)) { startRow = r + 1; break; }
  }

  const specs = [];
  for (let r = startRow; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const marker = norm(row[3]); // C4 = Name
    if (!marker) continue;

    specs.push({
      source: 'Qbi',
      marker,
      pn: norm(row[2]),            // C3
      tea: norm(row[4]),           // C5
      single_cv: norm(row[5]),     // C6
      init_l1_od: norm(row[6]),    // C7
      init_l2_od: norm(row[7]),    // C8
      spec_l1_od: norm(row[8]),    // C9
      spec_l2_od: norm(row[9]),    // C10
      spec_n1_od: norm(row[10]),   // C11
      well_config: norm(row[11]),  // C12
      dilution: norm(row[12]),     // C13
      calc_method: norm(row[13]),  // C14
      merge_bias: norm(row[14]),   // C15
      merge_cv: norm(row[15]),     // C16
      remarks: norm(row[16]),      // C17
    });
  }
  return specs;
}

// ── Upsert to DB ──────────────────────────────────────────────────────
const upsertStmt = specDb.prepare(`
  INSERT INTO bead_ipqc_spec
    (source, source_file, marker, pn, tea, single_cv,
     init_l1_od, init_l2_od, spec_l1_od, spec_l2_od, spec_n1_od,
     well_config, dilution, calc_method, merge_bias, merge_cv, remarks, updated_at)
  VALUES
    (@source, @source_file, @marker, @pn, @tea, @single_cv,
     @init_l1_od, @init_l2_od, @spec_l1_od, @spec_l2_od, @spec_n1_od,
     @well_config, @dilution, @calc_method, @merge_bias, @merge_cv, @remarks, datetime('now','localtime'))
  ON CONFLICT(source, marker) DO UPDATE SET
    source_file = excluded.source_file,
    pn          = excluded.pn,
    tea         = excluded.tea,
    single_cv   = excluded.single_cv,
    init_l1_od  = excluded.init_l1_od,
    init_l2_od  = excluded.init_l2_od,
    spec_l1_od  = excluded.spec_l1_od,
    spec_l2_od  = excluded.spec_l2_od,
    spec_n1_od  = excluded.spec_n1_od,
    well_config = excluded.well_config,
    dilution    = excluded.dilution,
    calc_method = excluded.calc_method,
    merge_bias  = excluded.merge_bias,
    merge_cv    = excluded.merge_cv,
    remarks     = excluded.remarks,
    updated_at  = datetime('now','localtime')
`);

function upsertSpecs(specs, fileName) {
  let inserted = 0, updated = 0;
  const existingStmt = specDb.prepare('SELECT id FROM bead_ipqc_spec WHERE source = ? AND marker = ?');

  specDb.transaction(() => {
    for (const s of specs) {
      const existing = existingStmt.get(s.source, s.marker);
      upsertStmt.run({ ...s, source_file: fileName });
      if (existing) updated++; else inserted++;
    }
  })();

  return { inserted, updated };
}

// ── Shared parse logic ────────────────────────────────────────────────
function parseExcelFile(filePath) {
  const wb = XLSX.readFile(filePath, { cellText: true });
  const sheetName = findSpecSheet(wb);
  if (!sheetName) throw new Error('找不到「Bead允收_併批標準」sheet');

  const ws = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const source = detectSource(matrix);
  const specs = source === 'Qbi' ? parseQbi(matrix) : parseP01(matrix);
  if (specs.length === 0) throw new Error('未解析到任何 marker 規格');

  return { source, sheetName, specs };
}

// Default UNC paths (local dev)
const DEFAULT_PATHS = {
  P01: String.raw`\\fls341\Reagent RD\RD-配藥端_Liquid.bead QC SPEC\2026.03.09  P01_Liquid_bead form QC SPEC.xlsm`,
  Qbi: String.raw`\\fls341\Reagent RD\RD-配藥端_Liquid.bead QC SPEC\2026.03.09 Qbi_Liquid_bead form QC SPEC v2.xlsm`,
};

// ── Routes ────────────────────────────────────────────────────────────

// GET /api/spec/defaults — return default paths + accessibility
router.get('/defaults', (_req, res) => {
  const result = {};
  for (const [key, p] of Object.entries(DEFAULT_PATHS)) {
    result[key] = { path: p, accessible: fs.existsSync(p) };
  }
  res.json(result);
});

// POST /api/spec/sync — read from file path (UNC or local), no upload needed
// Body: { paths: { P01: "...", Qbi: "..." } }  (optional, uses defaults if omitted)
router.post('/sync', (req, res) => {
  const paths = req.body?.paths || {};
  const results = [];

  for (const [key, defaultPath] of Object.entries(DEFAULT_PATHS)) {
    const filePath = paths[key] || defaultPath;
    try {
      if (!fs.existsSync(filePath)) {
        results.push({ source: key, ok: false, error: `檔案不存在: ${filePath}` });
        continue;
      }
      const { source, sheetName, specs } = parseExcelFile(filePath);
      const { inserted, updated } = upsertSpecs(specs, path.basename(filePath));
      results.push({
        source, ok: true, sheet: sheetName,
        fileName: path.basename(filePath),
        total: specs.length, inserted, updated,
      });
    } catch (err) {
      results.push({ source: key, ok: false, error: err.message });
    }
  }

  res.json({ ok: results.every(r => r.ok), results });
});

// POST /api/spec/upload — upload Excel file (for EC2 / no UNC access)
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未選擇檔案' });

  try {
    const { source, sheetName, specs } = parseExcelFile(req.file.path);
    const { inserted, updated } = upsertSpecs(specs, req.file.originalname);

    fs.unlink(req.file.path, () => {});

    res.json({
      ok: true, source, sheet: sheetName,
      fileName: req.file.originalname,
      total: specs.length, inserted, updated,
      markers: specs.map(s => s.marker),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/spec — all specs
router.get('/', (_req, res) => {
  const rows = specDb.prepare('SELECT * FROM bead_ipqc_spec ORDER BY source, marker').all();
  res.json(rows);
});

// GET /api/spec/p01 — P01 specs only
router.get('/p01', (_req, res) => {
  const rows = specDb.prepare("SELECT * FROM bead_ipqc_spec WHERE source = 'P01' ORDER BY marker").all();
  res.json(rows);
});

// GET /api/spec/qbi — Qbi specs only
router.get('/qbi', (_req, res) => {
  const rows = specDb.prepare("SELECT * FROM bead_ipqc_spec WHERE source = 'Qbi' ORDER BY marker").all();
  res.json(rows);
});

// GET /api/spec/marker/:name — spec for a specific marker (both sources)
router.get('/marker/:name', (req, res) => {
  const rows = specDb.prepare('SELECT * FROM bead_ipqc_spec WHERE marker = ? OR marker LIKE ?')
    .all(req.params.name, `%${req.params.name}%`);
  res.json(rows);
});

// GET /api/spec/lookup/:bead_name — smart match bead_name to spec
// 兩劑 (ALP-D, ALP-U) 共用同一個 spec
// 三劑 CREA: tCREA / tCREA-d / tCREA-D / tCREA-U 都對到 tCREA spec
router.get('/lookup/:bead_name', (req, res) => {
  const name = req.params.bead_name.trim();
  const allSpecs = specDb.prepare('SELECT * FROM bead_ipqc_spec').all();
  if (!allSpecs.length) return res.json({ p01: null, qbi: null });

  const up = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
  // Strip reagent suffixes: -D, -U, -A, -B, -AU, -AD, -BU, -BD etc.
  const stripReagent = (s) => String(s || '').replace(/[-_]?(AU|AD|BU|BD|[ADBU])$/i, '');
  // Strip Q prefix for Qbi markers
  const stripQ = (s) => String(s || '').replace(/^Q/i, '');
  // Strip leading t (tCREA → CREA)
  const stripT = (s) => String(s || '').replace(/^T(?=[A-Z])/, '');
  const clean = (s) => up(s).replace(/[^A-Z0-9/_(),-]+/g, '');
  // Core: strip helper prefixes/suffixes after normalizing punctuation
  const core = (s) => stripT(stripReagent(stripQ(clean(s))));

  function extractMarkerTokens(raw) {
    const source = String(raw || '').toUpperCase();
    const tokens = new Set();
    const matches = source.match(/[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*/g) || [];

    for (const token of matches) {
      if (token === 'QBI' || token === 'DEVICE') continue;
      tokens.add(token);
      tokens.add(stripReagent(token));
      tokens.add(stripQ(token));
      tokens.add(stripT(token));
      tokens.add(core(token));
    }

    const normalized = clean(raw);
    if (normalized) {
      tokens.add(normalized);
      tokens.add(stripReagent(normalized));
      tokens.add(stripQ(normalized));
      tokens.add(stripT(normalized));
      tokens.add(core(normalized));
    }

    return [...tokens].filter(Boolean);
  }

  function findBest(specs) {
    const wanted = new Set(extractMarkerTokens(name));
    // 1. Exact / normalized marker field
    let hit = specs.find(s => wanted.has(clean(s.marker)) || wanted.has(core(s.marker)));
    if (hit) return hit;

    // 2. Strip reagent suffix then exact (ALP-D → ALP)
    hit = specs.find(s => extractMarkerTokens(s.marker).some(token => wanted.has(token)));
    if (hit) return hit;

    // 3. Conservative fallback: only allow full-token family matches
    hit = specs.find(s =>
      extractMarkerTokens(s.marker).some(token =>
        [...wanted].some(w => token.startsWith(w + '-') || w.startsWith(token + '-'))
      )
    );
    if (hit) return hit;
    return null;
  }

  const p01Specs = allSpecs.filter(s => s.source === 'P01');
  const qbiSpecs = allSpecs.filter(s => s.source === 'Qbi');

  res.json({
    p01: findBest(p01Specs),
    qbi: findBest(qbiSpecs),
  });
});

// GET /api/spec/status — summary info
router.get('/status', (_req, res) => {
  const p01 = specDb.prepare("SELECT COUNT(*) as cnt, MAX(updated_at) as last_update FROM bead_ipqc_spec WHERE source = 'P01'").get();
  const qbi = specDb.prepare("SELECT COUNT(*) as cnt, MAX(updated_at) as last_update FROM bead_ipqc_spec WHERE source = 'Qbi'").get();
  res.json({ p01, qbi });
});

export default router;
