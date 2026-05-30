import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = pg;

// RDS connection configuration
const PG_HOST = process.env.PG_HOST || 'database-1.cfutwrwyrxts.ap-northeast-1.rds.amazonaws.com';
const PG_PORT = parseInt(process.env.PG_PORT || '5432', 10);
const PG_DATABASE = process.env.PG_DATABASE || 'beadsdb';
const PG_USER = process.env.PG_USER || 'harryguo';
const PG_PASSWORD = process.env.PG_PASSWORD || 'skyla168';

export const pool = new Pool({
  host: PG_HOST,
  port: PG_PORT,
  database: PG_DATABASE,
  user: PG_USER,
  password: PG_PASSWORD,
  ssl: { rejectUnauthorized: false },
  min: 2,
  max: 10,
  connectionTimeoutMillis: 10000,
});

/**
 * Execute a query with retry logic for transient connection errors.
 */
export async function queryWithRetry(text, params, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      const isConnectionError =
        err.code === 'ECONNREFUSED' ||
        err.code === 'ENOTFOUND' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ECONNRESET' ||
        err.code === '57P01' ||
        err.code === '57P02' ||
        err.code === '57P03' ||
        err.code === '08000' ||
        err.code === '08003' ||
        err.code === '08006';

      if (isConnectionError && attempt < retries) {
        console.error(
          `[pgPool] Connection error (attempt ${attempt}/${retries}): ${err.message}. Retrying in 2s...`
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } else {
        throw err;
      }
    }
  }
}

export default pool;
