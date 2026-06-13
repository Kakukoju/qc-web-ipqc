import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockPoolInstance = { query: mockQuery, connect: mockConnect };

function MockPool() {
  return mockPoolInstance;
}

vi.mock('pg', () => {
  return {
    default: {
      Pool: MockPool,
    },
  };
});

const mockPrepare = vi.fn();
vi.mock('../specDb.js', () => {
  return {
    default: { prepare: mockPrepare },
  };
});

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSpec(overrides = {}) {
  return {
    source: 'P01',
    source_file: 'test.xlsx',
    marker: 'ALP',
    pn: 'PN001',
    tea: 'TEA1',
    single_cv: '5.0',
    init_l1_od: '0.1',
    init_l2_od: '0.2',
    spec_l1_od: '0.3',
    spec_l2_od: '0.4',
    spec_n1_od: '0.5',
    well_config: 'A1',
    dilution: '1:2',
    calc_method: 'linear',
    merge_bias: '0.01',
    merge_cv: '3.0',
    remarks: 'test remark',
    ...overrides,
  };
}

// ─── Test suites ─────────────────────────────────────────────────────────────

describe('specRdsSync - enabled (all env vars present)', () => {
  let mod;

  beforeEach(async () => {
    vi.resetModules();
    // Set all required env vars
    process.env.TUTTI_RDS_HOST = 'test-host';
    process.env.TUTTI_RDS_PORT = '5432';
    process.env.TUTTI_RDS_DATABASE = 'test-db';
    process.env.TUTTI_RDS_USER = 'test-user';
    process.env.TUTTI_RDS_PASSWORD = 'test-pass';
    process.env.TUTTI_RDS_SPEC_SCHEMA = 'QC_spec';

    mockQuery.mockReset();
    mockConnect.mockReset();
    mockPrepare.mockReset();

    mod = await import('../specRdsSync.js');
  });

  afterEach(() => {
    delete process.env.TUTTI_RDS_HOST;
    delete process.env.TUTTI_RDS_PORT;
    delete process.env.TUTTI_RDS_DATABASE;
    delete process.env.TUTTI_RDS_USER;
    delete process.env.TUTTI_RDS_PASSWORD;
    delete process.env.TUTTI_RDS_SPEC_SCHEMA;
  });

  describe('enabled flag', () => {
    it('should be true when all required env vars are set', () => {
      expect(mod.enabled).toBe(true);
    });

    it('should export a pool instance', () => {
      expect(mod.pool).toBe(mockPoolInstance);
    });
  });

  describe('ensureSchema()', () => {
    it('should call pool.query with CREATE SCHEMA and CREATE TABLE DDL', async () => {
      mockQuery.mockResolvedValueOnce({});

      const result = await mod.ensureSchema();

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(1);

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS');
      expect(sql).toContain('"QC_spec"');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS');
      expect(sql).toContain('bead_spec');
      expect(sql).toContain('UNIQUE(source, marker)');
    });

    it('should include all required columns in DDL', async () => {
      mockQuery.mockResolvedValueOnce({});

      await mod.ensureSchema();

      const sql = mockQuery.mock.calls[0][0];
      const requiredColumns = [
        'id', 'source', 'source_file', 'marker', 'pn', 'tea',
        'single_cv', 'init_l1_od', 'init_l2_od', 'spec_l1_od',
        'spec_l2_od', 'spec_n1_od', 'well_config', 'dilution',
        'calc_method', 'merge_bias', 'merge_cv', 'remarks', 'updated_at',
      ];
      for (const col of requiredColumns) {
        expect(sql).toContain(col);
      }
    });

    it('should return false and log error on query failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockQuery.mockRejectedValueOnce(new Error('connection refused'));

      const result = await mod.ensureSchema();

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('syncRows()', () => {
    it('should return ok with synced=0 for empty array', async () => {
      const result = await mod.syncRows([]);
      expect(result).toEqual({ ok: true, synced: 0 });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should return error for non-array input', async () => {
      const result = await mod.syncRows('not an array');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('array');
    });

    it('should produce INSERT...ON CONFLICT upsert SQL for a single row', async () => {
      mockQuery.mockResolvedValueOnce({});
      const spec = makeSpec();

      const result = await mod.syncRows([spec]);

      expect(result).toEqual({ ok: true, synced: 1 });
      expect(mockQuery).toHaveBeenCalledTimes(1);

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO');
      expect(sql).toContain('ON CONFLICT (source, marker) DO UPDATE');
      expect(sql).toContain('NOW()');
      // 17 columns × 1 row = 17 params
      expect(params).toHaveLength(17);
      expect(params[0]).toBe('P01');       // source
      expect(params[1]).toBe('test.xlsx'); // source_file
      expect(params[2]).toBe('ALP');       // marker
    });

    it('should bind all 17 columns per row in correct order', async () => {
      mockQuery.mockResolvedValueOnce({});
      const spec = makeSpec();

      await mod.syncRows([spec]);

      const [, params] = mockQuery.mock.calls[0];
      // Verify param order matches SPEC_COLUMNS order
      expect(params[0]).toBe(spec.source);
      expect(params[1]).toBe(spec.source_file);
      expect(params[2]).toBe(spec.marker);
      expect(params[3]).toBe(spec.pn);
      expect(params[4]).toBe(spec.tea);
      expect(params[5]).toBe(spec.single_cv);
      expect(params[6]).toBe(spec.init_l1_od);
      expect(params[7]).toBe(spec.init_l2_od);
      expect(params[8]).toBe(spec.spec_l1_od);
      expect(params[9]).toBe(spec.spec_l2_od);
      expect(params[10]).toBe(spec.spec_n1_od);
      expect(params[11]).toBe(spec.well_config);
      expect(params[12]).toBe(spec.dilution);
      expect(params[13]).toBe(spec.calc_method);
      expect(params[14]).toBe(spec.merge_bias);
      expect(params[15]).toBe(spec.merge_cv);
      expect(params[16]).toBe(spec.remarks);
    });

    it('should produce correct placeholders for multiple rows', async () => {
      mockQuery.mockResolvedValueOnce({});
      const specs = [makeSpec({ marker: 'ALP' }), makeSpec({ marker: 'CRP' })];

      const result = await mod.syncRows(specs);

      expect(result).toEqual({ ok: true, synced: 2 });
      const [sql, params] = mockQuery.mock.calls[0];
      // 17 columns × 2 rows = 34 params
      expect(params).toHaveLength(34);
      // First row starts at $1, second row at $18
      expect(sql).toContain('$1');
      expect(sql).toContain('$18');
    });

    it('should handle null fields gracefully', async () => {
      mockQuery.mockResolvedValueOnce({});
      const spec = makeSpec({ pn: null, tea: undefined, remarks: null });

      await mod.syncRows([spec]);

      const [, params] = mockQuery.mock.calls[0];
      expect(params[3]).toBeNull(); // pn
      expect(params[4]).toBeNull(); // tea (undefined → null via ?? null)
      expect(params[16]).toBeNull(); // remarks
    });

    it('should return error result on query failure without throwing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockQuery.mockRejectedValueOnce(new Error('RDS timeout'));

      const result = await mod.syncRows([makeSpec()]);

      expect(result.ok).toBe(false);
      expect(result.synced).toBe(0);
      expect(result.error).toBe('RDS timeout');
      consoleSpy.mockRestore();
    });
  });

  describe('fullSync()', () => {
    let mockClient;

    beforeEach(() => {
      mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };
      mockConnect.mockResolvedValue(mockClient);
    });

    it('should read all SQLite rows and upsert to RDS in a transaction', async () => {
      const specs = [makeSpec({ marker: 'ALP' }), makeSpec({ marker: 'CRP', source: 'Qbi' })];
      mockPrepare.mockReturnValue({ all: () => specs });
      mockClient.query.mockResolvedValue({ rowCount: 0 });

      const result = await mod.fullSync();

      expect(result.ok).toBe(true);
      expect(result.total).toBe(2);
      expect(result.upserted).toBe(2);
      expect(result.deleted).toBe(0);

      // Verify transaction flow: BEGIN, upsert, DELETE orphans, COMMIT
      const calls = mockClient.query.mock.calls.map(([sql]) =>
        typeof sql === 'string' ? sql.trim().split(/\s+/)[0] : 'PARAM_QUERY'
      );
      expect(calls[0]).toBe('BEGIN');
      // Upsert call (INSERT INTO...)
      expect(mockClient.query.mock.calls[1][0]).toContain('INSERT INTO');
      expect(mockClient.query.mock.calls[1][0]).toContain('ON CONFLICT');
      // Delete orphans call
      expect(mockClient.query.mock.calls[2][0]).toContain('DELETE FROM');
      expect(mockClient.query.mock.calls[2][0]).toContain('NOT IN');
      // COMMIT
      expect(calls[3]).toBe('COMMIT');
    });

    it('should delete all rows when SQLite is empty', async () => {
      mockPrepare.mockReturnValue({ all: () => [] });
      mockClient.query.mockResolvedValue({ rowCount: 5 });

      const result = await mod.fullSync();

      expect(result.ok).toBe(true);
      expect(result.total).toBe(0);
      expect(result.deleted).toBe(5);

      // With empty specs: BEGIN, DELETE (all), COMMIT
      expect(mockClient.query.mock.calls[0][0]).toBe('BEGIN');
      expect(mockClient.query.mock.calls[1][0]).toContain('DELETE FROM');
      expect(mockClient.query.mock.calls[2][0]).toBe('COMMIT');
    });

    it('should pass source and marker arrays to DELETE query for orphan removal', async () => {
      const specs = [
        makeSpec({ source: 'P01', marker: 'ALP' }),
        makeSpec({ source: 'Qbi', marker: 'CRP' }),
      ];
      mockPrepare.mockReturnValue({ all: () => specs });
      mockClient.query.mockResolvedValue({ rowCount: 1 });

      await mod.fullSync();

      // The DELETE call is the third query (index 2)
      const deleteCall = mockClient.query.mock.calls[2];
      const [sql, params] = deleteCall;
      expect(sql).toContain('DELETE FROM');
      expect(sql).toContain('unnest');
      expect(params[0]).toEqual(['P01', 'Qbi']); // sources
      expect(params[1]).toEqual(['ALP', 'CRP']); // markers
    });

    it('should rollback on upsert error and return error result', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const specs = [makeSpec()];
      mockPrepare.mockReturnValue({ all: () => specs });
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('constraint violation')); // upsert fails

      const result = await mod.fullSync();

      expect(result.ok).toBe(false);
      expect(result.error).toBe('constraint violation');
      // Should call ROLLBACK
      const rollbackCall = mockClient.query.mock.calls.find(
        ([sql]) => sql === 'ROLLBACK'
      );
      expect(rollbackCall).toBeDefined();
      expect(mockClient.release).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should return error if SQLite read fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPrepare.mockReturnValue({
        all: () => { throw new Error('SQLite disk I/O error'); },
      });

      const result = await mod.fullSync();

      expect(result.ok).toBe(false);
      expect(result.error).toBe('SQLite disk I/O error');
      expect(result.total).toBe(0);
      consoleSpy.mockRestore();
    });
  });
});

