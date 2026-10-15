/* SEA ESTATES service worker — offline-capable shell + asset caching.
 *
 * Why this was rewritten
 * ----------------------
 * The previous version put almost everything through network-first, including
 * css/ and js/*. That is actively slower than no service worker for a static
 * site: on every single visit the browser re-downloaded ~550 KB and waited for
 * a full round trip, instead of letting its own HTTP cache do its job. It also
 * documented an "offline fallback to the shell" that never existed, because
 * install() cached nothing.
 *
 * The strategy now:
 *   - install: precache the app shell, so a cold offline visit really works
 *   - navigations: network-first, falling back to the cached shell
 *   - css/js:   stale-while-revalidate (instant paint, updates in background)
 *   - data/*.json: network-first, because a stale zonal schedule is a
 *     correctness problem, not a latency one
 *   - vendor / fonts / map tiles: cache-first (immutable)
 *   - Supabase and /functions/: never intercepted
 *
 * Deploy note: bump VERSION when you ship. The activate handler deletes every
 * cache not named here, so a bump evicts the previous generation.
 */
const VERSION = "esrealty-pages-v35";
const SHELL_CACHE = VERSION + "-shell";
const ASSET_CACHE = VERSION + "-asset";
const VENDOR_CACHE = VERSION + "-vendor";
const IMG_CACHE = VERSION + "-img";

const SHELL = [
  "./",
  "./index.html",
  "./css/reboot-shim.css",
  "./css/styles.css",
  "./css/storefront-legacy.css",
  "./css/estimator.css",
  "./css/storefront.css",
  "./js/supabase-config.js",
  "./js/util.js",
  "./js/listings-api.js",
  "./js/storefront.js",
  "./js/value_guide_finance.js",
  "./js/value_guide_evidence.js",
  "./js/value_guide_reference.js",
  "./js/data.js",
  "./js/playbook_seed.js",
  "./js/core.js",
  "./js/portfolio_ledger.js",
  "./js/portfolio_cloud.js",
  "./js/attribution.js",
  "./js/estimator.js",
  "./js/value_guide_tax.js",
  "./js/value_guide_pdf.js",
  "./js/compliance_due.js",
  "./js/agent_next.js",
  "./js/app.min.js",
  "./404.html",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Individually, so one missing optional file cannot fail the whole install.
    await Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, ASSET_CACHE, VENDOR_CACHE, IMG_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && res.ok) await cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    return new Response("", { status: 504, statusText: "offline" });
  }
}

/* Serve the cached copy immediately, refresh it in the background. Turns the
 * old "download 550 KB and wait on every visit" into a cache hit. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request).then((res) => {
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  if (hit) {
    network.catch(() => {});
    return hit;
  }
  const res = await network;
  if (res) return res;
  throw new Error("offline and not cached: " + request.url);
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) await cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = await cache.match(request);
    if (hit) return hit;
    if (fallbackUrl) {
      const fb = await cache.match(fallbackUrl);
      if (fb) return fb;
    }
    throw e;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // API traffic is never cached or intercepted.
  if (url.hostname.includes("supabase") || url.pathname.includes("/functions/")) return;
  if (url.origin !== self.location.origin) {
    // Cross-origin: only cache the immutable third-party assets we rely on.
    if (/basemaps\.cartocdn\.com|tile\.openstreetmap/.test(url.hostname)) {
      event.respondWith(cacheFirst(req, IMG_CACHE));
    } else if (url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com") {
      event.respondWith(cacheFirst(req, VENDOR_CACHE));
    }
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, SHELL_CACHE, "./index.html"));
    return;
  }

  // Correctness-sensitive reference data: always prefer the network.
  if (url.pathname.startsWith("/data/") || url.pathname.startsWith("./data/")) {
    event.respondWith(networkFirst(req, ASSET_CACHE));
    return;
  }

  if (url.pathname.startsWith("/vendor/") || url.pathname.startsWith("./vendor/")) {
    event.respondWith(cacheFirst(req, VENDOR_CACHE));
    return;
  }

  if (req.destination === "image") {
    event.respondWith(cacheFirst(req, IMG_CACHE));
    return;
  }

  if (/\.(?:css|js)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, ASSET_CACHE));
  }
  // Everything else falls through to the browser's normal HTTP cache.
});
