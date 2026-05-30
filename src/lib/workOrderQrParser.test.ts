import { describe, expect, it } from "vitest";

import { parseWorkOrderQr } from "./workOrderQrParser";

describe("parseWorkOrderQr", () => {
  it("parses a valid work-order QR", () => {
    const result = parseWorkOrderQr("WO|WO-2025-001234|0-001-25051600|B01");

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.workOrderNumber).toBe("WO-2025-001234");
    expect(result.lotNo).toBe("0-001-25051600");
    expect(result.finishedBatchNo).toBe("B01");
  });

  it("returns error for empty input", () => {
    const result = parseWorkOrderQr("");

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Work-order QR is empty");
  });

  it("returns error for whitespace-only input", () => {
    const result = parseWorkOrderQr("   ");

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Work-order QR is empty");
  });

  it("returns error for invalid prefix", () => {
    const result = parseWorkOrderQr("XX|WO-2025-001234|0-001-25051600|B01");

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('Invalid work-order QR prefix');
    expect(result.errors[0]).toContain('"XX"');
  });

  it("returns error when segment count is insufficient", () => {
    const result = parseWorkOrderQr("WO|WO-2025-001234");

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("2 segments");
    expect(result.workOrderNumber).toBe("WO-2025-001234");
  });

  it("returns error when workOrderNumber is empty", () => {
    const result = parseWorkOrderQr("WO||0-001-25051600|B01");

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Work-order number is empty");
  });

  it("returns error when lotNo is empty", () => {
    const result = parseWorkOrderQr("WO|WO-2025-001234||B01");

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Lot number is empty");
  });

  it("returns error when finishedBatchNo is empty", () => {
    const result = parseWorkOrderQr("WO|WO-2025-001234|0-001-25051600|");

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Finished batch number is empty");
  });

  it("trims whitespace from input", () => {
    const result = parseWorkOrderQr("  WO|WO-2025-001234|0-001-25051600|B01  ");

    expect(result.ok).toBe(true);
    expect(result.workOrderNumber).toBe("WO-2025-001234");
  });

  it("handles extra pipe segments gracefully", () => {
    const result = parseWorkOrderQr("WO|WO-2025-001234|0-001-25051600|B01|extra");

    expect(result.ok).toBe(true);
    expect(result.workOrderNumber).toBe("WO-2025-001234");
    expect(result.lotNo).toBe("0-001-25051600");
    expect(result.finishedBatchNo).toBe("B01");
  });
});
