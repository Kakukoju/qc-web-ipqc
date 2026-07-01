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

/**
 * Renders AI analysis text with section headers styled distinctly.
 * Supports both 【...】 and numbered "N. Title" section headers.
 */
function AiSectionRenderer({ content }: { content: string }) {
  // Split on section headers: either 【...】 or numbered lines like "1. Clinical decision zone"
  const sections = content.split(/\n(?=\d+\.\s)|(?=【)/);
  return (
    <div style={{ fontSize: '0.75rem', marginBottom: 8 }}>
      {sections.map((section, idx) => {
        if (!section.trim()) return null;
        // Match 【...】 or numbered header "N. Title"
        const headerMatch = section.match(/^【\s*(.+?)\s*】\n?/) || section.match(/^(\d+\.\s+.+?)\n/);
        const header = headerMatch ? headerMatch[1] : null;
        const body = headerMatch ? section.slice(headerMatch[0].length) : section;
        const lines = body.split('\n').filter(l => l.trim());

        return (
          <div key={idx} style={{ marginBottom: 10 }}>
            {header && (
              <div style={{
                fontWeight: 700, fontSize: '0.78rem', color: '#1e3a5f',
                margin: '8px 0 4px', padding: '2px 0',
                borderBottom: '1px solid #dbeafe',
              }}>
                {header}
              </div>
            )}
            {lines.map((line, li) => {
              const stripped = line.replace(/^-\s*/, '');
              // Color coding
              let color = '#374151';
              let fontWeight: number | undefined;
              if (stripped.includes('不建議') || stripped.includes('Do NOT')) {
                color = '#dc2626';
                fontWeight = 600;
              } else if (stripped.includes('優先') || stripped.includes('priority') || stripped.includes('應優先')) {
                color = '#7c3aed';
                fontWeight = 500;
              } else if (stripped.includes('建議檢查') || stripped.includes('建議')) {
                color = '#0369a1';
              }
              // Indent sub-items (lines starting with spaces like "  a. ...")
              const isSubItem = line.match(/^\s{2,}/);
              return (
                <div key={li} style={{
                  color, fontWeight,
                  marginLeft: isSubItem ? 14 : 0,
                  padding: '1.5px 0',
                  lineHeight: 1.55,
                }}>
                  {line.startsWith('- ') ? `• ${stripped}` : stripped}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export default function AiFeasibilityPanel({ fitData, opticalResolution, onApplyAutoFit }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [feasibility, setFeasibility] = useState<FeasibilityResult | null>(null);
  const [autoFitResult, setAutoFitResult] = useState<AutoFitResult | null>(null);
  const [error, setError] = useState('');
  const [userContext, setUserContext] = useState('');
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
        user_context: userContext || undefined,
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
  }, [extractConcs, extractPoints, fitData, opticalResolution, userContext]);

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
                <span> · TEa = {feasibility.clinicalSpec.tea_percent.toFixed(1)}%</span>
              )}
              {feasibility.clinicalSpec.tea_absolute != null && (
                <span> · TEa = ±{feasibility.clinicalSpec.tea_absolute} {feasibility.clinicalSpec.unit || ''}</span>
              )}
              {feasibility.clinicalSpec.source_code && (
                <span style={{ color: '#6b7280' }}> ({feasibility.clinicalSpec.source_code})</span>
              )}
              {feasibility.teaOverride && (
                <div style={{ marginTop: 4, padding: '4px 8px', background: '#fef3c7', borderRadius: 4, fontSize: '0.74rem', color: '#92400e' }}>
                  ⚠️ 本次使用 <strong>{feasibility.teaOverride.source}</strong> TEa = {feasibility.teaOverride.tea_percent}% 重新分析
                  {feasibility.teaCheck && (
                    <span style={{ marginLeft: 8, fontWeight: 600, color: feasibility.teaCheck.passed ? '#16a34a' : '#dc2626' }}>
                      → {feasibility.teaCheck.passed ? '✅ ALL PASS' : `${feasibility.teaCheck.levels.filter(l => l.passed).length}/${feasibility.teaCheck.levels.length} PASS`}
                    </span>
                  )}
                </div>
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
                佔 RI = {((feasibility.resolutionCheck.resolutionRatioRI ?? feasibility.resolutionCheck.resolutionRatio ?? 0) * 100).toFixed(2)}%
                {feasibility.resolutionCheck.teaBudgetWorst != null && (
                  <span> · 佔 TEa budget = {(feasibility.resolutionCheck.teaBudgetWorst * 100).toFixed(1)}% ({feasibility.resolutionCheck.teaBudgetLevel})</span>
                )}
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
                    <th style={{ textAlign: 'right', padding: '2px 4px' }}>
                      {feasibility.teaCheck.levels[0]?.teaMode === 'absolute' ? 'TEa' : 'TEa%'}
                    </th>
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
            <div style={{ margin: '8px 0', padding: '10px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span>🧠</span>
                <strong>AI 分析</strong>
                {feasibility.aiAnalysis.fallbackUsed && (
                  <span style={{ fontSize: '0.68rem', color: '#f59e0b', marginLeft: 4 }}>(fallback)</span>
                )}
              </div>

              {/* Executive Summary */}
              {feasibility.aiAnalysis.sections.executiveSummary && (
                <div style={{
                  margin: '0 0 10px', padding: '8px 10px', borderRadius: 6,
                  background: '#fef3c7', border: '1px solid #fcd34d',
                  fontSize: '0.78rem', fontWeight: 600,
                }}>
                  {feasibility.aiAnalysis.sections.executiveSummary}
                </div>
              )}

              {/* Pattern Analysis - structured sections */}
              {feasibility.aiAnalysis.sections.patternAnalysis && (
                <AiSectionRenderer content={feasibility.aiAnalysis.sections.patternAnalysis} />
              )}
            </div>
          )}

          {/* Suggested Fits (AI auto-computed alternatives) */}
          {feasibility.suggestedFits && feasibility.suggestedFits.length > 0 && (
            <div style={{ margin: '10px 0', padding: '10px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #86efac' }}>
              <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#166534', marginBottom: 4 }}>
                🤖 AI 試算結果（替代 Fitting Strategy）
              </div>
              <div style={{ fontSize: '0.66rem', color: '#6b7280', marginBottom: 8 }}>
                {feasibility.teaCheck?.levels[0]?.teaMode === 'absolute'
                  ? `TEa = |Bias| + 2×SD，需 ≤ ${feasibility.teaCheck?.levels[0]?.teaThreshold?.toFixed(2) || '?'} ${feasibility.clinicalSpec?.unit || ''} 才 PASS`
                  : `TEa% = |Bias%| + 2×CV%，需 ≤ ${feasibility.teaCheck?.levels[0]?.teaThreshold?.toFixed(1) || '?'}% 才 PASS`
                }
              </div>
              {feasibility.suggestedFits.map((sf, i) => {
                const strategyLabel = sf.strategy === 'weighted_near_target' ? 'Weighted Near Target' : 'Local Near';
                const passCount = sf.teaCheck.levels.filter(l => l.passed).length;
                const totalCount = sf.teaCheck.levels.length;
                const currentPassCount = feasibility.teaCheck?.levels.filter(l => l.passed).length || 0;
                const threshold = sf.teaCheck.levels[0]?.teaThreshold;
                return (
                  <div key={i} style={{ padding: '8px', marginBottom: 6, background: '#fff', borderRadius: 6, border: '1px solid #d1fae5' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '0.76rem' }}>
                        {strategyLabel} → target {sf.targetConc} {feasibility.clinicalSpec?.unit || ''}
                      </strong>
                      <span style={{
                        fontSize: '0.7rem', padding: '2px 6px', borderRadius: 4,
                        background: sf.teaCheck.passed ? '#dcfce7' : passCount > currentPassCount ? '#fef9c3' : '#fef2f2',
                        color: sf.teaCheck.passed ? '#166534' : passCount > currentPassCount ? '#854d0e' : '#991b1b',
                      }}>
                        {sf.teaCheck.passed ? '✅ ALL PASS' : `${passCount}/${totalCount} pass`}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: 4 }}>
                      R² = {sf.fit.r2.toFixed(6)} · n = {sf.fit.n}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#475569', marginTop: 2, fontFamily: 'monospace' }}>
                      {sf.equation}
                    </div>
                    <table style={{ width: '100%', fontSize: '0.68rem', marginTop: 4, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: '#6b7280' }}>
                          <th style={{ textAlign: 'left', padding: '1px 3px', fontWeight: 500 }}>Level</th>
                          <th style={{ textAlign: 'right', padding: '1px 3px', fontWeight: 500 }}>Bias%</th>
                          <th style={{ textAlign: 'right', padding: '1px 3px', fontWeight: 500 }}>CV%</th>
                          <th style={{ textAlign: 'right', padding: '1px 3px', fontWeight: 500 }}>TEa%</th>
                          <th style={{ textAlign: 'right', padding: '1px 3px', fontWeight: 500 }}>Limit</th>
                          <th style={{ textAlign: 'center', padding: '1px 3px', fontWeight: 500 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {sf.teaCheck.levels.map((l, li) => (
                          <tr key={li}>
                            <td style={{ padding: '1px 3px' }}>{l.level}</td>
                            <td style={{ textAlign: 'right', padding: '1px 3px' }}>{l.biasPercent.toFixed(1)}</td>
                            <td style={{ textAlign: 'right', padding: '1px 3px' }}>{l.cvPercent.toFixed(1)}</td>
                            <td style={{ textAlign: 'right', padding: '1px 3px', fontWeight: 600, color: l.passed ? '#16a34a' : '#dc2626' }}>
                              {l.tea.toFixed(1)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '1px 3px', color: '#6b7280' }}>
                              ≤{threshold?.toFixed(1) || '?'}
                            </td>
                            <td style={{ textAlign: 'center', padding: '1px 3px' }}>
                              {l.passed ? '✅' : '❌'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}

          {/* Alternative Specs - show when TEa fails */}
          {feasibility.alternativeSpecs && feasibility.alternativeSpecs.length > 1 && feasibility.teaCheck && !feasibility.teaCheck.passed && (
            <div style={{ margin: '10px 0', padding: '10px', background: '#fefce8', borderRadius: 8, border: '1px solid #fde047' }}>
              <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#854d0e', marginBottom: 6 }}>
                📋 可用 TEa 規格比較
              </div>
              <div style={{ fontSize: '0.68rem', color: '#78716c', marginBottom: 6 }}>
                目前使用 <strong>{feasibility.clinicalSpec?.source_code}</strong> (TEa = {
                  feasibility.clinicalSpec?.tea_percent != null
                    ? `${feasibility.clinicalSpec.tea_percent.toFixed(1)}%`
                    : feasibility.clinicalSpec?.tea_absolute != null
                      ? `±${feasibility.clinicalSpec.tea_absolute} ${feasibility.clinicalSpec.unit || ''}`
                      : '?'
                })，以下為其他可用規格：
              </div>
              <table style={{ width: '100%', fontSize: '0.68rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
                    <th style={{ textAlign: 'left', padding: '3px 4px' }}>來源</th>
                    <th style={{ textAlign: 'left', padding: '3px 4px' }}>Species</th>
                    <th style={{ textAlign: 'right', padding: '3px 4px' }}>TEa</th>
                    <th style={{ textAlign: 'center', padding: '3px 4px' }}>結果</th>
                  </tr>
                </thead>
                <tbody>
                  {feasibility.alternativeSpecs
                    .filter(s => s.source !== feasibility.clinicalSpec?.source_code || s.tea_percent !== feasibility.clinicalSpec?.tea_percent)
                    .sort((a, b) => (a.tea_percent || 999) - (b.tea_percent || 999))
                    .map((s, i) => {
                      const teaDisplay = s.tea_percent != null
                        ? `${s.tea_percent}%`
                        : s.tea_absolute != null ? `±${s.tea_absolute} ${s.unit || ''}` : 'N/A';
                      const isMoreLenient = s.tea_percent != null && feasibility.clinicalSpec?.tea_percent != null
                        && s.tea_percent > feasibility.clinicalSpec.tea_percent;
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '3px 4px', fontWeight: isMoreLenient ? 600 : 400 }}>{s.source}</td>
                          <td style={{ padding: '3px 4px' }}>{s.species}</td>
                          <td style={{ textAlign: 'right', padding: '3px 4px', color: isMoreLenient ? '#16a34a' : '#374151', fontWeight: isMoreLenient ? 600 : 400 }}>
                            {teaDisplay}
                          </td>
                          <td style={{ padding: '3px 4px', textAlign: 'center', fontSize: '0.66rem',
                            color: s.allPass ? '#16a34a' : s.passCount != null ? '#92400e' : '#6b7280',
                            fontWeight: s.allPass ? 600 : 400,
                          }}>
                            {s.allPass ? '✅ ALL PASS' : s.passCount != null ? `${s.passCount}/${s.totalCount}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              <div style={{ fontSize: '0.68rem', color: '#92400e', marginTop: 6 }}>
                {(() => {
                  const passing = feasibility.alternativeSpecs?.filter(s => s.allPass && s.source !== feasibility.clinicalSpec?.source_code);
                  const best = passing && passing.length > 0
                    ? passing.sort((a, b) => (a.tea_percent || 999) - (b.tea_percent || 999))[0]
                    : null;
                  if (best) {
                    return <>💡 使用 <strong>{best.source} {best.tea_percent}%</strong> 規格可 ALL PASS。在下方輸入框輸入「改用 {best.source} {best.tea_percent}% 重新分析」。</>;
                  }
                  const improved = feasibility.alternativeSpecs?.filter(s =>
                    s.passCount != null && s.totalCount != null
                    && s.passCount > (feasibility.teaCheck?.levels.filter(l => l.passed).length || 0)
                  );
                  if (improved && improved.length > 0) {
                    const top = improved.sort((a, b) => (b.passCount || 0) - (a.passCount || 0))[0];
                    return <>💡 較寬鬆規格可改善結果。{top.source} {top.tea_percent}% → {top.passCount}/{top.totalCount} PASS。在下方輸入框輸入「改用 {top.source} {top.tea_percent}% 重新分析」。</>;
                  }
                  return <>💡 較寬鬆規格（綠色）可能讓部分 level 通過。在下方輸入框輸入規格名稱 + TEa% 重新分析。</>;
                })()}
              </div>
            </div>
          )}

          {/* Context input + Actions */}
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 8 }}>
              <textarea
                placeholder="輸入問題或要求給 AI（例如：請用 quadratic fitting 試算、請分析低端為什麼 CV 偏大...）"
                value={userContext}
                onChange={e => setUserContext(e.target.value)}
                style={{
                  width: '100%', minHeight: 48, padding: '8px 10px',
                  fontSize: '0.78rem', borderRadius: 6, border: '1px solid #e2e8f0',
                  resize: 'vertical', fontFamily: 'inherit',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {feasibility.needsAi && (
                <button className="rd-btn rd-btn-primary" onClick={handleAutoFit}>
                  🧠 AI Auto-Fitting
                </button>
              )}
              <button className="rd-btn rd-btn-outline" onClick={handleAnalyze}>重新分析</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
