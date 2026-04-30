import type { SpecRow } from '../api/spec';

interface LevelThreshold {
  default?: number;
  L1?: number;
  L2?: number;
  N1?: number;
  N3?: number;
  L3?: number;
}

interface SpecRange {
  min: number;
  max: number;
}

export function parseSpecThresholds(text: string | null | undefined): LevelThreshold | null {
  if (!text) return null;

  const result: LevelThreshold = {};
  const s = text.replace(/\r\n/g, ';').replace(/\n/g, ';');

  const levelRe = /([LN]\d)\s*(?:CV\s*)?[<≤]\s*[±]?\s*([\d.]+)\s*%/gi;
  let m: RegExpExecArray | null;
  let hasLevel = false;
  while ((m = levelRe.exec(s)) !== null) {
    const lv = m[1].toUpperCase() as keyof LevelThreshold;
    result[lv] = parseFloat(m[2]) / 100;
    hasLevel = true;
  }
  if (hasLevel) return result;

  const simpleRe = /[<≤]\s*[±]?\s*([\d.]+)\s*%/;
  const sm = simpleRe.exec(s);
  if (sm) {
    result.default = parseFloat(sm[1]) / 100;
    return result;
  }

  return null;
}

export function parseSpecRange(text: string | null | undefined): SpecRange | null {
  if (!text) return null;
  const m = String(text).match(/([\d.]+)\s*[-~]\s*([\d.]+)/);
  if (!m) return null;

  const min = parseFloat(m[1]);
  const max = parseFloat(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  return min <= max ? { min, max } : { min: max, max: min };
}

function getThreshold(th: LevelThreshold | null, level: string): number | null {
  if (!th) return null;
  const lv = level.toUpperCase() as keyof LevelThreshold;
  if (th[lv] !== undefined) return th[lv]!;
  if (th.default !== undefined) return th.default;
  return null;
}

interface MeasuredValues {
  od_mean_l1?: string | null;
  od_mean_l2?: string | null;
  od_mean_n1?: string | null;
  od_cv_l1?: string | null;
  od_cv_l2?: string | null;
  od_cv_n1?: string | null;
  od_cv_n3?: string | null;
  rconc_cv_l1?: string | null;
  rconc_cv_l2?: string | null;
  rconc_cv_l3?: string | null;
  rconc_cv_n1?: string | null;
  rconc_cv_n3?: string | null;
  mean_bias_l1?: string | null;
  mean_bias_l2?: string | null;
  mean_bias_l3?: string | null;
  total_cv_l1?: string | null;
  total_cv_l2?: string | null;
  total_cv_l3?: string | null;
  initial_l3?: string | null;
}

function num(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function checkWithinSpec(value: number | null, threshold: number | null): boolean | null {
  if (value === null || threshold === null) return null;
  return Math.abs(value) <= threshold;
}

function checkWithinRange(value: number | null, range: SpecRange | null): boolean | null {
  if (value === null || range === null) return null;
  return value >= range.min && value <= range.max;
}

export interface JudgmentResult {
  batchPass: boolean | null;
  mergePass: boolean | null;
  finalPass: boolean | null;
  batchLabel: string;
  mergeLabel: string;
  finalLabel: string;
  details: string[];
}

export function judgeRecord(rec: MeasuredValues, spec: SpecRow | null): JudgmentResult {
  const details: string[] = [];

  if (!spec) {
    return {
      batchPass: null,
      mergePass: null,
      finalPass: null,
      batchLabel: '—',
      mergeLabel: '—',
      finalLabel: '—',
      details: ['Spec not found'],
    };
  }

  const cvTh = parseSpecThresholds(spec.single_cv);
  const biasTh = parseSpecThresholds(spec.merge_bias);
  const mergeCvTh = parseSpecThresholds(spec.merge_cv);
  const odRanges = {
    L1: parseSpecRange(spec.spec_l1_od),
    L2: parseSpecRange(spec.spec_l2_od),
    N1: parseSpecRange(spec.spec_n1_od),
  };
  const l3ConcRange = parseSpecRange(spec.spec_l3);

  const batchChecks: boolean[] = [];

  for (const [lv, field] of [['L1', 'od_mean_l1'], ['L2', 'od_mean_l2'], ['N1', 'od_mean_n1']] as const) {
    const val = num(rec[field]);
    const ok = checkWithinRange(val, odRanges[lv]);
    if (ok !== null) {
      batchChecks.push(ok);
      details.push(`OD Mean ${lv}: ${val!.toFixed(4)} ${ok ? 'in' : 'out of'} range ${odRanges[lv]!.min}-${odRanges[lv]!.max}`);
    }
  }

  // L3 concentration range check (uses all_batch conc mean)
  const l3Mean = num(rec.initial_l3);
  const l3RangeOk = checkWithinRange(l3Mean, l3ConcRange);
  if (l3RangeOk !== null) {
    batchChecks.push(l3RangeOk);
    details.push(`Conc L3: ${l3Mean!.toFixed(2)} ${l3RangeOk ? 'in' : 'out of'} range ${l3ConcRange!.min}-${l3ConcRange!.max}`);
  }

  for (const [lv, field] of [['L1', 'od_cv_l1'], ['L2', 'od_cv_l2'], ['N1', 'od_cv_n1'], ['N3', 'od_cv_n3']] as const) {
    const val = num(rec[field]);
    if (val === null) continue;
    const th = getThreshold(cvTh, lv);
    const ok = checkWithinSpec(val, th);
    if (ok !== null) {
      batchChecks.push(ok);
      details.push(`OD CV ${lv}: ${(val * 100).toFixed(1)}% ${ok ? '<=' : '>'} ${(th! * 100).toFixed(1)}%`);
    }
  }

  for (const [lv, field] of [['L1', 'rconc_cv_l1'], ['L2', 'rconc_cv_l2'], ['L3', 'rconc_cv_l3'], ['N1', 'rconc_cv_n1'], ['N3', 'rconc_cv_n3']] as const) {
    const val = num(rec[field]);
    if (val === null) continue;
    const th = getThreshold(cvTh, lv);
    const ok = checkWithinSpec(val, th);
    if (ok !== null) {
      batchChecks.push(ok);
      details.push(`Conc CV ${lv}: ${(val * 100).toFixed(1)}% ${ok ? '<=' : '>'} ${(th! * 100).toFixed(1)}%`);
    }
  }

  for (const [lv, field] of [['L1', 'mean_bias_l1'], ['L2', 'mean_bias_l2'], ['L3', 'mean_bias_l3']] as const) {
    const val = num(rec[field]);
    if (val === null) continue;
    const th = getThreshold(biasTh, lv);
    const ok = checkWithinSpec(val, th);
    if (ok !== null) {
      batchChecks.push(ok);
      details.push(`Bias ${lv}: ${(Math.abs(val) * 100).toFixed(1)}% ${ok ? '<=' : '>'} ${(th! * 100).toFixed(1)}%`);
    }
  }

  const batchPass = batchChecks.length > 0 ? batchChecks.every(Boolean) : null;

  let mergePass: boolean | null = null;
  if (batchPass === true) {
    const mergeChecks: boolean[] = [];
    for (const [lv, field] of [['L1', 'total_cv_l1'], ['L2', 'total_cv_l2'], ['L3', 'total_cv_l3']] as const) {
      const val = num(rec[field]);
      if (val === null) continue;
      const th = getThreshold(mergeCvTh, lv);
      const ok = checkWithinSpec(val, th);
      if (ok !== null) {
        mergeChecks.push(ok);
        details.push(`Total CV ${lv}: ${(val * 100).toFixed(1)}% ${ok ? '<=' : '>'} ${(th! * 100).toFixed(1)}%`);
      }
    }
    mergePass = mergeChecks.length > 0 ? mergeChecks.every(Boolean) : null;
  } else if (batchPass === false) {
    mergePass = false;
    details.push('Batch criteria failed, merge rejected');
  }

  let finalPass: boolean | null = null;
  if (batchPass !== null) {
    if (batchPass && mergePass === true) finalPass = true;
    else if (batchPass && mergePass === null) finalPass = true;
    else finalPass = false;
  }

  return {
    batchPass,
    mergePass,
    finalPass,
    batchLabel: batchPass === null ? '—' : batchPass ? 'PASS' : 'FAIL',
    mergeLabel: mergePass === null ? '—' : mergePass ? '可併' : '不可併',
    finalLabel: finalPass === null ? '—' : finalPass ? 'Accept' : 'Fail',
    details,
  };
}
