import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Upload, RefreshCw, CheckCircle, AlertCircle,
  FileSpreadsheet, FolderSync, Pencil, RotateCcw,
} from 'lucide-react';
import {
  fetchSpecs, fetchSpecStatus, fetchDefaults,
  syncFromPaths, uploadSpecFile,
} from '../../api/spec';
import type { SpecRow, SpecStatus, SpecDefaults } from '../../api/spec';

interface SyncResult {
  ok: boolean;
  source: string;
  total?: number;
  inserted?: number;
  updated?: number;
  error?: string;
}

export default function SpecManager() {
  const [specs, setSpecs] = useState<SpecRow[]>([]);
  const [status, setStatus] = useState<SpecStatus | null>(null);
  const [defaults, setDefaults] = useState<SpecDefaults | null>(null);
  const [paths, setPaths] = useState({ P01: '', Qbi: '' });
  const [editing, setEditing] = useState<'P01' | 'Qbi' | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<SyncResult[] | null>(null);
  const [uploadResult, setUploadResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'P01' | 'Qbi'>('all');

  const load = useCallback(async () => {
    const [s, st, d] = await Promise.all([fetchSpecs(), fetchSpecStatus(), fetchDefaults()]);
    setSpecs(s);
    setStatus(st);
    setDefaults(d);
    setPaths({ P01: d.P01.path, Qbi: d.Qbi.path });
  }, []);

  useEffect(() => { load(); }, [load]);

  const canSync = defaults?.P01.accessible || defaults?.Qbi.accessible;

  const handleSync = async () => {
    setSyncing(true);
    setResults(null);
    setUploadResult(null);
    try {
      const res = await syncFromPaths(paths);
      setResults(res.results);
      load();
    } catch (err: unknown) {
      setResults([{ ok: false, source: 'sync', error: err instanceof Error ? err.message : '同步失敗' }]);
    } finally {
      setSyncing(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    setResults(null);
    try {
      const res = await uploadSpecFile(file);
      if (res.ok) {
        setUploadResult({ ok: true, message: `${res.source} 匯入成功：${res.total} 筆（新增 ${res.inserted}，更新 ${res.updated}）` });
        load();
      } else {
        setUploadResult({ ok: false, message: res.error || '匯入失敗' });
      }
    } catch (err: unknown) {
      setUploadResult({ ok: false, message: err instanceof Error ? err.message : '上傳失敗' });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const resetPath = (key: 'P01' | 'Qbi') => {
    if (defaults) {
      setPaths(prev => ({ ...prev, [key]: defaults[key].path }));
      setEditing(null);
    }
  };

  const filtered = filter === 'all' ? specs : specs.filter(s => s.source === filter);

  return (
    <div className="p-6 space-y-5">
      {/* Status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(['P01', 'Qbi'] as const).map(src => {
          const info = status?.[src.toLowerCase() as 'p01' | 'qbi'];
          const def = defaults?.[src];
          return (
            <div key={src} className="rounded-lg border border-[#2A3754] bg-[#111B2E] p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileSpreadsheet size={16} className="text-[#4DA3FF]" />
                <span className="text-[#EAF2FF] text-sm font-medium">{src}</span>
                {def && (
                  <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full
                    ${def.accessible
                      ? 'bg-[#00D4AA]/15 text-[#00D4AA]'
                      : 'bg-[#FF5C73]/15 text-[#FF5C73]'}`}>
                    {def.accessible ? '可存取' : '無法存取'}
                  </span>
                )}
              </div>
              <div className="text-xs text-[#93A4C3] space-y-1">
                <p>Marker 數量：<span className="text-[#EAF2FF]">{info?.cnt ?? 0}</span></p>
                <p>最後更新：<span className="text-[#EAF2FF]">{info?.last_update ?? '尚未匯入'}</span></p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Path config + sync */}
      <div className="rounded-lg border border-[#2A3754] bg-[#111B2E] p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <FolderSync size={16} className="text-[#4DA3FF]" />
          <span className="text-[#EAF2FF] text-sm font-medium">規格檔案路徑</span>
        </div>

        {(['P01', 'Qbi'] as const).map(key => (
          <div key={key} className="flex items-center gap-2">
            <span className="text-xs text-[#93A4C3] w-8 shrink-0">{key}</span>
            {editing === key ? (
              <input
                value={paths[key]}
                onChange={e => setPaths(prev => ({ ...prev, [key]: e.target.value }))}
                onBlur={() => setEditing(null)}
                onKeyDown={e => e.key === 'Enter' && setEditing(null)}
                autoFocus
                className="flex-1 bg-[#0D1525] border border-[#4DA3FF]/30 rounded px-2 py-1.5 text-xs text-[#EAF2FF] outline-none focus:border-[#4DA3FF]"
              />
            ) : (
              <div
                className="flex-1 bg-[#0D1525] rounded px-2 py-1.5 text-xs text-[#93A4C3] truncate cursor-text"
                onClick={() => setEditing(key)}
                title={paths[key]}
              >
                {paths[key]}
              </div>
            )}
            <button
              onClick={() => editing === key ? setEditing(null) : setEditing(key)}
              className="text-[#93A4C3] hover:text-[#4DA3FF] transition-colors p-1"
              title="編輯路徑"
            >
              <Pencil size={12} />
            </button>
            {paths[key] !== defaults?.[key]?.path && (
              <button
                onClick={() => resetPath(key)}
                className="text-[#93A4C3] hover:text-[#FF5C73] transition-colors p-1"
                title="還原預設"
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>
        ))}

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSync}
            disabled={syncing || !canSync}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors
              ${syncing || !canSync
                ? 'bg-[#2A3754] text-[#93A4C3] cursor-not-allowed'
                : 'bg-[#4DA3FF]/15 text-[#4DA3FF] hover:bg-[#4DA3FF]/25'}`}
          >
            {syncing ? <RefreshCw size={14} className="animate-spin" /> : <FolderSync size={14} />}
            {syncing ? '同步中...' : '從路徑同步'}
          </button>

          {!canSync && (
            <span className="text-[10px] text-[#FF5C73]">路徑無法存取，請使用下方上傳</span>
          )}
        </div>
      </div>

      {/* Sync results */}
      {results && (
        <div className="space-y-2">
          {results.map((r, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs
                ${r.ok
                  ? 'bg-[#00D4AA]/10 text-[#00D4AA] border border-[#00D4AA]/20'
                  : 'bg-[#FF5C73]/10 text-[#FF5C73] border border-[#FF5C73]/20'}`}
            >
              {r.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
              {r.ok
                ? `${r.source}：${r.total} 筆（新增 ${r.inserted}，更新 ${r.updated}）`
                : `${r.source}：${r.error}`}
            </motion.div>
          ))}
        </div>
      )}

      {/* Fallback upload */}
      <div className="rounded-lg border border-dashed border-[#2A3754] bg-[#0D1525] p-4 text-center">
        <label className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs cursor-pointer transition-colors
          ${uploading
            ? 'bg-[#2A3754] text-[#93A4C3] cursor-wait'
            : 'bg-[#1A2438] text-[#93A4C3] hover:text-[#4DA3FF] hover:bg-[#1A2438]/80'}`}
        >
          {uploading ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
          {uploading ? '匯入中...' : '或手動上傳 Excel'}
          <input
            type="file"
            accept=".xlsx,.xlsm"
            onChange={handleUpload}
            disabled={uploading}
            className="hidden"
          />
        </label>
        <p className="text-[#2A3754] text-[10px] mt-1.5">適用於 EC2 等無法存取 UNC 路徑的環境</p>
      </div>

      {/* Upload result */}
      {uploadResult && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs
            ${uploadResult.ok
              ? 'bg-[#00D4AA]/10 text-[#00D4AA] border border-[#00D4AA]/20'
              : 'bg-[#FF5C73]/10 text-[#FF5C73] border border-[#FF5C73]/20'}`}
        >
          {uploadResult.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {uploadResult.message}
        </motion.div>
      )}

      {/* Filter tabs + table */}
      <div>
        <div className="flex gap-1 mb-3">
          {(['all', 'P01', 'Qbi'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors
                ${filter === f
                  ? 'bg-[#4DA3FF]/15 text-[#4DA3FF]'
                  : 'text-[#93A4C3] hover:text-[#EAF2FF] hover:bg-[#1A2438]'}`}
            >
              {f === 'all' ? '全部' : f}
              <span className="ml-1 opacity-60">
                ({f === 'all' ? specs.length : specs.filter(s => s.source === f).length})
              </span>
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-[#2A3754] overflow-auto max-h-[calc(100vh-520px)]">
          <table className="w-full text-xs">
            <thead className="bg-[#111B2E] sticky top-0">
              <tr className="text-[#93A4C3] text-left">
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Marker</th>
                <th className="px-3 py-2 font-medium">TEa</th>
                <th className="px-3 py-2 font-medium">單管 CV</th>
                <th className="px-3 py-2 font-medium">OD SPEC L1</th>
                <th className="px-3 py-2 font-medium">OD SPEC L2</th>
                <th className="px-3 py-2 font-medium">併批 Bias</th>
                <th className="px-3 py-2 font-medium">併批 CV</th>
                <th className="px-3 py-2 font-medium">更新時間</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-[#2A3754]">
                    尚無規格資料，請同步或上傳 Excel
                  </td>
                </tr>
              ) : (
                filtered.map(row => (
                  <tr key={row.id} className="border-t border-[#1A2438] hover:bg-[#1A2438]/50 text-[#EAF2FF]">
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium
                        ${row.source === 'P01' ? 'bg-[#4DA3FF]/15 text-[#4DA3FF]' : 'bg-[#00D4AA]/15 text-[#00D4AA]'}`}>
                        {row.source}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium">{row.marker}</td>
                    <td className="px-3 py-2 text-[#93A4C3]">{row.tea ?? '-'}</td>
                    <td className="px-3 py-2 text-[#93A4C3] max-w-[160px] truncate">{row.single_cv ?? '-'}</td>
                    <td className="px-3 py-2 text-[#93A4C3]">{row.spec_l1_od ?? '-'}</td>
                    <td className="px-3 py-2 text-[#93A4C3]">{row.spec_l2_od ?? '-'}</td>
                    <td className="px-3 py-2 text-[#93A4C3] max-w-[140px] truncate">{row.merge_bias ?? '-'}</td>
                    <td className="px-3 py-2 text-[#93A4C3] max-w-[120px] truncate">{row.merge_cv ?? '-'}</td>
                    <td className="px-3 py-2 text-[#2A3754]">{row.updated_at ?? '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
