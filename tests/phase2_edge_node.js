// Phase 2, server functions and jobs (2026-10-21). Pure helpers are cut out of the real
// source and run; the rest is checked in the source so the pieces cannot drift back.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? "  " + detail : "")); passed++; console.log("[PASS] " + name); };

// ---- listing-api -------------------------------------------------------------------------------
const api = read("supabase/functions/listing-api/index.ts");
const likeSrc = /const likeLiteral = [^\n]*/.exec(api)[0].replace("(value: string)", "(value)");
const { likeLiteral } = new Function(likeSrc + "\nreturn { likeLiteral };")();
ok("text filter: a plain place name is unchanged", likeLiteral("Lipa City") === "Lipa City");
ok("text filter: % is matched as a character, not a pattern", likeLiteral("100%") === "100\\%");
ok("text filter: _ is matched as a character", likeLiteral("a_b") === "a\\_b");
ok("text filter: * (the API's wildcard) is dropped", likeLiteral("Li*pa") === "Lipa");
ok("text filter: a lone % cannot list every row", likeLiteral("%") === "\\%");
ok("text filter: backslash is escaped first", likeLiteral("a\\b") === "a\\\\b");
ok("city, region and province filters use it", /ilike\("city", likeLiteral\(city\)\)/.test(api) && /ilike\("region", likeLiteral\(region\)\)/.test(api) && /ilike\("province", likeLiteral\(state\)\)/.test(api));

const phoneSrc = /const looksLikePhone = [\s\S]*?\n};/.exec(api)[0].replace("(text: string)", "(text)");
const { looksLikePhone } = new Function(phoneSrc + "\nreturn { looksLikePhone };")();
["0917 123 4567", "+63 917 123 4567", "(043) 723-1234", "09171234567", "043-723-1234 / 0917-123-4567"].forEach(p => ok("phone accepted: " + p, looksLikePhone(p)));
["", "abc", "123", "0000000", "1111111111", "n/a", "12-34"].forEach(p => ok("phone refused: " + JSON.stringify(p), !looksLikePhone(p)));
ok("both public forms check the phone", /const phone = phoneValue\(body\.phone, true\);/.test(api) && /phoneValue\(body\.phone, kind\.phone\)/.test(api));
ok("phone errors answer 400", /throw new HttpError\(400, "phone is invalid"\)/.test(api));

