import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  Database,
  Search,
  Table2,
  Upload,
} from 'lucide-react';
import {
  fetchTuttiSkuTable,
  fetchTuttiSkuTables,
  uploadTuttiSkuExcel,
  type TuttiSkuTableData,
  type TuttiSkuTableSummary,
  type UploadDifference,
} from '../../api/tuttiSkuList';

type Message = {
  ok: boolean;
  text: string;
  differences?: UploadDifference[];
};

function formatCell(value: unknown) {
  if (value == null) return '';
  return String(value);
}

export default function TuttiSkuListManager() {
  const [tables, setTables] = useState<TuttiSkuTableSummary[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<TuttiSkuTableData | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<Message | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeSummary = useMemo(
    () => tables.find((table) => table.name === activeTable) ?? null,
    [activeTable, tables],
  );

  const loadTables = useCallback(async () => {
    setLoading(true);
    try {
      setTables(await fetchTuttiSkuTables());
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : '載入 table 失敗' });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTableData = useCallback(async (tableName: string, search = query) => {
    setLoading(true);
    try {
      setTableData(await fetchTuttiSkuTable(tableName, search));
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : '載入資料失敗' });
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { loadTables(); }, [loadTables]);

  useEffect(() => {
    if (!activeTable) return;
    const timer = window.setTimeout(() => loadTableData(activeTable, query), 250);
    return () => window.clearTimeout(timer);
  }, [activeTable, loadTableData, query]);

  const handlePickTable = (tableName: string) => {
    setActiveTable(tableName);
    setQuery('');
    setTableData(null);
    setMsg(null);
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setMsg(null);
    try {
      const result = await uploadTuttiSkuExcel(file);
      setMsg({ ok: true, text: `已上傳 ${result.sheetCount} 個 sheets，共 ${result.rowCount} 筆資料` });
      await loadTables();
      if (activeTable) await loadTableData(activeTable, query);
    } catch (error) {
      const typed = error as Error & { differences?: UploadDifference[] };
      setMsg({
        ok: false,
        text: typed.message || '上傳失敗',
        differences: typed.differences,
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const renderUploadButton = () => (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm,.xls"
        className="hidden"
        onChange={(event) => handleUpload(event.target.files?.[0])}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4DA3FF]/15 text-[#4DA3FF] text-xs hover:bg-[#4DA3FF]/25 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Upload size={13} />
        {uploading ? '上傳中' : '上傳 Excel'}
      </button>
    </>
  );

  const renderMessage = () => msg && (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-lg px-3 py-2 text-xs ${msg.ok ? 'bg-[#00D4AA]/10 text-[#00D4AA]' : 'bg-[#FF5C73]/10 text-[#FF8A9A]'}`}
    >
      <div className="flex items-center gap-2">
        {msg.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
        <span>{msg.text}</span>
        <button onClick={() => setMsg(null)} className="ml-auto opacity-70 hover:opacity-100">x</button>
      </div>
      {msg.differences && msg.differences.length > 0 && (
        <div className="mt-2 max-h-36 overflow-auto rounded border border-[#FF5C73]/20 bg-[#0B1220]/40">
          {msg.differences.slice(0, 30).map((diff, index) => (
            <div key={`${diff.table}-${diff.type}-${diff.ordinal ?? index}`} className="px-2 py-1 border-b border-[#FF5C73]/10 last:border-0">
              <span className="font-medium">{diff.table}</span>
              <span className="mx-1 text-[#93A4C3]">{diff.message}</span>
              {(diff.current || diff.incoming) && (
                <span className="text-[#EAF2FF]">
                  RDS: {diff.current || '-'} / Excel: {diff.incoming || '-'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );

  if (activeTable) {
    const columns = tableData?.columns ?? activeSummary?.columns ?? [];
    const rows = tableData?.rows ?? [];

    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setActiveTable(null); setTableData(null); setQuery(''); }}
            className="flex items-center gap-1.5 text-[#93A4C3] hover:text-[#4DA3FF] transition-colors text-sm"
          >
            <ChevronLeft size={16} />
            返回 SKU List
          </button>
          <div className="h-4 w-px bg-[#2A3754]" />
          <div>
            <h2 className="text-[#EAF2FF] text-sm font-semibold">{activeTable.toUpperCase()}</h2>
            <p className="text-[#556A88] text-[11px]">{activeSummary?.rowCount ?? rows.length} rows</p>
          </div>
          <div className="ml-auto">{renderUploadButton()}</div>
        </div>

        {renderMessage()}

        <div className="flex items-center gap-2">
          <div className="relative w-full max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#93A4C3]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋資料"
              className="w-full bg-[#0D1525] border border-[#2A3754] rounded-lg pl-9 pr-3 py-2 text-xs text-[#EAF2FF] placeholder-[#556A88] focus:outline-none focus:border-[#4DA3FF]"
            />
          </div>
          {loading && <span className="text-xs text-[#556A88]">載入中</span>}
        </div>

        <div className="rounded-lg border border-[#2A3754] overflow-auto max-h-[calc(100vh-250px)]">
          <table className="w-full text-xs">
            <thead className="bg-[#111B2E] sticky top-0 z-10">
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className="px-3 py-2 text-left text-[#93A4C3] font-medium whitespace-nowrap">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.id)} className="border-t border-[#1A2438] hover:bg-[#1A2438]/60">
                  {columns.map((column) => (
                    <td key={`${row.id}-${column.key}`} className="px-3 py-2 text-[#EAF2FF] whitespace-pre-wrap min-w-28 max-w-64">
                      {formatCell(row[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} className="px-3 py-8 text-center text-[#556A88]">
                    無資料
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-[#EAF2FF] text-sm font-semibold">Tutti SKU List 資料管理</h2>
          <p className="text-[#556A88] text-[11px]">RDS schema: tutti_sku_list</p>
        </div>
        <div className="ml-auto">{renderUploadButton()}</div>
      </div>

      {renderMessage()}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {tables.map((table) => (
          <motion.button
            key={table.name}
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handlePickTable(table.name)}
            className="text-left rounded-xl border border-[#2A3754] bg-[#111B2E] hover:border-[#4DA3FF]/50 hover:bg-[#1A2438] p-5 transition-colors"
          >
            <div className="flex items-start gap-3">
              <Table2 size={24} className="text-[#4DA3FF] shrink-0" />
              <div className="min-w-0">
                <h3 className="text-[#EAF2FF] text-sm font-semibold truncate">{table.displayName}</h3>
                <p className="text-[#93A4C3] text-xs mt-1">{table.rowCount} rows · {table.columns.length} columns</p>
              </div>
            </div>
          </motion.button>
        ))}
      </div>

      {!loading && tables.length === 0 && (
        <div className="rounded-lg border border-[#2A3754] bg-[#111B2E] px-4 py-8 text-center">
          <Database size={28} className="mx-auto text-[#2A3754] mb-2" />
          <p className="text-sm text-[#93A4C3]">尚未建立 SKU List 資料</p>
        </div>
      )}
    </div>
  );
}
