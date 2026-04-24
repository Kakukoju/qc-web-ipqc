import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Trash2, CheckCircle, AlertCircle, X, Grid3x3,
} from 'lucide-react';
import {
  fetchIpqcWell, addIpqcWellRow, updateIpqcWellRow, deleteIpqcWellRow,
} from '../../api/ipqcwell';
import type { IpqcWellRow } from '../../api/ipqcwell';

const WELL_KEYS = Array.from({ length: 21 }, (_, i) => `w${i + 2}`);

interface WellCategory {
  id: string;
  label: string;
  desc: string;
  color: string;
  ready: boolean;
}

const CATEGORIES: WellCategory[] = [
  { id: 'beads_ipqc', label: 'Beads IPQC', desc: 'Beads IPQC Well 配置 — OD 濃度計算 · 列印頁填藥位置', color: '#4DA3FF', ready: true },
  { id: 'p01_fqc',    label: 'P01 產品 FQC', desc: '產品 FQC 檢驗 Well 配置（即將推出）', color: '#FF8C42', ready: false },
  { id: 'tutti_fqc',  label: 'Tutti 產品 FQC', desc: '產品 FQC 檢驗 Well 配置（即將推出）', color: '#A78BFA', ready: false },
];

function summarizeWells(row: IpqcWellRow): string {
  const nums = WELL_KEYS.map(k => row[k] ? parseInt(k.slice(1)) : 0).filter(Boolean);
  if (!nums.length) return '—';
  const ranges: string[] = [];
  let s = nums[0], e = nums[0];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === e + 1) { e = nums[i]; }
    else { ranges.push(s === e ? `${s}` : `${s}~${e}`); s = e = nums[i]; }
  }
  ranges.push(s === e ? `${s}` : `${s}~${e}`);
  return ranges.join(', ');
}

