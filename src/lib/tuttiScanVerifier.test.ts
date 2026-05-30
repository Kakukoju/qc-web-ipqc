import { describe, expect, it } from "vitest";

import { parseQbiQr } from "./qbiQrParser";
import { verifyTuttiScan } from "./tuttiScanVerifier";
import type { ParsedWorkOrderQr, TuttiWorkOrder } from "./tuttiScanTypes";
import type { ParsedQbiQr } from "./qbiQrParser";

// --- Test fixtures ---

/** A valid work-order QR parse result matching the CHEM test disk. */
const VALID_WORK_ORDER_QR: ParsedWorkOrderQr = {
  ok: true,
  errors: [],
  workOrderNumber: "WO-2025-001234",
  lotNo: "0-001-25051600",
  finishedBatchNo: "B01",
};

/** A DB work-order record matching the above. */
const VALID_DB_WORK_ORDER: TuttiWorkOrder = {
  workOrderNumber: "WO-2025-001234",
  lotNo: "0-001-25051600",
  finishedBatchNo: "B01",
  markerNames: ["UCRE", "UPRO"],
};

/**
 * Build a real parsed disk using the existing parseQbiQr.
 * This QR has markers UCRE (033) and UPRO (034).
 */
const TEST_QR_SOURCE =
  "00250516000012000010000999990000000000000033010102282200105875052599402114470100" +
  "00000318340212245013361801310960231160003361801310960231160003361801310960231160" +
  "00103404010123160010513705264140211967010000000313520207252000000000313520207252" +
  "00000000031352020725200000000031352020725200100000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000";
const MARKER_034_SPECIES_LINE_OFFSET = 41 + 1 * 122 + 121;
const TEST_QR =
  TEST_QR_SOURCE.slice(0, MARKER_034_SPECIES_LINE_OFFSET) +
  "0" +
  TEST_QR_SOURCE.slice(MARKER_034_SPECIES_LINE_OFFSET + 1);

const PARSED_DISK: ParsedQbiQr = parseQbiQr(TEST_QR);

/** Helper to set a marker number in the raw QR. */
const setMarkerNumber = (rawQr: string, index: number, markerNumber: string) => {
  const markerStart = 41 + index * 122;
  return `${rawQr.slice(0, markerStart)}${markerNumber}${rawQr.slice(markerStart + 3)}`;
};

describe("verifyTuttiScan", () => {
  it("passes when all fields match", () => {
    const result = verifyTuttiScan({
      workOrderQr: VALID_WORK_ORDER_QR,
      parsedDisk: PARSED_DISK,
      dbWorkOrder: VALID_DB_WORK_ORDER,
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.matchedMarkers).toEqual(["UCRE", "UPRO"]);
    expect(result.unknownMarkers).toHaveLength(0);
  });

  it("fails when disk QR parse has errors", () => {
    const badDisk: ParsedQbiQr = {
      ...PARSED_DISK,
      ok: false,
      errors: ["QR contains non-numeric characters"],
    };

    const result = verifyTuttiScan({
      workOrderQr: VALID_WORK_ORDER_QR,
      parsedDisk: badDisk,
      dbWorkOrder: VALID_DB_WORK_ORDER,
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("Disk QR parse failed");
  });

  it("fails when work-order QR parse has errors", () => {
    const badWo: ParsedWorkOrderQr = {
      ok: false,
      errors: ["Work-order QR is empty"],
      workOrderNumber: "",
      lotNo: "",
      finishedBatchNo: "",
    };

    const result = verifyTuttiScan({
      workOrderQr: badWo,
      parsedDisk: PARSED_DISK,
      dbWorkOrder: VALID_DB_WORK_ORDER,
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("Work-order QR parse failed");
  });

  it("fails when lotNo does not match disk discLotNo", () => {
    const mismatchedWo: ParsedWorkOrderQr = {
      ...VALID_WORK_ORDER_QR,
      lotNo: "9-999-99999999",
    };

    const result = verifyTuttiScan({
      workOrderQr: mismatchedWo,
      parsedDisk: PARSED_DISK,
      dbWorkOrder: { ...VALID_DB_WORK_ORDER, lotNo: "9-999-99999999" },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("Lot number mismatch"))).toBe(true);
  });

  it("fails when work-order is not found in DB", () => {
    const result = verifyTuttiScan({
      workOrderQr: VALID_WORK_ORDER_QR,
      parsedDisk: PARSED_DISK,
      dbWorkOrder: null,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("not found in database"))).toBe(true);
  });

  it("fails when DB lotNo does not match work-order QR lotNo", () => {
    const dbWo: TuttiWorkOrder = {
      ...VALID_DB_WORK_ORDER,
      lotNo: "X-DIFFERENT-LOT",
    };

    const result = verifyTuttiScan({
      workOrderQr: VALID_WORK_ORDER_QR,
      parsedDisk: PARSED_DISK,
      dbWorkOrder: dbWo,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("DB lotNo"))).toBe(true);
  });

  it("fails when DB finishedBatchNo does not match work-order QR", () => {
    const dbWo: TuttiWorkOrder = {
      ...VALID_DB_WORK_ORDER,
      finishedBatchNo: "B99",
    };

    const result = verifyTuttiScan({
      workOrderQr: VALID_WORK_ORDER_QR,
      parsedDisk: PARSED_DISK,
      dbWorkOrder: dbWo,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("DB finishedBatchNo"))).toBe(true);
  });

  it("fails when disk contains Unknown Marker", () => {
    // Set marker index 0 to "999" which maps to "Unknown Marker"
    const qrWithUnknown = setMarkerNumber(TEST_QR, 0, "999");
    const parsedWithUnknown = parseQbiQr(qrWithUnknown);

    const dbWo: TuttiWorkOrder = {
      ...VALID_DB_WORK_ORDER,
      markerNames: ["Unknown Marker", "UPRO"],
    };

    const result = verifyTuttiScan({
      workOrderQr: VALID_WORK_ORDER_QR,
      parsedDisk: parsedWithUnknown,
      dbWorkOrder: dbWo,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("unknown marker"))).toBe(true);
  });

  it("fails when disk markers are not in DB work-order markerNames", () => {
    const dbWo: TuttiWorkOrder = {
      ...VALID_DB_WORK_ORDER,
      markerNames: ["UCRE"], // missing UPRO
    };

    const result = verifyTuttiScan({
      workOrderQr: VALID_WORK_ORDER_QR,
      parsedDisk: PARSED_DISK,
      dbWorkOrder: dbWo,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("not in work-order"))).toBe(true);
    expect(result.unknownMarkers).toContain("UPRO");
  });

  it("reports matched markers correctly when some match and some do not", () => {
    const dbWo: TuttiWorkOrder = {
      ...VALID_DB_WORK_ORDER,
      markerNames: ["UCRE"], // UPRO is not in DB
    };

    const result = verifyTuttiScan({
      workOrderQr: VALID_WORK_ORDER_QR,
      parsedDisk: PARSED_DISK,
      dbWorkOrder: dbWo,
    });

    expect(result.matchedMarkers).toEqual(["UCRE"]);
    expect(result.unknownMarkers).toEqual(["UPRO"]);
  });
});
