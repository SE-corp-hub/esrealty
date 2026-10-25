/* The site's Cloudflare Worker (agent websites plan, Phase 0).
 *
 * Every file is still served by Cloudflare's asset server, with _headers applied, exactly as
 * before. Only the paths in wrangler.jsonc "run_worker_first" come here:
 *
 *   /listing/<id>   the normal site page, with that listing's title, description, photo and
 *                   schema.org data written into the HTML, so Facebook, Messenger and Google can
 *                   read it. The app then opens the listing as usual (storefront.js reads the path).
 *   /agents/<slug>  an agent's page, the same way: name, licence, pitch and photo in the HTML. While
 *                   AGENT_PAGES_INDEX is not "on" (until the lawyer's OK), it carries noindex. A page
 *                   that is not public (unpublished, licence expired, access revoked) answers 410.
 *   /sitemap.xml    every available listing, on the site's own address, and every published agent
 *                   page once AGENT_PAGES_INDEX is "on" (the directory's list, GET /agents).
 *   /photos/<path>  a public listing photo (Supabase bucket listing-photos), from its copy in Cloudflare
 *                   R2 (binding PHOTOS). The first request fetches it once from Supabase and keeps the
 *                   copy, so a photo leaves Supabase once instead of on every view (the free plan's
 *                   cached-egress quota). Uploads never overwrite a path, so copies are kept for good.
 *
 * The listing comes from the listing function with ?count=0, so these reads are not counted as
 * views. If the function is slow (over 1.5 s) or down, the plain site page is served instead and
 * the app loads the listing itself, so a share link never hangs or breaks.
 */

const TIMEOUT_MS = 1500;
const API_CACHE_SECONDS = 60;
const SITEMAP_PAGES = 20; // 20 pages of 50 listings
const DEFAULT_SITE_URL = "https://esrealty.tradersgag6.workers.dev";
const DEFAULT_API = "https://mrngaqtbaseewzcsogqi.supabase.co/functions/v1/listing-api/api";
const DEFAULT_SUPABASE = "https://mrngaqtbaseewzcsogqi.supabase.co";

// <user id>/<file>, as the app names uploads. Only these image types are served from the site's own
// address, never anything a browser could run (HTML, SVG).
const PHOTO_PATH = /^\/photos\/([A-Za-z0-9_-]{1,80}\/[A-Za-z0-9._-]{1,160})$/;
const PHOTO_TYPES = /^image\/(jpeg|png|webp|gif|avif)$/;
const PHOTO_KEEP_BYTES = 5 * 1024 * 1024;

// The same as the "/*" block in _headers (tests/worker_node.js keeps them equal). _headers is not
// applied to responses the Worker builds itself.
export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "geolocation=(self), camera=(), microphone=(), payment=(), usb=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co https://tradersgag6.github.io https://images.unsplash.com https://*.basemaps.cartocdn.com https://tile.openstreetmap.org https://*.tile.openstreetmap.org; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://esrealty-market-scan.vercel.app https://nominatim.openstreetmap.org https://overpass-api.de https://lz4.overpass-api.de https://overpass.kumi.systems; frame-src https://www.google.com https://www.openstreetmap.org; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
};

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const money = (n) => (Number(n) > 0 ? "PHP " + Number(n).toLocaleString("en-PH", { maximumFractionDigits: 0 }) : "");

const listPrice = (l) => Number((l.offer_type === "rent" ? l.rent : l.price) || 0);

const imageUrls = (l) => (Array.isArray(l.images) ? l.images : [])
  .map((x) => (typeof x === "string" ? x : (x && x.url) || ""))
  .filter((u) => /^https:\/\//.test(u));

const place = (l) => [l.barangay, l.city, l.province].filter(Boolean).join(", ");

const describe = (l) => String(l.description || "").replace(/\s+/g, " ").trim().slice(0, 300)
  || [l.property_type || "Property", "for", l.offer_type === "rent" ? "rent" : "sale", place(l) ? "in " + place(l) : ""].join(" ").trim() + ".";

function html(body, status, extra) {
  return new Response(body, {
    status,
    headers: { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache, must-revalidate", ...(extra || {}) },
  });
}

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cf: { cacheTtl: API_CACHE_SECONDS, cacheEverything: true },
    });
    return { status: res.status, body: res.ok ? await res.json() : null };
  } catch (e) {
    return { status: 0, body: null }; // slow or unreachable
  } finally {
    clearTimeout(timer);
  }
}

