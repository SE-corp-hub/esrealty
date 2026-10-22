"use strict";

// =====================================================================
//  Market Scan engine (Node.js port of market_scan_server.ps1)
//  Scrapes public property listing pages and returns normalized JSON
//  for the Market Scan view. Runs as a Vercel serverless function.
// =====================================================================

const CACHE_TTL = 900;
const PROBE_TTL = 1800;
const cache = new Map();
const probeCache = new Map();

async function fetchHtml(url, timeoutSec) {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && (now - hit.at) / 1000 < CACHE_TTL) return hit.html;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (timeoutSec || 14) * 1000);
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "en-PH,en;q=0.9"
      }
    });
    const html = await resp.text();
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    cache.set(url, { at: now, html });
    return html;
  } finally {
    clearTimeout(timer);
  }
}

async function getProbe(name, fn) {
  const now = Date.now();
  const hit = probeCache.get(name);
  if (hit && (now - hit.at) / 1000 < PROBE_TTL) return hit.result;
  const result = await fn();
  probeCache.set(name, { at: now, result });
  return result;
}

const NAMED_ENTITIES = {
  ntilde: "ñ", Ntilde: "Ñ", aacute: "á", Aacute: "Á", eacute: "é", Eacute: "É",
  iacute: "í", Iacute: "Í", oacute: "ó", Oacute: "Ó", uacute: "ú", Uacute: "Ú",
  agrave: "à", Agrave: "À", egrave: "è", Egrave: "È", igrave: "ì", Igrave: "Ì",
  ograve: "ò", Ograve: "Ò", ugrave: "ù", Ugrave: "Ù", ccedil: "ç", Ccedil: "Ç",
  uuml: "ü", Uuml: "Ü", ouml: "ö", Ouml: "Ö", auml: "ä", Auml: "Ä",
  szlig: "ß", deg: "°", bull: "•", hellip: "…", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", trade: "™",
};

function htmlDecode(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch (e) { return ""; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return ""; } })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&(ntilde|Ntilde|aacute|Aacute|eacute|Eacute|iacute|Iacute|oacute|Oacute|uacute|Uacute|agrave|Agrave|egrave|Egrave|igrave|Igrave|ograve|Ograve|ugrave|Ugrave|ccedil|Ccedil|uuml|Uuml|ouml|Ouml|auml|Auml|szlig|deg|bull|hellip|ndash|mdash|lsquo|rsquo|ldquo|rdquo|trade);/g, (_, n) => NAMED_ENTITIES[n] || "");
}

