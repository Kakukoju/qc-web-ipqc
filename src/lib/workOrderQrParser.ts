/**
 * Parser for Tutti work-order QR codes.
 *
 * Work-order QR format (pipe-delimited):
 *   WO|<workOrderNumber>|<lotNo>|<finishedBatchNo>
 *
 * Example:
 *   WO|WO-2025-001234|0-001-25051600|B01
 */

import type { ParsedWorkOrderQr } from "./tuttiScanTypes";

const WORK_ORDER_PREFIX = "WO";
const EXPECTED_SEGMENT_COUNT = 4;

export function parseWorkOrderQr(rawQr: string): ParsedWorkOrderQr {
  const errors: string[] = [];
  const trimmed = rawQr.trim();

  if (!trimmed) {
    return {
      ok: false,
      errors: ["Work-order QR is empty"],
      workOrderNumber: "",
      lotNo: "",
      finishedBatchNo: "",
    };
  }

  const segments = trimmed.split("|");

  if (segments[0] !== WORK_ORDER_PREFIX) {
    return {
      ok: false,
      errors: [`Invalid work-order QR prefix: expected "${WORK_ORDER_PREFIX}", got "${segments[0]}"`],
      workOrderNumber: "",
      lotNo: "",
      finishedBatchNo: "",
    };
  }

  if (segments.length < EXPECTED_SEGMENT_COUNT) {
    return {
      ok: false,
      errors: [
        `Work-order QR has ${segments.length} segments, expected ${EXPECTED_SEGMENT_COUNT}`,
      ],
      workOrderNumber: segments[1] ?? "",
      lotNo: segments[2] ?? "",
      finishedBatchNo: segments[3] ?? "",
    };
  }

  const workOrderNumber = segments[1];
  const lotNo = segments[2];
  const finishedBatchNo = segments[3];

  if (!workOrderNumber) {
    errors.push("Work-order number is empty");
  }
  if (!lotNo) {
    errors.push("Lot number is empty");
  }
  if (!finishedBatchNo) {
    errors.push("Finished batch number is empty");
  }

  return {
    ok: errors.length === 0,
    errors,
    workOrderNumber,
    lotNo,
    finishedBatchNo,
  };
}
