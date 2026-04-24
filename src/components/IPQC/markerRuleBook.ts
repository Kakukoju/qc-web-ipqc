import * as XLSX from "xlsx";
import type { CsvMatrix, MarkerConfig } from "./ipqc_od_engine";

export interface RuleRow {
  marker: string;
  blank: number;
  nm1: number;
  nm2: number;
  seq1: number;
  seq2: number;
  moving: number;
  secondWaveMultiplier: number;
}

export interface MarkerRuleBook {
  rulesByMarker: Record<string, RuleRow>;
  allowedWellsByMarker: Record<string, string[]>;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeMarkerName(input: string): string {
  const raw = String(input || "").trim().toUpperCase();

  const aliasMap: Record<string, string> = {
    CK: "CPK",
    CPK: "CPK",
    TASTI: "ASTI",
    ASTI: "ASTI",
    TCREA: "CREA",
    CREA: "CREA",
    CRE: "CRE",
    TGLU: "GLU",
    GLU: "GLU",
  };

  return aliasMap[raw] || raw;
}

function findHeaderIndex(headerRow: unknown[], candidates: string[]): number {
  const normalized = headerRow.map((v) => String(v ?? "").trim().toUpperCase());

  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate.toUpperCase());
    if (idx >= 0) return idx;
  }

  return -1;
}

export async function loadMarkerRuleBookFromExcel(
  file: File
): Promise<MarkerRuleBook> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });

  const ruleSheet = wb.Sheets["calculation_rules"];
  const wellSheet = wb.Sheets["well_position"];

  if (!ruleSheet) {
    throw new Error("找不到 sheet: calculation_rules");
  }
  if (!wellSheet) {
    throw new Error("找不到 sheet: well_position");
  }

  const rulesByMarker: Record<string, RuleRow> = {};
  const allowedWellsByMarker: Record<string, string[]> = {};

  // -----------------------------
  // calculation_rules
  // -----------------------------
  const ruleRows: any[][] = XLSX.utils.sheet_to_json(ruleSheet, {
    header: 1,
    raw: true,
  });

  if (!ruleRows.length) {
    throw new Error("calculation_rules 為空");
  }

  const header = ruleRows[0] || [];

  const markerIdx = findHeaderIndex(header, ["MARKER", "NAME"]);
  const blankIdx = findHeaderIndex(header, ["BLANK WELL", "BLANK"]);
  const nm1Idx = findHeaderIndex(header, ["主波 (CH)", "NM1", "MAIN CH"]);
  const nm2Idx = findHeaderIndex(header, ["副波 (CH)", "NM2", "SUB CH"]);
  const seq1Idx = findHeaderIndex(header, ["SEQ 1 (圈數)", "SEQ1"]);
  const seq2Idx = findHeaderIndex(header, ["SEQ 2 (圈數)", "SEQ2"]);
  const movingIdx = findHeaderIndex(header, ["MOVING", "MOV"]);
  const secondWaveMultiplierIdx = findHeaderIndex(header, ["扣N倍副波", "SECONDWAVEMULTIPLIER", "2_N"]);

  if (markerIdx < 0) {
    throw new Error("calculation_rules 找不到 Marker 欄");
  }

  for (let i = 1; i < ruleRows.length; i++) {
    const row = ruleRows[i];
    if (!row) continue;

    const markerRaw = row[markerIdx];
    if (!markerRaw) continue;

    const marker = normalizeMarkerName(String(markerRaw));

    rulesByMarker[marker] = {
      marker,
      blank: blankIdx >= 0 ? num(row[blankIdx]) : 0,
      nm1: nm1Idx >= 0 ? num(row[nm1Idx]) : 0,
      nm2: nm2Idx >= 0 ? num(row[nm2Idx]) : 0,
      seq1: seq1Idx >= 0 ? num(row[seq1Idx]) : 0,
      seq2: seq2Idx >= 0 ? num(row[seq2Idx]) : 0,
      moving: movingIdx >= 0 ? num(row[movingIdx]) : 0,
      secondWaveMultiplier:
        secondWaveMultiplierIdx >= 0 ? num(row[secondWaveMultiplierIdx]) : 0,
    };
  }

  // -----------------------------
  // well_position
  // 假設：
  // 第1列 = well header
  // 下面 cell = marker 名稱
  // -----------------------------
  const wellRows: any[][] = XLSX.utils.sheet_to_json(wellSheet, {
    header: 1,
    raw: true,
  });

  if (wellRows.length > 0) {
    const wellHeaderRow = wellRows[0] || [];

    for (let r = 1; r < wellRows.length; r++) {
      const row = wellRows[r];
      if (!row) continue;

      for (let c = 0; c < row.length; c++) {
        const markerRaw = row[c];
        const wellRaw = wellHeaderRow[c];

        if (!markerRaw || !wellRaw) continue;

        const marker = normalizeMarkerName(String(markerRaw));
        const well = String(wellRaw).trim();

        if (!allowedWellsByMarker[marker]) {
          allowedWellsByMarker[marker] = [];
        }

        if (!allowedWellsByMarker[marker].includes(well)) {
          allowedWellsByMarker[marker].push(well);
        }
      }
    }
  }

  return {
    rulesByMarker,
    allowedWellsByMarker,
  };
}

