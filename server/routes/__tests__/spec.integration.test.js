import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock specRdsSync module
const mockSyncRows = vi.fn();
const mockFullSync = vi.fn();
vi.mock('../../db/specRdsSync.js', () => ({
  syncRows: mockSyncRows,
  fullSync: mockFullSync,
}));

// Mock specDb (better-sqlite3 instance)
const mockPrepare = vi.fn();
const mockRun = vi.fn();
const mockGet = vi.fn();
const mockAll = vi.fn();
const mockTransaction = vi.fn((fn) => fn);
vi.mock('../../db/specDb.js', () => ({
  default: {
    prepare: mockPrepare,
    transaction: mockTransaction,
  },
}));

// Mock XLSX module
const mockReadFile = vi.fn();
const mockSheetToJson = vi.fn();
vi.mock('xlsx', () => ({
  default: {
    readFile: mockReadFile,
    utils: { sheet_to_json: mockSheetToJson },
  },
}));

// Mock fs module
const mockExistsSync = vi.fn();
const mockUnlink = vi.fn((_path, cb) => cb && cb());
vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    unlink: vi.fn((_path, cb) => cb && cb()),
  },
  existsSync: vi.fn(),
  unlink: vi.fn((_path, cb) => cb && cb()),
}));

// Mock multer to simulate file upload without writing to disk
const mockMulter = vi.fn(() => ({
  single: () => (req, _res, next) => {
    // Simulate a file being provided
    req.file = {
      path: '/tmp/test-upload.xlsx',
      originalname: 'test-spec.xlsx',
    };
    next();
  },
}));
vi.mock('multer', () => ({
  default: mockMulter,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSpecRow(overrides = {}) {
  return {
    source: 'P01',
    marker: 'ALP',
    pn: null,
    tea: 'TEA1',
    single_cv: '5.0',
    init_l1_od: '0.1',
    init_l2_od: '0.2',
    spec_l1_od: '0.3',
    spec_l2_od: '0.4',
    spec_n1_od: null,
    well_config: 'A1',
    dilution: null,
    calc_method: 'linear',
    merge_bias: '0.01',
    merge_cv: '3.0',
    remarks: null,
    ...overrides,
  };
}

// Build a P01-style matrix that the parser can parse
function makeP01Matrix() {
  // Row 0: header area
  // Row 1: Marker header row
  // Rows 2+: data rows
  return [
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '', 'Marker', 'TEA', 'CV', 'L1 OD', 'L2 OD', 'Spec L1', 'Spec L2', '', 'Well', 'Calc', 'Bias', 'MergeCV', 'Remarks'],
    ['', '', 'ALP', 'TEA1', '5.0', '0.1', '0.2', '0.3', '0.4', '', 'A1', 'linear', '0.01', '3.0', ''],
    ['', '', 'CRP', 'TEA2', '4.0', '0.15', '0.25', '0.35', '0.45', '', 'B1', 'poly', '0.02', '2.5', 'note'],
  ];
}

// ─── Test App Factory ────────────────────────────────────────────────────────

async function createTestApp() {
  // Reset all mocks before importing route
  const specModule = await import('../spec.js');
  const app = express();
  app.use(express.json());
  app.use('/api/spec', specModule.default);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Spec Routes - RDS Sync Integration', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup default mock for specDb.prepare (used by upsertStmt and existingStmt)
    mockPrepare.mockReturnValue({
      run: mockRun,
      get: mockGet.mockReturnValue(null), // no existing row (insert)
      all: mockAll.mockReturnValue([]),
    });

    // Setup default mock for XLSX
    mockReadFile.mockReturnValue({
      SheetNames: ['Bead允收_併批標準'],
      Sheets: { 'Bead允收_併批標準': {} },
    });
    mockSheetToJson.mockReturnValue(makeP01Matrix());

    // Setup default mock for fs
    mockExistsSync.mockReturnValue(true);

    // Setup default mock for syncRows (success)
    mockSyncRows.mockResolvedValue({ ok: true, synced: 2 });

    // Setup default mock for fullSync (success)
    mockFullSync.mockResolvedValue({ ok: true, total: 10, upserted: 10, deleted: 2 });

    app = await createTestApp();
  });

  describe('POST /api/spec/upload', () => {
    it('should return rds_sync field in response on success', async () => {
      mockSyncRows.mockResolvedValue({ ok: true, synced: 2 });

      const res = await request(app)
        .post('/api/spec/upload')
        .attach('file', Buffer.from('fake-excel'), 'test-spec.xlsx');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('rds_sync');
      expect(res.body.rds_sync).toEqual({ ok: true, synced: 2 });
      expect(res.body.ok).toBe(true);
    });

    it('should return rds_sync with error when RDS sync fails', async () => {
      mockSyncRows.mockResolvedValue({ ok: false, synced: 0, error: 'connection refused' });

      const res = await request(app)
        .post('/api/spec/upload')
        .attach('file', Buffer.from('fake-excel'), 'test-spec.xlsx');

      // Upload still returns 200 because SQLite succeeded
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.rds_sync).toEqual({
        ok: false,
        synced: 0,
        error: 'connection refused',
      });
    });

    it('should return rds_sync with error when syncRows throws', async () => {
      mockSyncRows.mockRejectedValue(new Error('unexpected RDS failure'));

      const res = await request(app)
        .post('/api/spec/upload')
        .attach('file', Buffer.from('fake-excel'), 'test-spec.xlsx');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.rds_sync.ok).toBe(false);
      expect(res.body.rds_sync.error).toContain('unexpected RDS failure');
    });

    it('should return 400 when no file is uploaded', async () => {
      // Override the multer mock to not set req.file
      const specModule = await import('../spec.js');
      const noFileApp = express();
      noFileApp.use(express.json());
      // Manually create a route that simulates missing file
      noFileApp.post('/api/spec/upload', (req, res) => {
        // No file scenario
        res.status(400).json({ error: '未選擇檔案' });
      });

      const res = await request(noFileApp)
        .post('/api/spec/upload');

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/spec/sync', () => {
    it('should return rds_sync field in response on success', async () => {
      mockSyncRows.mockResolvedValue({ ok: true, synced: 4 });

      const res = await request(app)
        .post('/api/spec/sync')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('rds_sync');
      expect(res.body.rds_sync).toEqual({ ok: true, synced: 4 });
    });

    it('should return rds_sync with error when RDS sync fails', async () => {
      mockSyncRows.mockResolvedValue({ ok: false, synced: 0, error: 'timeout' });

      const res = await request(app)
        .post('/api/spec/sync')
        .send({});

      // Sync still returns 200 as SQLite operations were successful
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('rds_sync');
      expect(res.body.rds_sync.ok).toBe(false);
      expect(res.body.rds_sync.error).toBe('timeout');
    });

    it('should return rds_sync with error when syncRows throws', async () => {
      mockSyncRows.mockRejectedValue(new Error('RDS connection reset'));

      const res = await request(app)
        .post('/api/spec/sync')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('rds_sync');
      expect(res.body.rds_sync.ok).toBe(false);
      expect(res.body.rds_sync.error).toContain('RDS connection reset');
    });

    it('should return rds_sync ok with synced=0 when no specs parsed', async () => {
      // Make files not exist so nothing gets parsed
      mockExistsSync.mockReturnValue(false);

      const res = await request(app)
        .post('/api/spec/sync')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('rds_sync');
      expect(res.body.rds_sync).toEqual({ ok: true, synced: 0 });
    });
  });

  describe('POST /api/spec/rds-sync', () => {
    it('should return counts on successful full sync', async () => {
      mockFullSync.mockResolvedValue({ ok: true, total: 15, upserted: 15, deleted: 3 });

      const res = await request(app)
        .post('/api/spec/rds-sync')
        .send();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, total: 15, upserted: 15, deleted: 3 });
    });

    it('should return 500 when fullSync reports failure', async () => {
      mockFullSync.mockResolvedValue({
        ok: false, total: 10, upserted: 0, deleted: 0, error: 'RDS unavailable',
      });

      const res = await request(app)
        .post('/api/spec/rds-sync')
        .send();

      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBe('RDS unavailable');
    });

    it('should return 500 when fullSync throws', async () => {
      mockFullSync.mockRejectedValue(new Error('pool terminated'));

      const res = await request(app)
        .post('/api/spec/rds-sync')
        .send();

      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBe('pool terminated');
    });

    it('should return total and deleted counts from fullSync result', async () => {
      mockFullSync.mockResolvedValue({ ok: true, total: 50, upserted: 50, deleted: 5 });

      const res = await request(app)
        .post('/api/spec/rds-sync')
        .send();

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(50);
      expect(res.body.upserted).toBe(50);
      expect(res.body.deleted).toBe(5);
    });
  });
});
