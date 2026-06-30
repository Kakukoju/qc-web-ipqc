/**
 * AI Feasibility Analysis Routes
 *
 * After baseline equation is completed on RD mobile, this provides:
 * 1. Reference range resolution check (optical resolution vs concentration difference)
 * 2. TEa spec compliance check
 * 3. AI gateway analysis for interpretation
 * 4. AI auto-fitting (iterative optimization)
 */
import { Router } from 'express';
import { pool, queryWithRetry } from '../db/pgPool.js';

const router = Router();

const VET_LAB_URL = process.env.VET_LAB_URL || 'http://127.0.0.1:8100';
const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'http://127.0.0.1:18790';

// ─── Helpers ──────────────────────────────────────────────────────────────

function linearFit(points) {
  const valid = points.filter(p => p.conc != null && p.od != null && isFinite(p.conc) && isFinite(p.od));
  if (valid.length < 2) return null;
  const n = valid.length;
  const xMean = valid.reduce((s, p) => s + p.od, 0) / n;
  const yMean = valid.reduce((s, p) => s + p.conc, 0) / n;
  const denom = valid.reduce((s, p) => s + (p.od - xMean) ** 2, 0);
  if (denom === 0) return null;
  const slope = valid.reduce((s, p) => s + (p.od - xMean) * (p.conc - yMean), 0) / denom;
  const intercept = yMean - slope * xMean;
  const predictions = valid.map(p => slope * p.od + intercept);
  const ssTot = valid.reduce((s, p) => s + (p.conc - yMean) ** 2, 0);
  const ssRes = valid.reduce((s, p, i) => s + (p.conc - predictions[i]) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, r2, n };
}

function computeResiduals(points, fit) {
  return points
    .filter(p => p.conc != null && p.od != null)
    .map(p => {
      const predicted = fit.slope * p.od + fit.intercept;
      return { ...p, predicted, residual: p.conc - predicted };
    });
}

/**
 * Check if reference range is resolvable at given optical resolution.
 * Resolution in OD → concentration resolution = slope * optical_resolution
 * If concentration resolution > (reference_range / resolution_factor), flag it.
 */
function checkReferenceRangeResolution(slope, opticalResolution, referenceRange) {
  const concResolution = Math.abs(slope) * opticalResolution;
  const rangeSpan = referenceRange.high - referenceRange.low;
  const resolutionRatio = rangeSpan > 0 ? concResolution / rangeSpan : Infinity;
  // If concentration resolution uses more than 10% of the range, it's problematic
  const passed = resolutionRatio <= 0.1;
  return {
    passed,
    concResolution,
    rangeSpan,
    resolutionRatio,
    opticalResolution,
    message: passed
      ? `光學解析度 ${opticalResolution} OD 可解析 reference range (比率 ${(resolutionRatio * 100).toFixed(2)}%)`
      : `光學解析度 ${opticalResolution} OD 無法充分解析 reference range (比率 ${(resolutionRatio * 100).toFixed(2)}% > 10%)`,
  };
}

/**
 * Check TEa compliance: |Bias| + 2*CV <= TEa
 */
function checkTeaCompliance(points, fit, teaPercent, assignedConcs) {
  const levels = ['control-1', 'control-2', 'control-3', 'control-4'];
  const levelLabels = { 'control-1': 'L1', 'control-2': 'L2', 'control-3': 'N1', 'control-4': 'N3' };
  const results = [];

  for (const level of levels) {
    const levelPoints = points.filter(p => (p.patient_id || '').toLowerCase() === level && p.od != null);
    if (levelPoints.length === 0) continue;
    const assignedConc = assignedConcs[levelLabels[level]] || assignedConcs[level];
    if (!assignedConc || assignedConc === 0) continue;

    const fittedConcs = levelPoints.map(p => fit.slope * p.od + fit.intercept);
    const meanFitted = fittedConcs.reduce((s, v) => s + v, 0) / fittedConcs.length;
    const biasPercent = ((meanFitted - assignedConc) / assignedConc) * 100;

    let cvPercent = 0;
    if (fittedConcs.length >= 2) {
      const mean = fittedConcs.reduce((s, v) => s + v, 0) / fittedConcs.length;
      const variance = fittedConcs.reduce((s, v) => s + (v - mean) ** 2, 0) / fittedConcs.length;
      cvPercent = mean !== 0 ? (Math.sqrt(variance) / Math.abs(mean)) * 100 : 0;
    }

    const tea = Math.abs(biasPercent) + 2 * cvPercent;
    const passed = teaPercent != null ? tea <= teaPercent : null;

    results.push({
      level: levelLabels[level],
      assignedConc,
      meanFitted,
      biasPercent,
      cvPercent,
      tea,
      teaThreshold: teaPercent,
      passed,
    });
  }

  const allPassed = results.every(r => r.passed !== false);
  return { passed: allPassed, levels: results };
}