function normalizeWellName(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/**
 * 轉置格式 rulebook（單一 sheet）
 *
 * row 0 = well header:  null, "well 2", "well 3", ...
 * row 1 = marker:       "marker", null, null, "BUN", "ASTi", ...
 * row 2 = blank well
 * row 3 = 主波 (CH)
 * row 4 = 副波 (CH)
 * row 5 = Seq 1 (圈數)
 * row 6 = Seq 2 (圈數)
 * row 7 = moving
 * row 8 = 扣n倍副波
 */
export function loadTransposedRuleBook(
  rows: any[][]
): { configs: MarkerConfig[]; ruleBook: MarkerRuleBook } {
  const wellHeader = rows[0] || [];

  const findRow = (candidates: string[]): any[] | undefined => {
    for (const row of rows) {
      const label = String(row?.[0] ?? "").trim().toUpperCase();
      for (const c of candidates) {
        if (label === c.toUpperCase()) return row;
      }
    }
    return undefined;
  };

  const markerRow = findRow(["MARKER"]);
  const blankRow = findRow(["BLANK WELL", "BLANK"]);
  const nm1Row = findRow(["主波 (CH)", "NM1", "MAIN CH"]);
  const nm2Row = findRow(["副波 (CH)", "NM2", "SUB CH"]);
  const seq1Row = findRow(["SEQ 1 (圈數)", "SEQ1"]);
  const seq2Row = findRow(["SEQ 2 (圈數)", "SEQ2"]);
  const movingRow = findRow(["MOVING"]);
  const swmRow = findRow(["扣N倍副波", "SECONDWAVEMULTIPLIER", "2_N"]);

  if (!markerRow) throw new Error("轉置 rulebook 找不到 marker 列");

  const configs: MarkerConfig[] = [];
  const rulesByMarker: Record<string, RuleRow> = {};
  const allowedWellsByMarker: Record<string, string[]> = {};

  for (let col = 1; col < wellHeader.length; col++) {
    const wellRaw = String(wellHeader[col] ?? "").trim();
    if (!wellRaw) continue;

    const markerRaw = markerRow[col];
    if (!markerRaw || markerRaw === 0) continue;

    const marker = normalizeMarkerName(String(markerRaw));
    const blank = num(blankRow?.[col]);
    const nm1 = num(nm1Row?.[col]);
    const nm2 = num(nm2Row?.[col]);
    const seq1 = num(seq1Row?.[col]);
    const seq2 = num(seq2Row?.[col]);
    const moving = num(movingRow?.[col]);
    const secondWaveMultiplier = num(swmRow?.[col]);

    // well number: "well 3" → 3, 用 0-based colIndex = wellNumber - 1
    const wellNum = parseInt(wellRaw.replace(/\D/g, ""), 10);
    const colIndex = Number.isFinite(wellNum) ? wellNum - 1 : col;

    configs.push({
      colIndex,
      name: marker,
      nm1,
      nm2,
      seq1,
      seq2,
      blank,
      moving,
      secondWaveMultiplier,
    });

    if (!rulesByMarker[marker]) {
      rulesByMarker[marker] = { marker, blank, nm1, nm2, seq1, seq2, moving, secondWaveMultiplier };
    }
    if (!allowedWellsByMarker[marker]) allowedWellsByMarker[marker] = [];
    if (!allowedWellsByMarker[marker].includes(wellRaw)) {
      allowedWellsByMarker[marker].push(wellRaw);
    }
  }

  return { configs, ruleBook: { rulesByMarker, allowedWellsByMarker } };
}

export async function loadTransposedRuleBookFromExcel(
  file: File
): Promise<{ configs: MarkerConfig[]; ruleBook: MarkerRuleBook }> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`找不到 sheet: ${sheetName}`);
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  return loadTransposedRuleBook(rows);
}

