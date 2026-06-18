import XLSX from 'xlsx';
import { pool } from '../db/pgPool.js';

export const SKU_SCHEMA = 'tutti_sku_list';
const META_TABLE = '__sheet_columns';

const XLSX_OPTS = {
  type: 'buffer',
  cellDates: false,
  cellFormula: false,
  cellHTML: false,
  cellNF: false,
  cellStyles: false,
};

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function normalizeHeader(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function makeColumnKey(header, index, used) {
  const base = normalizeHeader(header)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || `col_${index + 1}`;
  let key = base;
  let suffix = 2;
  while (used.has(key)) {
    key = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(key);
  return key;
}

function parseSheet(sheetName, ws) {
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: false,
  });
  if (rows.length < 2) {
    throw new Error(`${sheetName}: header row 2 not found`);
  }

  const rawHeaders = rows[1].map(normalizeHeader);
  const first = rawHeaders.findIndex(Boolean);
  let last = rawHeaders.length - 1;
  while (last >= 0 && !rawHeaders[last]) last -= 1;
  if (first < 0 || last < first) {
    throw new Error(`${sheetName}: header row 2 is empty`);
  }

  const used = new Set();
  const columns = rawHeaders.slice(first, last + 1).map((label, index) => ({
    key: makeColumnKey(label, index, used),
    label: label || `Column ${index + 1}`,
    ordinal: index + 1,
  }));

  const dataRows = rows.slice(2)
    .map((row, rowIndex) => {
      const cells = row.slice(first, last + 1);
      const hasValue = cells.some((cell) => normalizeHeader(cell) !== '');
      if (!hasValue) return null;
      const record = { __row_no: rowIndex + 3 };
      columns.forEach((column, index) => {
        const value = cells[index];
        record[column.key] = value == null ? null : String(value).trim();
      });
      return record;
    })
    .filter(Boolean);

  return { name: sheetName, columns, rows: dataRows };
}

export function parseWorkbookBuffer(buffer) {
  const workbook = XLSX.read(buffer, XLSX_OPTS);
  return workbook.SheetNames.map((sheetName) => parseSheet(sheetName, workbook.Sheets[sheetName]));
}

export async function ensureSkuSchema(client = pool) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(SKU_SCHEMA)}`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${quoteIdent(SKU_SCHEMA)}.${quoteIdent(META_TABLE)} (
      table_name TEXT NOT NULL,
      column_key TEXT NOT NULL,
      header_label TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      PRIMARY KEY (table_name, column_key)
    )
  `);
}

async function getExistingSheetColumns(client = pool) {
  await ensureSkuSchema(client);
  const result = await client.query(`
    SELECT table_name, column_key, header_label, ordinal
    FROM ${quoteIdent(SKU_SCHEMA)}.${quoteIdent(META_TABLE)}
    ORDER BY table_name, ordinal
  `);
  const map = new Map();
  for (const row of result.rows) {
    if (!map.has(row.table_name)) map.set(row.table_name, []);
    map.get(row.table_name).push({
      key: row.column_key,
      label: row.header_label,
      ordinal: row.ordinal,
    });
  }
  return map;
}

export async function validateWorkbookForReplace(sheets, client = pool) {
  const existing = await getExistingSheetColumns(client);
  if (existing.size === 0) return { ok: true, differences: [] };

  const incoming = new Map(sheets.map((sheet) => [sheet.name, sheet.columns]));
  const differences = [];

  for (const tableName of existing.keys()) {
    if (!incoming.has(tableName)) {
      differences.push({ table: tableName, type: 'missing_sheet', message: '上傳檔缺少此 sheet' });
    }
  }
  for (const sheetName of incoming.keys()) {
    if (!existing.has(sheetName)) {
      differences.push({ table: sheetName, type: 'extra_sheet', message: '上傳檔多出目前 RDS 沒有的 sheet' });
    }
  }

  for (const [sheetName, incomingColumns] of incoming.entries()) {
    const currentColumns = existing.get(sheetName);
    if (!currentColumns) continue;
    const max = Math.max(currentColumns.length, incomingColumns.length);
    for (let index = 0; index < max; index += 1) {
      const current = currentColumns[index];
      const next = incomingColumns[index];
      if (!current || !next || current.label !== next.label || current.key !== next.key) {
        differences.push({
          table: sheetName,
          type: 'column_mismatch',
          ordinal: index + 1,
          current: current?.label ?? null,
          incoming: next?.label ?? null,
          message: `第 ${index + 1} 欄 header 不一致`,
        });
      }
    }
  }

  return { ok: differences.length === 0, differences };
}

