/* Offline support.
   Once loaded, the app works with no network at all: on a plane, in a shop, anywhere. Strategy:
   - the page itself (navigations): network first, so a new version shows on the next visit,
     falling back to the cached page offline;
   - the build's hashed files (assets/…-[hash].js|css): cache first, since a hash never changes;
   - everything else on this origin: stale-while-revalidate.
   Other origins (Open Food Facts lookups and images) and /api (the AI estimate) are left alone:
   they must go to the network or fail honestly. Paths are relative to the service worker, so the
   app works from a subfolder (e.g. a GitHub Pages project site). */

const CACHE = "nbq-v3";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png"];

/* The first visit loads the app before this worker is running, so its files wouldn't be cached
   until a second visit. Installing also caches the build files index.html links to (the hashed
   names change with every build, so they're read from the page rather than listed here). */
async function precache() {
  const c = await caches.open(CACHE);
  await c.addAll(SHELL);
  const html = await (await fetch("./index.html", { cache: "no-cache" })).text();
  const files = [...html.matchAll(/(?:src|href)="(?:\.\/)?(assets\/[^"]+)"/g)].map(m => `./${m[1]}`);
  await c.addAll([...new Set(files)]);
}

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(precache().catch(() => {}));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const put = (request, res) => {
  if (res && res.status === 200 && res.type === "basic") {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
  }
  return res;
};

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  const path = url.pathname.startsWith(scope) ? url.pathname.slice(scope.length) : url.pathname;
  if (path.startsWith("api/") || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(res => put(request, res))
        .catch(() => caches.match(request).then(c => c || caches.match("./index.html")))
    );
    return;
  }
  if (path.startsWith("assets/")) {
    event.respondWith(caches.match(request).then(c => c || fetch(request).then(res => put(request, res))));
    return;
  }
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(res => put(request, res)).catch(() => cached);
      return cached || network;
    })
  );
});
