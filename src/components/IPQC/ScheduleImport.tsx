import { useState, useMemo } from 'react';
import { RefreshCw, Download, CheckSquare, Square, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { useFetch } from '../../api/useFetch';
import { fetchPendingSchedule, importScheduleItems, type PendingItem } from '../../api/schedule';

const today = () => new Date().toISOString().slice(0, 10);

export default function ScheduleImport() {
  const { data: pending, loading, error, refresh } = useFetch<PendingItem[]>(fetchPendingSchedule, []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [filterMarker, setFilterMarker] = useState('');

  const markers = useMemo(() => {
    if (!pending) return [];
    return [...new Set(pending.map(p => p.bead_name))].sort();
  }, [pending]);

  const filtered = useMemo(() => {
    if (!pending) return [];
    return filterMarker ? pending.filter(p => p.bead_name === filterMarker) : pending;
  }, [pending, filterMarker]);

  const key = (p: PendingItem) => `${p.bead_name}|${p.work_order}`;

  const toggleOne = (p: PendingItem) => {
    setSelected(prev => {
      const next = new Set(prev);
      const k = key(p);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(prev =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map(key))
    );
  };

  const handleImport = async () => {
    const items = filtered.filter(p => selected.has(key(p)));
    if (!items.length) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await importScheduleItems(items);
      setResult({ imported: res.imported, skipped: res.skipped });
      setSelected(new Set());
      refresh();
    } catch (e: any) {
      alert('匯入失敗: ' + e.message);
    } finally {
      setImporting(false);
    }
  };

  const lotCell = (lot: string | null) => (
    <span className={lot ? 'font-mono text-[#EAF2FF]' : 'text-[#2A3754]'}>
      {lot || '—'}
    </span>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#1E3050] shrink-0 flex-wrap">
        <span className="text-xs text-[#556A88]">Marker</span>
        <select
          value={filterMarker}
          onChange={e => { setFilterMarker(e.target.value); setSelected(new Set()); }}
          className="bg-[#0d1f3a] border border-[#2A3754] text-[#D4E8FF] text-xs rounded px-2 py-1 focus:outline-none focus:border-[#4DA3FF]"
        >
          <option value="">全部</option>
          {markers.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <button onClick={refresh} disabled={loading}
          className="flex items-center gap-1 px-2 py-1 text-xs text-[#93A4C3] hover:text-[#4DA3FF] transition-colors">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 重新整理
        </button>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-[10px] text-[#93A4C3]">
            檢驗日: <span className="text-[#00D4AA] font-mono">{today()}</span>
          </span>
          <span className="text-[10px] text-[#556A88]">
            已選 {selected.size} / {filtered.length} 項
          </span>
          <button
            onClick={handleImport}
            disabled={importing || selected.size === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4DA3FF]/20 text-[#4DA3FF] text-xs font-medium hover:bg-[#4DA3FF]/30 disabled:opacity-40 transition-colors"
          >
            {importing ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            匯入選取項目
          </button>
        </div>
      </div>

      {/* Result banner */}
      {result && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[#00D4AA]/10 border-b border-[#00D4AA]/20 text-xs text-[#00D4AA]">
          <CheckCircle size={14} />
          成功匯入 {result.imported} 項，檢驗日 = {today()}
          {result.skipped > 0 && `，跳過 ${result.skipped} 項（已存在）`}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[#FF5C73]/10 border-b border-[#FF5C73]/20 text-xs text-[#FF5C73]">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-[#556A88]">
            <Loader2 size={16} className="animate-spin" /> 連線 EC2 載入排產資料中…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#3A5070] text-sm gap-2">
            <CheckCircle size={24} className="text-[#00D4AA]/40" />
            目前沒有待檢驗的排產項目
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#0F1A2E] border-b border-[#2A3754]">
                <th className="px-2 py-2 text-center w-8">
                  <button onClick={toggleAll} className="text-[#93A4C3] hover:text-[#4DA3FF]">
                    {selected.size === filtered.length && filtered.length > 0
                      ? <CheckSquare size={14} className="text-[#4DA3FF]" />
                      : <Square size={14} />}
                  </button>
                </th>
                <th className="px-3 py-2 text-left text-[#93A4C3] font-medium">Marker</th>
                <th className="px-3 py-2 text-left text-[#93A4C3] font-medium">工單號碼</th>
                <th className="px-2 py-2 text-center text-[#93A4C3] font-medium">d 批號</th>
                <th className="px-2 py-2 text-center text-[#93A4C3] font-medium">D 批號</th>
                <th className="px-2 py-2 text-center text-[#93A4C3] font-medium">U 批號</th>
                <th className="px-2 py-2 text-center text-[#93A4C3] font-medium">生產日</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const k = key(p);
                const isSel = selected.has(k);
                return (
                  <tr key={k}
                    onClick={() => toggleOne(p)}
                    className={`cursor-pointer transition-colors border-b border-[#1A2438]/40
                      ${isSel ? 'bg-[#4DA3FF]/10' : 'hover:bg-[#1A2438]/40'}`}>
                    <td className="px-2 py-2 text-center">
                      {isSel
                        ? <CheckSquare size={14} className="text-[#4DA3FF] mx-auto" />
                        : <Square size={14} className="text-[#2A3754] mx-auto" />}
                    </td>
                    <td className="px-3 py-2 text-[#4DA3FF] font-bold">{p.bead_name}</td>
                    <td className="px-3 py-2 font-mono text-[#EAF2FF]">{p.work_order}</td>
                    <td className="px-2 py-2 text-center">{lotCell(p.d_lot)}</td>
                    <td className="px-2 py-2 text-center">{lotCell(p.bigD_lot)}</td>
                    <td className="px-2 py-2 text-center">{lotCell(p.u_lot)}</td>
                    <td className="px-2 py-2 text-center text-[#EAF2FF]">{p.prod_date}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-1.5 border-t border-[#1E3050] text-[10px] text-[#3A5070] shrink-0">
        排產來源: beadsops-ec2 DropletSchedule (2026/04+) · 僅顯示生產日+1後的項目 · 檢驗日 = 匯入當天 · 不含 OD 數據
      </div>
    </div>
  );
}
