const CACHE_NAME = "teleport-v4";
const IMG_CACHE = "teleport-img-v2";
const MAX_IMG = 150;
const MAX_ASSETS = 24;
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
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== IMG_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

async function putCapped(cacheName, req, res, limit) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(req, res);
    const keys = await cache.keys();
    if (keys.length > limit) {
      await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
    }
  } catch (_e) {}
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 1. App-Shell (HTML, Manifest, Icon): Network-First ohne Query-Tokens im Cache-Key
  if (url.origin === self.location.origin) {
    if (
      url.pathname === "/" ||
      url.pathname === "/app" ||
      url.pathname === "/miniapp" ||
      url.pathname === "/favicon.svg" ||
      url.pathname === "/manifest.json"
    ) {
      const hasSensitiveQuery =
        url.searchParams.has("tgLaunch") ||
        url.searchParams.has("token") ||
        url.searchParams.has("secret");
      const cacheKey = new Request(url.origin + url.pathname);
      event.respondWith(
        fetch(req).then((networkRes) => {
          if (networkRes && networkRes.status === 200 && !hasSensitiveQuery) {
            const resClone = networkRes.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, resClone)).catch(() => {}));
          }
          return networkRes;
        }).catch(() =>
          caches.match(cacheKey).then((m) => m || caches.match("/app")).then((m) => m || Response.error())
        )
      );
      return;
    }

    // Content-gehashte immutable TMA-Assets (/assets/tma-*): Reines Cache-First mit Mengen-Limit
    if (url.pathname.startsWith("/assets/tma-")) {
      event.respondWith(
        caches.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((networkRes) => {
            if (networkRes && networkRes.status === 200) {
              event.waitUntil(putCapped(CACHE_NAME, req, networkRes.clone(), MAX_ASSETS));
            }
            return networkRes;
          }).catch(() => Response.error());
        })
      );
      return;
    }

    // Gehashte Build-Assets (/assets/*): Cache-First mit Hintergrund-Revalidierung & Mengen-Limit
    if (url.pathname.startsWith("/assets/")) {
      event.respondWith(
        caches.match(req).then((cached) => {
          const fetchPromise = fetch(req).then((networkRes) => {
            if (networkRes && networkRes.status === 200) {
              event.waitUntil(putCapped(CACHE_NAME, req, networkRes.clone(), MAX_ASSETS));
            }
            return networkRes;
          }).catch(() => cached || Response.error());
          return cached || fetchPromise;
        })
      );
      return;
    }
  }

  // 2. TMDb-Bilder: Limitierter Cache-First inkl. Cross-Origin Opaque Responses
  if (url.hostname === "image.tmdb.org") {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((networkRes) => {
          if (networkRes && (networkRes.status === 200 || networkRes.type === "opaque")) {
            event.waitUntil(putCapped(IMG_CACHE, req, networkRes.clone(), MAX_IMG));
          }
          return networkRes;
        }).catch(() => caches.match("/favicon.svg").then((m) => m || Response.error()));
      })
    );
    return;
  }
});
