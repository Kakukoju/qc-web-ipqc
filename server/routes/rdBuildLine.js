/**
 * RD Build-Line Tasks API
 * 
 * Handles:
 * - RD whitelist verification
 * - Task creation (from PC build-lines "建線送 RD")
 * - Task listing and detail
 * - Direct write and adjusted curve write
 * 
 * All write operations share the same DB write-back logic as PC build-lines:
 * - Writes to tutti_curves (ipqcdrybeads.db)
 * - Updates baseline_equation in RDS (panel_production.assay_process_records)
 * - Records name@date in confirmed_by field
 */
import { Router } from 'express';
import db from '../db/sqlite.js';
import { pool, queryWithRetry } from '../db/pgPool.js';

const router = Router();

// ══════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════

function nowLocal() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(' ', ' ');
}

function formatNameAtDate(name) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `${name}@${dateStr}`;
}

const FIT_DEFAULTS = {
  equation_direction: 'forward_od_to_conc',
  equation_direction_label: 'f(OD)=conc',
  curve_model: 'linear',
  fit_strategy: 'full_range',
  formula_text: 'conc = a * OD + b',
};

function withFitMetadata(fitData) {
  return { ...FIT_DEFAULTS, ...(fitData || {}) };
}

/** Verify emp_no against rd_whitelist. Returns person data or null. */
function verifyRdEmpNo(empNo) {
  if (!empNo || typeof empNo !== 'string') return null;
  const row = db.prepare(
    'SELECT emp_no, department, cost_center, name, english_name FROM rd_whitelist WHERE emp_no = ? AND active = 1'
  ).get(empNo.trim());
  return row || null;
}

/** Ensure rd_build_line_tasks table exists (auto-migration on first use) */
function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rd_build_line_tasks (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      panel_name          TEXT NOT NULL,
      lot_no              TEXT NOT NULL,
      marker              TEXT,
      work_order          TEXT,
      source_fit_id       TEXT,
      status              TEXT NOT NULL DEFAULT 'pending_rd',
      created_by          TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      assigned_rd_emp_no  TEXT,
      assigned_rd_name    TEXT,
      started_at          TEXT,
      completed_at        TEXT,
      action_type         TEXT,
      result_json         TEXT,
      error_message       TEXT,
      fit_data_json       TEXT,
      UNIQUE(panel_name, lot_no, marker, source_fit_id)
    )
  `);
  db.exec(`CREATE TABLE IF NOT EXISTS rd_whitelist (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_no       TEXT NOT NULL UNIQUE,
    department   TEXT NOT NULL,
    cost_center  TEXT NOT NULL,
    name         TEXT NOT NULL,
    english_name TEXT NOT NULL,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT DEFAULT (datetime('now','localtime'))
  )`);
}

// Run on module load
ensureTable();
ensureHistoryTable();

/**
 * Find all 可併 (mergeable) batches in the same IPQC group.
 * Group is identified by bead_name + sheet_name in drbeadinspection.
 * Returns all batch numbers where batch_decision = '可併' AND final_decision = 'Accept'.
 */
function getMergeableBatches(batchNumber, beadName = null) {
  // First find the group (sheet_name) this batch belongs to
  let groupQuery = `
    SELECT DISTINCT bead_name, sheet_name FROM drbeadinspection
    WHERE (d_lot = ? OR bigD_lot = ? OR u_lot = ? OR batch_combo = ?)
  `;
  const params = [batchNumber, batchNumber, batchNumber, batchNumber];
  if (beadName) {
    groupQuery += ` AND bead_name = ?`;
    params.push(beadName);
  }
  groupQuery += ` LIMIT 1`;

  const group = db.prepare(groupQuery).get(...params);
  if (!group) return [];

  // Find all mergeable batches in the same group
  const rows = db.prepare(`
    SELECT DISTINCT d_lot, bigD_lot, u_lot, batch_decision, final_decision, batch_combo
    FROM drbeadinspection
    WHERE bead_name = ? AND sheet_name = ?
      AND batch_decision = '可併'
      AND final_decision = 'Accept'
  `).all(group.bead_name, group.sheet_name);

  // Collect all unique batch numbers from d_lot, bigD_lot, u_lot
  const batchSet = new Set();
  for (const row of rows) {
    if (row.d_lot) batchSet.add(row.d_lot);
    if (row.bigD_lot) batchSet.add(row.bigD_lot);
    if (row.u_lot) batchSet.add(row.u_lot);
  }

  return {
    bead_name: group.bead_name,
    sheet_name: group.sheet_name,
    mergeable_batches: Array.from(batchSet),
  };
}

function ensureHistoryTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS build_line_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      analyze_item    TEXT NOT NULL,
      d_lot           TEXT,
      bigD_lot        TEXT,
      u_lot           TEXT,
      work_order_no   TEXT,
      mfg_lot_no      TEXT,
      lot_code        TEXT,
      panel_name      TEXT,
      analyze_date    TEXT,
      equation        TEXT,
      test_well       TEXT,
      species         TEXT,
      points_json     TEXT,
      completed_by    TEXT,
      completed_at    TEXT,
      task_id         INTEGER,
      build_count     INTEGER DEFAULT 1
    )
  `);
}

