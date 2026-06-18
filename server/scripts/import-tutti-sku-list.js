import fs from 'fs';
import {
  parseWorkbookBuffer,
  replaceSkuTables,
  validateWorkbookForReplace,
} from '../services/tuttiSkuListService.js';
import { pool } from '../db/pgPool.js';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node scripts/import-tutti-sku-list.js <xlsx-path>');
  process.exit(1);
}

try {
  const buffer = fs.readFileSync(filePath);
  const sheets = parseWorkbookBuffer(buffer);
  const validation = await validateWorkbookForReplace(sheets);
  if (!validation.ok) {
    console.error(JSON.stringify({ ok: false, differences: validation.differences }, null, 2));
    process.exitCode = 2;
  } else {
    const result = await replaceSkuTables(sheets);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
