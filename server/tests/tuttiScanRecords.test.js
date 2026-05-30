/**
 * Integration tests for /api/v1/tutti-scan-records and /api/v1/tutti-work-orders.
 *
 * These tests run against the real PostgreSQL RDS.
 * They use a transaction-based approach: each test inserts test data into
 * production.tutti_work_orders, runs the API logic, then cleans up.
 *
 * Run:
 *   node server/tests/tuttiScanRecords.test.js
 *
 * Prerequisites:
 *   - PostgreSQL RDS accessible (PG_* env vars in server/.env)
 *   - Migration has been run (npm run db:migrate in server/)
 *   - production.tutti_work_orders table exists
 */
import { pool } from '../db/pgPool.js';

const TEST_WO_NUMBER = '__TEST_WO_' + Date.now();
const TEST_LOT_NO = '0-001-25051600';
const TEST_BATCH_NO = 'B01';
const TEST_MARKERS = [
  { markerNumber: '033', markerName: 'UCRE' },
  { markerNumber: '034', markerName: 'UPRO' },
];

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

async function setup() {
  // Ensure schema exists
  await pool.query('CREATE SCHEMA IF NOT EXISTS production');

  // Ensure tutti_work_orders table exists (minimal for testing)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS production.tutti_work_orders (
      work_order_number TEXT PRIMARY KEY,
      lot_no TEXT NOT NULL,
      finished_batch_no TEXT NOT NULL,
      panel_name TEXT,
      markers_json JSONB NOT NULL DEFAULT '[]'::jsonb
    )
  `);

  // Insert test work order
  await pool.query(
    `INSERT INTO production.tutti_work_orders (work_order_number, lot_no, finished_batch_no, panel_name, markers_json)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (work_order_number) DO NOTHING`,
    [TEST_WO_NUMBER, TEST_LOT_NO, TEST_BATCH_NO, 'Core Chem 13', JSON.stringify(TEST_MARKERS)]
  );
}

async function cleanup() {
  await pool.query('DELETE FROM production.tutti_work_orders WHERE work_order_number = $1', [TEST_WO_NUMBER]);
  await pool.query('DELETE FROM production.tutti_scan_records WHERE work_order_number = $1', [TEST_WO_NUMBER]);
}

// --- Simulate the route logic directly (service-level test) ---

async function fetchWorkOrder(workOrderNumber) {
  const result = await pool.query(
    `SELECT work_order_number, lot_no, finished_batch_no, panel_name, markers_json
     FROM production.tutti_work_orders WHERE work_order_number = $1 LIMIT 1`,
    [workOrderNumber]
  );
  return result.rows[0] || null;
}

async function insertScanRecord(payload) {
  const { workOrder, disk, machine, position, scanTime, operator } = payload;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch work order
    const woResult = await client.query(
      `SELECT work_order_number, lot_no, finished_batch_no, markers_json
       FROM production.tutti_work_orders WHERE work_order_number = $1 LIMIT 1`,
      [workOrder.workOrderNumber]
    );
    if (woResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'WORK_ORDER_NOT_FOUND' };
    }
    const dbWo = woResult.rows[0];

    // Verify lotNo
    if (dbWo.lot_no !== workOrder.lotNo) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'WORK_ORDER_MISMATCH' };
    }

    // Verify finishedBatchNo
    if (dbWo.finished_batch_no !== workOrder.finishedBatchNo) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'WORK_ORDER_MISMATCH' };
    }

    // Verify lotNo === discLotNo
    if (workOrder.lotNo !== disk.discLotNo) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'LOT_MISMATCH' };
    }

    // Check unknown markers
    const diskMarkerNames = disk.markers.filter(m => m.used !== false).map(m => m.markerName);
    if (diskMarkerNames.some(n => n === 'Unknown Marker')) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'UNKNOWN_MARKER' };
    }

    // Verify markers match
    const dbMarkers = (typeof dbWo.markers_json === 'string'
      ? JSON.parse(dbWo.markers_json)
      : dbWo.markers_json
    ).map(m => m.markerName);
    const dbMarkerSet = new Set(dbMarkers);
    const extraInDisk = diskMarkerNames.filter(n => !dbMarkerSet.has(n));
    if (extraInDisk.length > 0) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'MARKER_MISMATCH', extraInDisk };
    }

    // Check duplicate
    const dupResult = await client.query(
      `SELECT id FROM production.tutti_scan_records
       WHERE work_order_number = $1 AND COALESCE(device_sn, '') = $2
         AND position = $3 AND disk_lot_no = $4 LIMIT 1`,
      [workOrder.workOrderNumber, machine?.deviceSn || '', position, disk.discLotNo]
    );
    if (dupResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'DUPLICATE_SCAN_RECORD' };
    }

    // Insert
    const insertResult = await client.query(
      `INSERT INTO production.tutti_scan_records (
         work_order_number, lot_no, finished_batch_no,
         machine_id, device_sn, machine_name,
         position, disk_lot_no, panel_name,
         production_date, expiration_date,
         raw_machine_qr, raw_work_order_qr, raw_disk_qr,
         disk_markers_json, verification_json,
         scan_time, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [
        workOrder.workOrderNumber, workOrder.lotNo, workOrder.finishedBatchNo,
        machine?.machineId || null, machine?.deviceSn || null, machine?.machineName || null,
        position, disk.discLotNo, disk.panelName || null,
        disk.productionDate || null, disk.expirationDate || null,
        machine?.rawQr || null, workOrder.rawQr || null, disk.rawQr || null,
        JSON.stringify(disk.markers), JSON.stringify({ ok: true }),
        scanTime, operator || null,
      ]
    );

    await client.query('COMMIT');
    return { ok: true, id: insertResult.rows[0].id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return { ok: false, code: 'DUPLICATE_SCAN_RECORD' };
    throw err;
  } finally {
    client.release();
  }
}