ok("public forms read at most 32 KB; listings keep 1 MB", /const MAX_FORM_BODY = 32_000;/.test(api) && /const MAX_LISTING_BODY = 1_000_000;/.test(api) && (api.match(/parseBody\(req, MAX_FORM_BODY\)/g) || []).length === 2);
ok("body limit is checked on the header and while reading", /contentLength > maxBytes/.test(api) && /size > maxBytes/.test(api));
ok("lists and site settings may be kept for a minute", /PUBLIC_CACHE = \{ "Cache-Control": "public, max-age=60" \}/.test(api) && (api.match(/200, PUBLIC_CACHE\)/g) || []).length === 2);
ok("a single listing is never cached (view count, price)", !/getListing[\s\S]{0,900}PUBLIC_CACHE/.test(/const getListing = [\s\S]*?\n};/.exec(api)[0]));
ok("a failed CRM copy of an inquiry is logged", /listing inquiry saved but CRM lead failed/.test(api) && /listing inquiry not linked to its lead/.test(api));
ok("listing create/price/publish/status/delete are logged with the actor", ["listing_created", "listing_price", "listing_published", "listing_status", "listing_deleted"].every(e => api.includes('"' + e + '"')) && /owner_id: actorId/.test(api));
ok("a failed log line never fails the edit", /const logListingChange = async[\s\S]*?try \{[\s\S]*?catch \(error\) \{\s*console\.error/.test(api));
ok("the change is logged only after the save worked", /createListing[\s\S]*?if \(error\) \{[\s\S]*?\}\s*await logListingChange/.test(api));
ok("an unchanged price/published/status writes no log row", /Number\(existing\.price\) !== Number\(data\.price\)/.test(api) && /Boolean\(existing\.is_published\) !== Boolean\(data\.is_published\)/.test(api) && /String\(existing\.status\) !== String\(data\.status\)/.test(api));

// ---- fb-leads ----------------------------------------------------------------------------------
const fb = read("supabase/functions/fb-leads/index.ts");
ok("fb-leads: a lead that could not be saved makes the answer 500 so Meta sends it again", /failed\+\+;/.test(fb) && /if \(failed > 0\) return json\(\{ ok: false, error: "Some leads could not be saved", results \}, 500\)/.test(fb));
ok("fb-leads: a duplicate (23505) is not a failure", /insert\.error\.code === "23505"[\s\S]{0,120}action: "duplicate"/.test(fb));
ok("fb-leads: the database message is not returned", !/"error:" \+ insert\.error\.message/.test(fb) && /action: "insert-failed"/.test(fb));
ok("fb-leads: the Graph call times out", /graph\.facebook\.com[\s\S]{0,300}AbortSignal\.timeout\(8000\)/.test(fb));

// ---- location-report ---------------------------------------------------------------------------
const lr = read("supabase/functions/location-report/index.ts");
ok("location-report: database messages stay in the log", !/json\(\{ error: (rateError|leadError)\.message/.test(lr) && !/e instanceof Error \? e\.message : "No super-admin/.test(lr));
ok("location-report: a double tap returns the saved lead", /leadError\.code === "23505" && idempotencyKey/.test(lr) && /duplicated: true/.test(lr));
ok("location-report: looks the saved lead up by its key", /eq\("payload->>idempotencyKey", idempotencyKey\)/.test(lr));

// ---- seo ---------------------------------------------------------------------------------------
const seo = read("supabase/functions/seo/index.ts");
ok("seo: a missing listing is a real 404", /Listing not found[^\n]*, 404, /.test(seo));
ok("seo: a bad %-escape in the path is a missing page, not a crash", /try \{ id = decodeURIComponent\(m\[1\]\); \} catch \{ id = ""; \}/.test(seo));
ok("seo: pages, sitemap and robots say how long they may be kept", /public, max-age=300/.test(seo) && /public, max-age=3600/.test(seo) && /public, max-age=86400/.test(seo));
{
  // Run the 404 path: the same try/catch the function uses.
  let id; try { id = decodeURIComponent("%E0"); } catch { id = ""; }
  ok("seo: '%E0' really does throw in decodeURIComponent (so the guard matters)", id === "");
}

// ---- notify-dispatch ---------------------------------------------------------------------------
const nd = read("supabase/functions/notify-dispatch/index.ts");
ok("notify-dispatch: bulk mode says 501 when its columns are missing, instead of resending", /bulk mode unavailable/.test(nd) && /Bulk sending is not set up[\s\S]{0,120}501/.test(nd));
ok("notify-dispatch: asks for the columns it later updates", /select\("id,user_id,type,title,body,emailed_at,sms_sent_at"\)/.test(nd));
ok("notify-dispatch: every outside call times out", (nd.match(/AbortSignal\.timeout\(/g) || []).length >= 4);
ok("notify-dispatch: the mail error text is not passed on", !/error: String\(e\) \}, 502/.test(nd));

// ---- agent-dispatch ----------------------------------------------------------------------------
const ad = read("supabase/functions/agent-dispatch/index.ts");
const sameSecretSrc = /function sameSecret\([\s\S]*?\n}\n/.exec(ad)[0].replace(/: (string|boolean)/g, "");
const { sameSecret } = new Function(sameSecretSrc + "\nreturn { sameSecret };")();
ok("agent-dispatch: equal secrets match", sameSecret("abc", "abc") === true);
ok("agent-dispatch: different secrets do not", sameSecret("abc", "abd") === false);
ok("agent-dispatch: different lengths do not (even as a prefix)", sameSecret("abc", "abcd") === false && sameSecret("", "a") === false);
ok("agent-dispatch: both the secret and the service key use it", /sameSecret\(secretHeader, DISPATCH_SECRET\)/.test(ad) && /sameSecret\(authHeader, "Bearer " \+ SERVICE_KEY\)/.test(ad));
ok("agent-dispatch: database text is not returned", /Could not claim tasks/.test(ad) && !/error: error\.message/.test(ad));

// ---- Vercel relay and ad report ----------------------------------------------------------------
const rel = read("market-scan/vercel/api/agent-dispatch.js");
ok("relay: refuses when CRON_SECRET is not set", /!CRON_SECRET \|\| !sameSecret/.test(rel));
ok("relay: times out and hides the cause", /AbortSignal\.timeout\(20000\)/.test(rel) && /The dispatch service did not answer/.test(rel) && !/error: String\(\(e && e\.message\) \|\| e\)/.test(rel));
const adp = read("market-scan/vercel/api/ad-perf.js");
ok("ad report: times out and hides the cause", /AbortSignal\.timeout\(10000\)/.test(adp) && /The ad report source did not answer/.test(adp) && !/error: String\(\(e && e\.message\) \|\| e\)/.test(adp));

// ---- market scan: sources that cannot be scanned (N9) --------------------------------------------
const lib = read("market-scan/vercel/lib/_lib.js");
ok("market-scan: Facebook, Instagram, TikTok and Lamudi pages are no longer fetched on every scan", !/fetchHtml\("https:\/\/www\.(facebook|instagram|tiktok)\.com/.test(lib) && !/lamudi\.com\.ph\/for-sale/.test(lib) && !/invoke(Facebook|Instagram|TikTok|Lamudi)\(/.test(lib));
ok("market-scan: they are still listed as chips, with the reason", ["lamudi", "facebook", "instagram", "tiktok"].every(n => new RegExp('unscannable\\("' + n + '"\\)').test(lib)) && /const UNSCANNABLE = \{/.test(lib));
ok("market-scan: each reports no listings", /const unscannable = \(name\) => Object\.assign\(\{ name, count: 0 \}, UNSCANNABLE\[name\]\);/.test(lib));
{
  const names = ["lamudi", "facebook", "instagram", "tiktok"];
  const table = new Function(/const UNSCANNABLE = \{[\s\S]*?\n\};/.exec(lib)[0] + "\nreturn UNSCANNABLE;")();
  ok("market-scan: every entry has a label, a status the screen understands and a reason", names.every(n => table[n] && table[n].label && /^(blocked|js-only)$/.test(table[n].status) && table[n].error.length > 10));
}

// ---- jobs --------------------------------------------------------------------------------------
ok("supabase_sql: a stuck request times out (default 60 s)", /signal: AbortSignal\.timeout\(opts\.timeoutMs \|\| 60000\)/.test(read("tools/supabase_sql.js")));
const cb = read("supabase/check-backend.js");
ok("check-backend: every request times out", /const fetchT = /.test(cb) && !/[^.\w]fetch\(/.test(cb.replace(/const fetchT = [^\n]*/, "")));
ok("check-backend: objects from unapplied migrations are informational", ["push_subscriptions", "push_config", "site_settings", "listing_stale_sweep", "pushed_at"].every(n => new RegExp(n + "[^\\n]*pending").test(cb)));
ok("check-backend: a pending object that is missing does not fail the run", (cb.match(/pendingMissing: true/g) || []).length === 3);

// ---- failure notices (D3) ----------------------------------------------------------------------
const wfDir = path.join(root, ".github/workflows");
const scheduled = fs.readdirSync(wfDir).filter(f => /\.ya?ml$/.test(f)).filter(f => /^\s*schedule:/m.test(fs.readFileSync(path.join(wfDir, f), "utf8")));
const withNotice = ["backend-check.yml", "keepalive.yml", "market-index.yml", "push-alerts.yml", "rent-reminders.yml", "listing-stale.yml"];
withNotice.forEach(f => {
  const t = fs.readFileSync(path.join(wfDir, f), "utf8");
  ok(f + ": opens or updates one issue when it fails", /if: failure\(\)/.test(t) && /gh issue (create|comment)/.test(t) && /issues: write/.test(t));
  ok(f + ": one issue per workflow, found by title", /gh issue list --state open --search/.test(t));
});
ok("the notice workflows are all scheduled ones", withNotice.every(f => scheduled.includes(f)), scheduled.join(","));

// ---- runbook and update bot (L6, L7) -------------------------------------------------------------
const runbook = read("docs/runbook/README.md");
scheduled.forEach(f => ok("runbook lists the scheduled workflow " + f, runbook.indexOf("`" + f.replace(/\.ya?ml$/, "") + "`") !== -1));
ok("runbook mentions the Vercel cron and its secret", /Vercel cron/.test(runbook) && /CRON_SECRET/.test(runbook));
ok("runbook names the switches the jobs read", ["PUSH_ALERTS", "RENT_REMINDERS", "LISTING_STALE_ALERTS"].every(v => runbook.indexOf(v) !== -1));
const dep = read(".github/dependabot.yml");
ok("dependabot: actions and both market-scan packages, monthly", /package-ecosystem: github-actions/.test(dep) && /directory: \/market-scan\/vercel/.test(dep) && /directory: \/market-scan\/worker/.test(dep) && (dep.match(/interval: monthly/g) || []).length === 3);
ok("stale claims are gone: no email from location-report, in the PDF notes or the health check", !/emails the PDF via Resend/.test(read("js/value_guide_pdf.js")) && !/location-report: Resend/.test(read("supabase/check-backend.js")) && !/Value Guide report emails/.test(read("supabase/check-backend.js")));
ok("location-report checks the phone like the other public form", /looksLikePhone\(str\(body\.phone, 50\)\)/.test(lr) && /phone is invalid/.test(lr));

console.log("\nphase2_edge_node: " + passed + " checks passed");