function stripTags(s) {
  return htmlDecode(String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function toNumber(raw) {
  if (raw == null || !String(raw).trim()) return 0;
  const t = String(raw).replace(/[^\d.MKB]/g, "");
  let m = t.match(/^([\d.]+)\s*M$/i);
  if (m) return parseFloat(m[1]) * 1e6;
  m = t.match(/^([\d.]+)\s*K$/i);
  if (m) return parseFloat(m[1]) * 1e3;
  m = t.match(/^([\d.]+)\s*B$/i);
  if (m) return parseFloat(m[1]) * 1e9;
  m = t.match(/^([\d.]+)$/);
  if (m) return parseFloat(m[1]);
  return 0;
}

const DP_TYPE = {
  "Vacant Lot": { sale: "land-for-sale", rent: null },
  "House & Lot": { sale: "houses-for-sale", rent: "houses-for-rent" },
  "Townhouse": { sale: "townhouses-for-sale", rent: "townhouses-for-rent" },
  "Condominium Unit": { sale: "condos-for-sale", rent: "condos-for-rent" },
  "Apartment": { sale: "apartments-for-sale", rent: "apartments-for-rent" },
  "Shophouse": { sale: "shophouse-for-sale", rent: "shophouse-for-rent" },
  "Commercial": { sale: "commercial-property-for-sale", rent: "commercial-property-for-rent" },
  "Warehouse": { sale: "warehouses-for-sale", rent: "warehouses-for-rent" },
  "Office": { sale: "offices-for-sale", rent: "offices-for-rent" }
};
const DP_ALL_SALE = ["houses-for-sale"];
const DP_ALL_RENT = ["houses-for-rent"];

const MP_TYPE = {
  "Vacant Lot": { sale: "land", rent: "land" },
  "House & Lot": { sale: "house", rent: "house" },
  "Townhouse": { sale: "townhouse", rent: "townhouse" },
  "Condominium Unit": { sale: "condo", rent: "condo" },
  "Apartment": { sale: "apartment", rent: "apartment" },
  "Commercial": { sale: "commercial", rent: "commercial" },
  "Warehouse": { sale: "warehouse", rent: "warehouse" },
  "Office": { sale: "office", rent: "office" }
};

function propTypeFromTitle(title) {
  const s = " " + String(title || "").toLowerCase() + " ";
  if (s.indexOf("warehouse") >= 0) return "Warehouse";
  if (s.indexOf("townhouse") >= 0) return "Townhouse";
  if (s.indexOf("shophouse") >= 0) return "Shophouse";
  if (s.indexOf("apartment") >= 0) return "Apartment";
  if (s.indexOf("office") >= 0) return "Office";
  if (s.indexOf("commercial") >= 0) return "Commercial";
  if (s.indexOf("condo") >= 0 || s.indexOf("studio") >= 0) return "Condominium Unit";
  if (s.indexOf("house") >= 0) return "House & Lot";
  if (s.indexOf("lot") >= 0 || s.indexOf("land") >= 0) return "Vacant Lot";
  return "";
}

function getDotPropertyPages(type, mode) {
  const m = mode === "rent" ? "rent" : "sale";
  if (!type || !DP_TYPE[type]) return m === "rent" ? DP_ALL_RENT : DP_ALL_SALE;
  const slug = DP_TYPE[type][m];
  return slug ? [slug] : [];
}

// ------------------------------------------------------------ dotproperty parser

function parseDotPropertyCard(card, typeFallback, mode) {
  const out = {
    url: "", title: "", city: "", price: 0, pricePerSqm: 0,
    lotArea: 0, floorArea: 0, bedrooms: 0, bathrooms: 0,
    propertyType: typeFallback, verified: false, description: "",
    image: "", sourceId: "", postedAt: "", scrapedAt: 0, geo: null
  };
  let m = card.match(/href="(https:\/\/www\.dotproperty\.com\.ph\/ads\/[^"]+)"/);
  if (m) {
    out.url = m[1];
    const im = out.url.match(/\/ads\/([^\/]+)-\d+-\d+/);
    if (im) out.sourceId = im[1];
    else out.sourceId = out.url.split("/").pop();
  }
  m = card.match(/src="(https:\/\/pix\.dotproperty\.co\.th\/[^"]+)"/i);
  if (m) out.image = m[1];
  else {
    m = card.match(/<img[^>]+src="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/i);
    if (m) out.image = m[1];
  }
  m = card.match(/<div class="text-2xl font-semibold[^"]*"[^>]*title="([^"]+)"/);
  if (m) out.title = htmlDecode(m[1]);
  m = card.match(/location-[a-z0-9]+\.svg[^>]*>\s*<\/span>\s*([^<]{2,80}?)\s*<\/div>/);
  if (m) out.city = htmlDecode(m[1].trim());
  m = card.match(/class="inline-block text-secondary-base[^"]*"[^>]*>([^<]*)/);
  if (m) out.price = Math.round(toNumber(m[1]));
  m = card.match(/\(?\s*(?:₱)?\s*([\d][\d,.\s]*(?:M|K)?)\s*\/\s*m<sup>2<\/sup>/);
  if (m) out.pricePerSqm = Math.round(toNumber(m[1]));
  let area = 0;
  m = card.match(/resize-[a-z0-9]+\.svg[^>]*>\s*<\/span>\s*([\d][\d,.]*)\s*m<sup>2<\/sup>/);
  if (m) area = toNumber(m[1]);
  m = card.match(/bed-[a-z0-9]+\.svg[^>]*>\s*<\/span>\s*([\d]+)/);
  if (m) out.bedrooms = parseInt(m[1], 10);
  m = card.match(/bathtub-[a-z0-9]+\.svg[^>]*>\s*<\/span>\s*([\d]+)/);
  if (m) out.bathrooms = parseInt(m[1], 10);
  m = card.match(/home-[a-z0-9]+\.svg[^>]*>\s*<\/span>\s*([A-Za-z][A-Za-z &-]+?)\s*<\/li>/);
  if (m) out.propertyType = m[1].trim();
  if (card.indexOf("verified") >= 0) out.verified = true;
  m = card.match(/class="line-clamp-4[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (m) out.description = stripTags(m[1]);
  if (typeFallback === "Vacant Lot" && area > 0) out.lotArea = area;
  else out.floorArea = area;
  return out;
}

async function invokeDotProperty(query) {
  const mode = query.mode === "rent" ? "rent" : "sale";
  const pages = getDotPropertyPages(query.type, mode);
  const all = [];
  const seenUrls = new Set();
  let lastErr = "";
  let lastCount = 0;
  const MAX_PAGES = 8;
  for (const slug of pages) {
    let emptyStreak = 0;
    for (let page = 1; page <= MAX_PAGES && emptyStreak === 0; page++) {
      try {
        const url = "https://www.dotproperty.com.ph/" + slug + (page > 1 ? ("?page=" + page) : "");
        const html = await fetchHtml(url, 14);
        const cards = html.match(/<article\s+class="listing-snippet.*?<\/article>/gs) || [];
        if (cards.length === 0) { emptyStreak++; break; }
        const typeFallback = query.type || String(slug.split("-for-")[0]);
        let fresh = 0;
        for (const c of cards) {
          const parsed = parseDotPropertyCard(c, typeFallback, mode);
          const key = parsed.url ? seenUrls.has(parsed.url) : false;
          if (parsed.url && key) continue;
          if (parsed.url) seenUrls.add(parsed.url);
          all.push(parsed); fresh++;
        }
        lastCount += fresh;
        if (fresh === 0) { emptyStreak++; }
      } catch (err) {
        lastErr = String(err && err.message || err);
        break;
      }
    }
  }
  let status = "ok";
  if (all.length === 0 && lastErr) status = "error";
  return { status, count: all.length, error: lastErr, listings: all };
}

// ------------------------------------------------------------ myproperty parser

function parseMyPropertyListing(x, mode, queryType, pageSlug) {
  let area = 0;
  if (x.floorSize && x.floorSize.value) area = Math.round(toNumber(String(x.floorSize.value)));
  let price = 0;
  if (x.offers) {
    let o = x.offers;
    if (Array.isArray(o) && o.length > 0) o = o[0];
    if (o.price) price = Math.round(toNumber(String(o.price)));
  }
  let beds = 0;
  if (x.numberOfBedrooms) beds = parseInt(x.numberOfBedrooms, 10) || 0;
  let baths = 0;
  if (x.numberOfBathroomsTotal) baths = parseInt(x.numberOfBathroomsTotal, 10) || 0;
  let city = "", region = "", address = "";
  if (x.address) {
    if (x.address.addressLocality) city = htmlDecode(String(x.address.addressLocality));
    if (x.address.addressRegion) region = htmlDecode(String(x.address.addressRegion));
    if (x.address.streetAddress) address = htmlDecode(String(x.address.streetAddress));
  }
  let lat = "", lng = "";
  if (x.geo) { lat = String(x.geo.latitude || ""); lng = String(x.geo.longitude || ""); }

  let ptype = queryType;
  if (!ptype) {
    ptype = propTypeFromTitle(String(x.name || ""));
    if (!ptype && pageSlug) {
      ptype = { land: "Vacant Lot", house: "House & Lot", townhouse: "Townhouse", condo: "Condominium Unit", apartment: "Apartment", commercial: "Commercial", warehouse: "Warehouse", office: "Office" }[pageSlug] || "";
    }
  }

  const out = {
    url: x.url ? String(x.url) : "",
    title: htmlDecode(String(x.name || "")),
    city: city || region || "",
    price: price, pricePerSqm: 0,
    lotArea: 0, floorArea: area,
    bedrooms: beds, bathrooms: baths,
    propertyType: ptype, verified: false,
    description: htmlDecode(String(x.description || "")),
    image: "", sourceId: "", postedAt: "", scrapedAt: 0, geo: null
  };
  const im = x.image;
  if (im) out.image = Array.isArray(im) ? String(im[0] || "") : String(im || "");
  if (out.url) {
    const su = out.url.replace(/[?#].*$/, "").split("/").filter(Boolean).pop() || "";
    out.sourceId = "myp-" + su;
  }
  if (lat && lng) out.geo = { lat: parseFloat(lat), lng: parseFloat(lng) };
  if (ptype === "Vacant Lot" && area > 0) { out.lotArea = area; out.floorArea = 0; }
  if (area > 0 && price > 0 && mode !== "rent") out.pricePerSqm = Math.round(price / area);
  return out;
}

async function invokeMyProperty(query) {
  const mode = query.mode === "rent" ? "rent" : "buy";
  let slug = "";
  if (query.type && MP_TYPE[query.type]) slug = MP_TYPE[query.type][query.mode];
  let url = "https://www.myproperty.ph/" + mode + "/";
  if (slug) url = "https://www.myproperty.ph/" + mode + "/" + slug + "/";
  const all = [];
  let lastErr = "";
  try {
    const html = await fetchHtml(url, 14);
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (m) {
      const obj = JSON.parse(m[1]);
      const about = Array.isArray(obj.about) ? obj.about : [obj.about];
      for (const x of about) {
        if (x) all.push(parseMyPropertyListing(x, query.mode, query.type, slug));
      }
    }
  } catch (err) {
    lastErr = String(err && err.message || err);
  }
  let status = "ok";
  if (all.length === 0 && lastErr) status = "error";
  return { status, count: all.length, error: lastErr, listings: all };
}

// ------------------------------------------------------------ sources that cannot be scanned
// These four never returned a listing: Facebook and Instagram sit behind a login, TikTok serves a
// script-only feed, and Lamudi refuses automated requests. Each scan used to fetch their pages anyway
// (up to 8 seconds each, from the server's address) only to report "blocked". They are listed as not
// available without calling them. The Market Scan screen still shows each one as a chip.
const UNSCANNABLE = {
  lamudi: { label: "Lamudi", status: "blocked", error: "blocks automated requests (HTTP 401); no listings can be read" },
  facebook: { label: "Facebook Marketplace", status: "blocked", error: "requires a Facebook login; not scrapeable without authentication" },
  instagram: { label: "Instagram (#property)", status: "js-only", error: "login wall; no listings exposed to plain requests" },
  tiktok: { label: "TikTok (#property)", status: "js-only", error: "client-rendered feed; no structured property listings" }
};
const unscannable = (name) => Object.assign({ name, count: 0 }, UNSCANNABLE[name]);

// ------------------------------------------------------------ zipmatch

async function invokeZipMatch() {
  return getProbe("zipmatch", async () => {
    try {
      const html = await fetchHtml("https://www.zipmatch.com/buy", 6);
      const n = (html.match(/property-card/g) || []).length;
      return { status: "ok", count: n, error: "", listings: [] };
    } catch (err) {
      return { status: "offline", count: 0, error: "host unreachable from this network", listings: [] };
    }
  });
}

// ------------------------------------------------------------ web search

function searchQueryText(query) {
  const parts = [];
  if (query.type) parts.push(query.type);
  parts.push(query.mode === "rent" ? "for rent" : "for sale");
  if (query.city) parts.push(query.city);
  parts.push("Philippines");
  return parts.join(" ");
}

function newSearchListing(title, url, snippet, query) {
  return {
    url: url, title: title, city: query.city, price: 0, pricePerSqm: 0,
    lotArea: 0, floorArea: 0, bedrooms: 0, bathrooms: 0,
    propertyType: query.type, verified: false, description: snippet,
    image: "", sourceId: "", postedAt: "", scrapedAt: 0, geo: null
  };
}

function safeDecode(u) {
  try { return decodeURIComponent(u); } catch (e) { return u; }
}

// Bing wraps results in /ck/a redirects carrying the real URL as u=a1<base64url>.
function unwrapBingUrl(raw) {
  let u = htmlDecode(String(raw || ""));
  if (!/bing\.com\/ck\/a/i.test(u)) return safeDecode(u);
  try {
    const q = u.slice(u.indexOf("?") + 1);
    for (const part of q.split("&")) {
      const kv = part.split("=");
      if (kv[0] === "u" && kv[1]) {
        let b64 = kv[1];
        if (b64.startsWith("a1")) b64 = b64.slice(2);
        const decoded = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
        if (/^https?:\/\//i.test(decoded)) return decoded;
      }
    }
  } catch (e) { /* fall through */ }
  return htmlDecode(safeDecode(u));
}

function parseSearchHtml(html, engine, query) {
  const list = [];
  const seen = new Set();
  if (engine === "google") {
    const re = /href="\/url\?q=([^&"]+)[^"]*"[^>]*>(?:(?!<\/a>).)*?<h3[^>]*>(.*?)<\/h3>/gs;
    let m;
    while ((m = re.exec(html)) !== null) {
      const u = htmlDecode(safeDecode(m[1]));
      const t = stripTags(m[2]);
      if (/^https?:\/\//.test(u) && t && !seen.has(u)) {
        seen.add(u);
        list.push(newSearchListing(t, u, "", query));
      }
    }
  } else if (engine === "bing") {
    const re = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const u = unwrapBingUrl(m[1]);
      if (!/^https?:\/\//.test(u)) continue;
      const t = stripTags(m[2]);
      if (!t || seen.has(u)) continue;
      seen.add(u);
      list.push(newSearchListing(t, u, stripTags(m[3] || ""), query));
    }
  } else {
    const blocks = html.split(/(?=<div class="result[^"]* web-result)/);
    for (const b of blocks) {
      const am = b.match(/class="result__a" href="([^"]+)"[^>]*>(.*?)<\/a>/gs);
      if (!am) continue;
      let u = htmlDecode(am[1]);
      const mm = u.match(/uddg=([^&]+)/);
      if (mm) u = safeDecode(mm[1]);
      if (!/^https?:\/\//.test(u)) continue;
      const t = stripTags(am[2]);
      if (!t || seen.has(u)) continue;
      const sm = b.match(/class="result__snippet"[^>]*>(.*?)<\/a>/gs);
      const sn = sm ? stripTags(sm[1]) : "";
      seen.add(u);
      list.push(newSearchListing(t, u, sn, query));
    }
  }
  return list;
}

async function invokeWebSearch(query) {
  const qtext = searchQueryText(query);
  const enc = encodeURIComponent(qtext);
  let html = "";
  let err = "";

  try {
    html = await fetchHtml("https://www.google.com/search?num=30&hl=en&q=" + enc, 6);
    const blocked = !html || html.length < 2000 ||
      /unusual traffic|enablejs|\/sorry\/|captcha|not a robot/i.test(html);
    if (blocked) {
      err = "Google blocked the request (bot detection / CAPTCHA); fell back to DuckDuckGo";
      html = "";
    }
  } catch (e) {
    err = "Google request failed (" + String(e && e.message || e) + "); fell back to DuckDuckGo";
    html = "";
  }
  if (html) {
    const list = parseSearchHtml(html, "google", query);
    if (list.length > 0) return { status: "ok", engine: "google", count: list.length, error: "", listings: list };
    err = "Google returned no parseable results; fell back to DuckDuckGo";
    html = "";
  }

  try {
    html = await fetchHtml("https://html.duckduckgo.com/html/?q=" + enc, 10);
    const list = parseSearchHtml(html, "duckduckgo", query);
    if (list.length > 0) return { status: "ok", engine: "duckduckgo", count: list.length, error: err, listings: list };
    err = (err ? err + "; " : "") + "DuckDuckGo returned no results; fell back to Bing";
    html = "";
  } catch (e) {
    err = (err ? err + "; " : "") + "DuckDuckGo failed (" + String(e && e.message || e) + "); fell back to Bing";
    html = "";
  }

  try {
    html = await fetchHtml("https://www.bing.com/search?count=30&q=" + enc, 10);
    const list = parseSearchHtml(html, "bing", query);
    if (list.length > 0) return { status: "ok", engine: "bing", count: list.length, error: err, listings: list };
    return { status: "blocked", engine: "bing", count: 0, error: "Bing returned no parseable results", listings: [] };
  } catch (e) {
    return { status: "blocked", engine: "bing", count: 0, error: "Bing failed: " + String(e && e.message || e), listings: [] };
  }
}

async function bingSiteSearch(qtext) {
  const enc = encodeURIComponent(qtext);
  const html = await fetchHtml("https://www.bing.com/search?count=30&q=" + enc, 10);
  const list = [];
  const seen = new Set();
  const re = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = unwrapBingUrl(m[1]);
    if (!/^https?:\/\//.test(url) || seen.has(url)) continue;
    const title = stripTags(m[2]);
    if (!title) continue;
    const snippet = stripTags(m[3] || "");
    seen.add(url);
    list.push({ url: url, title: title, snippet: snippet });
  }
  return list;
}

async function invokeFacebookPublicSearch(query) {
  const qtext = searchQueryText(query) + " site:facebook.com";
  try {
    const list = await bingSiteSearch(qtext);
    const fb = list.filter((l) => /^https?:\/\/(?:www\.|m\.)?facebook\.com\//.test(l.url));
    const items = fb.map((l) => newSearchListing(l.title, l.url, l.snippet, query));
    if (items.length > 0) return { status: "ok", engine: "Bing", count: items.length, error: "", listings: items };
    return { status: "blocked", engine: "Bing", count: 0, error: "Bing returned no publicly indexed Facebook property posts for this search", listings: [] };
  } catch (err) {
    return { status: "blocked", engine: "Bing", count: 0, error: "Bing Facebook-post search failed: " + String(err && err.message || err), listings: [] };
  }
}

async function invokeIndexedListingSite(query, site, label) {
  const qtext = searchQueryText(query) + " site:" + site;
  const pattern = new RegExp("^https?://(?:www\\.)?" + site.replace(/\./g, "\\.") + "/");
  try {
    const list = await bingSiteSearch(qtext);
    const items = list.filter((l) => pattern.test(l.url)).map((l) => newSearchListing(l.title, l.url, l.snippet, query));
    if (items.length > 0) return { status: "ok", engine: "Bing", count: items.length, error: "", listings: items };
    return { status: "blocked", engine: "Bing", count: 0, error: "Bing returned no publicly indexed " + label + " listings for this search", listings: [] };
  } catch (err) {
    return { status: "blocked", engine: "Bing", count: 0, error: label + " search failed: " + String(err && err.message || err), listings: [] };
  }
}

// ------------------------------------------------------------ filtering

// The UI offers a fixed set of property types, but listings spell them every
// possible way ("Condo", "Condominium Unit", "Studio", "2BR Condo"). Matching
// the raw strings meant a "Condo" listing was not a "Condominium Unit" result,
// so the Type filter silently dropped valid rows. These groups let the two
// sides agree on what counts as the same kind of property.
const TYPE_GROUPS = [
  ["condo", "condominium", "condominium unit", "apartment", "flat", "studio", "unit"],
  ["house", "house and lot", "house & lot", "single family", "residential", "bungalow"],
  ["lot", "vacant lot", "vacant land", "land", "residential lot"],
  ["townhouse", "town house", "row house", "rowhome"],
  ["commercial", "commercial lot", "shop", "shophouse", "retail", "office", "warehouse", "industrial"]
];

// Words that carry no discriminating power in a listing title.
const TYPE_STOPWORDS = new Set(["for", "sale", "rent", "rented", "in", "at", "the", "a", "an", "and", "with", "new", "used", "ready", "occupancy", "freehold"]);

function normTypeText(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// Returns the group index a type string belongs to, or -1.
function typeGroupOf(s) {
  const t = normTypeText(s);
  if (!t) return -1;
  for (let i = 0; i < TYPE_GROUPS.length; i++) {
    if (TYPE_GROUPS[i].indexOf(t) >= 0) return i;
  }
  // Fall back to token overlap so "2 Bedroom Condominium Unit" still resolves.
  const toks = t.split(" ").filter((w) => w && !TYPE_STOPWORDS.has(w));
  if (!toks.length) return -1;
  for (let i = 0; i < TYPE_GROUPS.length; i++) {
    const g = new Set(TYPE_GROUPS[i].map(normTypeText));
    let hit = 0;
    for (const w of toks) if (g.has(w)) hit++;
    if (hit > 0 && hit >= Math.ceil(toks.length / 2)) return i;
  }
  return -1;
}

function typeMatches(l, wantType) {
  const want = normTypeText(wantType);
  if (!want) return true;
  const wg = typeGroupOf(want);
  const propType = (l && (l.propertyType || l.type)) || "";
  const hay = normTypeText(propType + " " + (l && l.title));
  if (!hay) return false;
  if (wg < 0) {
    // Unknown requested type: fall back to a literal containment test rather
    // than dropping everything.
    return hay.indexOf(want) >= 0;
  }
  // The declared propertyType is the authoritative signal. Scoring the whole
  // title instead meant a long title diluted the match below threshold and a
  // genuine "Condo" was rejected for "Condominium Unit".
  const pg = typeGroupOf(propType);
  if (pg >= 0) return pg === wg;
  // No usable propertyType: any group word in the title is enough.
  const lg = typeGroupOf(hay);
  return lg === wg;
}

function testListingMatch(l, query) {
  const city = String(query.city || "");
  if (city.trim()) {
    const hay = (l.city + " " + l.title).toLowerCase();
    const needle = city.trim().toLowerCase();
    if (hay.indexOf(needle) < 0) return false;
  }
  /* Type was the one filter the server never applied. The client filtered on it
   * after the response, which meant the reported match count ignored it
   * entirely - so narrowing Type could *increase* the count, because the
   * source-only cap re-rolled a different set of rows. Applying it here, before
   * the cap, makes the result set a genuine subset. */
  if (!typeMatches(l, query.type)) return false;
  if (l.price > 0) {
    const min = query.minPrice, max = query.maxPrice;
    if (min > 0 && l.price < min) return false;
    if (max > 0 && l.price > max) return false;
  }
  const minArea = query.minArea;
  if (minArea > 0) {
    const area = l.lotArea > 0 ? l.lotArea : (l.floorArea > 0 ? l.floorArea : 0);
    if (area < minArea) return false;
  }
  const minBeds = query.minBeds;
  if (minBeds > 0 && l.bedrooms < minBeds) return false;
  return true;
}

function mergeQueryDefaults(q) {
  q = q || {};
  const d = {
    city: String(q.city || ""),
    province: String(q.province || ""),
    region: String(q.region || ""),
    type: String(q.type || ""),
    mode: String(q.mode || "").toLowerCase() === "rent" ? "rent" : "sale",
    minPrice: 0, maxPrice: 0, minArea: 0, minBeds: 0, maxResults: 40, live: true
  };
  const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(/,/g, "").trim()); return isNaN(n) ? 0 : n; };
  d.minPrice = Math.max(0, num(q.minPrice));
  d.maxPrice = Math.max(0, num(q.maxPrice));
  d.minArea = Math.max(0, num(q.minArea));
  d.minBeds = Math.max(0, Math.round(num(q.minBeds)));
  d.maxResults = Math.max(1, Math.round(num(q.maxResults))) || 40;
  if (String(q.live).trim() === "0" || String(q.live).trim() === "false") d.live = false;
  return d;
}

// ------------------------------------------------------------ handler

async function runMarketScan(query) {
  const q = mergeQueryDefaults(query);
  const start = Date.now();
  const sources = [];
  const listings = [];

  const dot = { status: "skipped", count: 0, error: "", listings: [] };
  const mp = { status: "skipped", count: 0, error: "", listings: [] };
  if (q.live) {
    dot.status = "running"; dot.count = 0;
    try {
      const r = await invokeDotProperty(q);
      dot.status = r.status; dot.count = r.count; dot.error = r.error;
      for (const l of r.listings) { l.source = "dotproperty"; l.sourceLabel = "DotProperty.com.ph"; listings.push(l); }
    } catch (err) {
      dot.status = "error"; dot.error = String(err && err.message || err);
    }
    mp.status = "running";
    try {
      const r = await invokeMyProperty(q);
      mp.status = r.status; mp.count = r.count; mp.error = r.error;
      for (const l of r.listings) { l.source = "myproperty"; l.sourceLabel = "MyProperty.ph"; listings.push(l); }
    } catch (err) {
      mp.status = "error"; mp.error = String(err && err.message || err);
    }
  }
  sources.push({ name: "dotproperty", label: "DotProperty.com.ph", status: dot.status, count: dot.count, error: dot.error });
  sources.push({ name: "myproperty", label: "MyProperty.ph", status: mp.status, count: mp.count, error: mp.error });

  const running = (s) => s.status === "running";

  if (q.live) {
    if (!running(dot) && !running(mp)) {
      // Fire every secondary source in parallel — wall time ≈ slowest single probe.
      const jobs = {
        websearch: invokeWebSearch(q),
        facebookpublic: invokeFacebookPublicSearch(q),
        onepropertee: invokeIndexedListingSite(q, "onepropertee.com", "OnePropertee"),
        carousell: invokeIndexedListingSite(q, "carousell.ph", "Carousell Philippines"),
        zipmatch: invokeZipMatch()
      };
      const settled = {};
      await Promise.all(Object.keys(jobs).map(async k => {
        settled[k] = await jobs[k].catch(e => ({ status: "error", count: 0, error: String(e && e.message || e), engine: "", listings: [] }));
      }));

      const ws = settled.websearch;
      const wsEngine = ws.engine === "google" ? "Google" : (ws.engine === "bing" ? "Bing" : "DuckDuckGo");
      sources.push({ name: "websearch", label: "Web Search (" + wsEngine + ")", status: ws.status, count: ws.count, error: ws.error });
      for (const l of ws.listings) { l.source = "websearch"; l.sourceLabel = "Web Search · " + wsEngine; listings.push(l); }

      const fbPublic = settled.facebookpublic;
      const fbEngine = fbPublic.engine || "Bing";
      sources.push({ name: "facebookpublic", label: "Facebook Public Posts (" + fbEngine + ")", status: fbPublic.status, count: fbPublic.count, error: fbPublic.error });
      for (const l of fbPublic.listings) { l.source = "facebookpublic"; l.sourceLabel = "Facebook Public Post · " + fbEngine; listings.push(l); }

      for (const site of [
        { key: "onepropertee", label: "OnePropertee" },
        { key: "carousell", label: "Carousell Philippines" }
      ]) {
        const siteResult = settled[site.key];
        const eng = siteResult.engine || "Bing";
        sources.push({ name: site.key, label: site.label + " (" + eng + ")", status: siteResult.status, count: siteResult.count, error: siteResult.error });
        for (const l of siteResult.listings) { l.source = site.key; l.sourceLabel = site.label + " · " + eng; listings.push(l); }
      }

      sources.push(unscannable("lamudi"));

      const zip = settled.zipmatch;
      sources.push({ name: "zipmatch", label: "ZipMatch", status: zip.status, count: zip.count, error: zip.error });

      sources.push(unscannable("facebook"), unscannable("instagram"), unscannable("tiktok"));
    }
  }

  // Cross-source dedupe: same URL (or same title+city when urlless) counted once.
  const seenKey = new Set();
  const uniq = [];
  for (const l of listings) {
    let k = String(l.url || "").replace(/[?#].*$/, "");
    if (!k) k = "t|" + (l.title || "").toLowerCase().slice(0, 90) + "|" + (l.city || "").toLowerCase();
    if (seenKey.has(k)) continue;
    seenKey.add(k);
    uniq.push(l);
  }

  const filtered = uniq.filter((l) => testListingMatch(l, q));
  return {
    ok: true,
    query: {
      city: q.city, province: q.province, region: q.region, type: q.type, mode: q.mode,
      minPrice: q.minPrice, maxPrice: q.maxPrice,
      minArea: q.minArea, minBeds: q.minBeds,
      maxResults: q.maxResults, live: q.live
    },
    sources: sources,
    total: filtered.length,
    shown: Math.min(q.maxResults, filtered.length),
    listings: filtered.slice(0, q.maxResults),
    elapsedMs: Date.now() - start,
    serverTime: new Date().toISOString().slice(0, 19)
  };
}

module.exports = {
  runMarketScan, testListingMatch, mergeQueryDefaults, searchQueryText, htmlDecode, bingSiteSearch
};
