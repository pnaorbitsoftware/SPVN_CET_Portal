// public/sw.js — CET Exam Portal Service Worker
// Handles caching, offline support, background sync

const CACHE_VERSION = 'v1.2';
const STATIC_CACHE  = `cet-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `cet-dynamic-${CACHE_VERSION}`;
const OFFLINE_URL   = '/offline.html';

// ── Assets to cache on install (app shell) ───────────────────────────────────
const STATIC_ASSETS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  // Tailwind CDN — cached on first load
];

// ── URLs that are ALWAYS network-first (never serve stale) ───────────────────
const NETWORK_ONLY = [
  '/exam/',          // active exam — must be real-time
  '/auth/login',
  '/auth/logout',
];

// ── URLs that work offline (cache-first) ─────────────────────────────────────
const CACHE_FIRST_PATTERNS = [
  /\/icons\//,
  /\/manifest\.json/,
  /cdn\.tailwindcss\.com/,
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /cdn\.jsdelivr\.net/,
];

// ── Background sync queue for answer saving during offline ───────────────────
const SYNC_QUEUE = 'answer-sync-queue';

// ─────────────────────────────────────────────────────────────────────────────
// INSTALL — cache static shell
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing', CACHE_VERSION);
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATE — clean old caches
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// FETCH — smart caching strategy
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin (except whitelisted CDNs)
  if (request.method !== 'GET') return;

  // Skip network-only routes — always go to network
  if (NETWORK_ONLY.some(p => url.pathname.startsWith(p))) {
    event.respondWith(networkOnly(request));
    return;
  }

  // Cache-first for static assets (icons, CDN fonts, manifest)
  if (CACHE_FIRST_PATTERNS.some(p => p.test(request.url))) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Stale-while-revalidate for pages (dashboards, tests list, results)
  event.respondWith(staleWhileRevalidate(request));
});

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND SYNC — queue answer saves when offline
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === SYNC_QUEUE) {
    event.waitUntil(flushAnswerQueue());
  }
});

async function flushAnswerQueue() {
  const db = await openDB();
  const tx = db.transaction('queue', 'readwrite');
  const store = tx.objectStore('queue');
  const items = await storeGetAll(store);

  for (const item of items) {
    try {
      const res = await fetch(item.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.body),
      });
      if (res.ok) {
        await storeDelete(store, item.id);
        console.log('[SW] Synced answer for Q', item.body.questionId);
      }
    } catch (e) {
      console.warn('[SW] Sync retry failed:', e.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUSH NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  const title   = data.title   || 'CET Exam Portal';
  const options = {
    body:    data.body    || 'You have a new notification.',
    icon:    '/icons/icon-192x192.png',
    badge:   '/icons/icon-72x72.png',
    tag:     data.tag     || 'cet-notification',
    data:    { url: data.url || '/' },
    actions: data.actions || [],
    vibrate: [200, 100, 200],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      const existing = cls.find(c => c.url.includes(url) && 'focus' in c);
      return existing ? existing.focus() : clients.openWindow(url);
    })
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY HELPERS
// ─────────────────────────────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return caches.match(OFFLINE_URL);
  }
}

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(
      JSON.stringify({ error: 'offline', message: 'No internet connection' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache  = await caches.open(DYNAMIC_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok && request.method === 'GET') {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise || caches.match(OFFLINE_URL);
}

// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB helpers for offline answer queue
// ─────────────────────────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cet-offline-db', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function storeGetAll(store) {
  return new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function storeDelete(store, id) {
  return new Promise((res, rej) => {
    const req = store.delete(id);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}
