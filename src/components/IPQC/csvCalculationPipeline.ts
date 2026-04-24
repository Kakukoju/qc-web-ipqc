import Papa from "papaparse";
import type {
  CsvMatrix,
  EngineOptions,
  SampleResult,
} from "./ipqc_od_engine";
import { calculateSample } from "./ipqc_od_engine";
import type { MarkerRuleBook } from "./markerRuleBook";
import { buildSingleMarkerConfigsFromCsvMatrix } from "./markerRuleBook";

export type TargetMode =
  | "L1-OD"
  | "L2-OD"
  | "N1-OD"
  | "N2-OD";

export interface ParsedFileMeta {
  fileName: string;
  date: string;
  testNumber: string;
}

export interface ComputedTableRow {
  fileName: string;
  date: string;
  testNumber: string;
  sampleName: string;
  markerNames: string[];
  odValues: Array<number | string>;
}

/**
 * 檔名格式：
 * ElisaOD_20260408_10_57_46-ID-080420261043.csv
 *
 * 取出：
 * - date = 20260408
 * - testNumber = 080420261043
 */
export function parseElisaFileName(fileName: string): ParsedFileMeta {
  const m = fileName.match(/^ElisaOD_(\d{8})_.*-ID-(\d{12})\.csv$/i);

  if (!m) {
    throw new Error(`檔名格式不符: ${fileName}`);
  }

  return {
    fileName,
    date: m[1],
    testNumber: m[2],
  };
}

/**
 * CSV -> CsvMatrix
 * 保留原始格狀資料
 */
export async function csvFileToMatrix(file: File): Promise<CsvMatrix> {
  const text = await file.text();

  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: false,
  });

  const rows = (parsed.data || []).map((row) =>
    row.map((v) => {
      const s = String(v ?? "").trim();

      if (s === "") return "";

      const n = Number(s);
      return Number.isFinite(n) ? n : s;
    })
  );

  return {
    rows,
    fileName: file.name,
  };
}

/**
 * 依 mode 從 SampleResult 取對應 OD
 *
 * 目前規則：
 * - L1-OD / N1-OD -> mainWaveValue
 * - L2-OD / N2-OD -> subWaveValue
 */
function pickOdValues(
  sample: SampleResult,
  mode: TargetMode
): Array<number | string> {
  switch (mode) {
    case "L1-OD":
    case "N1-OD":
      return sample.markers.map((m) => m.mainWaveValue ?? "");

    case "L2-OD":
    case "N2-OD":
      return sample.markers.map((m) => m.subWaveValue ?? "");

    default:
      return [];
  }
}

/**
 * 每個 CSV -> 一筆
 *
 * marker 由使用者選，不從 CSV 猜
 */
export async function calculateFilesToRows(
  files: File[],
  ruleBook: MarkerRuleBook,
  options: EngineOptions,
  mode: TargetMode,
  selectedMarker: string
): Promise<ComputedTableRow[]> {
  const result: ComputedTableRow[] = [];

  for (const file of files) {
    const meta = parseElisaFileName(file.name);
    const matrix = await csvFileToMatrix(file);

    // 依使用者選的 marker + CSV row2 well 建立 configs
    const markerConfigs = buildSingleMarkerConfigsFromCsvMatrix(
      matrix,
      ruleBook,
      selectedMarker
    );

    const sample = calculateSample(matrix, markerConfigs, options);

    result.push({
      fileName: meta.fileName,
      date: meta.date,
      testNumber: meta.testNumber,
      sampleName: sample.sampleName,
      markerNames: sample.markers.map((m) => m.marker),
      odValues: pickOdValues(sample, mode),
    });
  }

  return result;
}