function BeadsIpqcWellGrid() {
  const [rows, setRows] = useState<IpqcWellRow[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<{ rowId: number; col: string } | null>(null);
  const [editVal, setEditVal] = useState('');

  const load = useCallback(async () => {
    const d = await fetchIpqcWell();
    setRows(d.rows);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    const marker = prompt('Marker 名稱:');
    if (!marker?.trim()) return;
    const res = await addIpqcWellRow(marker.trim());
    if (res.error) { setMsg({ ok: false, text: res.error }); return; }
    await load();
    setMsg({ ok: true, text: `已新增 ${marker.trim()}` });
  };

  const handleDelete = async (id: number, marker: string) => {
    if (!confirm(`確定刪除 ${marker}?`)) return;
    await deleteIpqcWellRow(id);
    await load();
  };

  const startEdit = (rowId: number, col: string, val: string | null) => {
    setEditing({ rowId, col });
    setEditVal(val ?? '');
  };

  const commitEdit = async () => {
    if (!editing) return;
    const row = rows.find(r => r.id === editing.rowId);
    if (!row) { setEditing(null); return; }
    if (editVal !== String(row[editing.col] ?? '')) {
      const res = await updateIpqcWellRow(editing.rowId, { [editing.col]: editVal || null });
      if (res.error) setMsg({ ok: false, text: res.error });
      await load();
    }
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      {/* Marker summary cards */}
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2">
        {rows.map(row => (
          <div key={row.id} className="rounded-lg border border-[#2A3754] bg-[#111B2E] p-2.5">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs font-bold text-[#4DA3FF]">{row.Marker}</span>
              <button onClick={() => handleDelete(row.id, row.Marker)}
                className="text-[#FF5C73]/40 hover:text-[#FF5C73] transition-colors">
                <Trash2 size={10} />
              </button>
            </div>
            <p className="text-[10px] text-[#93A4C3] truncate">
              填藥位置: {summarizeWells(row)}
            </p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <button onClick={handleAdd}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#4DA3FF]/15 text-[#4DA3FF] text-xs hover:bg-[#4DA3FF]/25">
          <Plus size={12} /> 新增 Marker
        </button>
        <span className="text-[10px] text-[#2A3754] ml-2">共 {rows.length} 筆 · 點擊儲存格編輯</span>
      </div>

      {/* Message */}
      {msg && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs
            ${msg.ok ? 'bg-[#00D4AA]/10 text-[#00D4AA]' : 'bg-[#FF5C73]/10 text-[#FF5C73]'}`}>
          {msg.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-auto opacity-60 hover:opacity-100"><X size={12} /></button>
        </motion.div>
      )}

      {/* Well grid table */}
      <div className="rounded-lg border border-[#2A3754] overflow-auto max-h-[calc(100vh-440px)]">
        <table className="w-full text-xs">
          <thead className="bg-[#111B2E] sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left text-[#93A4C3] font-medium sticky left-0 bg-[#111B2E] z-20">Marker</th>
              {WELL_KEYS.map(k => (
                <th key={k} className="px-1.5 py-2 text-center text-[#93A4C3] font-medium whitespace-nowrap min-w-[44px]">{k}</th>
              ))}
              <th className="px-2 py-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} className="border-t border-[#1A2438] hover:bg-[#1A2438]/30 group">
                <td className="px-3 py-1.5 font-medium text-[#EAF2FF] sticky left-0 bg-[#0B1220] group-hover:bg-[#1A2438]/30 z-10 whitespace-nowrap">
                  {editing?.rowId === row.id && editing.col === 'Marker' ? (
                    <input value={editVal} onChange={e => setEditVal(e.target.value)}
                      onBlur={commitEdit} onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null); }}
                      className="bg-[#0D1525] border border-[#4DA3FF]/60 rounded px-1 py-0.5 text-xs text-[#EAF2FF] outline-none w-20" autoFocus />
                  ) : (
                    <span className="cursor-text" onClick={() => startEdit(row.id, 'Marker', row.Marker)}>{row.Marker}</span>
                  )}
                </td>
                {WELL_KEYS.map(k => {
                  const val = row[k] as string | null;
                  const isEd = editing?.rowId === row.id && editing.col === k;
                  return (
                    <td key={k}
                      onClick={() => !isEd && startEdit(row.id, k, val)}
                      className={`px-1.5 py-1.5 text-center cursor-text transition-colors
                        ${val ? 'bg-[#4DA3FF]/8' : ''}
                        ${isEd ? 'outline outline-1 outline-[#4DA3FF]/40' : ''}`}>
                      {isEd ? (
                        <input value={editVal} onChange={e => setEditVal(e.target.value)}
                          onBlur={commitEdit} onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null); }}
                          className="bg-transparent border-b border-[#4DA3FF] text-center text-xs text-[#EAF2FF] outline-none w-10" autoFocus />
                      ) : (
                        <span className={val ? 'text-[#EAF2FF]' : 'text-[#2A3754]'}>{val || ''}</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center">
                  <button onClick={() => handleDelete(row.id, row.Marker)}
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

export default function WellManager() {
  const [activeCat, setActiveCat] = useState<string | null>(null);

  if (activeCat === 'beads_ipqc') {
    return (
      <div className="p-6 space-y-4">
        <button onClick={() => setActiveCat(null)}
          className="text-[#93A4C3] hover:text-[#4DA3FF] text-xs mb-2 transition-colors">
          ← 返回 Well 配置總覽
        </button>
        <BeadsIpqcWellGrid />
      </div>
    );
  }

  return (
    <div className="p-6">
      <p className="text-[#93A4C3] text-sm mb-4">選擇 Well 配置類型</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {CATEGORIES.map(cat => (
          <motion.button key={cat.id}
            whileHover={cat.ready ? { scale: 1.02, y: -2 } : {}}
            whileTap={cat.ready ? { scale: 0.98 } : {}}
            onClick={() => cat.ready && setActiveCat(cat.id)}
            disabled={!cat.ready}
            className={`relative text-left rounded-xl border p-5 transition-colors
              ${cat.ready
                ? 'border-[#2A3754] bg-[#111B2E] hover:border-opacity-50 hover:bg-[#1A2438] cursor-pointer'
                : 'border-[#1A2438] bg-[#0D1525] opacity-50 cursor-not-allowed'}`}
            style={cat.ready ? { ['--hover-border' as string]: cat.color } : {}}>
            <Grid3x3 size={24} style={{ color: cat.ready ? cat.color : '#2A3754' }} className="mb-2" />
            <h3 className="text-[#EAF2FF] text-sm font-medium mb-1">{cat.label}</h3>
            <p className="text-[#93A4C3] text-xs">{cat.desc}</p>
            {!cat.ready && (
              <span className="absolute top-3 right-3 text-[10px] text-[#2A3754] bg-[#1A2438] px-2 py-0.5 rounded-full">
                即將推出
              </span>
            )}
          </motion.button>
        ))}
      </div>
    </div>
  );
}
