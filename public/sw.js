/* DailyDrop High-Priority Order Alerts Service Worker */

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = (event.notification && event.notification.data) || {};
  const role = data.role === 'owner' ? 'owner' : 'rider';
  const orderId = typeof data.orderId === 'string' ? data.orderId : null;
  const fallbackUrl =
    role === 'owner'
      ? '/?app=owner&autostart=1'
      : '/?app=rider&autostart=1';
  const targetUrl =
    typeof data.url === 'string' && data.url.startsWith('/')
      ? data.url
      : fallbackUrl;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Prefer an already-open tab for the matching DailyDrop role (?app=rider or ?app=owner)
        let matchingClient = null;
        for (const client of windowClients) {
          try {
            const parsed = new URL(client.url);
            if (parsed.searchParams.get('app') === role) {
              matchingClient = client;
              break;
            }
          } catch {
            // ignore malformed URL
          }
        }

        if (matchingClient) {
          matchingClient.postMessage({
            type: 'DAILYDROP_NOTIFICATION_CLICK',
            orderId,
            role,
          });
          if (typeof matchingClient.focus === 'function') {
            return matchingClient.focus();
          }
          return matchingClient;
        }

        if (typeof self.clients.openWindow === 'function') {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
