/* Checkpoint service worker: network-first for the app page, cache-first for icons. */
var CACHE = 'checkpoint-v9';
var FONT_CACHE = 'checkpoint-fonts-v1';
var PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(PRECACHE); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('checkpoint-') === 0 && k !== CACHE && k !== FONT_CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function networkFirst(request) {
  return fetch(request).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (cache) { cache.put('./index.html', copy); });
    }
    return res;
  }).catch(function () {
    return caches.match('./index.html').then(function (hit) { return hit || caches.match('./'); });
  });
}

function cacheFirst(request, cacheName) {
  return caches.match(request).then(function (hit) {
    if (hit) return hit;
    return fetch(request).then(function (res) {
      if (res && (res.ok || res.type === 'opaque')) {
        var copy = res.clone();
        caches.open(cacheName).then(function (cache) { cache.put(request, copy); });
      }
      return res;
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin === self.location.origin) {
    var scopePath = new URL(self.registration.scope).pathname;
    if (req.mode === 'navigate' || url.pathname === scopePath || url.pathname.endsWith('/index.html')) {
      event.respondWith(networkFirst(req));
      return;
    }
    event.respondWith(cacheFirst(req, CACHE));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONT_CACHE));
  }
});