// ─── POST /ai-feasibility-analysis ────────────────────────────────────────

router.post('/ai-feasibility-analysis', async (req, res) => {
  try {
    const {
      points,          // Array of { patient_id, conc, od/final_delta_od }
      equation,        // Current equation string
      slope,
      intercept,
      r2,
      analyze_item,    // Marker name
      optical_resolution = 0.001,  // Default 0.001 OD
      assigned_concs,  // { L1: x, L2: x, N1: x, N3: x }
    } = req.body;

    if (!points || !Array.isArray(points) || points.length < 2) {
      return res.status(400).json({ ok: false, error: 'points array with at least 2 items required' });
    }

    // Normalize points
    const normalizedPoints = points.map(p => ({
      ...p,
      od: p.od ?? p.final_delta_od ?? null,
      conc: p.conc ?? null,
    }));

    // Use provided slope/intercept or recompute
    let fit = slope != null && intercept != null
      ? { slope, intercept, r2: r2 || 0, n: normalizedPoints.length }
      : linearFit(normalizedPoints);

    if (!fit) {
      return res.status(422).json({ ok: false, error: 'Cannot compute linear fit from provided points' });
    }

    // 1. Fetch reference range from vet-lab catalog
    let referenceRange = null;
    let teaPercent = null;
    let clinicalSpec = null;

    if (analyze_item) {
      try {
        const specResp = await fetch(
          `${VET_LAB_URL}/api/vet-lab/clinical-analyte-specs?q=${encodeURIComponent(analyze_item)}`
        );
        if (specResp.ok) {
          const specs = await specResp.json();
          // Find spec with tea_percent: prefer CLIA with tea_percent, then any with tea_percent
          const withTeaPct = specs.filter(s => s.tea_percent != null && s.tea_percent > 0);
          if (withTeaPct.length > 0) {
            clinicalSpec = withTeaPct[0];
            teaPercent = clinicalSpec.tea_percent;
          } else if (specs.length > 0) {
            clinicalSpec = specs[0];
            // For absolute TEa mode, we can't easily convert without knowing concentration
            teaPercent = null;
          }
          if (clinicalSpec && clinicalSpec.reportable_min != null && clinicalSpec.reportable_max != null) {
            referenceRange = { low: clinicalSpec.reportable_min, high: clinicalSpec.reportable_max };
          }
        }
      } catch (e) {
        console.warn('[AI Feasibility] vet-lab spec lookup failed:', e.message);
      }
    }

    // 2. Reference range resolution check
    let resolutionCheck = null;
    if (referenceRange && fit.slope) {
      resolutionCheck = checkReferenceRangeResolution(fit.slope, optical_resolution, referenceRange);
    }

    // 3. TEa compliance check
    let teaCheck = null;
    if (assigned_concs && teaPercent != null) {
      teaCheck = checkTeaCompliance(normalizedPoints, fit, teaPercent, assigned_concs);
    }

    // 4. Compute residuals
    const residuals = computeResiduals(normalizedPoints, fit);

    // 5. Determine if AI analysis is needed
    const needsAi = (resolutionCheck && !resolutionCheck.passed) ||
                    (teaCheck && !teaCheck.passed);

    let aiAnalysis = null;
    if (needsAi) {
      try {
        const aiPayload = {
          deterministicResult: {
            decision: teaCheck && !teaCheck.passed ? 'FAIL' : 'WARNING',
            failures: [],
            warnings: [],
          },
          context: {
            analyte: analyze_item || 'Unknown',
            unit: clinicalSpec?.unit || '',
            clinicalReferenceSnapshot: referenceRange ? {
              reference_interval_low: referenceRange.low,
              reference_interval_high: referenceRange.high,
            } : {},
          },
          baseline: {
            equationType: 'linear',
            slope: fit.slope,
            intercept: fit.intercept,
            r2: fit.r2,
          },
          levelSummary: teaCheck ? teaCheck.levels.map(l => ({
            targetConc: l.assignedConc,
            observedTeAbs: l.tea,
            allowableTeAbs: l.teaThreshold,
            resolutionAbs: Math.abs(fit.slope) * optical_resolution,
            decision: l.passed ? 'PASS' : 'FAIL',
            reasons: l.passed ? [] : ['TEa fail'],
          })) : [],
          rawData: residuals.map(r => ({
            sampleName: r.patient_id,
            targetConc: r.conc,
            observedOd: r.od,
            predictedConc: r.predicted,
            errorAbs: Math.abs(r.residual),
            allowableTeAbs: teaPercent && r.conc ? Math.abs(r.conc * teaPercent / 100) : null,
          })),
        };

        const aiResp = await fetch(`${VET_LAB_URL}/api/vet-lab/ai-qc-analysis`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload: aiPayload }),
        });
        if (aiResp.ok) {
          aiAnalysis = await aiResp.json();
        }
      } catch (e) {
        console.warn('[AI Feasibility] AI analysis call failed:', e.message);
      }
    }

    res.json({
      ok: true,
      data: {
        fit: { slope: fit.slope, intercept: fit.intercept, r2: fit.r2, n: fit.n },
        resolutionCheck,
        teaCheck,
        clinicalSpec,
        residuals: residuals.map(r => ({ ...r, absResidual: Math.abs(r.residual) })),
        needsAi,
        aiAnalysis,
      },
    });
  } catch (err) {
    console.error('[AI Feasibility] Error:', err);
    res.status(500).json({ ok: false, error: { code: 'AI_FEASIBILITY_ERROR', message: err.message } });
  }
});

