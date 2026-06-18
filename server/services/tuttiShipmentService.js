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

async function checkRdLineChanged(lotNo) {
  try {
    const patterns = mfgLotNoToLotCodePatterns(lotNo);
    if (patterns.length === 0) {
      return { rd_line_changed: null, rd_line_changed_status: '待確認' };
    }

    // 取得該 lot 對應的所有 lot_codes
    const patternConditions = patterns.map((_, i) => `(
      SUBSTRING(REPLACE(TRIM(COALESCE(lot_code, '')), '_', '') FROM 2 FOR 3) = $${1 + i * 2}
      AND SUBSTRING(REPLACE(TRIM(COALESCE(lot_code, '')), '_', '') FROM 5 FOR 6) = $${2 + i * 2}
    )`).join(' OR ');
    const patternParams = patterns.flatMap((p) => [p.subPanelType, p.productionDate]);

    // 取得 distinct analyze_item (以 control records 為準)
    const itemResult = await queryWithRetry(`
      SELECT DISTINCT analyze_item
      FROM panel_production.assay_process_records
      WHERE (${patternConditions})
        AND COALESCE(TRIM(analyze_item), '') <> ''
        AND LOWER(TRIM(COALESCE(patient_id, ''))) IN ('control-1','control-2','control-3','control-4')
    `, patternParams);

    if (itemResult.rows.length === 0) {
      return { rd_line_changed: false, rd_line_changed_status: '未建線完成' };
    }

    const totalItems = itemResult.rows.length;

    // 查 rd_build_line_tasks (本地 API) 取得 lot_code 級別的建線狀態
    // lot_code 格式: lot_no 的 lot_codes (去掉 dash)
    // rd_build_line_tasks 用 lot_no = lot_code (12碼)
    let taskMap = {}; // marker -> status
    try {
      const taskRes = await fetch('http://127.0.0.1:3201/api/v1/pre-assignment/rd-build-line-tasks?status=completed,on_hold,rejected,pending_rd,in_progress,pending_qc');
      if (taskRes.ok) {
        const taskData = await taskRes.json();
        const allTasks = taskData.data || [];
        // 找到與此 lot_no 相關的 tasks（lot_no 在 tasks 裡可能是 12碼 lot_code）
        // 用 sub_panel_type + date 匹配
        const relevantTasks = allTasks.filter((t) => {
          const taskLot = String(t.lot_no || '').trim().replace(/_/g, '');
          if (taskLot.length !== 12) return false;
          const taskSub = taskLot.slice(1, 4);
          const taskDate = taskLot.slice(4, 10);
          return patterns.some((p) => p.subPanelType === taskSub && p.productionDate === taskDate);
        });
        // Build status map: highest priority per marker
        const priority = { rejected: 5, on_hold: 4, completed: 3, pending_qc: 2, in_progress: 1, pending_rd: 0 };
        for (const t of relevantTasks) {
          const marker = t.marker || '';
          if (!marker) continue;
          const existing = taskMap[marker];
          if (!existing || (priority[t.status] || 0) > (priority[existing] || 0)) {
            taskMap[marker] = t.status;
          }
        }
      }
    } catch { /* non-blocking */ }

    // 統計
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

    // 查 batch_build_line_history 看是否有改線
    const historyResult = await queryWithRetry(`
      SELECT new_status, modification_count
      FROM panel_production.batch_build_line_history
      WHERE lot_no = $1
      ORDER BY transitioned_at DESC
      LIMIT 1
    `, [lotNo]);

    const hasLineChange = historyResult.rows.length > 0 &&
      historyResult.rows[0].new_status && historyResult.rows[0].new_status.includes('已改線');
    const modCount = historyResult.rows.length > 0 ? (Number(historyResult.rows[0].modification_count) || 0) : 0;

    // 判定:
    // 1. 全部建完線 + 有異常 → 建線完成但有異常
    // 2. 全部建完線 + 有改線 → 是
    // 3. 全部建完線 + 未改線 → 否
    // 4. 未全部完成 → 未建線完成(X/Y)
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

async function buildQcStatus(lotNo) {
  try {
    const patterns = mfgLotNoToLotCodePatterns(lotNo);

    if (patterns.length === 0) {
      return {
        qc_ship_status: '待 QC Manager 核准',
        qc_ship_reason: 'lot_no 格式無法解析，需 QC Manager 核准',
        qc_details: [],
      };
    }

    const patternConditions = patterns.map((_, i) => `(
      SUBSTRING(REPLACE(TRIM(COALESCE(lot_code, '')), '_', '') FROM 2 FOR 3) = $${1 + i * 2}
      AND SUBSTRING(REPLACE(TRIM(COALESCE(lot_code, '')), '_', '') FROM 5 FOR 6) = $${2 + i * 2}
    )`).join(' OR ');

    const patternParams = patterns.flatMap((p) => [p.subPanelType, p.productionDate]);

    const sql = `
      SELECT DISTINCT analyze_item, lot_code
      FROM panel_production.assay_process_records
      WHERE COALESCE(TRIM(analyze_item), '') <> ''
        AND (${patternConditions})
      ORDER BY analyze_item, lot_code
      LIMIT 300
    `;

    const result = await queryWithRetry(sql, patternParams);

    if (result.rows.length === 0) {
      return {
        qc_ship_status: '待 QC Manager 核准',
        qc_ship_reason: '找不到 assay result，需 QC Manager 核准',
        qc_details: [],
      };
    }

    // 查 rd_build_line_tasks 取得每個 marker 的曲線擬合狀態
    let taskMap = {}; // marker -> status
    try {
      const taskRes = await fetch('http://127.0.0.1:3201/api/v1/pre-assignment/rd-build-line-tasks?status=completed,on_hold,rejected,pending_rd,in_progress,pending_qc');
      if (taskRes.ok) {
        const taskData = await taskRes.json();
        const allTasks = taskData.data || [];
        const relevantTasks = allTasks.filter((t) => {
          const taskLot = String(t.lot_no || '').trim().replace(/_/g, '');
          if (taskLot.length !== 12) return false;
          const taskSub = taskLot.slice(1, 4);
          const taskDate = taskLot.slice(4, 10);
          return patterns.some((p) => p.subPanelType === taskSub && p.productionDate === taskDate);
        });
        const priority = { rejected: 5, on_hold: 4, completed: 3, pending_qc: 2, in_progress: 1, pending_rd: 0 };
        for (const t of relevantTasks) {
          const marker = t.marker || '';
          if (!marker) continue;
          const existing = taskMap[marker];
          if (!existing || (priority[t.status] || 0) > (priority[existing] || 0)) {
            taskMap[marker] = t.status;
          }
        }
      }
    } catch { /* non-blocking */ }

    // 狀態標籤
    const STATUS_LABELS = {
      completed: '已建線',
      on_hold: 'Hold',
      rejected: 'Reject',
      pending_rd: '待RD',
      in_progress: '進行中',
      pending_qc: '待QC確認',
    };

    const detailsByKey = new Map();
    for (const row of result.rows) {
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

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const result = await queryWithRetry(`
    SELECT source_table, work_order_no, lot_no, form_data, created_at, updated_at
    FROM (
      SELECT 'tutti_work_orders' AS source_table, work_order_no, lot_no, form_data, created_at, updated_at
      FROM panel_production.tutti_work_orders
      ${whereSql}
      UNION ALL
      SELECT 'tutti_work_orders_water' AS source_table, work_order_no, lot_no, form_data, created_at, updated_at
      FROM panel_production.tutti_work_orders_water
      ${whereSql}
    ) orders
    ORDER BY created_at DESC NULLS LAST
    LIMIT 500
  `, params);

  const rows = [];
  for (const workOrder of result.rows) {
    const formData = parseFormData(workOrder.form_data);
    // lot_no 唯一來源: tutti_work_orders.lot_no (由 Excel upload 或 MRP 頁面人工填入)
    // 不做任何 fallback 計算或從 lot_code 反推
    const lotNo = String(workOrder.lot_no || '').trim();
    if (!lotNo || !isShipmentLot(lotNo)) continue;

    const pn = extractFromFormData(formData, PN_KEYS);
    const panel = extractPanelFromFormData(formData);
    const rd = await checkRdLineChanged(lotNo);
    const qc = await buildQcStatus(lotNo);

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
