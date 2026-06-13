import { Router } from 'express';
import db from '../db/sqlite.js';
import { authenticateReviewUser, provisionReviewUser, REVIEW_ROLES } from '../services/reviewAuth.js';
import { checkBaselineBias } from '../services/baselineBiasCheck.js';
import { disablePushSubscription, getVapidPublicKey, savePushSubscription, sendPushToRole, sendPushToUser } from '../services/pushService.js';

const router = Router();
const clients = new Set();

db.exec(`
  CREATE TABLE IF NOT EXISTS review_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, panel_name TEXT NOT NULL, lot_no TEXT NOT NULL,
    mfg_lot_no TEXT, work_order_no TEXT, build_line_result_id TEXT, reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending_rd', rd_user_id TEXT, rd_result_json TEXT,
    auto_check_result_json TEXT, exception_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_review_tasks_status ON review_tasks(status);
  CREATE TABLE IF NOT EXISTS approval_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, action TEXT NOT NULL,
    actor_user_id TEXT, actor_role TEXT, detail_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

function parse(value) { try { return value ? JSON.parse(value) : null; } catch { return null; } }
function task(id) { return db.prepare('SELECT * FROM review_tasks WHERE id=?').get(id); }
function output(row, withLogs = false) {
  const value = { ...row, rd_result: parse(row.rd_result_json), auto_check_result: parse(row.auto_check_result_json) };
  delete value.rd_result_json; delete value.auto_check_result_json;
  if (withLogs) value.logs = db.prepare('SELECT * FROM approval_logs WHERE task_id=? ORDER BY id').all(row.id);
  return value;
}
function audit(id, action, actor, role, detail = {}) {
  db.prepare('INSERT INTO approval_logs(task_id,action,actor_user_id,actor_role,detail_json) VALUES(?,?,?,?,?)')
    .run(id, action, actor || null, role || null, JSON.stringify(detail));
}
function emit(type, row) {
  const data = JSON.stringify({ type, task: output(row) });
  for (const client of clients) {
    try { client.write(`event: review-task\ndata: ${data}\n\n`); } catch { clients.delete(client); }
  }
}
function curveInput(row) {
  const build = row.build_line_result_id
    ? db.prepare('SELECT marker,fit_data_json FROM rd_build_line_tasks WHERE id=?').get(row.build_line_result_id)
    : null;
  const fit = parse(build?.fit_data_json) || parse(row.rd_result_json)?.result_json || {};
  return {
    analyzeItem: fit.analyze_item || build?.marker,
    slope: fit.fit?.slope ?? fit.slope,
    intercept: fit.fit?.intercept ?? fit.intercept,
    points: fit.points || [],
  };
}
async function autoCheck(id) {
  const row = task(id);
  const result = checkBaselineBias(curveInput(row));
  const status = result.pass ? 'pass' : 'exception';
  db.prepare("UPDATE review_tasks SET status=?,auto_check_result_json=?,exception_reason=?,updated_at=datetime('now','localtime') WHERE id=?")
    .run(status, JSON.stringify(result), result.pass ? null : result.reasons.join('；'), id);
  audit(id, result.pass ? 'auto_pass' : 'auto_exception', 'system', 'SYSTEM', result);
  const updated = task(id); emit(result.pass ? 'review_auto_pass' : 'review_exception', updated);
  if (!result.pass) {
    const body = `Panel: ${row.panel_name} / Lot: ${row.lot_no}，需主管判定`;
    await Promise.all([
      sendPushToRole('RD', 'RD 覆核結果有異常', body, `/qc-web/pre-assignment/rd-mobile/review/${id}`, { task_id: id, type: 'review_exception_to_rd' }),
      sendPushToRole('QC_SUPERVISOR', '有 QC 異常待主管判定', body, `/qc-web/pre-assignment/qc-mobile/exception/${id}`, { task_id: id, type: 'review_exception_to_supervisor' }),
    ]);
  }
  return updated;
}

router.get('/push/vapid-public-key', (_req, res) => res.json({ ok: true, data: { public_key: getVapidPublicKey() } }));
router.post('/push/subscribe', (req, res) => {
  if (!req.body.user_id || !REVIEW_ROLES.has(req.body.role)) return res.status(400).json({ ok: false, error: { message: 'Invalid user or role' } });
  try { savePushSubscription(req.body); res.json({ ok: true }); } catch (error) { res.status(400).json({ ok: false, error: { message: error.message } }); }
});
router.post('/push/unsubscribe', (req, res) => res.json({ ok: true, data: { disabled: disablePushSubscription(req.body) } }));
router.post('/review-users/provision', (req, res) => {
  if (!process.env.REVIEW_ADMIN_KEY || req.get('x-review-admin-key') !== process.env.REVIEW_ADMIN_KEY) return res.status(403).json({ ok: false, error: { message: 'Forbidden' } });
  try { provisionReviewUser(req.body); res.json({ ok: true }); } catch (error) { res.status(400).json({ ok: false, error: { message: error.message } }); }
});
router.post('/review-auth/verify', (req, res) => {
  const user = authenticateReviewUser(req.body.user_id, req.body.password, req.body.role);
  if (!user) return res.status(403).json({ ok: false, error: { message: '工號、密碼或角色不正確' } });
  res.json({ ok: true, data: user });
});
router.get('/review-task-events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders?.(); res.write('event: connected\ndata: {"ok":true}\n\n');
  clients.add(res); const timer = setInterval(() => res.write(': heartbeat\n\n'), 25000);
  req.on('close', () => { clearInterval(timer); clients.delete(res); });
});
router.post('/review-tasks/send-to-rd', async (req, res) => {
  const { panel_name, lot_no, mfg_lot_no, work_order_no, build_line_result_id, reason } = req.body;
  if (!panel_name || !lot_no) return res.status(400).json({ ok: false, error: { message: 'panel_name and lot_no required' } });
  const info = db.prepare('INSERT INTO review_tasks(panel_name,lot_no,mfg_lot_no,work_order_no,build_line_result_id,reason) VALUES(?,?,?,?,?,?)')
    .run(panel_name, lot_no, mfg_lot_no || null, work_order_no || null, build_line_result_id || null, reason || '待RD覆核');
  const id = Number(info.lastInsertRowid); audit(id, 'send_to_rd', req.body.actor_user_id || 'PC', 'QC_VIEWER', { reason });
  emit('rd_review_request', task(id));
  await sendPushToRole('RD', '有新的建線待 RD 覆核', `Panel: ${panel_name} / Lot: ${lot_no}`,
    `/qc-web/pre-assignment/rd-mobile/review/${id}`, { task_id: id, type: 'rd_review_request' });
  res.json({ ok: true, data: output(task(id)) });
});
router.get('/review-tasks', (req, res) => {
  const statuses = String(req.query.status || '').split(',').filter(Boolean);
  const rows = statuses.length
    ? db.prepare(`SELECT * FROM review_tasks WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY updated_at DESC`).all(...statuses)
    : db.prepare('SELECT * FROM review_tasks ORDER BY updated_at DESC LIMIT 500').all();
  res.json({ ok: true, data: rows.map(row => output(row)) });
});
router.get('/review-tasks/:id', (req, res) => {
  const row = task(Number(req.params.id)); if (!row) return res.status(404).json({ ok: false, error: { message: 'Task not found' } });
  res.json({ ok: true, data: output(row, true) });
});
router.post('/review-tasks/:id/rd-submit', async (req, res) => {
  const user = authenticateReviewUser(req.body.rd_user_id, req.body.rd_password, 'RD');
  if (!user) return res.status(403).json({ ok: false, error: { message: 'RD 工號或密碼不正確' } });
  const row = task(Number(req.params.id)); if (!row) return res.status(404).json({ ok: false, error: { message: 'Task not found' } });
  if (!['pending_rd', 'rd_reviewing'].includes(row.status)) return res.status(409).json({ ok: false, error: { message: 'Task already reviewed' } });
  const result = { result: req.body.result, comment: req.body.comment || '', result_json: req.body.result_json || {} };
  db.prepare("UPDATE review_tasks SET status='rd_done',rd_user_id=?,rd_result_json=?,updated_at=datetime('now','localtime') WHERE id=?")
    .run(user.user_id, JSON.stringify(result), row.id);
  audit(row.id, 'rd_submit', user.user_id, user.role, result); emit('rd_review_done', task(row.id));
  res.json({ ok: true, data: output(await autoCheck(row.id), true) });
});
router.post('/review-tasks/:id/supervisor-decision', async (req, res) => {
  const user = authenticateReviewUser(req.body.supervisor_id, req.body.password, 'QC_SUPERVISOR');
  if (!user) return res.status(403).json({ ok: false, error: { message: '主管工號、密碼或權限不正確' } });
  const valid = new Set(['pass', 'reject', 're_test', 'hold']);
  if (!valid.has(req.body.decision)) return res.status(400).json({ ok: false, error: { message: 'Invalid decision' } });
  const row = task(Number(req.params.id)); if (!row) return res.status(404).json({ ok: false, error: { message: 'Task not found' } });
  if (row.status !== 'exception') return res.status(409).json({ ok: false, error: { message: 'Only exception tasks can be decided' } });
  db.prepare("UPDATE review_tasks SET status=?,updated_at=datetime('now','localtime') WHERE id=?").run(req.body.decision, row.id);
  audit(row.id, `supervisor_${req.body.decision}`, user.user_id, user.role, { comment: req.body.comment || '' });
  const updated = task(row.id); emit('supervisor_decision_done', updated);
  if (updated.rd_user_id) await sendPushToUser(updated.rd_user_id, 'QC 主管已完成異常判定', `Panel: ${updated.panel_name} / Lot: ${updated.lot_no}`,
    `/qc-web/pre-assignment/rd-mobile/review/${updated.id}`, { task_id: updated.id, type: 'supervisor_decision_done', status: updated.status });
  res.json({ ok: true, data: output(updated, true) });
});

export default router;
