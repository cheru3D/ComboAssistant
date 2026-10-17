// Service worker: guarda la app y la base de cartas para usarla sin conexión.
// Cambia VERSION cada vez que publiques una versión nueva.
const VERSION = "ca-v2";
const IMAGES = "ca-img-v1";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "js/app.js",
  "js/game.js",
  "js/triggers.js",
  "data/cards.json",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== IMAGES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Imágenes de Scryfall: se guardan las que ya se vieron.
  if (url.hostname === "cards.scryfall.io") {
    e.respondWith(
      caches.open(IMAGES).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok || res.type === "opaque") cache.put(e.request, res.clone());
        return res;
      }),
    );
    return;
  }

  if (url.origin !== location.origin) return;
  // Archivos de la app: primero la caché, luego la red.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)),
  );
});