async function listDataTables(client = pool) {
  await ensureSkuSchema(client);
  const result = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = $1
      AND table_type = 'BASE TABLE'
      AND table_name <> $2
    ORDER BY table_name
  `, [SKU_SCHEMA, META_TABLE]);
  return result.rows.map((row) => row.table_name);
}

export async function replaceSkuTables(sheets) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureSkuSchema(client);

    const existingTables = await listDataTables(client);
    for (const tableName of existingTables) {
      await client.query(`DROP TABLE IF EXISTS ${quoteIdent(SKU_SCHEMA)}.${quoteIdent(tableName)}`);
    }
    await client.query(`DELETE FROM ${quoteIdent(SKU_SCHEMA)}.${quoteIdent(META_TABLE)}`);

    for (const sheet of sheets) {
      const columnSql = sheet.columns
        .map((column) => `${quoteIdent(column.key)} TEXT`)
        .join(', ');
      await client.query(`
        CREATE TABLE ${quoteIdent(SKU_SCHEMA)}.${quoteIdent(sheet.name)} (
          id BIGSERIAL PRIMARY KEY,
          __row_no INTEGER NOT NULL,
          ${columnSql}
        )
      `);

      for (const column of sheet.columns) {
        await client.query(`
          INSERT INTO ${quoteIdent(SKU_SCHEMA)}.${quoteIdent(META_TABLE)}
            (table_name, column_key, header_label, ordinal)
          VALUES ($1, $2, $3, $4)
        `, [sheet.name, column.key, column.label, column.ordinal]);
      }

      if (sheet.rows.length > 0) {
        const keys = ['__row_no', ...sheet.columns.map((column) => column.key)];
        const placeholders = [];
        const values = [];
        sheet.rows.forEach((row, rowIndex) => {
          const rowPlaceholders = keys.map((key) => {
            values.push(row[key] ?? null);
            return `$${values.length}`;
          });
          placeholders.push(`(${rowPlaceholders.join(', ')})`);
        });
        await client.query(`
          INSERT INTO ${quoteIdent(SKU_SCHEMA)}.${quoteIdent(sheet.name)}
            (${keys.map(quoteIdent).join(', ')})
          VALUES ${placeholders.join(', ')}
        `, values);
      }
    }

    await client.query('COMMIT');
    return { sheetCount: sheets.length, rowCount: sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listSkuTables() {
  const tables = await listDataTables();
  const columnsByTable = await getExistingSheetColumns();
  const result = [];
  for (const tableName of tables) {
    const countResult = await pool.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdent(SKU_SCHEMA)}.${quoteIdent(tableName)}`);
    result.push({
      name: tableName,
      displayName: tableName.toUpperCase(),
      rowCount: countResult.rows[0]?.count ?? 0,
      columns: columnsByTable.get(tableName) ?? [],
    });
  }
  return result;
}

export async function getSkuTableRows(tableName, { q = '', limit = 500 } = {}) {
  const columnsByTable = await getExistingSheetColumns();
  const columns = columnsByTable.get(tableName);
  if (!columns) {
    const error = new Error('Table not found');
    error.status = 404;
    throw error;
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const params = [];
  let whereSql = '';
  const trimmed = String(q || '').trim();
  if (trimmed) {
    params.push(`%${trimmed}%`);
    whereSql = `WHERE ${columns.map((column) => `${quoteIdent(column.key)} ILIKE $1`).join(' OR ')}`;
  }

  params.push(safeLimit);
  const result = await pool.query(`
    SELECT id, __row_no, ${columns.map((column) => quoteIdent(column.key)).join(', ')}
    FROM ${quoteIdent(SKU_SCHEMA)}.${quoteIdent(tableName)}
    ${whereSql}
    ORDER BY __row_no
    LIMIT $${params.length}
  `, params);

  return {
    table: tableName,
    displayName: tableName.toUpperCase(),
    columns,
    rows: result.rows,
  };
}
