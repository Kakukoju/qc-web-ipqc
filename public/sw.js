const CACHE = 'skyla-qc-rd-v1';
const APP_URL = '/qc-web/pre-assignment/rd-mobile/tasks';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([
    '/qc-web/manifest.json',
    '/qc-web/skylaflower.png',
  ])).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = { body: event.data?.text() || '' }; }
  const data = payload.data || {};
  event.waitUntil(self.registration.showNotification(payload.title || 'Skyla QC/RD Review', {
    body: payload.body || '有新的待辦事項',
    icon: '/qc-web/skylaflower.png',
    badge: '/qc-web/skylaflower.png',
    tag: data.type && data.task_id ? `${data.type}-${data.task_id}` : 'skyla-review',
    data: { ...data, click_action: payload.click_action || data.click_action || APP_URL },
    requireInteraction: true,
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.click_action || APP_URL;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => new URL(client.url).pathname === target);
    if (existing) return existing.focus();
    return clients.openWindow(target);
  }));
});
