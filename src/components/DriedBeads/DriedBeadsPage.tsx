import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, RefreshCw, CheckCircle, XCircle, Printer, X, Trash2, Upload } from 'lucide-react';
import { useFetch } from '../../api/useFetch';
import {
  fetchBeadMarkers, fetchBeadSheets, fetchBeadRecords, fetchBeadStats, deleteBeadSheet,
  type DrBeadRecord, type SheetSummary, type BeadStat,
} from '../../api/drbeads';
import { uploadExcelBatchChunked } from '../../api/excelImport';
import { lookupSpec } from '../../api/spec';
import type { SpecRow } from '../../api/spec';
import { judgeRecord } from '../../utils/specJudge';
import { fetchCsMeta } from '../../api/csassign';
import type { CsMeta } from '../../api/csassign';

// ── helpers ──────────────────────────────────────────────────────────────────

function passColor(v: string | null) {
  if (!v) return 'text-[#93A4C3]';
  const u = v.toUpperCase();
  if (u.includes('PASS') || u.includes('ACCEPT') || u.includes('可併') || u === '無') return 'text-[#00D4AA]';
  if (u.includes('FAIL') || u.includes('REJECT')) return 'text-[#FF5C73]';
  return 'text-[#EAF2FF]';
}


// ── Stats overview ────────────────────────────────────────────────────────────

