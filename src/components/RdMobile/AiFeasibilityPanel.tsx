import { useState, useCallback, useEffect, useRef } from 'react';
import type { FeasibilityResult, AutoFitResult } from '../../api/aiFeasibility';
import { runFeasibilityAnalysis, runAutoFit } from '../../api/aiFeasibility';
import type { FitData } from '../../api/rdBuildLine';

interface Props {
  fitData: FitData | null;
  opticalResolution: number;
  onApplyAutoFit?: (removedIndices: number[], equation: string) => void;
}

type Status = 'idle' | 'analyzing' | 'done' | 'error' | 'auto-fitting' | 'auto-fit-done';

export default function AiFeasibilityPanel({ fitData, opticalResolution, onApplyAutoFit }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [feasibility, setFeasibility] = useState<FeasibilityResult | null>(null);
  const [autoFitResult, setAutoFitResult] = useState<AutoFitResult | null>(null);
  const [error, setError] = useState('');
  const autoTriggered = useRef(false);

  const extractPoints = useCallback(() => {
    const pts = fitData?.points || [];
    return pts.map((p, i) => ({
      patient_id: p.patient_id || `P${i + 1}`,
      conc: p.conc != null ? Number(p.conc) : null,
      od: Number(
        (p as Record<string, unknown>).final_delta_od ??
        (p as Record<string, unknown>)['Final Delta OD'] ??
        (p as Record<string, unknown>).od ?? 0
      ) || null,
    }));
  }, [fitData]);

  const extractConcs = useCallback(() => {
    const pts = fitData?.points || [];
    const concs: Record<string, number> = {};
    for (const p of pts) {
      const pid = (p.patient_id || '').toLowerCase();
      const c = p.conc != null ? Number(p.conc) : null;
      if (!c) continue;
      if (pid === 'control-1' && !concs.L1) concs.L1 = c;
      if (pid === 'control-2' && !concs.L2) concs.L2 = c;
      if (pid === 'control-3' && !concs.N1) concs.N1 = c;
      if (pid === 'control-4' && !concs.N3) concs.N3 = c;
    }
    return concs;
  }, [fitData]);

  const handleAnalyze = useCallback(async () => {
    setStatus('analyzing');
    setError('');
    try {
      const points = extractPoints();
      const assigned_concs = extractConcs();
      const result = await runFeasibilityAnalysis({
        points,
        slope: fitData?.fit?.slope ?? fitData?.slope,
        intercept: fitData?.fit?.intercept ?? fitData?.intercept,
        r2: fitData?.fit?.r2 ?? fitData?.r2,
        analyze_item: fitData?.analyze_item || '',
        optical_resolution: opticalResolution,
        assigned_concs,
      });
      if (result.ok && result.data) {
        setFeasibility(result.data);
        setStatus('done');
      } else {
        setError(result.error || '分析失敗');
        setStatus('error');
      }
    } catch (e) {
      setError((e as Error).message || '網路錯誤');
      setStatus('error');
    }
  }, [extractConcs, extractPoints, fitData, opticalResolution]);

  const handleAutoFit = useCallback(async () => {
    setStatus('auto-fitting');
    setError('');
    try {
      const points = extractPoints();
      const assigned_concs = extractConcs();
      const result = await runAutoFit({
        points,
        analyze_item: fitData?.analyze_item || '',
        optical_resolution: opticalResolution,
        assigned_concs,
        max_iterations: 5,
      });
      if (result.ok && result.data) {
        setAutoFitResult(result.data);
        setStatus('auto-fit-done');
      } else {
        setError(result.error || 'Auto-fit 失敗');
        setStatus('error');
      }
    } catch (e) {
      setError((e as Error).message || '網路錯誤');
      setStatus('error');
    }
  }, [extractConcs, extractPoints, fitData, opticalResolution]);

  const handleApplyAutoFit = useCallback(() => {
    if (!autoFitResult?.finalEquation || !onApplyAutoFit) return;
    onApplyAutoFit(autoFitResult.removedIndices, autoFitResult.finalEquation);
  }, [autoFitResult, onApplyAutoFit]);

  // Auto-trigger analysis when component mounts (tab selected)
  useEffect(() => {
    if (autoTriggered.current) return;
    if (status !== 'idle') return;
    autoTriggered.current = true;
    handleAnalyze();
  }, [handleAnalyze, status]);

  if (status === 'idle' || status === 'analyzing' || status === 'auto-fitting') {
    return (
      <div className="rd-info-card">
        <h3>🧠 {status === 'analyzing' ? 'AI 分析中...' : status === 'auto-fitting' ? 'AI Auto-Fitting...' : 'AI 可行性分析'}</h3>
        <div className="rd-loading" style={{ padding: '20px 0' }}>
          <div className="rd-spinner" />
          <p>{status === 'analyzing' ? '正在檢查 Reference Range 與 TEa...' : '正在迭代優化曲線...'}</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="rd-info-card">
        <h3>🧠 AI 分析</h3>
        <div className="rd-result-card error" style={{ margin: '8px 0' }}>
          <p>❌ {error}</p>
        </div>
        <button className="rd-btn rd-btn-outline" onClick={handleAnalyze}>重試</button>
      </div>
    );
  }

  if (status === 'auto-fit-done' && autoFitResult) {
    return (
      <div className="rd-info-card">
        <h3>🧠 AI Auto-Fit 結果</h3>
        <div style={{ fontSize: '0.82rem' }}>
          <div className={`rd-result-card ${autoFitResult.converged ? 'success' : 'error'}`} style={{ margin: '8px 0', padding: '10px' }}>
            <p>{autoFitResult.converged ? '✅ 收斂成功' : '⚠️ 未完全收斂'}</p>
            {autoFitResult.finalFit && (
              <p style={{ fontSize: '0.78rem', marginTop: 4 }}>
                R² = {autoFitResult.finalFit.r2.toFixed(6)} · n = {autoFitResult.finalPointCount}/{autoFitResult.originalPointCount}
              </p>
            )}
          </div>

          {autoFitResult.iterations.map((iter, i) => (
            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Iteration {iter.iteration}</strong>
                <span style={{ color: iter.action === 'converged' ? '#16a34a' : '#f59e0b', fontSize: '0.75rem' }}>
                  {iter.action}
                </span>
              </div>
              <p style={{ color: '#64748b', fontSize: '0.75rem', margin: '2px 0' }}>{iter.message}</p>
              {iter.aiReason && (
                <p style={{ color: '#6366f1', fontSize: '0.72rem', margin: '2px 0' }}>AI: {iter.aiReason}</p>
              )}
            </div>
          ))}

          {autoFitResult.finalEquation && (
            <div className="rd-equation-box" style={{ marginTop: 8 }}>
              <span className="rd-eq-label">Final Equation</span>
              <code style={{ fontSize: '0.72rem' }}>{autoFitResult.finalEquation}</code>
            </div>
          )}

          {autoFitResult.removedIndices.length > 0 && (
            <p style={{ color: '#dc2626', margin: '8px 0', fontSize: '0.78rem' }}>
              移除了 {autoFitResult.removedIndices.length} 個離差點 (indices: {autoFitResult.removedIndices.join(', ')})
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {onApplyAutoFit && autoFitResult.finalEquation && (
              <button className="rd-btn rd-btn-primary" onClick={handleApplyAutoFit}>
                套用 Auto-Fit 結果
              </button>
            )}
            <button className="rd-btn rd-btn-outline" onClick={() => { setStatus('done'); setAutoFitResult(null); }}>
              返回分析
            </button>
          </div>
        </div>
      </div>
    );
  }

  // status === 'done'
  return (
    <div className="rd-info-card">
      <h3>🧠 AI 可行性分析結果</h3>

      {feasibility && (
        <div style={{ fontSize: '0.82rem' }}>
          {/* Clinical Spec */}
          {feasibility.clinicalSpec && (
            <div style={{ margin: '8px 0', padding: '8px', background: '#f8fafc', borderRadius: 6 }}>
              <strong>Clinical Spec: </strong>
              {feasibility.clinicalSpec.analyte_name || feasibility.clinicalSpec.analyte_code}
              {feasibility.clinicalSpec.tea_percent != null && (
                <span> · TEa = {feasibility.clinicalSpec.tea_percent}%</span>
              )}
              {feasibility.clinicalSpec.source_code && (
                <span style={{ color: '#6b7280' }}> ({feasibility.clinicalSpec.source_code})</span>
              )}
            </div>
          )}

          {/* Resolution Check */}
          {feasibility.resolutionCheck && (
            <div style={{
              margin: '8px 0', padding: '8px', borderRadius: 6,
              background: feasibility.resolutionCheck.passed ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${feasibility.resolutionCheck.passed ? '#bbf7d0' : '#fecaca'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{feasibility.resolutionCheck.passed ? '✅' : '❌'}</span>
                <strong>Reference Range 解析度</strong>
              </div>
              <p style={{ margin: '4px 0 0', color: '#374151', fontSize: '0.78rem' }}>
                {feasibility.resolutionCheck.message}
              </p>
              <p style={{ margin: '2px 0 0', color: '#6b7280', fontSize: '0.72rem' }}>
                濃度解析度 = {feasibility.resolutionCheck.concResolution.toFixed(4)} · 
                範圍跨度 = {feasibility.resolutionCheck.rangeSpan.toFixed(2)}
              </p>
            </div>
          )}

          {/* TEa Check */}
          {feasibility.teaCheck && (
            <div style={{
              margin: '8px 0', padding: '8px', borderRadius: 6,
              background: feasibility.teaCheck.passed ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${feasibility.teaCheck.passed ? '#bbf7d0' : '#fecaca'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{feasibility.teaCheck.passed ? '✅' : '❌'}</span>
                <strong>TEa 規格檢查</strong>
              </div>
              <table style={{ width: '100%', fontSize: '0.72rem', marginTop: 6, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ textAlign: 'left', padding: '2px 4px' }}>Level</th>
                    <th style={{ textAlign: 'right', padding: '2px 4px' }}>Bias%</th>
                    <th style={{ textAlign: 'right', padding: '2px 4px' }}>CV%</th>
                    <th style={{ textAlign: 'right', padding: '2px 4px' }}>TEa%</th>
                    <th style={{ textAlign: 'center', padding: '2px 4px' }}>判定</th>
                  </tr>
                </thead>
                <tbody>
                  {feasibility.teaCheck.levels.map((l, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '2px 4px' }}>{l.level}</td>
                      <td style={{ textAlign: 'right', padding: '2px 4px' }}>{l.biasPercent.toFixed(2)}</td>
                      <td style={{ textAlign: 'right', padding: '2px 4px' }}>{l.cvPercent.toFixed(2)}</td>
                      <td style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 600,
                        color: l.passed === false ? '#dc2626' : '#16a34a'
                      }}>{l.tea.toFixed(2)}</td>
                      <td style={{ textAlign: 'center', padding: '2px 4px' }}>
                        {l.passed === true ? '✅' : l.passed === false ? '❌' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* AI Analysis */}
          {feasibility.aiAnalysis && (
            <div style={{ margin: '8px 0', padding: '8px', background: '#eff6ff', borderRadius: 6, border: '1px solid #bfdbfe' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span>🧠</span>
                <strong>AI 分析</strong>
                {feasibility.aiAnalysis.fallbackUsed && (
                  <span style={{ fontSize: '0.68rem', color: '#f59e0b' }}>(fallback)</span>
                )}
              </div>
              {feasibility.aiAnalysis.sections.patternAnalysis && (
                <div style={{ margin: '4px 0', fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                  {feasibility.aiAnalysis.sections.patternAnalysis}
                </div>
              )}
              {feasibility.aiAnalysis.sections.recommendedActions && (
                <div style={{ margin: '6px 0 0', fontSize: '0.75rem', color: '#1e40af', whiteSpace: 'pre-wrap' }}>
                  <strong>建議行動：</strong>
                  {feasibility.aiAnalysis.sections.recommendedActions}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {feasibility.needsAi && (
              <button className="rd-btn rd-btn-primary" onClick={handleAutoFit}>
                🧠 AI Auto-Fitting
              </button>
            )}
            <button className="rd-btn rd-btn-outline" onClick={handleAnalyze}>重新分析</button>
          </div>
        </div>
      )}
    </div>
  );
}
