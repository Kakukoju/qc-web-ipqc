/**
 * 模組計算 – Module Calculation
 *
 * 模組 = 自定義 marker 在試劑卡匣內 w2~w22 的組合，marker 必須在待檢驗區內
 * 子功能：選擇模板 / 定義模板
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, Save, Loader2, CheckCircle, PlusCircle, Trash2, X } from 'lucide-react';
import { fetchTemplates, saveTemplate, deleteTemplate, type TestTemplate, type WellAssignment, type MarkerLotInfo } from '../../api/template';
import { fetchCalRules, fetchCsAssign, fetchRawdata, updateRawdataRow, updateRawdataMeta, syncQcTables, type CalRule, type CsAssignRow, type RawDataRow } from '../../api/rawdata';
import { fetchPendingInspection, activateInspection, type PendingInspection } from '../../api/schedule';
import type { MarkerConfig, EngineOptions } from './ipqc_od_engine';
import { calculateSample } from './ipqc_od_engine';
import { csvFileToMatrix } from './csvCalculationPipeline';
import { normalizeMarkerName } from './markerRuleBook';
import { computeConcentrations } from './odToConc';

const WELL_NUMS = Array.from({ length: 21 }, (_, i) => i + 2); // w2..w22
const WELL_FIELDS = WELL_NUMS.map(n => `w${n}`) as Array<`w${number}`>;

type SubTab = 'select' | 'define';

interface OdRow {
  level: string;
  comboIdx: number;
  values: (number | null)[]; // index 0 = W2, index 20 = W22
}

function findRule(markerName: string, rules: CalRule[]): CalRule | undefined {
  const norm = normalizeMarkerName(markerName);
  return rules.find(r => normalizeMarkerName(r.marker) === norm)
    || rules.find(r => normalizeMarkerName(r.marker) === norm.replace(/-[A-Z]$/, ''))
    || rules.find(r => normalizeMarkerName(r.marker) === norm.replace(/^[TNGQ](?=[A-Z])/, ''));
}

function buildConfigsFromTemplate(tmpl: TestTemplate, rules: CalRule[]): MarkerConfig[] {
  const configs: MarkerConfig[] = [];
  for (const w of tmpl.wells) {
    if (!w.assignment || w.assignment === 'Blank') continue;
    const rule = findRule(w.assignment, rules);
    if (!rule) continue;
    configs.push({
      colIndex: w.wellNum - 1,
      name: normalizeMarkerName(w.assignment),
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

export default function TemplateCalculation() {
  const [subTab, setSubTab] = useState<SubTab>('select');
  const [pendingMarkers, setPendingMarkers] = useState<PendingInspection[]>([]);

  useEffect(() => {
    fetchPendingInspection().then(setPendingMarkers).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-tab toggle */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-[#1E3050] shrink-0">
        {(['select', 'define'] as SubTab[]).map(t => (
          <button key={t} onClick={() => setSubTab(t)}
            className={`px-3 py-1 text-[11px] rounded font-medium transition-colors ${
              subTab === t ? 'bg-[#4DA3FF]/15 text-[#4DA3FF] border border-[#4DA3FF]/30' : 'text-[#93A4C3] hover:text-[#EAF2FF]'
            }`}>
            {t === 'select' ? '選擇模板' : '定義模板'}
          </button>
        ))}
      </div>

      {subTab === 'select' ? (
        <SelectTemplate pendingMarkers={pendingMarkers} />
      ) : (
        <DefineTemplate pendingMarkers={pendingMarkers} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 選擇模板
// ═══════════════════════════════════════════════════════════════════════
function SelectTemplate({ pendingMarkers }: { pendingMarkers: PendingInspection[] }) {
  const [templates, setTemplates] = useState<TestTemplate[]>([]);
  const [selTmpl, setSelTmpl] = useState<TestTemplate | null>(null);
  const [markerLots, setMarkerLots] = useState<Record<string, MarkerLotInfo>>({});
  const [calRules, setCalRules] = useState<CalRule[]>([]);
  const [csData, setCsData] = useState<CsAssignRow[]>([]);
  const [odRows, setOdRows] = useState<OdRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [showLoadCsv, setShowLoadCsv] = useState(false);

  useEffect(() => {
    fetchTemplates().then(setTemplates).catch(() => {});
    fetchCalRules().then(setCalRules).catch(() => {});
    fetchCsAssign().then(setCsData).catch(() => {});
  }, []);

  const LEVELS = ['L1 OD', 'L2 OD', 'N1 OD', 'N3 OD'];

  const selectTemplate = useCallback((t: TestTemplate) => {
    setSelTmpl(t);
    setResult(null);
    // Initialize empty OD grid: 1 row per level
    setOdRows(LEVELS.map(level => ({ level, comboIdx: 0, values: new Array(WELL_NUMS.length).fill(null) })));
    // Prefill lots from pending markers
    const lots: Record<string, MarkerLotInfo> = {};
    for (const m of t.markers) {
      const pi = pendingMarkers.find(p => p.bead_name === m);
      lots[m] = { lot: pi?.bigD_lot || '', work_order: pi?.bigD_work_order || '' };
    }
    setMarkerLots(lots);
  }, [pendingMarkers]);

  const setField = (marker: string, field: keyof MarkerLotInfo, val: string) => {
    setMarkerLots(prev => ({ ...prev, [marker]: { ...prev[marker], [field]: val } }));
  };

  const sheetName = selTmpl ? selTmpl.markers.map(m => {
    const pi = pendingMarkers.find(p => p.bead_name === m);
    return pi?.sheet_name || '';
  }).filter(Boolean).join(' / ') : '';

  // Load CSV via modal → calculate OD for selected level (multiple files = multiple combos)
  const handleCsvApply = useCallback(async (files: File[], level: string) => {
    if (!files.length || !selTmpl) return;
    setProcessing(true);
    setResult(null);
    try {
      const configs = buildConfigsFromTemplate(selTmpl, calRules);
      if (!configs.length) throw new Error('模板中無有效 marker 規則');
      const options: EngineOptions = { alpControl: false, saPanel: false };

      // Each file = one combo row for the selected level
      const newRows: OdRow[] = [];
      for (let fi = 0; fi < files.length; fi++) {
        const matrix = await csvFileToMatrix(files[fi]);
        const sample = calculateSample(matrix, configs, options);
        const values: (number | null)[] = new Array(WELL_NUMS.length).fill(null);
        for (let mi = 0; mi < sample.markers.length; mi++) {
          const cfg = configs[mi];
          if (!cfg) continue;
          const wellIdx = cfg.colIndex - 1;
          if (wellIdx >= 0 && wellIdx < WELL_NUMS.length) values[wellIdx] = sample.markers[mi].finalValue;
        }
        newRows.push({ level, comboIdx: fi, values });
      }

      // Replace rows for this level, keep other levels
      setOdRows(prev => [
        ...prev.filter(r => r.level !== level),
        ...newRows,
      ].sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.comboIdx - b.comboIdx));
    } catch (err) {
      alert('CSV 計算失敗: ' + String(err));
    } finally {
      setProcessing(false);
    }
  }, [selTmpl, calRules]);

  // Save: trigger activate for each marker's pending inspection → update meta → write OD to resulting rawdata
  const handleSave = useCallback(async () => {
    if (!selTmpl || !odRows.some(r => r.values.some(v => v !== null))) return;
    setSaving(true);
    setResult(null);
    try {
      const wellsByMarker = new Map<string, number[]>();
      for (const w of selTmpl.wells) {
        if (!w.assignment || w.assignment === 'Blank') continue;
        if (!wellsByMarker.has(w.assignment)) wellsByMarker.set(w.assignment, []);
        wellsByMarker.get(w.assignment)!.push(w.wellNum);
      }

      // Find blank wells from template
      const blankWells = selTmpl.wells.filter(w => w.assignment === 'Blank').map(w => w.wellNum);

      const savedMarkers: string[] = [];

      for (const marker of selTmpl.markers) {
        const markerWells = wellsByMarker.get(marker) || [];
        if (!markerWells.length) continue;

        // 1. Find pending inspection item for this marker
        const pi = pendingMarkers.find(p => p.bead_name === marker);
        if (!pi) throw new Error(`找不到 ${marker} 的待檢驗項目`);

        // 2. Trigger activate (creates rawdata skeleton + meta from base marker)
        const activated = await activateInspection(
          pi.id,
          { crack: 'PASS', dirt: 'PASS', color: 'PASS' },
        );
        const markerSheet = activated.sheet_name;

        // 3. Create sheet-specific meta based on template well config
        const rule = findRule(marker, calRules);
        const metaWells: Array<{ well: string; row1: string | null; row2: string | null; row3: string | null }> = [];
        for (const wn of blankWells) {
          metaWells.push({ well: `W${wn}`, row1: 'Blank', row2: rule ? `CH${rule['主波 (CH)'] || 1}` : 'CH1', row3: '1-0' });
        }
        for (const wn of markerWells) {
          const ch1 = rule ? (rule['主波 (CH)'] || '') : '';
          const ch2 = rule ? (rule['副波 (CH)'] || '') : '';
          const row2 = ch2 ? `CH${ch1}-CH${ch2}` : `CH${ch1}`;
          const seq1 = rule ? (rule['Seq 1 (圈數)'] || '') : '';
          const seq2 = rule ? (rule['Seq 2 (圈數)'] || '') : '';
          const row3 = seq2 ? `${seq1}-${seq2}` : `${seq1}-0`;
          metaWells.push({ well: `W${wn}`, row1: marker, row2, row3 });
        }
        await updateRawdataMeta(marker, metaWells, markerSheet);

        // 4. Fetch rawdata for this marker + sheet, write OD values
        const { rows: rawRows } = await fetchRawdata(marker, markerSheet);
        if (!rawRows.length) continue;

        const updates: RawDataRow[] = [];
        for (const odRow of odRows) {
          if (!odRow.values.some(v => v !== null)) continue;
          const targetRow = rawRows.find(r =>
            r.table_type === 'well_od' && r.level === odRow.level && r.combo_idx === odRow.comboIdx
          );
          if (!targetRow) continue;
          const updated = { ...targetRow };
          for (const wn of markerWells) {
            const odIdx = wn - 2;
            (updated as any)[`w${wn}`] = odRow.values[odIdx];
          }
          // Also write blank well OD
          for (const wn of blankWells) {
            const odIdx = wn - 2;
            if (odRow.values[odIdx] !== null) (updated as any)[`w${wn}`] = odRow.values[odIdx];
          }
          updates.push(updated);
        }

        for (const row of updates) {
          const changes: Record<string, any> = {};
          for (const f of WELL_FIELDS) changes[f] = (row as any)[f];
          await updateRawdataRow(row.id, changes);
        }

        // 5. Compute concentrations
        const { rows: allRows } = await fetchRawdata(marker, markerSheet);
        const concUpdates = computeConcentrations(allRows, marker, csData);
        for (const row of concUpdates) {
          const changes: Record<string, any> = {};
          for (const f of WELL_FIELDS) changes[f] = (row as any)[f];
          await updateRawdataRow(row.id, changes);
        }

        await syncQcTables(marker, markerSheet).catch(() => {});
        savedMarkers.push(`${marker}/${markerSheet}`);
      }

      setResult(`已存入: ${savedMarkers.join(', ')}`);
    } catch (err) {
      alert('存檔失敗: ' + String(err));
    } finally {
      setSaving(false);
    }
  }, [selTmpl, odRows, pendingMarkers, calRules, csData]);

  // Well → marker color map
  const wellMarkerMap = new Map<number, string>();
  if (selTmpl) for (const w of selTmpl.wells) if (w.assignment && w.assignment !== 'Blank') wellMarkerMap.set(w.wellNum, w.assignment);
  const palette = ['#4DA3FF', '#A78BFA', '#00D4AA', '#FF9F43', '#FF5C73', '#67E8F9'];
  const markerColors: Record<string, string> = {};
  if (selTmpl) selTmpl.markers.forEach((m, i) => { markerColors[m] = palette[i % palette.length]; });

  const inputClass = 'bg-[#0d1f3a] border border-[#2A3754] text-[#D4E8FF] text-xs rounded px-2 py-1 focus:outline-none focus:border-[#4DA3FF]';

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#1E3050] shrink-0 flex-wrap">
        <span className="text-xs text-[#556A88]">模板</span>
        <select value={selTmpl?.id || ''} onChange={e => {
          const t = templates.find(t => t.id === Number(e.target.value));
          if (t) selectTemplate(t);
        }} className={inputClass}>
          <option value="">選擇模板…</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name} ({t.markers.join(', ')})</option>)}
        </select>
        {selTmpl && (
          <>
            <button onClick={() => setShowLoadCsv(true)} disabled={processing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#A78BFA]/10 border border-[#A78BFA]/30 text-[#A78BFA] hover:bg-[#A78BFA]/20 disabled:opacity-40">
              {processing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              Load CSV
            </button>
            {odRows.some(r => r.values.some(v => v !== null)) && (
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#00D4AA]/20 border border-[#00D4AA]/40 text-[#00D4AA] hover:bg-[#00D4AA]/30 disabled:opacity-40">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                存檔至各 Marker
              </button>
            )}
          </>
        )}
      </div>

      {result && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[#00D4AA]/10 border-b border-[#00D4AA]/20 text-xs text-[#00D4AA]">
          <CheckCircle size={14} /> {result}
        </div>
      )}

      {/* Marker lot inputs */}
      {selTmpl && (
        <div className="flex items-center gap-4 px-4 py-2 border-b border-[#1E3050] shrink-0 flex-wrap">
          {selTmpl.markers.map(m => (
            <div key={m} className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold" style={{ color: markerColors[m] }}>{m}</span>
              <input value={markerLots[m]?.lot || ''} onChange={e => setField(m, 'lot', e.target.value)}
                className={inputClass + ' w-24'} placeholder="lot" />
              <input value={markerLots[m]?.work_order || ''} onChange={e => setField(m, 'work_order', e.target.value)}
                className={inputClass + ' w-20'} placeholder="工單" />
            </div>
          ))}
          {sheetName && <span className="text-[10px] text-[#556A88] ml-auto">Sheet: <span className="text-[#93A4C3] font-mono">{sheetName}</span></span>}
        </div>
      )}

      {/* OD Grid */}
      <div className="flex-1 overflow-auto p-3">
        {!selTmpl ? (
          <div className="flex items-center justify-center h-full text-[#3A5070] text-sm">請先選擇模板</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr className="bg-[#0e2346]">
                  <th className="px-2 py-1 text-left text-[#7BA8D4] border border-[#2A3754] w-16 sticky left-0 bg-[#0e2346] z-10">CS Type</th>
                  {selTmpl.markers.map(m => (
                    <th key={m} className="px-2 py-1 text-center border border-[#2A3754] min-w-[80px]"
                      style={{ color: markerColors[m] }}>
                      {m} Lot
                    </th>
                  ))}
                  {WELL_NUMS.map(wn => {
                    const marker = wellMarkerMap.get(wn);
                    const color = marker ? markerColors[marker] : '#2A3754';
                    return (
                      <th key={wn} className="px-1 py-1 text-center border border-[#2A3754] min-w-[54px]" style={{ color, borderBottomColor: color }}>
                        <div className="text-[9px]">{marker || ''}</div>
                        <div className="text-[10px] text-[#556A88]">W{wn}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {odRows.map((row, ri) => {
                  const isFirstOfLevel = ri === 0 || odRows[ri - 1].level !== row.level;
                  const levelRowCount = odRows.filter(r => r.level === row.level).length;
                  return (
                    <tr key={`${row.level}-${row.comboIdx}`} className="border-b border-[#1A2438]/40 hover:bg-[#1A2438]/30">
                      {isFirstOfLevel && (
                        <td rowSpan={levelRowCount} className="px-2 py-1.5 text-[#4DA3FF] font-medium border border-[#2A3754] sticky left-0 bg-[#0F1A2E] z-10 align-top">{row.level}</td>
                      )}
                      {selTmpl.markers.map(m => (
                        <td key={m} className="px-1 py-1.5 text-center text-[10px] font-mono border border-[#2A3754]"
                          style={{ color: markerColors[m] }}>
                          {markerLots[m]?.lot || '—'}
                        </td>
                      ))}
                      {row.values.map((v, ci) => {
                        const wn = ci + 2;
                        const marker = wellMarkerMap.get(wn);
                        const color = marker ? markerColors[marker] : undefined;
                        return (
                          <td key={ci} className="px-1 py-1.5 text-center font-mono border border-[#2A3754] cursor-text"
                            style={{ color: v !== null ? (color || '#EAF2FF') : '#2A3754' }}
                            onDoubleClick={() => {
                              const val = prompt(`W${wn} ${row.level}`, v !== null ? String(v) : '');
                              if (val === null) return;
                              const num = val.trim() === '' ? null : parseFloat(val);
                              setOdRows(prev => prev.map((r, idx) => idx === ri
                                ? { ...r, values: r.values.map((old, i) => i === ci ? (num !== null && !isNaN(num) ? num : null) : old) }
                                : r
                              ));
                            }}>
                            {v !== null ? v.toFixed(4) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="px-4 py-1.5 border-t border-[#1E3050] text-[10px] text-[#3A5070] shrink-0">
        模組計算：選模板 → Load CSV (每個 Level 各一檔) → 顯示 OD → 存檔寫入各 marker 的 rawdata 並計算濃度
      </div>

      {/* Load CSV Modal */}
      {showLoadCsv && selTmpl && (
        <ModuleLoadCsvModal
          levels={LEVELS}
          odRows={odRows}
          onApply={handleCsvApply}
          onClose={() => setShowLoadCsv(false)}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Load CSV Modal – 與原始數據 LoadCsvModal 相同介面
// ═══════════════════════════════════════════════════════════════════════

function ModuleLoadCsvModal({ levels, odRows, onApply, onClose }: {
  levels: string[];
  odRows: OdRow[];
  onApply: (files: File[], level: string) => Promise<void>;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [selLevel, setSelLevel] = useState(levels[0] ?? '');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const existingCount = odRows.filter(r => r.level === selLevel && r.values.some(v => v !== null)).length;

  const handleRun = async () => {
    if (!files.length || !selLevel) return;
    setProcessing(true);
    setError('');
    try {
      await onApply(files, selLevel);
      onClose();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setProcessing(false);
    }
  };

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
            <input ref={fileRef} type="file" accept=".csv" multiple onChange={e => { setFiles(Array.from(e.target.files ?? [])); setError(''); }} className="hidden" />
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
                <button key={lv} onClick={() => setSelLevel(lv)}
                  className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors
                    ${selLevel === lv
                      ? 'bg-[#4DA3FF]/20 border-[#4DA3FF] text-[#4DA3FF]'
                      : 'bg-[#0d1f3a] border-[#2A3754] text-[#556A88] hover:text-[#93A4C3]'}`}>
                  {lv}
                </button>
              ))}
            </div>
          </div>

          <div className="text-[10px] text-[#556A88]">
            已選 {files.length} 檔 · 此 Level 已有 {existingCount} 筆資料
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

// ═══════════════════════════════════════════════════════════════════════
// 定義模板 – markers 限定從待檢驗區選擇, wells w2~w22
// ═══════════════════════════════════════════════════════════════════════
function DefineTemplate({ pendingMarkers }: { pendingMarkers: PendingInspection[] }) {
  const [templates, setTemplates] = useState<TestTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [wells, setWells] = useState<WellAssignment[]>([]);
  const [saving, setSaving] = useState(false);

  const availableMarkers = [...new Set(pendingMarkers.map(p => p.bead_name))];

  const reload = () => {
    setLoading(true);
    fetchTemplates().then(t => { setTemplates(t); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(reload, []);

  const startNew = () => {
    setSelId(null);
    setName('');
    setWells(WELL_NUMS.map(w => ({ wellNum: w, assignment: '' })));
  };

  const loadTemplate = (t: TestTemplate) => {
    setSelId(t.id);
    setName(t.name);
    const map = new Map(t.wells.map(w => [w.wellNum, w.assignment]));
    setWells(WELL_NUMS.map(w => ({ wellNum: w, assignment: map.get(w) || '' })));
  };

  const setAssignment = (wellNum: number, val: string) => {
    setWells(prev => prev.map(w => w.wellNum === wellNum ? { ...w, assignment: val } : w));
  };

  const markers = [...new Set(wells.map(w => w.assignment).filter(a => a && a !== 'Blank'))];

  const handleSave = async () => {
    if (!name.trim()) { alert('請輸入模板名稱'); return; }
    const activeWells = wells.filter(w => w.assignment);
    if (!activeWells.length) { alert('請至少設定一個 well'); return; }
    setSaving(true);
    try {
      await saveTemplate(name.trim(), markers, activeWells);
      reload();
    } catch (e) { alert('儲存失敗: ' + String(e)); }
    setSaving(false);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('確定刪除此模板？')) return;
    await deleteTemplate(id).catch(e => alert('刪除失敗: ' + String(e)));
    if (selId === id) startNew();
    reload();
  };

  const inputClass = 'bg-[#0d1f3a] border border-[#2A3754] text-[#D4E8FF] text-xs rounded px-2 py-1 focus:outline-none focus:border-[#4DA3FF]';
  const palette = ['#4DA3FF', '#A78BFA', '#00D4AA', '#FF9F43', '#FF5C73', '#67E8F9'];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: template list */}
      <div className="w-48 border-r border-[#1E3050] flex flex-col shrink-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#1E3050]">
          <span className="text-xs text-[#93A4C3] font-medium">模板列表</span>
          <button onClick={startNew} className="text-[#4DA3FF] hover:text-[#7BC0FF]"><PlusCircle size={14} /></button>
        </div>
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex justify-center py-4"><Loader2 size={14} className="animate-spin text-[#556A88]" /></div>
          ) : templates.map(t => (
            <div key={t.id} onClick={() => loadTemplate(t)}
              className={`flex items-center justify-between px-3 py-2 text-xs cursor-pointer border-b border-[#1A2438]/40
                ${selId === t.id ? 'bg-[#4DA3FF]/10 text-[#4DA3FF]' : 'text-[#93A4C3] hover:bg-[#1A2438]/40'}`}>
              <span className="truncate">{t.name}</span>
              <button onClick={e => { e.stopPropagation(); handleDelete(t.id); }}
                className="text-[#3A5070] hover:text-red-400 shrink-0 ml-1"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* Right: editor */}
      <div className="flex-1 overflow-auto p-4">
        {wells.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#3A5070] text-sm">選擇模板或點 + 新增</div>
        ) : (
          <div className="flex flex-col gap-4 max-w-3xl">
            <div>
              <label className="text-[10px] text-[#556A88] block mb-1">模板名稱</label>
              <input value={name} onChange={e => setName(e.target.value)} className={inputClass + ' w-60'} placeholder="e.g. K-ALT" />
            </div>

            <div>
              <label className="text-[10px] text-[#556A88] block mb-1">
                Well 配置（從待檢驗 marker 選擇，Blank=空白扣除）
              </label>
              <div className="grid grid-cols-7 gap-1.5">
                {wells.map(w => (
                  <div key={w.wellNum} className="flex flex-col gap-0.5">
                    <span className="text-[9px] text-[#3A5070] text-center">W{w.wellNum}</span>
                    <select value={w.assignment} onChange={e => setAssignment(w.wellNum, e.target.value)}
                      className={`${inputClass} text-center text-[10px] py-0.5 px-1 ${
                        w.assignment === 'Blank' ? 'text-[#556A88] italic' :
                        w.assignment ? 'text-[#4DA3FF] font-medium' : ''
                      }`}>
                      <option value="">—</option>
                      <option value="Blank">Blank</option>
                      {availableMarkers.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {markers.length > 0 && (
              <div className="text-[10px] text-[#93A4C3]">
                Markers: {markers.map((m, i) => (
                  <span key={m} style={{ color: palette[i % palette.length] }} className="font-medium">
                    {i > 0 && ', '}{m}
                    <span className="text-[#556A88]">
                      ({wells.filter(w => w.assignment === m).map(w => 'W' + w.wellNum).join(',')})
                    </span>
                  </span>
                ))}
              </div>
            )}

            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium w-fit bg-[#1A5BB5] text-white hover:bg-[#2070D0] disabled:opacity-40">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {selId ? '更新模板' : '建立模板'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
