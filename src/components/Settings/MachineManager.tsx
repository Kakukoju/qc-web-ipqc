import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Trash2, Edit2, CheckCircle, AlertCircle, X, Cpu,
} from 'lucide-react';
import {
  fetchMachinePn, addMachinePn, updateMachinePn, deleteMachinePn,
} from '../../api/machinePn';
import type { MachinePn } from '../../api/machinePn';

const MACHINE_DEFS: Record<string, { label: string; color: string }> = {
  P01:   { label: 'P01',   color: '#4DA3FF' },
  Tutti: { label: 'Tutti', color: '#FF8C42' },
};

export default function MachineManager() {
  const [types, setTypes] = useState<string[]>([]);
  const [rows, setRows] = useState<MachinePn[]>([]);
  const [activeType, setActiveType] = useState('P01');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newPn, setNewPn] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');

  const load = useCallback(async () => {
    const d = await fetchMachinePn();
    setTypes(d.types.length ? d.types : ['P01']);
    setRows(d.rows);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r => r.machine_type === activeType);
  const def = MACHINE_DEFS[activeType] || { label: activeType, color: '#93A4C3' };
  const availableTypes = types.length ? types : Object.keys(MACHINE_DEFS);

  const handleAdd = async () => {
    const pn = newPn.trim();
    if (!pn) return;
    const res = await addMachinePn(activeType, pn);
    if (res.error) { setMsg({ ok: false, text: res.error }); return; }
    setNewPn('');
    await load();
    setMsg({ ok: true, text: `已新增 ${pn}` });
  };

  const handleDelete = async (id: number, pn: string) => {
    if (!confirm(`確定刪除 ${pn}?`)) return;
    await deleteMachinePn(id);
    await load();
  };

  const startEdit = (r: MachinePn) => {
    setEditingId(r.id);
    setEditVal(r.pn);
  };

  const commitEdit = async () => {
    if (editingId == null) return;
    const pn = editVal.trim();
    if (!pn) { setEditingId(null); return; }
    const res = await updateMachinePn(editingId, pn);
    if (res.error) { setMsg({ ok: false, text: res.error }); }
    setEditingId(null);
    await load();
  };

  return (
    <div className="p-6 space-y-4">
      {/* Machine type cards */}
      <div className="flex gap-3">
        {availableTypes.map((type) => {
          const d = MACHINE_DEFS[type] || { label: type, color: '#93A4C3' };
          const count = rows.filter(r => r.machine_type === type).length;
          const isActive = activeType === type;
          return (
            <motion.button key={type} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={() => setActiveType(type)}
              className={`relative rounded-lg border p-4 min-w-[140px] text-left transition-colors
                ${isActive
                  ? 'border-opacity-60 bg-[#1A2438]'
                  : 'border-[#2A3754] bg-[#111B2E] hover:bg-[#1A2438]/50'}`}
              style={{ borderColor: isActive ? d.color : undefined }}>
              <Cpu size={20} style={{ color: d.color }} className="mb-2" />
              <div className="text-sm font-medium text-[#EAF2FF]">{d.label}</div>
              <div className="text-[10px] text-[#93A4C3] mt-0.5">{count} 台</div>
              {isActive && (
                <motion.div layoutId="machineTab"
                  className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                  style={{ backgroundColor: d.color }} />
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Add PN */}
      <div className="flex items-center gap-2">
        <input value={newPn} onChange={e => setNewPn(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder={`新增 ${def.label} P/N`}
          className="bg-[#0D1525] border border-[#2A3754] rounded-lg px-3 py-1.5 text-xs text-[#EAF2FF] outline-none w-52
            focus:border-[#4DA3FF]/50" />
        <button onClick={handleAdd}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs hover:bg-opacity-25 transition-colors"
          style={{ backgroundColor: `${def.color}20`, color: def.color }}>
          <Plus size={12} /> 新增
        </button>
        <span className="text-[10px] text-[#2A3754] ml-2">共 {filtered.length} 筆</span>
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

      {/* PN list */}
      <div className="rounded-lg border border-[#2A3754] overflow-auto max-h-[calc(100vh-380px)]">
        <table className="w-full text-xs">
          <thead className="bg-[#111B2E] sticky top-0 z-10">
            <tr>
              <th className="px-4 py-2 text-left text-[#93A4C3] font-medium w-12">#</th>
              <th className="px-4 py-2 text-left text-[#93A4C3] font-medium">P/N</th>
              <th className="px-4 py-2 text-right text-[#93A4C3] font-medium w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.id} className="border-t border-[#1A2438] hover:bg-[#1A2438]/30 group">
                <td className="px-4 py-1.5 text-[#93A4C3]">{i + 1}</td>
                <td className="px-4 py-1.5">
                  {editingId === r.id ? (
                    <input value={editVal} onChange={e => setEditVal(e.target.value)}
                      onBlur={commitEdit} onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null); }}
                      className="bg-[#0D1525] border border-[#4DA3FF]/60 rounded px-2 py-0.5 text-xs text-[#EAF2FF] outline-none w-48" autoFocus />
                  ) : (
                    <span className="text-[#EAF2FF] font-mono">{r.pn}</span>
                  )}
                </td>
                <td className="px-4 py-1.5 text-right">
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit(r)} className="text-[#93A4C3] hover:text-[#4DA3FF]"><Edit2 size={11} /></button>
                    <button onClick={() => handleDelete(r.id, r.pn)} className="text-[#FF5C73]/50 hover:text-[#FF5C73]"><Trash2 size={11} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-[#2A3754]">尚無 {def.label} P/N 資料</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
