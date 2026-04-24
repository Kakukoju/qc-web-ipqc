import { useState } from 'react';
import { CheckCircle, AlertCircle, Loader2, Save } from 'lucide-react';
import { useFetch } from '../../api/useFetch';
import { fetchPendingInspection, activateInspection, type PendingInspection as PI } from '../../api/schedule';

const VISUAL_OPTIONS = ['PASS', 'NG'] as const;

export default function PendingInspectionTab({ onActivated }: { onActivated?: (beadName: string, sheetName: string) => void }) {
  const { data, loading, error, refresh } = useFetch<PI[]>(fetchPendingInspection, []);
  const [drafts, setDrafts] = useState<Record<number, { crack: string; dirt: string; color: string; sheet_name?: string }>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const getDraft = (id: number) => drafts[id] || { crack: 'PASS', dirt: 'PASS', color: 'PASS' };

  const setField = (id: number, field: 'crack' | 'dirt' | 'color' | 'sheet_name', val: string) => {
    setDrafts(prev => ({ ...prev, [id]: { ...getDraft(id), [field]: val } }));
  };

  const handleSave = async (item: PI) => {
    setSaving(item.id);
    setMsg(null);
    try {
      const d = getDraft(item.id);
      const res = await activateInspection(item.id, d, d.sheet_name);
      setMsg(`${res.bead_name} / ${res.sheet_name} 已啟用，跳轉至原始數據`);
      refresh();
      onActivated?.(res.bead_name, res.sheet_name);
    } catch (e: any) {
      alert('儲存失敗: ' + e.message);
    } finally {
      setSaving(null);
    }
  };

  const Select = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="bg-[#0d1f3a] border border-[#2A3754] text-[#D4E8FF] text-xs rounded px-1.5 py-0.5 focus:outline-none focus:border-[#4DA3FF]">
      {VISUAL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  const lotCell = (lot: string | null) => (
    <span className={lot ? 'font-mono text-[#EAF2FF] text-[11px]' : 'text-[#2A3754]'}>
      {lot || '—'}
    </span>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {msg && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[#00D4AA]/10 border-b border-[#00D4AA]/20 text-xs text-[#00D4AA]">
          <CheckCircle size={14} /> {msg}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[#FF5C73]/10 border-b border-[#FF5C73]/20 text-xs text-[#FF5C73]">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div className="flex-1 overflow-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-[#556A88]">
            <Loader2 size={16} className="animate-spin" /> 載入中…
          </div>
        ) : !data?.length ? (
          <div className="flex flex-col items-center justify-center h-full text-[#3A5070] text-sm gap-2">
            <CheckCircle size={24} className="text-[#00D4AA]/40" />
            目前沒有待檢驗項目
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#0F1A2E] border-b border-[#2A3754]">
                <th className="px-3 py-2 text-left text-[#93A4C3] font-medium">Marker</th>
                <th className="px-2 py-2 text-left text-[#93A4C3] font-medium">Sheet</th>
                <th className="px-2 py-2 text-left text-[#93A4C3] font-medium">工單</th>
                <th className="px-2 py-2 text-center text-[#93A4C3] font-medium">D 批號</th>
                <th className="px-2 py-2 text-center text-[#93A4C3] font-medium">U 批號</th>
                <th className="px-2 py-2 text-center text-[#93A4C3] font-medium">檢驗日</th>
                <th className="px-2 py-2 text-center text-[#93A4C3] font-medium">碎裂</th>
                <th className="px-2 py-2 text-center text-[#93A4C3] font-medium">髒汙</th>
                <th className="px-2 py-2 text-center text-[#93A4C3] font-medium">顏色</th>
                <th className="px-2 py-2 text-center text-[#93A4C3] font-medium w-20"></th>
              </tr>
            </thead>
            <tbody>
              {data.map(item => {
                const d = getDraft(item.id);
                const isSaving = saving === item.id;
                return (
                  <tr key={item.id} className="border-b border-[#1A2438]/40 hover:bg-[#1A2438]/40">
                    <td className="px-3 py-2 text-[#4DA3FF] font-bold">{item.bead_name}</td>
                    <td className="px-2 py-2">
                      <input
                        defaultValue={item.sheet_name}
                        onChange={e => setField(item.id, 'sheet_name', e.target.value)}
                        className="bg-[#0d1f3a] border border-[#2A3754] text-[#EAF2FF] text-[11px] font-mono rounded px-1.5 py-0.5 w-24 focus:outline-none focus:border-[#4DA3FF]"
                      />
                    </td>
                    <td className="px-2 py-2 font-mono text-[#EAF2FF] text-[11px]">
                      {[item.d_work_order, item.bigD_work_order, item.u_work_order].filter(Boolean).join(', ')}
                    </td>
                    <td className="px-2 py-2 text-center">{lotCell(item.bigD_lot)}</td>
                    <td className="px-2 py-2 text-center">{lotCell(item.u_lot)}</td>
                    <td className="px-2 py-2 text-center text-[#EAF2FF]">{item.insp_date}</td>
                    <td className="px-2 py-2 text-center">
                      <Select value={d.crack} onChange={v => setField(item.id, 'crack', v)} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Select value={d.dirt} onChange={v => setField(item.id, 'dirt', v)} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Select value={d.color} onChange={v => setField(item.id, 'color', v)} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button onClick={() => handleSave(item)} disabled={isSaving}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-[#00D4AA]/20 text-[#00D4AA] text-[10px] hover:bg-[#00D4AA]/30 disabled:opacity-50 mx-auto">
                        {isSaving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                        儲存
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="px-4 py-1.5 border-t border-[#1E3050] text-[10px] text-[#3A5070] shrink-0">
        填寫外觀檢驗後按儲存 → 該項目會出現在「原始數據」tab 的 Marker/Sheet 下拉選單
      </div>
    </div>
  );
}
