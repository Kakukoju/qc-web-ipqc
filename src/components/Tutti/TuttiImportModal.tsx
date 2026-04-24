import { useState, useRef, useEffect } from 'react';
import { X, Upload, ChevronDown } from 'lucide-react';
import { importTuttiCurve, fetchCsConcentrations, type ImportResult, type CsConcentrations } from '../../api/tutti';

interface Props {
  onClose: () => void;
  onImported: (result: ImportResult) => void;
}

const EMPTY_OD = { l1: '', l2: '', n1: '', n3: '' };

export default function TuttiImportModal({ onClose, onImported }: Props) {
  const [marker, setMarker] = useState('');
  const [workOrder, setWorkOrder] = useState('');
  const [lotD, setLotD] = useState('');
  const [lotBigD, setLotBigD] = useState('');
  const [lotU, setLotU] = useState('');
  const [quantity, setQuantity] = useState('');
  const [prodDate, setProdDate] = useState('');
  const [fillExpiry, setFillExpiry] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [concs, setConcs] = useState<CsConcentrations>({ l1: null, l2: null, n1: null, n3: null });
  const [manualOd, setManualOd] = useState(EMPTY_OD);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const markerDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Look up CS concentrations when marker changes
  useEffect(() => {
    if (marker.length < 2) { setConcs({ l1: null, l2: null, n1: null, n3: null }); return; }
    clearTimeout(markerDebounceRef.current);
    markerDebounceRef.current = setTimeout(async () => {
      try {
        const c = await fetchCsConcentrations(marker);
        setConcs(c);
      } catch { /* ignore */ }
    }, 400);
    return () => clearTimeout(markerDebounceRef.current);
  }, [marker]);

  const handleFile = (f: File) => {
    if (!f.name.match(/\.xlsx?$/i)) { setError('請選擇 .xlsx 或 .xls 檔案'); return; }
    setFile(f);
    setError('');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleSubmit = async () => {
    if (!marker.trim()) { setError('請輸入 Marker 名稱'); return; }
    setLoading(true);
    setError('');
    try {
      const fields: Parameters<typeof importTuttiCurve>[0] = { marker: marker.trim() };
      if (workOrder) fields.work_order = workOrder;
      if (lotD) fields.lot_d = lotD;
      if (lotBigD) fields.lot_bigD = lotBigD;
      if (lotU) fields.lot_u = lotU;
      if (quantity) fields.quantity = Number(quantity);
      if (prodDate) fields.prod_date = prodDate;
      if (fillExpiry) fields.fill_expiry = fillExpiry;
      if (notes) fields.notes = notes;

      // Include manual OD if no file or as supplement
      for (const level of ['l1', 'l2', 'n1', 'n3'] as const) {
        const raw = manualOd[level];
        if (raw.trim()) {
          const nums = raw.split(/[\s,]+/).map(Number).filter(v => isFinite(v) && v > 0);
          if (nums.length > 0) {
            (fields as Record<string, unknown>)[`od_${level}_json`] = JSON.stringify(nums);
          }
        }
      }

      const result = await importTuttiCurve(fields, file ?? undefined);
      onImported(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '匯入失敗');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'bg-[#0B1220] border border-[#2A3754] rounded-lg px-3 py-1.5 text-xs text-[#EAF2FF] placeholder-[#556A88] focus:outline-none focus:border-[#4DA3FF] transition-colors w-full';
  const labelCls = 'text-[10px] text-[#556A88] mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#121A2B] border border-[#2A3754] rounded-2xl shadow-2xl w-[640px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2A3754]">
          <h2 className="text-sm font-bold text-[#EAF2FF]">匯入 Tutti 預建線批次</h2>
          <button onClick={onClose} className="text-[#556A88] hover:text-[#EAF2FF] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Marker + Work Order */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className={labelCls}>Marker *</p>
              <input value={marker} onChange={e => setMarker(e.target.value)}
                placeholder="e.g. TSH" className={inputCls} />
            </div>
            <div>
              <p className={labelCls}>工單號</p>
              <input value={workOrder} onChange={e => setWorkOrder(e.target.value)}
                placeholder="work order" className={inputCls} />
            </div>
          </div>

          {/* Lots */}
          <div className="grid grid-cols-3 gap-3">
            {[['Lot d', lotD, setLotD], ['Lot D', lotBigD, setLotBigD], ['Lot u', lotU, setLotU]] .map(([label, val, setter]) => (
              <div key={label as string}>
                <p className={labelCls}>{label as string}</p>
                <input value={val as string} onChange={e => (setter as (v: string) => void)(e.target.value)}
                  placeholder={label as string} className={inputCls} />
              </div>
            ))}
          </div>

          {/* Dates + Quantity */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className={labelCls}>生產日期</p>
              <input type="date" value={prodDate} onChange={e => setProdDate(e.target.value)}
                className={inputCls} />
            </div>
            <div>
              <p className={labelCls}>填藥期限</p>
              <input type="date" value={fillExpiry} onChange={e => setFillExpiry(e.target.value)}
                className={inputCls} />
            </div>
            <div>
              <p className={labelCls}>生產數量</p>
              <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)}
                placeholder="pcs" className={inputCls} />
            </div>
          </div>

          {/* Excel file drop */}
          <div>
            <p className={labelCls}>Tutti 卡匣 OD 數據 Excel（選填）</p>
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center gap-2 cursor-pointer transition-colors ${
                dragging ? 'border-[#4DA3FF] bg-[#4DA3FF]/5' : 'border-[#2A3754] hover:border-[#4DA3FF]/50'
              }`}
            >
              <Upload size={20} className="text-[#556A88]" />
              {file ? (
                <p className="text-xs text-[#4DA3FF]">{file.name}</p>
              ) : (
                <p className="text-xs text-[#556A88]">拖曳或點擊選擇 .xlsx 檔</p>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </div>

          {/* Manual OD input */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ChevronDown size={12} className="text-[#556A88]" />
              <p className="text-[10px] text-[#556A88]">手動輸入 OD 值（空格或逗號分隔，可覆蓋 Excel 解析結果）</p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(['l1', 'l2', 'n1', 'n3'] as const).map(level => (
                <div key={level}>
                  <p className="text-[10px] text-[#556A88] mb-1 flex items-center gap-1">
                    <span className="uppercase font-bold text-[#EAF2FF]">{level.toUpperCase()}</span>
                    {concs[level] != null && (
                      <span className="text-[#4DA3FF]">{concs[level]?.toFixed(2)}</span>
                    )}
                  </p>
                  <textarea
                    value={manualOd[level]}
                    onChange={e => setManualOd(prev => ({ ...prev, [level]: e.target.value }))}
                    placeholder="0.234 0.251 ..."
                    rows={2}
                    className={`${inputCls} resize-none font-mono`}
                  />
                </div>
              ))}
            </div>
            {(concs.l1 == null && concs.l2 == null) && marker.length > 1 && (
              <p className="text-[10px] text-[#FBBF24] mt-1">
                csassign 中找不到 {marker} 的已知濃度，回歸線將無法計算（可匯入後手動輸入 slope/intercept）
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <p className={labelCls}>備註</p>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="備註..." className={inputCls} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#2A3754] flex items-center justify-between">
          {error ? (
            <p className="text-xs text-[#F87171]">{error}</p>
          ) : (
            <p className="text-[10px] text-[#556A88]">
              {file ? `已選擇 ${file.name}` : '未選擇 Excel（可純手動輸入 OD）'}
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs text-[#93A4C3] hover:text-[#EAF2FF] hover:bg-[#1A2438] transition-colors">
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !marker.trim()}
              className="px-4 py-1.5 rounded-lg text-xs font-bold bg-[#4DA3FF] text-[#0B1220] hover:bg-[#6AB5FF] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? '計算中...' : '計算並匯入'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
