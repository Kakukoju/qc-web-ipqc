/**
 * Migration: Create production.tutti_scan_records table.
 *
 * Target: beadsdb (PostgreSQL RDS)
 * Schema: production
 * Table:  tutti_scan_records
 *
 * Usage:
 *   node server/db/migrations/001_tutti_scan_records.js
 */
import { pool } from '../pgPool.js';

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create schema
    await client.query('CREATE SCHEMA IF NOT EXISTS production');

    // 2. Create table
    await client.query(`
      CREATE TABLE IF NOT EXISTS production.tutti_scan_records (
        id                  BIGSERIAL PRIMARY KEY,
        work_order_number   TEXT NOT NULL,
        lot_no              TEXT NOT NULL,
        finished_batch_no   TEXT NOT NULL,
        machine_id          TEXT,
        device_sn           TEXT,
        machine_name        TEXT,
        position            TEXT NOT NULL,
        disk_lot_no         TEXT NOT NULL,
        panel_name          TEXT,
        production_date     DATE,
        expiration_date     DATE,
        raw_machine_qr      TEXT,
        raw_work_order_qr   TEXT,
        raw_disk_qr         TEXT,
        disk_markers_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
        verification_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
        scan_time           TIMESTAMPTZ NOT NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by          TEXT
      )
    `);

    // 3. Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tutti_scan_records_work_order
        ON production.tutti_scan_records (work_order_number)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tutti_scan_records_lot_no
        ON production.tutti_scan_records (lot_no)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tutti_scan_records_disk_lot_no
        ON production.tutti_scan_records (disk_lot_no)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tutti_scan_records_scan_time
        ON production.tutti_scan_records (scan_time)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tutti_scan_records_device_position
        ON production.tutti_scan_records (device_sn, position)
    `);

    // 4. Unique constraint to prevent duplicate scans
    //    (same work order + device + position + disk lot = duplicate)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_tutti_scan_records_work_order_machine_position_disk
        ON production.tutti_scan_records (
          work_order_number,
          COALESCE(device_sn, ''),
          position,
          disk_lot_no
        )
    `);

    await client.query('COMMIT');
    console.log('[migration] production.tutti_scan_records created successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migration] Failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
