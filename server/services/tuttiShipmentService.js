import db from '../db/sqlite.js';
import { queryWithRetry } from '../db/pgPool.js';

const PN_KEYS = ['model p/N', 'model P/N', 'model_pn', 'modelPN', 'modelPn', 'P/N', 'pn', 'part_no', 'model'];
const PANEL_KEYS = ['panel Name', 'panel name', 'panel_name', 'Panel', 'panel', 'formTitle'];
const EXP_DATE_KEYS = ['成品效期', 'Exp Date', 'exp_date', 'expiry_date', 'finished_exp_date', 'product_exp_date'];
const QTY_KEYS = ["製令數量", "Q'ty", 'Qty', 'qty', 'quantity', 'work_order_qty', 'production_qty', 'productionOrderQty', 'order_qty'];

export function parseFormData(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function valueFromPath(source, path) {
  return path.reduce((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[key];
  }, source);
}

export function extractFromFormData(formData, keys, fallback = '-') {
  for (const key of keys) {
    const candidates = [
      formData[key],
      valueFromPath(formData, ['header', key]),
      valueFromPath(formData, ['basic', key]),
    ];
    const value = candidates.find((item) => item !== undefined && item !== null && String(item).trim() !== '');
    if (value !== undefined) return String(value).trim();
  }
  return fallback;
}

function extractEnglishPanelName(formData) {
  const title = String(formData?.header?.formTitle || formData?.formTitle || '').split('\n')[0];
  if (!title) return '';
  return title
    .replace(/^\([^)]*\)\s*/, '')
    .replace(/[\u4e00-\u9fff]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractPanelFromFormData(formData) {
  const direct = extractFromFormData(formData, PANEL_KEYS, '');
  if (direct && direct !== String(formData?.header?.formTitle || '').trim()) return direct;
  return extractEnglishPanelName(formData) || direct || '-';
}

export function extractExpDateFromFormData(formData) {
  const direct = extractFromFormData(formData, EXP_DATE_KEYS, '');
  if (direct) return direct;
  const postProcess = formData.postProcess;
  if (Array.isArray(postProcess)) {
    const item = postProcess.find((entry) => entry?.productExpiry && String(entry.productExpiry).trim());
    if (item) return String(item.productExpiry).trim();
  }
  return '-';
}

function toInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

export function extractQtyFromFormData(formData) {
  for (const key of QTY_KEYS) {
    const qty = toInteger(formData[key] ?? formData.header?.[key]);
    if (qty !== null) return qty;
  }

  const wells = formData.wells || {};
  if (!wells || typeof wells !== 'object' || Array.isArray(wells)) return 0;

  let total = 0;
  for (const wellValue of Object.values(wells)) {
    const wellItems = Array.isArray(wellValue) ? wellValue : [wellValue];
    for (const wellData of wellItems) {
      if (!wellData || typeof wellData !== 'object') continue;
      for (const qtyKey of ['qty1', 'qty2', 'productionQty']) {
        const qty = toInteger(wellData[qtyKey]);
        if (qty !== null) total += qty;
      }
    }
  }
  return total;
}

export function lotSuffix(value) {
  const match = String(value || '').trim().match(/(\d{2})$/);
  return match ? match[1] : '';
}

export function isShipmentLot(lotNo) {
  const suffix = lotSuffix(lotNo);
  return Boolean(suffix) && Number(suffix) < 50;
}

export function lotNoMatchesLotCodeSuffix(lotNo, lotCode) {
  const lotNoSuffix = lotSuffix(lotNo);
  const lotCodeSuffix = lotSuffix(lotCode);
  return Boolean(lotNoSuffix && lotCodeSuffix && lotNoSuffix === lotCodeSuffix);
}

export function mfgLotNoToLotCodes(mfgLotNo, lineNumbers = ['1', '2', '3']) {
  const normalizedLotNo = String(mfgLotNo || '').trim();
  const parts = normalizedLotNo.split('-');
  if (parts.length !== 3) return [];

  const panelType = parts[1].trim();
  const dateBatch = parts[2].trim();
  if (panelType.length !== 6 || dateBatch.length !== 8) return [];

  const subPanelTypes = panelType.startsWith('000')
    ? [panelType.slice(3, 6)]
    : [panelType.slice(0, 3), panelType.slice(3, 6)];

  const lotCodes = [];
  for (const line of lineNumbers) {
    for (const subPanelType of subPanelTypes) {
      const lotCode = `${String(line).trim()}${subPanelType}_${dateBatch}`;
      if (lotNoMatchesLotCodeSuffix(normalizedLotNo, lotCode)) lotCodes.push(lotCode);
    }
  }
  return lotCodes;
}

/**
 * 出貨明細確認 assay result 比對邏輯:
 *
 * lot_no (已知, dash 格式) e.g. "1-051052-26060902"
 *   - 051052 = sub_panel_type (051, 052 兩片一起生產)
 *   - 260609 = 生產日
 *   - 02 = 工單排定生產批次 (實務上可能改變)
 *
 * lot_code (assay_process_records 中的 12碼) e.g. "105126060901"
 *   格式: N(1碼) + sub_panel_type(3碼) + 生產日(6碼) + YZ(2碼)
 *   - N = 生產線 (1 or 2), 由現場決定
 *   - YZ = 批次 (01~49), 由現場決定
 *
 * 比對規則 (Phase 1 — 現場手機 web 尚未完成):
 *   1. 日期必須相同 (生產日 6碼)
 *   2. sub_panel_type 必須匹配 (3碼)
 *   3. N (line) 和 YZ (batch suffix) 暫不比較
 *      → 等現場手機 web 程式完成有 N, YZ 輸入值時再精確比對
 */
export function mfgLotNoToLotCodePatterns(mfgLotNo) {
  const normalizedLotNo = String(mfgLotNo || '').trim();
  const parts = normalizedLotNo.split('-');
  if (parts.length !== 3) return [];

  const panelType = parts[1].trim();
  const dateBatch = parts[2].trim();
  if (panelType.length !== 6 || dateBatch.length !== 8) return [];

  const productionDate = dateBatch.slice(0, 6); // YYMMDD (6碼生產日)

  const subPanelTypes = panelType.startsWith('000')
    ? [panelType.slice(3, 6)]
    : [panelType.slice(0, 3), panelType.slice(3, 6)];

  // Return patterns: each is { subPanelType, productionDate }
  // lot_code match condition: lot_code[1:4] == subPanelType AND lot_code[4:10] == productionDate
  return subPanelTypes.map((sub) => ({ subPanelType: sub, productionDate }));
}

/**
 * 比對 lot_code 是否符合 lot_no 對應的 pattern
 * (Phase 1: 只比 sub_panel_type + 生產日, 不比 N 和 YZ)
 */
export function lotCodeMatchesLotNo(lotCode, mfgLotNo) {
  const patterns = mfgLotNoToLotCodePatterns(mfgLotNo);
  if (patterns.length === 0) return false;

  // Normalize lot_code: remove underscore if present (e.g. "1053_26060201" → "105326060201")
  const normalized = String(lotCode || '').trim().replace(/_/g, '');
  if (normalized.length !== 12) return false;

  const lotCodeSubPanel = normalized.slice(1, 4);    // sub_panel_type (3碼)
  const lotCodeDate = normalized.slice(4, 10);       // 生產日 (6碼 YYMMDD)

  return patterns.some(
    (p) => p.subPanelType === lotCodeSubPanel && p.productionDate === lotCodeDate
  );
}

export function normalizeLotCode(lotCode) {
  const value = String(lotCode || '').trim();
  if (!value) return '';
  const normalized = value.slice(1);
  return /^\d{11}$/.test(normalized) ? `${normalized.slice(0, 3)}_${normalized.slice(3)}` : normalized;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildNormalizedLotCodes(lotCodes) {
  return unique(lotCodes.flatMap((lotCode) => {
    const normalized = normalizeLotCode(lotCode);
    return [normalized, normalized.replace(/_/g, '')];
  }));
}

function patternKey(pattern) {
  return `${pattern.subPanelType}:${pattern.productionDate}`;
}

function taskLotPatternKey(lotCode) {
  const normalized = String(lotCode || '').trim().replace(/_/g, '');
  if (normalized.length !== 12) return '';
  return `${normalized.slice(1, 4)}:${normalized.slice(4, 10)}`;
}

function makeLotContext(lotNos) {
  const patternToLots = new Map();
  const lotPatterns = new Map();

  for (const lotNo of lotNos) {
    const patterns = mfgLotNoToLotCodePatterns(lotNo);
    lotPatterns.set(lotNo, patterns);
    for (const pattern of patterns) {
      const key = patternKey(pattern);
      if (!patternToLots.has(key)) patternToLots.set(key, new Set());
      patternToLots.get(key).add(lotNo);
    }
  }

  return { patternToLots, lotPatterns };
}

function buildPatternValuesSql(patternToLots) {
  const keys = Array.from(patternToLots.keys());
  const params = [];
  const placeholders = [];

  keys.forEach((key, index) => {
    const [subPanelType, productionDate] = key.split(':');
    const offset = index * 2;
    placeholders.push(`($${offset + 1}, $${offset + 2})`);
    params.push(subPanelType, productionDate);
  });

  return { keys, params, valuesSql: placeholders.join(',') };
}

async function fetchAssayRowsByLot(patternToLots) {
  const { keys, params, valuesSql } = buildPatternValuesSql(patternToLots);
  const rowsByLot = new Map();
  if (keys.length === 0) return rowsByLot;

  const result = await queryWithRetry(`
    WITH patterns(sub_panel_type, production_date) AS (VALUES ${valuesSql})
    SELECT DISTINCT
      p.sub_panel_type,
      p.production_date,
      a.analyze_item,
      a.lot_code,
      a.patient_id
    FROM panel_production.assay_process_records a
    JOIN patterns p
      ON SUBSTRING(REPLACE(TRIM(COALESCE(a.lot_code, '')), '_', '') FROM 2 FOR 3) = p.sub_panel_type
     AND SUBSTRING(REPLACE(TRIM(COALESCE(a.lot_code, '')), '_', '') FROM 5 FOR 6) = p.production_date
    WHERE COALESCE(TRIM(a.analyze_item), '') <> ''
  `, params);

  for (const row of result.rows) {
    const lots = patternToLots.get(`${row.sub_panel_type}:${row.production_date}`);
    if (!lots) continue;
    for (const lotNo of lots) {
      if (!rowsByLot.has(lotNo)) rowsByLot.set(lotNo, []);
      rowsByLot.get(lotNo).push(row);
    }
  }

  return rowsByLot;
}

async function fetchHistoryByLot(lotNos) {
  const historyByLot = new Map();
  if (lotNos.length === 0) return historyByLot;

  const result = await queryWithRetry(`
    SELECT DISTINCT ON (lot_no)
      lot_no,
      new_status,
      modification_count
    FROM panel_production.batch_build_line_history
    WHERE lot_no = ANY($1)
    ORDER BY lot_no, transitioned_at DESC
  `, [lotNos]);

  for (const row of result.rows) {
    historyByLot.set(row.lot_no, row);
  }
  return historyByLot;
}

function fetchTaskMapsByLot(patternToLots) {
  const taskMapsByLot = new Map();
  try {
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rd_build_line_tasks'"
    ).get();
    if (!table || patternToLots.size === 0) return taskMapsByLot;

    const tasks = db.prepare(`
      SELECT marker, lot_no, status
      FROM rd_build_line_tasks
      WHERE status IN ('completed','on_hold','rejected','pending_rd','in_progress','pending_qc')
        AND COALESCE(TRIM(marker), '') <> ''
        AND COALESCE(TRIM(lot_no), '') <> ''
    `).all();

    const priority = { rejected: 5, on_hold: 4, completed: 3, pending_qc: 2, in_progress: 1, pending_rd: 0 };
    for (const task of tasks) {
      const lots = patternToLots.get(taskLotPatternKey(task.lot_no));
      if (!lots) continue;

      for (const lotNo of lots) {
        if (!taskMapsByLot.has(lotNo)) taskMapsByLot.set(lotNo, {});
        const taskMap = taskMapsByLot.get(lotNo);
        const marker = task.marker || '';
        const existing = taskMap[marker];
        if (!existing || (priority[task.status] || 0) > (priority[existing] || 0)) {
          taskMap[marker] = task.status;
        }
      }
    }
  } catch {
    return taskMapsByLot;
  }

  return taskMapsByLot;
}

async function buildShipmentContext(lotNos) {
  const { patternToLots, lotPatterns } = makeLotContext(lotNos);
  const [assayRowsByLot, historyByLot] = await Promise.all([
    fetchAssayRowsByLot(patternToLots),
    fetchHistoryByLot(lotNos),
  ]);
  const taskMapsByLot = fetchTaskMapsByLot(patternToLots);

  return {
    assayRowsByLot,
    historyByLot,
    lotPatterns,
    taskMapsByLot,
  };
}

function checkRdLineChanged(lotNo, context) {
  try {
    const patterns = context.lotPatterns.get(lotNo) || [];
    if (patterns.length === 0) {
      return { rd_line_changed: null, rd_line_changed_status: '待確認' };
    }

    const assayRows = context.assayRowsByLot.get(lotNo) || [];
    const analyzeItems = new Set(
      assayRows
        .filter((row) => ['control-1', 'control-2', 'control-3', 'control-4'].includes(String(row.patient_id || '').trim().toLowerCase()))
        .map((row) => row.analyze_item)
        .filter(Boolean)
    );

    if (analyzeItems.size === 0) {
      return { rd_line_changed: false, rd_line_changed_status: '未建線完成' };
    }

    const totalItems = analyzeItems.size;
    const taskMap = context.taskMapsByLot.get(lotNo) || {};

    let completedCount = 0;
    let holdCount = 0;
    let rejectCount = 0;
    for (const status of Object.values(taskMap)) {
      if (status === 'completed') completedCount++;
      else if (status === 'on_hold') holdCount++;
      else if (status === 'rejected') rejectCount++;
    }

    const hasAbnormal = holdCount > 0 || rejectCount > 0;
    const allDone = (completedCount + holdCount + rejectCount) >= totalItems && totalItems > 0;

    const history = context.historyByLot.get(lotNo);
    const hasLineChange = Boolean(history?.new_status && history.new_status.includes('已改線'));
    const modCount = history ? (Number(history.modification_count) || 0) : 0;
    const doneItems = completedCount + holdCount + rejectCount;

    if (allDone && hasAbnormal) {
      const parts = [];
      if (holdCount) parts.push(`Hold:${holdCount}`);
      if (rejectCount) parts.push(`Reject:${rejectCount}`);
      return { rd_line_changed: null, rd_line_changed_status: `建線完成有異常(${parts.join(',')})` };
    }
    if (allDone) {
      if (hasLineChange) {
        return { rd_line_changed: true, rd_line_changed_status: `是(改線${modCount}次)` };
      }
      return { rd_line_changed: false, rd_line_changed_status: '否' };
    }

    const statusParts = [`${doneItems}/${totalItems}`];
    if (hasAbnormal) {
      if (holdCount) statusParts.push(`Hold:${holdCount}`);
      if (rejectCount) statusParts.push(`Reject:${rejectCount}`);
    }
    return { rd_line_changed: false, rd_line_changed_status: `未建線完成(${statusParts.join(', ')})` };
  } catch (error) {
    return { rd_line_changed: null, rd_line_changed_status: `待確認: ${error.message}` };
  }
}

function buildQcStatus(lotNo, context) {
  try {
    const patterns = context.lotPatterns.get(lotNo) || [];

    if (patterns.length === 0) {
      return {
        qc_ship_status: '待 QC Manager 核准',
        qc_ship_reason: 'lot_no 格式無法解析，需 QC Manager 核准',
        qc_details: [],
      };
    }

    const assayRows = context.assayRowsByLot.get(lotNo) || [];
    if (assayRows.length === 0) {
      return {
        qc_ship_status: '待 QC Manager 核准',
        qc_ship_reason: '找不到 assay result，需 QC Manager 核准',
        qc_details: [],
      };
    }

    const taskMap = context.taskMapsByLot.get(lotNo) || {};

    const STATUS_LABELS = {
      completed: '已建線',
      on_hold: 'Hold',
      rejected: 'Reject',
      pending_rd: '待RD',
      in_progress: '進行中',
      pending_qc: '待QC確認',
    };

    const detailsByKey = new Map();
    for (const row of assayRows) {
      const rawLotCode = String(row.lot_code || '').trim();
      const key = `${row.analyze_item}::${rawLotCode}`;
      if (!detailsByKey.has(key)) {
        const taskStatus = taskMap[row.analyze_item] || '';
        const statusLabel = STATUS_LABELS[taskStatus] || '待建線';
        detailsByKey.set(key, {
          analyze_item: row.analyze_item,
          lot_code: rawLotCode,
          status: statusLabel,
          reason: taskStatus ? `曲線擬合: ${statusLabel}` : '尚未建線',
        });
      }
    }

    return {
      qc_ship_status: '待確認',
      qc_ship_reason: '已找到 assay result',
      qc_details: Array.from(detailsByKey.values()),
    };
  } catch (error) {
    return {
      qc_ship_status: '待確認',
      qc_ship_reason: `QC 查詢失敗: ${error.message}`,
      qc_details: [],
    };
  }
}

function rowMatchesFilters(row, filters) {
  if (filters.lot_no && !row.lot_no.includes(filters.lot_no)) return false;
  if (filters.panel && !row.panel.toLowerCase().includes(filters.panel.toLowerCase())) return false;
  if (filters.only_shippable && row.qc_ship_status !== '可出貨' && row.qc_ship_status !== 'QC核准可出貨') return false;
  return true;
}

export async function getShipmentOrders(filters = {}) {
  const includeStatus = filters.include_status === true || filters.include_status === '1' || filters.include_status === 'true';
  const params = [];
  const where = [];

  if (filters.date_from) {
    params.push(filters.date_from);
    where.push(`created_at::date >= $${params.length}::date`);
  }
  if (filters.date_to) {
    params.push(filters.date_to);
    where.push(`created_at::date <= $${params.length}::date`);
  }

  where.push(`COALESCE(TRIM(lot_no), '') ~ '[0-9]{2}$'`);
  where.push(`RIGHT(TRIM(lot_no), 2)::int < 50`);

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const selectColumns = `
    work_order_no,
    lot_no,
    form_data->'header'->>'modelPn' AS model_pn,
    form_data->'header'->>'formTitle' AS form_title,
    form_data->'header'->>'productionOrderQty' AS production_order_qty,
    (
      SELECT item->>'productExpiry'
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(form_data->'postProcess') = 'array'
          THEN form_data->'postProcess'
          ELSE '[]'::jsonb
        END
      ) item
      WHERE COALESCE(TRIM(item->>'productExpiry'), '') <> ''
      LIMIT 1
    ) AS product_expiry,
    created_at,
    updated_at
  `;
  const result = await queryWithRetry(`
    SELECT source_table, work_order_no, lot_no, model_pn, form_title,
           production_order_qty, product_expiry, created_at, updated_at
    FROM (
      SELECT 'tutti_work_orders' AS source_table, ${selectColumns}
      FROM panel_production.tutti_work_orders
      ${whereSql}
      UNION ALL
      SELECT 'tutti_work_orders_water' AS source_table, ${selectColumns}
      FROM panel_production.tutti_work_orders_water
      ${whereSql}
    ) orders
    ORDER BY created_at DESC NULLS LAST
    LIMIT 100
  `, params);

  const rows = [];

  const shipmentLotNos = result.rows
    .map((workOrder) => String(workOrder.lot_no || '').trim())
    .filter((lotNo) => lotNo && isShipmentLot(lotNo));
  const context = includeStatus ? await buildShipmentContext(shipmentLotNos) : null;

  for (const workOrder of result.rows) {
    const formData = workOrder.form_data
      ? parseFormData(workOrder.form_data)
      : {
          header: {
            modelPn: workOrder.model_pn,
            formTitle: workOrder.form_title,
            productionOrderQty: workOrder.production_order_qty,
          },
          postProcess: workOrder.product_expiry ? [{ productExpiry: workOrder.product_expiry }] : [],
        };
    // lot_no 唯一來源: tutti_work_orders.lot_no (由 Excel upload 或 MRP 頁面人工填入)
    // 不做任何 fallback 計算或從 lot_code 反推
    const lotNo = String(workOrder.lot_no || '').trim();
    if (!lotNo || !isShipmentLot(lotNo)) continue;

    const pn = extractFromFormData(formData, PN_KEYS);
    const panel = extractPanelFromFormData(formData);
    const rd = includeStatus
      ? checkRdLineChanged(lotNo, context)
      : { rd_line_changed: null, rd_line_changed_status: '未載入' };
    const qc = includeStatus
      ? buildQcStatus(lotNo, context)
      : { qc_ship_status: '未載入', qc_ship_reason: '快速模式未載入 RD/QC 狀態', qc_details: [] };

    const row = {
      source_table: workOrder.source_table,
      work_order_no: workOrder.work_order_no || '',
      pn,
      panel,
      lot_no: lotNo,
      exp_date: extractExpDateFromFormData(formData),
      qty: extractQtyFromFormData(formData),
      ...rd,
      ...qc,
      qc_manager_status: null,
      qc_manager_review_type: null,
      created_at: workOrder.created_at,
      updated_at: workOrder.updated_at,
    };

    if (rowMatchesFilters(row, filters)) rows.push(row);
  }

  // 依 lot_no 中的日期排序 (降序: 新日期在上)
  // lot_no 格式: "1-063064-26061601" → date_batch = "26061601" → 取前6碼 "260616" (YYMMDD)
  rows.sort((a, b) => {
    const dateA = (a.lot_no.split('-')[2] || '').slice(0, 6);
    const dateB = (b.lot_no.split('-')[2] || '').slice(0, 6);
    return dateB.localeCompare(dateA);
  });

  return rows;
}
