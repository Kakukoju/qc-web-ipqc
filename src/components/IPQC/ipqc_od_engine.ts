export type MarkerName = string;

export interface MarkerConfig {
  colIndex: number; // 對應 CSV 欄位索引（0-based）
  name: MarkerName; // 例如 ALP / TBIL / DBIL / Ca / GLU / Na
  nm1: number; // marker_nm1
  nm2: number; // marker_nm2
  seq1: number; // marker_seq1
  seq2: number; // marker_seq2
  blank: number; // marker_Blank
  moving: number; // marker_mov
  secondWaveMultiplier: number; // marker_2_n
}

export interface EngineOptions {
  alpControl: boolean;
  saPanel: boolean;
}

export interface CsvMatrix {
  rows: Array<Array<number | string | null>>;
  fileName?: string;
}

export interface MarkerResult {
  marker: string;
  finalValue: number | null;
  blankValue: number | null;
  mainWaveValue: number | null;
  subWaveValue: number | null;
  channelLabel: string;
  seqLabel: string;
}

export interface SampleResult {
  sampleName: string;
  sampleTag?: string;
  cycle: number;
  markers: MarkerResult[];
  interferents?: Array<{
    panelIndex: number;
    lip: number;
    hem: number;
    ict: number;
  }>;
  sodiumChannels?: {
    ch2?: number;
    ch5?: number;
  };
}

