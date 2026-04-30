import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Trash2, Upload, CheckCircle, AlertCircle, Edit2, Save, X,
} from 'lucide-react';
import {
  fetchPersonnel, addPersonnel, updatePersonnel, deletePersonnel, uploadPersonnelExcel,
} from '../../api/personnel';
import type { Personnel } from '../../api/personnel';

type Table = 'qc_personnel' | 'line_personnel';
const TABS: { id: Table; label: string }[] = [
  { id: 'qc_personnel', label: 'QC 人員' },
  { id: 'line_personnel', label: '建線人員' },
];
const EMPTY: Omit<Personnel, 'id'> = { emp_no: '', department: '', cost_center: '', name: '', english_name: '' };
const COLS: { key: keyof Omit<Personnel, 'id'>; label: string; w: string }[] = [
  { key: 'emp_no', label: '員工編號', w: 'w-28' },
  { key: 'department', label: '部門', w: 'w-32' },
  { key: 'cost_center', label: '成本中心', w: 'w-28' },
  { key: 'name', label: '姓名', w: 'w-24' },
  { key: 'english_name', label: '英文名', w: 'w-32' },
];

export default function PersonnelManager() {
  const [tab, setTab] = useState<Table>('qc_personnel');
  const [rows, setRows] = useState<Personnel[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setRows(await fetchPersonnel(tab));
  }, [tab]);

  useEffect(() => { load(); setEditId(null); setAdding(false); }, [load]);

  const flash = (ok: boolean, text: string) => { setMsg({ ok, text }); setTimeout(() => setMsg(null), 3000); };

  // ── Add ──
  const handleAdd = async () => {
    if (!draft.emp_no.trim()) return flash(false, '員工編號必填');
    const res = await addPersonnel(tab, draft);
    if (res.error) return flash(false, res.error);
    setAdding(false); setDraft(EMPTY); await load();
    flash(true, '已新增');
  };

  // ── Save edit ──
  const handleSave = async () => {
    if (editId == null) return;
    const res = await updatePersonnel(tab, editId, draft);
    if (res.error) return flash(false, res.error);
    setEditId(null); await load();
    flash(true, '已更新');
  };

  // ── Delete ──
  const handleDelete = async (r: Personnel) => {
    if (!confirm(`確定刪除 ${r.name || r.emp_no}?`)) return;
    await deletePersonnel(tab, r.id);
    await load();
  };

  // ── Upload ──
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const res = await uploadPersonnelExcel(tab, file);
    if (res.error) flash(false, res.error);
    else flash(true, `匯入完成：新增 ${res.inserted}，更新 ${res.updated}`);
    await load();
    e.target.value = '';
  };

  const startEdit = (r: Personnel) => {
    setEditId(r.id);
    setDraft({ emp_no: r.emp_no, department: r.department || '', cost_center: r.cost_center || '', name: r.name || '', english_name: r.english_name || '' });
  };

  return (
    <div className="p-6 space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[#2A3754]">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-medium rounded-t-lg border-b-2 -mb-px transition-colors
              ${tab === t.id ? 'text-[#4DA3FF] border-[#4DA3FF] bg-[#1A2438]' : 'text-[#93A4C3] border-transparent hover:text-[#EAF2FF]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => { setAdding(true); setDraft(EMPTY); setEditId(null); }}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#4DA3FF]/15 text-[#4DA3FF] text-xs hover:bg-[#4DA3FF]/25">
          <Plus size={12} /> 新增人員
        </button>
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#00D4AA]/15 text-[#00D4AA] text-xs hover:bg-[#00D4AA]/25">
          <Upload size={12} /> 匯入 Excel
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
        <span className="text-[10px] text-[#556A88] ml-2">共 {rows.length} 筆</span>
      </div>

      {/* Message */}
      {msg && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs
            ${msg.ok ? 'bg-[#00D4AA]/10 text-[#00D4AA]' : 'bg-[#FF5C73]/10 text-[#FF5C73]'}`}>
          {msg.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
          {msg.text}
        </motion.div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-[#2A3754] overflow-auto max-h-[calc(100vh-320px)]">
        <table className="w-full text-xs">
          <thead className="bg-[#111B2E] sticky top-0 z-10">
            <tr>
              {COLS.map(c => (
                <th key={c.key} className="px-3 py-2 text-left text-[#93A4C3] font-medium whitespace-nowrap">{c.label}</th>
              ))}
              <th className="px-2 py-2 w-16" />
            </tr>
          </thead>
          <tbody>
            {/* Add row */}
            {adding && (
              <tr className="border-t border-[#1A2438] bg-[#4DA3FF]/5">
                {COLS.map(c => (
                  <td key={c.key} className="px-2 py-1">
                    <input value={(draft as any)[c.key] || ''} onChange={e => setDraft(d => ({ ...d, [c.key]: e.target.value }))}
                      placeholder={c.label}
                      className={`${c.w} bg-[#0D1525] border border-[#4DA3FF]/30 rounded px-2 py-1 text-xs text-[#EAF2FF] outline-none`} />
                  </td>
                ))}
                <td className="px-2 py-1 flex items-center gap-1">
                  <button onClick={handleAdd} className="text-[#00D4AA] hover:text-[#00D4AA]/80"><CheckCircle size={14} /></button>
                  <button onClick={() => setAdding(false)} className="text-[#93A4C3] hover:text-[#FF5C73]"><X size={14} /></button>
                </td>
              </tr>
            )}
            {rows.map(r => {
              const isEditing = editId === r.id;
              return (
                <tr key={r.id} className="border-t border-[#1A2438] hover:bg-[#1A2438]/30 group">
                  {COLS.map(c => (
                    <td key={c.key} className="px-3 py-1.5 text-[#EAF2FF]">
                      {isEditing ? (
                        <input value={(draft as any)[c.key] || ''} onChange={e => setDraft(d => ({ ...d, [c.key]: e.target.value }))}
                          className={`${c.w} bg-[#0D1525] border border-[#4DA3FF]/30 rounded px-2 py-1 text-xs text-[#EAF2FF] outline-none`} />
                      ) : (
                        (r as any)[c.key] || ''
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 flex items-center gap-1">
                    {isEditing ? (
                      <>
                        <button onClick={handleSave} className="text-[#00D4AA] hover:text-[#00D4AA]/80"><Save size={12} /></button>
                        <button onClick={() => setEditId(null)} className="text-[#93A4C3] hover:text-[#FF5C73]"><X size={12} /></button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(r)}
                          className="opacity-0 group-hover:opacity-100 text-[#4DA3FF]/60 hover:text-[#4DA3FF] transition-opacity"><Edit2 size={12} /></button>
                        <button onClick={() => handleDelete(r)}
                          className="opacity-0 group-hover:opacity-100 text-[#FF5C73]/50 hover:text-[#FF5C73] transition-opacity"><Trash2 size={12} /></button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
