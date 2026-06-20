import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, RefreshCw } from 'lucide-react';
import {
  fetchLotReportGroups,
  generateLotReport,
  type LotReportDetailTable,
  type LotReportGroupRow,
  type LotReportPreview,
  type LotReportSummaryTable,
} from '../api';

interface LotReportsProps {
  onBack: () => void;
}

const SHEET_NAMES = ['Control', 'Canine', 'Feline', 'Equine'] as const;

type SheetName = (typeof SHEET_NAMES)[number];

function fmt(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return String(value);
}

function fmtSummaryValue(value: unknown, stat: string): string {
  const text = fmt(value);
  if (!text) return '';
  return stat === 'CV%' && !text.includes('%') ? `${text}%` : text;
}

function SummaryMatrix({ title, table }: { title: string; table?: LotReportSummaryTable }) {
  const markers = table?.markers || [];
  const rows = table?.rows || [];
  return (
    <section className="excel-block">
      <div className="excel-block__title">{title}</div>
      <div className="table-scroll">
        <table className="excel-like-table excel-like-table--summary">
          <thead>
            <tr>
              <th className="sticky-col">Type</th>
              <th>Item</th>
              {markers.map((marker) => <th key={marker}>{marker}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="empty-cell" colSpan={Math.max(markers.length + 2, 3)}>無資料</td></tr>
            ) : rows.map((row, index) => (
              <tr key={`${title}-${index}`}>
                <td className="sticky-col">{row.label}</td>
                <td>{row.stat}</td>
                {markers.map((marker, markerIndex) => <td key={marker}>{fmtSummaryValue(row.values[markerIndex], row.stat)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DetailMatrix({ title, table }: { title: string; table?: LotReportDetailTable }) {
  const markers = table?.markers || [];
  const rows = table?.rows || [];
  const isOd = table?.value_mode === "od";
  return (
    <section className="excel-block">
      <div className="excel-block__title">{title}</div>
      <div className="table-scroll">
        <table className="excel-like-table excel-like-table--detail">
          <thead>
            <tr>
              <th rowSpan={isOd ? 1 : 2} className="sticky-col">Sample</th>
              <th rowSpan={isOd ? 1 : 2}>Device SN</th>
              <th rowSpan={isOd ? 1 : 2}>Test Zone</th>
              {markers.map((marker) => <th key={marker} colSpan={isOd ? 1 : 2}>{marker}</th>)}
            </tr>
            {!isOd && (
              <tr>
                {markers.flatMap((marker) => [
                  <th key={`${marker}-original`}>{marker}(原線)</th>,
                  <th key={`${marker}-changed`}>{marker}<br />換線後</th>,
                ])}
              </tr>
            )}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="empty-cell" colSpan={Math.max(markers.length * (isOd ? 1 : 2) + 3, 4)}>無資料</td></tr>
            ) : rows.map((row, index) => (
              <tr key={`${title}-${index}`}>
                <td className="sticky-col">{row.sample}</td>
                <td>{row.device_sn}</td>
                <td>{row.test_zone}</td>
                {isOd ? markers.map((marker) => (
                  <td key={marker}>{fmt(row.values?.[marker]?.original)}</td>
                )) : markers.flatMap((marker) => [
                  <td key={`${marker}-original`}>{fmt(row.values?.[marker]?.original)}</td>,
                  <td key={`${marker}-changed`}>{fmt(row.values?.[marker]?.changed)}</td>,
                ])}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
export default function LotReports({ onBack }: LotReportsProps) {
  const [rows, setRows] = useState<LotReportGroupRow[]>([]);
  const [preview, setPreview] = useState<LotReportPreview | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [activeSheet, setActiveSheet] = useState<SheetName>('Control');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const requestSeq = useRef(0);
  const previewCache = useRef<Record<string, LotReportPreview>>({});

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) || null,
    [rows, selectedId],
  );

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchLotReportGroups();
      setRows(data);
      setMessage('');
      if (!selectedId && data[0]) setSelectedId(data[0].id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'lot_code 列表載入失敗');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadRows();
  }, []);

  const generateForRow = useCallback(async (row: LotReportGroupRow) => {
    const cached = previewCache.current[row.id];
    if (cached) {
      setPreview(cached);
      setActiveSheet('Control');
      setGenerating(false);
      setMessage(`已載入 ${cached.file_name}`);
      return;
    }
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setGenerating(true);
    setPreview(null);
    try {
      const data = await generateLotReport({ id: row.id, lot_code: row.lot_codes[0] || row.display_lot_code });
      if (requestSeq.current !== seq) return;
      previewCache.current[row.id] = data;
      setPreview(data);
      setActiveSheet('Control');
      setMessage(`已產生 ${data.file_name}`);
    } catch (error) {
      if (requestSeq.current !== seq) return;
      setMessage(error instanceof Error ? error.message : '報表產生失敗');
    } finally {
      if (requestSeq.current === seq) setGenerating(false);
    }
  }, []);

  useEffect(() => {
    if (selectedRow) generateForRow(selectedRow);
  }, [selectedRow?.id, generateForRow]);

  const sheet = preview?.sheets?.[activeSheet];
  const sheetCount = (name: SheetName) => {
    const current = preview?.sheets?.[name];
    return current?.test_count || 0;
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="title-group">
          <button className="back-link" type="button" onClick={onBack}>
            <ArrowLeft size={16} />
            返回查詢
          </button>
          <div>
            <p className="eyebrow">Lot Output</p>
            <h1>選擇 lot_code 產生報表</h1>
          </div>
        </div>
        <div className="header-actions">
          <button className="secondary-button" type="button" onClick={loadRows} disabled={loading}>
            <RefreshCw size={16} />
            重新整理
          </button>
        </div>
      </header>

      {(message || generating) && <div className="message">{generating ? '產生中...' : message}</div>}

      <section className="lot-report-layout">
        <aside className="lot-report-list">
          <div className="lot-report-list__head">RDS lot_code rows</div>
          {rows.length === 0 ? (
            <div className="lot-report-empty">{loading ? '載入中...' : '沒有可產生資料'}</div>
          ) : (
            rows.map((row) => (
              <button
                key={row.id}
                className={row.id === selectedId ? 'active' : ''}
                type="button"
                onClick={() => {
                  setSelectedId(row.id);
                  setPreview(null);
                }}
              >
                <span>{row.display_lot_code}</span>
                <small>{row.panel_name} · {row.production_date} · {row.record_count} records</small>
              </button>
            ))
          )}
        </aside>

        <section className="lot-report-preview">
          <div className="lot-report-summary">
            <div>
              <span>選取 lot code</span>
              <strong>{selectedRow?.display_lot_code || '-'}</strong>
            </div>
            <div>
              <span>Panel</span>
              <strong>{selectedRow?.panel_name || '-'}</strong>
            </div>
            <div>
              <span>Production</span>
              <strong>{selectedRow?.production_date || '-'}</strong>
            </div>
            {preview && (
              <a className="download-btn" href={preview.download_url}>
                <Download size={15} />
                下載 {preview.file_name}
              </a>
            )}
          </div>

          {!preview ? (
            <div className="lot-report-empty">選擇左側一列後會自動產生報表</div>
          ) : (
            <>
              <div className="sheet-tabs" role="tablist" aria-label="lot report sheets">
                {SHEET_NAMES.map((sheetName) => (
                  <button
                    key={sheetName}
                    className={activeSheet === sheetName ? 'active' : ''}
                    type="button"
                    onClick={() => setActiveSheet(sheetName)}
                  >
                    {sheetName}
                    <small>{sheetCount(sheetName)}</small>
                  </button>
                ))}
              </div>

              <div className="excel-sheet-view">
                <SummaryMatrix title="表一 濃度" table={sheet?.summary_conc} />
                <SummaryMatrix title="表二 OD" table={sheet?.summary_od} />
                {activeSheet === 'Control' && (
                  <>
                    <DetailMatrix title="表三 濃度明細" table={sheet?.detail_conc} />
                    <DetailMatrix title="表四 OD 明細" table={sheet?.detail_od} />
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
