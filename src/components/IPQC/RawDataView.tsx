/**
 * RawDataView – Marker → Sheet selector + 4-tab table grid.
 * Lives inside IPQCWorkbench under the "原始數據" tab.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Trash2, Edit3 } from 'lucide-react';
import RawDataGrid from './RawDataGrid';
import {
  fetchRawdataMarkers, fetchRawdataSheets, fetchRawdata, updateRawdataRow, syncQcTables,
  fetchBeadReagents, deleteSheet, renameSheet,
  type RawDataRow, type ColMeta,
} from '../../api/rawdata';

type TableType = 'well_od' | 'od_corrected' | 'ind_batch' | 'all_batch';

const TABLE_TABS: { type: TableType; label: string }[] = [
  { type: 'well_od',      label: '① Well OD 計算' },
  { type: 'od_corrected', label: '② OD 相扣計算' },
  { type: 'ind_batch',    label: '③ 個別批次' },
  { type: 'all_batch',    label: '④ 全批次' },
];

export default function RawDataView({ initMarker, initSheet, year, onSelectionChange }: { initMarker?: string; initSheet?: string; year?: string; onSelectionChange?: (marker: string | null, sheet: string | null) => void }) {
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
  const [editingSheetName, setEditingSheetName] = useState(false);
  const [sheetDraft, setSheetDraft] = useState('');

  // dirty rows: id → latest full row
  const dirtyRef = useRef<Map<number, RawDataRow>>(new Map());
  const [dirtyCount, setDirtyCount] = useState(0);
  const [saving, setSaving] = useState(false);

  // Load markers + bead-reagent map on mount
  useEffect(() => {
    fetchRawdataMarkers(year).then(m => {
      setMarkers(m);
      const pick = initMarker && m.includes(initMarker) ? initMarker : m[0] || '';
      setSelMarker(pick);
    });
    fetchBeadReagents().then(data => {
      setReagentMap(new Map(data.map(d => [d.bead_name, d.n_reagents])));
    }).catch(() => {});
  }, [year]); // eslint-disable-line

  // Marker changed → load sheets
  useEffect(() => {
    if (!selMarker) return;
    setSelSheet('');
    setRows([]);
    setMeta([]);
    fetchRawdataSheets(selMarker, year).then(s => {
      setSheets(s);
      const pick = selMarker === initMarker && initSheet && s.includes(initSheet) ? initSheet : s[0] || '';
      setSelSheet(pick);
    });
  }, [selMarker, year]); // eslint-disable-line

  // Sheet selected → notify parent
  useEffect(() => {
    onSelectionChange?.(selMarker || null, selSheet || null);
  }, [selMarker, selSheet]); // eslint-disable-line

  // Sheet selected → load data
  useEffect(() => {
    if (!selMarker || !selSheet) return;
    setLoading(true);
    fetchRawdata(selMarker, selSheet, year)
      .then(({ rows: r, meta: m }) => { setRows(r); setMeta(m); dirtyRef.current.clear(); setDirtyCount(0); })
      .finally(() => setLoading(false));
  }, [selMarker, selSheet, year]);

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


  // Refetch data for current marker+sheet (called after expanding combos)
  const handleRefresh = useCallback(() => {
    if (!selMarker || !selSheet) return;
    setLoading(true);
    fetchRawdata(selMarker, selSheet, year)
      .then(({ rows: r, meta: m }) => { setRows(r); setMeta(m); dirtyRef.current.clear(); setDirtyCount(0); })
      .finally(() => setLoading(false));
  }, [selMarker, selSheet, year]);

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
          {editingSheetName ? (
            <form onSubmit={async e => {
              e.preventDefault();
              const newName = sheetDraft.trim();
              if (!newName || newName === selSheet) { setEditingSheetName(false); return; }
              try {
                await renameSheet(selMarker, selSheet, newName);
                const newSheets = await fetchRawdataSheets(selMarker, year);
                setSheets(newSheets);
                setSelSheet(newName);
              } catch (err) { alert('重新命名失敗: ' + String(err)); }
              setEditingSheetName(false);
            }} className="flex items-center gap-1">
              <input
                autoFocus
                value={sheetDraft}
                onChange={e => setSheetDraft(e.target.value)}
                onBlur={() => setEditingSheetName(false)}
                onKeyDown={e => { if (e.key === 'Escape') setEditingSheetName(false); }}
                className="bg-[#0d1f3a] border border-[#4DA3FF] text-[#D4E8FF] text-xs rounded px-2 py-1 focus:outline-none w-40"
              />
            </form>
          ) : (
            <select
              value={selSheet}
              onChange={e => setSelSheet(e.target.value)}
              className="bg-[#0d1f3a] border border-[#2A3754] text-[#D4E8FF] text-xs rounded px-2 py-1 focus:outline-none focus:border-[#4DA3FF] max-w-50"
            >
              {sheets.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {selSheet && !editingSheetName && (
            <button
              onClick={() => { setSheetDraft(selSheet); setEditingSheetName(true); }}
              title="重新命名 Sheet"
              className="text-[#3A5070] hover:text-[#4DA3FF] transition-colors"
            >
              <Edit3 size={14} />
            </button>
          )}
          {selSheet && (
            <button
              onClick={async () => {
                if (!confirm(`確定刪除 ${selMarker} / ${selSheet} 的原始數據？`)) return;
                try {
                  await deleteSheet(selMarker, selSheet);
                  const newSheets = await fetchRawdataSheets(selMarker, year);
                  setSheets(newSheets);
                  setSelSheet(newSheets[0] || '');
                } catch (e) { alert('刪除失敗: ' + String(e)); }
              }}
              title="刪除 Sheet"
              className="text-[#3A5070] hover:text-red-400 transition-colors"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>

        {/* 批號組合 summary */}
        {!loading && rows.length > 0 && (() => {
          const n = reagentMap.get(selMarker) ?? 1;
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
