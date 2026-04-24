/**
 * WellConfigModal – Edit well configuration (row1/row2/row3) for a bead_name.
 *
 * row1 = marker name (editable dropdown from beadscal_rules + "Blank")
 * row2 = auto: CH{主波}-CH{副波}  or  CH{主波}
 * row3 = auto: {Seq1}-{Seq2}
 *
 * Templates: user can save/load named well-position presets.
 */

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Save, Trash2, Download } from 'lucide-react';
import {
  fetchCalRules, updateRawdataMeta,
  fetchWellTemplates, saveWellTemplate, deleteWellTemplate,
  type CalRule, type ColMeta, type WellUpdate, type WellTemplate,
} from '../../api/rawdata';

const WELLS = ['W2','W3','W4','W5','W6','W7','W8','W9','W10','W11','W12','W13','W14','W15','W16','W17','W18','W19'];

interface Props {
  beadName: string;
  meta: ColMeta[];
  onSaved: (newMeta: ColMeta[]) => void;
  onClose: () => void;
}

interface WellRow { well: string; row1: string; row2: string; row3: string }

function computeRow2Row3(markerName: string, rules: CalRule[]): { row2: string; row3: string } {
  if (!markerName) return { row2: '', row3: '' };
  if (markerName === 'Blank') return { row2: 'CH1', row3: '1-0' };
  const rule = rules.find(r => r.marker === markerName);
  if (!rule) return { row2: '', row3: '' };
  const ch1 = rule['主波 (CH)'];
  const ch2 = rule['副波 (CH)'];
  const row2 = ch1 && ch2 ? `CH${ch1}-CH${ch2}` : ch1 ? `CH${ch1}` : '';
  const s1 = rule['Seq 1 (圈數)'];
  const s2 = rule['Seq 2 (圈數)'];
  const row3 = s1 != null && s2 != null ? `${s1}-${s2}` : '';
  return { row2, row3 };
}

