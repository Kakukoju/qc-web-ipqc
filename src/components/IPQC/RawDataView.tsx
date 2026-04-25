/**
 * RawDataView – Marker → Sheet selector + 4-tab table grid.
 * Lives inside IPQCWorkbench under the "原始數據" tab.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, PlusCircle, X } from 'lucide-react';
import RawDataGrid from './RawDataGrid';
import {
  fetchRawdataMarkers, fetchRawdataSheets, fetchRawdata, updateRawdataRow, syncQcTables,
  fetchBeadReagents, createSheet,
  type RawDataRow, type ColMeta, type SheetCombo,
} from '../../api/rawdata';

// ── Sheet-name auto-generation (mirrors Python normalize_sheet_name) ─────────
function autoSheetName(joined: string): string {
  const n = joined.length;
  if (n < 8 || n % 8 !== 0) return joined;
  const chunks = Array.from({ length: n / 8 }, (_, i) => joined.slice(i * 8, (i + 1) * 8));
  const yw = chunks[0].slice(3, 7);
  if (/^\d{4}$/.test(yw) && chunks.every(c => c.slice(3, 7) === yw && /^[A-Za-z0-9]$/.test(c[7]))) {
    return yw + chunks.map(c => c[7]).join('');
  }
  return joined;
}

// ── NewSheetModal ────────────────────────────────────────────────────────────
function NewSheetModal({
  defaultBead, nReagents, allMarkers,
  onClose, onCreated,
}: {
  defaultBead: string;
  nReagents: number;
  allMarkers: string[];
  onClose: () => void;
  onCreated: (bead: string, sheet: string) => void;
}) {
  const [beadName, setBeadName]   = useState(defaultBead);
  const [sheetName, setSheetName] = useState('');
  const [userEditedSheet, setUserEditedSheet] = useState(false);
  const [saving, setSaving] = useState(false);

  // For n=1: one textarea (lots, one per line) — prefill with example
  const [lots1, setLots1] = useState(nReagents === 1 ? '2352614W\n2352614X\n2352614Y\n2352614Z' : '');
  // For n=2/3: separate columns — prefill with example
  const [dLots,  setDLots]  = useState(nReagents >= 2 ? 'D-Lot1\nD-Lot2' : '');
  const [d2Lots, setD2Lots] = useState(nReagents === 3 ? 'D2-Lot1\nD2-Lot2' : '');
  const [uLots,  setULots]  = useState(nReagents >= 2 ? 'U-Lot1\nU-Lot2' : '');

  // Auto-generate sheet name from lots
  useEffect(() => {
    if (userEditedSheet) return;
    let joined = '';
    if (nReagents === 1) {
      joined = lots1.split('\n').map(s => s.trim()).filter(Boolean).join('');
    } else {
      const dl  = dLots.split('\n').map(s => s.trim()).filter(Boolean);
      const d2l = d2Lots.split('\n').map(s => s.trim()).filter(Boolean);
      const ul  = uLots.split('\n').map(s => s.trim()).filter(Boolean);
      const n = nReagents === 3
        ? Math.min(dl.length, d2l.length, ul.length)
        : Math.min(dl.length, ul.length);
      for (let i = 0; i < n; i++) {
        joined += nReagents === 3 ? dl[i] + d2l[i] + ul[i] : dl[i] + ul[i];
      }
    }
    setSheetName(joined ? autoSheetName(joined) : '');
  }, [lots1, dLots, d2Lots, uLots, nReagents, userEditedSheet]);

  function buildCombos(): SheetCombo[] | null {
    if (nReagents === 1) {
      const lots = lots1.split('\n').map(s => s.trim()).filter(Boolean);
      if (!lots.length) return null;
      return lots.map(l => ({ lot_id: l, ctrl_lot: null }));
    }
    const dl  = dLots.split('\n').map(s => s.trim()).filter(Boolean);
    const d2l = d2Lots.split('\n').map(s => s.trim()).filter(Boolean);
    const ul  = uLots.split('\n').map(s => s.trim()).filter(Boolean);
    const n = nReagents === 3
      ? Math.min(dl.length, d2l.length, ul.length)
      : Math.min(dl.length, ul.length);
    if (!n) return null;
    return Array.from({ length: n }, (_, i) => ({
      lot_id: nReagents === 3
        ? dl[i] + d2l[i] + ul[i]
        : dl[i] + ul[i],
      ctrl_lot: null,
    }));
  }

  async function handleCreate() {
    if (!beadName.trim() || !sheetName.trim()) return;
    const combos = buildCombos();
    if (!combos) { alert('請至少輸入一筆 Lot'); return; }
    setSaving(true);
    try {
      await createSheet(beadName.trim(), sheetName.trim(), combos);
      onCreated(beadName.trim(), sheetName.trim());
    } catch (e) {
      alert('建立失敗: ' + String(e));
    } finally {
      setSaving(false);
    }
  }

  const reagentLabels = nReagents === 3
    ? ['D-Lot', 'D₂-Lot', 'U-Lot']
    : nReagents === 2 ? ['D-Lot', 'U-Lot'] : ['Lot'];

  const textareaClass = 'bg-white border border-[#2A3754] text-[#0a1628] text-xs rounded px-2 py-1.5 w-full font-mono resize-none focus:outline-none focus:border-[#4DA3FF]';
  const inputClass    = 'bg-white border border-[#2A3754] text-[#0a1628] text-xs rounded px-2 py-1 w-full font-mono focus:outline-none focus:border-[#4DA3FF]';
  const sheetInputClass = 'bg-white border border-[#4DA3FF] text-[#0a1628] text-xs rounded px-2 py-1 w-full font-mono focus:outline-none focus:border-[#2070D0] focus:ring-1 focus:ring-[#4DA3FF]';
  const labelClass    = 'text-[10px] text-[#556A88] mb-1 block';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#0d1f3a] border border-[#2A3754] rounded-lg w-[480px] shadow-2xl"
           onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E3050]">
          <span className="text-sm font-medium text-[#D4E8FF]">新增 Sheet</span>
          <button onClick={onClose} className="text-[#556A88] hover:text-[#93A4C3]"><X size={14} /></button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          {/* Bead name */}
          <div>
            <label className={labelClass}>Marker (Bead Name)</label>
            <input
              list="bead-list"
              value={beadName}
              onChange={e => setBeadName(e.target.value)}
              className={inputClass}
              placeholder="e.g. QPHOS"
            />
            <datalist id="bead-list">
              {allMarkers.map(m => <option key={m} value={m} />)}
            </datalist>
          </div>

          {/* Lot inputs */}
          {nReagents === 1 ? (
            <div>
              <label className={labelClass}>Lots（每行一筆，依生產順序）</label>
              <textarea rows={5} value={lots1} onChange={e => { setLots1(e.target.value); setUserEditedSheet(false); }}
                className={textareaClass} onFocus={e => e.target.select()} />
            </div>
          ) : (
            <div className={`grid gap-2 ${nReagents === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {reagentLabels.map((lbl, idx) => {
                const vals = [dLots, d2Lots, uLots][idx];
                const setters = [setDLots, setD2Lots, setULots][idx];
                return (
                  <div key={lbl}>
                    <label className={labelClass}>{lbl}（每行一筆）</label>
                    <textarea rows={5} value={vals} onChange={e => { setters(e.target.value); setUserEditedSheet(false); }}
                      className={textareaClass} onFocus={e => e.target.select()} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Sheet name */}
          <div>
            <label className={labelClass}>
              Sheet Name
              {!userEditedSheet && (
                <span className="ml-1 text-[#3A5070]">（自動產生，可修改）</span>
              )}
            </label>
            <input
              value={sheetName}
              onChange={e => { setSheetName(e.target.value); setUserEditedSheet(true); }}
              className={sheetInputClass}
              onFocus={e => e.target.select()}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#1E3050]">
          <button onClick={onClose}
            className="px-3 py-1 text-xs text-[#556A88] hover:text-[#93A4C3] border border-[#2A3754] rounded">
            取消
          </button>
          <button onClick={handleCreate} disabled={saving || !beadName.trim() || !sheetName.trim()}
            className="px-3 py-1 text-xs bg-[#1A5BB5] text-white rounded hover:bg-[#2070D0] disabled:opacity-40">
            {saving ? '建立中…' : '建立'}
          </button>
        </div>
      </div>
    </div>
  );
}

type TableType = 'well_od' | 'od_corrected' | 'ind_batch' | 'all_batch';

const TABLE_TABS: { type: TableType; label: string }[] = [
  { type: 'well_od',      label: '① Well OD 計算' },
  { type: 'od_corrected', label: '② OD 相扣計算' },
  { type: 'ind_batch',    label: '③ 個別批次' },
  { type: 'all_batch',    label: '④ 全批次' },
];

export default function RawDataView({ initMarker, initSheet, onSelectionChange }: { initMarker?: string; initSheet?: string; onSelectionChange?: (marker: string | null, sheet: string | null) => void }) {
  const [markers, setMarkers] = useState<string[]>([]);
  const [selMarker, setSelMarker] = useState('');
  const [sheets, setSheets] = useState<string[]>([]);
  const [selSheet, setSelSheet] = useState('');
  const [tableTab, setTableTab] = useState<TableType>('well_od');

  // tCREA defaults to od_corrected tab
  useEffect(() => {
    setTableTab(selMarker === 'tCREA' ? 'od_corrected' : 'well_od');
  }, [selMarker]);

  const [rows, setRows]   = useState<RawDataRow[]>([]);
  const [meta, setMeta]   = useState<ColMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [reagentMap, setReagentMap] = useState<Map<string, number>>(new Map());
  const [showNewSheet, setShowNewSheet] = useState(false);

  // dirty rows: id → latest full row
  const dirtyRef = useRef<Map<number, RawDataRow>>(new Map());
  const [dirtyCount, setDirtyCount] = useState(0);
  const [saving, setSaving] = useState(false);

  // Load markers + bead-reagent map on mount
  useEffect(() => {
    fetchRawdataMarkers().then(m => {
      setMarkers(m);
      const pick = initMarker && m.includes(initMarker) ? initMarker : m[0] || '';
      setSelMarker(pick);
    });
    fetchBeadReagents().then(data => {
      setReagentMap(new Map(data.map(d => [d.bead_name, d.n_reagents])));
    }).catch(() => {});
  }, []); // eslint-disable-line

  // Marker changed → load sheets
  useEffect(() => {
    if (!selMarker) return;
    setSelSheet('');
    setRows([]);
    setMeta([]);
    fetchRawdataSheets(selMarker).then(s => {
      setSheets(s);
      const pick = selMarker === initMarker && initSheet && s.includes(initSheet) ? initSheet : s[0] || '';
      setSelSheet(pick);
    });
  }, [selMarker]); // eslint-disable-line

  // Sheet selected → load data
  useEffect(() => {
    onSelectionChange?.(selMarker || null, selSheet || null);
  }, [selMarker, selSheet]); // eslint-disable-line

  // Sheet selected → load data
  useEffect(() => {
    if (!selMarker || !selSheet) return;
    setLoading(true);
    fetchRawdata(selMarker, selSheet)
      .then(({ rows: r, meta: m }) => { setRows(r); setMeta(m); dirtyRef.current.clear(); setDirtyCount(0); })
      .finally(() => setLoading(false));
  }, [selMarker, selSheet]);

  // Called when a cell is changed locally
  const handleRowChange = useCallback((updated: RawDataRow) => {
    dirtyRef.current.set(updated.id, updated);
    setDirtyCount(dirtyRef.current.size);
    setRows(prev => prev.map(r => r.id === updated.id ? updated : r));
  }, []);

  // Called when multiple rows are changed at once (e.g. Load CSV + concentration calc)
  const handleBatchChange = useCallback((updates: RawDataRow[]) => {
    for (const u of updates) dirtyRef.current.set(u.id, u);
    setDirtyCount(dirtyRef.current.size);
    setRows(prev => {
      const existingIds = new Set(prev.map(r => r.id));
      const map = new Map(updates.map(u => [u.id, u]));
      // Update existing rows
      const updated = prev.map(r => map.get(r.id) ?? r);
      // Append new rows (deduplicated — only first occurrence per id)
      const appended = new Map<number, RawDataRow>();
      for (const u of updates) {
        if (!existingIds.has(u.id) && !appended.has(u.id)) appended.set(u.id, u);
      }
      return appended.size ? [...updated, ...appended.values()] : updated;
    });
  }, []);

  // Called after NewSheetModal creates a sheet
  const handleSheetCreated = useCallback(async (bead: string, sheet: string) => {
    setShowNewSheet(false);
    // Refresh markers (bead might be new)
    const newMarkers = await fetchRawdataMarkers();
    setMarkers(newMarkers);
    setSelMarker(bead);
    // Refresh sheets for this bead
    const newSheets = await fetchRawdataSheets(bead);
    setSheets(newSheets);
    setSelSheet(sheet);
  }, []);

  // Refetch data for current marker+sheet (called after expanding combos)
  const handleRefresh = useCallback(() => {
    if (!selMarker || !selSheet) return;
    setLoading(true);
    fetchRawdata(selMarker, selSheet)
      .then(({ rows: r, meta: m }) => { setRows(r); setMeta(m); dirtyRef.current.clear(); setDirtyCount(0); })
      .finally(() => setLoading(false));
  }, [selMarker, selSheet]);

  // Save all dirty rows + sync to QC tables
  const handleSave = useCallback(async () => {
    if (dirtyRef.current.size === 0) return;
    setSaving(true);
    const toSave = [...dirtyRef.current.values()];
    try {
      await Promise.all(toSave.map(row => {
        const { id, lot_id, ctrl_lot, d_lot, bigD_lot, u_lot, w2, w3, w4, w5, w6, w7, w8, w9, w10, w11, w12, w13, w14, w15, w16, w17, w18, w19 } = row;
        return updateRawdataRow(id, { lot_id, ctrl_lot, d_lot, bigD_lot, u_lot, w2, w3, w4, w5, w6, w7, w8, w9, w10, w11, w12, w13, w14, w15, w16, w17, w18, w19 });
      }));
      setRows(prev => {
        const map = new Map(toSave.map(r => [r.id, r]));
        return prev.map(r => map.get(r.id) ?? r);
      });
      dirtyRef.current.clear();
      setDirtyCount(0);

      // Sync computed stats to drbeadinspection + posts
      if (selMarker && selSheet) {
        await syncQcTables(selMarker, selSheet).catch(e => console.warn('sync-qc:', e));
      }
    } catch (err) {
      alert('儲存失敗: ' + String(err));
    } finally {
      setSaving(false);
    }
  }, [selMarker, selSheet]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Selector bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-[#1E3050] shrink-0 flex-wrap">
        {/* Marker select */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#556A88]">Marker</span>
          <select
            value={selMarker}
            onChange={e => setSelMarker(e.target.value)}
            className="bg-[#0d1f3a] border border-[#2A3754] text-[#D4E8FF] text-xs rounded px-2 py-1 focus:outline-none focus:border-[#4DA3FF]"
          >
            {markers.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* Sheet select */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#556A88]">Sheet</span>
          <select
            value={selSheet}
            onChange={e => setSelSheet(e.target.value)}
            className="bg-[#0d1f3a] border border-[#2A3754] text-[#D4E8FF] text-xs rounded px-2 py-1 focus:outline-none focus:border-[#4DA3FF] max-w-50"
          >
            {sheets.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            onClick={() => setShowNewSheet(true)}
            title="新增 Sheet"
            className="text-[#3A5070] hover:text-[#4DA3FF] transition-colors"
          >
            <PlusCircle size={16} />
          </button>
        </div>

        {/* 批號組合 summary: distinct combos for selected sheet */}
        {!loading && rows.length > 0 && (() => {
          const n = reagentMap.get(selMarker) ?? 1;
          // Get unique (combo_idx, lot_id) from well_od level L1
          const combos = rows
            .filter(r => r.table_type === 'well_od' && r.level !== '' && r.combo_idx !== undefined)
            .reduce((acc, r) => {
              if (!acc.find(x => x.combo_idx === r.combo_idx)) acc.push(r);
              return acc;
            }, [] as typeof rows)
            .sort((a, b) => a.combo_idx - b.combo_idx);
          return (
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-[#3A5070]">批號組合 ({combos.length})</span>
              <div className="flex flex-col gap-0.5 max-h-16 overflow-y-auto">
                {combos.map(r => {
                  const lots = n >= 2
                    ? (n === 3
                        ? [r.d_lot, r.bigD_lot, r.u_lot]
                        : [r.bigD_lot, r.u_lot]
                      ).map(l => l ?? '')
                    : [r.lot_id ?? ''];
                  return (
                    <div key={r.combo_idx} className="flex items-center gap-1">
                      <span className="text-[10px] text-[#3A5070] w-4 shrink-0">{r.combo_idx + 1}</span>
                      <span className="text-[10px] text-[#93A4C3] font-mono">{lots.join(' / ')}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {loading && <Loader2 size={14} className="animate-spin text-[#4DA3FF]" />}

        <div className="text-[10px] text-[#3A5070] ml-auto">
          Ctrl+C 複製 · Ctrl+V 貼上 · Ctrl+S 儲存 · Del 清除 · 雙擊 編輯 · <span className="text-[#4A6A88]">Lot欄空白時 Tab → 帶入預設 Lot</span>
        </div>
      </div>

      {/* Table type tabs */}
      <div className="flex gap-0 px-4 pt-2 border-b border-[#1E3050] shrink-0">
        {TABLE_TABS.map(t => (
          <button
            key={t.type}
            onClick={() => setTableTab(t.type)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px mr-1
              ${tableTab === t.type
                ? 'text-[#4DA3FF] border-[#4DA3FF] bg-[#0d1f3a]'
                : 'text-[#556A88] border-transparent hover:text-[#93A4C3]'
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* New Sheet Modal */}
      {showNewSheet && (
        <NewSheetModal
          defaultBead={selMarker}
          nReagents={reagentMap.get(selMarker) ?? 1}
          allMarkers={markers}
          onClose={() => setShowNewSheet(false)}
          onCreated={handleSheetCreated}
        />
      )}

      {/* Grid area */}
      <div className="flex-1 overflow-hidden p-3">
        {!selSheet ? (
          <div className="flex items-center justify-center h-full text-[#3A5070] text-sm">
            請選擇 Marker 與 Sheet
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-[#556A88]">
            <Loader2 size={16} className="animate-spin" /> 載入中…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#3A5070] text-sm">
            此 Sheet 無原始數據
          </div>
        ) : (
          <RawDataGrid
            tableType={tableTab}
            rows={rows}
            meta={meta}
            beadName={selMarker}
            nReagents={reagentMap.get(selMarker) ?? 1}
            onRowChange={handleRowChange}
            onBatchChange={handleBatchChange}
            onMetaChange={setMeta}
            onRefresh={handleRefresh}
            saving={saving}
            dirtyCount={dirtyCount}
            onSave={handleSave}
          />
        )}
      </div>
    </div>
  );
}
