/**
 * TemplateManager – 建立/管理模板測試模式的 well 配置模板
 *
 * 模板定義一盤裡哪些 well 屬於哪個 marker（如 w8~w11=K, w12=blank, w13~w19=ALT-A）
 */
import { useState, useEffect } from 'react';
import { Trash2, Save, PlusCircle, Loader2 } from 'lucide-react';
import { fetchTemplates, saveTemplate, deleteTemplate, type TestTemplate, type WellAssignment } from '../../api/template';

const WELLS = Array.from({ length: 21 }, (_, i) => i + 2); // W2..W22

export default function TemplateManager() {
  const [templates, setTemplates] = useState<TestTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<number | null>(null);

  // Edit state
  const [name, setName] = useState('');
  const [wells, setWells] = useState<WellAssignment[]>([]);
  const [saving, setSaving] = useState(false);

  const reload = () => {
    setLoading(true);
    fetchTemplates().then(t => { setTemplates(t); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(reload, []);

  const startNew = () => {
    setSelId(null);
    setName('');
    setWells(WELLS.map(w => ({ wellNum: w, assignment: '' })));
  };

  const loadTemplate = (t: TestTemplate) => {
    setSelId(t.id);
    setName(t.name);
    const map = new Map(t.wells.map(w => [w.wellNum, w.assignment]));
    setWells(WELLS.map(w => ({ wellNum: w, assignment: map.get(w) || '' })));
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
            <div key={t.id}
              onClick={() => loadTemplate(t)}
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
          <div className="flex items-center justify-center h-full text-[#3A5070] text-sm">
            選擇模板或點 + 新增
          </div>
        ) : (
          <div className="flex flex-col gap-4 max-w-xl">
            <div>
              <label className="text-[10px] text-[#556A88] block mb-1">模板名稱</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className={inputClass + ' w-60'} placeholder="e.g. K-ALT" />
            </div>

            <div>
              <label className="text-[10px] text-[#556A88] block mb-1">Well 配置（輸入 marker 名稱，空白=不使用，Blank=空白扣除）</label>
              <div className="grid grid-cols-6 gap-1.5">
                {wells.map(w => (
                  <div key={w.wellNum} className="flex flex-col gap-0.5">
                    <span className="text-[9px] text-[#3A5070] text-center">W{w.wellNum}</span>
                    <input
                      value={w.assignment}
                      onChange={e => setAssignment(w.wellNum, e.target.value)}
                      className={`${inputClass} text-center text-[10px] py-0.5 px-1 ${
                        w.assignment === 'Blank' ? 'text-[#556A88] italic' :
                        w.assignment ? 'text-[#4DA3FF] font-medium' : ''
                      }`}
                      placeholder="—"
                    />
                  </div>
                ))}
              </div>
            </div>

            {markers.length > 0 && (
              <div className="text-[10px] text-[#93A4C3]">
                Markers: {markers.map((m, i) => (
                  <span key={m} className="text-[#4DA3FF] font-medium">
                    {i > 0 && ', '}{m}
                    <span className="text-[#556A88]">
                      ({wells.filter(w => w.assignment === m).map(w => 'W' + w.wellNum).join(',')})
                    </span>
                  </span>
                ))}
              </div>
            )}

            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium w-fit
                bg-[#1A5BB5] text-white hover:bg-[#2070D0] disabled:opacity-40">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {selId ? '更新模板' : '建立模板'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
