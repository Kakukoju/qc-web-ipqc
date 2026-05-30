import { describe, expect, it } from "vitest";

import { parseQbiQr } from "./qbiQrParser";

const EXPECTED_QR_LENGTH = 1173;
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
const COMPLETE_TEST_QR = TEST_QR.padEnd(EXPECTED_QR_LENGTH, "0");
const TOTAL_T4_QR =
  "002604230201061010100009999900000000000000020652523156500084500425728011954901023730329991022780201256300424773022881101089100426797022927601023730329991022780201000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

const setMarkerNumber = (rawQr: string, index: number, markerNumber: string) => {
  const markerStart = 41 + index * 122;

  return `${rawQr.slice(0, markerStart)}${markerNumber}${rawQr.slice(markerStart + 3)}`;
};

describe("parseQbiQr", () => {
  it("parses the sample Qbi QR string", () => {
    const result = parseQbiQr(TEST_QR);

    expect(result.ok).toBe(true);
    expect(result.panel.panelName).toBe("Core Chem 13");
    expect(result.production.productionDate).toBe("2025-05-16");
    expect(result.production.expirationDate).toBe("2026-05-15");
    expect(result.lot.discLotNo).toBe("0-001-25051600");
    expect(result.lot.reportLotNo).toBe("000125051600");
    expect(result.lot.whiteBoxLotNo).toBe("0-905100-25051600");
  });

  it("maps used markers to wells and species without fallback guessing", () => {
    const result = parseQbiQr(TEST_QR);
    const usedMarkers = result.markerWellMap.filter((marker) => marker.used);
    const marker034 = usedMarkers.find((marker) => marker.markerNumber === "034");

    expect(usedMarkers).toHaveLength(2);
    expect(usedMarkers[0]).toMatchObject({
      markerNumber: "033",
      markerName: "UCRE",
      wellNumber: "01",
      speciesName: "Dog",
      used: true,
    });
    expect(marker034).toMatchObject({
      markerNumber: "034",
      markerName: "UPRO",
      wellNumber: "04",
      speciesLine: "0",
      speciesName: "Control",
      used: true,
    });
  });

  it("uses disk-specific marker and panel maps", () => {
    const result = parseQbiQr(TOTAL_T4_QR);
    const usedMarkers = result.markerWellMap.filter((marker) => marker.used);

    expect(result.panel).toMatchObject({
      panelKey: "10-101",
      panelName: "Total T4",
      panelNameCn: "总甲状腺素",
      productCode: "905-205",
      onePieceBoxPanelType: "000101",
      discCategory: "Immuno-T",
      discCategoryZh: "免疫比濁",
      markerList: ["TT4"],
      labelVersion: "V1.0",
    });
    expect(usedMarkers).toHaveLength(1);
    expect(usedMarkers[0]).toMatchObject({
      markerNumber: "002",
      markerName: "TT4",
      wellNumber: "06",
      speciesName: "Control",
      used: true,
    });
  });

  it("stores extra tail and parses only the first 1173 digits when QR is longer than standard", () => {
    const result = parseQbiQr(`${COMPLETE_TEST_QR}98765`);

    expect(result.ok).toBe(true);
    expect(result.raw.inputLength).toBe(1178);
    expect(result.raw.parsedLength).toBe(1173);
    expect(result.raw.isExpectedLength).toBe(false);
    expect(result.raw.extraTail).toBe("98765");
    expect(result.warnings).toContain("QR length is longer than expected: 1178 / 1173");
  });

  it("warns when the sample QR is shorter than standard and parses available fields", () => {
    const result = parseQbiQr(TEST_QR);

    expect(result.ok).toBe(true);
    expect(result.raw.inputLength).toBe(TEST_QR.length);
    expect(result.raw.parsedLength).toBe(TEST_QR.length);
    expect(result.raw.isExpectedLength).toBe(false);
    expect(result.production.productionDate).toBe("2025-05-16");
    expect(result.warnings).toContain(
      `QR length is shorter than expected: ${TEST_QR.length} / 1173`,
    );
  });

  it("parses a synthetic QR with the expected complete length", () => {
    const result = parseQbiQr(COMPLETE_TEST_QR);

    expect(result.ok).toBe(true);
    expect(result.raw.inputLength).toBe(1173);
    expect(result.raw.parsedLength).toBe(1173);
    expect(result.raw.isExpectedLength).toBe(true);
    expect(result.warnings).not.toContain("QR length is shorter than expected: 1173 / 1173");
    expect(result.warnings).not.toContain("QR length is longer than expected: 1173 / 1173");
  });

  it("returns an error for non-numeric QR content", () => {
    const result = parseQbiQr(`${TEST_QR.slice(0, 20)}A${TEST_QR.slice(21)}`);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("QR contains non-numeric characters");
  });

  it("marks markerNumber 000 as unused", () => {
    const result = parseQbiQr(setMarkerNumber(TEST_QR, 0, "000"));

    expect(result.markerWellMap[0]).toMatchObject({
      markerNumber: "000",
      used: false,
    });
  });

  it("labels unknown used marker numbers", () => {
    const result = parseQbiQr(setMarkerNumber(TEST_QR, 0, "999"));

    expect(result.markerWellMap[0]).toMatchObject({
      markerNumber: "999",
      markerName: "Unknown Marker",
      used: true,
    });
  });
});
