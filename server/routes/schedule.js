/**
 * /api/schedule – 排產匯入
 *
 * DropletSchedule (on beadsops-ec2 via SSH):
 *   "Date"    = 生產日期 "2026/04/01"  (Date is reserved word → quoted)
 *   Marker    = schedule marker name (see parseMarker)
 *   WorkOrder = 工單號碼
 *   Lot       = 批號
 *
 * 顯示條件: today > prod_date + 1 (生產隔天後才可檢驗)
 * 檢驗日 (insp_date): 使用者匯入當天
 * 只取 2026/04 以後的排產
 */
import { Router } from 'express';
import { Client } from 'ssh2';
import { readFileSync, existsSync } from 'fs';
import db from '../db/sqlite.js';

const router = Router();

const SSH_HOST = process.env.SSH_HOST || '54.199.19.240';
const SSH_USER = process.env.SSH_USER || 'ec2-user';
const SSH_KEY  = process.env.SSH_KEY_PATH || 'D:\\AWS\\beadsops-api_pem.pem';
const REMOTE_DB = process.env.REMOTE_DB_PATH || '/opt/beadsops/data/P01_formualte_schedule.db';
const TEAMS_WEBHOOK = 'https://skylamb.webhook.office.com/webhookb2/2a08d9e8-2969-447a-826b-a6e378cfd967@15d82f97-4f15-4ead-9ab6-18aa0cd45388/IncomingWebhook/be88d82e15b44d75a2cf55a80e52b35b/7731650f-a7d2-4b94-ad86-14e06a65ea2e/V22OCJBKMz6BrY4z6Hg1FTByAD0uXKdoJa8eWMlQSQeq01';

async function sendTeamsAlert(title, items) {
  if (!items.length) return;
  const body = items.map(i => '- ' + i).join('\n');
  const card = {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard', version: '1.4',
        body: [
          { type: 'TextBlock', text: '⚠️ ' + title, weight: 'Bolder', size: 'Medium', color: 'Attention' },
          { type: 'TextBlock', text: body, wrap: true, size: 'Small' },
          { type: 'TextBlock', text: 'to: 呂祐鋓', size: 'Small', isSubtle: true },
        ]
      }
    }]
  };
  try {
    await fetch(TEAMS_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card) });
  } catch (e) { console.error('[teams] send failed:', e.message); }
}

// ── SSH: run remote sqlite3 query, return JSON rows ──────────────────
function queryRemoteDb(sql) {
  return new Promise((resolve, reject) => {
    if (!existsSync(SSH_KEY)) {
      return reject(new Error(`SSH key not found: ${SSH_KEY}`));
    }
    const conn = new Client();
    conn.on('ready', () => {
      const escaped = sql.replace(/"/g, '\\"');
      const cmd = `sqlite3 -json "${REMOTE_DB}" "${escaped}"`;
      conn.exec(cmd, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        let out = '', errOut = '';
        stream.on('data', (d) => { out += d; });
        stream.stderr.on('data', (d) => { errOut += d; });
        stream.on('close', () => {
          conn.end();
          if (errOut && !out) return reject(new Error(errOut.trim()));
          try { resolve(JSON.parse(out || '[]')); }
          catch { resolve([]); }
        });
      });
    });
    conn.on('error', (err) => reject(new Error(`SSH connection failed: ${err.message}`)));
    conn.connect({ host: SSH_HOST, port: 22, username: SSH_USER, privateKey: readFileSync(SSH_KEY) });
  });
}

// ── Local schedule cache ──────────────────────────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS schedule_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prod_date TEXT, marker TEXT, work_order TEXT, lot TEXT,
  synced_at TEXT DEFAULT (datetime('now','localtime'))
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_sched_cache_date ON schedule_cache(prod_date)');

db.exec(`CREATE TABLE IF NOT EXISTS pn_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marker_name TEXT, pn TEXT, name TEXT
)`);

let lastSyncTime = 0;
const SYNC_INTERVAL = 10 * 60 * 1000;

