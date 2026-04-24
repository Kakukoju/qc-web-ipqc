import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, RefreshCw, Edit2, Save, X as XIcon, CheckCircle, XCircle } from 'lucide-react';
import { useFetch } from '../../api/useFetch';
import {
  fetchPostMarkers, fetchPostSheets, fetchPostRecords, updatePostRecord,
  type PostRecord, type PostSheetSummary,
} from '../../api/posts';
import { lookupSpec } from '../../api/spec';
import type { SpecRow } from '../../api/spec';
import { judgeRecord } from '../../utils/specJudge';
import { fetchCsMeta } from '../../api/csassign';
import type { CsMeta } from '../../api/csassign';

// ── helpers ──────────────────────────────────────────────────────────────────

function passColor(v: string | null) {
  if (!v) return 'text-[#93A4C3]';
  const u = v.toUpperCase();
  if (u.includes('PASS') || u.includes('可併') || u.includes('符合')) return 'text-[#00D4AA]';
  if (u.includes('FAIL') || u.includes('NG') || u.includes('不可')) return 'text-[#FF5C73]';
  return 'text-[#EAF2FF]';
}

function JudgeChip({ value }: { value: string | null }) {
  if (!value) return <span className="text-[#2A3754] text-xs">—</span>;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${passColor(value)}`}
      style={{ background: 'rgba(255,255,255,0.06)' }}>
      {value}
    </span>
  );
}

function pct(v: string | null): string {
  if (!v) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return (n * 100).toFixed(1) + '%';
}

function fmtN(v: string | null): string {
  if (!v) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return n.toFixed(4);
}

function warnCv(v: string | null): string {
  if (!v) return 'text-[#EAF2FF]';
  const n = Math.abs(parseFloat(v));
  return !isNaN(n) && n > 0.07 ? 'text-[#FF5C73] font-semibold' : 'text-[#EAF2FF]';
}

function warnBias(v: string | null): string {
  if (!v) return 'text-[#EAF2FF]';
  const n = Math.abs(parseFloat(v));
  return !isNaN(n) && n > 0.05 ? 'text-[#FF5C73] font-semibold' : 'text-[#EAF2FF]';
}

/** Map PostRecord fields to MeasuredValues for judgeRecord */
function toMeasured(rec: PostRecord) {
  return {
    od_mean_l1: rec.od_mean_l1,
    od_mean_l2: rec.od_mean_l2,
    od_mean_n1: rec.od_mean_n1,
    od_cv_l1: rec.od_cv_l1,
    od_cv_l2: rec.od_cv_l2,
    od_cv_n1: rec.od_cv_n1,
    od_cv_n3: rec.od_cv_n3,
    rconc_cv_l1: rec.sb_conc_cv_l1,
    rconc_cv_l2: rec.sb_conc_cv_l2,
    rconc_cv_n1: null,
    rconc_cv_n3: null,
    mean_bias_l1: rec.fb_bias_l1,
    mean_bias_l2: rec.fb_bias_l2,
    total_cv_l1: rec.fb_conc_cv_l1,
    total_cv_l2: rec.fb_conc_cv_l2,
  };
}

function avgField(records: PostRecord[], field: keyof PostRecord): string {
  const vals = records.map(r => r[field]).filter(Boolean).map(v => parseFloat(v as string)).filter(n => !isNaN(n));
  if (!vals.length) return '—';
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4);
}

function avgPctField(records: PostRecord[], field: keyof PostRecord): string {
  const vals = records.map(r => r[field]).filter(Boolean).map(v => parseFloat(v as string)).filter(n => !isNaN(n));
  if (!vals.length) return '—';
  return ((vals.reduce((a, b) => a + b, 0) / vals.length) * 100).toFixed(1) + '%';
}

function lotCombo(rec: PostRecord): string {
  return [rec.lot_d, rec.lot_bigD, rec.lot_u].filter(Boolean).join(' / ') || '—';
}

function hasData(rec: PostRecord, fields: (keyof PostRecord)[]): boolean {
  return fields.some(f => rec[f] != null && rec[f] !== '');
}

const VISUAL_FIELDS: (keyof PostRecord)[] = ['crack','dirt','color','cv_conform','bias_conform','merge_judge','final_judge'];
const OD_FIELDS: (keyof PostRecord)[] = ['slope','intercept','od_mean_l1','od_mean_l2','od_mean_n1','od_mean_n3','od_cv_l1','od_cv_l2','od_cv_n1','od_cv_n3','od_bias_l1','od_bias_l2','od_bias_n1','od_bias_n3'];
const CONC_FIELDS: (keyof PostRecord)[] = ['sb_conc_mean_l1','sb_conc_mean_l2','sb_conc_cv_l1','sb_conc_cv_l2','fb_conc_mean_l1','fb_conc_mean_l2','fb_conc_cv_l1','fb_conc_cv_l2','fb_bias_l1','fb_bias_l2','sb_judge_result','fb_initial_judge'];

// ── Sheet list ────────────────────────────────────────────────────────────────

function SheetList({ beadName, selected, onSelect }: {
  beadName: string;
  selected: string | null;
  onSelect: (s: string) => void;
}) {
  const { data: sheets, loading, refresh } = useFetch<PostSheetSummary[]>(
    () => fetchPostSheets(beadName), [beadName]
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs text-[#93A4C3]">{sheets?.length ?? 0} 批次</span>
        <button onClick={refresh} className="text-[#93A4C3] hover:text-[#4DA3FF] transition-colors">
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="overflow-y-auto flex-1 space-y-1">
        {loading && <div className="text-[#93A4C3] text-xs p-2">載入中…</div>}
        {(sheets || []).map(s => (
          <button
            key={s.sheet_name}
            onClick={() => onSelect(s.sheet_name)}
            className={`w-full text-left rounded-lg px-3 py-2 transition-colors flex items-center justify-between group
              ${selected === s.sheet_name
                ? 'bg-[#4DA3FF]/20 border border-[#4DA3FF]/40'
                : 'bg-[#1A2438] hover:bg-[#1E2D46] border border-transparent'}`}
          >
            <div>
              <div className="text-xs font-mono text-[#EAF2FF]">{s.sheet_name}</div>
              <div className="text-[10px] text-[#93A4C3] mt-0.5">
                {s.insp_date?.slice(0, 10) ?? '—'} · {s.combo_count} 組
              </div>
            </div>
            <ChevronRight size={12} className="text-[#4DA3FF] opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Editable cell ─────────────────────────────────────────────────────────────

function EditCell({
  value, editing, field, onChange,
}: {
  value: string | null;
  editing: boolean;
  field: string;
  onChange: (field: string, val: string) => void;
}) {
  if (!editing) return <span className="text-xs text-[#EAF2FF]">{value || '—'}</span>;
  return (
    <input
      className="w-full text-xs bg-[#0F1A2E] border border-[#4DA3FF]/60 rounded px-1.5 py-0.5 text-[#EAF2FF] outline-none focus:border-[#4DA3FF]"
      defaultValue={value ?? ''}
      onChange={e => onChange(field, e.target.value)}
    />
  );
}

// ── Sheet detail + edit ───────────────────────────────────────────────────────

function SheetDetail({ records, spec, csMeta, onSaved }: {
  records: PostRecord[];
  spec: SpecRow | null;
  csMeta: CsMeta[];
  onSaved: (updated: PostRecord) => void;
}) {
  const first = records[0];
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<PostRecord>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEdit = (rec: PostRecord) => {
    setEditingId(rec.id);
    setDraft({});
    setSaveError(null);
  };

  const cancelEdit = () => { setEditingId(null); setDraft({}); };

  const handleChange = useCallback((field: string, val: string) => {
    setDraft(d => ({ ...d, [field]: val === '' ? null : val }));
  }, []);

  const handleSave = async (id: number) => {
    if (Object.keys(draft).length === 0) { cancelEdit(); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updatePostRecord(id, draft);
      onSaved(updated);
      setEditingId(null);
      setDraft({});
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const isEditing = (id: number) => editingId === id;
  const EC = (rec: PostRecord, field: keyof PostRecord) => (
    <EditCell
      value={rec[field] as string | null}
      editing={isEditing(rec.id)}
      field={field}
      onChange={handleChange}
    />
  );

  return (
    <div className="space-y-4">
      {/* Sheet header */}
      <div className="bg-[#111C30] rounded-xl border border-[#2A3754] px-4 py-3">
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
          <div><span className="text-[#93A4C3]">Marker: </span><span className="text-[#4DA3FF] font-bold">{first?.marker || first?.bead_name}</span></div>
          <div><span className="text-[#93A4C3]">批次: </span><span className="text-[#EAF2FF] font-mono">{first?.sheet_name}</span></div>
          <div><span className="text-[#93A4C3]">檢驗日期: </span><span className="text-[#EAF2FF]">{first?.insp_date?.slice(0,10) || '—'}</span></div>
          <div><span className="text-[#93A4C3]">填藥位置: </span><span className="text-[#EAF2FF]">{first?.fw || '—'}</span></div>
          <div><span className="text-[#93A4C3]">CS: </span><span className="text-[#EAF2FF] text-[11px]">{csMeta[0]?.cs_title || first?.cs_name || '—'}</span></div>
          <div><span className="text-[#93A4C3]">CS Lot: </span><span className="text-[#EAF2FF] text-[11px]">{csMeta.length > 0 ? csMeta.map(m => m.cs_lot).filter(Boolean).join('、') : (first?.cs_lot_l1 || '—')} Exp Date {csMeta[0]?.cs_expiry || (first?.cs_lot_l2 || '—')}</span></div>
        </div>
      </div>

      {/* I. 外觀 + 判定 table */}
      <div className="bg-[#111C30] rounded-xl border border-[#2A3754] overflow-hidden">
        <div className="px-4 py-2 border-b border-[#2A3754] bg-[#0F1A2E]">
          <span className="text-[10px] font-semibold text-[#4DA3FF] uppercase tracking-widest">
            I. 外觀檢驗 · 判定
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#2A3754]">
                <th className="text-left px-3 py-2 text-[#93A4C3] font-medium whitespace-nowrap">批號組合</th>
                <th className="text-center px-2 py-2 text-[#93A4C3] font-medium">碎裂</th>
                <th className="text-center px-2 py-2 text-[#93A4C3] font-medium">髒汙</th>
                <th className="text-center px-2 py-2 text-[#93A4C3] font-medium">顏色</th>
                <th className="text-center px-2 py-2 text-[#93A4C3] font-medium whitespace-nowrap">CV 判定</th>
                <th className="text-center px-2 py-2 text-[#93A4C3] font-medium whitespace-nowrap">Bias 判定</th>
                <th className="text-center px-2 py-2 text-[#93A4C3] font-medium whitespace-nowrap">可併</th>
                <th className="text-center px-2 py-2 text-[#93A4C3] font-medium whitespace-nowrap">總結</th>
                <th className="text-center px-2 py-2 text-[#93A4C3] font-medium w-20">操作</th>
              </tr>
            </thead>
            <tbody>
              {records.filter(r => hasData(r, VISUAL_FIELDS)).map((rec, idx, arr) => (
                <tr key={rec.id}
                  className={`hover:bg-[#1A2438]/40 transition-colors ${idx < arr.length - 1 ? 'border-b border-[#1A2438]/60' : ''}`}>
                  <td className="px-3 py-2 font-mono text-[#EAF2FF] whitespace-nowrap text-[11px]">
                    {lotCombo(rec)}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {isEditing(rec.id)
                      ? <EditCell value={rec.crack} editing field="crack" onChange={handleChange} />
                      : (!rec.crack ? <span className="text-[#2A3754]">—</span>
                        : rec.crack === '無' ? <CheckCircle size={11} className="mx-auto text-[#00D4AA]" />
                        : <XCircle size={11} className="mx-auto text-[#FF5C73]" />)}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {isEditing(rec.id)
                      ? <EditCell value={rec.dirt} editing field="dirt" onChange={handleChange} />
                      : (!rec.dirt ? <span className="text-[#2A3754]">—</span>
                        : rec.dirt === '無' ? <CheckCircle size={11} className="mx-auto text-[#00D4AA]" />
                        : <XCircle size={11} className="mx-auto text-[#FF5C73]" />)}
                  </td>
                  <td className="px-2 py-2 text-center">{EC(rec, 'color')}</td>
                  <td className="px-2 py-2 text-center">
                    {isEditing(rec.id) ? EC(rec, 'cv_conform') : <JudgeChip value={rec.cv_conform || (() => { const j = judgeRecord(toMeasured(rec), spec); return j.batchPass === null ? null : j.batchPass ? '符合' : '不符合'; })()} />}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {isEditing(rec.id) ? EC(rec, 'bias_conform') : <JudgeChip value={rec.bias_conform || (() => { const j = judgeRecord(toMeasured(rec), spec); return j.batchPass === null ? null : j.batchPass ? '符合' : '不符合'; })()} />}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {isEditing(rec.id) ? EC(rec, 'merge_judge') : <JudgeChip value={rec.merge_judge || judgeRecord(toMeasured(rec), spec).mergeLabel} />}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {isEditing(rec.id) ? EC(rec, 'final_judge') : <JudgeChip value={rec.final_judge || judgeRecord(toMeasured(rec), spec).finalLabel} />}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {isEditing(rec.id) ? (
                      <div className="flex gap-1 justify-center">
                        <button
                          onClick={() => handleSave(rec.id)}
                          disabled={saving}
                          className="flex items-center gap-1 px-2 py-1 rounded bg-[#00D4AA]/20 text-[#00D4AA] text-[10px] hover:bg-[#00D4AA]/30 disabled:opacity-50"
                        >
                          <Save size={10} /> 儲存
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="flex items-center px-1.5 py-1 rounded bg-[#2A3754] text-[#93A4C3] text-[10px] hover:bg-[#3A4764]"
                        >
                          <XIcon size={10} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(rec)}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-[#4DA3FF]/10 text-[#4DA3FF] text-[10px] hover:bg-[#4DA3FF]/20 mx-auto"
                      >
                        <Edit2 size={10} /> 編輯
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {saveError && <p className="text-[#FF5C73] text-xs px-4 py-2">{saveError}</p>}
      </div>

      {/* II. OD Performance — Excel-style with batch triplets + Total */}
      <div className="bg-[#111C30] rounded-xl border border-[#2A3754] overflow-hidden">
        <div className="px-4 py-2 border-b border-[#2A3754] bg-[#0F1A2E]">
          <span className="text-[10px] font-semibold text-[#4DA3FF] uppercase tracking-widest">
            II. OD Performance
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#2A3754]">
                <th rowSpan={2} className="text-left px-3 py-2 text-[#93A4C3] font-medium whitespace-nowrap" style={{ minWidth: 160 }}>批號組合</th>
                <th rowSpan={2} className="text-center px-2 py-2 text-[#93A4C3] font-medium">Slope</th>
                <th rowSpan={2} className="text-center px-2 py-2 text-[#93A4C3] font-medium">Intercept</th>
                <th colSpan={4} className="text-center px-1 py-1.5 text-[#93A4C3] font-medium border-b border-[#2A3754]">OD Mean</th>
                <th colSpan={4} className="text-center px-1 py-1.5 text-[#93A4C3] font-medium border-b border-[#2A3754]">OD CV%</th>
                <th colSpan={4} className="text-center px-1 py-1.5 text-[#93A4C3] font-medium border-b border-[#2A3754]">全批次 Bias</th>
                <th rowSpan={2} className="text-center px-2 py-2 text-[#93A4C3] font-medium">單批判定</th>
              </tr>
              <tr className="border-b border-[#2A3754]">
                {['L1','L2','N1','N3','L1','L2','N1','N3','L1','L2','N1','N3'].map((l,i) => (
                  <th key={i} className="text-center px-1 py-1 text-[10px] text-[#93A4C3] font-normal">{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.filter(r => hasData(r, OD_FIELDS)).map((rec, idx, arr) => (
                <tr key={rec.id}
                  className={`hover:bg-[#1A2438]/40 ${idx < arr.length - 1 ? 'border-b border-[#1A2438]/60' : ''}`}>
                  <td className="px-3 py-2 font-mono text-[#EAF2FF] text-[11px] whitespace-nowrap">
                    {lotCombo(rec)}
                  </td>
                  <td className="px-2 py-2 text-center text-[#EAF2FF] text-[11px]">
                    {rec.slope ? parseFloat(rec.slope).toFixed(4) : '—'}
                  </td>
                  <td className="px-2 py-2 text-center text-[#EAF2FF] text-[11px]">
                    {rec.intercept ? parseFloat(rec.intercept).toFixed(4) : '—'}
                  </td>
                  <td className="px-1 py-2 text-center text-[#EAF2FF] text-[11px]">{fmtN(rec.od_mean_l1)}</td>
                  <td className="px-1 py-2 text-center text-[#EAF2FF] text-[11px]">{fmtN(rec.od_mean_l2)}</td>
                  <td className="px-1 py-2 text-center text-[#EAF2FF] text-[11px]">{fmtN(rec.od_mean_n1)}</td>
                  <td className="px-1 py-2 text-center text-[#EAF2FF] text-[11px]">{fmtN(rec.od_mean_n3)}</td>
                  <td className="px-1 py-2 text-center text-[11px]">
                    <span className={warnCv(rec.od_cv_l1)}>{pct(rec.od_cv_l1)}</span>
                  </td>
                  <td className="px-1 py-2 text-center text-[11px]">
                    <span className={warnCv(rec.od_cv_l2)}>{pct(rec.od_cv_l2)}</span>
                  </td>
                  <td className="px-1 py-2 text-center text-[11px]">
                    <span className={warnCv(rec.od_cv_n1)}>{pct(rec.od_cv_n1)}</span>
                  </td>
                  <td className="px-1 py-2 text-center text-[11px]">
                    <span className={warnCv(rec.od_cv_n3)}>{pct(rec.od_cv_n3)}</span>
                  </td>
                  <td className="px-1 py-2 text-center text-[11px]">
                    <span className={warnBias(rec.od_bias_l1)}>{pct(rec.od_bias_l1)}</span>
                  </td>
                  <td className="px-1 py-2 text-center text-[11px]">
                    <span className={warnBias(rec.od_bias_l2)}>{pct(rec.od_bias_l2)}</span>
                  </td>
                  <td className="px-1 py-2 text-center text-[11px]">
                    <span className={warnBias(rec.od_bias_n1)}>{pct(rec.od_bias_n1)}</span>
                  </td>
                  <td className="px-1 py-2 text-center text-[11px]">
                    <span className={warnBias(rec.od_bias_n3)}>{pct(rec.od_bias_n3)}</span>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <JudgeChip value={(() => {
                      const j = judgeRecord({ od_cv_l1: rec.od_cv_l1, od_cv_l2: rec.od_cv_l2, od_cv_n1: rec.od_cv_n1, od_cv_n3: rec.od_cv_n3 }, spec);
                      return j.batchLabel === '—' ? null : j.batchLabel;
                    })()} />
                  </td>
                </tr>
              ))}
              {/* Total row */}
              {records.some(r => hasData(r, OD_FIELDS)) && (
              <tr className="border-t border-[#4DA3FF]/30 bg-[#1A2438]/40">
                <td className="px-3 py-2 font-mono font-bold text-[#4DA3FF] text-[11px]">Total</td>
                <td className="px-2 py-2 text-center text-[#4DA3FF] text-[11px]">{avgField(records, 'slope')}</td>
                <td className="px-2 py-2 text-center text-[#4DA3FF] text-[11px]">{avgField(records, 'intercept')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgField(records, 'od_mean_l1')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgField(records, 'od_mean_l2')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgField(records, 'od_mean_n1')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgField(records, 'od_mean_n3')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgPctField(records, 'od_cv_l1')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgPctField(records, 'od_cv_l2')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgPctField(records, 'od_cv_n1')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgPctField(records, 'od_cv_n3')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgPctField(records, 'od_bias_l1')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgPctField(records, 'od_bias_l2')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgPctField(records, 'od_bias_n1')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgPctField(records, 'od_bias_n3')}</td>
                <td></td>
              </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* III. Conc. Performance — Excel-style with batch triplets + Total */}
      <div className="bg-[#111C30] rounded-xl border border-[#2A3754] overflow-hidden">
        <div className="px-4 py-2 border-b border-[#2A3754] bg-[#0F1A2E] flex items-center gap-4">
          <span className="text-[10px] font-semibold text-[#4DA3FF] uppercase tracking-widest">
            III. Conc. Performance
          </span>
          <span className="text-[10px] text-[#93A4C3]">
            Spec Conc.CV &lt; {spec?.single_cv || (first?.conc_cv_spec ? pct(first.conc_cv_spec) : '—')} ·
            Bias {spec?.merge_bias || (() => { const l1 = first?.mean_bias_spec_l1 ? pct(first.mean_bias_spec_l1) : '—'; const l2 = first?.mean_bias_spec_l2 ? pct(first.mean_bias_spec_l2) : '—'; return `L1 < ${l1} / L2 < ${l2}`; })()}
            {spec?.merge_cv ? ` · 全批次CV < ${spec.merge_cv}` : ''}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#2A3754]">
                <th rowSpan={2} className="text-left px-3 py-2 text-[#93A4C3] font-medium whitespace-nowrap" style={{ minWidth: 160 }}>批號組合</th>
                <th colSpan={2} className="text-center px-1 py-1.5 text-[#93A4C3] font-medium border-b border-[#2A3754]">個批次 Mean</th>
                <th colSpan={2} className="text-center px-1 py-1.5 text-[#93A4C3] font-medium border-b border-[#2A3754]">個批次 CV%</th>
                <th colSpan={2} className="text-center px-1 py-1.5 text-[#93A4C3] font-medium border-b border-[#2A3754]">全批次 Mean</th>
                <th colSpan={2} className="text-center px-1 py-1.5 text-[#93A4C3] font-medium border-b border-[#2A3754]">全批次 CV%</th>
                <th colSpan={2} className="text-center px-1 py-1.5 text-[#93A4C3] font-medium border-b border-[#2A3754]">全批次 Bias</th>
                <th rowSpan={2} className="text-center px-2 py-2 text-[#93A4C3] font-medium">單批判定</th>
                <th rowSpan={2} className="text-center px-2 py-2 text-[#93A4C3] font-medium">全批判定</th>
              </tr>
              <tr className="border-b border-[#2A3754]">
                {['L1','L2','L1','L2','L1','L2','L1','L2','L1','L2'].map((l,i) => (
                  <th key={i} className="text-center px-1 py-1 text-[10px] text-[#93A4C3] font-normal">{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.filter(r => hasData(r, CONC_FIELDS)).map((rec, idx, arr) => (
                <tr key={rec.id}
                  className={`hover:bg-[#1A2438]/40 ${idx < arr.length - 1 ? 'border-b border-[#1A2438]/60' : ''}`}>
                  <td className="px-3 py-2 font-mono text-[#EAF2FF] text-[11px] whitespace-nowrap">
                    {lotCombo(rec)}
                  </td>
                  <td className="px-1 py-2 text-center text-[#EAF2FF] text-[11px]">{fmtN(rec.sb_conc_mean_l1)}</td>
                  <td className="px-1 py-2 text-center text-[#EAF2FF] text-[11px]">{fmtN(rec.sb_conc_mean_l2)}</td>
                  <td className="px-1 py-2 text-center text-[11px]">
                    <span className={warnCv(rec.sb_conc_cv_l1)}>{pct(rec.sb_conc_cv_l1)}</span>
                  </td>
                  <td className="px-1 py-2 text-center text-[11px]">
                    <span className={warnCv(rec.sb_conc_cv_l2)}>{pct(rec.sb_conc_cv_l2)}</span>
                  </td>
                  <td className="px-1 py-2 text-center text-[#EAF2FF] text-[11px]">{fmtN(rec.fb_conc_mean_l1)}</td>
                  <td className="px-1 py-2 text-center text-[#EAF2FF] text-[11px]">{fmtN(rec.fb_conc_mean_l2)}</td>
                  <td className="px-1 py-2 text-center text-[11px]">
                    <span className={warnCv(rec.fb_conc_cv_l1)}>{pct(rec.fb_conc_cv_l1)}</span>
                  </td>
                  <td className="px-1 py-2 text-center text-[11px]">
                    <span className={warnCv(rec.fb_conc_cv_l2)}>{pct(rec.fb_conc_cv_l2)}</span>
                  </td>
                  <td className="px-1 py-2 text-center text-[11px]">
                    <span className={warnBias(rec.fb_bias_l1)}>{pct(rec.fb_bias_l1)}</span>
                  </td>
                  <td className="px-1 py-2 text-center text-[11px]">
                    <span className={warnBias(rec.fb_bias_l2)}>{pct(rec.fb_bias_l2)}</span>
                  </td>
                  <td className="px-2 py-2 text-center"><JudgeChip value={rec.sb_judge_result || (() => { const j = judgeRecord(toMeasured(rec), spec); return j.batchLabel === '—' ? null : j.batchLabel; })()} /></td>
                  <td className="px-2 py-2 text-center"><JudgeChip value={rec.fb_initial_judge || (() => { const j = judgeRecord(toMeasured(rec), spec); return j.mergeLabel === '—' ? null : j.mergeLabel; })()} /></td>
                </tr>
              ))}
              {/* Total row */}
              {records.some(r => hasData(r, CONC_FIELDS)) && (
              <tr className="border-t border-[#4DA3FF]/30 bg-[#1A2438]/40">
                <td className="px-3 py-2 font-mono font-bold text-[#4DA3FF] text-[11px]">Total</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgField(records, 'sb_conc_mean_l1')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgField(records, 'sb_conc_mean_l2')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgPctField(records, 'sb_conc_cv_l1')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgPctField(records, 'sb_conc_cv_l2')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgField(records, 'fb_conc_mean_l1')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgField(records, 'fb_conc_mean_l2')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgPctField(records, 'fb_conc_cv_l1')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgPctField(records, 'fb_conc_cv_l2')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgPctField(records, 'fb_bias_l1')}</td>
                <td className="px-1 py-2 text-center text-[#4DA3FF] text-[11px]">{avgPctField(records, 'fb_bias_l2')}</td>
                <td colSpan={2}></td>
              </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PostsPage({ navTarget, onNavConsumed }: {
  navTarget?: { marker: string; sheet: string } | null;
  onNavConsumed?: () => void;
}) {
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const [selectedSheet, setSelectedSheet]   = useState<string | null>(null);
  const [spec, setSpec] = useState<SpecRow | null>(null);
  const [csMeta, setCsMeta] = useState<CsMeta[]>([]);

  // Handle external navigation from search
  useEffect(() => {
    if (navTarget?.marker) {
      setSelectedMarker(navTarget.marker);
      setSelectedSheet(navTarget.sheet);
      onNavConsumed?.();
    }
  }, [navTarget, onNavConsumed]);

  const { data: markers } = useFetch<string[]>(() => fetchPostMarkers(), []);
  const { data: records, loading: recLoading, setData } = useFetch<PostRecord[]>(
    () => selectedMarker && selectedSheet
      ? fetchPostRecords(selectedMarker, selectedSheet)
      : Promise.resolve([]),
    [selectedMarker, selectedSheet]
  );

  // Fetch spec when marker changes
  useEffect(() => {
    if (!selectedMarker) { setSpec(null); return; }
    lookupSpec(selectedMarker).then(res => {
      const isQbi = /^Q/i.test(selectedMarker);
      setSpec((isQbi ? res.qbi : res.p01) || res.p01 || res.qbi || null);
    }).catch(() => setSpec(null));
  }, [selectedMarker]);

  useEffect(() => {
    fetchCsMeta().then(setCsMeta).catch(() => {});
  }, []);

  const handleSaved = useCallback((updated: PostRecord) => {
    setData(prev => (prev || []).map(r => r.id === updated.id ? updated : r));
  }, [setData]);

  return (
    <div className="flex h-full p-4 overflow-hidden gap-4">

      {/* Col 1: Marker */}
      <div className="w-36 shrink-0 flex flex-col gap-1 overflow-y-auto">
        <span className="text-[10px] font-semibold text-[#93A4C3] uppercase tracking-widest px-1 mb-1">
          Marker
        </span>
        {(markers || []).map(m => (
          <button
            key={m}
            onClick={() => { setSelectedMarker(m); setSelectedSheet(null); }}
            className={`text-left rounded-lg px-3 py-2 text-xs font-medium transition-colors
              ${selectedMarker === m
                ? 'bg-[#4DA3FF]/20 text-[#4DA3FF] border border-[#4DA3FF]/40'
                : 'text-[#93A4C3] hover:bg-[#1A2438] hover:text-[#EAF2FF] border border-transparent'}`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Col 2: Sheets */}
      <div className="w-52 shrink-0 bg-[#111C30] rounded-xl p-3 overflow-hidden flex flex-col">
        <span className="text-[10px] font-semibold text-[#93A4C3] uppercase tracking-widest mb-2">
          批次
        </span>
        {selectedMarker
          ? <SheetList beadName={selectedMarker} selected={selectedSheet} onSelect={setSelectedSheet} />
          : <p className="text-xs text-[#2A3754] mt-4 text-center">← 選擇 Marker</p>}
      </div>

      {/* Col 3: Detail */}
      <div className="flex-1 overflow-y-auto">
        {!selectedSheet && (
          <p className="text-xs text-[#2A3754] mt-8 text-center">← 選擇批次查看詳細</p>
        )}
        {recLoading && <p className="text-[#93A4C3] text-xs p-4">載入中…</p>}
        {records && records.length > 0 && !recLoading && (
          <motion.div
            key={selectedSheet}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
          >
            <SheetDetail records={records} spec={spec} csMeta={csMeta} onSaved={handleSaved} />
          </motion.div>
        )}
      </div>
    </div>
  );
}
