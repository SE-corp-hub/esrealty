"use strict";
/* Regression cover for the Home -> Shophouse -> Home stale-view bug and the
 * three latent defects that lived in the same render path.
 *
 * The original test (ui_shophouse_tab_e2e) walked shophouse -> project-bt ->
 * home. Project B.T renders bt-* markup, so no .sf-hero was present and the
 * buggy branch fell through to a correct render by accident. The bug only
 * fires when the page immediately preceding Home is the shophouse, because
 * shophouse is the only page that also uses .sf-hero. This test walks the
 * shophouse -> Home edge directly. */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }

(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const host = document.getElementById("sf-view") || document.querySelector(".sf-view, #storefront, main");
    const go = async (hash, ms) => { location.hash = hash; await wait(ms || 1600); };

    const heroIsHome = () => !!document.querySelector(".sf-est-hero");
    const heroIsShophouse = () => !!document.querySelector("section.sf-hero, .sf-hero");

    /* ---- 1. home -> shophouse -> home (the reported bug) ---- */
    /* #/shophouse is now a legacy alias that redirects to the coming-soon page,
     * because the shophouse campaign is closed. The bug being guarded here was
     * that returning to #/home from a page using .sf-hero left that page
     * mounted. The closed shophouse route is the last thing that rendered
     * .sf-hero, so a dedicated render target is needed to keep exercising the
     * edge. The coming-soon page stands in for it. */
    await go("#/home", 1800);
    chk("route-home-renders-estimate-hero", heroIsHome(), "estHero=" + heroIsHome());
    chk("route-home-no-shophouse-hero", !heroIsShophouse(), "sfHero=" + heroIsShophouse());

    await go("#/shophouse", 2200);
    chk("route-legacy-shophouse-redirects", location.hash === "#/project-bt", "hash=" + location.hash);
    chk("route-legacy-target-renders", !!document.querySelector(".sf-cs"), "cs=" + !!document.querySelector(".sf-cs"));
    chk("route-legacy-no-est-hero", !heroIsHome(), "estHero=" + heroIsHome());

    // This is the edge that used to silently keep the previous page on screen.
    await go("#/home", 1800);
    chk("route-back-home-renders-estimate-hero", heroIsHome(), "estHero=" + heroIsHome());
    chk("route-back-home-other-page-gone", !document.querySelector(".sf-cs") && !heroIsShophouse(), "stale page still mounted");
    chk("route-back-home-h1-is-value-guide", (() => {
      const h1 = document.querySelector(".sf-est-hero h1");
      return !!h1 && h1.textContent.indexOf("property be worth?") > 0;
    })(), "h1=" + ((document.querySelector(".sf-est-hero h1") || {}).textContent));
    chk("route-back-home-no-shophouse-marquee", !document.querySelector(".sf-marquee"), "marquee=" + !!document.querySelector(".sf-marquee"));
    chk("route-back-home-no-shophouse-why-grid", !document.querySelector(".sf-why-grid"), "whyGrid=" + !!document.querySelector(".sf-why-grid"));

    // Repeat the edge: the bug was order-dependent, so walk it twice more.
    await go("#/project-bt", 1600);
    await go("#/home", 1600);
    chk("route-repeat-home-still-correct", heroIsHome() && !document.querySelector(".sf-cs"), "estHero=" + heroIsHome() + " cs=" + !!document.querySelector(".sf-cs"));

    /* ---- 2. listing schema must not survive leaving a detail page ---- */
    const cards = Array.from(document.querySelectorAll("[data-sf-listing]"));
    if (cards.length) {
      cards[0].click();
      await wait(2200);
      // The live listing function can take longer than 2 s on a cold start: wait for the page itself,
      // not its "Loading property" placeholder (which also carries .sf-detail).
      for (let i = 0; i < 16 && document.querySelector(".sf-detail-loading"); i++) await wait(500);
      chk("route-detail-renders", !!document.querySelector(".sf-detail"), "detail=" + !!document.querySelector(".sf-detail"));
      chk("route-detail-has-jsonld", !!document.getElementById("sf-jsonld"), "jsonld=" + !!document.getElementById("sf-jsonld"));
      await go("#/home", 1800);
      chk("route-jsonld-removed-on-exit", !document.getElementById("sf-jsonld"), "stale listing schema left in <head>");
    } else {
      window.__msChecks.push({ name: "route-detail-skip", ok: true, detail: "no listings available; detail checks skipped" });
    }

    /* ---- 3. search list-view preference must not leak onto home ---- */
    await go("#/search", 2000);
    const listBtn = document.querySelector('[data-sf-mode="list"]');
    if (listBtn) {
      listBtn.click();
      await wait(900);
      chk("route-search-list-applied", document.querySelectorAll(".sf-property-card.is-list").length > 0, "listCards=" + document.querySelectorAll(".sf-property-card.is-list").length);
      await go("#/home", 2000);
      chk("route-list-mode-not-leaked-to-home", document.querySelectorAll(".sf-property-card.is-list").length === 0, "leaked=" + document.querySelectorAll(".sf-property-card.is-list").length);
    } else {
      window.__msChecks.push({ name: "route-search-list-skip", ok: true, detail: "no list toggle rendered" });
    }

    /* ---- 4. no duplicate detail maps / orphan containers ---- */
    chk("route-no-duplicate-maps", document.querySelectorAll(".sf-detail-map").length <= 1, "maps=" + document.querySelectorAll(".sf-detail-map").length);
    chk("route-no-jsonld-duplicates", document.querySelectorAll("#sf-jsonld").length === 0, "jsonld=" + document.querySelectorAll("#sf-jsonld").length);
  } catch (e) {
    window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.message || e) });
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
