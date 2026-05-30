import { MARKER_MAP_BY_DISC_TYPE, SPECIES_LINE_MAP } from "../constants/markerMap";
import { PANEL_MAP } from "../constants/panelMap";

const STANDARD_QR_LENGTH = 1173;
const REAGENT_START = 41;
const MARKER_BLOCK_LENGTH = 122;
const MARKER_COUNT = 8;

export type ParsedQbiQr = {
  ok: boolean;
  errors: string[];
  warnings: string[];

  raw: {
    inputLength: number;
    parsedLength: number;
    isExpectedLength: boolean;
    extraTail?: string;
  };

  production: {
    formatVersion: string;
    year: string;
    month: string;
    day: string;
    productionDate: string;
    expirationDate: string;
    factoryNumber: string;
    lineNumber: string;
    batchNumber: string;
    validMonth: string;
    discType: string;
    subPanelType: string;
    salesCode: string;
    brandCode: string;
    humanVet: string;
    serialNumber: string;
    appCode: string;
    lotTraceNo: string;
    reserved: string;
  };

  panel: {
    panelKey: string;
    panelName: string;
    panelNameCn: string;
    productCode: string | null;
    onePieceBoxPanelType: string | null;
    subPanelType: string;
    discCategory: string;
    discCategoryZh: string;
    markerList: string[];
    labelVersion: string | null;
  };

  lot: {
    discLotNo: string;
    reportLotNo: string;
    whiteBoxLotNo: string | null;
  };

  markerWellMap: Array<{
    index: number;
    markerNumber: string;
    markerName: string;
    wellNumber: string;
    speciesLine: string;
    speciesName: string;
    used: boolean;
  }>;
};

const formatDate = (date: Date) => date.toISOString().slice(0, 10);

const isValidDateParts = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const buildDates = (
  yearText: string,
  monthText: string,
  dayText: string,
  validMonthText: string,
  errors: string[],
) => {
  if (
    yearText.length !== 2 ||
    monthText.length !== 2 ||
    dayText.length !== 2 ||
    validMonthText.length !== 2
  ) {
    return {
      productionDate: "",
      expirationDate: "",
    };
  }

  const fullYear = Number(`20${yearText}`);
  const month = Number(monthText);
  const day = Number(dayText);
  const validMonth = Number(validMonthText);

  if (
    !Number.isInteger(fullYear) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !isValidDateParts(fullYear, month, day)
  ) {
    errors.push(`Invalid production date: 20${yearText}-${monthText}-${dayText}`);

    return {
      productionDate: "",
      expirationDate: "",
    };
  }

  if (!Number.isInteger(validMonth) || validMonth < 0) {
    errors.push(`Invalid validMonth: ${validMonthText}`);

    return {
      productionDate: formatDate(new Date(Date.UTC(fullYear, month - 1, day))),
      expirationDate: "",
    };
  }

  const productionDate = new Date(Date.UTC(fullYear, month - 1, day));
  const expirationDate = new Date(Date.UTC(fullYear, month - 1 + validMonth, day));
  expirationDate.setUTCDate(expirationDate.getUTCDate() - 1);

  return {
    productionDate: formatDate(productionDate),
    expirationDate: formatDate(expirationDate),
  };
};