// ══════════════════════════════════════════════════════════════════════════
// Shared Build-Line Write Service
// (Same logic as PC build-lines: writes to tutti_curves + RDS)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Write build-line result to tutti_curves and RDS.
 * This is the shared function used by both PC build-lines and RD mobile.
 * 
 * @param {object} params
 * @param {string} params.marker - analyze_item / marker name
 * @param {string} params.panelName - panel name
 * @param {string} params.lotNo - lot number (mfg_lot_no)
 * @param {string} params.analyzeDate - analyze date
 * @param {string} params.species - species
 * @param {string} params.equation - baseline equation string
 * @param {number|null} params.slope
 * @param {number|null} params.intercept
 * @param {number|null} params.r2
 * @param {string} params.confirmedBy - name@date string
 * @param {object|null} params.fitData - raw fit data (points, etc.)
 * @returns {{ ok: boolean, error?: string, rdsUpdated?: number }}
 */
async function writeBuildLineResult(params) {
  const {
    marker, panelName, lotNo, analyzeDate, species,
    equation, slope, intercept, r2,
    confirmedBy, fitData, workOrderNo,
  } = params;

  // 1. Write/update tutti_curves in ipqcdrybeads.db (SQLite)
  try {
    const existing = db.prepare(
      'SELECT id FROM tutti_curves WHERE marker = ? AND work_order = ?'
    ).get(marker, lotNo);

    if (existing) {
      db.prepare(`
        UPDATE tutti_curves
        SET od_slope = ?, od_intercept = ?, od_r2 = ?,
            status = 'confirmed', confirmed_by = ?, confirmed_at = datetime('now','localtime'),
            notes = ?
        WHERE id = ?
      `).run(
        slope, intercept, r2,
        confirmedBy,
        `${panelName} | ${analyzeDate}`,
        existing.id
      );
    } else {
      db.prepare(`
        INSERT INTO tutti_curves (marker, work_order, od_slope, od_intercept, od_r2,
          raw_od_json, status, confirmed_by, confirmed_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, datetime('now','localtime'), ?)
      `).run(
        marker, lotNo, slope, intercept, r2,
        fitData ? JSON.stringify(fitData) : null,
        confirmedBy,
        `${panelName} | ${analyzeDate}`
      );
    }

    // Write to build_line_history
    const fd = fitData ? (typeof fitData === 'string' ? JSON.parse(fitData) : fitData) : {};
    // fitData may be points array — batch info is in the parent fit_data_json (passed via fullFitData)
    const fullFd = params.fullFitData || fd;
    const dLot = fullFd.d_lot || '';
    const bigDLot = fullFd.bigD_lot || '';
    const uLot = fullFd.u_lot || '';
    const testWell = fullFd.test_well || '';
    const lotCode = fullFd.mfg_lot_no || lotNo;
    const buildCount = db.prepare(
      'SELECT COUNT(*) as cnt FROM build_line_history WHERE analyze_item = ? AND mfg_lot_no = ?'
    ).get(marker, lotNo)?.cnt || 0;
    db.prepare(`
      INSERT INTO build_line_history
        (analyze_item, d_lot, bigD_lot, u_lot, work_order_no, mfg_lot_no, lot_code,
         panel_name, analyze_date, equation, test_well, species, points_json,
         completed_by, completed_at, build_count)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'),?)
    `).run(
      marker, dLot, bigDLot, uLot,
      workOrderNo || '', lotNo, lotCode,
      panelName, analyzeDate, equation, testWell, species,
      Array.isArray(fitData) ? JSON.stringify(fitData) : (fitData ? JSON.stringify(fitData) : null),
      confirmedBy, buildCount + 1
    );
  } catch (err) {
    return { ok: false, error: `SQLite write failed: ${err.message}` };
  }

  // 2. Write baseline_equation to RDS (panel_production.assay_process_records)
  let rdsUpdated = 0;
  if (equation) {
    try {
      const speciesClause = species ? "AND COALESCE(species, '') = $6" : "";
      const queryParams = [equation, lotNo, panelName, analyzeDate, marker];
      if (species) queryParams.push(species);

      const result = await queryWithRetry(
        `UPDATE panel_production.assay_process_records
         SET baseline_equation = $1
         WHERE baseline = 'true'
           AND lot_no = $2
           AND panel_name = $3
           AND analyze_date = $4
           AND analyze_item = $5
           ${speciesClause}`,
        queryParams
      );
      rdsUpdated = result.rowCount || 0;
    } catch (err) {
      // RDS write failure is non-fatal but logged
      console.error('[rdBuildLine] RDS write failed:', err.message);
    }
  }

  // 3. Transition batch_build_line_status (non-blocking)
  try {
    await notifyBatchStatusTransition(params);
  } catch (err) {
    console.error('[rdBuildLine] batch status transition error:', err.message);
  }

  return { ok: true, rdsUpdated };
}

