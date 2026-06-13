import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import specDb from './specDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = pg;

const REQUIRED_ENV_VARS = [
  'TUTTI_RDS_HOST',
  'TUTTI_RDS_DATABASE',
  'TUTTI_RDS_USER',
  'TUTTI_RDS_PASSWORD',
];
const missingEnvVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);

export const enabled = missingEnvVars.length === 0;

const PG_HOST = process.env.TUTTI_RDS_HOST;
const PG_PORT = Number.parseInt(process.env.TUTTI_RDS_PORT || '5432', 10);
const PG_DATABASE = process.env.TUTTI_RDS_DATABASE;
const PG_USER = process.env.TUTTI_RDS_USER;
const PG_PASSWORD = process.env.TUTTI_RDS_PASSWORD;
const SPEC_SCHEMA = process.env.TUTTI_RDS_SPEC_SCHEMA || 'QC_spec';

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

const SCHEMA_SQL = quoteIdentifier(SPEC_SCHEMA);
const TABLE_SQL = `${SCHEMA_SQL}.bead_spec`;
const DISABLED_ERROR = enabled
  ? null
  : `RDS spec sync disabled; missing environment variables: ${missingEnvVars.join(', ')}`;

if (!enabled) {
  console.warn(`[specRdsSync] ${DISABLED_ERROR}`);
}

export const pool = enabled
  ? new Pool({
      host: PG_HOST,
      port: PG_PORT,
      database: PG_DATABASE,
      user: PG_USER,
      password: PG_PASSWORD,
      ssl: { rejectUnauthorized: false },
      min: 1,
      max: 5,
      connectionTimeoutMillis: 10000,
    })
  : null;

const SPEC_COLUMNS = [
  'source',
  'source_file',
  'marker',
  'pn',
  'tea',
  'single_cv',
  'init_l1_od',
  'init_l2_od',
  'spec_l1_od',
  'spec_l2_od',
  'spec_n1_od',
  'well_config',
  'dilution',
  'calc_method',
  'merge_bias',
  'merge_cv',
  'remarks',
];

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08003',
  '08006',
]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logFailure(operation, error) {
  console.error(
    `[specRdsSync] ${operation} failed for host=${PG_HOST}, database=${PG_DATABASE}: ${error.message}`
  );
}

async function withRetry(operation, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const shouldRetry = CONNECTION_ERROR_CODES.has(error.code) && attempt < retries;
      if (!shouldRetry) {
        throw error;
      }

      console.error(
        `[specRdsSync] Connection error (attempt ${attempt}/${retries}): ${error.message}. Retrying in 2s...`
      );
      await delay(2000);
    }
  }
}

function buildUpsertQuery(specs) {
  const params = [];
  const valuesSql = specs.map((spec, rowIndex) => {
    const offset = rowIndex * SPEC_COLUMNS.length;
    params.push(...SPEC_COLUMNS.map((column) => spec[column] ?? null));
    const placeholders = SPEC_COLUMNS.map((_, columnIndex) => `$${offset + columnIndex + 1}`);
    return `(${placeholders.join(', ')}, NOW())`;
  });

  return {
    text: `
      INSERT INTO ${TABLE_SQL}
        (${SPEC_COLUMNS.join(', ')}, updated_at)
      VALUES
        ${valuesSql.join(',\n        ')}
      ON CONFLICT (source, marker) DO UPDATE SET
        source_file = EXCLUDED.source_file,
        pn          = EXCLUDED.pn,
        tea         = EXCLUDED.tea,
        single_cv   = EXCLUDED.single_cv,
        init_l1_od  = EXCLUDED.init_l1_od,
        init_l2_od  = EXCLUDED.init_l2_od,
        spec_l1_od  = EXCLUDED.spec_l1_od,
        spec_l2_od  = EXCLUDED.spec_l2_od,
        spec_n1_od  = EXCLUDED.spec_n1_od,
        well_config = EXCLUDED.well_config,
        dilution    = EXCLUDED.dilution,
        calc_method = EXCLUDED.calc_method,
        merge_bias  = EXCLUDED.merge_bias,
        merge_cv    = EXCLUDED.merge_cv,
        remarks     = EXCLUDED.remarks,
        updated_at  = NOW()
    `,
    params,
  };
}

export async function ensureSchema() {
  if (!enabled) {
    return false;
  }

  try {
    await withRetry(() =>
      pool.query(`
        CREATE SCHEMA IF NOT EXISTS ${SCHEMA_SQL};

        CREATE TABLE IF NOT EXISTS ${TABLE_SQL} (
          id          SERIAL PRIMARY KEY,
          source      TEXT NOT NULL,
          source_file TEXT,
          marker      TEXT NOT NULL,
          pn          TEXT,
          tea         TEXT,
          single_cv   TEXT,
          init_l1_od  TEXT,
          init_l2_od  TEXT,
          spec_l1_od  TEXT,
          spec_l2_od  TEXT,
          spec_n1_od  TEXT,
          well_config TEXT,
          dilution    TEXT,
          calc_method TEXT,
          merge_bias  TEXT,
          merge_cv    TEXT,
          remarks     TEXT,
          updated_at  TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(source, marker)
        );
      `)
    );
    return true;
  } catch (error) {
    logFailure('Schema initialization', error);
    return false;
  }
}

export async function syncRows(specs) {
  if (!enabled) {
    return { ok: false, synced: 0, error: DISABLED_ERROR };
  }
  if (!Array.isArray(specs)) {
    return { ok: false, synced: 0, error: 'Specs must be an array' };
  }
  if (specs.length === 0) {
    return { ok: true, synced: 0 };
  }

  try {
    const query = buildUpsertQuery(specs);
    await withRetry(() => pool.query(query.text, query.params));
    return { ok: true, synced: specs.length };
  } catch (error) {
    logFailure('Row sync', error);
    return { ok: false, synced: 0, error: error.message };
  }
}

export async function fullSync() {
  if (!enabled) {
    return { ok: false, total: 0, upserted: 0, deleted: 0, error: DISABLED_ERROR };
  }

  let specs;
  try {
    specs = specDb.prepare('SELECT * FROM bead_ipqc_spec ORDER BY source, marker').all();
  } catch (error) {
    console.error(`[specRdsSync] Failed to read SQLite specs: ${error.message}`);
    return { ok: false, total: 0, upserted: 0, deleted: 0, error: error.message };
  }

  try {
    const deleted = await withRetry(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (specs.length > 0) {
          const upsert = buildUpsertQuery(specs);
          await client.query(upsert.text, upsert.params);
        }

        const sources = specs.map((spec) => spec.source);
        const markers = specs.map((spec) => spec.marker);
        const deleteResult = specs.length > 0
          ? await client.query(
              `
                DELETE FROM ${TABLE_SQL}
                WHERE (source, marker) NOT IN (
                  SELECT unnest($1::text[]), unnest($2::text[])
                )
              `,
              [sources, markers]
            )
          : await client.query(`DELETE FROM ${TABLE_SQL}`);

        await client.query('COMMIT');
        return deleteResult.rowCount;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error(`[specRdsSync] Rollback failed: ${rollbackError.message}`);
        }
        throw error;
      } finally {
        client.release();
      }
    });

    return {
      ok: true,
      total: specs.length,
      upserted: specs.length,
      deleted,
    };
  } catch (error) {
    logFailure('Full sync', error);
    return {
      ok: false,
      total: specs.length,
      upserted: 0,
      deleted: 0,
      error: error.message,
    };
  }
}