async function syncScheduleCache() {
  try {
    // Sync DropletSchedule
    const rows = await queryRemoteDb(
      'SELECT "Date", Marker, WorkOrder, Lot FROM DropletSchedule WHERE "Date" >= \'2025/01/01\' AND WorkOrder IS NOT NULL AND Lot IS NOT NULL'
    );
    // Sync Liquid form QC (PN data)
    let pnRows = [];
    try {
      pnRows = await queryRemoteDb(
        'SELECT "Marker name", PN, Name FROM "Liquid form QC" WHERE PN IS NOT NULL AND PN != \'\''
      );
    } catch (e) { console.error('[schedule] pn sync failed:', e.message); }

    db.transaction(() => {
      if (rows.length) {
        db.exec('DELETE FROM schedule_cache');
        const ins = db.prepare('INSERT INTO schedule_cache (prod_date, marker, work_order, lot) VALUES (?,?,?,?)');
        for (const r of rows) ins.run(r.Date, r.Marker, r.WorkOrder, r.Lot);
      }
      if (pnRows.length) {
        db.exec('DELETE FROM pn_cache');
        const ins2 = db.prepare('INSERT INTO pn_cache (marker_name, pn, name) VALUES (?,?,?)');
        for (const r of pnRows) ins2.run(r['Marker name'], r.PN, r.Name);
      }
    })();
    lastSyncTime = Date.now();
    console.log('[schedule] synced ' + rows.length + ' schedule + ' + pnRows.length + ' PN rows from EC2');
  } catch (err) {
    console.error('[schedule] sync failed:', err.message);
  }
}

syncScheduleCache();
setInterval(syncScheduleCache, SYNC_INTERVAL);

// ── Marker → { beadName (QC DB name), reagent: 'd'|'bigD'|'u' } ──────
//
// Rule: take the last '-' segment, its LAST character = reagent type:
//   'D' → bigD,  'U' → u,  'd' → d
//   The marker name = part before the last '-'
//   The version letter(s) between '-' and the reagent char are ignored
//     (A/B/C = recipe version, not part of bead name)
//
// Examples:
//   GLIPA-AD → marker=GLIPA, version=A, reagent=D → beadName=GLIPA, bigD
//   GLIPA-AU → marker=GLIPA, version=A, reagent=U → beadName=GLIPA, u
//   Na-BD    → marker=Na,    version=B, reagent=D → beadName=Na,    bigD
//   Na-BU    → marker=Na,    version=B, reagent=U → beadName=Na,    u
//   BCl-D    → marker=BCl,   version=,  reagent=D → beadName=BCl,   bigD
//   tCre-d   → marker=tCre,  version=,  reagent=d → beadName=tCREA, d
//   tCREA-D  → marker=tCREA, version=,  reagent=D → beadName=tCREA, bigD
//   Ca-B     → marker=Ca,    no D/U at end → single-reagent → beadName=Ca, bigD
//   ALB      → no dash → single-reagent → beadName=ALB, bigD
//   ALT-A    → suffix="A", no D/U/d at end → single-reagent → beadName=ALT-A, bigD
//
// Q* = Tutti 放量測試 (保留，bead_name 帶 Q prefix)
// Skip: c*/f* (免疫), Qc*/Qf*, *HAMA, *R1~R4, *PS, *Diluent, PHBR, VI*

// Name mapping: schedule marker name → QC bead_name
const NAME_MAP = {
  'tCre':  'tCREA',
  'tAsti': 'tASTi',
  'CK':    'CPK',
  'GLU':   'tGlu',
  'ClH':   'Cl',
};

// Markers where the full string (with dash+suffix) IS the bead name
// i.e. the suffix is NOT a version letter but part of the name
const FULL_NAME_MARKERS = new Set([
  'ALT-A', 'AMY-A', 'GLIPA-A', 'QALT-A',
]);

