import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, CheckCircle, Clock, RefreshCw } from 'lucide-react';
import {
  fetchTuttiCurves, fetchTuttiCurve, updateTuttiCurve, confirmTuttiCurve, deleteTuttiCurve,
  type TuttiCurve, type ImportResult,
} from '../../api/tutti';
import TuttiImportModal from './TuttiImportModal';
import CurveChart from './CurveChart';

const EMPTY_OD = { l1: [] as number[], l2: [] as number[], n1: [] as number[], n3: [] as number[] };
const EMPTY_CONCS = { l1: null as number | null, l2: null as number | null, n1: null as number | null, n3: null as number | null };

function fmtDate(s: string | null) {
  return s ? s.slice(0, 10) : '—';
}

function StatusBadge({ status }: { status: TuttiCurve['status'] }) {
  return status === 'confirmed' ? (
    <span className="flex items-center gap-1 text-[10px] text-[#34D399] bg-[#34D399]/10 px-2 py-0.5 rounded-full">
      <CheckCircle size={9} /> 已確認
    </span>
  ) : (
    <span className="flex items-center gap-1 text-[10px] text-[#FBBF24] bg-[#FBBF24]/10 px-2 py-0.5 rounded-full">
      <Clock size={9} /> Pending
    </span>
  );
}