export default function WellConfigModal({ beadName, meta, onSaved, onClose }: Props) {
  const [rules, setRules] = useState<CalRule[]>([]);
  const [templates, setTemplates] = useState<WellTemplate[]>([]);
  const [wellRows, setWellRows] = useState<WellRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // template controls
  const [selTemplate, setSelTemplate] = useState('');
  const [newTplName, setNewTplName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);

  useEffect(() => {
    Promise.all([fetchCalRules(), fetchWellTemplates()]).then(([r, t]) => {
      setRules(r);
      setTemplates(t);
      initFromMeta(meta);
      setLoading(false);
    });
  }, []); // eslint-disable-line

  function initFromMeta(m: ColMeta[]) {
    const metaMap = new Map(m.filter(x => x.table_type === 'well_od').map(x => [x.well, x]));
    setWellRows(WELLS.map(w => {
      const x = metaMap.get(w);
      return { well: w, row1: x?.row1 ?? '', row2: x?.row2 ?? '', row3: x?.row3 ?? '' };
    }));
  }

  const markerOptions = ['', 'Blank', ...rules.map(r => r.marker)];

  const handleRow1Change = useCallback((idx: number, val: string) => {
    setWellRows(prev => {
      const next = [...prev];
      const { row2, row3 } = val ? computeRow2Row3(val, rules) : { row2: '', row3: '' };
      next[idx] = { ...next[idx], row1: val, row2, row3 };
      return next;
    });
  }, [rules]);

  // ── Template actions ──────────────────────────────────────────────────

  const handleLoadTemplate = (tplId: string) => {
    setSelTemplate(tplId);
    if (!tplId) return;
    const tpl = templates.find(t => String(t.id) === tplId);
    if (!tpl) return;
    const tplMap = new Map(tpl.wells.map(w => [w.well, w]));
    setWellRows(WELLS.map(w => {
      const t = tplMap.get(w);
      return { well: w, row1: t?.row1 ?? '', row2: t?.row2 ?? '', row3: t?.row3 ?? '' };
    }));
  };

  const handleSaveTemplate = async () => {
    const name = newTplName.trim();
    if (!name) return;
    const wells: WellUpdate[] = wellRows.map(w => ({
      well: w.well, row1: w.row1 || null, row2: w.row2 || null, row3: w.row3 || null,
    }));
    try {
      await saveWellTemplate(name, wells);
      const t = await fetchWellTemplates();
      setTemplates(t);
      setNewTplName('');
      setShowSaveInput(false);
    } catch (e: any) {
      alert('儲存模板失敗: ' + e.message);
    }
  };

  const handleDeleteTemplate = async (tpl: WellTemplate) => {
    if (!confirm(`確定刪除模板「${tpl.name}」？`)) return;
    try {
      await deleteWellTemplate(tpl.id);
      const t = await fetchWellTemplates();
      setTemplates(t);
      if (selTemplate === String(tpl.id)) setSelTemplate('');
    } catch (e: any) {
      alert('刪除失敗: ' + e.message);
    }
  };

  // ── Save to rawdata_meta ──────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    try {
      const wells: WellUpdate[] = wellRows.map(w => ({
        well: w.well, row1: w.row1 || null, row2: w.row2 || null, row3: w.row3 || null,
      }));
      const newMeta = await updateRawdataMeta(beadName, wells);
      onSaved(newMeta);
      onClose();
    } catch (e: any) {
      alert('儲存失敗: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#0F1A2E] border border-[#2A3754] rounded-lg shadow-2xl w-[760px] max-h-[85vh] flex flex-col"
           onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A3754]">
          <h3 className="text-sm font-medium text-[#EAF2FF]">修改 Well 配置 — {beadName}</h3>
          <button onClick={onClose} className="text-[#556A88] hover:text-[#EAF2FF]"><X size={16} /></button>
        </div>

        {/* Template bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#1E3050] bg-[#0B1220]">
          <span className="text-[10px] text-[#556A88]">模板</span>
          <select value={selTemplate} onChange={e => handleLoadTemplate(e.target.value)}
            className="bg-[#0d1f3a] border border-[#2A3754] text-[#D4E8FF] text-xs rounded px-2 py-1 focus:outline-none focus:border-[#4DA3FF] min-w-[140px]">
            <option value="">— 選擇模板 —</option>
            {templates.map(t => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
          </select>

          {selTemplate && (
            <button onClick={() => { const tpl = templates.find(t => String(t.id) === selTemplate); if (tpl) handleDeleteTemplate(tpl); }}
              className="flex items-center gap-0.5 px-1.5 py-1 text-[10px] text-[#FF5C73] hover:bg-[#FF5C73]/10 rounded"
              title="刪除此模板">
              <Trash2 size={10} />
            </button>
          )}

          <div className="ml-auto flex items-center gap-1">
            {showSaveInput ? (
              <>
                <input value={newTplName} onChange={e => setNewTplName(e.target.value)}
                  placeholder="模板名稱" autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveTemplate(); if (e.key === 'Escape') setShowSaveInput(false); }}
                  className="bg-[#0d1f3a] border border-[#4DA3FF] text-[#D4E8FF] text-xs rounded px-2 py-1 w-32 focus:outline-none" />
                <button onClick={handleSaveTemplate} disabled={!newTplName.trim()}
                  className="flex items-center gap-0.5 px-2 py-1 text-[10px] font-medium rounded bg-[#4DA3FF]/20 text-[#4DA3FF] hover:bg-[#4DA3FF]/30 disabled:opacity-40">
                  <Save size={10} /> 存
                </button>
                <button onClick={() => setShowSaveInput(false)}
                  className="px-1.5 py-1 text-[10px] text-[#556A88] hover:text-[#EAF2FF]">取消</button>
              </>
            ) : (
              <button onClick={() => { setShowSaveInput(true); setNewTplName(''); }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-[#4DA3FF]/10 border border-[#4DA3FF]/30 text-[#4DA3FF] hover:bg-[#4DA3FF]/20">
                <Download size={10} /> 另存模板
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-[#556A88]">
              <Loader2 size={16} className="animate-spin mr-2" /> 載入中…
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#0e2346] text-[#7BA8D4]">
                  <th className="px-2 py-1.5 text-left w-16 border border-[#2A3754]">Well</th>
                  <th className="px-2 py-1.5 text-left border border-[#2A3754]">Row1 (Marker)</th>
                  <th className="px-2 py-1.5 text-center w-28 border border-[#2A3754]">Row2 (CH)</th>
                  <th className="px-2 py-1.5 text-center w-24 border border-[#2A3754]">Row3 (Seq)</th>
                </tr>
              </thead>
              <tbody>
                {wellRows.map((w, i) => (
                  <tr key={w.well} className="border-b border-[#1A2438]/40 hover:bg-[#1A2438]/30">
                    <td className="px-2 py-1 text-[#4DA3FF] font-mono font-bold border border-[#2A3754]">{w.well}</td>
                    <td className="px-1 py-0.5 border border-[#2A3754]">
                      <select value={w.row1} onChange={e => handleRow1Change(i, e.target.value)}
                        className="w-full bg-[#0d1f3a] border border-[#2A3754] text-[#D4E8FF] text-xs rounded px-1.5 py-1 focus:outline-none focus:border-[#4DA3FF]">
                        {markerOptions.map(m => <option key={m} value={m}>{m || '(空)'}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-center text-[#93A4C3] font-mono border border-[#2A3754]">{w.row2}</td>
                    <td className="px-2 py-1 text-center text-[#93A4C3] font-mono border border-[#2A3754]">{w.row3}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#2A3754]">
          <button onClick={onClose}
            className="px-3 py-1.5 text-xs text-[#93A4C3] border border-[#2A3754] rounded hover:bg-[#1A2438]">
            取消
          </button>
          <button onClick={handleSave} disabled={saving || loading}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[#00D4AA]/20 border border-[#00D4AA]/40 text-[#00D4AA] hover:bg-[#00D4AA]/30 disabled:opacity-40">
            {saving ? '儲存中…' : '套用至 ' + beadName}
          </button>
        </div>
      </div>
    </div>
  );
}