// Patterns to skip (免疫 & non-IPQC)
const SKIP_PATTERNS = [
  /^Qc/,             // Qc* = 免疫放量測試
  /^Qf/,             // Qf* = 免疫放量測試
  /^c[A-Z]/,         // cCOR, cCRP, cPL, cPROG, cTSH (免疫)
  /^f[A-Z]/,         // fPL (免疫)
  /HAMA/i,
  /R1[~-]/,          // R1~R4, R1-A
  /\bPS\b/,
  /Diluent/i,
  /^PHBR$/,
  /^VI /i,
  /^Vi-/i,
  /^GGT/,
];

function parseMarker(raw) {
  if (!raw) return null;
  const s = raw.trim();

  // Skip non-IPQC markers
  if (SKIP_PATTERNS.some(p => p.test(s))) return null;

  // Find last '-'
  const dashIdx = s.lastIndexOf('-');

  // No dash → single-reagent, bigD
  if (dashIdx < 0) {
    return { beadName: NAME_MAP[s] || s, reagent: 'bigD' };
  }

  const before = s.slice(0, dashIdx);          // marker name
  const suffix = s.slice(dashIdx + 1);         // e.g. "AD", "BU", "D", "U", "d", "A", "B"
  const lastChar = suffix.slice(-1);           // reagent indicator

  // Last char is D/U/d → has reagent
  if (lastChar === 'D' || lastChar === 'U' || lastChar === 'd') {
    const reagent = lastChar === 'd' ? 'd' : lastChar === 'D' ? 'bigD' : 'u';
    const beadName = NAME_MAP[before] || before;
    return { beadName, reagent };
  }

  // Last char is NOT D/U/d → suffix is version only (e.g. Ca-B, PHOS-B, GLU-B)
  // BUT some markers have dash+letter as part of their name (ALT-A, AMY-A)
  if (FULL_NAME_MARKERS.has(s)) {
    return { beadName: s, reagent: 'bigD' };
  }
  // Otherwise strip version suffix, use part before dash as bead name
  const beadName = NAME_MAP[before] || before;
  return { beadName, reagent: 'bigD' };
}

// ── Build existing work orders from local DB ──────────────────────────
// 只要工單號已存在就不需匯入（不管 lot）
function getExistingWorkOrders() {
  const wos = new Set();

  const drRows = db.prepare(`
    SELECT d_work_order, bigD_work_order, u_work_order
    FROM drbeadinspection
  `).all();
  for (const r of drRows) {
    if (r.d_work_order) r.d_work_order.split(/[,\n]/).forEach(w => wos.add(w.trim()));
    if (r.bigD_work_order) r.bigD_work_order.split(/[,\n]/).forEach(w => wos.add(w.trim()));
    if (r.u_work_order) r.u_work_order.split(/[,\n]/).forEach(w => wos.add(w.trim()));
  }

  const postRows = db.prepare(`
    SELECT work_order_d, work_order_bigD, work_order_u
    FROM posts
  `).all();
  for (const r of postRows) {
    if (r.work_order_d) r.work_order_d.split(/[,\n]/).forEach(w => wos.add(w.trim()));
    if (r.work_order_bigD) r.work_order_bigD.split(/[,\n]/).forEach(w => wos.add(w.trim()));
    if (r.work_order_u) r.work_order_u.split(/[,\n]/).forEach(w => wos.add(w.trim()));
  }

  return wos;
}

