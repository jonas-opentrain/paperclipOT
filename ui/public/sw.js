const SCOPE_URL = new URL(self.registration.scope);
const BASE_PATH = SCOPE_URL.pathname.replace(/\/$/, "");
const CACHE_PREFIX = "paperclip-";
const CACHE_NAME = `${CACHE_PREFIX}v3:${SCOPE_URL.pathname}`;

function withBasePath(path) {
  if (!BASE_PATH) return path;
  return `${BASE_PATH}${path}`;
}

function isApiPath(pathname) {
  const apiPath = withBasePath("/api");
  return pathname === apiPath || pathname.startsWith(`${apiPath}/`);
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key.startsWith(CACHE_PREFIX) ? caches.delete(key) : undefined)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and API calls
  if (request.method !== "GET" || isApiPath(url.pathname)) {
    return;
  }

  // Network-first for everything — cache is only an offline fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        if (request.mode === "navigate") {
          return caches.match(self.registration.scope) || new Response("Offline", { status: 503 });
        }
        return caches.match(request);
      })
  );
});
