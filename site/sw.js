// Hors ligne : l'interface et les horaires déjà consultés restent disponibles.
const CACHE = "ttm-v11";
const SHELL = ["./", "index.html", "style.css?v=11", "app.js?v=11", "engine.js?v=11", "config.js?v=11", "manifest.webmanifest", "icon-192.png", "vendor/qrcode.js?v=11",
  "fonts/inter_regular.otf", "fonts/inter_medium.otf", "fonts/inter_semibold.otf", "fonts/inter_bold.otf"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // temps réel : jamais en cache
  // Réseau d'abord (données fraîches), cache en secours
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