// ── Notify beads-project backend to transition batch_build_line_status ────
async function notifyBatchStatusTransition(params) {
  const { marker, lotNo, workOrderNo, confirmedBy, fullFitData } = params;
  const fd = fullFitData || {};
  const dLot = fd.d_lot || '';
  const bigDLot = fd.bigD_lot || '';
  const uLot = fd.u_lot || '';

  // Build batch_keys from the lot info
  const batchKeys = [];
  if (dLot) batchKeys.push({ batch_key: `${dLot}::d_lot`, classification: 'd_lot', batch_number: dLot });
  if (bigDLot) batchKeys.push({ batch_key: `${bigDLot}::bigD_lot`, classification: 'bigD_lot', batch_number: bigDLot });
  if (uLot) batchKeys.push({ batch_key: `${uLot}::u_lot`, classification: 'u_lot', batch_number: uLot });

  if (batchKeys.length === 0) return;

  for (const batch of batchKeys) {
    try {
      // Get actual build count from SQLite build_line_history (source of truth for completed builds)
      const histCount = db.prepare(
        'SELECT COUNT(*) as cnt FROM build_line_history WHERE (d_lot = ? OR bigD_lot = ? OR u_lot = ?)'
      ).get(batch.batch_number, batch.batch_number, batch.batch_number)?.cnt || 0;

      // Determine status based on actual build count
      const modificationCount = Math.max(0, histCount - 1);
      const status = modificationCount === 0 ? '已建線' : `已改線(${modificationCount})`;

      // Get current status for history record
      const currentRow = await queryWithRetry(
        `SELECT status, modification_count FROM panel_production.batch_build_line_status WHERE batch_key = $1`,
        [batch.batch_key]
      );
      const previousStatus = currentRow.rows[0]?.status || '未建線';

      // Upsert status
      await queryWithRetry(
        `INSERT INTO panel_production.batch_build_line_status
           (batch_key, classification, batch_number, status, modification_count, last_transition_at, last_operator, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6, NOW())
         ON CONFLICT (batch_key) DO UPDATE SET
           status = $4,
           modification_count = $5,
           last_transition_at = NOW(),
           last_operator = $6,
           updated_at = NOW()`,
        [batch.batch_key, batch.classification, batch.batch_number, status, modificationCount, confirmedBy || 'RD']
      );

      // Write history record (only if status actually changed)
      if (previousStatus !== status) {
        await queryWithRetry(
          `INSERT INTO panel_production.batch_build_line_history
             (batch_key, previous_status, new_status, modification_count, transitioned_at, operator, work_order_no, lot_no)
           VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7)`,
          [batch.batch_key, previousStatus, status, modificationCount, confirmedBy || 'RD', workOrderNo || '', lotNo || '']
        );
      }

      // ── Sync all mergeable batches (可併) in the same IPQC group ──
      try {
        const mergeableInfo = getMergeableBatches(batch.batch_number);
        if (mergeableInfo && mergeableInfo.mergeable_batches) {
          for (const siblingBatch of mergeableInfo.mergeable_batches) {
            if (siblingBatch === batch.batch_number) continue; // skip self
            const siblingKey = `${siblingBatch}::${batch.classification}`;
            await queryWithRetry(
              `INSERT INTO panel_production.batch_build_line_status
                 (batch_key, classification, batch_number, status, modification_count, last_transition_at, last_operator, updated_at)
               VALUES ($1, $2, $3, $4, $5, NOW(), $6, NOW())
               ON CONFLICT (batch_key) DO UPDATE SET
                 status = $4,
                 modification_count = $5,
                 last_transition_at = NOW(),
                 last_operator = $6,
                 updated_at = NOW()`,
              [siblingKey, batch.classification, siblingBatch, status, modificationCount, confirmedBy || 'RD']
            );
          }
        }
      } catch (mergeErr) {
        console.error(`[rdBuildLine] mergeable sync failed for ${batch.batch_number}:`, mergeErr.message);
      }

    } catch (err) {
      console.error(`[rdBuildLine] batch_build_line_status transition failed for ${batch.batch_key}:`, err.message);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// API Routes
// ══════════════════════════════════════════════════════════════════════════

const rdEventClients = new Set();
const pcCompletionEventClients = new Set();

function sendRdBuildLineEvent(payload) {
  const data = JSON.stringify(payload);
  for (const client of rdEventClients) {
    try {
      client.write(`event: rd-build-line-task\n`);
      client.write(`data: ${data}\n\n`);
    } catch {
      rdEventClients.delete(client);
    }
  }
}

function sendPcBuildLineEvent(eventName, payload) {
  const data = JSON.stringify(payload);
  for (const client of pcCompletionEventClients) {
    try {
      client.write(`event: ${eventName}\n`);
      client.write(`data: ${data}\n\n`);
    } catch {
      pcCompletionEventClients.delete(client);
    }
  }
}

function sendPcBuildLineCompletionEvent(payload) {
  sendPcBuildLineEvent('rd-build-line-completed', payload);
}

/** Notify pre-assignment QC Manager about build-line completion for spec check */
async function notifyQcManagerSpecCheck(task, fitData, confirmedBy) {
  try {
    const body = JSON.stringify({
      marker: task.marker,
      panel_name: task.panel_name,
      lot_no: task.lot_no,
      work_order: task.work_order || "",
      confirmed_by: confirmedBy || "",
      task_id: task.id,
      equation: fitData?.equation || fitData?.baseline_equation || "",
    });
    const res = await fetch("http://127.0.0.1:3000/api/qc-manager/webhook/build-line-completed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    console.log("[RD BuildLine] QC Manager spec check notified:", data.ok, data.specCheck?.passed ? "PASS" : "FAIL");
  } catch (err) {
    console.warn("[RD BuildLine] QC Manager webhook failed (non-blocking):", err.message);
  }
}

function buildCompletionPayload(task, person, actionType, confirmedBy, writeResult) {
  return {
    event: 'completed',
    task_id: task.id,
    status: 'completed',
    action_type: actionType,
    panel_name: task.panel_name,
    lot_no: task.lot_no,
    marker: task.marker || null,
    work_order: task.work_order || null,
    confirmed_by: confirmedBy,
    rd_name: person.english_name,
    rds_updated: writeResult.rdsUpdated || 0,
    completed_at: nowLocal(),
  };
}

// ── GET /rd-build-line-events — Live task notifications for RD mobile ────
router.get('/rd-build-line-events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ ok: true })}\n\n`);
  rdEventClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      clearInterval(heartbeat);
      rdEventClients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    rdEventClients.delete(res);
  });
});

// ── GET /rd-build-line-completion-events — Live completion messages for PC ─
router.get('/rd-build-line-completion-events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ ok: true })}\n\n`);
  pcCompletionEventClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      clearInterval(heartbeat);
      pcCompletionEventClients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    pcCompletionEventClients.delete(res);
  });
});