async function appShell(request, env) {
  const res = await env.ASSETS.fetch(new Request(new URL("/", request.url), { headers: { Accept: "text/html" } }));
  return res.text();
}

// Pages served from a path need <base href="/"> so the site's relative file paths keep working.
export function withBase(page) {
  return /<base\s/i.test(page) ? page : page.replace(/<head([^>]*)>/i, (m) => m + '\n<base href="/">');
}

function setTag(page, pattern, tag) {
  return pattern.test(page) ? page.replace(pattern, tag) : page.replace(/<\/head>/i, tag + "\n</head>");
}

export function listingPage(page, l, siteUrl) {
  const url = siteUrl + "/listing/" + encodeURIComponent(l.id);
  const title = String(l.title || "Property") + " | SEA ESTATES";
  const desc = describe(l);
  const img = imageUrls(l)[0] || "";
  const price = listPrice(l);
  const ld = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: l.title || "Property",
    description: desc,
    url,
    image: imageUrls(l).slice(0, 5),
    datePosted: l.published_at || undefined,
    address: { "@type": "PostalAddress", streetAddress: [l.address, l.barangay].filter(Boolean).join(", "), addressLocality: l.city || "", addressRegion: l.province || "", addressCountry: "PH" },
    offers: { "@type": "Offer", priceCurrency: "PHP", price, availability: "https://schema.org/InStock", url },
  };
  let out = withBase(page);
  out = setTag(out, /<title>[\s\S]*?<\/title>/i, "<title>" + esc(title) + "</title>");
  out = setTag(out, /<meta name="description"[^>]*>/i, '<meta name="description" content="' + esc(desc) + '">');
  out = setTag(out, /<meta property="og:title"[^>]*>/i, '<meta property="og:title" content="' + esc(l.title || "Property") + '">');
  out = setTag(out, /<meta property="og:description"[^>]*>/i, '<meta property="og:description" content="' + esc(desc) + '">');
  out = setTag(out, /<meta name="twitter:card"[^>]*>/i, '<meta name="twitter:card" content="' + (img ? "summary_large_image" : "summary") + '">');
  const extra = [
    '<link rel="canonical" href="' + esc(url) + '">',
    '<meta property="og:url" content="' + esc(url) + '">',
    img ? '<meta property="og:image" content="' + esc(img) + '">' : "",
    price ? '<meta property="og:price:amount" content="' + price + '">\n<meta property="og:price:currency" content="PHP">' : "",
    // "<" is escaped so text in a listing cannot close the script block.
    '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, "\\u003c") + "</script>",
  ].filter(Boolean).join("\n");
  out = out.replace(/<\/head>/i, extra + "\n</head>");
  // A short readable summary for crawlers that do not run scripts; people with scripts see the app.
  const summary = '<noscript><h1>' + esc(l.title || "Property") + "</h1><p>"
    + esc([money(price) + (l.offer_type === "rent" && price ? " a month" : ""), place(l)].filter(Boolean).join(" · "))
    + "</p><p>" + esc(desc) + "</p></noscript>";
  return out.replace(/<body([^>]*)>/i, (m) => m + "\n" + summary);
}

async function listingRoute(request, env, id) {
  const siteUrl = (env.SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, "");
  const api = (env.LISTING_API || DEFAULT_API).replace(/\/$/, "");
  const [shell, found] = await Promise.all([
    appShell(request, env),
    getJson(api + "/listings/" + encodeURIComponent(id) + "?count=0"),
  ]);
  const listing = found.body && found.body.data;
  if (listing && listing.id) return html(listingPage(shell, listing, siteUrl), 200);
  if (found.status === 404) {
    // Gone: say so to search engines; people still get the site, which shows the listing as missing.
    const page = withBase(shell).replace(/<\/head>/i, '<meta name="robots" content="noindex">\n</head>');
    return html(page, 404);
  }
  return html(withBase(shell), 200); // slow or down: the app loads the listing itself
}

