const CACHE_NAME = "piano-transposer-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./service-worker.js",
  // NOTE: icons are intentionally NOT pre-cached.
  // If the icons folder/files don't exist yet on GitHub Pages, precaching will fail.
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        // addAll fails if any asset is missing; keep icons optional so the app still installs offline
        Promise.all(
          ASSETS.map((url) =>
            cache.add(url).catch(() => {
              // ignore missing/blocked asset
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((resp) => {
          // Optionally cache same-origin GET requests as they are fetched (nice for offline after first use)
          try {
            const url = new URL(event.request.url);
            if (event.request.method === "GET" && url.origin === self.location.origin) {
              const clone = resp.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
          } catch {
            // ignore
          }
          return resp;
        })
        .catch(() => {
          // Offline fallback for navigation
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
          return undefined;
        });
    })
  );
});

