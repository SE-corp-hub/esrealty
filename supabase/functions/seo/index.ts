import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// The production site (Cloudflare). SITE_URL overrides it.
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://esrealty.tradersgag6.workers.dev").replace(/\/$/, "");
// Canonical host + platform prefix that serves the crawlable per-property
// pages. Omitting the /functions/v1 prefix makes sitemap URLs 404 from Google.
const EDGE_ORIGIN = "https://mrngaqtbaseewzcsogqi.supabase.co/functions/v1";

const PUBLIC_COLUMNS = [
  "id", "title", "description", "property_type", "offer_type", "status",
  "price", "rent", "address", "barangay", "city", "province", "latitude", "longitude",
  "bedrooms", "bathrooms", "floor_area_sqm", "lot_size_sqm", "images",
  "updated_at", "published_at", "agent_name",
].join(",");

function esc(s: string) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function money(v: unknown) {
  const n = Number(v || 0);
  if (!n) return "";
  return "PHP " + n.toLocaleString("en-PH");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function html(body: string) {
  return new Response(body, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
}

// The catalog's images are objects ({ url, altText, ... }); older rows may
// hold plain URL strings.
function imageUrls(l: any): string[] {
  if (!Array.isArray(l.images)) return [];
  return l.images
    .map((x: any) => (typeof x === "string" ? x : x && x.url) || "")
    .filter((u: string) => /^https:/.test(u));
}

// Rentals are priced by `rent`; sales by `price`.
function listPrice(l: any) {
  return Number((l.offer_type === "rent" ? l.rent : l.price) || 0);
}

function listingJsonLd(l: any, url: string) {
  const imgs = imageUrls(l).slice(0, 5);
  const isRent = l.offer_type === "rent";
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: l.title,
    description: l.description || `${l.property_type} for ${isRent ? "rent" : "sale"} in ${l.city || "the Philippines"}.`,
    url,
    image: imgs,
    datePosted: l.published_at,
    address: { "@type": "PostalAddress", streetAddress: [l.address, l.barangay].filter(Boolean).join(", "), addressLocality: l.city, addressRegion: l.province, addressCountry: "PH" },
    ...(l.latitude && l.longitude ? { geo: { "@type": "GeoCoordinates", latitude: l.latitude, longitude: l.longitude } } : {}),
    offers: {
      "@type": "Offer",
      priceCurrency: "PHP",
      price: listPrice(l),
      availability: "https://schema.org/InStock",
      url,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", SERVICE_KEY);

  // ── /sitemap.xml ───────────────────────────────────────────────────
  if (url.pathname.endsWith("/sitemap.xml")) {
    const r = await supabase.from("public_listing_catalog")
      .select("id,updated_at").eq("status", "available").order("published_at", { ascending: false }).limit(2000);
    const rows = r.data ?? [];
    const today = new Date().toISOString().slice(0, 10);
    // Only the canonical crawlable pages (served by this function at
    // /seo/property/<id>). Listing them once avoids duplicate-URL penalties.
    const urls = rows.map(x =>
      `  <url><loc>${EDGE_ORIGIN}/seo/property/${esc(x.id)}</loc><lastmod>${String(x.updated_at || today).slice(0, 10)}</lastmod><changefreq>daily</changefreq></url>`
    ).join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
    return new Response(xml, { status: 200, headers: { ...corsHeaders, "Content-Type": "application/xml" } });
  }

  // ── /robots.txt ────────────────────────────────────────────────────
  if (url.pathname.endsWith("/robots.txt")) {
    const txt = `User-agent: *\nAllow: /\nSitemap: ${EDGE_ORIGIN}/seo/sitemap.xml\n`;
    return new Response(txt, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
  }

  // ── /property/<id> → meta-rich HTML that redirects into the SPA ────
  const m = url.pathname.match(/\/property\/([^/?#]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const r = await supabase.from("public_listing_catalog")
      .select(PUBLIC_COLUMNS).eq("id", id).eq("status", "available").maybeSingle();
    if (!r.data) return html(`<!doctype html><title>Listing not found</title><meta http-equiv="refresh" content="1;url=${SITE_URL}/">`);
    const l: any = r.data;
    const spaUrl = `${SITE_URL}/#/listing/${encodeURIComponent(id)}`;
    const canonicalUrl = `${EDGE_ORIGIN}/seo/property/${id}`;
    const img = imageUrls(l)[0] || "";
    const desc = (l.description || "").slice(0, 300) || `${l.property_type} for ${l.offer_type === "rent" ? "rent" : "sale"} in ${[l.city, l.province].filter(Boolean).join(", ")}.`;
    const priceTxt = money(listPrice(l)) + (l.offer_type === "rent" ? "/mo" : "");
    // `<` is escaped so a `</script>` inside listing text cannot break out of
    // the ld+json block; the escapes are valid JSON and decode back to `<`.
    const ld = JSON.stringify(listingJsonLd(l, canonicalUrl)).replace(/</g, "\\u003c");
    const out = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${esc(l.title)} — SEA ESTATES</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonicalUrl)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(l.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonicalUrl)}">
${img ? `<meta property="og:image" content="${esc(img)}">` : ""}
<meta property="og:price:amount" content="${listPrice(l)}">
<meta property="og:price:currency" content="PHP">
<meta name="twitter:card" content="${img ? "summary_large_image" : "summary"}">
<script type="application/ld+json">${ld}</script>
<meta http-equiv="refresh" content="0;url=${esc(spaUrl)}">
</head><body>
<p style="font-family:sans-serif">Opening <b>${esc(l.title)}</b> (${priceTxt})…</p>
<p style="font-family:sans-serif;font-size:14px;color:#666">If nothing happens, <a href="${esc(spaUrl)}">click here</a>.</p>
<script>location.replace(${JSON.stringify(spaUrl).replace(/</g, "\\u003c")});</script>
</body></html>`;
    return html(out);
  }

  return json({ ok: true, hint: "GET /property/:id | /sitemap.xml | /robots.txt" });
});
