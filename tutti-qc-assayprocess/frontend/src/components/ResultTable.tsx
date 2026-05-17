import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet } from 'lucide-react';

interface ResultTableProps {
  columns: string[];
  rows: Record<string, string>[];
  total: number;
  onOpenControlSheet?: () => void;
  controlSheetDisabled?: boolean;
}

const visibleColumns = [
  'panel_name',
  'analyze_date',
  'analyze_time',
  'sample_type',
  'Species',
  'patient_id',
  'F.W.',
  'Production Date',
  'analyze_item',
  'Disc_result',
  'analyze_result',
  'unit',
  'Test Zone',
  'Test Well',
  'Final Delta OD',
  'baseline_equation',
  'baseline',
];

const numericColumns = new Set([
  'F.W.',
  'Disc_result',
  'analyze_result',
  'Test Zone',
  'Final Delta OD',
]);

const integerColumns = new Set(['Test Well']);
const emphasizedColumns = new Set(['Final Delta OD']);

const columnClasses: Record<string, string> = {
  'panel_name': 'col-panel-name',
  'analyze_date': 'col-analyze-date',
  'analyze_time': 'col-analyze-time',
  'sample_type': 'col-sample-type',
  'Species': 'col-species',
  'patient_id': 'col-patient-id',
  'F.W.': 'col-fw',
  'Production Date': 'col-production-date',
  'analyze_item': 'col-analyze-item',
  'Disc_result': 'col-disc-result',
  'analyze_result': 'col-analyze-result',
  'unit': 'col-unit',
  'Test Zone': 'col-test-zone',
  'Test Well': 'col-test-well',
  'Final Delta OD': 'col-final-delta',
  'baseline_equation': 'col-baseline-eq',
  'baseline': 'col-baseline',
};

function formatCell(column: string, value: string | undefined): string {
  if (value == null || value === '') return '';
  if (!numericColumns.has(column) && !integerColumns.has(column)) return value;

  const normalized = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return value;

  if (integerColumns.has(column)) {
    return String(Math.trunc(Number(normalized)));
  }

  return Number(normalized).toFixed(3);
}

function renderHeader(column: string) {
  const label = column;
  const parts = label.split(/[_\s]+/).filter(Boolean);
  if (parts.length <= 1) return label;

  return (
    <span className="column-label">
      {parts.map((part) => (
        <span key={`${label}-${part}`}>{part}</span>
      ))}
    </span>
  );
}

function downloadExcel(displayColumns: string[], rows: Record<string, string>[]) {
  const data = rows.map((row) =>
    Object.fromEntries(displayColumns.map((col) => [col, formatCell(col, row[col])]))
  );
  const ws = XLSX.utils.json_to_sheet(data, { header: displayColumns });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'AssayProcess');
  XLSX.writeFile(wb, `AssayProcess_${new Date().toISOString().slice(0, 10)}_Merge.xlsx`);
}

export default function ResultTable({ columns, rows, total, onOpenControlSheet, controlSheetDisabled }: ResultTableProps) {
  const displayColumns = [
    ...visibleColumns.filter((column) => columns.includes(column)),
    ...columns.filter((column) => !visibleColumns.includes(column)),
  ];

  return (
    <section className="result-section">
      <div className="result-meta">
        <span>total</span>
        <strong>{total}</strong>
        {rows.length > 0 && (
          <button
            className="download-btn"
            type="button"
            onClick={() => downloadExcel(displayColumns, rows)}
            title="下載 Excel"
          >
            <Download size={15} />
            下載 Excel
          </button>
        )}
        {onOpenControlSheet && (
          <button
            className={`download-btn ${controlSheetDisabled ? 'btn-disabled' : ''}`}
            type="button"
            onClick={controlSheetDisabled ? undefined : onOpenControlSheet}
            title={controlSheetDisabled ? '請設定查詢項目1=panel_name, 查詢項目2=analyze_date' : 'Control Sheet 分析'}
          >
            <FileSpreadsheet size={15} />
            Control Sheet
          </button>
        )}
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {displayColumns.map((column) => (
                <th className={columnClasses[column] || ''} key={column}>
                  {renderHeader(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="empty-cell" colSpan={Math.max(displayColumns.length, 1)}>
                  無查詢資料
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={index}>
                  {displayColumns.map((column) => (
                    <td
                      className={`${columnClasses[column] || ''} ${emphasizedColumns.has(column) ? 'value-emphasis' : ''}`.trim()}
                      key={column}
                      title={formatCell(column, row[column])}
                    >
                      {formatCell(column, row[column])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