export function parseQbiQr(rawQr: string): ParsedQbiQr {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsedQr = rawQr.slice(0, STANDARD_QR_LENGTH);
  const raw: ParsedQbiQr["raw"] = {
    inputLength: rawQr.length,
    parsedLength: parsedQr.length,
    isExpectedLength: rawQr.length === STANDARD_QR_LENGTH,
  };

  if (rawQr.length > STANDARD_QR_LENGTH) {
    raw.extraTail = rawQr.slice(STANDARD_QR_LENGTH);
    warnings.push(`QR length is longer than expected: ${rawQr.length} / ${STANDARD_QR_LENGTH}`);
  }

  if (rawQr.length < STANDARD_QR_LENGTH) {
    warnings.push(`QR length is shorter than expected: ${rawQr.length} / ${STANDARD_QR_LENGTH}`);
  }

  if (!/^\d*$/.test(rawQr)) {
    errors.push("QR contains non-numeric characters");
  }

  const production = {
    // 1-based 1-2: formatVersion
    formatVersion: parsedQr.slice(0, 2),
    // 1-based 3-4: year
    year: parsedQr.slice(2, 4),
    // 1-based 5-6: month
    month: parsedQr.slice(4, 6),
    // 1-based 7-8: day
    day: parsedQr.slice(6, 8),
    productionDate: "",
    expirationDate: "",
    // 1-based 9: factoryNumber
    factoryNumber: parsedQr.slice(8, 9),
    // 1-based 10: lineNumber
    lineNumber: parsedQr.slice(9, 10),
    // 1-based 11-12: batchNumber
    batchNumber: parsedQr.slice(10, 12),
    // 1-based 13-14: validMonth
    validMonth: parsedQr.slice(12, 14),
    // 1-based 15-16: discType
    discType: parsedQr.slice(14, 16),
    // 1-based 17-19: subPanelType
    subPanelType: parsedQr.slice(16, 19),
    // 1-based 20-21: salesCode
    salesCode: parsedQr.slice(19, 21),
    // 1-based 22: brandCode
    brandCode: parsedQr.slice(21, 22),
    // 1-based 23: humanVet
    humanVet: parsedQr.slice(22, 23),
    // 1-based 24-28: serialNumber
    serialNumber: parsedQr.slice(23, 28),
    // 1-based 29: appCode
    appCode: parsedQr.slice(28, 29),
    // 1-based 30-39: lotTraceNo
    lotTraceNo: parsedQr.slice(29, 39),
    // 1-based 40-41: reserved
    reserved: parsedQr.slice(39, 41),
  };

  const dates = buildDates(
    production.year,
    production.month,
    production.day,
    production.validMonth,
    errors,
  );
  production.productionDate = dates.productionDate;
  production.expirationDate = dates.expirationDate;

  const panelKey = `${production.discType}-${production.subPanelType}`;
  const panelInfo = PANEL_MAP[panelKey];
  const panel = {
    panelKey,
    panelName: panelInfo?.panelName ?? "Unknown Panel",
    panelNameCn: panelInfo?.panelNameCn ?? "",
    productCode: panelInfo?.productCode ?? null,
    onePieceBoxPanelType: panelInfo?.onePieceBoxPanelType ?? null,
    subPanelType: panelInfo?.subPanelType ?? production.subPanelType,
    discCategory: panelInfo?.discCategory ?? "Unknown",
    discCategoryZh: panelInfo?.discCategoryZh ?? "Unknown",
    markerList: panelInfo?.markerList ?? [],
    labelVersion: panelInfo?.labelVersion ?? null,
  };

  const lotDateAndBatch = `${production.year}${production.month}${production.day}${production.batchNumber}`;
  const productCodeForLot = panel.productCode?.replace(/-/g, "") ?? null;
  const lot = {
    discLotNo: `${production.lineNumber}-${production.subPanelType}-${lotDateAndBatch}`,
    reportLotNo: `${production.lineNumber}${production.subPanelType}${lotDateAndBatch}`,
    whiteBoxLotNo: productCodeForLot
      ? `${production.salesCode.slice(-1)}-${productCodeForLot}-${lotDateAndBatch}`
      : null,
  };

  const markerMap = MARKER_MAP_BY_DISC_TYPE[production.discType] ?? {};
  const markerWellMap = Array.from({ length: MARKER_COUNT }, (_, index) => {
    const markerStart = REAGENT_START + index * MARKER_BLOCK_LENGTH;
    const markerBlock = parsedQr.slice(markerStart, markerStart + MARKER_BLOCK_LENGTH);
    // Marker block 1-based 1-3: markerNumber
    const markerNumber = markerBlock.slice(0, 3);
    // Marker block 1-based 4-5: wellNumber
    const wellNumber = markerBlock.slice(3, 5);
    // Marker block 1-based 122: speciesLine
    const speciesLine = markerBlock.slice(121, 122);
    const used = markerNumber !== "000";

    return {
      index,
      markerNumber,
      markerName: used ? markerMap[markerNumber] ?? "Unknown Marker" : "",
      wellNumber,
      speciesLine,
      speciesName: SPECIES_LINE_MAP[speciesLine] ?? "Unknown",
      used,
    };
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    raw,
    production,
    panel,
    lot,
    markerWellMap,
  };
}
