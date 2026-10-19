"use strict";
// Headless browser driver for the *_e2e.js suite. Uses the Playwright chromium
// installed under %LOCALAPPDATA%\\ms-playwright (via the worker's dependency)
// and evaluates each test file inside the page, then reports __msOk/__msChecks
// as a single JSON line so tests\\run_all.ps1 can parse it.
// A hard watchdog force-exits this process so a stuck page can never stall
// tests\\run_all.ps1.

const fs = require("fs");

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const TestFile = arg("-test-file", "");
const Url = arg("-url", "http://127.0.0.1:8931/index.html");
const NavDelayMs = parseInt(arg("-nav-delay-ms", "4500"), 10);
const WindowSize = arg("-window-size", "1400,900");
/* Opt-in: wait for the .sf-site shell to stop re-rendering before evaluating.
 * Only tests that keep LIVE node references across the storefront's two-phase
 * render (boot shell -> data shell) need this - the mobile-nav test and its
 * sweep. Everything else (back-office, maps, market-scan) boots on the
 * storefront but does not measure its header, and holding those tests for the
 * shell to settle under load only manufactured timeouts. */
const WaitShellStable = process.argv.indexOf("-wait-shell-stable") >= 0;
/* Opt-in emulation for the motion and pointer rules: -reduced-motion runs the
 * page with prefers-reduced-motion: reduce, -touch runs it as a touch phone
 * ((hover: none) and (pointer: coarse)). The default run is a desktop mouse. */
const ReducedMotion = process.argv.indexOf("-reduced-motion") >= 0;
const Touch = process.argv.indexOf("-touch") >= 0;
const [W, H] = WindowSize.split(",").map(n => parseInt(n, 10));

function report(result) {
  try { process.stdout.write(JSON.stringify(result)); } catch (e) { /* noop */ }
}

const watchdog = setTimeout(function () {
  report({ ok: false, checks: [{ name: "driver", ok: false, detail: "watchdog timeout" }] });
  process.exit(1);
}, 230000);
watchdog.unref();

let chromium = null;
/* Resolve the Playwright browser driver from whichever install actually exists.
 * CI installs playwright at the repo root; a developer machine may only have it
 * nested under market-scan/worker/node_modules (gitignored, so absent in CI).
 * `playwright` re-exports the same `chromium` launcher as `playwright-core`, so
 * accepting either makes the driver work in both environments. If none resolve,
 * fail with a clean JSON line so run_all.ps1 marks it failed instead of the
 * module crashing on load with no output at all. */
const PW_CANDIDATES = [
  "../market-scan/worker/node_modules/playwright-core",
  "playwright-core",
  "playwright"
];
for (const id of PW_CANDIDATES) {
  try { chromium = require(id); break; } catch (e) { /* try next */ }
}
if (!chromium || !chromium.chromium) {
  report({ ok: false, checks: [{ name: "driver", ok: false,
    detail: "playwright not found — run: npm install --no-save playwright" }] });
  process.exit(1);
}
const { chromium: pw } = chromium;