// ── POST /rd-auth/verify — Verify RD employee number ─────────────────────
router.post('/rd-auth/verify', (req, res) => {
  const { emp_no } = req.body;
  if (!emp_no) {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_EMP_NO', message: '請輸入工號' } });
  }
  const person = verifyRdEmpNo(emp_no);
  if (!person) {
    return res.status(403).json({
      ok: false,
      error: { code: 'RD_EMP_NO_NOT_ALLOWED', message: '工號不存在或無 RD 建線權限' }
    });
  }
  res.json({ ok: true, data: person });
});

// ── POST /rd-build-line-tasks — Create a new RD task ─────────────────────
router.post('/rd-build-line-tasks', (req, res) => {
  const { panel_name, lot_no, marker, work_order, source_fit_id, created_by, fit_data } = req.body;

  if (!panel_name || !lot_no) {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_FIELDS', message: 'panel_name and lot_no are required' } });
  }

  // Check for existing pending/in_progress/pending_qc task
  const existing = db.prepare(`
    SELECT id, status FROM rd_build_line_tasks
    WHERE panel_name = ? AND lot_no = ? AND COALESCE(marker, '') = COALESCE(?, '')
      AND COALESCE(source_fit_id, '') = COALESCE(?, '')
      AND status IN ('pending_rd', 'in_progress', 'pending_qc')
  `).get(panel_name, lot_no, marker || '', source_fit_id || '');

  if (existing) {
    sendRdBuildLineEvent({
      event: 'existing',
      task_id: existing.id,
      status: existing.status,
      panel_name,
      lot_no,
      marker: marker || null,
      work_order: work_order || null,
    });
    return res.json({
      ok: true,
      data: { task_id: existing.id, status: existing.status, existing: true },
      message: '此筆已在 RD 待建線清單中'
    });
  }

  try {
    const result = db.prepare(`
      INSERT INTO rd_build_line_tasks (panel_name, lot_no, marker, work_order, source_fit_id, created_by, fit_data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      panel_name, lot_no, marker || null, work_order || null,
      source_fit_id || null, created_by || null,
      fit_data ? JSON.stringify(fit_data) : null
    );

    res.json({
      ok: true,
      data: { task_id: result.lastInsertRowid, status: 'pending_rd' }
    });
    sendRdBuildLineEvent({
      event: 'created',
      task_id: result.lastInsertRowid,
      status: 'pending_rd',
      panel_name,
      lot_no,
      marker: marker || null,
      work_order: work_order || null,
      created_by: created_by || null,
    });
  } catch (err) {
    // UNIQUE constraint violation — task already exists (possibly completed)
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.message?.includes('UNIQUE constraint')) {
      const existingAny = db.prepare(`
        SELECT id, status FROM rd_build_line_tasks
        WHERE panel_name = ? AND lot_no = ? AND COALESCE(marker, '') = COALESCE(?, '')
          AND COALESCE(source_fit_id, '') = COALESCE(?, '')
      `).get(panel_name, lot_no, marker || '', source_fit_id || '');
      if (existingAny) {
        // If task is completed, failed, on_hold, or rejected, allow re-send as "改線" (re-build)
        if (existingAny.status === 'completed' || existingAny.status === 'failed' || existingAny.status === 'on_hold' || existingAny.status === 'rejected') {
          // Reset the task to pending_rd for re-build (改線)
          db.prepare(`
            UPDATE rd_build_line_tasks
            SET status = 'pending_rd',
                assigned_rd_emp_no = NULL, assigned_rd_name = NULL,
                started_at = NULL, completed_at = NULL,
                action_type = NULL, result_json = NULL, error_message = NULL,
                created_by = ?, created_at = datetime('now','localtime'),
                fit_data_json = ?
            WHERE id = ?
          `).run(
            created_by || null,
            fit_data ? JSON.stringify(fit_data) : existingAny.fit_data_json || null,
            existingAny.id
          );

          res.json({
            ok: true,
            data: { task_id: existingAny.id, status: 'pending_rd', resend: true },
            message: '已重新送出改線任務至 RD 待建線清單'
          });
          sendRdBuildLineEvent({
            event: 'created',
            task_id: existingAny.id,
            status: 'pending_rd',
            panel_name,
            lot_no,
            marker: marker || null,
            work_order: work_order || null,
            created_by: created_by || null,
          });
          return;
        }
        return res.json({
          ok: true,
          data: { task_id: existingAny.id, status: existingAny.status, existing: true },
          message: '此筆已在 RD 待建線清單中'
        });
      }
    }
    res.status(500).json({ ok: false, error: { code: 'CREATE_FAILED', message: err.message } });
  }
});

// ── GET /rd-build-line-tasks — List tasks ────────────────────────────────
router.get('/rd-build-line-tasks', async (req, res) => {
  const status = req.query.status || 'pending_rd,in_progress';
  const statuses = status.split(',').map(s => s.trim());
  const placeholders = statuses.map(() => '?').join(',');

  const rows = db.prepare(`
    SELECT id, panel_name, lot_no, marker, work_order, status,
           created_at, created_by, assigned_rd_name, started_at, completed_at, action_type
    FROM rd_build_line_tasks
    WHERE status IN (${placeholders})
    ORDER BY created_at DESC
  `).all(...statuses);

  // Fix work_order: if work_order equals lot_no (bug), look up real work_order_no from RDS
  for (const row of rows) {
    if (row.work_order && row.lot_no && row.work_order === row.lot_no) {
      try {
        const rdsResult = await queryWithRetry(
          `SELECT work_order_no FROM panel_production.tutti_work_orders
           WHERE lot_no = $1 AND work_order_no IS NOT NULL AND work_order_no != ''
           LIMIT 1`,
          [row.lot_no]
        );
        if (rdsResult.rows.length > 0 && rdsResult.rows[0].work_order_no) {
          row.work_order = rdsResult.rows[0].work_order_no;
          // Also fix in SQLite for future queries
          db.prepare('UPDATE rd_build_line_tasks SET work_order = ? WHERE id = ?')
            .run(rdsResult.rows[0].work_order_no, row.id);
        }
      } catch { /* non-blocking */ }
    }
  }

  res.json({ ok: true, data: rows });
});

// ── GET /rd-build-line-tasks/:id — Get task detail ───────────────────────
router.get('/rd-build-line-tasks/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: { code: 'INVALID_ID', message: 'Invalid task ID' } });

  const task = db.prepare('SELECT * FROM rd_build_line_tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } });

  // Fix work_order: if work_order equals lot_no (bug), look up real work_order_no from RDS
  if (task.work_order && task.lot_no && task.work_order === task.lot_no) {
    try {
      const rdsResult = await queryWithRetry(
        `SELECT work_order_no FROM panel_production.tutti_work_orders
         WHERE lot_no = $1 AND work_order_no IS NOT NULL AND work_order_no != ''
         LIMIT 1`,
        [task.lot_no]
      );
      if (rdsResult.rows.length > 0 && rdsResult.rows[0].work_order_no) {
        task.work_order = rdsResult.rows[0].work_order_no;
        // Also fix in SQLite for future queries
        db.prepare('UPDATE rd_build_line_tasks SET work_order = ? WHERE id = ?')
          .run(rdsResult.rows[0].work_order_no, id);
      }
    } catch { /* non-blocking */ }
  }

  // Parse fit_data_json
  let fitData = null;
  if (task.fit_data_json) {
    try { fitData = JSON.parse(task.fit_data_json); } catch { /* ignore */ }
  }

  // Also fetch related tutti_curves record if exists
  let curveRecord = null;
  if (task.marker && task.lot_no) {
    curveRecord = db.prepare(
      'SELECT * FROM tutti_curves WHERE marker = ? AND work_order = ? ORDER BY id DESC LIMIT 1'
    ).get(task.marker, task.lot_no);
    if (curveRecord?.raw_od_json) {
      try { curveRecord.raw_od = JSON.parse(curveRecord.raw_od_json); } catch { curveRecord.raw_od = {}; }
    }
  }

  res.json({
    ok: true,
    data: {
      ...task,
      fit_data: fitData,
      curve_record: curveRecord,
    }
  });
});

// ── POST /rd-build-line-tasks/:id/start-adjust — Start curve adjustment ──
router.post('/rd-build-line-tasks/:id/start-adjust', (req, res) => {
  const id = Number(req.params.id);
  const { emp_no } = req.body;

  if (!emp_no) {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_EMP_NO', message: '請輸入工號' } });
  }

  // Verify RD emp_no
  const person = verifyRdEmpNo(emp_no);
  if (!person) {
    return res.status(403).json({
      ok: false,
      error: { code: 'RD_EMP_NO_NOT_ALLOWED', message: '工號不存在或無 RD 建線權限' }
    });
  }

  const task = db.prepare('SELECT * FROM rd_build_line_tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } });

  if (task.status === 'completed') {
    return res.status(400).json({ ok: false, error: { code: 'ALREADY_COMPLETED', message: '此任務已完成' } });
  }

  // Update task status
  db.prepare(`
    UPDATE rd_build_line_tasks
    SET status = 'in_progress', assigned_rd_emp_no = ?, assigned_rd_name = ?, started_at = datetime('now','localtime')
    WHERE id = ?
  `).run(person.emp_no, person.english_name, id);

  // Return fit data for curve adjustment
  let fitData = null;
  if (task.fit_data_json) {
    try { fitData = JSON.parse(task.fit_data_json); } catch { /* ignore */ }
  }

  res.json({
    ok: true,
    data: {
      task_id: id,
      status: 'in_progress',
      rd_person: person,
      fit_data: fitData,
    }
  });
});

// ── POST /rd-build-line-tasks/:id/direct-write — Direct write to DB ──────
router.post('/rd-build-line-tasks/:id/direct-write', async (req, res) => {
  const id = Number(req.params.id);
  const { emp_no, confirmed } = req.body;

  if (!emp_no) {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_EMP_NO', message: '請輸入工號' } });
  }

  // Verify RD emp_no
  const person = verifyRdEmpNo(emp_no);
  if (!person) {
    return res.status(403).json({
      ok: false,
      error: { code: 'RD_EMP_NO_NOT_ALLOWED', message: '工號不存在或無 RD 建線權限' }
    });
  }

  const task = db.prepare('SELECT * FROM rd_build_line_tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } });

  if (task.status === 'completed') {
    return res.status(400).json({ ok: false, error: { code: 'ALREADY_COMPLETED', message: '此任務已完成' } });
  }

  // Parse fit data
  let fitData = null;
  if (task.fit_data_json) {
    try { fitData = JSON.parse(task.fit_data_json); } catch { /* ignore */ }
  }

  // Build name@date
  const confirmedBy = formatNameAtDate(person.english_name);

  // Extract equation/slope/intercept/r2 from fit_data
  fitData = withFitMetadata(fitData);
  const equation = fitData.equation || fitData.baseline_equation || '';
  const slope = fitData.fit?.slope ?? fitData.slope ?? null;
  const intercept = fitData.fit?.intercept ?? fitData.intercept ?? null;
  const r2 = fitData.fit?.r2 ?? fitData.r2 ?? null;

  try {
    const writeResult = await writeBuildLineResult({
      marker: task.marker,
      panelName: task.panel_name,
      lotNo: task.lot_no,
      analyzeDate: fitData?.analyze_date || '',
      species: fitData?.Species || '',
      equation,
      slope,
      intercept,
      r2,
      confirmedBy,
      fitData: fitData.points || null,
      workOrderNo: task.work_order || '',
      fullFitData: fitData,
    });

    if (!writeResult.ok) {
      // Rollback: mark task as failed
      db.prepare(`
        UPDATE rd_build_line_tasks
        SET status = 'failed', error_message = ?, completed_at = datetime('now','localtime')
        WHERE id = ?
      `).run(writeResult.error, id);

      return res.status(500).json({
        ok: false,
        error: { code: 'WRITE_FAILED', message: writeResult.error }
      });
    }

    // Mark task as pending_qc (awaiting QC Manager spec check approval)
    db.prepare(`
      UPDATE rd_build_line_tasks
      SET status = 'pending_qc', action_type = 'direct_write',
          assigned_rd_emp_no = ?, assigned_rd_name = ?,
          completed_at = datetime('now','localtime'),
          result_json = ?, fit_data_json = ?
      WHERE id = ?
    `).run(
      person.emp_no, person.english_name,
      JSON.stringify({ confirmedBy, fit_metadata: FIT_DEFAULTS, rdsUpdated: writeResult.rdsUpdated }),
      JSON.stringify(fitData),
      id
    );

    const payload = buildCompletionPayload(task, person, 'direct_write', confirmedBy, writeResult);
    res.json({
      ok: true,
      data: {
        task_id: id,
        status: 'pending_qc',
        action_type: 'direct_write',
        confirmed_by: confirmedBy,
        rd_person: person,
        rds_updated: writeResult.rdsUpdated,
      }
    });
    sendPcBuildLineCompletionEvent(payload);
    notifyQcManagerSpecCheck(task, fitData, confirmedBy);
  } catch (err) {
    // Mark task as failed
    db.prepare(`
      UPDATE rd_build_line_tasks
      SET status = 'failed', error_message = ?, completed_at = datetime('now','localtime')
      WHERE id = ?
    `).run(err.message, id);

    res.status(500).json({
      ok: false,
      error: { code: 'WRITE_FAILED', message: `建線寫入失敗: ${err.message}` }
    });
  }
});

// ── POST /rd-build-line-tasks/:id/save-adjusted-fit — Save adjusted curve ─
router.post('/rd-build-line-tasks/:id/save-adjusted-fit', async (req, res) => {
  const id = Number(req.params.id);
  const { emp_no, fit_params, result: fitResult } = req.body;

  if (!emp_no) {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_EMP_NO', message: '請輸入工號' } });
  }

  // Verify RD emp_no
  const person = verifyRdEmpNo(emp_no);
  if (!person) {
    return res.status(403).json({
      ok: false,
      error: { code: 'RD_EMP_NO_NOT_ALLOWED', message: '工號不存在或無 RD 建線權限' }
    });
  }

  const task = db.prepare('SELECT * FROM rd_build_line_tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } });

  if (task.status === 'completed') {
    return res.status(400).json({ ok: false, error: { code: 'ALREADY_COMPLETED', message: '此任務已完成' } });
  }

  // Parse original fit data for context
  let originalFitData = null;
  if (task.fit_data_json) {
    try { originalFitData = JSON.parse(task.fit_data_json); } catch { /* ignore */ }
  }

  // Build name@date
  const confirmedBy = formatNameAtDate(person.english_name);

  // Use adjusted params
  const adjustedFitData = withFitMetadata({
    ...originalFitData,
    ...fit_params,
    points: fit_params?.points || originalFitData?.points || [],
    fit: {
      ...(originalFitData?.fit || {}),
      slope: fit_params?.slope ?? null,
      intercept: fit_params?.intercept ?? null,
      r2: fit_params?.r2 ?? null,
      equation: fit_params?.equation || '',
      coefficients: fit_params?.coefficients || [],
    },
  });
  const slope = adjustedFitData.slope ?? null;
  const intercept = adjustedFitData.intercept ?? null;
  const r2 = adjustedFitData.r2 ?? null;
  const equation = adjustedFitData.equation ||
    (slope != null && intercept != null ? `y = ${slope}x + ${intercept}; R2 = ${r2 || 'N/A'}` : '');

  try {
    const writeResult = await writeBuildLineResult({
      marker: task.marker,
      panelName: task.panel_name,
      lotNo: task.lot_no,
      analyzeDate: originalFitData?.analyze_date || '',
      species: originalFitData?.Species || '',
      equation,
      slope,
      intercept,
      r2,
      confirmedBy,
      fitData: adjustedFitData.points || null,
      workOrderNo: task.work_order || '',
      fullFitData: adjustedFitData,
    });

    if (!writeResult.ok) {
      db.prepare(`
        UPDATE rd_build_line_tasks
        SET status = 'failed', error_message = ?, completed_at = datetime('now','localtime')
        WHERE id = ?
      `).run(writeResult.error, id);

      return res.status(500).json({
        ok: false,
        error: { code: 'WRITE_FAILED', message: writeResult.error }
      });
    }

    // Mark task as pending_qc (awaiting QC Manager spec check approval)
    db.prepare(`
      UPDATE rd_build_line_tasks
      SET status = 'pending_qc', action_type = 'adjust_curve',
          assigned_rd_emp_no = ?, assigned_rd_name = ?,
          completed_at = datetime('now','localtime'),
          result_json = ?, fit_data_json = ?
      WHERE id = ?
    `).run(
      person.emp_no, person.english_name,
      JSON.stringify({ confirmedBy, fit_params, rdsUpdated: writeResult.rdsUpdated }),
      JSON.stringify(adjustedFitData),
      id
    );

    const payload = buildCompletionPayload(task, person, 'adjust_curve', confirmedBy, writeResult);
    res.json({
      ok: true,
      data: {
        task_id: id,
        status: 'pending_qc',
        action_type: 'adjust_curve',
        confirmed_by: confirmedBy,
        rd_person: person,
        rds_updated: writeResult.rdsUpdated,
      }
    });
    sendPcBuildLineCompletionEvent(payload);
    notifyQcManagerSpecCheck(task, adjustedFitData, confirmedBy);
  } catch (err) {
    db.prepare(`
      UPDATE rd_build_line_tasks
      SET status = 'failed', error_message = ?, completed_at = datetime('now','localtime')
      WHERE id = ?
    `).run(err.message, id);

    res.status(500).json({
      ok: false,
      error: { code: 'WRITE_FAILED', message: `曲線調整寫入失敗: ${err.message}` }
    });
  }
});

// ── GET /rd-build-line-tasks/status-counts — Get counts by status ────────
router.get('/rd-build-line-tasks-counts', (_req, res) => {
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count FROM rd_build_line_tasks GROUP BY status
  `).all();
  const counts = {};
  for (const r of rows) counts[r.status] = r.count;
  res.json({ ok: true, data: counts });
});

// ── DELETE /rd-build-line-tasks/:id — Delete a task ──────────────────────
router.delete('/rd-build-line-tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: { code: 'INVALID_ID', message: 'Invalid task ID' } });

  const task = db.prepare(`
    SELECT id, status, panel_name, lot_no, marker, work_order
    FROM rd_build_line_tasks
    WHERE id = ?
  `).get(id);
  if (!task) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } });

  db.prepare('DELETE FROM rd_build_line_tasks WHERE id = ?').run(id);
  res.json({ ok: true, data: { id, deleted: true } });
  sendPcBuildLineEvent('rd-build-line-task-deleted', {
    event: 'deleted',
    task_id: task.id,
    status: task.status,
    panel_name: task.panel_name,
    lot_no: task.lot_no,
    marker: task.marker || null,
    work_order: task.work_order || null,
    deleted_at: nowLocal(),
  });
});

