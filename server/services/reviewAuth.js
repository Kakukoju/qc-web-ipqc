import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import db from '../db/sqlite.js';

export const REVIEW_ROLES = new Set(['RD', 'QC_SUPERVISOR', 'QC_VIEWER']);

db.exec(`
  CREATE TABLE IF NOT EXISTS review_users (
    user_id TEXT PRIMARY KEY,
    display_name TEXT,
    role TEXT NOT NULL CHECK(role IN ('RD','QC_SUPERVISOR','QC_VIEWER')),
    password_hash TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )
`);

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function authenticateReviewUser(userId, password, requiredRole) {
  if (!userId || !password) return null;
  const row = db.prepare(`
    SELECT user_id, display_name, role, password_hash
    FROM review_users WHERE user_id = ? AND enabled = 1
  `).get(String(userId).trim());
  if (!row || (requiredRole && row.role !== requiredRole)) return null;
  const [salt, expectedHex] = String(row.password_hash).split(':', 2);
  if (!salt || !expectedHex) return null;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = scryptSync(String(password), salt, expected.length);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { user_id: row.user_id, display_name: row.display_name || row.user_id, role: row.role };
}

export function provisionReviewUser({ user_id, display_name, role, password }) {
  if (!user_id || !password || !REVIEW_ROLES.has(role)) throw new Error('Invalid review user');
  db.prepare(`
    INSERT INTO review_users (user_id, display_name, role, password_hash)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      display_name=excluded.display_name, role=excluded.role,
      password_hash=excluded.password_hash, enabled=1,
      updated_at=datetime('now','localtime')
  `).run(String(user_id).trim(), display_name || null, role, hashPassword(password));
}
