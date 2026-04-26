/**
 * LoadCsvModal – Load CSV → calculate OD → auto-compute concentration
 *
 * Flow:
 *  1. Pick ≥1 .csv files + target CS Type
 *  2. Build MarkerConfig[] from well config + beadscal_rules
 *  3. Each CSV → calculateSample → write finalValue to well_od rows
 *  4. If both OD levels of a pair now have data → linear regression → write ind_batch + all_batch
 */

import { useState, useRef, useCallback } from 'react';
import { X, Upload, Loader2 } from 'lucide-react';
import type { RawDataRow, ColMeta, CalRule, CsAssignRow } from '../../api/rawdata';
import { apiUrl } from '../../api/base';
import type { MarkerConfig, EngineOptions } from './ipqc_od_engine';
import { calculateSample } from './ipqc_od_engine';
import { csvFileToMatrix } from './csvCalculationPipeline';
import { normalizeMarkerName } from './markerRuleBook';
import { computeConcentrations } from './odToConc';

async function expandCombos(beadName: string, sheetName: string, count: number): Promise<void> {
  const res = await fetch(apiUrl('/rawdata/expand-combos'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bead_name: beadName, sheet_name: sheetName, count }),
  });
  if (!res.ok) throw new Error(`expand-combos failed: ${res.status}`);
}

async function fetchSheetRows(beadName: string, sheetName: string): Promise<RawDataRow[]> {
  const res = await fetch(apiUrl(`/rawdata/data?bead_name=${encodeURIComponent(beadName)}&sheet_name=${encodeURIComponent(sheetName)}`));
  if (!res.ok) throw new Error(`fetch data failed: ${res.status}`);
  const data = await res.json();
  return data.rows;
}

const WELL_FIELDS = [
  'w2','w3','w4','w5','w6','w7','w8','w9',
  'w10','w11','w12','w13','w14','w15','w16','w17','w18','w19',
] as const;

interface Props {
  levels: string[];
  meta: ColMeta[];
  calRules: CalRule[];
  csData: CsAssignRow[];
  rows: RawDataRow[];
  tableType: string;
  beadName: string;
  onApply: (updates: RawDataRow[]) => void;
  onClose: () => void;
  onRefresh?: () => void; // called after expanding combos to reload data
}

function findRule(row1: string, ruleMap: Map<string, CalRule>): CalRule | undefined {
  const norm = normalizeMarkerName(row1);
  if (ruleMap.has(norm)) return ruleMap.get(norm);
  const noSuffix = norm.replace(/-[A-Z]$/, '');
  if (ruleMap.has(noSuffix)) return ruleMap.get(noSuffix);
  const noPrefix = noSuffix.replace(/^[TNGQ](?=[A-Z])/, '');
  if (noPrefix !== noSuffix && ruleMap.has(noPrefix)) return ruleMap.get(noPrefix);
  const specials: Record<string, string> = { CREATINE: 'CRE', CREATININE: 'CREA', BLLANK: 'BLANK' };
  if (specials[norm]) return ruleMap.get(specials[norm]);
  return undefined;
}

function buildMarkerConfigs(meta: ColMeta[], calRules: CalRule[]): MarkerConfig[] {
  const wellOdMeta = meta.filter(m => m.table_type === 'well_od');
  const ruleMap = new Map(calRules.map(r => [normalizeMarkerName(r.marker), r]));
  const configs: MarkerConfig[] = [];

  for (const m of wellOdMeta) {
    if (!m.row1 || m.row1 === 'Blank' || m.row1 === 'Bllank') continue;
    const rule = findRule(m.row1, ruleMap);
    if (!rule) continue;
    const marker = normalizeMarkerName(rule.marker);
    const wellNum = parseInt(m.well.replace(/\D/g, ''), 10);
    configs.push({
      colIndex: wellNum - 1,
      name: marker,
      nm1: Number(rule['主波 (CH)']) || 0,
      nm2: Number(rule['副波 (CH)']) || 0,
      seq1: Number(rule['Seq 1 (圈數)']) || 0,
      seq2: Number(rule['Seq 2 (圈數)']) || 0,
      blank: Number(rule['blank well']) || 0,
      moving: Number(rule.moving) || 0,
      secondWaveMultiplier: Number(rule['扣n倍副波']) || 0,
    });
  }
  return configs;
}