// ── GET /build-line-history — Query build line history ──────────────────
router.get('/build-line-history', (req, res) => {
  const { work_order_no, mfg_lot_no, lot_code, panel_name, batch, analyze_item } = req.query;
  const conditions = [];
  const params = [];

  if (work_order_no) { conditions.push('work_order_no LIKE ?'); params.push(`%${work_order_no}%`); }
  if (mfg_lot_no)    { conditions.push('mfg_lot_no LIKE ?');    params.push(`%${mfg_lot_no}%`); }
  if (lot_code)      { conditions.push('lot_code LIKE ?');       params.push(`%${lot_code}%`); }
  if (panel_name)    { conditions.push('panel_name LIKE ?');     params.push(`%${panel_name}%`); }
  if (batch)         { conditions.push('(d_lot LIKE ? OR bigD_lot LIKE ? OR u_lot LIKE ?)'); params.push(`%${batch}%`, `%${batch}%`, `%${batch}%`); }
  if (analyze_item)  { conditions.push('analyze_item = ?');      params.push(analyze_item); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT id, analyze_item, d_lot, bigD_lot, u_lot,
           work_order_no, mfg_lot_no, lot_code, panel_name, analyze_date,
           equation, test_well, species, points_json,
           completed_by, completed_at, build_count
    FROM build_line_history
    ${where}
    ORDER BY completed_at DESC
    LIMIT 500
  `).all(...params);

  // Parse points_json for each row
  const data = rows.map(r => {
    let points = [];
    try { points = r.points_json ? JSON.parse(r.points_json) : []; } catch { /* ignore */ }
    return { ...r, points };
  });

  res.json({ ok: true, data, total: data.length });
});

// ── GET /mergeable-batches — Find all 可併 batches in same IPQC group ────
router.get('/mergeable-batches', (req, res) => {
  const { batch_number, bead_name } = req.query;
  if (!batch_number) {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_PARAMS', message: 'batch_number is required' } });
  }

  try {
    const batches = getMergeableBatches(batch_number, bead_name || null);
    res.json({ ok: true, data: batches });
  } catch (err) {
    res.status(500).json({ ok: false, error: { code: 'QUERY_FAILED', message: err.message } });
  }
});

export default router;
