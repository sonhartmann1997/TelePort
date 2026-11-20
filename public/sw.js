const CACHE_NAME = "teleport-v1";
const APP_SHELL = [
  "/app",
  "/favicon.svg",
  "/manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 1. App-Shell & statische Assets: Stale-While-Revalidate
  if (url.origin === self.location.origin) {
    if (
      url.pathname === "/" ||
      url.pathname === "/app" ||
      url.pathname === "/miniapp" ||
      url.pathname.startsWith("/assets/") ||
      url.pathname === "/favicon.svg"
    ) {
      event.respondWith(
        caches.match(req).then((cached) => {
          const fetchPromise = fetch(req).then((networkRes) => {
            if (networkRes && networkRes.status === 200) {
              const resClone = networkRes.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
            }
            return networkRes;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      );
      return;
    }
  }

  // 2. TMDb-Bilder: Cache-First mit Netzwerk-Fallback für Offline-Cover
  if (url.hostname === "image.tmdb.org") {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return networkRes;
        }).catch(() => caches.match("/favicon.svg"));
      })
    );
    return;
  }
});
