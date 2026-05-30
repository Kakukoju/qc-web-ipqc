import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the API module
vi.mock('../../api/rdBuildLine', () => ({
  fetchRdTasks: vi.fn(),
  fetchRdTaskDetail: vi.fn(),
  verifyRdEmpNo: vi.fn(),
  directWrite: vi.fn(),
  startAdjust: vi.fn(),
  saveAdjustedFit: vi.fn(),
  fetchRdTaskCounts: vi.fn(),
}));

import { fetchRdTasks, fetchRdTaskDetail, verifyRdEmpNo, directWrite } from '../../api/rdBuildLine';

describe('RdMobilePage API integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetchRdTasks returns task list', async () => {
    const mockTasks = [
      { id: 1, panel_name: 'CC2', lot_no: 'LOT-001', marker: 'ALB', status: 'pending_rd', created_at: '2026-05-27 10:00' },
    ];
    (fetchRdTasks as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: mockTasks });

    const result = await fetchRdTasks('pending_rd');
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].panel_name).toBe('CC2');
  });

  it('fetchRdTasks returns empty for no tasks', async () => {
    (fetchRdTasks as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [] });

    const result = await fetchRdTasks('pending_rd');
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(0);
  });

  it('fetchRdTaskDetail returns task with fit_data', async () => {
    const mockDetail = {
      id: 1, panel_name: 'CC2', lot_no: 'LOT-001', marker: 'ALB', status: 'pending_rd',
      fit_data: { slope: 0.05, intercept: 0.01, r2: 0.99, equation: 'y = 0.05x + 0.01' },
      curve_record: null,
    };
    (fetchRdTaskDetail as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: mockDetail });

    const result = await fetchRdTaskDetail(1);
    expect(result.ok).toBe(true);
    expect(result.data!.fit_data!.slope).toBe(0.05);
  });

  it('verifyRdEmpNo rejects invalid emp_no', async () => {
    (verifyRdEmpNo as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: 'RD_EMP_NO_NOT_ALLOWED', message: '工號不存在或無 RD 建線權限' },
    });

    const result = await verifyRdEmpNo('99999999');
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('RD_EMP_NO_NOT_ALLOWED');
  });

  it('verifyRdEmpNo accepts valid emp_no', async () => {
    (verifyRdEmpNo as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: { emp_no: '10018325', name: '張雅婷', english_name: 'Chloe Chang', department: '試劑部', cost_center: 'T800302' },
    });

    const result = await verifyRdEmpNo('10018325');
    expect(result.ok).toBe(true);
    expect(result.data!.english_name).toBe('Chloe Chang');
  });

  it('directWrite succeeds with valid emp_no', async () => {
    (directWrite as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: { task_id: 1, status: 'completed', action_type: 'direct_write', confirmed_by: 'Chloe Chang@2026-05-27 14:32' },
    });

    const result = await directWrite(1, '10018325');
    expect(result.ok).toBe(true);
    expect(result.data!.status).toBe('completed');
    expect(result.data!.confirmed_by).toContain('Chloe Chang@');
  });

  it('directWrite fails with invalid emp_no', async () => {
    (directWrite as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: 'RD_EMP_NO_NOT_ALLOWED', message: '工號不存在或無 RD 建線權限' },
    });

    const result = await directWrite(1, '99999999');
    expect(result.ok).toBe(false);
  });

  it('API error returns readable message', async () => {
    (fetchRdTasks as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    try {
      await fetchRdTasks('pending_rd');
    } catch (e) {
      expect((e as Error).message).toBe('Network error');
    }
  });
});