/**
 * Well 配置描述
 */
export interface WellAssignment {
  wellNumber: number;
  marker: string; // "blank" = 跳過不計算 | marker name
}

/**
 * 從 well 配置 + beadscal_rules DB 自動建立 MarkerConfig[]
 * blank 完全以 DB 規則為準
 */
export function buildConfigsFromWellAssignments(
  assignments: WellAssignment[],
  rulesDb: Record<string, RuleRow>
): MarkerConfig[] {
  const configs: MarkerConfig[] = [];

  for (const a of assignments) {
    const normalized = normalizeMarkerName(a.marker);
    if (normalized === "BLANK") continue;

    const rule = rulesDb[normalized];
    if (!rule) {
      throw new Error(`beadscal_rules 找不到 marker: ${a.marker} (normalized: ${normalized})`);
    }

    configs.push({
      colIndex: a.wellNumber - 1,
      name: normalized,
      nm1: rule.nm1,
      nm2: rule.nm2,
      seq1: rule.seq1,
      seq2: rule.seq2,
      blank: rule.blank,
      moving: rule.moving,
      secondWaveMultiplier: rule.secondWaveMultiplier,
    });
  }

  return configs;
}

/**
 * 便利函式：用簡易語法描述 well 配置
 *
 * 例如：
 *   parseWellLayout("W2=blank, W3~W9=ALB")
 *   parseWellLayout("W2=blank, W3-W9=ALB, W10=BUN")
 */
export function parseWellLayout(layout: string): WellAssignment[] {
  const assignments: WellAssignment[] = [];
  const parts = layout.split(/[,;]/).map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    const m = part.match(/^W(\d+)(?:\s*[~\-]\s*W(\d+))?\s*=\s*(.+)$/i);
    if (!m) throw new Error(`無法解析 well 配置: "${part}"`);

    const from = parseInt(m[1], 10);
    const to = m[2] ? parseInt(m[2], 10) : from;
    const marker = m[3].trim();

    for (let w = from; w <= to; w++) {
      assignments.push({ wellNumber: w, marker });
    }
  }

  return assignments;
}

export async function loadMarkerRuleBookFromUrl(
  url: string
): Promise<MarkerRuleBook> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const blob = await res.blob();
  const file = new File([blob], url.split("/").pop() || "rulebook.xlsx");
  return loadMarkerRuleBookFromExcel(file);
}

export function buildSingleMarkerConfigsFromCsvMatrix(
  matrix: CsvMatrix,
  ruleBook: MarkerRuleBook,
  markerName: string
): MarkerConfig[] {
  const configs: MarkerConfig[] = [];
  const marker = normalizeMarkerName(markerName);

  const rule = ruleBook.rulesByMarker[marker];
  if (!rule) {
    throw new Error(`calculation_rules 找不到 marker: ${markerName}`);
  }

  // CSV row2 = well
  const wellHeaderRow = matrix.rows[1] || [];

  for (let col0 = 0; col0 < wellHeaderRow.length; col0++) {
    const wellRaw = String(wellHeaderRow[col0] ?? "").trim();
    const well = normalizeWellName(wellRaw);

    if (!well) continue;

    configs.push({
      colIndex: col0, // 0-based；engine 內部會 +1
      name: marker,
      nm1: rule.nm1,
      nm2: rule.nm2,
      seq1: rule.seq1,
      seq2: rule.seq2,
      blank: rule.blank,
      moving: rule.moving,
      secondWaveMultiplier: rule.secondWaveMultiplier,
    });
  }

  return configs;
}