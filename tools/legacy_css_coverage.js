"use strict";
/* Reports which selectors in css/storefront-legacy.css actually match anything
 * on the LIVE public routes, versus only the parked shophouse / Project B.T
 * pages (which are closed) or nothing at all.
 *
 * The point is to size the real redesign job. 82 KB of "legacy storefront CSS"
 * sounds like a lot, but if two thirds of it only styles pages that are
 * deliberately unpublished, the live surface is much smaller and the redesign
 * should be scoped to that.
 *
 * Usage: node tools/legacy_css_coverage.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const BASE = "http://127.0.0.1:8931/index.html";

/* Live routes only. project-bt is listed separately because it now renders the
   coming-soon page, not the parked marketing page. */
const ROUTES = [
  { hash: "#/home", name: "home" },
  { hash: "#/search", name: "search" },
  { hash: "#/property-value", name: "property-value" }
];

function loadPw() {
  try { return require("../market-scan/worker/node_modules/playwright-core"); }
  catch (e) { return require("playwright-core"); }
}

/* Split a stylesheet into individual selectors, dropping at-rule wrappers. */
function selectorsOf(css) {
  const out = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /(^|[}{])\s*([^{}@]+?)\s*\{/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const chunk = m[2].trim();
    if (!chunk || chunk.startsWith("@") || chunk.startsWith("from") || chunk.startsWith("to")) continue;
    for (const s of chunk.split(",")) {
      const sel = s.trim();
      if (sel) out.push(sel);
    }
  }
  return Array.from(new Set(out));
}

/* Runs in the page. Two queries per selector:
 *   raw   - the selector as written
 *   bare  - pseudo-classes and pseudo-elements stripped
 * A selector that only matches "bare" is state-dependent (hover, focus,
 * ::before). A static querySelector can never match those, so calling them
 * dead would be wrong. Only selectors that match NEITHER form are candidates
 * for deletion. */
function matchInPage(selPairs) {
  const raw = {}, bare = {};
  for (let i = 0; i < selPairs.length; i++) {
    const s = selPairs[i].raw, b = selPairs[i].bare;
    try { raw[s] = document.querySelectorAll(s).length; } catch (e) { raw[s] = -1; }
    if (b === s) { bare[s] = raw[s]; continue; }
    try { bare[s] = document.querySelectorAll(b).length; } catch (e) { bare[s] = -1; }
  }
  return { raw, bare };
}

/* Strip pseudo-classes/elements so the static test can see the real element.
   :not() and :nth-* etc. are left alone - removing them changes meaning. */
function bareSelector(sel) {
  return sel
    .replace(/::?[a-z-]+(\([^)]*\))?/gi, (m, arg) => {
      /* keep structural functional pseudos, drop hover/focus/before/... */
      if (/^:(not|nth-|is|where|has|dir|lang|first-|last-|only-|root)/i.test(m)) return m;
      return "";
    })
    .replace(/(\s*)\+\s*$/, "$1")
    .replace(/^[\s>]+|[\s>+]+$/g, "")
    .trim();
}

