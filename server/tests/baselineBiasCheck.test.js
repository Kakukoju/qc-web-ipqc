import assert from 'node:assert/strict';
import { checkBaselineBias, findMergeBiasSpec, parseMergeBiasSpec } from '../services/baselineBiasCheck.js';

const spec = findMergeBiasSpec('ALP');
assert.equal(spec.marker, 'ALP');
assert.equal(parseMergeBiasSpec(spec.merge_bias).rules[0].limit, 2.5);

const pass = checkBaselineBias({
  analyzeItem: 'ALP',
  slope: 0.002,
  intercept: -0.1,
  points: [
    { patient_id: 'Control-1', conc: 100, final_delta_od: 0.1 },
    { patient_id: 'Control-2', conc: 200, final_delta_od: 0.3 },
  ],
});
assert.equal(pass.pass, true);
assert.equal(pass.points.length, 2);

const fail = checkBaselineBias({
  analyzeItem: 'ALP',
  slope: 0.002,
  intercept: -0.1,
  points: [{ patient_id: 'Control-1', conc: 100, final_delta_od: 0.12 }],
});
assert.equal(fail.pass, false);
assert.ok(fail.reasons[0].includes('bias'));

const fuzzy = findMergeBiasSpec('QALB');
assert.equal(fuzzy.marker, 'ALB');

console.log('baselineBiasCheck tests passed');
