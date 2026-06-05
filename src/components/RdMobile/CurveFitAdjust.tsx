import { useState, useMemo, useCallback } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar,
} from 'recharts';
import type { FitData, FitPoint } from '../../api/rdBuildLine';

interface Props {
  fitData: FitData | null;
  onConfirm: (params: { slope: number; intercept: number; r2: number; equation: string; points: FitPoint[] }) => void;
  onCancel: () => void;
  saving: boolean;
}

type Tab = 'chart' | 'residuals';

// ── Linear regression ────────────────────────────────────────────────────
function linearFit(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  const xBar = xs.reduce((a, b) => a + b, 0) / n;
  const yBar = ys.reduce((a, b) => a + b, 0) / n;
  const ssxy = xs.reduce((s, x, i) => s + (x - xBar) * (ys[i] - yBar), 0);
  const ssxx = xs.reduce((s, x) => s + (x - xBar) ** 2, 0);
  if (ssxx === 0) return { slope: 0, intercept: yBar, r2: 1 };
  const slope = ssxy / ssxx;
  const intercept = yBar - slope * xBar;
  const yPred = xs.map(x => slope * x + intercept);
  const ssTot = ys.reduce((s, y) => s + (y - yBar) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - yPred[i]) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { slope, intercept, r2 };
}

