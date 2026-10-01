// Service worker: makes the app installable and caches static files.
// Pages and /ui/ fragments always come from the server (timers must be live);
// static assets are cache-first so the app shell loads fast on the phone.
const CACHE = "hobby-tracker-v1";
const ASSETS = [
  "/static/app.css",
  "/static/app.js",
  "/static/vendor/pico.min.css",
  "/static/vendor/htmx.min.js",
  "/static/vendor/alpine.min.js",
  "/static/vendor/chart.umd.min.js",
  "/static/icons/icon-192.png",
  "/static/icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith("/static/")) {
    return; // network only
  }
  // Stale-while-revalidate for static files.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      const fresh = fetch(event.request)
        .then((res) => { if (res.ok) cache.put(event.request, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
