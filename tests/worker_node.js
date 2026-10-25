/* The site's Cloudflare Worker (worker/index.js): listing share pages, the sitemap, the
 * security headers, and what it must never serve. Runs the Worker in Node with a fake asset
 * server and a fake listing function.
 *
 *   node tests/worker_node.js
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const c = (name, ok, detail) => {
  if (ok) { pass++; console.log("[PASS] " + name); }
  else { fail++; console.log("[FAIL] " + name + (detail ? " — " + detail : "")); }
};

const SHELL = read("index.html");
const LISTING = {
  id: "L-77", title: "Corner lot </script><b>near</b> Lipa", description: "300 sqm corner lot, clean title.",
  property_type: "Lot", offer_type: "sale", price: 2850000, barangay: "Sabang", city: "Lipa City", province: "Batangas",
  images: [{ url: "https://x.supabase.co/storage/v1/object/public/listing-photos/a.jpg" }], updated_at: "2026-10-20T01:00:00Z",
};

const AGENT = { slug: "maria-santos", name: "Maria Santos <Dela Cruz>", role_label: "PRC-accredited real estate salesperson", pitch: "Lots and homes in Lipa.",
  towns: ["lipa-city", "malvar"], photo: "https://x.supabase.co/storage/v1/object/public/listing-photos/u/p.jpg", contacts: { call: "+639171234567" },
  licence: { no: "0012345", valid_until: "2027-08-31", checked_on: "2026-10-12" },
  og_image: "https://x.supabase.co/storage/v1/object/public/listing-photos/u/agent-card-1.png" };

function setup(mode) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push(String(url));
    if (mode === "slow") {
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    if (mode === "down") throw new Error("unreachable");
    const u = new URL(url);
    if (/\/storage\/v1\/object\/public\/listing-photos\//.test(u.pathname)) {
      if (mode === "restricted") return new Response("restricted", { status: 402 });
      if (/page\.html$/.test(u.pathname)) return new Response("<script>alert(1)</script>", { status: 200, headers: { "Content-Type": "text/html" } });
      if (/gone\.jpg$/.test(u.pathname)) return new Response("{}", { status: 400 });
      return new Response(new Uint8Array([255, 216, 255, 1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg" } });
    }
    if (/\/agents$/.test(u.pathname)) return new Response(JSON.stringify({ data: [{ slug: "maria-santos" }, { slug: "Bad Slug" }], total: 2 }), { status: 200 });
    if (/\/agents\/maria-santos$/.test(u.pathname)) return new Response(JSON.stringify({ data: AGENT }), { status: 200 });
    if (/\/agents\/[^/]+$/.test(u.pathname)) return new Response(JSON.stringify({ error: "Agent not found" }), { status: 404 });
    if (/\/listings\/L-77$/.test(u.pathname)) return new Response(JSON.stringify({ data: LISTING }), { status: 200 });
    if (/\/listings\/[^/]+$/.test(u.pathname)) return new Response(JSON.stringify({ error: "Listing not found" }), { status: 404 });
    if (/\/listings$/.test(u.pathname)) {
      const page = Number(u.searchParams.get("page"));
      return new Response(JSON.stringify({ data: page === 1 ? [LISTING, { id: "B 2", updated_at: "2026-10-01" }] : [{ id: "C3" }], total_pages: 2 }), { status: 200 });
    }
    return new Response("?", { status: 500 });
  };
  const assets = [];
  const env = {
    SITE_URL: "https://sea.example/",
    ASSETS: { fetch: async (req) => { assets.push(new URL(req.url).pathname); return new Response(SHELL, { status: 200, headers: { "Content-Type": "text/html" } }); } },
  };
  return { env, calls, assets };
}

(async () => {
  const worker = (await import(path.join(ROOT, "worker", "index.js"))).default;
  const mod = await import(path.join(ROOT, "worker", "index.js"));

  // A listing share page.
  let s = setup("ok");
  let res = await worker.fetch(new Request("https://sea.example/listing/L-77"), s.env);
  let body = await res.text();
  c("share page answers 200 with HTML", res.status === 200 && /text\/html/.test(res.headers.get("content-type")));
  c("it is the normal site page (the app loads as usual)", body.includes('src="js/storefront.js"') && body.includes('src="js/app.min.js"'));
  c("it adds <base href=\"/\"> so relative files load from /listing/...", /<head[^>]*>\s*<base href="\/">/.test(body));
  c("the title is the listing's", /<title>Corner lot &lt;\/script&gt;&lt;b&gt;near&lt;\/b&gt; Lipa \| SEA ESTATES<\/title>/.test(body), (body.match(/<title>.*?<\/title>/) || [])[0]);
  c("only one title and one description", (body.match(/<title>/g) || []).length === 1 && (body.match(/<meta name="description"/g) || []).length === 1);
  c("Facebook gets title, description, photo and the share address",
    body.includes('<meta property="og:title" content="Corner lot &lt;/script&gt;&lt;b&gt;near&lt;/b&gt; Lipa">')
    && body.includes('<meta property="og:description" content="300 sqm corner lot, clean title.">')
    && body.includes('<meta property="og:image" content="https://x.supabase.co/storage/v1/object/public/listing-photos/a.jpg">')
    && body.includes('<meta property="og:url" content="https://sea.example/listing/L-77">'));
  c("the canonical address is the site's own", body.includes('<link rel="canonical" href="https://sea.example/listing/L-77">'));
  c("a large preview card when there is a photo", body.includes('<meta name="twitter:card" content="summary_large_image">'));
  const ld = (body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1] || "";
  c("schema.org data cannot be closed by listing text", ld && !/<\/script/i.test(ld) && JSON.parse(ld).name === LISTING.title && JSON.parse(ld)["@type"] === "RealEstateListing");
  c("crawlers without scripts get a short summary", /<noscript><h1>Corner lot &lt;\/script&gt;/.test(body) && body.includes("PHP 2,850,000"));
  c("the listing is read without counting a view (?count=0)", s.calls.some((u) => /\/listings\/L-77\?count=0$/.test(u)), s.calls.join(" "));
  c("the page carries the same security headers as _headers", res.headers.get("content-security-policy") === mod.SECURITY_HEADERS["Content-Security-Policy"] && res.headers.get("x-frame-options") === "DENY");

  // Missing listing.
  s = setup("ok");
  res = await worker.fetch(new Request("https://sea.example/listing/gone-1"), s.env);
  body = await res.text();
  c("a missing listing answers 404 with noindex, still showing the site", res.status === 404 && body.includes('<meta name="robots" content="noindex">') && body.includes("js/app.min.js"));

  // Slow or down: never hang, never break.
  s = setup("slow");
  const t0 = Date.now();
  res = await worker.fetch(new Request("https://sea.example/listing/L-77"), s.env);
  body = await res.text();
  c("a slow listing function: the plain site page after about 1.5 s", res.status === 200 && Date.now() - t0 < 3000 && body.includes("<base href=\"/\">") && !body.includes("og:url"), (Date.now() - t0) + " ms");
  s = setup("down");
  res = await worker.fetch(new Request("https://sea.example/listing/L-77"), s.env);
  c("listing function down: the plain site page", res.status === 200 && (await res.text()).includes("js/app.min.js"));

  // Everything else goes to the asset server untouched.
  s = setup("ok");
  res = await worker.fetch(new Request("https://sea.example/css/styles.css"), s.env);
  c("other paths are served by the asset server", s.assets.includes("/css/styles.css") && s.calls.length === 0);
  res = await worker.fetch(new Request("https://sea.example/listing/%E0"), s.env);
  c("a broken address is passed to the asset server, not a crash", res.status === 200);

  // Agent pages.
  s = setup("ok");
  res = await worker.fetch(new Request("https://sea.example/agents/maria-santos"), s.env);
  body = await res.text();
  c("an agent page answers 200 with the agent's name and role as the title", res.status === 200 && body.includes("<title>Maria Santos &lt;Dela Cruz&gt;, PRC-accredited real estate salesperson | SEA ESTATES</title>"));
  c("Facebook gets the agent's pitch, the 1200 x 630 preview image and the address", body.includes('<meta property="og:description" content="Lots and homes in Lipa.">')
    && body.includes('<meta property="og:image" content="https://x.supabase.co/storage/v1/object/public/listing-photos/u/agent-card-1.png">') && body.includes('<meta property="og:image:width" content="1200">')
    && body.includes('<link rel="canonical" href="https://sea.example/agents/maria-santos">'));
  c("the photo is still the person's image in the page data", body.includes('"image":"https://x.supabase.co/storage/v1/object/public/listing-photos/u/p.jpg"'));
  const ald = JSON.parse((body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1] || "{}");
  c("schema.org says it is a real estate agent serving those towns", ald["@type"] === "RealEstateAgent" && ald.areaServed && ald.areaServed[0].name === "Lipa City, Batangas" && ald.telephone === "+639171234567");
  c("agent pages carry noindex until the lawyer's OK", body.includes('<meta name="robots" content="noindex">'));
  c("the agent is read without counting a visit", s.calls.some((u) => /\/agents\/maria-santos\?count=0$/.test(u)));
  res = await worker.fetch(new Request("https://sea.example/agents/maria-santos"), Object.assign({}, s.env, { AGENT_PAGES_INDEX: "on" }));
  c("after the OK (AGENT_PAGES_INDEX on), search engines may index them", !(await res.text()).includes('content="noindex"'));
  res = await worker.fetch(new Request("https://sea.example/agents/not-public"), s.env);
  body = await res.text();
  c("a page that is not public answers 410 Gone with noindex, still showing the site", res.status === 410 && body.includes('content="noindex"') && body.includes("js/app.min.js"));
  s = setup("ok");
  res = await worker.fetch(new Request("https://sea.example/agents/Bad_Slug"), s.env);
  c("a malformed agent address goes to the asset server", s.assets.includes("/agents/Bad_Slug") && s.calls.length === 0);

  // Sitemap.
  s = setup("ok");
  res = await worker.fetch(new Request("https://sea.example/sitemap.xml"), s.env);
  body = await res.text();
  c("sitemap lists the home page and every available listing on the site's address",
    res.status === 200 && /application\/xml/.test(res.headers.get("content-type"))
    && body.includes("<loc>https://sea.example/</loc>") && body.includes("<loc>https://sea.example/listing/L-77</loc><lastmod>2026-10-20</lastmod>")
    && body.includes("<loc>https://sea.example/listing/B%202</loc>") && body.includes("<loc>https://sea.example/listing/C3</loc>"), body);
  c("sitemap pages through the listings and asks only for available ones", s.calls.filter((u) => /status=available&per_page=50&page=/.test(u)).length === 2);
  c("agent pages stay out of the sitemap until they may be indexed", !body.includes("/agents/") && !s.calls.some((u) => /\/agents$/.test(new URL(u).pathname)));
  s = setup("ok");
  s.env.AGENT_PAGES_INDEX = "on";
  res = await worker.fetch(new Request("https://sea.example/sitemap.xml"), s.env);
  body = await res.text();
  c("once indexing is on, every published agent page is in the sitemap (well-formed addresses only)",
    body.includes("<loc>https://sea.example/agents/maria-santos</loc>") && !body.includes("Bad Slug") && !body.includes("Bad%20Slug"), body);

  // Photos through R2.
  const r2 = () => {
    const kept = new Map();
    return { kept, get: async (k) => (kept.has(k) ? { body: kept.get(k).bytes, httpMetadata: { contentType: kept.get(k).type } } : null), put: async (k, bytes, o) => { kept.set(k, { bytes, type: o.httpMetadata.contentType }); } };
  };
  s = setup("ok");
  s.env.PHOTOS = r2();
  s.env.SUPABASE_URL = "https://ref.supabase.co/";
  res = await worker.fetch(new Request("https://sea.example/photos/user-1/abc-full.jpg"), s.env);
  let bytes = new Uint8Array(await res.arrayBuffer());
  c("a photo's first view is fetched once from Supabase Storage and kept in R2",
    res.status === 200 && res.headers.get("content-type") === "image/jpeg" && bytes.length === 6 && s.env.PHOTOS.kept.has("user-1/abc-full.jpg")
    && s.calls.length === 1 && s.calls[0] === "https://ref.supabase.co/storage/v1/object/public/listing-photos/user-1/abc-full.jpg", s.calls.join(" "));
  c("photos are cached for a year (upload paths are never reused)", /max-age=31536000, immutable/.test(res.headers.get("cache-control")) && res.headers.get("x-content-type-options") === "nosniff");
  res = await worker.fetch(new Request("https://sea.example/photos/user-1/abc-full.jpg"), s.env);
  c("later views come from R2 without touching Supabase", res.status === 200 && (await res.arrayBuffer()).byteLength === 6 && s.calls.length === 1);
  res = await worker.fetch(new Request("https://sea.example/photos/user-1/page.html"), s.env);
  c("a file that is not an image is never served from the site's address, nor kept", res.status === 404 && !s.env.PHOTOS.kept.has("user-1/page.html") && !/script/.test(await res.text()));
  res = await worker.fetch(new Request("https://sea.example/photos/user-1/gone.jpg"), s.env);
  c("a missing photo answers 404 and is not cached", res.status === 404 && res.headers.get("cache-control") === "no-store");
  s = setup("restricted");
  s.env.PHOTOS = r2();
  res = await worker.fetch(new Request("https://sea.example/photos/user-1/abc-full.jpg"), s.env);
  c("Storage refusing (quota) answers 502, not a broken image cached for a year", res.status === 502 && res.headers.get("cache-control") === "no-store");
  s = setup("ok");
  res = await worker.fetch(new Request("https://sea.example/photos/user-1/abc-full.jpg"), s.env);
  c("without the R2 bucket the photo is still served (straight from Supabase)", res.status === 200 && s.calls.length === 1);
  s = setup("ok");
  res = await worker.fetch(new Request("https://sea.example/photos/a/b/c.jpg"), s.env);
  c("other /photos/ paths go to the asset server", s.assets.includes("/photos/a/b/c.jpg") && s.calls.length === 0);

  const api = read("supabase/functions/listing-api/index.ts");
  c("listing-api sends photo links through the Worker only once PHOTO_BASE is set",
    /new Response\(photoLinks\(JSON\.stringify\(body\)\)/.test(api) && /PHOTO_BASE && text\.includes\(PHOTO_FROM\)/.test(api)
    && /\/storage\/v1\/object\/public\/listing-photos\/`/.test(api));

  // Headers parity with _headers, and the files the Worker must never serve.
  const block = (read("_headers").split(/\r?\n\/\*\r?\n/)[1] || "").split(/\r?\n\r?\n/)[0];
  const fromFile = Object.fromEntries(block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
  c("the Worker's security headers equal the \"/*\" block in _headers", JSON.stringify(fromFile) === JSON.stringify(mod.SECURITY_HEADERS),
    "update SECURITY_HEADERS in worker/index.js when _headers changes");
  const ignore = read(".assetsignore").split(/\r?\n/).map((l) => l.trim());
  c("the Worker's code and settings are never served as files", ["worker", "wrangler.jsonc", ".git", ".assetsignore"].every((x) => ignore.includes(x)));
  const cfg = read("wrangler.jsonc");
  c("only share pages, the sitemap and photos reach the Worker; everything else is plain files", /"run_worker_first": \["\/listing\/\*", "\/agents\/\*", "\/sitemap\.xml", "\/photos\/\*"\]/.test(cfg) && /"main": "worker\/index\.js"/.test(cfg));
  c("robots.txt points to the site's own sitemap", /^Sitemap: https:\/\/esrealty\.tradersgag6\.workers\.dev\/sitemap\.xml$/m.test(read("robots.txt")));

  const sf = read("js/storefront.js");
  c("on path pages, #/ links change the route in place and #id links stay on the page",
    /if \(href\.indexOf\("#\/"\) === 0\) \{ event\.preventDefault\(\); location\.hash = href\.slice\(1\); return; \}/.test(sf)
    && /spot\.focus\(\{ preventScroll: true \}\)/.test(sf) && /if \(location\.pathname === "\/" \|\|/.test(sf));

  console.log(fail ? fail + "/" + (pass + fail) + " FAILED" : "ALL GREEN (" + pass + " checks)");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("[FAIL] worker test crashed — " + (e && e.stack || e)); process.exit(1); });