export default function LoadCsvModal({ levels, meta, calRules, csData, rows, tableType, beadName, onApply, onClose }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [selLevel, setSelLevel] = useState(levels[0] ?? '');
  const [startIdx, setStartIdx] = useState(0); // combo_idx offset to start writing
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Count existing rows with data for selected level
  const existingCount = rows
    .filter(r => r.table_type === tableType && r.level === selLevel)
    .filter(r => WELL_FIELDS.some(f => (r as any)[f] !== null))
    .length;

  const handleFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFiles(Array.from(e.target.files ?? []));
    setError('');
  }, []);

  // Delete all OD data for selected level (clear all rows)
  const handleClearLevel = useCallback(() => {
    const targetRows = rows
      .filter(r => r.table_type === tableType && r.level === selLevel);
    if (!targetRows.length) return;
    const cleared = targetRows.map(r => {
      const updated = { ...r };
      for (const f of WELL_FIELDS) (updated as any)[f] = null;
      return updated;
    });
    onApply(cleared);
  }, [rows, tableType, selLevel, onApply]);

  const handleRun = useCallback(async () => {
    if (!files.length || !selLevel) return;
    setProcessing(true);
    setError('');

    try {
      const configs = buildMarkerConfigs(meta, calRules);
      if (!configs.length) throw new Error('Well 配置中無有效 marker，請先設定 Well 配置');

      // Always fetch fresh rows to get accurate count (avoids double-expand)
      const sheetName = rows[0]?.sheet_name;
      if (!sheetName) throw new Error('無法取得 sheet_name');
      let workingRows = await fetchSheetRows(beadName, sheetName);
      let targetRows = workingRows
        .filter(r => r.table_type === tableType && r.level === selLevel)
        .sort((a, b) => a.combo_idx - b.combo_idx)
        .slice(startIdx);

      // If CSV count exceeds available rows, expand combos in DB and refetch
      if (files.length > targetRows.length) {
        const need = files.length - targetRows.length;
        await expandCombos(beadName, sheetName, need);
        workingRows = await fetchSheetRows(beadName, sheetName);
        targetRows = workingRows
          .filter(r => r.table_type === tableType && r.level === selLevel)
          .sort((a, b) => a.combo_idx - b.combo_idx)
          .slice(startIdx);
      }

      if (!targetRows.length) throw new Error(`找不到 level "${selLevel}" 第 ${startIdx + 1} 筆起的資料列`);

      const options: EngineOptions = { alpControl: false, saPanel: false };

      // Build colIndex → well field mapping
      const wellFieldMap = new Map<number, typeof WELL_FIELDS[number]>();
      for (const m of meta.filter(m => m.table_type === 'well_od')) {
        const wn = parseInt(m.well.replace(/\D/g, ''), 10);
        const fi = wn - 2;
        if (fi >= 0 && fi < WELL_FIELDS.length) wellFieldMap.set(wn - 1, WELL_FIELDS[fi]);
      }

      // ── Step 1: Calculate OD from CSV files ──
      const isTcrea = beadName === 'tCREA';
      const odUpdates: RawDataRow[] = [];

      // Write CSV OD into targetRows (well_od for normal, od_corrected for tCREA)
      for (let fi = 0; fi < files.length; fi++) {
        const row = targetRows[fi];
        if (!row) break;
        const matrix = await csvFileToMatrix(files[fi]);
        const sample = calculateSample(matrix, configs, options);
        const updated = { ...row };
        for (let mi = 0; mi < sample.markers.length; mi++) {
          const cfg = configs[mi];
          if (!cfg) continue;
          const field = wellFieldMap.get(cfg.colIndex);
          if (field) (updated as any)[field] = sample.markers[mi].finalValue;
        }
        odUpdates.push(updated);
      }

      // Clear any rows beyond the CSV count that previously had data
      const allLevelRows = workingRows
        .filter(r => r.table_type === tableType && r.level === selLevel)
        .sort((a, b) => a.combo_idx - b.combo_idx);
      for (let i = startIdx + files.length; i < allLevelRows.length; i++) {
        const row = allLevelRows[i];
        if (WELL_FIELDS.some(f => (row as any)[f] !== null)) {
          const cleared = { ...row };
          for (const f of WELL_FIELDS) (cleared as any)[f] = null;
          odUpdates.push(cleared);
        }
      }

      // tCREA: compute well_od = Creatinine(wn+1) - Creatine(wn) from od_corrected
      if (isTcrea) {
        const wellOdMeta2 = meta.filter(m => m.table_type === 'well_od');
        const creatineWells: number[] = [];
        const creatinineWells: number[] = [];
        for (const m of wellOdMeta2) {
          const wn = parseInt(m.well.replace(/\D/g, ''), 10);
          const r1 = (m.row1 || '').toUpperCase();
          if (r1.includes('CREATINE') && !r1.includes('CREATININE')) creatineWells.push(wn);
          else if (r1.includes('CREATININE')) creatinineWells.push(wn);
        }
        creatineWells.sort((a, b) => a - b);
        creatinineWells.sort((a, b) => a - b);
        const nPairs = Math.min(creatineWells.length, creatinineWells.length);

        // Merge od_corrected updates into snapshot
        const corrMap = new Map(odUpdates.map(u => [u.id, u]));
        const mergedCorr = workingRows.map(r => corrMap.get(r.id) ?? r);

        // For each well_od row with same level, compute subtraction or clear
        const wellOdRows = mergedCorr.filter(r => r.table_type === 'well_od' && r.level === selLevel)
          .sort((a, b) => a.combo_idx - b.combo_idx);

        for (const woRow of wellOdRows) {
          const srcRow = mergedCorr.find(r => r.table_type === 'od_corrected' && r.level === woRow.level && r.combo_idx === woRow.combo_idx);
          if (!srcRow) continue;
          const hasOdData = WELL_FIELDS.some(f => (srcRow as any)[f] !== null);
          if (!hasOdData) {
            // od_corrected was cleared, clear well_od too
            if (WELL_FIELDS.some(f => (woRow as any)[f] !== null)) {
              const cleared = { ...woRow };
              for (const f of WELL_FIELDS) (cleared as any)[f] = null;
              odUpdates.push(cleared);
            }
            continue;
          }
          const updated = { ...woRow };
          let hasChange = false;
          for (let i = 0; i < nPairs; i++) {
            const creatineField = WELL_FIELDS[creatineWells[i] - 2] as keyof RawDataRow;
            const creatinineField = WELL_FIELDS[creatinineWells[i] - 2] as keyof RawDataRow;
            const vCre = srcRow[creatineField] as number | null;
            const vCreatinine = srcRow[creatinineField] as number | null;
            if (vCre !== null && vCreatinine !== null) {
              (updated as any)[creatineField] = Math.round((vCreatinine - vCre) * 1e6) / 1e6;
              hasChange = true;
            }
          }
          if (hasChange) odUpdates.push(updated);
        }
      }

      // ── Step 2: Merge OD updates into allRows snapshot for concentration calc ──
      // Use parent's rows (includes unsaved dirty data from previous loads) merged with workingRows and current updates
      const parentMap = new Map(rows.map(r => [r.id, r]));
      const fullSnapshot = workingRows.map(r => parentMap.get(r.id) ?? r);
      const odMap = new Map(odUpdates.map(u => [u.id, u]));
      const mergedRows = fullSnapshot.map(r => odMap.get(r.id) ?? r);

      // ── Step 3: Compute concentrations (ind_batch + all_batch) ──
      const concUpdates = computeConcentrations(mergedRows, beadName, csData);
      console.log('[LoadCSV] OD:', odUpdates.length, 'Conc:', concUpdates.length,
        'wellOd w/ data:', mergedRows.filter(r => r.table_type==='well_od' && r.w8!==null).map(r=>r.level+'/'+r.lot_id).slice(0,8));

      // Include new rows (from expand) that parent doesn't know about, excluding those already in odUpdates/concUpdates
      const parentIds = new Set(rows.map(r => r.id));
      const updateIds = new Set([...odUpdates, ...concUpdates].map(r => r.id));
      const newRows = workingRows.filter(r => !parentIds.has(r.id) && !updateIds.has(r.id));

      const allUpdates = [...odUpdates, ...concUpdates, ...newRows];
      onApply(allUpdates);
      onClose();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setProcessing(false);
    }
  }, [files, selLevel, startIdx, meta, calRules, csData, rows, tableType, beadName, onApply, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#0F1A2E] border border-[#2A3754] rounded-lg shadow-2xl w-[480px] flex flex-col"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A3754]">
          <h3 className="text-sm font-medium text-[#EAF2FF]">Load CSV 計算 OD</h3>
          <button onClick={onClose} className="text-[#556A88] hover:text-[#EAF2FF]"><X size={16} /></button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          <div>
            <label className="text-xs text-[#7BA8D4] block mb-1">選擇 CSV 檔案（可多選）</label>
            <input ref={fileRef} type="file" accept=".csv" multiple onChange={handleFiles} className="hidden" />
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
                bg-[#A78BFA]/10 border border-[#A78BFA]/30 text-[#A78BFA] hover:bg-[#A78BFA]/20">
              <Upload size={12} /> 選擇檔案
            </button>
            {files.length > 0 && (
              <div className="mt-2 text-[10px] text-[#93A4C3] max-h-20 overflow-auto">
                {files.map((f, i) => <div key={i}>{f.name}</div>)}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs text-[#7BA8D4] block mb-1">目標 CS Type（寫入 Level）</label>
            <div className="flex flex-wrap gap-1.5">
              {levels.map(lv => (
                <button key={lv} onClick={() => { setSelLevel(lv); setStartIdx(0); }}
                  className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors
                    ${selLevel === lv
                      ? 'bg-[#4DA3FF]/20 border-[#4DA3FF] text-[#4DA3FF]'
                      : 'bg-[#0d1f3a] border-[#2A3754] text-[#556A88] hover:text-[#93A4C3]'}`}>
                  {lv}
                </button>
              ))}
            </div>
          </div>

          {/* Start offset + existing info */}
          <div className="flex items-center gap-3">
            <div>
              <label className="text-xs text-[#7BA8D4] block mb-1">從第幾筆開始寫入</label>
              <input
                type="number" min={0}
                value={startIdx}
                onChange={e => setStartIdx(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-16 bg-[#0d1f3a] border border-[#2A3754] text-[#D4E8FF] text-xs rounded px-2 py-1 focus:outline-none focus:border-[#4DA3FF]"
              />
            </div>
            <div className="text-[10px] text-[#556A88] pt-4">
              已有 {existingCount} 筆有資料·將寫入 {files.length} 筆於第 {startIdx + 1} 筆起
            </div>
            <button onClick={handleClearLevel}
              className="mt-3 px-2 py-1 text-[10px] text-[#FF5C73] border border-[#FF5C73]/30 rounded hover:bg-[#FF5C73]/10">
              清除此 Level OD
            </button>
          </div>

          {error && <div className="text-xs text-[#FF5C73] bg-[#FF5C73]/10 rounded px-3 py-2">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#2A3754]">
          <button onClick={onClose}
            className="px-3 py-1.5 text-xs text-[#93A4C3] border border-[#2A3754] rounded hover:bg-[#1A2438]">
            取消
          </button>
          <button onClick={handleRun} disabled={processing || !files.length || !selLevel}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[#A78BFA]/20 border border-[#A78BFA]/40 text-[#A78BFA] hover:bg-[#A78BFA]/30 disabled:opacity-40">
            {processing ? <><Loader2 size={12} className="animate-spin inline mr-1" />計算中…</> : `計算並寫入 (${files.length} 檔)`}
          </button>
        </div>
      </div>
    </div>
  );
}
