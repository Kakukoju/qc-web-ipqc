import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Download, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';
import { fetchControlSheet, type ControlSection, type ControlSheetResponse, type ControlSummary } from '../api';

interface ControlSheetProps {
  panelName: string;
  analyzeDate: string;
  fwVersion?: string;
  onBack: () => void;
}

function fmt(v: number | null | undefined, decimals = 1): string {
  if (v == null) return '';
  return Number(v).toFixed(decimals);
}

export default function ControlSheet({ panelName, analyzeDate, fwVersion, onBack }: ControlSheetProps) {
  const [data, setData] = useState<ControlSheetResponse | null>(null);
  const [error, setError] = useState('');
  const [editCells, setEditCells] = useState<Record<string, string>>({});
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchControlSheet({ panel_name: panelName, analyze_date: analyzeDate, fw_version: fwVersion })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [panelName, analyzeDate, fwVersion]);

  const handleCellEdit = (key: string, value: string) => {
    setEditCells((prev) => ({ ...prev, [key]: value }));
  };

  const getCellValue = (key: string, original: number | null | undefined, decimals = 1): string => {
    if (key in editCells) return editCells[key];
    return fmt(original, decimals);
  };

  const handlePrint = () => window.print();

  const handleDownload = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    const rows: (string | number | null)[][] = [];

    rows.push(['Panel Name:', data.panel_name]);
    rows.push(['Analyze Date:', data.analyze_date]);
    rows.push(['Device FW:', data.fw_version]);
    rows.push(['Production Date:', data.production_date]);
    rows.push(['Lot:', data.lot_code]);
    rows.push(['Product Code:', data.product_code]);
    rows.push([]);

    for (const ctrl of data.controls) {
      rows.push(['Control Lot', '', ...ctrl.markers]);
      rows.push([ctrl.control_label, 'TEa', ...ctrl.markers.map((m) => ctrl.tea_display[m] || '')]);
      rows.push(['', '定值', ...ctrl.markers.map((m) => fmt(ctrl.assigned[m]))]);
      rows.push(['', '上限', ...ctrl.markers.map((m) => fmt(ctrl.upper[m]))]);
      rows.push(['機台編號', '下限', ...ctrl.markers.map((m) => fmt(ctrl.lower[m]))]);
      for (const meas of ctrl.measurements) {
        rows.push([meas.machine, meas.zone, ...ctrl.markers.map((m) => fmt(meas.values[m]))]);
      }
      rows.push([]);
    }

    // Summary
    rows.push([]);
    rows.push(['=== Summary ===']);
    rows.push(['Control Lot', '', ...data.markers]);
    for (const s of data.summary) {
      const sm = s.markers;
      rows.push([s.control_label, 'total mean', ...data.markers.map((m) => sm[m]?.mean ?? '')]);
      rows.push(['', 'total Bias', ...data.markers.map((m) => sm[m]?.bias ?? '')]);
      rows.push(['', 'total CV (%)', ...data.markers.map((m) => sm[m]?.cv != null ? sm[m].cv!.toFixed(1) : '')]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Control (2)');
    XLSX.writeFile(wb, `AssayProcess_${data.analyze_date}_Merge.xlsx`);
  };

  if (error) {
    return (
      <div className="control-sheet-page">
        <div className="cs-toolbar">
          <button type="button" onClick={onBack}><ArrowLeft size={16} /> 返回</button>
        </div>
        <div className="message">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="control-sheet-page">
        <div className="cs-toolbar">
          <button type="button" onClick={onBack}><ArrowLeft size={16} /> 返回</button>
        </div>
        <p style={{ color: '#93a4c3', padding: 20 }}>載入中...</p>
      </div>
    );
  }

  return (
    <div className="control-sheet-page">
      <div className="cs-toolbar">
        <button type="button" onClick={onBack}><ArrowLeft size={16} /> 返回查詢</button>
        <button type="button" onClick={handlePrint}><Printer size={16} /> 列印</button>
        <button type="button" onClick={handleDownload}><Download size={16} /> 下載 Excel</button>
      </div>

      <div className="cs-header-info">
        <div><span>Panel Name:</span><strong>{data.panel_name}</strong></div>
        <div><span>Analyze Date:</span><strong>{data.analyze_date}</strong></div>
        <div><span>Device FW:</span><strong>{data.fw_version}</strong></div>
        <div><span>Production Date:</span><strong>{data.production_date}</strong></div>
        <div><span>Lot:</span><strong>{data.lot_code}</strong></div>
        <div><span>Product Code (REF):</span><strong>{data.product_code}</strong></div>
      </div>

      <SummaryTable markers={data.markers} summary={data.summary} />

      <div className="cs-tables" ref={tableRef}>
        {data.controls.map((ctrl) => (
          <ControlTable
            key={ctrl.control_label}
            ctrl={ctrl}
            editCells={editCells}
            onCellEdit={handleCellEdit}
            getCellValue={getCellValue}
          />
        ))}
      </div>
    </div>
  );
}