const TOWN_NAMES = { "batangas-city": "Batangas City", "lipa-city": "Lipa City", "tanauan-city": "Tanauan City", "sto-tomas-city": "Sto. Tomas City",
  "sta-teresita": "Sta. Teresita", "mataas-na-kahoy": "Mataas na Kahoy", "padre-garcia": "Padre Garcia" };
const townName = (slug) => TOWN_NAMES[slug] || String(slug || "").split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export function agentPage(page, a, siteUrl, indexable) {
  const url = siteUrl + "/agents/" + encodeURIComponent(a.slug);
  const towns = (a.towns || []).map(townName);
  const title = a.name + ", " + a.role_label + " | SEA ESTATES";
  const desc = String(a.pitch || "").trim() || (a.role_label + (towns.length ? " in " + towns.slice(0, 3).join(", ") + ", Batangas" : " in Batangas") + ", with SEA ESTATES.");
  const img = /^https:\/\//.test(a.photo || "") ? a.photo : "";
  // The 1200 x 630 preview image made when the page was published (My website); the photo otherwise.
  const share = /^https:\/\//.test(a.og_image || "") ? a.og_image : img;
  const ld = {
    "@context": "https://schema.org", "@type": "RealEstateAgent", name: a.name, url, description: desc,
    image: img || undefined,
    telephone: (a.contacts && a.contacts.call) || undefined,
    areaServed: towns.length ? towns.map((t) => ({ "@type": "City", name: t + ", Batangas" })) : undefined,
    memberOf: { "@type": "RealEstateAgent", name: "SEA ESTATES" },
  };
  let out = withBase(page);
  out = setTag(out, /<title>[\s\S]*?<\/title>/i, "<title>" + esc(title) + "</title>");
  out = setTag(out, /<meta name="description"[^>]*>/i, '<meta name="description" content="' + esc(desc) + '">');
  out = setTag(out, /<meta property="og:title"[^>]*>/i, '<meta property="og:title" content="' + esc(a.name + ", " + a.role_label) + '">');
  out = setTag(out, /<meta property="og:description"[^>]*>/i, '<meta property="og:description" content="' + esc(desc) + '">');
  out = setTag(out, /<meta name="twitter:card"[^>]*>/i, '<meta name="twitter:card" content="' + (share ? "summary_large_image" : "summary") + '">');
  out = out.replace(/<\/head>/i, [
    '<link rel="canonical" href="' + esc(url) + '">',
    '<meta property="og:url" content="' + esc(url) + '">',
    '<meta property="og:type" content="profile">',
    share ? '<meta property="og:image" content="' + esc(share) + '">' : "",
    share && share === a.og_image ? '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">' : "",
    indexable ? "" : '<meta name="robots" content="noindex">',
    '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, "\\u003c") + "</script>",
  ].filter(Boolean).join("\n") + "\n</head>");
  const lic = a.licence ? "Licence no. " + a.licence.no + ", checked by SEA ESTATES." : "";
  const summary = "<noscript><h1>" + esc(a.name) + "</h1><p>" + esc(a.role_label + (towns.length ? " in " + towns.join(", ") : "")) + "</p><p>" + esc(desc) + "</p>" + (lic ? "<p>" + esc(lic) + "</p>" : "") + "</noscript>";
  return out.replace(/<body([^>]*)>/i, (m) => m + "\n" + summary);
}