(async () => {
  const legacy = read("css/storefront-legacy.css");
  const sels = selectorsOf(legacy);
  const pairs = sels.map(s => ({ raw: s, bare: bareSelector(s) || s }));
  const { chromium } = loadPw();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  /* live = matched on at least one public route (bare form) */
  const liveHits = new Map(); // sel -> count
  const pseudoOnly = new Set();
  for (const r of ROUTES) {
    await page.goto(BASE + r.hash, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      () => window.__ESREALTY_READY === true || (document.body && !document.body.classList.contains("preload")),
      null, { timeout: 25000, polling: 100 }
    ).catch(() => {});
    await page.waitForTimeout(2200);
    const res = await page.evaluate(matchInPage, pairs);
    for (const p of pairs) {
      const raw = res.raw[p.raw], bare = res.bare[p.raw];
      if (raw === -1) { liveHits.set(p.raw, -1); continue; }
      if (bare > 0) liveHits.set(p.raw, (liveHits.get(p.raw) || 0) + bare);
      if (raw === 0 && bare > 0) pseudoOnly.add(p.raw);
    }
  }

  /* Parked vocabulary: class names that appear ONLY inside the parked
     shophouse / Project B.T render functions and nowhere on a live page.
     Classifying by vocabulary avoids the flaw of trying to probe a DOM we
     cannot render. */
  const parkedFns = (() => {
    const start = storeSrcOf().indexOf("function shophousePage");
    /* The parked cluster has been deleted, so there is nothing to exclude. */
    return start < 0 ? "" : storeSrcOf().slice(start);
  })();
  const parkedClasses = new Set();
  const clsRe = /class="([^"]+)"/g;
  let m;
  while ((m = clsRe.exec(parkedFns)) !== null) {
    for (const c of m[1].split(/\s+/)) if (c && !/[<>(){}]/.test(c)) parkedClasses.add(c);
  }
  const btRe = /class="([^"]*bt-[^"]*)"/g;
  while ((m = btRe.exec(parkedFns)) !== null) {
    for (const c of m[1].split(/\s+/)) if (c) parkedClasses.add(c);
  }
  const liveClasses = new Set();
  for (const s of sels) if (liveHits.get(s) > 0) {
    const re = /\.(-?[_a-zA-Z][\w-]*)/g; let mm;
    while ((mm = re.exec(s)) !== null) liveClasses.add(mm[1]);
  }
  const parkedOnlyClasses = new Set([...parkedClasses].filter(c => !liveClasses.has(c)));

  function classesOf(sel) {
    const out = [];
    const re = /\.(-?[_a-zA-Z][\w-]*)/g; let mm;
    while ((mm = re.exec(sel)) !== null) out.push(mm[1]);
    return out;
  }

  const live = [], stateDependent = [], parkedLikely = [], deadCandidates = [], invalid = [];
  for (const s of sels) {
    const hit = liveHits.get(s);
    if (hit === -1) { invalid.push(s); continue; }
    if (hit > 0) { live.push(s); continue; }
    if (pseudoOnly.has(s)) { stateDependent.push(s); continue; }
    const cs = classesOf(s);
    if (cs.length && cs.some(c => parkedOnlyClasses.has(c))) parkedLikely.push(s);
    else deadCandidates.push(s);
  }

  /* The decisive filter for the dead candidates.
   *
   * "Did not match on this run" is NOT the same as "dead". Several
   * components are emitted only when the data cooperates - cardMedia() renders
   * a .sf-carousel only for a listing with 2+ photos, and detailGallery()
   * renders .sf-thumbs the same way. With the current seed data every listing
   * has a single image, so those selectors never match, yet deleting them
   * would break the card the moment a multi-photo listing is published.
   *
   * So split the dead candidates by whether their class names are ever
   * EMITTED by the public JS at all. A selector referencing a class the JS can
   * never produce is genuinely dead and safe to delete. One referencing only
   * classes the JS does produce is merely dormant. */
  const emitted = new Set();
  for (const f of ["js/storefront.js", "js/estimator.js"]) {
    const t = read(f);
    const add = s => { const c = String(s || "").trim(); if (c && /^[A-Za-z][\w-]*$/.test(c)) emitted.add(c); };
    /* Three distinct ways a class can reach the DOM. Missing any of them
       produces false "dead" verdicts:
         1. class="..."                       literal markup
         2. classList.add/remove/toggle(...) state classes added at runtime
         3. className = "..."                wholesale replacement
       (1) alone flagged .sf-price-pin as dead even though it is the search map
       pin marker assigned via className. */
    let mm;
    const reClass = /class="([^"]{0,4000})"/g;
    while ((mm = reClass.exec(t)) !== null) for (const c of mm[1].split(/\s+/)) add(c);
    const reList = /classList\.(?:add|remove|toggle)\(\s*["']([A-Za-z][\w-]*)["']/g;
    while ((mm = reList.exec(t)) !== null) add(mm[1]);
    const reName = /className\s*=\s*["']([^"']{1,200})["']/g;
    while ((mm = reName.exec(t)) !== null) for (const c of mm[1].split(/\s+/)) add(c);
  }

  const trulyDead = [], dormant = [];
  for (const s of deadCandidates) {
    const cs = classesOf(s);
    /* a selector with no classes at all is element-only; treat by tag presence */
    const neverEmitted = cs.filter(c => !emitted.has(c));
    if (!cs.length || neverEmitted.length) trulyDead.push({ sel: s, neverEmitted });
    else dormant.push(s);
  }

  const fmt = (arr, n, key) => arr.length
    ? "\n" + arr.slice(0, n || 40).map(x => "    " + (key ? x[key] : x)).join("\n") + (arr.length > (n || 40) ? "\n    ... and " + (arr.length - (n || 40)) + " more" : "")
    : "    (none)";

  process.stdout.write("selectors analysed: " + sels.length + "\n");
  process.stdout.write("  LIVE on a public route          : " + live.length + "\n");
  process.stdout.write("  PARKED-only vocabulary          : " + parkedLikely.length + "   (pages are closed, leave alone)\n");
  process.stdout.write("  matched nothing, class NEVER emitted by the public JS : " + trulyDead.length + "   (genuinely dead)\n");
  process.stdout.write("  matched nothing, but class IS emitted (dormant) : " + dormant.length + "   (data-conditional, keep)\n");
  process.stdout.write("  invalid selectors               : " + invalid.length + "\n");

  process.stdout.write("\n=== GENUINELY DEAD (class never produced by the JS) ===" + fmt(trulyDead, 60, "sel"));
  process.stdout.write("\n\n=== DORMANT / DATA-CONDITIONAL (keep - e.g. carousels, galleries) ===" + fmt(dormant, 25));
  process.stdout.write("\n\n=== PARKED-only (do NOT delete while pages are parked) ===" + fmt(parkedLikely, 20));
  process.stdout.write("\n");

  fs.writeFileSync(path.join(ROOT, "css", "legacy-coverage.json"), JSON.stringify({
    capturedAt: new Date().toISOString(),
    total: sels.length,
    live, stateDependent, parkedLikely,
    trulyDead: trulyDead.map(d => d.sel),
    trulyDeadDetail: trulyDead,
    dormant, invalid
  }, null, 1));
  process.stdout.write("wrote css/legacy-coverage.json\n");
  await browser.close();
})();

function storeSrcOf() { return read("js/storefront.js"); }
