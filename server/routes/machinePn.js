import { Router } from 'express';
import specDb from '../db/specDb.js';

const router = Router();

const SKYLAI_API_BASE = 'https://api.skylaicloud.com.tw';
const SKYLAI_TOKEN = '43488|TnN58D0tNwbwrRjFYXbavtBvrmzuDtATunXP3Jwy';

// GET /api/machine-pn — all PNs grouped by machine_type
router.get('/', (_req, res) => {
  const rows = specDb.prepare('SELECT * FROM machine_pn ORDER BY machine_type, pn').all();
  const types = [...new Set(rows.map(r => r.machine_type))];
  if (!types.includes('Tutti')) types.push('Tutti');
  res.json({ types, rows });
});

// GET /api/machine-pn/types — distinct machine types
router.get('/types', (_req, res) => {
  const rows = specDb.prepare('SELECT DISTINCT machine_type FROM machine_pn ORDER BY machine_type').all();
  const types = rows.map(r => r.machine_type);
  if (!types.includes('Tutti')) types.push('Tutti');
  res.json(types);
});

// GET /api/machine-pn/tutti/status — get device status from SkylaiCloud for all Tutti machines
router.get('/tutti/status', async (_req, res) => {
  try {
    let rows = specDb.prepare("SELECT * FROM machine_pn WHERE machine_type = 'Tutti' ORDER BY pn").all();

    // Fetch status from SkylaiCloud
    const statusResp = await fetch(`${SKYLAI_API_BASE}/api/get_device_status`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SKYLAI_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'get_device_status', project_id: 1, group_name: 'QC' }),
    });
    const statusBody = await statusResp.json();
    const statusMap = {};
    for (const d of (statusBody.data || [])) {
      statusMap[d.device_sn] = d;
    }

    // If SQLite has no Tutti rows, auto-populate from SkylaiCloud device_list
    if (rows.length === 0) {
      const listResp = await fetch(`${SKYLAI_API_BASE}/api/get_device_list`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SKYLAI_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'get_device_list', project_id: 1, group_name: 'QC' }),
      });
      const listBody = await listResp.json();
      const devices = listBody.data || [];
      for (const d of devices) {
        try {
          specDb.prepare('INSERT OR IGNORE INTO machine_pn (machine_type, pn, device_sn) VALUES (?, ?, ?)').run('Tutti', d.device_sn, d.device_sn);
        } catch (_) {}
      }
      rows = specDb.prepare("SELECT * FROM machine_pn WHERE machine_type = 'Tutti' ORDER BY pn").all();
    }

    const result = rows.map(r => ({
      ...r,
      status: statusMap[r.device_sn] || null,
    }));
    res.json({ ok: true, rows: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/machine-pn/tutti/add — add Tutti machine with PN, auto-detect SN from SkylaiCloud
router.post('/tutti/add', async (req, res) => {
  const { pn } = req.body;
  if (!pn) return res.status(400).json({ error: 'pn required' });

  try {
    // Try to find device_sn from SkylaiCloud device list matching the PN
    const resp = await fetch(`${SKYLAI_API_BASE}/api/get_device_list`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SKYLAI_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'get_device_list', project_id: 1, group_name: 'QC' }),
    });
    const body = await resp.json();
    const devices = body.data || [];
    // Match by device_sn (user may input SN directly as PN)
    const matched = devices.find(d => d.device_sn === pn.trim() || d.device_name === pn.trim());
    const device_sn = matched ? matched.device_sn : pn.trim();

    specDb.prepare('INSERT INTO machine_pn (machine_type, pn, device_sn) VALUES (?, ?, ?)').run('Tutti', pn.trim(), device_sn);
    const rows = specDb.prepare("SELECT * FROM machine_pn WHERE machine_type = 'Tutti' ORDER BY pn").all();
    res.json({ ok: true, rows, device_sn });
  } catch (err) {
    res.status(400).json({ error: err.message.includes('UNIQUE') ? '此 P/N 已存在' : err.message });
  }
});

// GET /api/machine-pn/tutti/devices — get Tutti device_sn list (for scheduler)
router.get('/tutti/devices', (_req, res) => {
  const rows = specDb.prepare("SELECT device_sn FROM machine_pn WHERE machine_type = 'Tutti' AND device_sn IS NOT NULL").all();
  res.json({ ok: true, devices: rows.map(r => r.device_sn) });
});

// GET /api/machine-pn/:type — PNs for a specific machine type
router.get('/:type', (req, res) => {
  const rows = specDb.prepare('SELECT * FROM machine_pn WHERE machine_type = ? ORDER BY pn').all(req.params.type);
  res.json(rows);
});

// POST /api/machine-pn — add a PN
// Body: { machine_type, pn }
router.post('/', (req, res) => {
  const { machine_type, pn, device_sn } = req.body;
  if (!machine_type || !pn) return res.status(400).json({ error: 'machine_type and pn required' });
  try {
    specDb.prepare('INSERT INTO machine_pn (machine_type, pn, device_sn) VALUES (?, ?, ?)').run(machine_type, pn.trim(), device_sn || null);
    const rows = specDb.prepare('SELECT * FROM machine_pn WHERE machine_type = ? ORDER BY pn').all(machine_type);
    res.json({ ok: true, rows });
  } catch (err) {
    res.status(400).json({ error: err.message.includes('UNIQUE') ? '此 P/N 已存在' : err.message });
  }
});

// PUT /api/machine-pn/:id — update a PN
router.put('/:id', (req, res) => {
  const { pn, device_sn } = req.body;
  if (!pn) return res.status(400).json({ error: 'pn required' });
  try {
    if (device_sn !== undefined) {
      specDb.prepare('UPDATE machine_pn SET pn = ?, device_sn = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(pn.trim(), device_sn, Number(req.params.id));
    } else {
      specDb.prepare('UPDATE machine_pn SET pn = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(pn.trim(), Number(req.params.id));
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message.includes('UNIQUE') ? '此 P/N 已存在' : err.message });
  }
});

// DELETE /api/machine-pn/:id
router.delete('/:id', (req, res) => {
  specDb.prepare('DELETE FROM machine_pn WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

export default router;
