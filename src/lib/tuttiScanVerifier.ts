/**
 * Tutti scan verification logic.
 *
 * Validates that:
 * 1. Work-order QR lotNo === Disk QR discLotNo
 * 2. Work-order exists in DB (represented by TuttiWorkOrder)
 * 3. DB work-order lotNo and finishedBatchNo match the work-order QR
 * 4. Disk markers (from parseQbiQr markerWellMap) match DB work-order markerNames
 * 5. No "Unknown Marker" is present on the disk
 */

import type { ParsedQbiQr } from "./qbiQrParser";
import type {
  ParsedWorkOrderQr,
  TuttiWorkOrder,
  TuttiScanVerification,
} from "./tuttiScanTypes";

export interface VerifyTuttiScanInput {
  /** Parsed work-order QR. */
  workOrderQr: ParsedWorkOrderQr;
  /** Parsed disk QR (from parseQbiQr). */
  parsedDisk: ParsedQbiQr;
  /** Work-order record fetched from RDS. null if not found. */
  dbWorkOrder: TuttiWorkOrder | null;
}

/**
 * Run all verification rules for a Tutti scan.
 *
 * This function does NOT call parseQbiQr — the caller must pass the
 * already-parsed disk result. This keeps the verifier pure and testable.
 */
export function verifyTuttiScan(input: VerifyTuttiScanInput): TuttiScanVerification {
  const { workOrderQr, parsedDisk, dbWorkOrder } = input;
  const errors: string[] = [];

  // --- Rule 1: Disk QR must have parsed successfully ---
  if (!parsedDisk.ok) {
    return {
      ok: false,
      errors: [`Disk QR parse failed: ${parsedDisk.errors.join("; ")}`],
      matchedMarkers: [],
      unknownMarkers: [],
    };
  }

  // --- Rule 2: Work-order QR must have parsed successfully ---
  if (!workOrderQr.ok) {
    return {
      ok: false,
      errors: [`Work-order QR parse failed: ${workOrderQr.errors.join("; ")}`],
      matchedMarkers: [],
      unknownMarkers: [],
    };
  }

  // --- Rule 3: lotNo must match between work-order QR and disk QR ---
  if (workOrderQr.lotNo !== parsedDisk.lot.discLotNo) {
    errors.push(
      `Lot number mismatch: work-order QR lotNo="${workOrderQr.lotNo}" vs disk discLotNo="${parsedDisk.lot.discLotNo}"`,
    );
  }

  // --- Rule 4: Work-order must exist in DB ---
  if (!dbWorkOrder) {
    errors.push(
      `Work-order "${workOrderQr.workOrderNumber}" not found in database`,
    );
    return {
      ok: false,
      errors,
      matchedMarkers: [],
      unknownMarkers: [],
    };
  }

  // --- Rule 5: DB work-order lotNo must match work-order QR ---
  if (dbWorkOrder.lotNo !== workOrderQr.lotNo) {
    errors.push(
      `DB lotNo="${dbWorkOrder.lotNo}" does not match work-order QR lotNo="${workOrderQr.lotNo}"`,
    );
  }

  // --- Rule 6: DB work-order finishedBatchNo must match work-order QR ---
  if (dbWorkOrder.finishedBatchNo !== workOrderQr.finishedBatchNo) {
    errors.push(
      `DB finishedBatchNo="${dbWorkOrder.finishedBatchNo}" does not match work-order QR finishedBatchNo="${workOrderQr.finishedBatchNo}"`,
    );
  }

  // --- Rule 7: Disk markers validation ---
  const diskMarkers = parsedDisk.markerWellMap.filter((x) => x.used);
  const diskMarkerNames = diskMarkers.map((x) => x.markerName);

  // Check for Unknown Marker — verification fails immediately
  const unknownMarkers = diskMarkerNames.filter((name) => name === "Unknown Marker");
  if (unknownMarkers.length > 0) {
    errors.push(
      `Disk contains ${unknownMarkers.length} unknown marker(s) — cannot write to DB`,
    );
    return {
      ok: false,
      errors,
      matchedMarkers: [],
      unknownMarkers,
    };
  }

  // --- Rule 8: All disk markers must exist in DB work-order markerNames ---
  const dbMarkerSet = new Set(dbWorkOrder.markerNames);
  const matchedMarkers: string[] = [];
  const unmatchedMarkers: string[] = [];

  for (const name of diskMarkerNames) {
    if (dbMarkerSet.has(name)) {
      matchedMarkers.push(name);
    } else {
      unmatchedMarkers.push(name);
    }
  }

  if (unmatchedMarkers.length > 0) {
    errors.push(
      `Disk marker(s) not in work-order: ${unmatchedMarkers.join(", ")}`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    matchedMarkers,
    unknownMarkers: unmatchedMarkers,
  };
}
