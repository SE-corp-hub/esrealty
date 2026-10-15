"use strict";
/* Mobile navigation guards.
 *
 * Every bug below shipped to production before this file existed:
 *
 *  1. Between 901px and 1050px the hamburger was visible but the panel could
 *     never open. Four different breakpoints were in play (1050 legacy, 900 here,
 *     760 legacy, 640 here) and the disagreement produced a dead band, so tablet
 *     users could not navigate at all.
 *  2. At 390px "Create account" wrapped to two lines and spilled 13px below the
 *     header border, because the desktop auth actions stayed in the header.
 *  3. The brand name measured 0px wide at 390px and 320px - a bare orange disc.
 *  4. The open-state icon rendered as a ">" chevron instead of an X.
 *  5. The panel had overflow:visible and no height, so on a 375x667 phone the
 *     auth actions at the bottom were unreachable.
 *  6. Tapping a Services accordion header both expanded it and closed the menu
 *     containing it, so the services were unreachable on a phone.
 *
 * The per-viewport sweep lives in tests/run_mobile_nav_sweep.ps1, which re-runs
 * this same file at each width in turn - a page script cannot resize its own
 * viewport, and the dead band only appears at one width, so a single-width test
 * would never catch it. The assertions below therefore describe the CSS
 * contract at whatever width the driver is currently using.
 */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }

const BP = 1024;

