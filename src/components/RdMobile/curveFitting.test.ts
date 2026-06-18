import { describe, expect, it } from 'vitest';
import { fitCurve, formulaText, type CurvePoint } from './curveFitting';

const points: CurvePoint[] = [
  { idx: 0, od: 1, conc: 3, label: 'P1', well: '' },
  { idx: 1, od: 2, conc: 5, label: 'P2', well: '' },
  { idx: 2, od: 3, conc: 7, label: 'P3', well: '' },
  { idx: 3, od: 4, conc: 9, label: 'P4', well: '' },
];

describe('RD mobile curve fitting', () => {
  it('keeps the legacy default as forward linear full range', () => {
    const fit = fitCurve(points, {
      equationDirection: 'forward_od_to_conc',
      curveModel: 'linear',
      fitStrategy: 'full_range',
      referenceConc: 6,
    });
    expect(fit?.coefficients[0]).toBeCloseTo(2);
    expect(fit?.coefficients[1]).toBeCloseTo(1);
    expect(fit?.r2).toBeCloseTo(1);
    expect(fit?.formulaText).toBe('conc = a * OD + b');
  });

  it('supports reverse and quadratic fits', () => {
    const quadraticPoints = points.map(point => ({ ...point, od: point.conc ** 2 }));
    const fit = fitCurve(quadraticPoints, {
      equationDirection: 'reverse_conc_to_od',
      curveModel: 'quadratic',
      fitStrategy: 'full_range',
      referenceConc: 6,
    });
    expect(fit?.coefficients[0]).toBeCloseTo(1);
    expect(fit?.coefficients[1]).toBeCloseTo(0);
    expect(fit?.coefficients[2]).toBeCloseTo(0);
  });

  it('supports natural log fits', () => {
    const logPoints = points.map(point => ({ ...point, conc: 4 * Math.log(point.od) + 2 }));
    const fit = fitCurve(logPoints, {
      equationDirection: 'forward_od_to_conc',
      curveModel: 'natural_log',
      fitStrategy: 'full_range',
      referenceConc: 4,
    });
    expect(fit?.coefficients[0]).toBeCloseTo(4);
    expect(fit?.coefficients[1]).toBeCloseTo(2);
    expect(fit?.r2).toBeCloseTo(1);
  });

  it('uses only the two selected local concentrations', () => {
    const fit = fitCurve(points, {
      equationDirection: 'forward_od_to_conc',
      curveModel: 'linear',
      fitStrategy: 'local_near_cutoff',
      referenceConc: 5,
      localRange: [3, 7],
    });
    expect(fit?.usedPointIndices).toEqual([0, 2]);
  });

  it('changes the weighted fit when the selected target changes', () => {
    const curvedPoints: CurvePoint[] = [
      { idx: 0, od: 1, conc: 1, label: 'L1', well: '' },
      { idx: 1, od: 2, conc: 2, label: 'L2', well: '' },
      { idx: 2, od: 3, conc: 6, label: 'H1', well: '' },
      { idx: 3, od: 4, conc: 12, label: 'H2', well: '' },
    ];
    const lowTarget = fitCurve(curvedPoints, {
      equationDirection: 'forward_od_to_conc',
      curveModel: 'linear',
      fitStrategy: 'weighted_near_target',
      referenceConc: 1,
    });
    const highTarget = fitCurve(curvedPoints, {
      equationDirection: 'forward_od_to_conc',
      curveModel: 'linear',
      fitStrategy: 'weighted_near_target',
      referenceConc: 12,
    });
    expect(lowTarget?.coefficients[0]).not.toBeCloseTo(highTarget?.coefficients[0] || 0, 2);
    expect(lowTarget?.predict(2)).not.toBeCloseTo(highTarget?.predict(2) || 0, 2);
  });

  it('returns the requested metadata formula text', () => {
    expect(formulaText('reverse_conc_to_od', 'natural_log')).toBe('OD = a * ln(conc) + b');
  });
});
