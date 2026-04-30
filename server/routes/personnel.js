import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import db from '../db/sqlite.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Ensure tables exist ─────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS qc_personnel (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_no TEXT NOT NULL UNIQUE,
    department TEXT,
    cost_center TEXT,
    name TEXT,
    english_name TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS line_personnel (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_no TEXT NOT NULL UNIQUE,
    department TEXT,
    cost_center TEXT,
    name TEXT,
    english_name TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);

// ── Generic CRUD for a given table ──────────────────────────────────────
function buildRoutes(table) {
  const prefix = `/${table}`;

  // GET all
  router.get(prefix, (_req, res) => {
    res.json(db.prepare(`SELECT * FROM ${table} ORDER BY department, emp_no`).all());
  });

  // POST create
  router.post(prefix, (req, res) => {
    const { emp_no, department, cost_center, name, english_name } = req.body;
    if (!emp_no) return res.status(400).json({ error: 'emp_no required' });
    try {
      const info = db.prepare(`
        INSERT INTO ${table} (emp_no, department, cost_center, name, english_name)
        VALUES (?, ?, ?, ?, ?)
      `).run(emp_no, department || null, cost_center || null, name || null, english_name || null);
      res.json({ id: info.lastInsertRowid });
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: `員工編號 ${emp_no} 已存在` });
      res.status(500).json({ error: e.message });
    }
  });

  // PUT update
  router.put(`${prefix}/:id`, (req, res) => {
    const { emp_no, department, cost_center, name, english_name } = req.body;
    try {
      db.prepare(`
        UPDATE ${table}
        SET emp_no=?, department=?, cost_center=?, name=?, english_name=?,
            updated_at=datetime('now','localtime')
        WHERE id=?
      `).run(emp_no, department || null, cost_center || null, name || null, english_name || null, req.params.id);
      res.json({ ok: true });
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: `員工編號 ${emp_no} 已存在` });
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE
  router.delete(`${prefix}/:id`, (req, res) => {
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  });

  // POST upload Excel
  router.post(`${prefix}/upload`, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    try {
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) return res.status(400).json({ error: '空的 Excel' });

      // Map column headers (flexible matching)
      const mapCol = (row, keys) => {
        for (const k of keys) {
          for (const h of Object.keys(row)) {
            if (h.toLowerCase().replace(/[\s_]/g, '').includes(k)) return String(row[h]).trim();
          }
        }
        return '';
      };

      let inserted = 0, updated = 0;
      const upsert = db.prepare(`
        INSERT INTO ${table} (emp_no, department, cost_center, name, english_name)
        VALUES (@emp_no, @department, @cost_center, @name, @english_name)
        ON CONFLICT(emp_no) DO UPDATE SET
          department=excluded.department, cost_center=excluded.cost_center,
          name=excluded.name, english_name=excluded.english_name,
          updated_at=datetime('now','localtime')
      `);

      db.transaction(() => {
        for (const row of rows) {
          const emp_no = mapCol(row, ['empno', 'emp', '工號', '員工']);
          if (!emp_no) continue;
          const existing = db.prepare(`SELECT 1 FROM ${table} WHERE emp_no=?`).get(emp_no);
          upsert.run({
            emp_no,
            department: mapCol(row, ['department', '部門']) || null,
            cost_center: mapCol(row, ['costcenter', '成本中心']) || null,
            name: mapCol(row, ['name', '姓名', 'chinesename']) || mapCol(row, ['name']) || null,
            english_name: mapCol(row, ['englishname', '英文', 'english']) || null,
          });
          if (existing) updated++; else inserted++;
        }
      })();

      res.json({ inserted, updated, total: inserted + updated });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

buildRoutes('qc_personnel');
buildRoutes('line_personnel');

export default router;
