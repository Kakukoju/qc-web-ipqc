/**
 * RD Build-Line Tasks API Tests
 * 
 * Tests cover:
 * 1. RD emp_no verification (success + failure)
 * 2. Task creation
 * 3. Duplicate prevention
 * 4. Task listing
 * 5. Task detail
 * 6. Unauthorized direct write
 * 7. Authorized direct write
 * 8. Task status after write
 * 9. DB write-back verification
 */
import { strict as assert } from 'assert';

const BASE = 'http://127.0.0.1:3201/api/v1/pre-assignment';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

let testTaskId = null;

async function runTests() {
  console.log('🧪 RD Build-Line API Tests\n');
  let passed = 0;
  let failed = 0;
  const ts = Date.now(); // unique suffix for this test run

  // ── Test 1: RD emp_no verification success ─────────────────────────────
  try {
    const { status, data } = await post('/rd-auth/verify', { emp_no: '10018325' });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.data.emp_no, '10018325');
    assert.equal(data.data.english_name, 'Chloe Chang');
    assert.equal(data.data.name, '張雅婷');
    console.log('  ✅ Test 1: RD emp_no verification success');
    passed++;
  } catch (e) {
    console.log('  ❌ Test 1: RD emp_no verification success -', e.message);
    failed++;
  }

  // ── Test 2: RD emp_no verification failure ─────────────────────────────
  try {
    const { status, data } = await post('/rd-auth/verify', { emp_no: '99999999' });
    assert.equal(status, 403);
    assert.equal(data.ok, false);
    assert.equal(data.error.code, 'RD_EMP_NO_NOT_ALLOWED');
    console.log('  ✅ Test 2: RD emp_no verification failure');
    passed++;
  } catch (e) {
    console.log('  ❌ Test 2: RD emp_no verification failure -', e.message);
    failed++;
  }

  // ── Test 3: Create RD task ─────────────────────────────────────────────
  try {
    const { status, data } = await post('/rd-build-line-tasks', {
      panel_name: `TEST-PANEL-${ts}`,
      lot_no: `TEST-LOT-${ts}`,
      marker: 'TEST-MARKER',
      work_order: 'WO-TEST-001',
      source_fit_id: `auto-test-${ts}`,
      created_by: 'Test QC',
      fit_data: {
        equation: 'y = 0.05x + 0.01; R2 = 0.995',
        slope: 0.05,
        intercept: 0.01,
        r2: 0.995,
        analyze_date: '2026-05-27',
        Species: 'Control',
        points: [
          { patient_id: 'control-1', conc: 3.5, od: 0.186 },
          { patient_id: 'control-2', conc: 7.0, od: 0.361 },
        ],
      },
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.ok(data.data.task_id > 0);
    assert.equal(data.data.status, 'pending_rd');
    testTaskId = data.data.task_id;
    console.log(`  ✅ Test 3: Create RD task (id=${testTaskId})`);
    passed++;
  } catch (e) {
    console.log('  ❌ Test 3: Create RD task -', e.message);
    failed++;
  }

  // ── Test 4: Duplicate task prevention ──────────────────────────────────
  try {
    const { status, data } = await post('/rd-build-line-tasks', {
      panel_name: `TEST-PANEL-${ts}`,
      lot_no: `TEST-LOT-${ts}`,
      marker: 'TEST-MARKER',
      source_fit_id: `auto-test-${ts}`,
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.data.existing, true);
    assert.equal(data.data.task_id, testTaskId);
    console.log('  ✅ Test 4: Duplicate task prevention');
    passed++;
  } catch (e) {
    console.log('  ❌ Test 4: Duplicate task prevention -', e.message);
    failed++;
  }

  // ── Test 5: Get task list ──────────────────────────────────────────────
  try {
    const { status, data } = await get('/rd-build-line-tasks?status=pending_rd');
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.ok(Array.isArray(data.data));
    const found = data.data.find(t => t.id === testTaskId);
    assert.ok(found, 'Test task should be in list');
    assert.equal(found.panel_name, `TEST-PANEL-${ts}`);
    console.log('  ✅ Test 5: Get task list');
    passed++;
  } catch (e) {
    console.log('  ❌ Test 5: Get task list -', e.message);
    failed++;
  }

  // ── Test 6: Get task detail ────────────────────────────────────────────
  try {
    const { status, data } = await get(`/rd-build-line-tasks/${testTaskId}`);
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.data.panel_name, `TEST-PANEL-${ts}`);
    assert.ok(data.data.fit_data, 'fit_data should be parsed');
    assert.equal(data.data.fit_data.slope, 0.05);
    console.log('  ✅ Test 6: Get task detail');
    passed++;
  } catch (e) {
    console.log('  ❌ Test 6: Get task detail -', e.message);
    failed++;
  }

  // ── Test 7: Unauthorized direct write ──────────────────────────────────
  try {
    const { status, data } = await post(`/rd-build-line-tasks/${testTaskId}/direct-write`, {
      emp_no: '99999999',
      confirmed: true,
    });
    assert.equal(status, 403);
    assert.equal(data.ok, false);
    assert.equal(data.error.code, 'RD_EMP_NO_NOT_ALLOWED');
    console.log('  ✅ Test 7: Unauthorized direct write rejected');
    passed++;
  } catch (e) {
    console.log('  ❌ Test 7: Unauthorized direct write -', e.message);
    failed++;
  }

  // ── Test 8: Authorized direct write ────────────────────────────────────
  try {
    const { status, data } = await post(`/rd-build-line-tasks/${testTaskId}/direct-write`, {
      emp_no: '10018348',
      confirmed: true,
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.data.status, 'completed');
    assert.equal(data.data.action_type, 'direct_write');
    assert.ok(data.data.confirmed_by.includes('Kira Lin@'));
    assert.equal(data.data.rd_person.emp_no, '10018348');
    console.log('  ✅ Test 8: Authorized direct write');
    passed++;
  } catch (e) {
    console.log('  ❌ Test 8: Authorized direct write -', e.message);
    failed++;
  }

  // ── Test 9: Task status after write ────────────────────────────────────
  try {
    const { status, data } = await get(`/rd-build-line-tasks/${testTaskId}`);
    assert.equal(status, 200);
    assert.equal(data.data.status, 'completed');
    assert.equal(data.data.action_type, 'direct_write');
    assert.equal(data.data.assigned_rd_emp_no, '10018348');
    assert.equal(data.data.assigned_rd_name, 'Kira Lin');
    assert.ok(data.data.completed_at);
    console.log('  ✅ Test 9: Task status = completed after write');
    passed++;
  } catch (e) {
    console.log('  ❌ Test 9: Task status after write -', e.message);
    failed++;
  }

  // ── Test 10: Cannot write to completed task ────────────────────────────
  try {
    const { status, data } = await post(`/rd-build-line-tasks/${testTaskId}/direct-write`, {
      emp_no: '10018325',
      confirmed: true,
    });
    assert.equal(status, 400);
    assert.equal(data.ok, false);
    assert.equal(data.error.code, 'ALREADY_COMPLETED');
    console.log('  ✅ Test 10: Cannot write to completed task');
    passed++;
  } catch (e) {
    console.log('  ❌ Test 10: Cannot write to completed task -', e.message);
    failed++;
  }

  // ── Test 11: Start adjust with valid emp_no ────────────────────────────
  // Create a new task for this test
  try {
    const createRes = await post('/rd-build-line-tasks', {
      panel_name: `TEST-ADJUST-${ts}`,
      lot_no: `TEST-ADJUST-LOT-${ts}`,
      marker: 'BUN',
      source_fit_id: `adjust-test-${ts}`,
      fit_data: { equation: 'y = 0.03x + 0.02', slope: 0.03, intercept: 0.02, r2: 0.99 },
    });
    const adjustTaskId = createRes.data.data.task_id;

    const { status, data } = await post(`/rd-build-line-tasks/${adjustTaskId}/start-adjust`, {
      emp_no: '10018349',
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.data.status, 'in_progress');
    assert.equal(data.data.rd_person.english_name, 'Anne Lin');
    console.log('  ✅ Test 11: Start adjust with valid emp_no');
    passed++;

    // ── Test 12: Save adjusted fit ─────────────────────────────────────
    const saveRes = await post(`/rd-build-line-tasks/${adjustTaskId}/save-adjusted-fit`, {
      emp_no: '10018349',
      fit_params: { slope: 0.035, intercept: 0.018, r2: 0.992, equation: 'y = 0.035x + 0.018; R2 = 0.992' },
    });
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.data.ok, true);
    assert.equal(saveRes.data.data.action_type, 'adjust_curve');
    assert.ok(saveRes.data.data.confirmed_by.includes('Anne Lin@'));
    console.log('  ✅ Test 12: Save adjusted fit');
    passed++;
  } catch (e) {
    console.log('  ❌ Test 11/12: Adjust flow -', e.message);
    failed++;
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
}

runTests().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
