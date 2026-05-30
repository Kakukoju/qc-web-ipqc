/**
 * /api/v1/tutti-work-orders/:workOrderNumber  — GET work order from RDS
 * /api/v1/tutti-scan-records                  — POST scan record to RDS
 *
 * All data lives in beadsdb.production on PostgreSQL RDS.
 */
import { Router } from 'express';
import { pool } from '../db/pgPool.js';

const router = Router();

// ─── Error codes ──────────────────────────────────────────────────────────
const ERR = {
  WORK_ORDER_NOT_FOUND: 'WORK_ORDER_NOT_FOUND',
  WORK_ORDER_MISMATCH: 'WORK_ORDER_MISMATCH',
  LOT_MISMATCH: 'LOT_MISMATCH',
  MARKER_MISMATCH: 'MARKER_MISMATCH',
  UNKNOWN_MARKER: 'UNKNOWN_MARKER',
  DUPLICATE_SCAN_RECORD: 'DUPLICATE_SCAN_RECORD',
  DB_ERROR: 'DB_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
};

function errorResponse(res, status, code, message, details = null) {
  return res.status(status).json({
    ok: false,
    data: null,
    error: { code, message, ...(details ? { details } : {}) },
  });
}

// ─── GET /api/v1/tutti-work-orders/:workOrderNumber ───────────────────────
router.get('/tutti-work-orders/:workOrderNumber', async (req, res) => {
  const { workOrderNumber } = req.params;

  if (!workOrderNumber || !workOrderNumber.trim()) {
    return errorResponse(res, 400, ERR.VALIDATION_ERROR, 'workOrderNumber is required');
  }

  try {
    const result = await pool.query(
      `SELECT
         work_order_number,
         lot_no,
         finished_batch_no,
         panel_name,
         markers_json
       FROM production.tutti_work_orders
       WHERE work_order_number = $1
       LIMIT 1`,
      [workOrderNumber.trim()]
    );

    if (result.rows.length === 0) {
      return errorResponse(res, 404, ERR.WORK_ORDER_NOT_FOUND, `Work order "${workOrderNumber}" not found`);
    }

    const row = result.rows[0];
    // markers_json is stored as JSONB array of { markerNumber?, markerName }
    let markers = [];
    if (row.markers_json) {
      markers = typeof row.markers_json === 'string'
        ? JSON.parse(row.markers_json)
        : row.markers_json;
    }

    return res.json({
      ok: true,
      data: {
        workOrderNumber: row.work_order_number,
        lotNo: row.lot_no,
        finishedBatchNo: row.finished_batch_no,
        panelName: row.panel_name || null,
        markers,
      },
      error: null,
    });
  } catch (err) {
    console.error('[tutti-scan] GET work-order error:', err.message);
    return errorResponse(res, 500, ERR.DB_ERROR, 'Database error', { detail: err.message });
  }
});

