/**
 * Migrate csassign from ipqcdrybeads.db → bead_ipqc_spec.db
 * Run once: node db/migrate-csassign.js
 */
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OLD_DB = path.resolve(__dirname, '../../../ipqcdrybeads.db');
const NEW_DB = path.resolve(__dirname, '../../../bead_ipqc_spec.db');

const oldDb = new Database(OLD_DB, { readonly: true });
const newDb = new Database(NEW_DB);
newDb.pragma('journal_mode = WAL');

// 1. Ensure tables exist
newDb.exec(`
  CREATE TABLE IF NOT EXISTS csassign (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    Marker TEXT NOT NULL UNIQUE
  )
`);
newDb.exec(`
  CREATE TABLE IF NOT EXISTS cs_meta (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    col_name TEXT NOT NULL UNIQUE,
    cs_title TEXT,
    cs_lot TEXT,
    cs_expiry TEXT,
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);

// 2. Read old schema to get column names
const oldCols = oldDb.prepare('PRAGMA table_info(csassign)').all();
const dataCols = oldCols.filter(c => c.name !== 'id').map(c => c.name);
console.log('Old columns:', dataCols);

// 3. Add dynamic columns to new csassign
const existingCols = new Set(newDb.prepare('PRAGMA table_info(csassign)').all().map(c => c.name));
for (const col of dataCols) {
  if (!existingCols.has(col)) {
    newDb.exec(`ALTER TABLE csassign ADD COLUMN "${col}" TEXT`);
    console.log(`  Added column: ${col}`);
  }
}

// 4. Copy rows
const oldRows = oldDb.prepare('SELECT * FROM csassign').all();
const insertCols = dataCols.map(c => `"${c}"`).join(', ');
const placeholders = dataCols.map(() => '?').join(', ');
const upsert = newDb.prepare(`
  INSERT INTO csassign (${insertCols}) VALUES (${placeholders})
  ON CONFLICT(Marker) DO UPDATE SET
  ${dataCols.filter(c => c !== 'Marker').map(c => `"${c}" = excluded."${c}"`).join(', ')}
`);

newDb.transaction(() => {
  for (const row of oldRows) {
    const vals = dataCols.map(c => row[c] ?? null);
    upsert.run(...vals);
  }
})();
console.log(`Migrated ${oldRows.length} rows`);

// 5. Insert default cs_meta from column names (L1_89751, L2_89752, etc.)
const metaCols = dataCols.filter(c => c !== 'Marker');
const metaUpsert = newDb.prepare(`
  INSERT OR IGNORE INTO cs_meta (col_name, cs_title, cs_lot, cs_expiry)
  VALUES (?, ?, ?, ?)
`);
for (const col of metaCols) {
  // Parse "L1_89751" → lot=89751
  const m = col.match(/^([LN]\d)_(\d+)$/);
  const lot = m ? m[2] : null;
  metaUpsert.run(
    col,
    'LYPHOCHEK ASSAYED CHEMISTRY CONTROL',
    lot,
    '2027-01-31'
  );
}
console.log(`Inserted ${metaCols.length} cs_meta entries`);

// 6. Verify
const cnt = newDb.prepare('SELECT COUNT(*) as c FROM csassign').get();
const meta = newDb.prepare('SELECT * FROM cs_meta').all();
console.log(`\nVerify: csassign has ${cnt.c} rows`);
meta.forEach(m => console.log(`  ${m.col_name}: title="${m.cs_title}" lot=${m.cs_lot} exp=${m.cs_expiry}`));

oldDb.close();
newDb.close();
console.log('\nDone.');