(async () => {
  if (!TestFile || !fs.existsSync(TestFile)) {
    report({ ok: false, checks: [{ name: "driver", ok: false, detail: "test file not found: " + TestFile }] });
    process.exit(1);
  }
  const src = fs.readFileSync(TestFile, "utf8");
  let browser = null;
  try {
    browser = await pw.launch({ headless: true });
  } catch (e) {
    try { browser = await pw.launch({ headless: true, channel: "chrome" }); }
    catch (e2) {
      report({ ok: false, checks: [{ name: "driver", ok: false, detail: "launch failed: " + e2.message }] });
      process.exit(1);
    }
  }
  let context = null;
  let page = null;
  try {
    const contextOptions = { viewport: { width: W, height: H } };
    if (ReducedMotion) contextOptions.reducedMotion = "reduce";
    if (Touch) { contextOptions.hasTouch = true; contextOptions.isMobile = true; }
    context = await browser.newContext(contextOptions);
    page = await context.newPage();
    page.on("dialog", async d => { try { await d.accept(); } catch (e) { /* noop */ } });
    await context.addInitScript(() => {
      // Auto-confirm the in-app confirm modal (replaces native confirm auto-accept).
      const autoConfirm = () => {
        const ov = document.getElementById("cx-modal");
        if (!ov || ov.dataset.autoconfirmed) return;
        ov.dataset.autoconfirmed = "1";
        const typeIn = document.getElementById("cx-type");
        if (typeIn) { typeIn.value = typeIn.getAttribute("data-tc") || "DELETE"; typeIn.dispatchEvent(new Event("input", { bubbles: true })); }
        const reasonIn = document.getElementById("cx-reason");
        if (reasonIn) { reasonIn.value = "auto-confirm (e2e)"; reasonIn.dispatchEvent(new Event("input", { bubbles: true })); }
        const ok = ov.querySelector("[data-cx-ok]");
        const tryClick = () => {
          if (!ok) return;
          const ti2 = document.getElementById("cx-type");
          const ri2 = document.getElementById("cx-reason");
          if (ti2 && ti2.getAttribute("data-tc") && ti2.value === ti2.getAttribute("data-tc")) ok.disabled = false;
          if (ri2 && String(ri2.value || "").trim().length > 0) ok.disabled = false;
          if (!ok.disabled) ok.click();
        };
        tryClick();
        if (ok && ok.disabled) { setTimeout(tryClick, 60); setTimeout(tryClick, 150); }
      };
      setInterval(autoConfirm, 50);
    });
    await page.goto(Url, { waitUntil: "domcontentloaded", timeout: 60000 });

    /* Wait for the app to actually be ready instead of sleeping a fixed 4.5s.
     * The app sets window.__ESREALTY_READY when boot() finishes and strips
     * body.preload. A fixed sleep is the single largest source of flake: it is
     * simultaneously too long on a warm cache and too short on a cold CI box.
     * NavDelayMs is kept as a FLOOR so nothing regresses to zero-wait.
     *
     * If the signal never arrives this now FAILS with a clear reason rather
     * than proceeding. It used to swallow the timeout and carry on, which is
     * how a slow boot turned into a page of nonsense layout failures: the header
     * measured 0x0, the hamburger's three bars measured unrotated, and the menu
     * panel could not be opened because it was never built. Those all reported
     * as CSS and accessibility bugs - "header-no-overflow: actions 8-56 vs
     * header 0-0", "icon-open-state-rotates-bars: rotated=0 of 3",
     * "accordion-targets-44px: under-44px rows=8" - and sent people looking for
     * a layout fault that did not exist. The real fault was the harness
     * measuring a page that had not booted. */
    let booted = true;
    try {
      await page.waitForFunction(
        () => window.__ESREALTY_READY === true || document.body && !document.body.classList.contains("preload"),
        null,
        { timeout: Math.max(NavDelayMs, 30000), polling: 100 }
      );
    } catch (e) {
      booted = false;
    }
    await page.waitForTimeout(Math.min(NavDelayMs, 1500));
    if (!booted) {
      report({
        ok: false,
        checks: [{
          name: "app-booted",
          ok: false,
          detail: "the app never signalled ready within " + Math.max(NavDelayMs, 30000) +
            "ms (window.__ESREALTY_READY never became true and body.preload was never removed). " +
            "The page was not booted, so every layout assertion below would be meaningless. " +
            "This is a harness/environment timeout, not a CSS or accessibility fault."
        }]
      });
      await browser.close();
      return;
    }

    /* Wait for the STYLESHEETS, not just for the app's JavaScript.
     *
     * __ESREALTY_READY means boot() finished, which says nothing about whether
     * the CSS has been fetched and applied. When the sweep runs straight after
     * a full suite the machine is busy enough that the test can start measuring
     * a page whose stylesheets have not landed - and then it reports the
     * unstyled page as a design bug. The first failure in that state is
     * `collapse-matches-breakpoint`, because at 320px the desktop nav is still
     * visible with no stylesheet applied, and everything downstream then fails
     * with the same noise.
     *
     * Waiting for the sheets to be present AND parsed (cssRules readable, not
     * just linked) is what makes the measurement meaningful. */
    let styled = true;
    try {
      await page.waitForFunction(() => {
        const want = ["storefront.css", "storefront-legacy.css", "styles.css", "estimator.css"];
        const ours = Array.from(document.styleSheets).filter(s => {
          if (!s.href) return true;
          try { const u = new URL(s.href); return u.origin === location.origin; } catch (e) { return false; }
        });
        const have = ours.map(s => (s.href || "").split("/").pop());
        if (!want.every(w => have.indexOf(w) >= 0)) return false;
        /* Parsed: cssRules is non-null once the sheet has been read. A sheet
           still loading throws or returns null on access. Foreign sheets (the
           Google Fonts link) are excluded above because their cssRules throws
           on cross-origin access. */
        return ours.every(s => {
          try { return !!s.cssRules; } catch (e) { return false; }
        });
      }, null, { timeout: Math.max(NavDelayMs, 30000), polling: 100 });
    } catch (e) {
      styled = false;
    }
    if (!styled) {
      report({
        ok: false,
        checks: [{
          name: "stylesheets-applied",
          ok: false,
          detail: "the storefront stylesheets were not present and parsed in time, so the test " +
            "measured an unstyled page. Any layout assertion here would be reporting the " +
            "absence of CSS rather than a CSS fault."
        }]
      });
      await browser.close();
      return;
    }

    /* Wait for the SHELL to be stable, not just booted and styled.
     *
     * Only active with -wait-shell-stable (see the flag declaration).
     *
     * The storefront renders its entire shell (header + main + footer) via
     * innerHTML, and it renders more than once: boot paints a loading shell
     * (skeleton cards in the featured section), then the featured-listings
     * fetch resolves and renderCurrent swaps the whole tree again. A test that
     * keeps live node references from the first render past the second one
     * measures a detached DOM soup: the header node it held is no longer in the
     * document (reports a 0x0 rect), the hamburger no longer rotates, and the
     * menu panel does not open.
     *
     * Fixed sleeps cannot gate this because the second render is driven by a
     * network response whose latency is exactly what varies. The condition
     * below is deterministic instead: the .sf-site node must be the SAME
     * INSTANCE across ~1s of polling AND no loading skeleton may be present.
     * The skeleton half is what closes the residual race - a slow fetch leaves
     * the loading shell stable but full of skeletons, so the gate does not
     * clear until the data render has actually replaced them. */
    let stable = !WaitShellStable;
    if (!stable) {
      try {
        await page.waitForFunction(() => {
          const host = document.getElementById("sf-site") || document.querySelector(".sf-site");
          /* Not a storefront page (back-office, auth views, etc.) - there is no
             shell to be re-rendered, so there is no race to gate. Passing here
             keeps non-storefront tests from being held by a gate that only
             exists to protect storefront node references. */
          if (!host) return true;
          if (window.__sfShellNode === undefined) { window.__sfShellNode = host; window.__sfShellSeq = 0; return false; }
          if (window.__sfShellNode === host) {
            window.__sfShellSeq += 1;
          } else {
            window.__sfShellNode = host;
            window.__sfShellSeq = 0;
            return false;
          }
          if (window.__sfShellSeq < 8) return false;
          return !document.querySelector(".sf-skeleton");
        }, null, { timeout: Math.max(NavDelayMs, 30000), polling: 120 });
        stable = true;
      } catch (e) {
        stable = false;
      }
    }
    if (!stable) {
      report({
        ok: false,
        checks: [{
          name: "shell-stable",
          ok: false,
          detail: "the .sf-site shell kept being re-rendered (or the loading skeleton never " +
            "cleared) within the wait window, so live node references taken mid-render would " +
            "measure a detached tree. This is a harness timeout, not a CSS or accessibility fault."
        }]
      });
      await browser.close();
      return;
    }
    /* Give the final render a beat to finish layout before evaluating. */
    await page.waitForTimeout(100);

    await Promise.race([
      page.evaluate(src).catch(() => {}),
      new Promise(r => setTimeout(r, 190000))
    ]);

    let result = null;
    for (let i = 0; i < 40; i++) {
      const r = await page.evaluate(() => ({
        ok: !!(window.__msOk),
        checks: Array.isArray(window.__msChecks) ? window.__msChecks : [],
        done: !!(window.__msDone),
        log: Array.isArray(window.__msLog) ? window.__msLog.slice(-6) : []
      }));
      if (r.ok || r.checks.length > 0) { result = r; break; }
      await page.waitForTimeout(250);
    }
    if (!result) {
      result = await page.evaluate(() => ({
        ok: !!(window.__msOk),
        checks: Array.isArray(window.__msChecks) ? window.__msChecks : [],
        done: !!(window.__msDone),
        log: Array.isArray(window.__msLog) ? window.__msLog.slice(-6) : []
      }));
    }
    if (result.checks.length === 0 && !result.done) {
      result.log = result.log || [];
      result.log.push("timeout waiting for __msDone");
    }
    report({ ok: !!result.ok && result.checks.length > 0, checks: result.checks || [], log: result.log || [] });
    process.exit(result.ok && result.checks.length > 0 ? 0 : 1);
  } catch (e) {
    report({ ok: false, checks: [{ name: "driver", ok: false, detail: "run failed: " + (e && e.message || e) }] });
    process.exit(1);
  }
})();