async function agentRoute(request, env, slug) {
  const siteUrl = (env.SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, "");
  const api = (env.LISTING_API || DEFAULT_API).replace(/\/$/, "");
  const [shell, found] = await Promise.all([
    appShell(request, env),
    getJson(api + "/agents/" + encodeURIComponent(slug) + "?count=0"),
  ]);
  const agent = found.body && found.body.data;
  if (agent && agent.slug) return html(agentPage(shell, agent, siteUrl, env.AGENT_PAGES_INDEX === "on"), 200);
  if (found.status === 404) {
    // Not public (unpublished, licence expired, access revoked): gone, so search engines drop it.
    return html(withBase(shell).replace(/<\/head>/i, '<meta name="robots" content="noindex">\n</head>'), 410);
  }
  return html(withBase(shell).replace(/<\/head>/i, '<meta name="robots" content="noindex">\n</head>'), 200); // slow or down
}

async function sitemapRoute(env) {
  const siteUrl = (env.SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, "");
  const api = (env.LISTING_API || DEFAULT_API).replace(/\/$/, "");
  const rows = [];
  for (let page = 1; page <= SITEMAP_PAGES; page++) {
    const r = await getJson(api + "/listings?status=available&per_page=50&page=" + page);
    const data = (r.body && r.body.data) || [];
    rows.push(...data);
    if (!r.body || page >= Number(r.body.total_pages || 0)) break;
  }
  // Agent pages join the sitemap only once they may be indexed (after the lawyer's OK).
  const agents = [];
  if (env.AGENT_PAGES_INDEX === "on") {
    const r = await getJson(api + "/agents");
    agents.push(...((r.body && r.body.data) || []).filter((a) => a && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(a.slug || ""))));
  }
  const urls = [
    "  <url><loc>" + esc(siteUrl + "/") + "</loc><changefreq>daily</changefreq></url>",
    ...agents.map((a) => "  <url><loc>" + esc(siteUrl + "/agents/" + a.slug) + "</loc></url>"),
    ...rows.filter((x) => x && x.id).map((x) => "  <url><loc>" + esc(siteUrl + "/listing/" + encodeURIComponent(x.id)) + "</loc>"
      + (x.updated_at ? "<lastmod>" + esc(String(x.updated_at).slice(0, 10)) + "</lastmod>" : "") + "</url>"),
  ].join("\n");
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + "\n</urlset>\n";
  return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}

function photoResponse(request, body, type) {
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" },
  });
}

async function photoRoute(request, env, key) {
  const missing = (status) => new Response("Photo not found", { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  if (key.split("/").some((part) => part === "." || part === "..")) return missing(404);
  if (env.PHOTOS) {
    const kept = await env.PHOTOS.get(key);
    const type = kept && kept.httpMetadata && kept.httpMetadata.contentType;
    if (kept && PHOTO_TYPES.test(type || "")) return photoResponse(request, kept.body, type);
  }
  let res = null;
  try { res = await fetch(String(env.SUPABASE_URL || DEFAULT_SUPABASE).replace(/\/$/, "") + "/storage/v1/object/public/listing-photos/" + key); } catch (e) { res = null; }
  if (!res) return missing(502);
  if (!res.ok) return missing(res.status >= 500 || res.status === 402 ? 502 : 404);
  const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!PHOTO_TYPES.test(type)) return missing(404);
  const bytes = await res.arrayBuffer();
  if (env.PHOTOS && bytes.byteLength <= PHOTO_KEEP_BYTES) {
    try { await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } }); } catch (e) { /* served anyway; kept next time */ }
  }
  return photoResponse(request, bytes, type);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" || request.method === "HEAD") {
      const m = url.pathname.match(/^\/listing\/([^/]+)\/?$/);
      if (m) {
        let id = "";
        try { id = decodeURIComponent(m[1]); } catch (e) { id = ""; }
        if (id) return listingRoute(request, env, id);
      }
      const a = url.pathname.match(/^\/agents\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
      if (a) return agentRoute(request, env, a[1]);
      if (url.pathname === "/sitemap.xml") return sitemapRoute(env);
      const p = url.pathname.match(PHOTO_PATH);
      if (p) return photoRoute(request, env, p[1]);
    }
    return env.ASSETS.fetch(request);
  },
};