// --- Test cases ---

async function testValidPayload() {
  console.log('\n[Test] Valid payload can write to production.tutti_scan_records');
  const result = await insertScanRecord({
    workOrder: { workOrderNumber: TEST_WO_NUMBER, lotNo: TEST_LOT_NO, finishedBatchNo: TEST_BATCH_NO, rawQr: 'WO|...' },
    disk: {
      discLotNo: TEST_LOT_NO,
      panelName: 'Core Chem 13',
      productionDate: '2025-05-16',
      expirationDate: '2026-05-15',
      rawQr: '00250516...',
      markers: [
        { markerNumber: '033', markerName: 'UCRE', used: true },
        { markerNumber: '034', markerName: 'UPRO', used: true },
      ],
    },
    machine: { machineId: 'M001', deviceSn: 'SN001', machineName: 'Tutti-1', rawQr: 'MACHINE|...' },
    position: '1',
    scanTime: new Date().toISOString(),
    operator: 'test-user',
  });
  assert(result.ok === true, 'Insert succeeded');
  assert(typeof result.id === 'number' || typeof result.id === 'string', `Got id: ${result.id}`);
}

async function testLotMismatch() {
  console.log('\n[Test] Lot number mismatch rejects write');
  const result = await insertScanRecord({
    workOrder: { workOrderNumber: TEST_WO_NUMBER, lotNo: TEST_LOT_NO, finishedBatchNo: TEST_BATCH_NO },
    disk: {
      discLotNo: '9-WRONG-LOT',
      markers: [{ markerNumber: '033', markerName: 'UCRE', used: true }],
    },
    machine: {},
    position: '2',
    scanTime: new Date().toISOString(),
  });
  assert(result.ok === false, 'Insert rejected');
  assert(result.code === 'LOT_MISMATCH', `Error code: ${result.code}`);
}

async function testMarkerMismatch() {
  console.log('\n[Test] Marker mismatch rejects write');
  const result = await insertScanRecord({
    workOrder: { workOrderNumber: TEST_WO_NUMBER, lotNo: TEST_LOT_NO, finishedBatchNo: TEST_BATCH_NO },
    disk: {
      discLotNo: TEST_LOT_NO,
      markers: [
        { markerNumber: '033', markerName: 'UCRE', used: true },
        { markerNumber: '099', markerName: 'FAKE_MARKER', used: true },
      ],
    },
    machine: {},
    position: '3',
    scanTime: new Date().toISOString(),
  });
  assert(result.ok === false, 'Insert rejected');
  assert(result.code === 'MARKER_MISMATCH', `Error code: ${result.code}`);
}

