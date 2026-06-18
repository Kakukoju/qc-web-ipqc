export type EquationDirection = 'forward_od_to_conc' | 'reverse_conc_to_od';
export type CurveModel = 'linear' | 'quadratic' | 'natural_log';
export type FitStrategy = 'full_range' | 'weighted_near_target' | 'local_near_cutoff';

export interface CurvePoint {
  idx: number;
  od: number;
  conc: number;
  label: string;
  well: string;
}

export interface CurveFitOptions {
  equationDirection: EquationDirection;
  curveModel: CurveModel;
  fitStrategy: FitStrategy;
  referenceConc: number;
  localRange?: [number, number];
}

export interface CurveFitResult {
  coefficients: number[];
  r2: number;
  usedPointIndices: number[];
  predict: (x: number) => number;
  formulaText: string;
  equation: string;
  xLabel: 'OD' | 'Conc';
  yLabel: 'Conc' | 'OD';
}

const EPSILON = 1e-12;

export const DIRECTION_LABELS: Record<EquationDirection, string> = {
  forward_od_to_conc: '正算 f(OD)=conc',
  reverse_conc_to_od: '反算 f(conc)=OD',
};

export const DIRECTION_METADATA_LABELS: Record<EquationDirection, string> = {
  forward_od_to_conc: 'f(OD)=conc',
  reverse_conc_to_od: 'f(conc)=OD',
};

export const MODEL_LABELS: Record<CurveModel, string> = {
  linear: 'Linear',
  quadratic: 'Quadratic',
  natural_log: 'Natural Log',
};

export const STRATEGY_LABELS: Record<FitStrategy, string> = {
  full_range: 'Full Range',
  weighted_near_target: 'Weighted Near Target',
  local_near_cutoff: 'Local Near',
};

export function formulaText(direction: EquationDirection, model: CurveModel) {
  const output = direction === 'forward_od_to_conc' ? 'conc' : 'OD';
  const input = direction === 'forward_od_to_conc' ? 'OD' : 'conc';
  if (model === 'quadratic') return `${output} = a * ${input}^2 + b * ${input} + c`;
  if (model === 'natural_log') return `${output} = a * ln(${input}) + b`;
  return `${output} = a * ${input} + b`;
}

export function inferReferenceConc(points: CurvePoint[], fitData?: Record<string, unknown> | null) {
  const candidates = [
    fitData?.target_conc,
    fitData?.target_concentration,
    fitData?.cutoff,
    fitData?.cut_off,
    fitData?.cutoff_conc,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value)) return value;
  }
  const concs = points.map(point => point.conc).sort((a, b) => a - b);
  if (concs.length === 0) return 0;
  const middle = Math.floor(concs.length / 2);
  return concs.length % 2 === 0 ? (concs[middle - 1] + concs[middle]) / 2 : concs[middle];
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const n = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < EPSILON) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let j = column; j <= n; j += 1) augmented[column][j] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let j = column; j <= n; j += 1) {
        augmented[row][j] -= factor * augmented[column][j];
      }
    }
  }
  return augmented.map(row => row[n]);
}

function polynomialFit(xs: number[], ys: number[], weights: number[], degree: 1 | 2) {
  const size = degree + 1;
  const matrix = Array.from({ length: size }, () => Array(size).fill(0) as number[]);
  const vector = Array(size).fill(0) as number[];
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      matrix[row][column] = xs.reduce(
        (sum, x, index) => sum + weights[index] * x ** (row + column),
        0,
      );
    }
    vector[row] = xs.reduce(
      (sum, x, index) => sum + weights[index] * ys[index] * x ** row,
      0,
    );
  }
  return solveLinearSystem(matrix, vector);
}

function strategySelection(points: CurvePoint[], options: CurveFitOptions, minimumPoints: number) {
  if (options.fitStrategy !== 'local_near_cutoff') return points;
  if (options.localRange) {
    const [first, second] = options.localRange;
    return points.filter(point => (
      Math.abs(point.conc - first) < EPSILON
      || Math.abs(point.conc - second) < EPSILON
    ));
  }
  const count = Math.min(points.length, Math.max(minimumPoints, Math.ceil(points.length / 2)));
  return [...points]
    .sort((a, b) => Math.abs(a.conc - options.referenceConc) - Math.abs(b.conc - options.referenceConc))
    .slice(0, count)
    .sort((a, b) => a.idx - b.idx);
}