// ─── POST /ai-auto-fit ────────────────────────────────────────────────────

router.post('/ai-auto-fit', async (req, res) => {
  try {
    const {
      points,
      analyze_item,
      optical_resolution = 0.001,
      assigned_concs,
      max_iterations = 5,
    } = req.body;

    if (!points || !Array.isArray(points) || points.length < 3) {
      return res.status(400).json({ ok: false, error: 'At least 3 points required for auto-fit' });
    }

    // Normalize points
    let activePoints = points.map((p, idx) => ({
      idx,
      patient_id: p.patient_id || `P${idx + 1}`,
      conc: p.conc ?? null,
      od: p.od ?? p.final_delta_od ?? null,
    })).filter(p => p.conc != null && p.od != null && isFinite(p.conc) && isFinite(p.od));

    // Fetch TEa spec
    let teaPercent = null;
    let clinicalSpec = null;
    if (analyze_item) {
      try {
        const specResp = await fetch(
          `${VET_LAB_URL}/api/vet-lab/clinical-analyte-specs?q=${encodeURIComponent(analyze_item)}`
        );
        if (specResp.ok) {
          const specs = await specResp.json();
          const withTeaPct = specs.filter(s => s.tea_percent != null && s.tea_percent > 0);
          if (withTeaPct.length > 0) {
            clinicalSpec = withTeaPct[0];
            teaPercent = clinicalSpec.tea_percent;
          }
        }
      } catch { /* continue without spec */ }
    }

    const iterations = [];
    let removedIndices = [];
    let bestFit = null;
    let bestTeaCheck = null;
    let converged = false;

    for (let iter = 0; iter < max_iterations; iter++) {
      const currentPoints = activePoints.filter(p => !removedIndices.includes(p.idx));
      if (currentPoints.length < 2) break;

      const fit = linearFit(currentPoints);
      if (!fit) break;
      bestFit = fit;

      // Check TEa
      let teaCheck = null;
      if (assigned_concs && teaPercent != null) {
        teaCheck = checkTeaCompliance(currentPoints, fit, teaPercent, assigned_concs);
        bestTeaCheck = teaCheck;
      }

      // Compute residuals
      const residuals = computeResiduals(currentPoints, fit);
      const maxResidual = Math.max(...residuals.map(r => Math.abs(r.residual)));

      const iterResult = {
        iteration: iter + 1,
        fit: { slope: fit.slope, intercept: fit.intercept, r2: fit.r2, n: fit.n },
        teaCheck,
        maxResidual,
        removedIndices: [...removedIndices],
        pointCount: currentPoints.length,
      };

      // If TEa passes or R² is very high, we're done
      if (teaCheck && teaCheck.passed && fit.r2 >= 0.995) {
        iterResult.action = 'converged';
        iterResult.message = 'TEa 符合規格且 R² >= 0.995';
        iterations.push(iterResult);
        converged = true;
        break;
      }

      // Ask AI for next action
      let aiAction = null;
      try {
        const prompt = buildAutoFitPrompt(currentPoints, fit, residuals, teaCheck, teaPercent, optical_resolution, iter);
        const aiResp = await fetch(`${AI_GATEWAY_URL}/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system: 'You are a QC curve-fitting optimization assistant. Respond with JSON only.',
            message: prompt,
            maxTokens: 800,
            temperature: 0.0,
          }),
        });
        if (aiResp.ok) {
          const aiData = await aiResp.json();
          aiAction = parseAiAction(aiData.text, residuals);
        }
      } catch (e) {
        console.warn('[AI Auto-Fit] AI call failed:', e.message);
      }

      if (!aiAction || aiAction.action === 'stop') {
        iterResult.action = 'stop';
        iterResult.message = aiAction?.reason || 'AI 建議停止 (無法進一步優化)';
        iterations.push(iterResult);
        break;
      }

      // Execute AI action
      if (aiAction.action === 'remove_outliers' && aiAction.indices?.length > 0) {
        const toRemove = aiAction.indices.filter(i => !removedIndices.includes(i));
        removedIndices = [...removedIndices, ...toRemove];
        iterResult.action = 'remove_outliers';
        iterResult.message = `移除 ${toRemove.length} 個離差點: ${toRemove.join(', ')}`;
        iterResult.aiReason = aiAction.reason;
      } else {
        iterResult.action = 'no_action';
        iterResult.message = aiAction.reason || '無可執行動作';
      }

      iterations.push(iterResult);
    }

    // Final equation
    const finalPoints = activePoints.filter(p => !removedIndices.includes(p.idx));
    const finalFit = linearFit(finalPoints) || bestFit;
    const finalEquation = finalFit
      ? `conc = ${finalFit.slope.toFixed(10)} * OD + ${finalFit.intercept.toFixed(10)}; R² = ${finalFit.r2.toFixed(6)}; n = ${finalFit.n}`
      : null;

    res.json({
      ok: true,
      data: {
        converged,
        iterations,
        finalFit: finalFit,
        finalEquation,
        removedIndices,
        finalPointCount: finalPoints.length,
        originalPointCount: activePoints.length,
        teaCheck: bestTeaCheck,
        clinicalSpec,
      },
    });
  } catch (err) {
    console.error('[AI Auto-Fit] Error:', err);
    res.status(500).json({ ok: false, error: { code: 'AI_AUTO_FIT_ERROR', message: err.message } });
  }
});

function buildAutoFitPrompt(points, fit, residuals, teaCheck, teaPercent, opticalResolution, iteration) {
  const sortedResiduals = [...residuals].sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));
  const top3 = sortedResiduals.slice(0, 3);

  let teaInfo = '';
  if (teaCheck) {
    const failedLevels = teaCheck.levels.filter(l => l.passed === false);
    teaInfo = failedLevels.length > 0
      ? `TEa FAIL levels: ${failedLevels.map(l => `${l.level} (TEa=${l.tea.toFixed(2)}% > ${l.teaThreshold}%)`).join(', ')}`
      : 'TEa: all levels PASS';
  }

  return `Iteration ${iteration + 1}. Curve fit optimization for baseline calibration.

Current fit: slope=${fit.slope.toFixed(6)}, intercept=${fit.intercept.toFixed(6)}, R²=${fit.r2.toFixed(6)}, n=${fit.n}
Optical resolution: ${opticalResolution} OD
TEa threshold: ${teaPercent || 'unknown'}%
${teaInfo}

Top residuals (idx, patient_id, residual):
${top3.map(r => `  idx=${r.idx}, ${r.patient_id}, conc=${r.conc?.toFixed(2)}, od=${r.od?.toFixed(6)}, residual=${r.residual.toFixed(4)}`).join('\n')}

All point indices: ${points.map(p => p.idx).join(', ')}
Already removed: none from this iteration's active set.

Decide: should I remove outlier points to improve TEa compliance and R²?
Respond with JSON: {"action":"remove_outliers","indices":[...],"reason":"..."} or {"action":"stop","reason":"..."}
Rules:
- Only remove points with large residuals that hurt TEa compliance
- Never remove more than 2 points per iteration
- Stop if R² >= 0.999 or if removing points won't help TEa
- Stop if fewer than 4 points would remain after removal`;
}

function parseAiAction(text, residuals) {
  if (!text) return { action: 'stop', reason: 'No AI response' };
  try {
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { action: 'stop', reason: 'AI response not parseable' };
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.action === 'remove_outliers' && Array.isArray(parsed.indices)) {
      // Validate indices exist in residuals
      const validIndices = parsed.indices.filter(i =>
        residuals.some(r => r.idx === i)
      ).slice(0, 2); // max 2 per iteration
      if (validIndices.length === 0) return { action: 'stop', reason: parsed.reason || 'No valid indices to remove' };
      return { action: 'remove_outliers', indices: validIndices, reason: parsed.reason };
    }
    return { action: parsed.action || 'stop', reason: parsed.reason || '' };
  } catch {
    return { action: 'stop', reason: 'Failed to parse AI response' };
  }
}

// ─── GET /vetlab-spec/:analyzeItem ────────────────────────────────────────
// Unified spec lookup using vet-lab catalog DB.
// Priority: CLIA → EFLM-BV → Species References → Analyzer catalog

function normalizeQbiMarker(name) {
  let s = (name || '').trim();
  if (/^[Qq]bi[-_]/.test(s)) s = s.replace(/^[Qq]bi[-_]/, '');
  else if (/^Q[A-Za-z]/.test(s)) s = s.slice(1);
  s = s.split(/[-_]/)[0];
  return s.toUpperCase();
}

async function fetchDynamicOdRanges(analyzeItem) {
  // Normalize to standard code (e.g. QGGT-AD → GGT)
  const normalized = normalizeQbiMarker(analyzeItem);
  const searchTerm = normalized || analyzeItem;
  try {
    const result = await queryWithRetry(`
      SELECT patient_id,
             CAST(NULLIF(TRIM(final_delta_od), '') AS DOUBLE PRECISION) AS od
      FROM panel_production.assay_process_records
      WHERE baseline = 'true'
        AND UPPER(TRIM(analyze_item)) = UPPER($1)
        AND LOWER(COALESCE(patient_id, '')) IN ('control-1','control-2','control-3','control-4')
        AND NULLIF(TRIM(final_delta_od), '') IS NOT NULL
    `, [searchTerm]);

    const LEVEL_MAP = { 'control-1': 'L1', 'control-2': 'L2', 'control-3': 'N1', 'control-4': 'N3' };
    const data = { L1: [], L2: [], N1: [], N3: [] };
    for (const row of result.rows) {
      const level = LEVEL_MAP[(row.patient_id || '').toLowerCase()];
      if (level && row.od != null && isFinite(row.od)) data[level].push(row.od);
    }

    function quartiles(values) {
      if (values.length < 2) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const n = sorted.length;
      const q1Idx = (n - 1) * 0.25;
      const q3Idx = (n - 1) * 0.75;
      const q1 = sorted[Math.floor(q1Idx)] + (q1Idx % 1) * (sorted[Math.ceil(q1Idx)] - sorted[Math.floor(q1Idx)]);
      const q3 = sorted[Math.floor(q3Idx)] + (q3Idx % 1) * (sorted[Math.ceil(q3Idx)] - sorted[Math.floor(q3Idx)]);
      return `${q1.toFixed(3)} - ${q3.toFixed(3)}`;
    }

    return {
      spec_l1_od: quartiles(data.L1),
      spec_l2_od: quartiles(data.L2),
      spec_n1_od: quartiles(data.N1),
      spec_n3_od: quartiles(data.N3),
    };
  } catch {
    return { spec_l1_od: null, spec_l2_od: null, spec_n1_od: null, spec_n3_od: null };
  }
}

const SPEC_ALIASES = { PHOS: ['P','PHOS'], P: ['P','PHOS'], TRIG: ['TG','TRIG'], TG: ['TG','TRIG'], CHOL: ['CHOL','TC'], TC: ['TC','CHOL'], CREA: ['CREA','CRE'], CRE: ['CRE','CREA'] };

router.get('/vetlab-spec/:analyzeItem', async (req, res) => {
  try {
    const analyzeItem = (req.params.analyzeItem || '').trim();
    if (!analyzeItem) return res.json({ ok: false, spec: null });

    const upper = analyzeItem.toUpperCase();
    const normalized = normalizeQbiMarker(analyzeItem);
    const candidates = [upper, normalized, analyzeItem];
    if (SPEC_ALIASES[upper]) candidates.push(...SPEC_ALIASES[upper]);
    if (SPEC_ALIASES[normalized]) candidates.push(...SPEC_ALIASES[normalized]);
    const uniqueCandidates = [...new Set(candidates)];

    // Collect ALL specs from all sources, then pick the one with minimum TEa
    const allSpecs = [];

    for (const candidate of uniqueCandidates) {
      try {
        const resp = await fetch(`${VET_LAB_URL}/api/vet-lab/clinical-analyte-specs?q=${encodeURIComponent(candidate)}`);
        if (!resp.ok) continue;
        const specs = await resp.json();
        for (const s of specs) {
          if (s.tea_percent != null && s.tea_percent > 0) {
            allSpecs.push(s);
          }
        }
      } catch { /* try next */ }
    }

    // Try species references via catalog
    try {
      const resp = await fetch(`${VET_LAB_URL}/api/catalog/analytes?species=Dog`);
      if (resp.ok) {
        const analytes = await resp.json();
        for (const candidate of uniqueCandidates) {
          const match = analytes.find(a => (a.analyte_name || '').toUpperCase() === candidate);
          if (match && match.clinical_tea_goal) {
            allSpecs.push({
              analyte_code: candidate,
              analyte_name: match.analyte_name,
              source_code: `Species Ref (${match.tea_source || 'ASVCP'})`,
              tea_percent: match.clinical_tea_goal,
              precision_cv_pct_limit: null,
              bias_pct_limit: null,
            });
          }
        }
      }
    } catch { /* ignore */ }

    // Try analyzer catalog
    try {
      const resp = await fetch(`${VET_LAB_URL}/api/catalog/analyzers`);
      if (resp.ok) {
        const analyzers = await resp.json();
        for (const analyzer of analyzers) {
          for (const spec of (analyzer.analyte_specs || [])) {
            const specName = (spec.analyte_name || '').toUpperCase();
            if (uniqueCandidates.includes(specName) && spec.tae_percent > 0) {
              allSpecs.push({
                analyte_code: specName,
                analyte_name: spec.analyte_name,
                source_code: `Analyzer: ${analyzer.manufacturer} ${analyzer.model_name}`,
                tea_percent: spec.tae_percent,
                precision_cv_pct_limit: spec.cv_percent,
                bias_pct_limit: null,
              });
            }
          }
        }
      }
    } catch { /* ignore */ }

    if (allSpecs.length === 0) {
      return res.json({ ok: true, p01: null, qbi: null });
    }

    // Priority: CLIA first. If no CLIA, pick the minimum TEa from remaining sources.
    const cliaSpec = allSpecs.find(s => s.source_code === 'CLIA');
    let best;
    if (cliaSpec) {
      best = cliaSpec;
    } else {
      allSpecs.sort((a, b) => a.tea_percent - b.tea_percent);
      best = allSpecs[0];
    }
    const tea = best.tea_percent;
    const cv = best.precision_cv_pct_limit || (tea ? tea / 4 : null);
    const bias = best.bias_pct_limit || (tea ? tea / 3 : null);

    // Fetch dynamic OD Q1/Q3 ranges for this marker
    const odRanges = await fetchDynamicOdRanges(analyzeItem);

    return res.json({
      ok: true,
      p01: null,
      qbi: {
        id: 0, source: best.source_code, source_file: null,
        marker: best.analyte_code || analyzeItem,
        pn: null,
        tea: tea != null ? `${tea}%` : null,
        single_cv: cv != null ? `≤${cv.toFixed(1)}%` : null,
        merge_bias: bias != null ? `≤±${bias.toFixed(1)}%` : null,
        spec_l1_od: odRanges.spec_l1_od,
        spec_l2_od: odRanges.spec_l2_od,
        spec_n1_od: odRanges.spec_n1_od,
        spec_n3_od: odRanges.spec_n3_od,
        well_config: null, dilution: null, calc_method: null,
        merge_cv: null, remarks: `min TEa from ${allSpecs.length} sources`, updated_at: null,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