function ControlTable({
  ctrl,
  editCells,
  onCellEdit,
  getCellValue,
}: {
  ctrl: ControlSection;
  editCells: Record<string, string>;
  onCellEdit: (key: string, value: string) => void;
  getCellValue: (key: string, original: number | null | undefined, decimals?: number) => string;
}) {
  return (
    <section className="cs-control-section">
      <table className="cs-table">
        <thead>
          <tr>
            <th className="cs-col-label">Control Lot</th>
            <th className="cs-col-sub"></th>
            {ctrl.markers.map((m) => <th key={m}>{m}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr className="cs-row-tea">
            <td>{ctrl.control_label}</td>
            <td>TEa</td>
            {ctrl.markers.map((m) => <td key={m}>{ctrl.tea_display[m]}</td>)}
          </tr>
          <tr>
            <td></td>
            <td>定值</td>
            {ctrl.markers.map((m) => {
              const key = `${ctrl.control_label}-assigned-${m}`;
              return (
                <td key={m}>
                  <input
                    className="cs-cell-input"
                    value={getCellValue(key, ctrl.assigned[m])}
                    onChange={(e) => onCellEdit(key, e.target.value)}
                  />
                </td>
              );
            })}
          </tr>
          <tr>
            <td></td>
            <td>上限</td>
            {ctrl.markers.map((m) => {
              const key = `${ctrl.control_label}-upper-${m}`;
              return (
                <td key={m}>
                  <input
                    className="cs-cell-input"
                    value={getCellValue(key, ctrl.upper[m])}
                    onChange={(e) => onCellEdit(key, e.target.value)}
                  />
                </td>
              );
            })}
          </tr>
          <tr>
            <td>機台編號</td>
            <td>下限</td>
            {ctrl.markers.map((m) => {
              const key = `${ctrl.control_label}-lower-${m}`;
              return (
                <td key={m}>
                  <input
                    className="cs-cell-input"
                    value={getCellValue(key, ctrl.lower[m])}
                    onChange={(e) => onCellEdit(key, e.target.value)}
                  />
                </td>
              );
            })}
          </tr>
          {ctrl.measurements.map((meas, idx) => (
            <tr key={idx}>
              <td>{meas.machine}</td>
              <td>{meas.zone}</td>
              {ctrl.markers.map((m) => {
                const key = `${ctrl.control_label}-meas-${meas.machine}-${meas.zone}-${m}-${idx}`;
                return (
                  <td key={m}>
                    <input
                      className="cs-cell-input"
                      value={getCellValue(key, meas.values[m])}
                      onChange={(e) => onCellEdit(key, e.target.value)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SummaryTable({ markers, summary }: { markers: string[]; summary: ControlSummary[] }) {
  return (
    <section className="cs-control-section cs-summary-section">
      <h3 className="cs-summary-title">Summary</h3>
      <table className="cs-table">
        <thead>
          <tr>
            <th className="cs-col-label">Control Lot</th>
            <th className="cs-col-sub"></th>
            {markers.map((m) => <th key={m}>{m}</th>)}
          </tr>
        </thead>
        <tbody>
          {summary.map((s) => (
            <SummaryRows key={s.control_label} s={s} markers={markers} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SummaryRows({ s, markers }: { s: ControlSummary; markers: string[] }) {
  return (
    <>
      <tr>
        <td rowSpan={3}>{s.control_label}</td>
        <td>total mean</td>
        {markers.map((m) => {
          const v = s.markers[m];
          return <td key={m}>{v?.mean != null ? v.mean.toFixed(2) : ''}</td>;
        })}
      </tr>
      <tr>
        <td>total Bias</td>
        {markers.map((m) => {
          const v = s.markers[m];
          const display = v?.bias != null ? v.bias.toFixed(2) : '';
          const alert = v?.bias_alert;
          return (
            <td key={m} className={alert ? 'cs-alert' : ''}>
              {alert && <AlertTriangle size={12} />}
              {display}
              {alert && v?.lower != null && v?.upper != null && (
                <span className="cs-limit">[{v.lower.toFixed(1)}~{v.upper.toFixed(1)}]</span>
              )}
            </td>
          );
        })}
      </tr>
      <tr>
        <td>total CV</td>
        {markers.map((m) => {
          const v = s.markers[m];
          const display = v?.cv != null ? `${v.cv.toFixed(1)}%` : '';
          const alert = v?.cv_alert;
          return (
            <td key={m} className={alert ? 'cs-alert' : ''}>
              {alert && <AlertTriangle size={12} />}
              {display}
              {alert && v?.cv_limit != null && <span className="cs-limit">limit {v.cv_limit}%</span>}
            </td>
          );
        })}
      </tr>
    </>
  );
}