function strategyWeights(points: CurvePoint[], options: CurveFitOptions) {
  if (options.fitStrategy !== 'weighted_near_target') return points.map(() => 1);
  const distances = points.map(point => Math.abs(point.conc - options.referenceConc));
  const positiveDistances = distances.filter(distance => distance > EPSILON).sort((a, b) => a - b);
  const scale = positiveDistances[0]
    || Math.max(...points.map(point => Math.abs(point.conc)), 1);
  return distances.map(distance => 1 / (1 + (distance / scale) ** 2));
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return 'N/A';
  return Number(value.toPrecision(8)).toString();
}

export function fitCurve(points: CurvePoint[], options: CurveFitOptions): CurveFitResult | null {
  const minimumPoints = options.curveModel === 'quadratic' ? 3 : 2;
  const selected = strategySelection(points, options, minimumPoints);
  const transformed = selected.map(point => ({
    point,
    x: options.equationDirection === 'forward_od_to_conc' ? point.od : point.conc,
    y: options.equationDirection === 'forward_od_to_conc' ? point.conc : point.od,
  })).filter(item => (
    Number.isFinite(item.x)
    && Number.isFinite(item.y)
    && (options.curveModel !== 'natural_log' || item.x > 0)
  ));
  if (transformed.length < minimumPoints) return null;

  const xs = transformed.map(item => options.curveModel === 'natural_log' ? Math.log(item.x) : item.x);
  const ys = transformed.map(item => item.y);
  const weights = strategyWeights(transformed.map(item => item.point), options);
  const degree = options.curveModel === 'quadratic' ? 2 : 1;
  const ascending = polynomialFit(xs, ys, weights, degree);
  if (!ascending) return null;

  const rawPredict = (input: number) => {
    const x = options.curveModel === 'natural_log' ? Math.log(input) : input;
    return ascending.reduce((sum, coefficient, power) => sum + coefficient * x ** power, 0);
  };
  const predictions = transformed.map(item => rawPredict(item.x));
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const ssTotal = ys.reduce((sum, value) => sum + (value - yMean) ** 2, 0);
  const ssResidual = ys.reduce((sum, value, index) => sum + (value - predictions[index]) ** 2, 0);
  const r2 = ssTotal < EPSILON ? 1 : 1 - ssResidual / ssTotal;
  const coefficients = options.curveModel === 'quadratic'
    ? [ascending[2], ascending[1], ascending[0]]
    : [ascending[1], ascending[0]];
  const output = options.equationDirection === 'forward_od_to_conc' ? 'conc' : 'OD';
  const input = options.equationDirection === 'forward_od_to_conc' ? 'OD' : 'conc';
  const equation = options.curveModel === 'quadratic'
    ? `${output} = ${formatNumber(coefficients[0])} * ${input}^2 + ${formatNumber(coefficients[1])} * ${input} + ${formatNumber(coefficients[2])}`
    : options.curveModel === 'natural_log'
      ? `${output} = ${formatNumber(coefficients[0])} * ln(${input}) + ${formatNumber(coefficients[1])}`
      : `${output} = ${formatNumber(coefficients[0])} * ${input} + ${formatNumber(coefficients[1])}`;

  return {
    coefficients,
    r2,
    usedPointIndices: transformed.map(item => item.point.idx),
    predict: rawPredict,
    formulaText: formulaText(options.equationDirection, options.curveModel),
    equation: `${equation}; R² = ${formatNumber(r2)}; n = ${transformed.length}`,
    xLabel: options.equationDirection === 'forward_od_to_conc' ? 'OD' : 'Conc',
    yLabel: options.equationDirection === 'forward_od_to_conc' ? 'Conc' : 'OD',
  };
}
