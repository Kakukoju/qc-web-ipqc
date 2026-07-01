import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar,
} from 'recharts';
import type { FitData, FitSaveParams } from '../../api/rdBuildLine';
import {
  DIRECTION_LABELS,
  DIRECTION_METADATA_LABELS,
  MODEL_LABELS,
  STRATEGY_LABELS,
  fitCurve,
  inferReferenceConc,
  type CurveModel,
  type EquationDirection,
  type FitStrategy,
} from './curveFitting';
import AiFeasibilityPanel from './AiFeasibilityPanel';

interface Props {
  fitData: FitData | null;
  onConfirm: (params: FitSaveParams) => void;
  onCancel: () => void;
  saving: boolean;
}

type Tab = 'chart' | 'residuals' | 'ai-auto-fit';

function formatCoefficient(value: number) {
  return Number(value.toPrecision(8)).toString();
}

export default function CurveFitAdjust({ fitData, onConfirm, onCancel, saving }: Props) {
  const [shift, setShift] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [removedIndices, setRemovedIndices] = useState<number[]>([]);
  const [tab, setTab] = useState<Tab>('chart');
  const [equationDirection, setEquationDirection] = useState<EquationDirection>('forward_od_to_conc');
  const [curveModel, setCurveModel] = useState<CurveModel>('linear');
  const [fitStrategy, setFitStrategy] = useState<FitStrategy>('full_range');
  const [opticalResolution, setOpticalResolution] = useState(0.001);

  // Extract ALL data points — OD as x-axis, Conc as y-axis
  const allPoints = useMemo(() => {
    const points = fitData?.points || [];
    return points.map((p, i) => {
      const x = Number(
        (p as Record<string,unknown>).final_delta_od ??
        (p as Record<string,unknown>)['Final Delta OD'] ??
        (p as Record<string,unknown>).od ?? (p as Record<string,unknown>).y ?? 0
      );
      const y = Number((p as Record<string,unknown>).conc ?? (p as Record<string,unknown>).x ?? 0);
      const label = String(p.patient_id || (p as Record<string,unknown>).control_id || `P${i + 1}`);
      const well = String((p as Record<string,unknown>).test_well || '');
      return {
        idx: i,
        od: x,
        conc: y,
        label,
        well,
        valid: isFinite(x) && isFinite(y) && (x !== 0 || y !== 0),
      };
    }).filter(p => p.valid);
  }, [fitData]);

  // Active points (after removal)
  const activePoints = useMemo(
    () => allPoints.filter(p => !removedIndices.includes(p.idx)),
    [allPoints, removedIndices]
  );

  const inferredReferenceConc = useMemo(
    () => inferReferenceConc(allPoints, fitData),
    [allPoints, fitData],
  );
  const targetConcentrations = useMemo(
    () => Array.from(new Set(allPoints.map(point => point.conc))).sort((a, b) => a - b),
    [allPoints],
  );
  const [targetSelection, setTargetSelection] = useState('auto');
  const [customTargetConc, setCustomTargetConc] = useState('');
  const [localStartConc, setLocalStartConc] = useState('');
  const [localEndConc, setLocalEndConc] = useState('');
  const referenceConc = useMemo(() => {
    if (targetSelection === 'custom') {
      const custom = Number(customTargetConc);
      return Number.isFinite(custom) ? custom : inferredReferenceConc;
    }
    if (targetSelection !== 'auto') {
      const selected = Number(targetSelection);
      if (Number.isFinite(selected)) return selected;
    }
    return inferredReferenceConc;
  }, [customTargetConc, inferredReferenceConc, targetSelection]);

  useEffect(() => {
    const saved = Number(fitData?.strategy_reference_conc);
    if (!Number.isFinite(saved)) return;
    const matching = targetConcentrations.find(value => value === saved);
    if (matching != null) {
      setTargetSelection(String(matching));
    } else {
      setTargetSelection('custom');
      setCustomTargetConc(String(saved));
    }
  }, [fitData, targetConcentrations]);
  useEffect(() => {
    if (targetConcentrations.length === 0) return;
    const savedStart = Number(fitData?.local_range_min_conc);
    const savedEnd = Number(fitData?.local_range_max_conc);
    setLocalStartConc(String(
      Number.isFinite(savedStart) && targetConcentrations.includes(savedStart)
        ? savedStart
        : targetConcentrations[0],
    ));
    setLocalEndConc(String(
      Number.isFinite(savedEnd) && targetConcentrations.includes(savedEnd)
        ? savedEnd
        : targetConcentrations[targetConcentrations.length - 1],
    ));
  }, [fitData, targetConcentrations]);
  const localRange = useMemo<[number, number] | undefined>(() => {
    const start = Number(localStartConc);
    const end = Number(localEndConc);
    return Number.isFinite(start) && Number.isFinite(end) ? [start, end] : undefined;
  }, [localEndConc, localStartConc]);
  const fitted = useMemo(() => fitCurve(activePoints, {
    equationDirection,
    curveModel,
    fitStrategy,
    referenceConc,
    localRange,
  }), [activePoints, equationDirection, curveModel, fitStrategy, localRange, referenceConc]);
  const chartPoints = useMemo(() => activePoints.map(point => ({
    ...point,
    x: equationDirection === 'forward_od_to_conc' ? point.od : point.conc,
    y: equationDirection === 'forward_od_to_conc' ? point.conc : point.od,
  })), [activePoints, equationDirection]);
  const xs = useMemo(() => chartPoints.map(point => point.x), [chartPoints]);
  const currentPredict = useCallback((x: number) => {
    if (!fitted) return 0;
    const base = fitted.predict(x);
    if (curveModel !== 'linear' || rotation === 0) return base + shift;
    const centerX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    return base + shift + Math.tan(rotation * Math.PI / 180) * (x - centerX);
  }, [curveModel, fitted, rotation, shift, xs]);

  // Residuals
  const residuals = useMemo(() => {
    return chartPoints.map((p, i) => {
      const predicted = currentPredict(p.x);
      const residual = p.y - predicted;
      return { ...p, i, predicted, residual };
    });
  }, [chartPoints, currentPredict]);

  // Chart data
  const scatterData = chartPoints;
  const removedScatterData = useMemo(() => allPoints.filter(p => removedIndices.includes(p.idx)).map(p => ({
    x: equationDirection === 'forward_od_to_conc' ? p.od : p.conc,
    y: equationDirection === 'forward_od_to_conc' ? p.conc : p.od,
    label: p.label,
  })), [allPoints, equationDirection, removedIndices]);

  const lineData = useMemo(() => {
    if (xs.length < 2 || !fitted) return [];
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const pad = (xMax - xMin || Math.abs(xMax) || 1) * 0.05;
    const start = curveModel === 'natural_log' ? Math.max(Number.MIN_VALUE, xMin - pad) : xMin - pad;
    return Array.from({ length: 60 }, (_, index) => {
      const x = start + ((xMax + pad - start) * index) / 59;
      return { x, y: currentPredict(x) };
    });
  }, [curveModel, currentPredict, fitted, xs]);

  const hasAdjustment = shift !== 0 || rotation !== 0;
  const adjustedCoefficients = useMemo(() => {
    if (!fitted) return [];
    const coefficients = [...fitted.coefficients];
    if (curveModel === 'linear') {
      const rotationSlope = Math.tan(rotation * Math.PI / 180);
      const centerX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
      coefficients[0] += rotationSlope;
      coefficients[1] += shift - rotationSlope * centerX;
    } else {
      coefficients[coefficients.length - 1] += shift;
    }
    return coefficients;
  }, [curveModel, fitted, rotation, shift, xs]);
  const currentR2 = useMemo(() => {
    const evaluated = residuals.filter(point => fitted?.usedPointIndices.includes(point.idx));
    if (evaluated.length === 0) return 0;
    const mean = evaluated.reduce((sum, point) => sum + point.y, 0) / evaluated.length;
    const total = evaluated.reduce((sum, point) => sum + (point.y - mean) ** 2, 0);
    const residual = evaluated.reduce((sum, point) => sum + point.residual ** 2, 0);
    return total === 0 ? 1 : 1 - residual / total;
  }, [fitted, residuals]);
  const equation = useMemo(() => {
    if (!fitted) return '無法以目前選項完成擬合';
    const output = equationDirection === 'forward_od_to_conc' ? 'conc' : 'OD';
    const input = equationDirection === 'forward_od_to_conc' ? 'OD' : 'conc';
    const core = curveModel === 'quadratic'
      ? `${output} = ${formatCoefficient(adjustedCoefficients[0])} * ${input}^2 + ${formatCoefficient(adjustedCoefficients[1])} * ${input} + ${formatCoefficient(adjustedCoefficients[2])}`
      : curveModel === 'natural_log'
        ? `${output} = ${formatCoefficient(adjustedCoefficients[0])} * ln(${input}) + ${formatCoefficient(adjustedCoefficients[1])}`
        : `${output} = ${formatCoefficient(adjustedCoefficients[0])} * ${input} + ${formatCoefficient(adjustedCoefficients[1])}`;
    return `${core}; R² = ${currentR2.toPrecision(6)}; n = ${fitted.usedPointIndices.length}`;
  }, [adjustedCoefficients, currentR2, curveModel, equationDirection, fitted]);

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
    if (!fitted) return;
    onConfirm({
      slope: adjustedCoefficients[0],
      intercept: adjustedCoefficients[adjustedCoefficients.length - 1],
      r2: currentR2,
      equation,
      points: fitData?.points || [],
      equation_direction: equationDirection,
      equation_direction_label: DIRECTION_METADATA_LABELS[equationDirection],
      curve_model: curveModel,
      fit_strategy: fitStrategy,
      formula_text: fitted.formulaText,
      coefficients: adjustedCoefficients,
      strategy_reference_conc: referenceConc,
      local_range_min_conc: fitStrategy === 'local_near_cutoff' && localRange ? Math.min(...localRange) : undefined,
      local_range_max_conc: fitStrategy === 'local_near_cutoff' && localRange ? Math.max(...localRange) : undefined,
      used_point_indices: fitted.usedPointIndices,
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
      <div className="rd-info-card">
        <h3>Fitting Options</h3>
        <div className="rd-fit-options">
          <label>
            <span>Equation Direction</span>
            <select value={equationDirection} onChange={event => {
              setEquationDirection(event.target.value as EquationDirection);
              setShift(0);
              setRotation(0);
            }}>
              {Object.entries(DIRECTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Curve Model</span>
            <select value={curveModel} onChange={event => {
              setCurveModel(event.target.value as CurveModel);
              setShift(0);
              setRotation(0);
            }}>
              {Object.entries(MODEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Fit Strategy</span>
            <select value={fitStrategy} onChange={event => setFitStrategy(event.target.value as FitStrategy)}>
              {Object.entries(STRATEGY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>光學解析度 (OD)</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.001"
              min="0.001"
              max="0.1"
              value={opticalResolution}
              onChange={event => {
                const v = parseFloat(event.target.value);
                if (isFinite(v) && v > 0) setOpticalResolution(v);
              }}
              placeholder="0.001"
            />
          </label>
          {fitStrategy === 'weighted_near_target' && (
            <label>
              <span>Target Concentration</span>
              <select value={targetSelection} onChange={event => setTargetSelection(event.target.value)}>
                <option value="auto">自動中位數 ({inferredReferenceConc.toPrecision(6)})</option>
                {targetConcentrations.map(value => (
                  <option key={value} value={value}>{value} (Control concentration)</option>
                ))}
                <option value="custom">自訂濃度</option>
              </select>
            </label>
          )}
          {fitStrategy === 'weighted_near_target' && targetSelection === 'custom' && (
            <label>
              <span>Custom Target Concentration</span>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={customTargetConc}
                onChange={event => setCustomTargetConc(event.target.value)}
                placeholder="輸入 target concentration"
              />
            </label>
          )}
          {fitStrategy === 'local_near_cutoff' && (
            <>
              <label>
                <span>Local Concentration 1</span>
                <select value={localStartConc} onChange={event => setLocalStartConc(event.target.value)}>
                  {targetConcentrations.map(value => (
                    <option key={value} value={value} disabled={String(value) === localEndConc}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Local Concentration 2</span>
                <select value={localEndConc} onChange={event => setLocalEndConc(event.target.value)}>
                  {targetConcentrations.map(value => (
                    <option key={value} value={value} disabled={String(value) === localStartConc}>{value}</option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
        {fitStrategy === 'weighted_near_target' && (
          <p className="rd-fit-reference">
            Selected target concentration: {referenceConc.toPrecision(6)}
          </p>
        )}
        {fitStrategy === 'local_near_cutoff' && localRange && (
          <p className="rd-fit-reference">
            Selected local concentrations: {localRange[0]} ＆ {localRange[1]}
          </p>
        )}
      </div>

      {/* Metrics */}
      <div className="rd-info-card">
        <h3>{MODEL_LABELS[curveModel]} 擬合 (n={fitted?.usedPointIndices.length || 0}/{allPoints.length})</h3>
        <div className="rd-fit-metrics">
          {adjustedCoefficients.map((coefficient, index) => (
            <div className="rd-metric" key={index}>
              <span className="rd-metric-label">
                {curveModel === 'quadratic' ? ['a', 'b', 'c'][index] : index === 0 ? 'a' : 'b'}
              </span>
              <span className="rd-metric-value">{coefficient.toPrecision(6)}</span>
            </div>
          ))}
          <div className="rd-metric">
            <span className="rd-metric-label">R²</span>
            <span className="rd-metric-value">{currentR2.toFixed(6)}</span>
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
        <button className={tab === 'ai-auto-fit' ? 'active' : ''} onClick={() => setTab('ai-auto-fit')}>🧠 AI分析</button>
      </div>

      {tab === 'chart' && (
        <>
          {/* Chart */}
          <div className="rd-info-card" style={{ padding: '12px 4px' }}>
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="x" type="number" name={fitted?.xLabel || 'X'} tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                <YAxis dataKey="y" type="number" name={fitted?.yLabel || 'Y'} tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const d = payload[0].payload as { x: number; y: number; label?: string; well?: string };
                  return (
                    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 6, fontSize: 11 }}>
                      {d.label && <div><b>{d.label}</b> {d.well && `(Well ${d.well})`}</div>}
                      <div>{fitted?.xLabel || 'X'}: {d.x?.toFixed(6)}</div>
                      <div>{fitted?.yLabel || 'Y'}: {d.y?.toFixed(6)}</div>
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
                onChange={e => setRotation(+e.target.value)} className="rd-slider"
                disabled={curveModel !== 'linear'} />
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
                  <tr><th>#</th><th>Control</th><th>Well</th><th>OD</th><th>Conc</th><th>殘差</th><th></th></tr>
                </thead>
                <tbody>
                  {residuals.map((r) => (
                    <tr key={r.idx}>
                      <td>{r.i + 1}</td>
                      <td>{r.label}</td>
                      <td>{r.well}</td>
                      <td>{r.od.toFixed(5)}</td>
                      <td>{r.conc.toFixed(1)}</td>
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
                    <tr><th>#</th><th>Control</th><th>Well</th><th>OD</th><th>Conc</th><th></th></tr>
                  </thead>
                  <tbody>
                    {allPoints.filter(p => removedIndices.includes(p.idx)).map(p => (
                      <tr key={p.idx} style={{ opacity: 0.6 }}>
                        <td>{p.idx + 1}</td>
                        <td>{p.label}</td>
                        <td>{p.well}</td>
                        <td>{p.od.toFixed(5)}</td>
                        <td>{p.conc.toFixed(1)}</td>
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

      {tab === 'ai-auto-fit' && (
        <AiFeasibilityPanel
          fitData={fitData}
          opticalResolution={opticalResolution}
          onApplyAutoFit={(indices, _eq) => {
            setRemovedIndices(prev => [...new Set([...prev, ...indices])]);
            setTab('chart');
          }}
        />
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
        <button className="rd-btn rd-btn-primary" onClick={handleConfirm} disabled={saving || !fitted}>
          {saving ? '寫入中...' : '✅ 確認寫入建線'}
        </button>
        <button className="rd-btn rd-btn-outline" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </div>
  );
}