// ── GET /api/schedule/pending ─────────────────────────────────────────
router.get('/pending', (_req, res) => {
  try {
    // "Date" is a reserved word → must be quoted
    const schedRows = db.prepare(`
      SELECT prod_date AS "Date", marker AS Marker, work_order AS WorkOrder, lot AS Lot
      FROM schedule_cache
      WHERE prod_date >= '2025/01/01'
      ORDER BY prod_date DESC
    `).all();

    const existingWOs = getExistingWorkOrders();

    // Group by beadName + nearby date (±1 day) → merge d/D/U lots
    // D and U are different work orders but should be one group.
    // Na: D and U are produced on consecutive days.
    // tCREA: U day1, D+d day2.
    //
    // Algorithm: per beadName, sort by date, merge into a group if
    // the new row's date is within 1 day of the group's earliest date.

    // Step 1: parse all rows, skip R&D lots and empty lots
    //          Collect anomalies for Teams notification
    const parsed = [];
    const anomalies = [];
    for (const row of schedRows) {
      const p = parseMarker(row.Marker);
      if (!p) continue;
      const lot = (row.Lot || '').trim();
      if (lot.endsWith('-RD')) continue;
      if (!lot) {
        anomalies.push({ type: 'empty_lot', marker: row.Marker, wo: row.WorkOrder, date: row.Date });
        continue;
      }
      const prodDate = (row.Date || '').replace(/\//g, '-');
      const woExists = existingWOs.has(row.WorkOrder);
      parsed.push({ ...p, prodDate, wo: row.WorkOrder, lot, woExists });
    }

    // PN mismatch check: lot prefix (first 3 chars) must match bead PN suffix (last 3 chars)
    const pnRows = db.prepare('SELECT marker_name, pn FROM pn_cache').all();
    const pnMap = new Map();
    for (const r of pnRows) {
      const m = (r.marker_name || '').trim();
      const pn = (r.pn || '').trim();
      if (m && pn) { if (!pnMap.has(m)) pnMap.set(m, []); pnMap.get(m).push(pn.slice(-3)); }
    }
    for (const r of parsed) {
      if (!r.lot || r.lot.length < 3) continue;
      // Find PN suffixes for this marker's original schedule name
      // parsed has beadName (QC name), need to check against schedule marker names
      const lotPrefix = r.lot.slice(0, 3);
      // Try beadName and common variants
      let suffixes = null;
      for (const [mk, suf] of pnMap) {
        if (r.beadName === mk || r.beadName === mk.replace(/-[A-Z]$/, '')) { suffixes = suf; break; }
      }
      if (suffixes && !suffixes.includes(lotPrefix)) {
        anomalies.push({ type: 'pn_mismatch', marker: r.beadName, lot: r.lot, wo: r.wo, date: r.prodDate, expected: suffixes.join('/') });
      }
    }

    // Send Teams alert if anomalies found
    if (anomalies.length > 0) {
      const msgs = anomalies.map(a => {
        if (a.type === 'empty_lot') return `空批號: ${a.marker} 工單=${a.wo} 日期=${a.date}`;
        if (a.type === 'pn_mismatch') return `批號異常: ${a.marker} lot=${a.lot} 前三碼應為${a.expected} 工單=${a.wo}`;
        return JSON.stringify(a);
      });
      sendTeamsAlert('排產匯入異常', msgs);
    }

    // Step 2: group by beadName
    const byBead = new Map();
    for (const r of parsed) {
      if (!byBead.has(r.beadName)) byBead.set(r.beadName, []);
      byBead.get(r.beadName).push(r);
    }

    // Step 3: within each bead, sort by date asc, merge into groups
    // Na and tCREA: D/U produced on consecutive days → ±1 day grouping
    // All others: D/U same day → exact date grouping
    const grouped = new Map();
    const dayMs = 86400000;
    const LOOSE_GROUP_BEADS = new Set(['Na', 'tCREA', 'QNa']);

    for (const [beadName, rows] of byBead) {
      rows.sort((a, b) => a.prodDate.localeCompare(b.prodDate));
      const loose = LOOSE_GROUP_BEADS.has(beadName);

      for (const r of rows) {
        const rTime = new Date(r.prodDate).getTime();
        let matched = null;
        for (const [gKey, g] of grouped) {
          if (!gKey.startsWith(beadName + '|')) continue;
          const gTime = new Date(g.prod_date).getTime();
          const diff = Math.abs(rTime - gTime);
          if (loose ? diff <= dayMs : diff === 0) { matched = g; break; }
        }

        if (!matched) {
          // New group — use earliest date as prod_date
          const gKey = `${beadName}|${r.prodDate}|${r.wo}`;
          matched = {
            bead_name: beadName,
            work_order: r.wo,
            prod_date: r.prodDate,
            d_lot: null, d_wo: null, d_prod_date: null,
            bigD_lot: null, bigD_wo: null, bigD_prod_date: null,
            u_lot: null, u_wo: null, u_prod_date: null,
          };
          grouped.set(gKey, matched);
        }

        // Keep earliest date as the group prod_date
        if (r.prodDate < matched.prod_date) matched.prod_date = r.prodDate;

        // Append work_order (show all WOs)
        if (!matched.work_order.includes(r.wo)) {
          matched.work_order += ', ' + r.wo;
        }

        // Merge reagent lots (comma-join if multiple lots for same reagent)
        // Include all lots for display (even from existing WOs) so the full d/D/U combo is visible
        if (r.reagent === 'd') {
          if (!r.woExists) matched.d_wo = r.wo;
          matched.d_prod_date = r.prodDate;
          matched.d_lot = matched.d_lot ? matched.d_lot + ', ' + r.lot : r.lot;
        }
        if (r.reagent === 'bigD') {
          if (!r.woExists) matched.bigD_wo = r.wo;
          matched.bigD_prod_date = r.prodDate;
          matched.bigD_lot = matched.bigD_lot ? matched.bigD_lot + ', ' + r.lot : r.lot;
        }
        if (r.reagent === 'u') {
          if (!r.woExists) matched.u_wo = r.wo;
          matched.u_prod_date = r.prodDate;
          matched.u_lot = matched.u_lot ? matched.u_lot + ', ' + r.lot : r.lot;
        }
      }
    }

    // Filter: today must be > latest_prod_date + 1 (all reagents produced); skip existing
    const today = new Date().toISOString().slice(0, 10);
    const pending = [];
    for (const g of grouped.values()) {
      // Use the latest prod_date among d/D/U to ensure all reagents are ready
      const dates = [g.d_prod_date, g.bigD_prod_date, g.u_prod_date].filter(Boolean);
      const latestProd = dates.length ? dates.sort().pop() : g.prod_date;
      try {
        const d = new Date(latestProd);
        d.setDate(d.getDate() + 1);
        if (today < d.toISOString().slice(0, 10)) continue;
      } catch { continue; }

      // Skip groups with no lots at all
      if (!g.d_lot && !g.bigD_lot && !g.u_lot) continue;

      // Skip if ALL reagent work_orders in this group already exist in IPQC DB
      // (only skip if there's truly nothing new to import)
      const newWOs = [g.d_wo, g.bigD_wo, g.u_wo].filter(Boolean);
      if (newWOs.length === 0) continue;

      pending.push(g);
    }

    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/schedule/import ─────────────────────────────────────────
// insp_date = server today (使用者匯入當天)
router.post('/import', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array required' });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Batch-combo columns matching drbeadinspection_import.py (Q=17,R=18,S=19,T=20)
  const BATCH_COLS = [17, 18, 19, 20];

  /** Compress lots within one reagent group for sheet_name */
  function compressLots(lots, stripPrefix) {
    lots = lots.filter(l => l && l.trim());
    if (!lots.length) return '';
    if (lots.length === 1) return stripPrefix ? lots[0].slice(3) : lots[0];
    let prefix = lots[0];
    for (let i = 1; i < lots.length; i++) {
      while (!lots[i].startsWith(prefix)) prefix = prefix.slice(0, -1);
    }
    const tails = lots.map(l => l.slice(prefix.length)).join('');
    return (stripPrefix ? prefix.slice(3) : prefix) + tails;
  }

  const insertDr = db.prepare(`
    INSERT INTO drbeadinspection (
      bead_name, sheet_name, batch_col, batch_combo, insp_date,
      d_work_order, d_lot, d_prod_date,
      bigD_work_order, bigD_lot, bigD_prod_date,
      u_work_order, u_lot, u_prod_date
    ) VALUES (
      @bead_name, @sheet_name, @batch_col, @batch_combo, @insp_date,
      @d_wo, @d_lot, @d_prod_date,
      @bigD_wo, @bigD_lot, @bigD_prod_date,
      @u_wo, @u_lot, @u_prod_date
    )
  `);

  const insertPost = db.prepare(`
    INSERT INTO posts (
      bead_name, sheet_name, combo_idx, marker, insp_date,
      work_order_d, lot_d, prod_date_d,
      work_order_bigD, lot_bigD, prod_date_bigD,
      work_order_u, lot_u, prod_date_u
    ) VALUES (
      @bead_name, @sheet_name, @combo_idx, @bead_name, @insp_date,
      @d_wo, @d_lot, @d_prod_date,
      @bigD_wo, @bigD_lot, @bigD_prod_date,
      @u_wo, @u_lot, @u_prod_date
    )
  `);

  const txn = db.transaction((rows) => {
    const results = [];
    for (const item of rows) {
      // Validate: today must be > latest prod_date + 1
      const dates = [item.d_prod_date, item.bigD_prod_date, item.u_prod_date, item.prod_date].filter(Boolean);
      const latestProd = dates.sort().pop();
      try {
        const d = new Date(latestProd);
        d.setDate(d.getDate() + 1);
        if (today < d.toISOString().slice(0, 10)) {
          results.push({ bead_name: item.bead_name, work_order: item.work_order, status: 'skipped', reason: '尚未到可檢驗日' });
          continue;
        }
      } catch { /* proceed */ }

      const params = {
        bead_name: item.bead_name,
        insp_date: today,
        d_wo: item.d_wo || null,
        d_lot: item.d_lot || null,
        d_prod_date: item.d_prod_date || item.prod_date || null,
        bigD_wo: item.bigD_wo || null,
        bigD_lot: item.bigD_lot || null,
        bigD_prod_date: item.bigD_prod_date || item.prod_date || null,
        u_wo: item.u_wo || null,
        u_lot: item.u_lot || null,
        u_prod_date: item.u_prod_date || item.prod_date || null,
      };

      // ── Build sheet_name ──
      // d/D lots 去掉前三碼後相同，取第一組 compress
      // 若 U lots 數量不同於 d/D，額外加 "U" + compress U lots
      const dDLot = params.d_lot || params.bigD_lot;
      const dDPart = dDLot ? compressLots(dDLot.split(/,\s*/), true) : '';
      const uPart = params.u_lot ? compressLots(params.u_lot.split(/,\s*/), true) : '';
      if (dDPart && uPart) {
        params.sheet_name = dDPart === uPart ? dDPart : dDPart + 'U' + uPart;
      } else {
        params.sheet_name = dDPart || uPart || params.bead_name;
      }

      // ── Split lots into combos (one record per combo) ──
      // 當 U lots > d/D lots 時，d/D lot 重複配多個 U lot
      // e.g. d=2, D=2, U=4 → 4 combos, 每個 d/D lot 配 2 個 U lot
      const dLots    = params.d_lot    ? params.d_lot.split(/,\s*/)    : [];
      const bigDLots = params.bigD_lot ? params.bigD_lot.split(/,\s*/) : [];
      const uLots    = params.u_lot    ? params.u_lot.split(/,\s*/)    : [];
      const comboCount = Math.max(dLots.length, bigDLots.length, uLots.length, 1);
      const dDMax = Math.max(dLots.length, bigDLots.length) || comboCount;

      // Check if any work_order already exists in IPQC DB
      const checkWO = (wo) => {
        if (!wo) return false;
        return db.prepare(`
          SELECT 1 FROM drbeadinspection
          WHERE d_work_order = ? OR bigD_work_order = ? OR u_work_order = ?
          LIMIT 1
        `).get(wo, wo, wo);
      };

      const exists = checkWO(params.d_wo)
                  || checkWO(params.bigD_wo)
                  || checkWO(params.u_wo);

      if (exists) {
        results.push({ bead_name: item.bead_name, work_order: item.work_order, status: 'skipped', reason: '已存在' });
        continue;
      }

      // Check if sheet_name already exists (e.g. from Excel import)
      const sheetExists = db.prepare(
        'SELECT 1 FROM drbeadinspection WHERE bead_name = ? AND sheet_name = ? LIMIT 1'
      ).get(params.bead_name, params.sheet_name);
      if (sheetExists) {
        results.push({ bead_name: item.bead_name, work_order: item.work_order, status: 'skipped', reason: '批次已存在' });
        continue;
      }

      try {
        for (let ci = 0; ci < comboCount; ci++) {
          // d/D index: 重複使用 (e.g. d=2,U=4 → d[0],d[0],d[1],d[1])
          const dDIdx = dDMax > 0 ? Math.floor(ci * dDMax / comboCount) : ci;
          const comboLots = [dLots[dDIdx], bigDLots[dDIdx], uLots[ci]].filter(Boolean);
          const p = {
            ...params,
            batch_col: BATCH_COLS[ci] || (17 + ci),
            combo_idx: ci + 1,
            batch_combo: comboLots.join(' ') || null,
            d_lot: dLots[dDIdx] || null,
            bigD_lot: bigDLots[dDIdx] || null,
            u_lot: uLots[ci] || null,
          };
          insertDr.run(p);
          insertPost.run(p);
        }
        results.push({ bead_name: item.bead_name, work_order: item.work_order, status: 'imported' });
      } catch (err) {
        results.push({ bead_name: item.bead_name, work_order: item.work_order, status: 'error', reason: err.message });
      }
    }
    return results;
  });

  try {
    const results = txn(items);
    const imported = results.filter(r => r.status === 'imported').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    res.json({ imported, skipped, total: items.length, details: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/schedule/pending-inspection ───────────────────────────────
// Items imported from schedule but not yet in rawdata (待檢驗)
// Group by bead_name + sheet_name so multi-lot batches show as one row
router.get('/pending-inspection', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT d.id, d.bead_name, d.sheet_name, d.insp_date, d.batch_combo,
             d.d_lot, d.bigD_lot, d.u_lot,
             d.d_work_order, d.bigD_work_order, d.u_work_order,
             d.d_prod_date, d.bigD_prod_date, d.u_prod_date,
             d.crack, d.dirt, d.color
      FROM drbeadinspection d
      LEFT JOIN rawdata r ON d.bead_name = r.bead_name AND d.sheet_name = r.sheet_name
      WHERE d.file_name IS NULL AND r.id IS NULL
      ORDER BY d.insp_date DESC, d.bead_name, d.batch_col
    `).all();

    // Group by bead_name + sheet_name
    const groups = new Map();
    for (const r of rows) {
      const key = `${r.bead_name}|${r.sheet_name}`;
      if (!groups.has(key)) {
        groups.set(key, {
          id: r.id,
          bead_name: r.bead_name,
          sheet_name: r.sheet_name,
          insp_date: r.insp_date,
          d_work_order: r.d_work_order,
          bigD_work_order: r.bigD_work_order,
          u_work_order: r.u_work_order,
          crack: r.crack, dirt: r.dirt, color: r.color,
          d_lot: null, bigD_lot: null, u_lot: null,
          combos: [],
        });
      }
      const g = groups.get(key);
      g.combos.push(r.batch_combo);
      if (r.d_lot) g.d_lot = g.d_lot ? g.d_lot + ', ' + r.d_lot : r.d_lot;
      if (r.bigD_lot) g.bigD_lot = g.bigD_lot ? g.bigD_lot + ', ' + r.bigD_lot : r.bigD_lot;
      if (r.u_lot) g.u_lot = g.u_lot ? g.u_lot + ', ' + r.u_lot : r.u_lot;
    }

    res.json([...groups.values()]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/schedule/activate ───────────────────────────────────────
// Save visual inspection + create skeleton rawdata rows → appears in 原始數據
// Body: { id, crack, dirt, color, sheet_name? }
router.post('/activate', (req, res) => {
  const { id, crack, dirt, color, sheet_name: newSheetName } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const row = db.prepare('SELECT * FROM drbeadinspection WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const oldSheet = row.sheet_name;
  const finalSheet = (newSheetName && newSheetName.trim()) || oldSheet;

  // Get ALL records for this bead_name + sheet_name (multi-combo)
  const allRecords = db.prepare(
    'SELECT * FROM drbeadinspection WHERE bead_name = ? AND sheet_name = ? AND file_name IS NULL'
  ).all(row.bead_name, oldSheet);

  const txn = db.transaction(() => {
    // 1. Update visual inspection + sheet_name for ALL records
    for (const rec of allRecords) {
      db.prepare(`
        UPDATE drbeadinspection SET crack = ?, dirt = ?, color = ?, sheet_name = ? WHERE id = ?
      `).run(crack || null, dirt || null, color || null, finalSheet, rec.id);
    }

    // 2. Update posts too
    db.prepare(`
      UPDATE posts SET crack = ?, dirt = ?, color = ?, sheet_name = ?
      WHERE bead_name = ? AND sheet_name = ? AND file_name IS NULL
    `).run(crack || null, dirt || null, color || null, finalSheet, row.bead_name, oldSheet);

    // 3. Resolve base marker for meta & levels
    //    Lookup order: exact → strip Q prefix → strip -A/-B suffix → both
    //    e.g. QALT-A → QALT-A, ALT-A, QALT, ALT
    const bn = row.bead_name;
    const candidates = [bn];
    if (bn.startsWith('Q') && bn.length > 1) candidates.push(bn.slice(1));
    const noVer = bn.replace(/-[A-Z]$/, '');
    if (noVer !== bn) candidates.push(noVer);
    if (bn.startsWith('Q') && bn.length > 1) candidates.push(bn.slice(1).replace(/-[A-Z]$/, ''));

    // Find base marker that has rawdata levels
    let tableLevels = [];
    for (const c of candidates) {
      tableLevels = db.prepare(`
        SELECT DISTINCT table_type, level FROM rawdata WHERE bead_name = ?
        ORDER BY table_type, level
      `).all(c);
      if (tableLevels.length > 0) break;
    }

    // Fallback if no base marker found
    if (tableLevels.length === 0) {
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

    // 4. Create skeleton rawdata rows from ALL records' lots
    // 每個 combo record 存個別 d_lot, bigD_lot, u_lot
    const insertRaw = db.prepare(`
      INSERT OR IGNORE INTO rawdata
        (bead_name, sheet_name, table_type, level, combo_idx, lot_id, d_lot, bigD_lot, u_lot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const { table_type, level } of tableLevels) {
      allRecords.forEach((rec, idx) => {
        const lotId = [rec.d_lot, rec.bigD_lot, rec.u_lot].filter(Boolean).join('');
        insertRaw.run(row.bead_name, finalSheet, table_type, level, idx,
          lotId || null, rec.d_lot || null, rec.bigD_lot || null, rec.u_lot || null);
      });
    }

    // 5. Copy rawdata_meta from base marker (per bead_name, no sheet_name)
    let baseMeta = [];
    for (const c of candidates) {
      baseMeta = db.prepare(`
        SELECT DISTINCT table_type, well, row1, row2, row3
        FROM rawdata_meta WHERE bead_name = ?
      `).all(c);
      if (baseMeta.length > 0) break;
    }

    if (baseMeta.length > 0) {
      const insertMeta = db.prepare(`
        INSERT OR IGNORE INTO rawdata_meta
          (bead_name, table_type, well, row1, row2, row3)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const m of baseMeta) {
        insertMeta.run(row.bead_name, m.table_type, m.well, m.row1, m.row2, m.row3);
      }
    }
  });

  try {
    txn();
    res.json({ ok: true, bead_name: row.bead_name, sheet_name: finalSheet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/schedule/sync ── force re-sync from EC2
router.get('/sync', async (_req, res) => {
  await syncScheduleCache();
  const count = db.prepare('SELECT COUNT(*) AS n FROM schedule_cache').get();
  res.json({ synced: count.n, lastSync: new Date(lastSyncTime).toISOString() });
});

export default router;