function StatsGrid({ selected, onSelect, onImported }: { selected: string | null; onSelect: (bead: string) => void; onImported: () => void }) {
  const { data: stats, loading, refresh } = useFetch<BeadStat[]>(() => fetchBeadStats(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const CHUNK_SIZE = 8;

  const handleFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const allFiles = Array.from(e.target.files || []);
    e.target.value = '';
    const xlsxFiles = allFiles.filter(f => f.name.startsWith('2026-') && f.name.endsWith('.xlsx') && !f.name.startsWith('~$'));
    if (!xlsxFiles.length) { setToast({ msg: '資料夾內無 2026-*.xlsx 檔案', ok: false }); setTimeout(() => setToast(null), 3000); return; }
    setUploading(true);
    setProgress(`第 0 / ${xlsxFiles.length} 檔`);
    setToast(null);
    try {
      const r = await uploadExcelBatchChunked(
        xlsxFiles,
        CHUNK_SIZE,
        (done, total) => setProgress(`第 ${done} / ${total} 檔`),
      );
      const details = r.results.filter(f => f.imported > 0).map(f => f.bead_name).join(', ');
      setToast({ msg: `✅ 完成！${r.imported_files} 檔匯入 ${r.total_sheets} 批次${r.skipped_sheets ? `, 略過 ${r.skipped_sheets} 批 (已存在)` : ''}${details ? ` — ${details}` : ''}`, ok: true });
      refresh();
      onImported();
    } catch (err: any) {
      setToast({ msg: `❌ ${err.message || '匯入失敗'}`, ok: false });
    } finally {
      setUploading(false);
      setProgress('');
      setTimeout(() => setToast(null), 8000);
    }
  };

  if (loading && !uploading) return <div className="text-[#93A4C3] text-sm p-4">載入中…</div>;
  const year = new Date().getFullYear();
  return (
    <div>
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <div className="text-[10px] text-[#556A88]">{year} 年度 Beads 檢驗總覽</div>
        {/* @ts-expect-error webkitdirectory is non-standard */}
        <input ref={fileRef} type="file" webkitdirectory="" className="hidden" onChange={handleFolder} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold transition-all
            ${uploading
              ? 'bg-[#4DA3FF]/30 text-[#4DA3FF] cursor-wait animate-pulse'
              : 'bg-[#4DA3FF] text-white hover:bg-[#3A8FEF] hover:shadow-md hover:shadow-[#4DA3FF]/25 active:scale-95'}`}
        >
          <Upload size={12} />
          {uploading ? '匯入中…' : '📂 Load Excel 資料夾'}
        </button>
        {uploading && progress && (
          <span className="text-[10px] text-[#4DA3FF] flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 border-2 border-[#4DA3FF] border-t-transparent rounded-full animate-spin" />
            {progress}
          </span>
        )}
        {toast && (
          <span className={`text-[11px] px-3 py-1 rounded-lg font-medium max-w-[500px] truncate
            ${toast.ok ? 'text-[#00D4AA] bg-[#00D4AA]/15 border border-[#00D4AA]/30' : 'text-[#FF5C73] bg-[#FF5C73]/15 border border-[#FF5C73]/30'}`}>
            {toast.msg}
          </span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2 mb-4 sm:grid-cols-6 lg:grid-cols-9">
        {(stats || []).map(s => (
          <div key={s.bead_name}
            onClick={() => onSelect(s.bead_name)}
            className={`rounded-lg p-2 flex flex-col gap-0.5 cursor-pointer transition-all duration-150
              hover:bg-[#243352] hover:scale-[1.04] hover:shadow-lg hover:shadow-[#4DA3FF]/10 hover:border-[#4DA3FF]/30
              border active:scale-[0.97]
              ${selected === s.bead_name
                ? 'bg-[#1A2D50] border-[#4DA3FF]/50 ring-1 ring-[#4DA3FF]/30'
                : 'bg-[#1A2438] border-transparent'}`}>
            <span className="text-[11px] font-bold text-[#4DA3FF]">{s.bead_name}</span>
            <span className="text-[10px] text-[#EAF2FF]">已檢 {s.sheets} 批</span>
            <div className="flex flex-wrap gap-x-2 gap-y-0 text-[10px]">
              {s.failed > 0 && <span className="text-[#FF5C73]">NG {s.failed}</span>}
              {s.hold > 0 && <span className="text-[#FFB84D]">Hold {s.hold}</span>}
              {s.pending > 0 && <span className="text-[#93A4C3]">待判 {s.pending}</span>}
              {s.pending_insp > 0 && <span className="text-[#A78BFA]">待檢 {s.pending_insp}</span>}
              {s.failed === 0 && s.hold === 0 && s.pending === 0 && s.pending_insp === 0 && <span className="text-[#00D4AA]">ALL PASS</span>}
            </div>
            <span className="text-[9px] text-[#3A5070]">{s.last_insp_date?.slice(0, 10) ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sheet list ────────────────────────────────────────────────────────────────

function SheetList({
  beadName, selected, onSelect, onDelete,
}: { beadName: string; selected: string | null; onSelect: (s: string) => void; onDelete: (beadName: string, sheetName: string) => Promise<void> }) {
  const { data: sheets, loading, refresh } = useFetch<SheetSummary[]>(
    () => fetchBeadSheets(beadName), [beadName]
  );
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);

  const handleDelete = async (sheetName: string) => {
    try {
      await onDelete(beadName, sheetName);
    } catch (err) {
      console.error('delete failed', err);
    } finally {
      setConfirmTarget(null);
      refresh();
    }
  };

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
          <div key={s.sheet_name} className="relative">
            {confirmTarget === s.sheet_name ? (
              <div className="rounded-lg px-3 py-2 bg-[#2A1520] border border-[#FF5C73]/40 text-center space-y-1.5">
                <p className="text-[10px] text-[#FF5C73]">確定刪除此批次？</p>
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={async () => { await handleDelete(s.sheet_name); }}
                    className="px-2 py-0.5 text-[10px] rounded bg-[#FF5C73] text-white hover:bg-[#E04460]"
                  >刪除</button>
                  <button
                    onClick={() => setConfirmTarget(null)}
                    className="px-2 py-0.5 text-[10px] rounded bg-[#1A2438] text-[#93A4C3] hover:bg-[#2A3754]"
                  >取消</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => onSelect(s.sheet_name)}
                className={`w-full text-left rounded-lg px-3 py-2 transition-colors flex items-center justify-between group
                  ${selected === s.sheet_name
                    ? 'bg-[#4DA3FF]/20 border border-[#4DA3FF]/40'
                    : 'bg-[#1A2438] hover:bg-[#1E2D46] border border-transparent'}`}
              >
                <div>
                  <div className="text-xs font-mono text-[#EAF2FF]">{s.sheet_name}</div>
                  <div className="text-[10px] text-[#93A4C3] mt-0.5">{s.insp_date?.slice(0, 10) ?? '—'} · {s.combo_count} 組</div>
                </div>
                <div className="flex items-center gap-1">
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); setConfirmTarget(s.sheet_name); }}
                    className="text-[#556A88] opacity-0 group-hover:opacity-100 hover:text-[#FF5C73] transition-all p-0.5"
                  >
                    <Trash2 size={11} />
                  </span>
                  <ChevronRight size={12} className="text-[#4DA3FF] opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Decision chip ─────────────────────────────────────────────────────────────

function DecisionChip({ value }: { value: string | null }) {
  if (!value) return <span className="text-[#2A3754] text-xs">—</span>;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${passColor(value)}`}
      style={{ background: 'rgba(255,255,255,0.06)' }}>
      {value}
    </span>
  );
}

// ── Compact sheet summary (all lots in one table) ─────────────────────────────

function SheetSummaryView({
  records,
  spec,
  onShowForm,
}: {
  records: DrBeadRecord[];
  spec: SpecRow | null;
  onShowForm: () => void;
}) {
  const first = records[0];
  if (!first) return null;

  return (
    <div className="bg-[#111C30] rounded-xl border border-[#2A3754] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A3754]">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-mono font-bold text-[#EAF2FF] shrink-0">{first.sheet_name}</span>
          {first.product_name && (
            <span className="text-xs text-[#93A4C3] truncate">{first.product_name}</span>
          )}
          <span className="text-xs text-[#4DA3FF] shrink-0">{first.insp_date?.slice(0, 10) || '—'}</span>
        </div>
        <button
          onClick={onShowForm}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4DA3FF]/20 text-[#4DA3FF] text-xs hover:bg-[#4DA3FF]/30 transition-colors shrink-0 ml-3"
        >
          <Printer size={12} />
          查看 / 列印
        </button>
      </div>

      {/* Lot table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#2A3754] bg-[#0F1A2E]">
              <th className="text-left px-4 py-2 text-[#93A4C3] font-medium whitespace-nowrap">批號組合</th>
              <th className="text-center px-3 py-2 text-[#93A4C3] font-medium">外觀</th>
              <th className="text-center px-3 py-2 text-[#93A4C3] font-medium whitespace-nowrap">OD CV</th>
              <th className="text-center px-3 py-2 text-[#93A4C3] font-medium whitespace-nowrap">Conc CV</th>
              <th className="text-center px-3 py-2 text-[#93A4C3] font-medium whitespace-nowrap">Mean Bias L1/L2</th>
              <th className="text-center px-3 py-2 text-[#93A4C3] font-medium whitespace-nowrap">可併</th>
              <th className="text-center px-3 py-2 text-[#93A4C3] font-medium whitespace-nowrap">總結</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec, idx) => (
              <tr
                key={rec.id}
                className={`hover:bg-[#1A2438]/50 transition-colors ${idx < records.length - 1 ? 'border-b border-[#1A2438]/60' : ''}`}
              >
                <td className="px-4 py-2.5 font-mono text-[#EAF2FF] whitespace-nowrap">
                  {rec.batch_combo?.replace(/\s+/g, '\u2009/\u2009') || `Col ${rec.batch_col}`}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1 justify-center">
                    {[
                      { v: rec.crack, label: '碎裂' },
                      { v: rec.dirt,  label: '髒汙' },
                      { v: rec.color, label: '顏色' },
                    ].map(({ v, label }) => (
                      <span key={label} title={`${label}: ${v || '—'}`}>
                        {!v ? (
                          <span className="text-[#2A3754] text-[10px]">—</span>
                        ) : v.toUpperCase() === 'PASS' || v === '無' ? (
                          <CheckCircle size={11} className="text-[#00D4AA]" />
                        ) : (
                          <XCircle size={11} className="text-[#FF5C73]" />
                        )}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center text-[#EAF2FF] whitespace-nowrap">
                  {[['L1',rec.od_cv_l1 || rec.od_cvpct_l1],['L2',rec.od_cv_l2 || rec.od_cvpct_l2],['N1',rec.od_cv_n1 || rec.od_cvpct_n1],['N3',rec.od_cv_n3 || rec.od_cvpct_n3]].filter(([,v]) => v).map(([l,v]) => `${l}:${fmtPct(v as string)}`).join(' / ') || '—'}
                </td>
                <td className="px-3 py-2.5 text-center text-[#EAF2FF] whitespace-nowrap">
                  {[['L1',rec.rconc_cv_l1 || rec.conc_cvpct_l1],['L2',rec.rconc_cv_l2 || rec.conc_cvpct_l2],['N1',rec.rconc_cv_n1],['N3',rec.rconc_cv_n3]].filter(([,v]) => v).map(([l,v]) => `${l}:${fmtPct(v as string)}`).join(' / ') || '—'}
                </td>
                <td className="px-3 py-2.5 text-center text-[#EAF2FF] whitespace-nowrap">
                  {fmtPct(rec.mean_bias_l1) || '—'} / {fmtPct(rec.mean_bias_l2) || '—'}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {(() => { const j = judgeRecord(rec, spec); return <DecisionChip value={rec.batch_decision || j.mergeLabel} />; })()}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {(() => { const j = judgeRecord(rec, spec); return <DecisionChip value={rec.final_decision || j.finalLabel} />; })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Defect notes */}
      {records.some(r => r.defect_desc) && (
        <div className="px-4 py-2 border-t border-[#2A3754] space-y-1">
          {records.filter(r => r.defect_desc).map(r => (
            <p key={r.id} className="text-xs">
              <span className="text-[#FF5C73] mr-2">不良現象:</span>
              <span className="text-[#EAF2FF]">{r.defect_desc}</span>
            </p>
          ))}
        </div>
      )}


    </div>
  );
}

// ── ISO Inspection Form (printable) ──────────────────────────────────────────

const S = {
  border: '1px solid #93B4D4',
  fontSize: 11,
  padding: '3px 5px',
  color: '#1a1a2e',
  backgroundColor: 'white',
} as React.CSSProperties;

const BG: React.CSSProperties = { backgroundColor: '#CCE5FF' };

const th = { ...S, ...BG, fontWeight: 600, textAlign: 'center' as const };
const td = { ...S, textAlign: 'center' as const };
const tdL = { ...S, textAlign: 'left' as const };

function vStyle(v: string | null): React.CSSProperties {
  if (!v) return td;
  const u = v.toUpperCase();
  if (u.includes('PASS') || u.includes('ACCEPT') || u.includes('可併') || u === '無')
    return { ...td, color: '#16a34a', fontWeight: 700 };
  if (u.includes('FAIL') || u.includes('REJECT'))
    return { ...td, color: '#dc2626', fontWeight: 700 };
  return td;
}

/** Format DB decimal (e.g. 0.034) → "3.4%" */
function fmtPct(v: string | null): string {
  if (!v) return '';
  const num = parseFloat(v);
  if (isNaN(num)) return v;
  return (num * 100).toFixed(1) + '%';
}

/** Format numeric value to 4 decimal places */
/** Format spec string: "< 0.08" → "< 8%", "濃度± 0.05" → "濃度± 5%", "-" → "-" */
function fmtSpec(v: string | null): string {
  if (!v || v === '-' || v === '- -') return v || '—';
  return v.replace(/(\d+\.\d+)/g, (_, d) => {
    const n = parseFloat(d);
    return isNaN(n) ? d : (n * 100).toFixed(0) + '%';
  });
}

function InspectionFormModal({
  records,
  spec,
  csMeta,
  onClose,
}: {
  records: DrBeadRecord[];
  spec: SpecRow | null;
  csMeta: CsMeta[];
  onClose: () => void;
}) {
  const first = records[0];
  const n = records.length;

  const TOTAL = Math.max(8, n); // form shows at least 8 columns, or more if data exceeds 8
  const empty = Math.max(0, TOTAL - n);

  // inject @media print
  useEffect(() => {
    const s = document.createElement('style');
    s.id = 'drbeads-ps';
    s.textContent = `@media print{body>*{visibility:hidden!important}#ifp,#ifp *{visibility:visible!important}#ifp{position:fixed!important;top:0!important;left:0!important;width:100%!important;background:white!important;padding:10mm 8mm!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.no-print{display:none!important}@page{size:landscape;margin:5mm}}`;
    document.head.appendChild(s);
    return () => { document.getElementById('drbeads-ps')?.remove(); };
  }, []);

  // PASS/FAIL coloured cells (外觀, 判定)
  const dataCells = (getter: (r: DrBeadRecord) => string | null, rowIdx: number) => (
    <>
      {records.map((rec, i) => { const v = getter(rec); return <td key={i} style={vStyle(v)}>{v || ''}</td>; })}
      {Array(empty).fill(0).map((_, i) => <td key={`e${rowIdx}_${i}`} style={td}></td>)}
    </>
  );

  // Numeric % cells (assay measurements) — multiply raw decimal × 100, 1 d.p.
  const numCells = (getter: (r: DrBeadRecord) => string | null, rowIdx: number) => (
    <>
      {records.map((rec, i) => <td key={i} style={td}>{fmtPct(getter(rec))}</td>)}
      {Array(empty).fill(0).map((_, i) => <td key={`n${rowIdx}_${i}`} style={td}></td>)}
    </>
  );

  const reagents = [
    { label: 'd劑', p: 'd' },
    { label: 'D劑', p: 'bigD' },
    { label: 'U劑', p: 'u' },
  ] as { label: string; p: 'd' | 'bigD' | 'u' }[];

  const diag = (topRight: string, btmLeft: string) => (
    <th style={{ ...th, position: 'relative', height: 44, overflow: 'hidden', minWidth: 80 }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1="0" y1="0" x2="100" y2="100" stroke="#93B4D4" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <span style={{ position: 'absolute', top: 3, right: 5, fontSize: 9 }}>{topRight}</span>
      <span style={{ position: 'absolute', bottom: 3, left: 5, fontSize: 9 }}>{btmLeft}</span>
    </th>
  );

  return (
    <div className="fixed inset-0 z-50 overflow-auto flex justify-center p-4 pt-14" style={{ backgroundColor: 'white' }}>
      {/* controls */}
      <div className="fixed top-3 right-4 flex gap-2 z-50 no-print">
        <button onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 bg-[#4DA3FF] text-white rounded-lg text-sm font-medium hover:bg-[#3A8FEF]">
          <Printer size={14} /> 列印
        </button>
        <button onClick={onClose}
          className="flex items-center gap-2 px-4 py-2 bg-[#1A2438] text-[#93A4C3] rounded-lg text-sm hover:bg-[#2A3754]">
          <X size={14} /> 關閉
        </button>
      </div>

      <div id="ifp" style={{ background: 'white', maxWidth: 1200, width: '100%', marginTop: 8, borderRadius: 8, padding: 16, paddingBottom: 60, fontFamily: 'Arial, sans-serif', minHeight: '100%' }}>

        {/* ── TITLE ── */}
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '2px solid #1a2d6e', paddingBottom: 4, marginBottom: 8 }}>
          <img src="/skyla-logo.jpg" alt="skyla" style={{ height: 32, marginRight: 12 }} />
          <div style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: 700, color: '#1a2d6e' }}>
            Dried Beads半成品檢驗紀錄
          </div>
        </div>

        {/* ── HEADER: 品名 / 試劑 / well ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
          <colgroup>
            <col style={{ width: '7%' }} />  {/* reagent label */}
            <col style={{ width: '12%' }} /> {/* 料號 */}
            <col style={{ width: '10%' }} /> {/* 生產日期 */}
            <col style={{ width: '9%' }} />  {/* lot Q */}
            <col style={{ width: '9%' }} />  {/* lot R */}
            <col style={{ width: '9%' }} />  {/* lot S */}
            <col style={{ width: '9%' }} />  {/* lot T */}
            <col style={{ width: '13%' }} /> {/* 工單號碼 */}
            <col style={{ width: '12%' }} /> {/* 送驗數量 */}
            <col style={{ width: '10%' }} /> {/* 抽樣數量 */}
          </colgroup>
          <tbody>
            {/* 品名 row */}
            <tr>
              <td style={{ ...th, textAlign: 'left' }}>品名</td>
              <td colSpan={5} style={{ ...th, textAlign: 'center', fontSize: 14, fontWeight: 700 }}>
                {first?.product_name || first?.bead_name || '—'}
              </td>
              <td style={{ ...th, textAlign: 'left' }}>檢驗日期</td>
              <td colSpan={3} style={{ ...th, textAlign: 'center' }}>
                {first?.insp_date?.slice(0, 10)?.replace(/-/g, '/') || '—'}
              </td>
            </tr>
            {/* sub-header */}
            <tr>
              <td style={th}></td>
              <td style={th}>料號</td>
              <td style={th}>生產日期</td>
              <td colSpan={4} style={th}>批號</td>
              <td style={th}>工單號碼</td>
              <td style={th}>送驗數量</td>
              <td style={th}>抽樣數量</td>
            </tr>
            {/* d劑 / D劑 / U劑 */}
            {reagents.map(({ label, p }) => {
              const r0 = first as any;
              return (
                <tr key={label}>
                  <td style={{ ...th, textAlign: 'left' }}>{label}</td>
                  <td style={tdL}>{r0[`${p}_part_no`] || ''}</td>
                  <td style={td}>{r0[`${p}_prod_date`] || ''}</td>
                  {records.map((rec, i) => <td key={i} style={td}>{(rec as any)[`${p}_lot`] || ''}</td>)}
                  {Array(Math.max(0, 4 - n)).fill(0).map((_, i) => <td key={`ef${i}`} style={td}></td>)}
                  <td style={tdL}>{r0[`${p}_work_order`] || ''}</td>
                  <td style={td}>{r0[`${p}_send_qty`] || ''}</td>
                  <td style={td}>{r0[`${p}_sample_qty`] || ''}</td>
                </tr>
              );
            })}
            {/* well / std / machine */}
            <tr>
              <td rowSpan={4} style={{ ...th, verticalAlign: 'middle', textAlign: 'center', lineHeight: 1.4 }}>
                填藥位置<br />(well)
              </td>
              <td rowSpan={4} style={{ ...td, verticalAlign: 'middle', textAlign: 'center', fontSize: 13, fontWeight: 700 }}>
                {first?.well_position || '—'}
              </td>
              <td colSpan={5} style={tdL}>標準品品名: {csMeta[0]?.cs_title || first?.std_name || '—'}</td>
              <td rowSpan={4} style={{ ...th, verticalAlign: 'middle' }}>機台編號</td>
              <td style={th}>L1</td>
              <td style={tdL}>{first?.machine_L1 || '—'}</td>
            </tr>
            <tr>
              <td colSpan={5} style={tdL}>批號/效期: {csMeta.length > 0 ? csMeta.map(m => `${m.cs_lot || ''} ${m.cs_expiry || ''}`).join('、') : (first?.std_lot_l1 || '—')}</td>
              <td style={th}>L2</td>
              <td style={tdL}>{first?.machine_L2 || '—'}</td>
            </tr>
            <tr>
              <td colSpan={5} style={tdL}>{first?.std_lot_l2 || ''}</td>
              <td style={th}>N1</td>
              <td style={tdL}>{first?.machine_N1 || '—'}</td>
            </tr>
            <tr>
              <td colSpan={5} style={td}></td>
              <td style={th}>N3</td>
              <td style={tdL}>{first?.machine_N3 || '—'}</td>
            </tr>
          </tbody>
        </table>

        {/* ── I. 外觀 ── */}
        <div style={{ fontSize: 12, fontWeight: 600, color: '#1a2d6e', marginBottom: 2 }}>Inspection Record</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#1a2d6e', marginBottom: 4 }}>I. 外觀</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
          <colgroup>
            <col style={{ width: '30%' }} />
            {Array(TOTAL).fill(0).map((_, i) => <col key={i} style={{ width: `${70 / TOTAL}%` }} />)}
          </colgroup>
          <thead>
            <tr>
              {diag('批號', '檢驗標準項目')}
              {records.map((rec, i) => <th key={i} style={{ ...th, fontSize: 10 }}>{rec.batch_combo || '—'}</th>)}
              {Array(empty).fill(0).map((_, i) => <th key={`eh${i}`} style={th}></th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...tdL, lineHeight: 1.5 }}>
                1. 是否有碎裂、剝落或破孔之情況<br />
                <span style={{ fontSize: 9, color: '#555' }}>方法:目視</span><br />
                <span style={{ fontSize: 9, color: '#555' }}>標準:不可有碎裂剝落或破孔之情況</span>
              </td>
              {dataCells(r => r.crack, 0)}
            </tr>
            <tr>
              <td style={{ ...tdL, lineHeight: 1.5 }}>
                2. 是否有髒汙<br />
                <span style={{ fontSize: 9, color: '#555' }}>方法:目視</span><br />
                <span style={{ fontSize: 9, color: '#555' }}>標準:不可有髒汙</span>
              </td>
              {dataCells(r => r.dirt, 1)}
            </tr>
            <tr>
              <td style={{ ...tdL, lineHeight: 1.5 }}>
                3. Bead顏色是否正確<br />
                <span style={{ fontSize: 9, color: '#555' }}>方法:目視</span><br />
                <span style={{ fontSize: 9, color: '#555' }}>標準:Refer to criterion of each object</span><br />
                <span style={{ fontSize: 9, color: '#555' }}>(參照MHB21003)</span>
              </td>
              {dataCells(r => r.color, 2)}
            </tr>
          </tbody>
        </table>

        {/* ── II. Assay Performance ── */}
        <div style={{ fontSize: 12, fontWeight: 600, color: '#1a2d6e', marginBottom: 4 }}>
          II. Assay Performance (化學特性)
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 6 }}>
          <colgroup>
            <col style={{ width: '8%' }} />  {/* category */}
            <col style={{ width: '5%' }} />  {/* level */}
            <col style={{ width: '10%' }} /> {/* spec */}
            {Array(TOTAL).fill(0).map((_, i) => <col key={i} style={{ width: `${77 / TOTAL}%` }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={th} colSpan={2}>CV</th>
              {diag('批號', '規格')}
              {records.map((rec, i) => <th key={i} style={{ ...th, fontSize: 10 }}>{rec.batch_combo || '—'}</th>)}
              {Array(empty).fill(0).map((_, i) => <th key={`ah${i}`} style={th}></th>)}
            </tr>
          </thead>
          <tbody>
            {/* OD CV — show rows that have data */}
            {([
              { lv: 'L1', g: (r: DrBeadRecord) => r.od_cv_l1 || r.od_cvpct_l1, sp: spec?.single_cv || first?.od_cv_spec },
              { lv: 'L2', g: (r: DrBeadRecord) => r.od_cv_l2 || r.od_cvpct_l2, sp: spec?.single_cv || first?.od_cv_spec },
              { lv: 'N1', g: (r: DrBeadRecord) => r.od_cv_n1 || r.od_cvpct_n1, sp: spec?.single_cv || first?.od_cv_spec },
              { lv: 'N3', g: (r: DrBeadRecord) => r.od_cv_n3 || r.od_cvpct_n3, sp: spec?.single_cv || first?.od_cv_spec },
            ] as { lv: string; g: (r: DrBeadRecord) => string | null; sp?: string | null }[]).filter(row => records.some(r => row.g(r))).map((row, ri, arr) => (
              <tr key={`od${ri}`}>
                {ri === 0 && <td rowSpan={arr.length} style={{ ...th, verticalAlign: 'middle' }}>☑OD CV</td>}
                <td style={td}>{row.lv}</td>
                <td style={{ ...td, fontSize: 10, color: '#555' }}>{fmtSpec(row.sp ?? null)}</td>
                {numCells(row.g, 10 + ri)}
              </tr>
            ))}
            {/* Conc.CV — show rows that have data */}
            {([
              { lv: 'L1', g: (r: DrBeadRecord) => r.rconc_cv_l1 || r.conc_cvpct_l1, sp: spec?.single_cv || first?.rconc_cv_spec },
              { lv: 'L2', g: (r: DrBeadRecord) => r.rconc_cv_l2 || r.conc_cvpct_l2, sp: spec?.single_cv || first?.rconc_cv_spec },
              { lv: 'N1', g: (r: DrBeadRecord) => r.rconc_cv_n1, sp: spec?.single_cv || first?.rconc_cv_spec },
              { lv: 'N3', g: (r: DrBeadRecord) => r.rconc_cv_n3, sp: spec?.single_cv || first?.rconc_cv_spec },
            ] as { lv: string; g: (r: DrBeadRecord) => string | null; sp?: string | null }[]).filter(row => records.some(r => row.g(r))).map((row, ri, arr) => (
              <tr key={`rc${ri}`}>
                {ri === 0 && <td rowSpan={arr.length} style={{ ...th, verticalAlign: 'middle' }}>☑Conc.CV</td>}
                <td style={td}>{row.lv}</td>
                <td style={{ ...td, fontSize: 10, color: '#555' }}>{fmtSpec(row.sp ?? null)}</td>
                {numCells(row.g, 20 + ri)}
              </tr>
            ))}
            {/* Mean Bias */}
            {([
              { lv: 'L1', g: (r: DrBeadRecord) => r.mean_bias_l1, sp: spec?.merge_bias || first?.mean_bias_spec },
              { lv: 'L2', g: (r: DrBeadRecord) => r.mean_bias_l2, sp: spec?.merge_bias || first?.mean_bias_spec },
            ] as { lv: string; g: (r: DrBeadRecord) => string | null; sp?: string | null }[]).map((row, ri) => (
              <tr key={`mb${ri}`}>
                {ri === 0 && <td rowSpan={2} style={{ ...th, verticalAlign: 'middle' }}>Mean Bias</td>}
                <td style={td}>{row.lv}</td>
                <td style={{ ...td, fontSize: 10, color: '#555' }}>{fmtSpec(row.sp ?? null)}</td>
                {numCells(row.g, 30 + ri)}
              </tr>
            ))}
            {/* 全批次CV */}
            {([
              { lv: 'L1', g: (r: DrBeadRecord) => r.total_cv_l1, sp: spec?.merge_cv || first?.total_cv_spec },
              { lv: 'L2', g: (r: DrBeadRecord) => r.total_cv_l2, sp: spec?.merge_cv || first?.total_cv_spec },
            ] as { lv: string; g: (r: DrBeadRecord) => string | null; sp?: string | null }[]).map((row, ri) => (
              <tr key={`tc${ri}`}>
                {ri === 0 && <td rowSpan={2} style={{ ...th, verticalAlign: 'middle' }}>全批次CV</td>}
                <td style={td}>{row.lv}</td>
                <td style={{ ...td, fontSize: 10, color: '#555' }}>{fmtSpec(row.sp ?? null)}</td>
                {numCells(row.g, 40 + ri)}
              </tr>
            ))}
            {/* 起始值 */}
            {([
              { lv: 'L1', g: (r: DrBeadRecord) => r.initial_l1, sp: spec?.init_l1_od || first?.initial_spec },
              { lv: 'L2', g: (r: DrBeadRecord) => r.initial_l2, sp: spec?.init_l2_od || first?.initial_spec },
            ] as { lv: string; g: (r: DrBeadRecord) => string | null; sp?: string | null }[]).map((row, ri) => (
              <tr key={`ic${ri}`}>
                {ri === 0 && <td rowSpan={2} style={{ ...th, verticalAlign: 'middle' }}>起始值</td>}
                <td style={td}>{row.lv}</td>
                <td style={{ ...td, fontSize: 10, color: '#555' }}>{fmtSpec(row.sp ?? null)}</td>
                {numCells(row.g, 50 + ri)}
              </tr>
            ))}
            {/* 併批判定 */}
            <tr>
              <td colSpan={3} style={{ ...th, textAlign: 'center' }}>併批判定</td>
              {records.map((rec, i) => { const j = judgeRecord(rec, spec); const v = rec.batch_decision && rec.batch_decision !== '-' ? rec.batch_decision : j.mergeLabel; return <td key={i} style={vStyle(v)}>{v}</td>; })}
              {Array(empty).fill(0).map((_, i) => <td key={`bp${i}`} style={td}></td>)}
            </tr>
            {/* 總結判定 */}
            <tr>
              <td colSpan={3} style={{ ...th, textAlign: 'center' }}>總結判定</td>
              {records.map((rec, i) => { const j = judgeRecord(rec, spec); const v = rec.final_decision && rec.final_decision !== '-' ? rec.final_decision : j.finalLabel; return <td key={i} style={vStyle(v)}>{v}</td>; })}
              {Array(empty).fill(0).map((_, i) => <td key={`fp${i}`} style={td}></td>)}
            </tr>
            {/* 不良現象描述 */}
            <tr>
              <td colSpan={3} style={{ ...th, textAlign: 'center' }}>不良現象描述</td>
              <td colSpan={TOTAL} style={tdL}>{records.find(r => r.defect_desc)?.defect_desc || ''}</td>
            </tr>
            {/* 備　　　　註 */}
            <tr>
              <td colSpan={3} style={{ ...th, textAlign: 'center' }}>備　　　　註</td>
              <td colSpan={TOTAL} style={tdL}>{records.find(r => r.remarks)?.remarks || ''}</td>
            </tr>
          </tbody>
        </table>

        {/* document number + signatures */}
        <div style={{ textAlign: 'right', fontSize: 10, color: '#1a2d6e', marginBottom: 6 }}>MHB2-12D</div>
        <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: 12, color: '#1a1a2e', borderTop: '1px solid #ccc', paddingTop: 8, marginBottom: 40 }}>
          <span>核準: _______________________</span>
          <span>檢驗員: _______________________</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DriedBeadsPage({ navTarget, onNavConsumed, onSelectionChange }: {
  navTarget?: { marker: string; sheet: string } | null;
  onNavConsumed?: () => void;
  onSelectionChange?: (marker: string | null, sheet: string | null) => void;
}) {
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const [selectedSheet,  setSelectedSheet]  = useState<string | null>(null);
  const [showForm,       setShowForm]        = useState(false);
  const [spec,           setSpec]            = useState<SpecRow | null>(null);
  const [csMeta,         setCsMeta]          = useState<CsMeta[]>([]);

  // Handle external navigation from search
  useEffect(() => {
    if (navTarget?.marker) {
      setSelectedMarker(navTarget.marker);
      setSelectedSheet(navTarget.sheet);
      setShowForm(false);
      onNavConsumed?.();
    }
  }, [navTarget, onNavConsumed]);

  // Notify parent of current selection
  useEffect(() => {
    onSelectionChange?.(selectedMarker, selectedSheet);
  }, [selectedMarker, selectedSheet]);

  const { data: markers, refresh: refreshMarkers } = useFetch<string[]>(() => fetchBeadMarkers(), []);
  const { data: records, loading: recLoading } = useFetch<DrBeadRecord[]>(
    () => selectedMarker && selectedSheet
      ? fetchBeadRecords(selectedMarker, selectedSheet)
      : Promise.resolve([]),
    [selectedMarker, selectedSheet]
  );

  // Fetch spec when marker changes
  useEffect(() => {
    if (!selectedMarker) { setSpec(null); return; }
    lookupSpec(selectedMarker).then(res => {
      // Prefer Qbi for Q-prefixed beads, otherwise P01
      const isQbi = /^Q/i.test(selectedMarker);
      setSpec((isQbi ? res.qbi : res.p01) || res.p01 || res.qbi || null);
    }).catch(() => setSpec(null));
  }, [selectedMarker]);

  // Fetch CS meta once
  useEffect(() => {
    fetchCsMeta().then(setCsMeta).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col h-full p-4 overflow-hidden gap-4">

      {/* Stats row */}
      <StatsGrid selected={selectedMarker} onImported={() => { refreshMarkers(); }} onSelect={async (bead) => {
        setSelectedMarker(bead);
        setShowForm(false);
        try {
          const sheets = await fetchBeadSheets(bead);
          if (sheets.length > 0) {
            const latest = sheets.reduce((a, b) => (a.insp_date || '') >= (b.insp_date || '') ? a : b);
            setSelectedSheet(latest.sheet_name);
          } else {
            setSelectedSheet(null);
          }
        } catch { setSelectedSheet(null); }
      }} />

      {/* Three-column layout */}
      <div className="flex flex-1 gap-4 overflow-hidden min-h-0">

        {/* Col 1: Marker selector */}
        <div className="w-36 shrink-0 flex flex-col gap-1 overflow-y-auto">
          <span className="text-[10px] font-semibold text-[#93A4C3] uppercase tracking-widest px-1 mb-1">
            Marker
          </span>
          {(markers || []).map(m => (
            <button
              key={m}
              onClick={() => { setSelectedMarker(m); setSelectedSheet(null); setShowForm(false); }}
              className={`text-left rounded-lg px-3 py-2 text-xs font-medium transition-colors
                ${selectedMarker === m
                  ? 'bg-[#4DA3FF]/20 text-[#4DA3FF] border border-[#4DA3FF]/40'
                  : 'text-[#93A4C3] hover:bg-[#1A2438] hover:text-[#EAF2FF] border border-transparent'}`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Col 2: Sheet list */}
        <div className="w-52 shrink-0 bg-[#111C30] rounded-xl p-3 overflow-hidden flex flex-col">
          <span className="text-[10px] font-semibold text-[#93A4C3] uppercase tracking-widest mb-2">
            檢驗批次
          </span>
          {selectedMarker
            ? <SheetList
                beadName={selectedMarker}
                selected={selectedSheet}
                onSelect={(s) => { setSelectedSheet(s); setShowForm(false); }}
                onDelete={async (beadName, sheetName) => {
                  await deleteBeadSheet(beadName, sheetName);
                  if (selectedSheet === sheetName) { setSelectedSheet(null); setShowForm(false); }
                }}
              />
            : <p className="text-xs text-[#2A3754] mt-4 text-center">← 選擇 Marker</p>}
        </div>

        {/* Col 3: Sheet summary */}
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
              <SheetSummaryView
                records={records}
                spec={spec}
                onShowForm={() => setShowForm(true)}
              />
            </motion.div>
          )}
        </div>
      </div>

      {/* ISO Inspection form modal */}
      {showForm && records && records.length > 0 && (
        <InspectionFormModal
          records={records}
          spec={spec}
          csMeta={csMeta}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
