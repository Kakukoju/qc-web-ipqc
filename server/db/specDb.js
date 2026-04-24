import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../../bead_ipqc_spec.db');

const specDb = new Database(DB_PATH);
specDb.pragma('journal_mode = WAL');

// Auto-create table
specDb.exec(`
  CREATE TABLE IF NOT EXISTS bead_ipqc_spec (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    source        TEXT NOT NULL,        -- 'P01' or 'Qbi'
    source_file   TEXT,
    marker        TEXT NOT NULL,
    pn            TEXT,
    tea           TEXT,
    single_cv     TEXT,                 -- 單管 CV (允收)
    init_l1_od    TEXT,                 -- 起始值 L1 OD
    init_l2_od    TEXT,                 -- 起始值 L2 OD
    spec_l1_od    TEXT,                 -- OD SPEC L1
    spec_l2_od    TEXT,                 -- OD SPEC L2
    spec_n1_od    TEXT,                 -- OD SPEC N1
    well_config   TEXT,                 -- QC 填藥 well
    dilution      TEXT,                 -- 稀釋倍數 (Qbi only)
    calc_method   TEXT,                 -- Calculation method
    merge_bias    TEXT,                 -- 併批 MEAN Bias
    merge_cv      TEXT,                 -- 併批 全批次 CV
    remarks       TEXT,
    updated_at    TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(source, marker)
  )
`);

// CS assign: concentration targets per marker per CS level
specDb.exec(`
  CREATE TABLE IF NOT EXISTS csassign (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    Marker  TEXT NOT NULL UNIQUE
  )
`);

// Machine P/N: multi-machine-type part numbers
specDb.exec(`
  CREATE TABLE IF NOT EXISTS machine_pn (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_type TEXT NOT NULL DEFAULT 'P01',
    pn           TEXT NOT NULL,
    updated_at   TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(machine_type, pn)
  )
`);

// CS meta: title, lot/expiry info for each CS column
specDb.exec(`
  CREATE TABLE IF NOT EXISTS cs_meta (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    col_name   TEXT NOT NULL UNIQUE,
    cs_title   TEXT,
    cs_lot     TEXT,
    cs_expiry  TEXT,
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);

export default specDb;
