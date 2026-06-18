import { Router } from 'express';
import multer from 'multer';
import {
  getSkuTableRows,
  listSkuTables,
  parseWorkbookBuffer,
  replaceSkuTables,
  validateWorkbookForReplace,
} from '../services/tuttiSkuListService.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

router.get('/tables', async (_req, res) => {
  try {
    const tables = await listSkuTables();
    res.json({ ok: true, tables });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.get('/tables/:tableName', async (req, res) => {
  try {
    const data = await getSkuTableRows(req.params.tableName, {
      q: req.query.q,
      limit: req.query.limit,
    });
    res.json({ ok: true, data });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message });
  }
});

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: '請選擇 Excel 檔案' });
  }

  try {
    const sheets = parseWorkbookBuffer(req.file.buffer);
    const validation = await validateWorkbookForReplace(sheets);
    if (!validation.ok) {
      return res.status(422).json({
        ok: false,
        error: 'Excel header 與目前 RDS schema 不一致，未上傳',
        differences: validation.differences,
      });
    }

    const result = await replaceSkuTables(sheets);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

export default router;
