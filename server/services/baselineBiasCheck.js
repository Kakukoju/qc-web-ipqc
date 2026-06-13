import specDb from '../db/specDb.js';

function normalize(value) {
  return String(value || '').toUpperCase().replace(/^Q/, '').replace(/[^A-Z0-9]/g, '');
}

function markerTokens(value) {
  return String(value || '')
    .split(/[,/、]|(?:\s+含\s*)/i)
    .map(normalize)
    .filter(Boolean);
}

export function findMergeBiasSpec(analyzeItem) {
  const target = normalize(analyzeItem);
  if (!target) return null;
  const rows = specDb.prepare(`
    SELECT id, marker, merge_bias FROM bead_ipqc_spec
    WHERE merge_bias IS NOT NULL AND TRIM(merge_bias) <> ''
  `).all();
  const ranked = rows.map(row => {
    const tokens = markerTokens(row.marker);
    let score = 0;
    for (const token of tokens) {
      if (token === target) score = Math.max(score, 1000 + token.length);
      else if (token.includes(target) || target.includes(token)) score = Math.max(score, token.length);
    }
    return { ...row, score };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score);
  return ranked[0] || null;
}

export function parseMergeBiasSpec(text) {
  const source = String(text || '').replace(/\r?\n/g, ';');
  const metric = /OD\s*\.?\s*Bias/i.test(source) ? 'od' : 'concentration';
  const rules = [];
  const levelPattern = /([LN]\d)[^;]*?[<≤]\s*[±]?\s*([\d.]+)\s*(%|[a-zA-Z/]+)?/gi;
  let match;
  while ((match = levelPattern.exec(source))) {
    rules.push({
      level: match[1].toUpperCase(),
      limit: Number(match[2]),
      mode: match[3] === '%' ? 'percent' : 'absolute',
    });
  }
  if (!rules.length) {
    const simple = source.match(/[<≤]\s*[±]?\s*([\d.]+)\s*(%|[a-zA-Z/]+)?/i);
    if (simple) {
      rules.push({
        level: 'default',
        limit: Number(simple[1]),
        mode: simple[2] === '%' ? 'percent' : 'absolute',
      });
    }
  }
  return { metric, rules };
}

function pointLevel(point) {
  const value = String(point.patient_id || point.level || '').toUpperCase();
  const match = value.match(/(?:CONTROL[-_\s]*)?([LN]\d)/);
  if (match) return match[1];
  const control = value.match(/CONTROL[-_\s]*(\d)/);
  return control ? ({ 1: 'L1', 2: 'L2', 3: 'N1', 4: 'N3' }[control[1]] || 'default') : 'default';
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function checkBaselineBias({ analyzeItem, slope, intercept, points }) {
  const specRow = findMergeBiasSpec(analyzeItem);
  if (!specRow) {
    return { pass: false, reasons: [`找不到 ${analyzeItem} 的 merge_bias 規格`], points: [] };
  }
  const parsedSpec = parseMergeBiasSpec(specRow.merge_bias);
  if (!parsedSpec.rules.length) {
    return { pass: false, spec: specRow, reasons: [`無法解析 merge_bias：${specRow.merge_bias}`], points: [] };
  }
  const m = finiteNumber(slope);
  const b = finiteNumber(intercept);
  if (m === null || b === null || m === 0) {
    return { pass: false, spec: specRow, reasons: ['擬合曲線 slope/intercept 無效'], points: [] };
  }

  const results = [];
  for (const point of points || []) {
    const od = finiteNumber(point.final_delta_od ?? point.od ?? point.y);
    const expectedConc = finiteNumber(point.conc ?? point.concentration ?? point.x);
    if (od === null || expectedConc === null) continue;
    const level = pointLevel(point);
    const rule = parsedSpec.rules.find(item => item.level === level)
      || parsedSpec.rules.find(item => item.level === 'default');
    if (!rule) {
      results.push({ level, od, expected_concentration: expectedConc, pass: false, reason: `${level} 無對應規格` });
      continue;
    }

    const predictedOd = m * expectedConc + b;
    const calculatedConc = (od - b) / m;
    const delta = parsedSpec.metric === 'od' ? Math.abs(od - predictedOd) : Math.abs(calculatedConc - expectedConc);
    const denominator = parsedSpec.metric === 'od' ? Math.abs(predictedOd) : Math.abs(expectedConc);
    const measured = rule.mode === 'percent'
      ? (denominator === 0 ? Number.POSITIVE_INFINITY : delta / denominator * 100)
      : delta;
    results.push({
      level,
      patient_id: point.patient_id || null,
      od,
      expected_concentration: expectedConc,
      calculated_concentration: calculatedConc,
      predicted_od: predictedOd,
      bias: measured,
      limit: rule.limit,
      mode: rule.mode,
      metric: parsedSpec.metric,
      pass: measured < rule.limit,
    });
  }

  const reasons = results.filter(item => !item.pass).map(item => {
    const suffix = item.mode === 'percent' ? '%' : '';
    return `${item.level} bias ${Number(item.bias).toFixed(3)}${suffix} 未小於 ${item.limit}${suffix}`;
  });
  if (!results.length) reasons.push('沒有可判讀的 OD/濃度測試點');
  return {
    pass: results.length > 0 && results.every(item => item.pass),
    analyze_item: analyzeItem,
    spec_marker: specRow.marker,
    merge_bias_spec: specRow.merge_bias,
    metric: parsedSpec.metric,
    equation: { slope: m, intercept: b },
    points: results,
    reasons,
  };
}