export default function TuttiPage() {
  const [curves, setCurves] = useState<TuttiCurve[]>([]);
  const [selected, setSelected] = useState<TuttiCurve | null>(null);
  const [detail, setDetail] = useState<TuttiCurve | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Editable fields
  const [slope, setSlope] = useState('');
  const [intercept, setIntercept] = useState('');
  const [r2, setR2] = useState('');
  const [baseL1, setBaseL1] = useState('');
  const [baseL2, setBaseL2] = useState('');
  const [baseN1, setBaseN1] = useState('');
  const [baseN3, setBaseN3] = useState('');
  const [notes, setNotes] = useState('');
  const [odData, setOdData] = useState(EMPTY_OD);
  const [concs, setConcs] = useState(EMPTY_CONCS);

  const loadList = useCallback(async () => {
    setLoading(true);
    try { setCurves(await fetchTuttiCurves()); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const selectCurve = useCallback(async (c: TuttiCurve) => {
    setSelected(c);
    setDeleteConfirm(false);
    setConfirmError('');
    setConfirmName('');
    try {
      const full = await fetchTuttiCurve(c.id);
      setDetail(full);
      setSlope(full.od_slope?.toString() ?? '');
      setIntercept(full.od_intercept?.toString() ?? '');
      setR2(full.od_r2?.toString() ?? '');
      setBaseL1(full.baseline_l1?.toString() ?? '');
      setBaseL2(full.baseline_l2?.toString() ?? '');
      setBaseN1(full.baseline_n1?.toString() ?? '');
      setBaseN3(full.baseline_n3?.toString() ?? '');
      setNotes(full.notes ?? '');
      setOdData(full.raw_od ?? EMPTY_OD);
      // Reconstruct concs from baseline values as X-axis markers
      setConcs({
        l1: full.baseline_l1,
        l2: full.baseline_l2,
        n1: full.baseline_n1,
        n3: full.baseline_n3,
      });
    } catch { /* ignore */ }
  }, []);

  const handleImported = useCallback((result: ImportResult) => {
    setShowImport(false);
    loadList().then(() => {
      // auto-select the new record
      selectCurve(result);
      setConcs(result.concs);
    });
  }, [loadList, selectCurve]);

  const handleSave = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      const updated = await updateTuttiCurve(detail.id, {
        od_slope: slope ? Number(slope) : undefined,
        od_intercept: intercept ? Number(intercept) : undefined,
        od_r2: r2 ? Number(r2) : undefined,
        baseline_l1: baseL1 ? Number(baseL1) : undefined,
        baseline_l2: baseL2 ? Number(baseL2) : undefined,
        baseline_n1: baseN1 ? Number(baseN1) : undefined,
        baseline_n3: baseN3 ? Number(baseN3) : undefined,
        notes: notes || undefined,
      });
      setDetail(updated);
      setCurves(prev => prev.map(c => c.id === updated.id ? updated : c));
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const handleConfirm = async () => {
    if (!detail || !confirmName.trim()) { setConfirmError('請輸入確認人姓名'); return; }
    setSaving(true);
    try {
      const updated = await confirmTuttiCurve(detail.id, confirmName.trim());
      setDetail(updated);
      setCurves(prev => prev.map(c => c.id === updated.id ? updated : c));
      setSelected(updated);
      setConfirmName('');
      setConfirmError('');
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : '確認失敗');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!detail) return;
    try {
      await deleteTuttiCurve(detail.id);
      setCurves(prev => prev.filter(c => c.id !== detail.id));
      setDetail(null);
      setSelected(null);
      setDeleteConfirm(false);
    } catch { /* ignore */ }
  };

  const isConfirmed = detail?.status === 'confirmed';
  const inputCls = `bg-[#0B1220] border border-[#2A3754] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#EAF2FF] focus:outline-none focus:border-[#4DA3FF] transition-colors w-full ${isConfirmed ? 'opacity-50 cursor-not-allowed' : ''}`;

  const slopeNum = parseFloat(slope) || null;
  const interceptNum = parseFloat(intercept) || null;
  const r2Num = parseFloat(r2) || null;
  const chartConcs = {
    l1: parseFloat(baseL1) || concs.l1,
    l2: parseFloat(baseL2) || concs.l2,
    n1: parseFloat(baseN1) || concs.n1,
    n3: parseFloat(baseN3) || concs.n3,
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left panel: marker list ───────────────────────────────────── */}
      <div className="w-60 shrink-0 border-r border-[#2A3754] flex flex-col">
        <div className="flex items-center justify-between px-3 py-3 border-b border-[#2A3754]">
          <h3 className="text-xs font-bold text-[#EAF2FF]">批次清單</h3>
          <div className="flex gap-1">
            <button onClick={loadList} title="重新整理"
              className="text-[#556A88] hover:text-[#EAF2FF] transition-colors p-1">
              <RefreshCw size={12} />
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-[#4DA3FF]/10 text-[#4DA3FF] hover:bg-[#4DA3FF]/20 transition-colors"
            >
              <Plus size={10} /> 匯入
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-[10px] text-[#556A88] p-3">載入中...</p>
          ) : curves.length === 0 ? (
            <p className="text-[10px] text-[#556A88] p-3">尚無批次，點擊「匯入」開始</p>
          ) : (
            curves.map(c => (
              <button
                key={c.id}
                onClick={() => selectCurve(c)}
                className={`w-full text-left px-3 py-2.5 border-b border-[#1A2438]/50 transition-colors ${
                  selected?.id === c.id ? 'bg-[#1A2438]' : 'hover:bg-[#1A2438]/50'
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="text-xs font-bold text-[#4DA3FF] truncate">{c.marker}</span>
                  <StatusBadge status={c.status} />
                </div>
                <p className="text-[10px] text-[#93A4C3] mt-0.5 truncate">
                  {c.batch_combo || [c.lot_d, c.lot_bigD, c.lot_u].filter(Boolean).join('/') || '—'}
                </p>
                <p className="text-[10px] text-[#556A88]">{fmtDate(c.prod_date)}</p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right panel: detail ───────────────────────────────────────── */}
      {!detail ? (
        <div className="flex-1 flex items-center justify-center text-[#556A88] text-sm">
          選擇左側批次查看詳情
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Info header */}
          <div className="px-5 py-3 border-b border-[#2A3754] flex items-center gap-4 shrink-0">
            <div>
              <p className="text-xs font-bold text-[#4DA3FF]">{detail.marker}</p>
              <p className="text-[10px] text-[#556A88]">
                {detail.batch_combo || [detail.lot_d, detail.lot_bigD, detail.lot_u].filter(Boolean).join(' / ') || '無批次資訊'}
              </p>
            </div>
            <div className="text-[10px] text-[#556A88] ml-auto flex gap-4">
              {detail.work_order && <span>工單：<span className="text-[#93A4C3]">{detail.work_order}</span></span>}
              <span>生產日期：<span className="text-[#93A4C3]">{fmtDate(detail.prod_date)}</span></span>
              <span>填藥期限：<span className="text-[#93A4C3]">{fmtDate(detail.fill_expiry)}</span></span>
              {detail.quantity && <span>數量：<span className="text-[#93A4C3]">{detail.quantity}</span></span>}
            </div>
            <StatusBadge status={detail.status} />
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Chart */}
            <div className="bg-[#0B1220] border border-[#2A3754] rounded-xl h-64">
              <CurveChart
                odData={odData}
                concs={chartConcs}
                slope={slopeNum}
                intercept={interceptNum}
                r2={r2Num}
              />
            </div>

            {/* Parameters */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] text-[#556A88] mb-1">Slope</p>
                <input value={slope} onChange={e => setSlope(e.target.value)}
                  disabled={isConfirmed} className={inputCls} placeholder="0.000000" />
              </div>
              <div>
                <p className="text-[10px] text-[#556A88] mb-1">Intercept</p>
                <input value={intercept} onChange={e => setIntercept(e.target.value)}
                  disabled={isConfirmed} className={inputCls} placeholder="0.000000" />
              </div>
              <div>
                <p className="text-[10px] text-[#556A88] mb-1">R²</p>
                <input value={r2} onChange={e => setR2(e.target.value)}
                  disabled={isConfirmed} className={inputCls} placeholder="0.000000" />
              </div>
            </div>

            {/* Baseline concentrations */}
            <div>
              <p className="text-[10px] text-[#556A88] mb-2">Baseline OD（X 軸已知濃度，來自 csassign）</p>
              <div className="grid grid-cols-4 gap-2">
                {([['L1', baseL1, setBaseL1], ['L2', baseL2, setBaseL2], ['N1', baseN1, setBaseN1], ['N3', baseN3, setBaseN3]] as const).map(
                  ([label, val, setter]) => (
                    <div key={label}>
                      <p className="text-[10px] text-[#93A4C3] mb-1 font-bold">{label}</p>
                      <input value={val} onChange={e => setter(e.target.value)}
                        disabled={isConfirmed} className={inputCls} placeholder="mg/dL" />
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Notes */}
            <div>
              <p className="text-[10px] text-[#556A88] mb-1">備註</p>
              <input value={notes} onChange={e => setNotes(e.target.value)}
                disabled={isConfirmed} className={inputCls} placeholder="備註..." />
            </div>

            {/* Save button */}
            {!isConfirmed && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-[#1A2438] text-[#93A4C3] hover:text-[#EAF2FF] hover:bg-[#2A3754] transition-colors border border-[#2A3754]"
              >
                {saving ? '儲存中...' : '儲存修改'}
              </button>
            )}

            {/* Confirm section */}
            {!isConfirmed ? (
              <div className="border border-[#2A3754] rounded-xl p-4 space-y-2">
                <p className="text-xs font-bold text-[#EAF2FF]">確認存檔</p>
                <p className="text-[10px] text-[#556A88]">確認後將鎖定此批次回歸線參數，無法再修改。</p>
                <div className="flex gap-2">
                  <input
                    value={confirmName}
                    onChange={e => { setConfirmName(e.target.value); setConfirmError(''); }}
                    placeholder="確認人姓名"
                    className="flex-1 bg-[#0B1220] border border-[#2A3754] rounded-lg px-3 py-1.5 text-xs text-[#EAF2FF] placeholder-[#556A88] focus:outline-none focus:border-[#4DA3FF] transition-colors"
                  />
                  <button
                    onClick={handleConfirm}
                    disabled={saving || !confirmName.trim()}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold bg-[#34D399] text-[#0B1220] hover:bg-[#4AE6AE] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving ? '確認中...' : '確認存檔 ▶'}
                  </button>
                </div>
                {confirmError && <p className="text-[10px] text-[#F87171]">{confirmError}</p>}
              </div>
            ) : (
              <div className="border border-[#34D399]/30 bg-[#34D399]/5 rounded-xl p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-[#34D399]" />
                  <p className="text-xs font-bold text-[#34D399]">已確認存檔</p>
                </div>
                <p className="text-[10px] text-[#556A88] mt-1">
                  確認人：{detail.confirmed_by} · {fmtDate(detail.confirmed_at)}
                </p>
              </div>
            )}

            {/* Delete */}
            {!isConfirmed && (
              <div className="pt-2 border-t border-[#2A3754]">
                {!deleteConfirm ? (
                  <button onClick={() => setDeleteConfirm(true)}
                    className="flex items-center gap-1 text-[10px] text-[#556A88] hover:text-[#F87171] transition-colors">
                    <Trash2 size={11} /> 刪除此批次
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] text-[#F87171]">確定刪除？</p>
                    <button onClick={handleDelete}
                      className="px-2 py-0.5 rounded text-[10px] bg-[#F87171]/20 text-[#F87171] hover:bg-[#F87171]/30 transition-colors">
                      確定
                    </button>
                    <button onClick={() => setDeleteConfirm(false)}
                      className="px-2 py-0.5 rounded text-[10px] text-[#556A88] hover:text-[#EAF2FF] transition-colors">
                      取消
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {showImport && (
        <TuttiImportModal
          onClose={() => setShowImport(false)}
          onImported={handleImported}
        />
      )}
    </div>
  );
}