describe('specRdsSync - disabled (missing env vars)', () => {
  let mod;

  beforeEach(async () => {
    vi.resetModules();
    // Remove required env vars
    delete process.env.TUTTI_RDS_HOST;
    delete process.env.TUTTI_RDS_PORT;
    delete process.env.TUTTI_RDS_DATABASE;
    delete process.env.TUTTI_RDS_USER;
    delete process.env.TUTTI_RDS_PASSWORD;
    delete process.env.TUTTI_RDS_SPEC_SCHEMA;

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mod = await import('../specRdsSync.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should set enabled to false when required env vars are missing', () => {
    expect(mod.enabled).toBe(false);
  });

  it('should set pool to null when disabled', () => {
    expect(mod.pool).toBeNull();
  });

  it('should log a warning about missing env vars', () => {
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('missing environment variables')
    );
  });

  it('ensureSchema() should return false without attempting queries', async () => {
    const result = await mod.ensureSchema();
    expect(result).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('syncRows() should return skip result with error message', async () => {
    const result = await mod.syncRows([makeSpec()]);
    expect(result.ok).toBe(false);
    expect(result.synced).toBe(0);
    expect(result.error).toContain('missing environment variables');
  });

  it('fullSync() should return skip result with error message', async () => {
    const result = await mod.fullSync();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('missing environment variables');
    expect(result.total).toBe(0);
    expect(result.upserted).toBe(0);
    expect(result.deleted).toBe(0);
  });
});
