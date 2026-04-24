import { Router } from 'express';
import specDb from '../db/specDb.js';

const router = Router();

// GET /api/machine-pn — all PNs grouped by machine_type
router.get('/', (_req, res) => {
  const rows = specDb.prepare('SELECT * FROM machine_pn ORDER BY machine_type, pn').all();
  const types = [...new Set(rows.map(r => r.machine_type))];
  res.json({ types, rows });
});

// GET /api/machine-pn/types — distinct machine types
router.get('/types', (_req, res) => {
  const rows = specDb.prepare('SELECT DISTINCT machine_type FROM machine_pn ORDER BY machine_type').all();
  res.json(rows.map(r => r.machine_type));
});

// GET /api/machine-pn/:type — PNs for a specific machine type
router.get('/:type', (req, res) => {
  const rows = specDb.prepare('SELECT * FROM machine_pn WHERE machine_type = ? ORDER BY pn').all(req.params.type);
  res.json(rows);
});

// POST /api/machine-pn — add a PN
// Body: { machine_type, pn }
router.post('/', (req, res) => {
  const { machine_type, pn } = req.body;
  if (!machine_type || !pn) return res.status(400).json({ error: 'machine_type and pn required' });
  try {
    specDb.prepare('INSERT INTO machine_pn (machine_type, pn) VALUES (?, ?)').run(machine_type, pn.trim());
    const rows = specDb.prepare('SELECT * FROM machine_pn WHERE machine_type = ? ORDER BY pn').all(machine_type);
    res.json({ ok: true, rows });
  } catch (err) {
    res.status(400).json({ error: err.message.includes('UNIQUE') ? '此 P/N 已存在' : err.message });
  }
});

// PUT /api/machine-pn/:id — update a PN
router.put('/:id', (req, res) => {
  const { pn } = req.body;
  if (!pn) return res.status(400).json({ error: 'pn required' });
  try {
    specDb.prepare('UPDATE machine_pn SET pn = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(pn.trim(), Number(req.params.id));
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