async function testUnknownMarker() {
  console.log('\n[Test] Unknown marker rejects write');
  const result = await insertScanRecord({
    workOrder: { workOrderNumber: TEST_WO_NUMBER, lotNo: TEST_LOT_NO, finishedBatchNo: TEST_BATCH_NO },
    disk: {
      discLotNo: TEST_LOT_NO,
      markers: [
        { markerNumber: '999', markerName: 'Unknown Marker', used: true },
      ],
    },
    machine: {},
    position: '4',
    scanTime: new Date().toISOString(),
  });
  assert(result.ok === false, 'Insert rejected');
  assert(result.code === 'UNKNOWN_MARKER', `Error code: ${result.code}`);
}

async function testDuplicateScanRecord() {
  console.log('\n[Test] Duplicate scan record rejects write');
  // The first insert was done in testValidPayload with position='1', deviceSn='SN001'
  const result = await insertScanRecord({
    workOrder: { workOrderNumber: TEST_WO_NUMBER, lotNo: TEST_LOT_NO, finishedBatchNo: TEST_BATCH_NO },
    disk: {
      discLotNo: TEST_LOT_NO,
      markers: [
        { markerNumber: '033', markerName: 'UCRE', used: true },
        { markerNumber: '034', markerName: 'UPRO', used: true },
      ],
    },
    machine: { deviceSn: 'SN001' },
    position: '1',
    scanTime: new Date().toISOString(),
  });
  assert(result.ok === false, 'Insert rejected');
  assert(result.code === 'DUPLICATE_SCAN_RECORD', `Error code: ${result.code}`);
}

async function testWorkOrderNotFound() {
  console.log('\n[Test] Non-existent work order rejects write');
  const result = await insertScanRecord({
    workOrder: { workOrderNumber: 'NONEXISTENT_WO_999', lotNo: TEST_LOT_NO, finishedBatchNo: TEST_BATCH_NO },
    disk: {
      discLotNo: TEST_LOT_NO,
      markers: [{ markerNumber: '033', markerName: 'UCRE', used: true }],
    },
    machine: {},
    position: '5',
    scanTime: new Date().toISOString(),
  });
  assert(result.ok === false, 'Insert rejected');
  assert(result.code === 'WORK_ORDER_NOT_FOUND', `Error code: ${result.code}`);
}

async function testGetWorkOrder() {
  console.log('\n[Test] GET work order returns correct data');
  const row = await fetchWorkOrder(TEST_WO_NUMBER);
  assert(row !== null, 'Work order found');
  assert(row.lot_no === TEST_LOT_NO, `lotNo matches: ${row.lot_no}`);
  assert(row.finished_batch_no === TEST_BATCH_NO, `finishedBatchNo matches: ${row.finished_batch_no}`);
}

async function testGetWorkOrderNotFound() {
  console.log('\n[Test] GET non-existent work order returns null');
  const row = await fetchWorkOrder('NONEXISTENT_WO_XYZ');
  assert(row === null, 'Work order not found (null)');
}

// --- Runner ---

async function run() {
  console.log('═══════════════════════════════════════════════════════');
  console.log(' Tutti Scan Records — Integration Tests');
  console.log('═══════════════════════════════════════════════════════');

  try {
    await setup();

    await testGetWorkOrder();
    await testGetWorkOrderNotFound();
    await testValidPayload();
    await testLotMismatch();
    await testMarkerMismatch();
    await testUnknownMarker();
    await testDuplicateScanRecord();
    await testWorkOrderNotFound();

    console.log('\n───────────────────────────────────────────────────────');
    console.log(` Results: ${passed} passed, ${failed} failed`);
    console.log('───────────────────────────────────────────────────────');
  } catch (err) {
    console.error('\n[FATAL] Test error:', err);
    failed++;
  } finally {
    await cleanup();
    await pool.end();
  }

  process.exit(failed > 0 ? 1 : 0);
}

run();
