import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Trash2, Save, Columns, CheckCircle, AlertCircle, Edit2,
} from 'lucide-react';
import {
  fetchCsAssign, updateCsRow, addCsRow, deleteCsRow,
  addCsColumn, deleteCsColumn, pasteCsData, updateCsMeta,
} from '../../api/csassign';
import type { CsMeta } from '../../api/csassign';

type Row = Record<string, unknown> & { id: number; Marker: string };

export default function CsManager() {
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<CsMeta[]>([]);
  const [selected, setSelected] = useState<{ row: number; col: string } | null>(null);
  const [editing, setEditing] = useState<{ row: number; col: string } | null>(null);
  const [editVal, setEditVal] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newColName, setNewColName] = useState('');
  const [showAddCol, setShowAddCol] = useState(false);
  const [newColMeta, setNewColMeta] = useState({ cs_title: '', cs_lot: '', cs_expiry: '' });
  const [editingMeta, setEditingMeta] = useState<string | null>(null);
  const [metaDraft, setMetaDraft] = useState<Partial<CsMeta>>({});
  const tableRef = useRef<HTMLTableElement>(null);

  const load = useCallback(async () => {
    const d = await fetchCsAssign();
    setColumns(d.columns);
    setRows(d.rows as Row[]);
    setMeta(d.meta);
  }, []);

  useEffect(() => { load(); }, [load]);

  const dataCols = columns.filter(c => c !== 'Marker');
  const getMetaFor = (col: string) => meta.find(m => m.col_name === col);

  const fmtVal = (v: unknown): string => {
    const s = String(v);
    const n = Number(s);
    if (s !== '' && !isNaN(n) && s.includes('.')) return n.toFixed(2);
    return s;
  };

  // ── Cell edit ──
  const startEdit = (rowIdx: number, col: string) => {
    setEditing({ row: rowIdx, col });
    setEditVal(String(rows[rowIdx][col] ?? ''));
  };

  const commitEdit = async () => {
    if (!editing) return;
    const row = rows[editing.row];
    if (String(row[editing.col] ?? '') !== editVal) {
      await updateCsRow(row.id, { [editing.col]: editVal || null });
      await load();
    }
    setEditing(null);
  };

  // ── Add row ──
  const handleAddRow = async () => {
    const marker = prompt('Marker 名稱:');
    if (!marker) return;
    const res = await addCsRow({ Marker: marker });
    if (res.error) { setMsg({ ok: false, text: res.error }); return; }
    await load();
    setMsg({ ok: true, text: `已新增 ${marker}` });
  };

  // ── Delete row ──
  const handleDeleteRow = async (id: number, marker: string) => {
    if (!confirm(`確定刪除 ${marker}?`)) return;
    await deleteCsRow(id);
    await load();
  };

  // ── Add column ──
  const handleAddCol = async () => {
    if (!newColName.trim()) return;
    const name = newColName.trim();
    const res = await addCsColumn(name, {
      cs_title: newColMeta.cs_title || null,
      cs_lot: newColMeta.cs_lot || null,
      cs_expiry: newColMeta.cs_expiry || null,
    } as Partial<CsMeta>);
    if (res.error) { setMsg({ ok: false, text: res.error }); return; }
    setNewColName('');
    setNewColMeta({ cs_title: '', cs_lot: '', cs_expiry: '' });
    setShowAddCol(false);
    await load();
    setMsg({ ok: true, text: `已新增欄位 ${name}` });
  };

  // ── Delete column ──
  const handleDeleteCol = async (col: string) => {
    if (!confirm(`確定刪除欄位 ${col}? 所有資料將遺失`)) return;
    await deleteCsColumn(col);
    await load();
  };

  // ── Paste from clipboard ──
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    if (!selected) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const data = text.split('\n').filter(l => l.trim()).map(l => l.split('\t'));
    if (!data.length) return;

    const row = rows[selected.row];
    if (!row) return;
    const res = await pasteCsData(row.id, selected.col, data);
    if (res.ok) {
      setMsg({ ok: true, text: `已貼上 ${res.updated + res.inserted} 筆` });
      await load();
    } else {
      setMsg({ ok: false, text: res.error || '貼上失敗' });
    }
  }, [selected, rows, load]);

  // ── Meta edit ──
  const startMetaEdit = (col: string) => {
    const m = getMetaFor(col);
    setEditingMeta(col);
    setMetaDraft({
      cs_title: m?.cs_title ?? '',
      cs_lot: m?.cs_lot ?? '',
      cs_expiry: m?.cs_expiry ?? '',
    });
  };

  const saveMetaEdit = async () => {
    if (!editingMeta) return;
    await updateCsMeta({
      col_name: editingMeta,
      cs_title: metaDraft.cs_title || null,
      cs_lot: metaDraft.cs_lot || null,
      cs_expiry: metaDraft.cs_expiry || null,
    });
    setEditingMeta(null);
    await load();
  };

  return (
    <div className="p-6 space-y-4">
      {/* CS Meta cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {dataCols.map(col => {
          const m = getMetaFor(col);
          const isEditing = editingMeta === col;
          return (
            <div key={col} className="rounded-lg border border-[#2A3754] bg-[#111B2E] p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-[#4DA3FF]">{col}</span>
                <button onClick={() => isEditing ? saveMetaEdit() : startMetaEdit(col)}
                  className="text-[#93A4C3] hover:text-[#4DA3FF] transition-colors">
                  {isEditing ? <Save size={12} /> : <Edit2 size={12} />}
                </button>
              </div>
              {isEditing ? (
                <div className="space-y-1">
                  <input value={metaDraft.cs_title ?? ''} onChange={e => setMetaDraft(d => ({ ...d, cs_title: e.target.value }))}
                    placeholder="標準品品名" className="w-full bg-[#0D1525] border border-[#2A3754] rounded px-2 py-1 text-[10px] text-[#EAF2FF] outline-none" />
                  <input value={metaDraft.cs_lot ?? ''} onChange={e => setMetaDraft(d => ({ ...d, cs_lot: e.target.value }))}
                    placeholder="批號" className="w-full bg-[#0D1525] border border-[#2A3754] rounded px-2 py-1 text-[10px] text-[#EAF2FF] outline-none" />
                  <input value={metaDraft.cs_expiry ?? ''} onChange={e => setMetaDraft(d => ({ ...d, cs_expiry: e.target.value }))}
                    placeholder="效期 (YYYY-MM-DD)" className="w-full bg-[#0D1525] border border-[#2A3754] rounded px-2 py-1 text-[10px] text-[#EAF2FF] outline-none" />
                </div>
              ) : (
                <div className="text-[10px] text-[#93A4C3] space-y-0.5">
                  <p className="truncate">{m?.cs_title || '—'}</p>
                  <p>Lot: <span className="text-[#EAF2FF]">{m?.cs_lot || '—'}</span></p>
                  <p>Exp: <span className="text-[#EAF2FF]">{m?.cs_expiry || '—'}</span></p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <button onClick={handleAddRow}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#4DA3FF]/15 text-[#4DA3FF] text-xs hover:bg-[#4DA3FF]/25">
          <Plus size={12} /> 新增 Marker
        </button>
        {showAddCol ? (
          <div className="flex items-center gap-1 flex-wrap">
            <input value={newColName} onChange={e => setNewColName(e.target.value)}
              placeholder="欄位名稱 (如 L3_12345)"
              className="bg-[#0D1525] border border-[#4DA3FF]/30 rounded px-2 py-1 text-xs text-[#EAF2FF] outline-none w-32" autoFocus />
            <input value={newColMeta.cs_title} onChange={e => setNewColMeta(d => ({ ...d, cs_title: e.target.value }))}
              placeholder="標準品品名"
              className="bg-[#0D1525] border border-[#2A3754] rounded px-2 py-1 text-xs text-[#EAF2FF] outline-none w-40" />
            <input value={newColMeta.cs_lot} onChange={e => setNewColMeta(d => ({ ...d, cs_lot: e.target.value }))}
              placeholder="批號"
              className="bg-[#0D1525] border border-[#2A3754] rounded px-2 py-1 text-xs text-[#EAF2FF] outline-none w-20" />
            <input value={newColMeta.cs_expiry} onChange={e => setNewColMeta(d => ({ ...d, cs_expiry: e.target.value }))}
              placeholder="效期"
              className="bg-[#0D1525] border border-[#2A3754] rounded px-2 py-1 text-xs text-[#EAF2FF] outline-none w-28" />
            <button onClick={handleAddCol} className="text-[#00D4AA] hover:text-[#00D4AA]/80"><CheckCircle size={14} /></button>
            <button onClick={() => { setShowAddCol(false); setNewColName(''); setNewColMeta({ cs_title: '', cs_lot: '', cs_expiry: '' }); }} className="text-[#93A4C3] hover:text-[#FF5C73]">✕</button>
          </div>
        ) : (
          <button onClick={() => setShowAddCol(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1A2438] text-[#93A4C3] text-xs hover:text-[#EAF2FF]">
            <Columns size={12} /> 新增欄位
          </button>
        )}
        <span className="text-[10px] text-[#2A3754] ml-2">點擊儲存格編輯 · 支援從 Excel 複製貼上</span>
      </div>

      {/* Message */}
      {msg && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs
            ${msg.ok ? 'bg-[#00D4AA]/10 text-[#00D4AA]' : 'bg-[#FF5C73]/10 text-[#FF5C73]'}`}>
          {msg.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-auto opacity-60 hover:opacity-100">✕</button>
        </motion.div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-[#2A3754] overflow-auto max-h-[calc(100vh-400px)]"
        onPaste={handlePaste}>
        <table ref={tableRef} className="w-full text-xs">
          <thead className="bg-[#111B2E] sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left text-[#93A4C3] font-medium sticky left-0 bg-[#111B2E] z-20">Marker</th>
              {dataCols.map(col => (
                <th key={col} className="px-3 py-2 text-center text-[#93A4C3] font-medium whitespace-nowrap">
                  <div className="flex items-center justify-center gap-1">
                    {col}
                    <button onClick={() => handleDeleteCol(col)}
                      className="opacity-0 group-hover:opacity-100 text-[#FF5C73]/50 hover:text-[#FF5C73]">
                      <Trash2 size={10} />
                    </button>
                  </div>
                </th>
              ))}
              <th className="px-2 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={row.id} className="border-t border-[#1A2438] hover:bg-[#1A2438]/30 group">
                <td className="px-3 py-1.5 font-medium text-[#EAF2FF] sticky left-0 bg-[#0B1220] group-hover:bg-[#1A2438]/30 z-10 whitespace-nowrap">
                  {editing?.row === ri && editing.col === 'Marker' ? (
                    <input value={editVal} onChange={e => setEditVal(e.target.value)}
                      onBlur={commitEdit} onKeyDown={e => e.key === 'Enter' && commitEdit()}
                      className="bg-[#0D1525] border border-[#4DA3FF]/60 rounded px-1 py-0.5 text-xs text-[#EAF2FF] outline-none w-20" autoFocus />
                  ) : (
                    <span className="cursor-text" onClick={() => startEdit(ri, 'Marker')}>{row.Marker}</span>
                  )}
                </td>
                {dataCols.map(col => {
                  const isSelected = selected?.row === ri && selected.col === col;
                  const isEditing = editing?.row === ri && editing.col === col;
                  return (
                    <td key={col}
                      onClick={() => { setSelected({ row: ri, col }); if (!isEditing) startEdit(ri, col); }}
                      className={`px-3 py-1.5 text-center cursor-text transition-colors
                        ${isSelected ? 'bg-[#4DA3FF]/10 outline outline-1 outline-[#4DA3FF]/40' : ''}`}>
                      {isEditing ? (
                        <input value={editVal} onChange={e => setEditVal(e.target.value)}
                          onBlur={commitEdit} onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null); }}
                          className="bg-transparent border-b border-[#4DA3FF] text-center text-xs text-[#EAF2FF] outline-none w-16" autoFocus />
                      ) : (
                        <span className="text-[#EAF2FF]">{row[col] != null ? fmtVal(row[col]) : ''}</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center">
                  <button onClick={() => handleDeleteRow(row.id, row.Marker)}
                    className="opacity-0 group-hover:opacity-100 text-[#FF5C73]/50 hover:text-[#FF5C73] transition-opacity">
                    <Trash2 size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