interface OdPack {
  markerOD: number[][];
  blankOD: number[][];
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function getCell(matrix: CsvMatrix, row1Based: number, col1Based: number): number {
  const row = matrix.rows[row1Based - 1];
  if (!row) return 0;

  const value = row[col1Based - 1];
  if (value === null || value === undefined || value === "") return 0;

  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function detectCycle(matrix: CsvMatrix, saPanel: boolean): number {
  const saOffset = saPanel ? 34 : 0;

  for (let j = 3 + saOffset; j <= 85 + saOffset; j++) {
    const v = matrix.rows[j - 1]?.[0];
    if (v === "" || v === null || v === undefined) {
      return j + 1 - saOffset;
    }
  }

  throw new Error("Unable to detect cycle from CSV first column.");
}

export function extractSampleName(fileName?: string): string {
  if (!fileName) return "unknown";
  return fileName.replace(/\.[^.]+$/, "");
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function readWeighted9(
  matrix: CsvMatrix,
  cycle: number,
  nm: number,
  saOffset: number,
  col: number
): number {
  const values: number[] = [];

  for (let k = 0; k <= 4; k++) {
    values.push(getCell(matrix, cycle * nm - 2 - k + saOffset, col));
  }
  for (let k = 1; k <= 3; k++) {
    values.push(getCell(matrix, cycle * nm - 2 - k + saOffset, col));
  }

  values.push(getCell(matrix, cycle * nm - 2 - 2 + saOffset, col));
  return average(values);
}

function read3FromEnd(
  matrix: CsvMatrix,
  cycle: number,
  nm: number,
  saOffset: number,
  col: number
): number {
  const values: number[] = [];

  for (let k = 0; k <= 2; k++) {
    values.push(getCell(matrix, cycle * nm - 2 - k + saOffset, col));
  }

  return average(values);
}

function read3FromSeq(
  matrix: CsvMatrix,
  cycle: number,
  nm: number,
  seq: number,
  saOffset: number,
  col: number
): number {
  const values: number[] = [];

  for (let k = 0; k <= 2; k++) {
    values.push(getCell(matrix, cycle * (nm - 1) + k + 2 + seq + saOffset, col));
  }

  return average(values);
}

function readMovingAverage(
  matrix: CsvMatrix,
  cycle: number,
  nm: number,
  seq: number,
  moving: number,
  saOffset: number,
  col: number
): number {
  const values: number[] = [];

  if (seq >= 75 && seq <= 98) {
    for (let k = 0; k <= moving + 1; k++) {
      values.push(getCell(matrix, cycle * nm + k - 3 - moving + saOffset, col));
    }
    for (let k = 1; k <= moving; k++) {
      values.push(getCell(matrix, cycle * nm + k - 3 - moving + saOffset, col));
    }
    for (let k = 2; k <= moving - 1; k++) {
      values.push(getCell(matrix, cycle * nm + k - 3 - moving + saOffset, col));
    }
  } else {
    for (let k = 0; k <= moving + 1; k++) {
      values.push(getCell(matrix, cycle * (nm - 1) + 2 + k + seq + saOffset, col));
    }
    for (let k = 1; k <= moving; k++) {
      values.push(getCell(matrix, cycle * (nm - 1) + 2 + k + seq + saOffset, col));
    }
    for (let k = 2; k <= moving - 1; k++) {
      values.push(getCell(matrix, cycle * (nm - 1) + 2 + k + seq + saOffset, col));
    }
  }

  return values.length ? values.reduce((a, b) => a + b, 0) / (3 * moving) : 0;
}

function readByRule(
  matrix: CsvMatrix,
  cycle: number,
  nm: number,
  seq: number,
  moving: number,
  saOffset: number,
  col: number
): number {
  if (!nm || !seq) return 0;

  if (moving > 0) {
    return readMovingAverage(matrix, cycle, nm, seq, moving, saOffset, col);
  }

  if (seq === 99) return readWeighted9(matrix, cycle, nm, saOffset, col);
  if (seq >= 75 && seq <= 98) return read3FromEnd(matrix, cycle, nm, saOffset, col);

  return read3FromSeq(matrix, cycle, nm, seq, saOffset, col);
}

function initOdPack(): OdPack {
  return {
    markerOD: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    blankOD: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
  };
}

function calcAlpLike(
  matrix: CsvMatrix,
  cfg: MarkerConfig,
  cycle: number,
  options: EngineOptions,
  saOffset: number
): { result: MarkerResult; sampleTag: string } {
  const od = initOdPack();
  const col = cfg.colIndex + 1;

  od.markerOD[1][1] = read3FromEnd(matrix, cycle, cfg.nm1, saOffset, col);
  od.markerOD[2][1] = read3FromEnd(matrix, cycle, cfg.nm2, saOffset, col);
  od.markerOD[1][2] = read3FromSeq(matrix, cycle, cfg.nm1, 1, saOffset, col);
  od.markerOD[2][2] = read3FromSeq(matrix, cycle, cfg.nm2, 1, saOffset, col);

  const delta =
    (od.markerOD[1][1] - od.markerOD[1][2]) -
    (od.markerOD[2][1] - od.markerOD[2][2]);

  let tag = "-ALPL";

  if (delta > 0.4 || options.alpControl) {
    tag = "-ALP";
    od.markerOD[1][1] = read3FromSeq(matrix, cycle, cfg.nm1, 20, saOffset, col) * 3.85;
    od.markerOD[2][1] = read3FromSeq(matrix, cycle, cfg.nm2, 20, saOffset, col) * 3.85;
    od.markerOD[1][2] *= 3.85;
    od.markerOD[2][2] *= 3.85;
  }

  return {
    sampleTag: tag,
    result: {
      marker: cfg.name,
      finalValue: round(
        (od.markerOD[1][1] - od.markerOD[1][2]) -
          (od.markerOD[2][1] - od.markerOD[2][2])
      ),
      blankValue: 0,
      mainWaveValue: round(od.markerOD[1][1] - od.markerOD[1][2]),
      subWaveValue: round(od.markerOD[2][1] - od.markerOD[2][2]),
      channelLabel: `CH${cfg.nm1}-CH${cfg.nm2}`,
      seqLabel: `(${cfg.seq1}-${cfg.seq2})`,
    },
  };
}

function calcTbilDbil(
  matrix: CsvMatrix,
  cfg: MarkerConfig,
  cycle: number,
  options: EngineOptions,
  saOffset: number
): MarkerResult {
  const blankIndex = options.saPanel ? cfg.colIndex - 1 : 2;
  const col = cfg.colIndex + 1;
  const blankCol = blankIndex + 1;

  const sum1 = readWeighted9(matrix, cycle, cfg.nm1, saOffset, col);
  const sum2 = readWeighted9(matrix, cycle, cfg.nm2, saOffset, col);

  const blank1 = average([
    getCell(matrix, cycle * (cfg.nm1 - 1) + 3 + saOffset, blankCol),
    getCell(matrix, cycle * (cfg.nm1 - 1) + 4 + saOffset, blankCol),
    getCell(matrix, cycle * (cfg.nm1 - 1) + 5 + saOffset, blankCol),
  ]);

  const blank2 = average([
    getCell(matrix, cycle * (cfg.nm2 - 1) + 3 + saOffset, blankCol),
    getCell(matrix, cycle * (cfg.nm2 - 1) + 4 + saOffset, blankCol),
    getCell(matrix, cycle * (cfg.nm2 - 1) + 5 + saOffset, blankCol),
  ]);

  return {
    marker: cfg.name,
    finalValue: round(blank1 - blank2 + 0.1 - sum1 + sum2),
    blankValue: round(blank1 - blank2),
    mainWaveValue: round(sum1),
    subWaveValue: round(sum2),
    channelLabel: `CH${cfg.nm1}-CH${cfg.nm2}`,
    seqLabel: `(${cfg.seq1}-${cfg.seq2})`,
  };
}

function calcRegular(
  matrix: CsvMatrix,
  cfg: MarkerConfig,
  options: EngineOptions,
  cycle: number,
  saOffset: number
): MarkerResult {
  const od = initOdPack();
  const dataCol = cfg.colIndex + 1;
  const blankCol = cfg.blank ? cfg.blank + 1 : 0;

  od.markerOD[1][1] = readByRule(
    matrix,
    cycle,
    cfg.nm1,
    cfg.seq1,
    cfg.moving,
    saOffset,
    dataCol
  );
  od.markerOD[2][1] = cfg.nm2
    ? readByRule(matrix, cycle, cfg.nm2, cfg.seq1, cfg.moving, saOffset, dataCol)
    : 0;
  od.markerOD[1][2] = cfg.seq2
    ? readByRule(matrix, cycle, cfg.nm1, cfg.seq2, cfg.moving, saOffset, dataCol)
    : 0;
  od.markerOD[2][2] =
    cfg.nm2 && cfg.seq2
      ? readByRule(matrix, cycle, cfg.nm2, cfg.seq2, cfg.moving, saOffset, dataCol)
      : 0;

  if (blankCol) {
    od.blankOD[1][1] = readByRule(
      matrix,
      cycle,
      cfg.nm1,
      cfg.seq1,
      cfg.moving,
      saOffset,
      blankCol
    );
    od.blankOD[2][1] = cfg.nm2
      ? readByRule(matrix, cycle, cfg.nm2, cfg.seq1, cfg.moving, saOffset, blankCol)
      : 0;
    od.blankOD[1][2] = cfg.seq2
      ? readByRule(matrix, cycle, cfg.nm1, cfg.seq2, cfg.moving, saOffset, blankCol)
      : 0;
    od.blankOD[2][2] =
      cfg.nm2 && cfg.seq2
        ? readByRule(matrix, cycle, cfg.nm2, cfg.seq2, cfg.moving, saOffset, blankCol)
        : 0;
  }

  if ((cfg.name === "Ca" || cfg.name === "GLU") && options.saPanel) {
    const finalValue = round(od.markerOD[1][1] - (od.blankOD[1][1] / 2 + 0.05));

    return {
      marker: cfg.name,
      finalValue,
      blankValue: round(od.blankOD[1][1] / 2 + 0.05),
      mainWaveValue: round(od.markerOD[1][1]),
      subWaveValue: null,
      channelLabel: cfg.nm2 ? `CH${cfg.nm1}-CH${cfg.nm2}` : `CH${cfg.nm1}`,
      seqLabel: `(${cfg.seq1}-${cfg.seq2})`,
    };
  }

  const blankDelta =
    od.blankOD[1][1] - od.blankOD[1][2] - od.blankOD[2][1] + od.blankOD[2][2];
  const mainDelta = od.markerOD[1][1] - od.markerOD[1][2];
  const subDelta = od.markerOD[2][1] - od.markerOD[2][2];

  let finalValue: number;

  if (cfg.secondWaveMultiplier > 0) {
    finalValue = round(
      mainDelta -
        subDelta * cfg.secondWaveMultiplier -
        (od.blankOD[1][1] -
          od.blankOD[1][2] -
          od.blankOD[2][1] * cfg.secondWaveMultiplier +
          od.blankOD[2][2] * cfg.secondWaveMultiplier)
    );
  } else {
    finalValue = round(mainDelta - subDelta - blankDelta);
  }

  return {
    marker: cfg.name,
    finalValue,
    blankValue: round(blankDelta),
    mainWaveValue: round(mainDelta),
    subWaveValue: round(subDelta),
    channelLabel: cfg.nm2 ? `CH${cfg.nm1}-CH${cfg.nm2}` : `CH${cfg.nm1}`,
    seqLabel: `(${cfg.seq1}-${cfg.seq2})`,
  };
}

function calcInterferents(
  matrix: CsvMatrix,
  cycle: number,
  options: EngineOptions
): SampleResult["interferents"] {
  if (!options.saPanel) {
    const lip = average([
      getCell(matrix, cycle * 5 + 3, 3),
      getCell(matrix, cycle * 5 + 4, 3),
      getCell(matrix, cycle * 5 + 5, 3),
    ]);

    const od340 = average([
      getCell(matrix, 3, 3),
      getCell(matrix, 4, 3),
      getCell(matrix, 5, 3),
    ]);

    const od405 = average([
      getCell(matrix, cycle * 1 + 3, 3),
      getCell(matrix, cycle * 1 + 4, 3),
      getCell(matrix, cycle * 1 + 5, 3),
    ]);

    const od450 = average([
      getCell(matrix, cycle * 2 + 3, 3),
      getCell(matrix, cycle * 2 + 4, 3),
      getCell(matrix, cycle * 2 + 5, 3),
    ]);

    return [
      {
        panelIndex: 0,
        lip: Math.round(lip * 1000),
        hem: Math.round(od405 * 110 - od340 * 61 - od450 * 49),
        ict: Math.round(od450 * 100 - od340 * 46 - od405 * 6),
      },
    ];
  }

  const result: NonNullable<SampleResult["interferents"]> = [];

  for (let saN = 0; saN < 2; saN++) {
    const baseCol = 5 + saN * 10;

    let lip = average([
      getCell(matrix, cycle * 5 + 3 + 34, baseCol),
      getCell(matrix, cycle * 5 + 4 + 34, baseCol),
      getCell(matrix, cycle * 5 + 5 + 34, baseCol),
    ]);

    let od340 = average([
      getCell(matrix, 3 + 34, baseCol),
      getCell(matrix, 4 + 34, baseCol),
      getCell(matrix, 5 + 34, baseCol),
    ]);

    let od405 = average([
      getCell(matrix, cycle * 1 + 3 + 34, baseCol),
      getCell(matrix, cycle * 1 + 4 + 34, baseCol),
      getCell(matrix, cycle * 1 + 5 + 34, baseCol),
    ]);

    let od450 = average([
      getCell(matrix, cycle * 2 + 3 + 34, baseCol),
      getCell(matrix, cycle * 2 + 4 + 34, baseCol),
      getCell(matrix, cycle * 2 + 5 + 34, baseCol),
    ]);

    od340 = od340 * 1.435 - 0.15;
    od405 = od405 * 2.07 - 0.285;
    od450 = od450 * 2.07 - 0.195;
    lip = lip * 1.41 - 0.084;

    result.push({
      panelIndex: saN,
      lip: round(lip * 1000, 1),
      hem: round(od405 * 110 - od340 * 61 - od450 * 49, 1),
      ict: round(od450 * 100 - od340 * 46 - od405 * 6, 1),
    });
  }

  return result;
}

export function calculateSample(
  matrix: CsvMatrix,
  configs: MarkerConfig[],
  options: EngineOptions
): SampleResult {
  const cycle = detectCycle(matrix, options.saPanel);
  const saOffset = options.saPanel ? 34 : 0;
  const sampleName = extractSampleName(matrix.fileName);

  const markers: MarkerResult[] = [];
  let sampleTag = "";
  let sodiumChannels: SampleResult["sodiumChannels"] = undefined;

  for (const cfg of configs) {
    if (!cfg.name) continue;

    if (cfg.name === "ALP" || cfg.name === "ALPL") {
      const { result, sampleTag: tag } = calcAlpLike(matrix, cfg, cycle, options, saOffset);
      markers.push(result);
      sampleTag = tag;
      continue;
    }

    if (cfg.name === "TBIL" || cfg.name === "DBIL") {
      markers.push(calcTbilDbil(matrix, cfg, cycle, options, saOffset));
      continue;
    }

    const regular = calcRegular(matrix, cfg, options, cycle, saOffset);
    markers.push(regular);

    if (cfg.name === "Na") {
      sodiumChannels = {
        ch2: regular.mainWaveValue ?? undefined,
        ch5: regular.subWaveValue ?? undefined,
      };
    }
  }

  return {
    sampleName,
    sampleTag,
    cycle,
    markers,
    interferents: calcInterferents(matrix, cycle, options),
    sodiumChannels,
  };
}

export function calculateBatch(
  matrices: CsvMatrix[],
  configs: MarkerConfig[],
  options: EngineOptions
): SampleResult[] {
  return matrices.map((m) => calculateSample(m, configs, options));
}