(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    /* Poll for a condition instead of sleeping a fixed time and hoping the
     * layout has settled. A fixed wait is simultaneously too long on a warm
     * cache and too short on a loaded machine, which is why this file used to
     * fail roughly one sweep in five at whichever width happened to run first
     * after a full suite. */
    const until = async (fn, ms) => {
      const limit = ms || 4000;
      const t0 = Date.now();
      for (;;) {
        let ok = false;
        try { ok = fn(); } catch (e) { ok = false; }
        if (ok) return true;
        if (Date.now() - t0 > limit) return false;
        await wait(50);
      }
    };

    chk("storefront-css-loaded", (() => {
      try {
        return !!Array.from(document.styleSheets).find(s => (s.href || "").indexOf("storefront.css") > -1);
      } catch (e) { return false; }
    })(), "storefront.css not loaded");
    const nav = document.querySelector(".sf-nav");
    const btn = document.querySelector("[data-sf-menu]");
    const panel = document.querySelector("[data-sf-menu-panel]");
    const header = document.querySelector(".sf-header");
    chk("header-present", !!header, "no .sf-header");
    chk("nav-present", !!nav, "no .sf-nav");
    chk("menu-btn-present", !!btn, "no [data-sf-menu]");
    chk("panel-present", !!panel, "no [data-sf-menu-panel]");

    /* Settle BEFORE measuring anything.
     *
     * The header, bars and panel were measured mid-flight and reported bogus
     * bugs - "header-no-overflow: actions 8-56 vs header 0-0", "rotated=0 of
     * 3", "under-44px rows=8" - followed by breadcrumb trails pointing at CSS
     * and accessibility. Two distinct causes converged on that same signature:
     *
     *   1. The driver used to proceed whether or not the app had booted, and
     *      measured an unstyled, pre-layout page.
     *   2. The storefront re-renders its ENTIRE shell (including .sf-header)
     *      once the featured-listings fetch resolves. Any live node reference
     *      taken before that second render points at a detached subtree, which
     *      measures as 0x0 and never opens. That was the dominant cause; the
     *      driver's shell-stable gate (cdp_driver_runner.js) now waits for the
     *      .sf-site node to stop being replaced before running the test.
     *
     * The waits below are defence in depth: fonts can still be swapping in
     * after fonts.ready resolves, and the header must have real geometry
     * before it is measured. Together with the driver gates they keep this
     * file honest on a loaded machine. */
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (e) { /* non-fatal */ }
      for (let i = 0; i < 80 && document.fonts.status !== "loaded"; i++) await wait(50);
    }
    /* The header must have real geometry before it is asserted on. */
    await until(() => {
      const h = document.querySelector(".sf-header");
      if (!h) return false;
      const r = h.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }, 8000);

    const vw = document.documentElement.clientWidth;
    const collapsed = vw <= BP;
    chk("collapse-matches-breakpoint", (getComputedStyle(nav).display === "none") === collapsed,
      "vw=" + vw + " nav=" + getComputedStyle(nav).display + " collapsed=" + collapsed);
    chk("toggle-matches-collapse", (getComputedStyle(btn).display !== "none") === collapsed,
      "btn=" + getComputedStyle(btn).display + " collapsed=" + collapsed);

    /* ---------- the toggle actually works ---------- */
    if (collapsed) {
      const wasLocked = document.body.classList.contains("sf-menu-open");
      btn.click();
      await until(() => panel.classList.contains("open"), 4000);
      chk("toggle-opens-panel", panel.classList.contains("open") === !wasLocked,
        "open=" + panel.classList.contains("open"));
      chk("toggle-sets-aria", btn.getAttribute("aria-expanded") === String(!wasLocked),
        "aria-expanded=" + btn.getAttribute("aria-expanded"));
      chk("toggle-labels-itself", /close|open/i.test(btn.getAttribute("aria-label") || ""),
        "aria-label=" + btn.getAttribute("aria-label"));

      if (wasLocked) { btn.click(); await until(() => !panel.classList.contains("open"), 4000); }
      /* Ensure the panel is OPEN from here on. Clicking again to "be sure" would
       * close it: an earlier version of this test clicked unconditionally after
       * the toggle assertion and then measured a closed panel, which is why every
       * overlay assertion below failed while the toggle assertion passed. */
      if (!panel.classList.contains("open")) { btn.click(); await until(() => panel.classList.contains("open"), 4000); }
      chk("panel-open-for-overlay-checks", panel.classList.contains("open"), "panel is not open");
      /* Wait for the panel to have real height before measuring it, so
       * panel-has-height cannot fail on a not-yet-laid-out panel. */
      await until(() => panel.getBoundingClientRect().height > 120, 4000);
      const pr = panel.getBoundingClientRect();
      chk("panel-has-height", pr.height > 120, "h=" + Math.round(pr.height));
      chk("panel-below-header", pr.top >= 20, "top=" + Math.round(pr.top));
      chk("panel-not-wider-than-viewport", pr.width <= vw + 1, "w=" + Math.round(pr.width) + " vw=" + vw);
      chk("panel-scrolls", getComputedStyle(panel).overflowY === "auto" || getComputedStyle(panel).overflowY === "scroll",
        "overflow-y=" + getComputedStyle(panel).overflowY);
      chk("page-scroll-locked", getComputedStyle(document.body).overflow === "hidden",
        "body overflow=" + getComputedStyle(document.body).overflow);

      /* Content longer than the panel must be reachable by scrolling.
       *
       * This is the one measurement in the file that used to flake, and only
       * under load: the panel's scrollHeight was read with Inter still
       * downloading, scrollTop was set against those fallback metrics, and then
       * the real face arrived and reflowed the content, leaving scrollTop
       * pointing at the old bottom. The auth actions then measured as
       * unreachable even though they were fine. Settle the fonts first, then
       * set the scroll offset, then let layout settle before measuring. */
      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (e) { /* non-fatal */ }
      }
      /* Wait for the panel's content height to stop changing. Whether the panel
       * needs scrolling decides which branch below runs, and taking that
       * decision against a still-settling layout sends the test down the wrong
       * path - it would then assert on a branch the real layout never takes. */
      await until((() => {
        const h = panel.scrollHeight;
        if (h === panel._lastH) return true;
        panel._lastH = h;
        return false;
      })(), 4000);
      /* Public Sign in / Create account were removed on 2026-10-15 (agents sign
         in from the footer); the panel must not carry them either. */
      chk("no-public-auth-in-panel", panel.querySelectorAll("[data-sf-auth]").length === 0, "auth buttons still in the menu");

      /* ---------- header must not overflow ---------- */
      const hr = header.getBoundingClientRect();
      const actions = document.querySelector(".sf-header-actions");
      chk("header-node-stable", header === document.querySelector(".sf-header"),
        "the .sf-header node was replaced mid-test (header-replaced=" + (header !== document.querySelector(".sf-header")) + ")");
      chk("auth-not-in-header-when-collapsed", !actions || getComputedStyle(actions).display === "none"
        || !actions.querySelector('[data-sf-auth="signup"]') || getComputedStyle(actions.querySelector('[data-sf-auth="signup"]')).display === "none",
        "Sign in / Create account should leave the header below " + BP + "px");
      if (actions) {
        const ar = actions.getBoundingClientRect();
        chk("header-no-overflow", ar.bottom <= hr.bottom + 1 && ar.top >= hr.top - 1,
          "actions " + Math.round(ar.top) + "-" + Math.round(ar.bottom) + " vs header " + Math.round(hr.top) + "-" + Math.round(hr.bottom));
      }

      /* Brand name must survive. It measured 0px at 390 and 320 before. */
      const brandText = document.querySelector(".sf-brand > span:last-child");
      chk("brand-name-not-collapsed", !!brandText && brandText.getBoundingClientRect().width > 20,
        "brand text w=" + (brandText ? Math.round(brandText.getBoundingClientRect().width) : "n/a"));

      /* ---------- icon is an X, not a chevron ---------- */
      const bars = Array.from(btn.querySelectorAll("span")).map(s => getComputedStyle(s).transform);
      chk("icon-has-bars", bars.length >= 2, "spans=" + bars.length);
      const rotated = bars.filter(t => /matrix/.test(t)).length;
      chk("icon-open-state-rotates-bars", rotated >= 2, "rotated=" + rotated + " of " + bars.length);

      /* ---------- accordions, and they must not close the panel ---------- */
      const accs = panel.querySelectorAll(".sf-menu-acc");
      chk("accordions-present", accs.length === 2, "accordions=" + accs.length);
      const first = accs[0];
      if (first) {
        const sum = first.querySelector(".sf-menu-acc-sum");
        const before = first.open;
        sum.click();
        await wait(400);
        chk("accordion-toggles", first.open === !before, "open=" + first.open);
        chk("accordion-keeps-panel-open", panel.classList.contains("open"),
          "tapping an accordion header must not dismiss the menu");
        const rows = first.querySelectorAll(".sf-menu-acc-body a");
        chk("accordion-has-children", rows.length === 9, "services=" + rows.length);
        /* Touch targets */
        let small = 0;
        first.querySelectorAll("a, .sf-menu-acc-sum").forEach(a => {
          const r = a.getBoundingClientRect();
          if (r.height < 44) small++;
        });
        chk("accordion-targets-44px", small === 0, "under-44px rows=" + small);
        if (!before) { sum.click(); await wait(300); }
      }

      /* ---------- sticky bar must yield to the panel ---------- */
      const sticky = document.querySelector("[data-sf-sticky]");
      chk("sticky-hidden-under-panel", !sticky || getComputedStyle(sticky).display === "none",
        "sticky=" + (sticky ? getComputedStyle(sticky).display : "absent"));

      /* ---------- Escape closes ---------- */
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await wait(350);
      chk("escape-closes-panel", !panel.classList.contains("open"), "still open");
      chk("escape-unlocks-page", getComputedStyle(document.body).overflow !== "hidden", "body still locked");
      chk("escape-collapses-accordions", Array.from(panel.querySelectorAll(".sf-menu-acc")).every(a => !a.open), "an accordion stayed open");
    } else {
      chk("panel-hidden-on-desktop", getComputedStyle(panel).display === "none", "panel=" + getComputedStyle(panel).display);
    }

    /* ---------- no second breakpoint sneaking in ----------
       The dead band came from competing breakpoints, so assert the storefront
       stylesheet only collapses the nav at one width. */
    try {
      const sheet = Array.from(document.styleSheets).find(s => (s.href || "").indexOf("storefront.css") > -1);
      const collapsing = [];
      for (const r of Array.from(sheet.cssRules)) {
        if (r.type !== CSSRule.MEDIA_RULE) continue;
        const m = /max-width:\s*(\d+)px/.exec(r.conditionText || "");
        if (!m) continue;
        if (Array.from(r.cssRules).some(ir => ir.selectorText === ".sf-nav" && /display:\s*none/.test(ir.style.cssText))) {
          collapsing.push(Number(m[1]));
        }
      }
      chk("single-collapse-breakpoint", collapsing.length === 1 && collapsing[0] === BP,
        "collapse widths=" + JSON.stringify(collapsing) + " expected [" + BP + "]");
    } catch (e) { chk("single-collapse-breakpoint", false, "could not inspect media rules: " + e.message); }
  } catch (e) {
    window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.message || e) });
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