// ─── POST /api/v1/tutti-scan-records ──────────────────────────────────────
router.post('/tutti-scan-records', async (req, res) => {
  const payload = req.body;

  // --- Basic payload validation ---
  const { workOrder, disk, machine, position, scanTime, operator } = payload || {};

  if (!workOrder || !disk || !position || !scanTime) {
    return errorResponse(res, 400, ERR.VALIDATION_ERROR, 'Missing required fields: workOrder, disk, position, scanTime');
  }

  if (!workOrder.workOrderNumber || !workOrder.lotNo || !workOrder.finishedBatchNo) {
    return errorResponse(res, 400, ERR.VALIDATION_ERROR, 'workOrder must include workOrderNumber, lotNo, finishedBatchNo');
  }

  if (!disk.discLotNo) {
    return errorResponse(res, 400, ERR.VALIDATION_ERROR, 'disk.discLotNo is required');
  }

  if (!Array.isArray(disk.markers)) {
    return errorResponse(res, 400, ERR.VALIDATION_ERROR, 'disk.markers must be an array');
  }

  // --- Transaction: verify + insert ---
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Step 1: Fetch work order from DB
    const woResult = await client.query(
      `SELECT work_order_number, lot_no, finished_batch_no, markers_json
       FROM production.tutti_work_orders
       WHERE work_order_number = $1
       LIMIT 1`,
      [workOrder.workOrderNumber]
    );

    if (woResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return errorResponse(res, 404, ERR.WORK_ORDER_NOT_FOUND,
        `Work order "${workOrder.workOrderNumber}" not found in database`);
    }

    const dbWo = woResult.rows[0];

    // Step 2: Verify lotNo matches between work-order QR and DB
    if (dbWo.lot_no !== workOrder.lotNo) {
      await client.query('ROLLBACK');
      return errorResponse(res, 422, ERR.WORK_ORDER_MISMATCH,
        'DB work order lotNo does not match submitted lotNo',
        { dbLotNo: dbWo.lot_no, submittedLotNo: workOrder.lotNo });
    }

    // Step 3: Verify finishedBatchNo matches
    if (dbWo.finished_batch_no !== workOrder.finishedBatchNo) {
      await client.query('ROLLBACK');
      return errorResponse(res, 422, ERR.WORK_ORDER_MISMATCH,
        'DB work order finishedBatchNo does not match submitted finishedBatchNo',
        { dbFinishedBatchNo: dbWo.finished_batch_no, submittedFinishedBatchNo: workOrder.finishedBatchNo });
    }

    // Step 4: Verify lotNo matches disk discLotNo
    if (workOrder.lotNo !== disk.discLotNo) {
      await client.query('ROLLBACK');
      return errorResponse(res, 422, ERR.LOT_MISMATCH,
        'Work order lotNo does not match disk discLotNo',
        { workOrderLotNo: workOrder.lotNo, diskDiscLotNo: disk.discLotNo });
    }

    // Step 5: Verify disk markers — check for Unknown Marker
    const diskMarkerNames = disk.markers
      .filter(m => m.used !== false)
      .map(m => m.markerName);

    const unknownMarkers = diskMarkerNames.filter(name => name === 'Unknown Marker');
    if (unknownMarkers.length > 0) {
      await client.query('ROLLBACK');
      return errorResponse(res, 422, ERR.UNKNOWN_MARKER,
        `Disk contains ${unknownMarkers.length} unknown marker(s)`,
        { unknownCount: unknownMarkers.length });
    }

    // Step 6: Verify disk markers match DB work order markers
    let dbMarkers = [];
    if (dbWo.markers_json) {
      const parsed = typeof dbWo.markers_json === 'string'
        ? JSON.parse(dbWo.markers_json)
        : dbWo.markers_json;
      dbMarkers = parsed.map(m => m.markerName);
    }

    const dbMarkerSet = new Set(dbMarkers);
    const extraInDisk = diskMarkerNames.filter(name => !dbMarkerSet.has(name));
    const diskMarkerSet = new Set(diskMarkerNames);
    const missingInDisk = dbMarkers.filter(name => !diskMarkerSet.has(name));

    if (extraInDisk.length > 0) {
      await client.query('ROLLBACK');
      return errorResponse(res, 422, ERR.MARKER_MISMATCH,
        'Disk QR marker 與工單 marker 不一致',
        { missingInDisk, extraInDisk });
    }

    // Step 7: Check duplicate scan record
    const dupResult = await client.query(
      `SELECT id FROM production.tutti_scan_records
       WHERE work_order_number = $1
         AND COALESCE(device_sn, '') = $2
         AND position = $3
         AND disk_lot_no = $4
       LIMIT 1`,
      [
        workOrder.workOrderNumber,
        (machine && machine.deviceSn) || '',
        position,
        disk.discLotNo,
      ]
    );

    if (dupResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return errorResponse(res, 409, ERR.DUPLICATE_SCAN_RECORD,
        'This scan record already exists',
        { existingId: dupResult.rows[0].id });
    }

    // Step 8: Build verification result JSON
    const verificationJson = {
      ok: true,
      errors: [],
      matchedMarkers: diskMarkerNames.filter(name => dbMarkerSet.has(name)),
      timestamp: new Date().toISOString(),
    };

    // Step 9: INSERT
    const insertResult = await client.query(
      `INSERT INTO production.tutti_scan_records (
         work_order_number, lot_no, finished_batch_no,
         machine_id, device_sn, machine_name,
         position, disk_lot_no, panel_name,
         production_date, expiration_date,
         raw_machine_qr, raw_work_order_qr, raw_disk_qr,
         disk_markers_json, verification_json,
         scan_time, created_by
       ) VALUES (
         $1, $2, $3,
         $4, $5, $6,
         $7, $8, $9,
         $10, $11,
         $12, $13, $14,
         $15, $16,
         $17, $18
       ) RETURNING id, work_order_number, lot_no, disk_lot_no, position, scan_time`,
      [
        workOrder.workOrderNumber,
        workOrder.lotNo,
        workOrder.finishedBatchNo,
        machine?.machineId || null,
        machine?.deviceSn || null,
        machine?.machineName || null,
        position,
        disk.discLotNo,
        disk.panelName || null,
        disk.productionDate || null,
        disk.expirationDate || null,
        machine?.rawQr || null,
        workOrder.rawQr || null,
        disk.rawQr || null,
        JSON.stringify(disk.markers),
        JSON.stringify(verificationJson),
        scanTime,
        operator || null,
      ]
    );

    await client.query('COMMIT');

    const inserted = insertResult.rows[0];
    return res.status(201).json({
      ok: true,
      data: {
        id: inserted.id,
        workOrderNumber: inserted.work_order_number,
        lotNo: inserted.lot_no,
        diskLotNo: inserted.disk_lot_no,
        position: inserted.position,
        scanTime: inserted.scan_time,
      },
      error: null,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});

    // Handle unique constraint violation (belt-and-suspenders for race condition)
    if (err.code === '23505') {
      return errorResponse(res, 409, ERR.DUPLICATE_SCAN_RECORD,
        'This scan record already exists (constraint violation)');
    }

    console.error('[tutti-scan] POST error:', err.message);
    return errorResponse(res, 500, ERR.DB_ERROR, 'Database error', { detail: err.message });
  } finally {
    client.release();
  }
});

export default router;
