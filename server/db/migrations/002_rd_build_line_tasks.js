/**
 * Migration 002: Create rd_build_line_tasks table and rd_whitelist table
 * 
 * rd_build_line_tasks: Stores RD build-line tasks sent from PC build-lines
 * rd_whitelist: Stores authorized RD personnel for build-line operations
 */
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../../../../ipqcdrybeads.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ── rd_build_line_tasks ──────────────────────────────────────────────────
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

db.exec(`CREATE INDEX IF NOT EXISTS idx_rd_tasks_status ON rd_build_line_tasks(status)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_rd_tasks_panel_lot ON rd_build_line_tasks(panel_name, lot_no)`);

// ── rd_whitelist ─────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS rd_whitelist (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_no       TEXT NOT NULL UNIQUE,
    department   TEXT NOT NULL,
    cost_center  TEXT NOT NULL,
    name         TEXT NOT NULL,
    english_name TEXT NOT NULL,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT DEFAULT (datetime('now','localtime'))
  )
`);

// ── Seed RD whitelist ────────────────────────────────────────────────────
const seedData = [
  { emp_no: '10018325', department: '試劑部', cost_center: 'T800302', name: '張雅婷', english_name: 'Chloe Chang' },
  { emp_no: '10018348', department: '試劑部', cost_center: 'T800302', name: '林怡萱', english_name: 'Kira Lin' },
  { emp_no: '10018349', department: '試劑部', cost_center: 'T800302', name: '林宣瑜', english_name: 'Anne Lin' },
  { emp_no: '10018354', department: '試劑部', cost_center: 'T800302', name: '藍肇穎', english_name: 'Chaoying lan' },
  { emp_no: '10018359', department: '試劑部', cost_center: 'T800302', name: '陳薇婷', english_name: 'Latina Chen' },
  { emp_no: '10018403', department: '試劑部', cost_center: 'T800302', name: '姜富耀', english_name: 'Ivan FY Jiang' },
  { emp_no: '10024495', department: '試劑部', cost_center: 'T800302', name: '王又屏', english_name: 'Chelly Wang' },
  { emp_no: '10024653', department: '試劑部', cost_center: 'T800302', name: '林貞妘', english_name: 'Carey CY Lin' },
  { emp_no: '86000047', department: '試劑部', cost_center: 'T800302', name: '李璟瑤', english_name: 'Jenna Li' },
  { emp_no: '86000053', department: '試劑部', cost_center: 'T800302', name: '黃巧恩', english_name: 'Joanne Huang' },
  { emp_no: '86000066', department: '試劑部', cost_center: 'T800302', name: '周芊妤', english_name: 'Chien Chou' },
  { emp_no: '10018353', department: '配藥部', cost_center: 'T800306', name: '林思佑', english_name: 'Suyo Lin' },
  { emp_no: '10018356', department: '配藥部', cost_center: 'T800306', name: '陳思涵', english_name: 'Crystal Chen' },
  { emp_no: '10021582', department: '配藥部', cost_center: 'T800306', name: '劉盈君', english_name: 'Angela Liu' },
  { emp_no: '10032204', department: '配藥部', cost_center: 'T800306', name: '王以晴', english_name: 'Dabby Wang' },
  { emp_no: '10032588', department: '配藥部', cost_center: 'T800306', name: '李宜蓁', english_name: 'Patty Li' },
  { emp_no: '86000034', department: '配藥部', cost_center: 'T800306', name: '張惠雯', english_name: 'Wendy Chang' },
  { emp_no: '86000054', department: '配藥部', cost_center: 'T800306', name: '黃雅瑜', english_name: 'Yayu Huang' },
  { emp_no: '10028740', department: '分子診斷試劑處', cost_center: 'T800308', name: '黃靜柔', english_name: 'Ching Jou Huang' },
  { emp_no: '10032205', department: '分子診斷試劑處', cost_center: 'T800308', name: '余定憲', english_name: 'Jimmy Yu' },
];

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO rd_whitelist (emp_no, department, cost_center, name, english_name)
  VALUES (@emp_no, @department, @cost_center, @name, @english_name)
`);

const insertMany = db.transaction((items) => {
  for (const item of items) insertStmt.run(item);
});

insertMany(seedData);

console.log('✅ Migration 002: rd_build_line_tasks + rd_whitelist created and seeded');
db.close();