export default function CurveFitAdjust({ fitData, onConfirm, onCancel, saving }: Props) {
  const [shift, setShift] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [removedIndices, setRemovedIndices] = useState<number[]>([]);
  const [tab, setTab] = useState<Tab>('chart');

  // Extract ALL data points
  const allPoints = useMemo(() => {
    const points = fitData?.points || [];
    return points.map((p, i) => {
      const x = Number((p as Record<string,unknown>).conc ?? (p as Record<string,unknown>).x ?? 0);
      const y = Number(
        (p as Record<string,unknown>).final_delta_od ??
        (p as Record<string,unknown>)['Final Delta OD'] ??
        (p as Record<string,unknown>).od ?? (p as Record<string,unknown>).y ?? 0
      );
      const label = String(p.patient_id || (p as Record<string,unknown>).control_id || `P${i + 1}`);
      const well = String((p as Record<string,unknown>).test_well || '');
      return { idx: i, x, y, label, well, valid: isFinite(x) && isFinite(y) && (x !== 0 || y !== 0) };
    }).filter(p => p.valid);
  }, [fitData]);

  // Active points (after removal)
  const activePoints = useMemo(
    () => allPoints.filter(p => !removedIndices.includes(p.idx)),
    [allPoints, removedIndices]
  );

  const xs = useMemo(() => activePoints.map(p => p.x), [activePoints]);
  const ys = useMemo(() => activePoints.map(p => p.y), [activePoints]);

  // Linear fit on active points
  const origFit = useMemo(() => linearFit(xs, ys), [xs, ys]);

  // Adjusted prediction
  const calcAdjusted = useCallback((yPred: number[], xArr: number[], s: number, r: number) => {
    const n = xArr.length;
    if (n === 0) return [];
    const cx = xArr.reduce((a, b) => a + b, 0) / n;
    const cy = yPred.reduce((a, b) => a + b, 0) / n;
    const rad = (r * Math.PI) / 180;
    const cosR = Math.cos(rad), sinR = Math.sin(rad);
    return yPred.map((yp, i) => {
      const dx = xArr[i] - cx, dy = yp - cy;
      return cy + dx * sinR + dy * cosR + s;
    });
  }, []);

  // Current fit (with shift/rotation applied)
  const currentFit = useMemo(() => {
    if (shift === 0 && rotation === 0) return origFit;
    const origPred = xs.map(x => origFit.slope * x + origFit.intercept);
    const adjPred = calcAdjusted(origPred, xs, shift, rotation);
    // Refit to get new slope/intercept
    const newFit = linearFit(xs, adjPred);
    // R² against actual data
    const yBar = ys.reduce((a, b) => a + b, 0) / ys.length;
    const ssTot = ys.reduce((s, y) => s + (y - yBar) ** 2, 0);
    const ssRes = ys.reduce((s, y, i) => s + (y - adjPred[i]) ** 2, 0);
    const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
    return { slope: newFit.slope, intercept: newFit.intercept, r2 };
  }, [xs, ys, origFit, shift, rotation, calcAdjusted]);

  // Residuals
  const residuals = useMemo(() => {
    return activePoints.map((p, i) => {
      const predicted = currentFit.slope * p.x + currentFit.intercept;
      const residual = p.y - predicted;
      return { ...p, i, predicted, residual };
    });
  }, [activePoints, currentFit]);

  // Chart data
  const scatterData = useMemo(() => activePoints.map(p => ({ x: p.x, y: p.y, label: p.label, well: p.well })), [activePoints]);
  const removedScatterData = useMemo(() => allPoints.filter(p => removedIndices.includes(p.idx)).map(p => ({ x: p.x, y: p.y, label: p.label })), [allPoints, removedIndices]);

  const lineData = useMemo(() => {
    if (xs.length < 2) return [];
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const pad = (xMax - xMin) * 0.05;
    const x1 = xMin - pad, x2 = xMax + pad;
    return [
      { x: x1, y: currentFit.slope * x1 + currentFit.intercept },
      { x: x2, y: currentFit.slope * x2 + currentFit.intercept },
    ];
  }, [xs, currentFit]);

  const hasAdjustment = shift !== 0 || rotation !== 0;
  const equation = `y = ${currentFit.slope.toPrecision(6)}x + ${currentFit.intercept.toPrecision(6)}; R2 = ${currentFit.r2.toPrecision(6)}; n = ${xs.length}`;

  // Remove point handler
  const removePoint = (pointIdx: number) => {
    if (removedIndices.includes(pointIdx)) return;
    setRemovedIndices(prev => [...prev, pointIdx]);
  };

  // Restore point
  const restorePoint = (pointIdx: number) => {
    setRemovedIndices(prev => prev.filter(i => i !== pointIdx));
  };

  const handleConfirm = () => {
    onConfirm({
      slope: currentFit.slope,
      intercept: currentFit.intercept,
      r2: currentFit.r2,
      equation,
      points: fitData?.points || [],
    });
  };

  if (allPoints.length < 2) {
    return (
      <div className="rd-info-card">
        <h3>曲線調整</h3>
        <p className="rd-no-data">資料點不足（至少需要 2 筆），無法進行曲線擬合</p>
        <div className="rd-action-buttons" style={{ marginTop: 16 }}>
          <button className="rd-btn rd-btn-outline" onClick={onCancel}>返回</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rd-curve-fit">
      {/* Metrics */}
      <div className="rd-info-card">
        <h3>📈 線性擬合 (n={activePoints.length}/{allPoints.length})</h3>
        <div className="rd-fit-metrics">
          <div className="rd-metric">
            <span className="rd-metric-label">Slope</span>
            <span className="rd-metric-value">{currentFit.slope.toPrecision(6)}</span>
          </div>
          <div className="rd-metric">
            <span className="rd-metric-label">Intercept</span>
            <span className="rd-metric-value">{currentFit.intercept.toPrecision(6)}</span>
          </div>
          <div className="rd-metric">
            <span className="rd-metric-label">R²</span>
            <span className="rd-metric-value">{currentFit.r2.toFixed(6)}</span>
          </div>
        </div>
        {hasAdjustment && (
          <div className="rd-adj-badge">調整中 — Shift: {shift.toFixed(3)}, Rotation: {rotation.toFixed(1)}°</div>
        )}
        {removedIndices.length > 0 && (
          <div className="rd-adj-badge" style={{ background: '#FEE2E2', color: '#991B1B' }}>
            已移除 {removedIndices.length} 筆離差點
          </div>
        )}
      </div>

      {/* Tab switcher */}
      <div className="rd-filter-tabs">
        <button className={tab === 'chart' ? 'active' : ''} onClick={() => setTab('chart')}>📈 擬合圖</button>
        <button className={tab === 'residuals' ? 'active' : ''} onClick={() => setTab('residuals')}>📉 殘差</button>
      </div>

      {tab === 'chart' && (
        <>
          {/* Chart */}
          <div className="rd-info-card" style={{ padding: '12px 4px' }}>
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="x" type="number" name="Conc" tick={{ fontSize: 10 }} />
                <YAxis dataKey="y" type="number" name="OD" tick={{ fontSize: 10 }} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const d = payload[0].payload as { x: number; y: number; label?: string; well?: string };
                  return (
                    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 6, fontSize: 11 }}>
                      {d.label && <div><b>{d.label}</b> {d.well && `(Well ${d.well})`}</div>}
                      <div>Conc: {d.x?.toFixed(2)}</div>
                      <div>OD: {d.y?.toFixed(6)}</div>
                    </div>
                  );
                }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Scatter name="資料點" data={scatterData} fill="#2563eb" />
                {removedScatterData.length > 0 && (
                  <Scatter name="已移除" data={removedScatterData} fill="#dc2626" opacity={0.4} shape="cross" />
                )}
                <Scatter name="擬合線" data={lineData} fill="#16a34a" line shape={() => null} strokeWidth={2.5} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* Sliders */}
          <div className="rd-info-card">
            <h3>🎛️ 曲線調整</h3>
            <div className="rd-slider-group">
              <label className="rd-slider-label">垂直位移: <b>{shift.toFixed(3)}</b></label>
              <input type="range" min={-0.5} max={0.5} step={0.001} value={shift}
                onChange={e => setShift(+e.target.value)} className="rd-slider" />
            </div>
            <div className="rd-slider-group">
              <label className="rd-slider-label">旋轉: <b>{rotation.toFixed(1)}°</b></label>
              <input type="range" min={-15} max={15} step={0.1} value={rotation}
                onChange={e => setRotation(+e.target.value)} className="rd-slider" />
            </div>
            <button className="rd-btn-sm rd-btn-outline" onClick={() => { setShift(0); setRotation(0); }}>
              🔄 重置調整
            </button>
          </div>
        </>
      )}

      {tab === 'residuals' && (
        <>
          {/* Residual bar chart */}
          <div className="rd-info-card" style={{ padding: '12px 4px' }}>
            <h3 style={{ padding: '0 12px' }}>殘差分布 <span style={{ fontSize: '0.7rem', color: '#6B7C85' }}>（離差大可點擊柱狀移除；已移除點可點擊 ↩ 恢復）</span></h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={residuals.map((r) => ({ name: `${r.label}`, residual: r.residual, idx: r.idx }))}
                margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const d = payload[0].payload as { name: string; residual: number };
                  return (
                    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 6, fontSize: 11 }}>
                      <div><b>{d.name}</b></div>
                      <div>殘差: {d.residual?.toFixed(6)}</div>
                      <div style={{ color: '#dc2626', marginTop: 2 }}>點擊移除</div>
                    </div>
                  );
                }} />
                <Bar dataKey="residual" fill="#6366f1" cursor="pointer"
                  onClick={(_data, index) => { const pt = residuals[index]; if (pt) removePoint(pt.idx); }} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Point list with remove buttons */}
          <div className="rd-info-card">
            <h3>資料點管理 <span style={{ fontSize: '0.7rem', color: '#6B7C85' }}>（離差大可點擊 ✕ 移除；已移除點可點擊 ↩ 恢復）</span></h3>
            <div className="rd-points-table">
              <table>
                <thead>
                  <tr><th>#</th><th>Control</th><th>Well</th><th>Conc</th><th>OD</th><th>殘差</th><th></th></tr>
                </thead>
                <tbody>
                  {residuals.map((r) => (
                    <tr key={r.idx}>
                      <td>{r.i + 1}</td>
                      <td>{r.label}</td>
                      <td>{r.well}</td>
                      <td>{r.x.toFixed(1)}</td>
                      <td>{r.y.toFixed(5)}</td>
                      <td style={{ color: Math.abs(r.residual) > 0.01 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                        {r.residual.toFixed(5)}
                      </td>
                      <td>
                        <button type="button" className="rd-remove-btn" onClick={(e) => { e.stopPropagation(); removePoint(r.idx); }} title="移除此點">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Removed points */}
          {removedIndices.length > 0 && (
            <div className="rd-info-card">
              <h3>已移除的點 <span style={{ fontSize: '0.7rem', color: '#991B1B' }}>（點擊 ↩ 恢復；Marker 任務刪除請在列表向左滑動）</span></h3>
              <div className="rd-points-table">
                <table>
                  <thead>
                    <tr><th>#</th><th>Control</th><th>Well</th><th>Conc</th><th>OD</th><th></th></tr>
                  </thead>
                  <tbody>
                    {allPoints.filter(p => removedIndices.includes(p.idx)).map(p => (
                      <tr key={p.idx} style={{ opacity: 0.6 }}>
                        <td>{p.idx + 1}</td>
                        <td>{p.label}</td>
                        <td>{p.well}</td>
                        <td>{p.x.toFixed(1)}</td>
                        <td>{p.y.toFixed(5)}</td>
                        <td>
                          <button type="button" className="rd-restore-btn" onClick={(e) => { e.stopPropagation(); restorePoint(p.idx); }} title="恢復此點">↩</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Equation */}
      <div className="rd-info-card">
        <div className="rd-equation-box">
          <span className="rd-eq-label">Equation</span>
          <code>{equation}</code>
        </div>
      </div>

      {/* Actions */}
      <div className="rd-action-buttons">
        <button className="rd-btn rd-btn-primary" onClick={handleConfirm} disabled={saving || activePoints.length < 2}>
          {saving ? '寫入中...' : '✅ 確認寫入建線'}
        </button>
        <button className="rd-btn rd-btn-outline" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </div>
  );
}
