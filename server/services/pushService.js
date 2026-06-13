import webpush from 'web-push';
import db from '../db/sqlite.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL, role TEXT NOT NULL, device_name TEXT,
    token_or_subscription TEXT NOT NULL UNIQUE, platform TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    last_seen_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_push_role_enabled ON push_subscriptions(role, enabled);
`);

function vapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const row = db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='vapid_keys'").get();
  if (row) return JSON.parse(row.setting_value);
  const keys = webpush.generateVAPIDKeys();
  db.prepare("INSERT INTO app_settings(setting_key,setting_value) VALUES('vapid_keys',?)")
    .run(JSON.stringify(keys));
  return keys;
}

const keys = vapidKeys();
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:qc-admin@skyla.com', keys.publicKey, keys.privateKey);
export const getVapidPublicKey = () => keys.publicKey;

function subscriptionJson(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed?.endpoint || !parsed?.keys) throw new Error('Invalid Web Push subscription');
  return JSON.stringify(parsed);
}

export function savePushSubscription(input) {
  const serialized = subscriptionJson(input.token ?? input.subscription);
  db.prepare(`
    INSERT INTO push_subscriptions(user_id,role,device_name,token_or_subscription,platform,last_seen_at)
    VALUES(?,?,?,?,?,datetime('now','localtime'))
    ON CONFLICT(token_or_subscription) DO UPDATE SET
      user_id=excluded.user_id, role=excluded.role, device_name=excluded.device_name,
      platform=excluded.platform, enabled=1, updated_at=datetime('now','localtime'),
      last_seen_at=datetime('now','localtime')
  `).run(input.user_id, input.role, input.device_name || null, serialized, input.platform || null);
}

export function disablePushSubscription(input) {
  if (input.token || input.subscription) {
    return db.prepare("UPDATE push_subscriptions SET enabled=0 WHERE token_or_subscription=?")
      .run(subscriptionJson(input.token ?? input.subscription)).changes;
  }
  return db.prepare("UPDATE push_subscriptions SET enabled=0 WHERE user_id=?")
    .run(input.user_id).changes;
}

async function send(rows, title, body, clickAction, data) {
  const payload = JSON.stringify({ title, body, click_action: clickAction, data: { ...data, click_action: clickAction } });
  for (const row of rows) {
    try {
      await webpush.sendNotification(JSON.parse(row.token_or_subscription), payload);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        db.prepare("UPDATE push_subscriptions SET enabled=0 WHERE id=?").run(row.id);
      }
      console.error('[push] failed', row.id, error.statusCode, error.message);
    }
  }
}

export function sendPushToRole(role, title, body, clickAction, data = {}) {
  return send(db.prepare("SELECT id,token_or_subscription FROM push_subscriptions WHERE role=? AND enabled=1").all(role), title, body, clickAction, data);
}

export function sendPushToUser(userId, title, body, clickAction, data = {}) {
  return send(db.prepare("SELECT id,token_or_subscription FROM push_subscriptions WHERE user_id=? AND enabled=1").all(userId), title, body, clickAction, data);
}
