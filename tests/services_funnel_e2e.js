"use strict";
/* Services nav -> Get My Property Value landing (selling services).
 *
 * The landing is deliberately a services conversation, not a calculator:
 *  - every Services dropdown item lands on a real destination; services
 *    without a page of their own route to #/property-value?service=..., never
 *    to the homepage services section,
 *  - the landing carries NO value calculator (the calculator stays on the
 *    home page),
 *  - the service param adapts the hero, document title and primary CTA,
 *  - the consult form preselects the chosen service,
 *  - the home page still embeds the working guide.
 */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }

(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const go = async (h, ms) => { location.hash = h; await wait(ms || 1800); };
    const q = s => document.querySelector(s);

    await go("#/home", 2400);

    /* ---- Services dropdown: broker item, real destinations, no bounce ---- */
    const svc = Array.from(document.querySelectorAll(".sf-nav [data-sf-drop]"))
      .find(d => (d.querySelector("summary").textContent || "").indexOf("Services") === 0);
    const items = svc ? Array.from(svc.querySelectorAll(".sf-drop-panel a")) : [];
    chk("services-nine-items", items.length === 9, "items=" + items.length);
    chk("services-no-homepage-bounce", items.every(a => (a.getAttribute("href") || "").indexOf("#/home?section=services") === -1), JSON.stringify(items.map(a => a.getAttribute("href"))));
    const broker = items.find(a => /Talk to a licensed broker/.test(a.textContent));
    chk("services-broker-item-present", !!broker, "items=" + items.length);
    chk("services-broker-target", !!broker && broker.getAttribute("href") === "#/property-value?service=broker", broker && broker.getAttribute("href"));

    /* ---- home keeps the calculator ---- */
    chk("home-still-has-calculator", !!q("#sf-estimator[data-est-root]") && !!q("[data-est-root] [data-est-card]"), "no calculator on home");

    /* ---- the broker landing is a services page, not a calculator ---- */
    await go("#/property-value?service=broker", 2400);
    chk("broker-page-hero", /Talk to a licensed broker/.test((q(".sf-pv-hero h1") || {}).textContent || ""), "h1=" + ((q(".sf-pv-hero h1") || {}).textContent));
    chk("broker-page-title", document.title === "Talk to a licensed broker | SEA ESTATES", "title=" + document.title);
    chk("broker-page-cta", /Talk to a licensed broker/.test((q(".sf-pv-actions .sf-primary-btn") || {}).textContent || ""), "cta=" + ((q(".sf-pv-actions .sf-primary-btn") || {}).textContent));
    chk("landing-has-no-calculator", !q(".sf-pv [data-est-root]") && !q(".sf-pv [data-est-card]"), "calculator leaked onto the landing");
    chk("landing-fallback-form", !!q(".sf-pv-form[data-sf-consult]"), "no consult form");
    const planningSelect = q(".sf-pv-form select[name=message]");
    chk("fallback-preselects-broker", !!planningSelect && planningSelect.value === "Talk to a licensed broker", "value=" + (planningSelect && planningSelect.value));
    /* The option value must be the human label, not the service key: the key
       used to be posted verbatim as the lead's message. */
    chk("planning-posts-human-label", !!planningSelect && planningSelect.value === planningSelect.options[planningSelect.selectedIndex].textContent, "value=" + (planningSelect && planningSelect.value));
    chk("broker-submit-label", /Request broker contact/.test((q(".sf-pv-form button[type=submit]") || {}).textContent || ""), "submit=" + ((q(".sf-pv-form button[type=submit]") || {}).textContent));
    /* The consent checkbox must keep a native rendering (appearance:none with
       no custom :checked style made ticking it invisible) and must toggle. */
    const consent = q(".sf-pv-form .sf-consent input");
    chk("consent-checkbox-native-and-toggles", !!consent && getComputedStyle(consent).appearance !== "none" && (consent.click(), consent.checked === true) && (consent.click(), consent.checked === false), "appearance=" + (consent && getComputedStyle(consent).appearance));

    /* ---- a different service still adapts the page ---- */
    await go("#/property-value?service=finance", 2200);
    chk("finance-page-hero", /Plan the financing/.test((q(".sf-pv-hero h1") || {}).textContent || ""), "h1=" + ((q(".sf-pv-hero h1") || {}).textContent));
    chk("finance-page-title", document.title === "Financing support | SEA ESTATES", "title=" + document.title);
    chk("finance-preselects-fallback", (q(".sf-pv-form select[name=message]") || {}).value === "Financing options", "value=" + ((q(".sf-pv-form select[name=message]") || {}).value));

    /* ---- the default landing keeps the first-person CTA promise ---- */
    await go("#/property-value", 2200);
    chk("default-landing-hero", /Get expert help with your property/.test((q(".sf-pv-hero h1") || {}).textContent || ""), "h1=" + ((q(".sf-pv-hero h1") || {}).textContent));
    chk("default-landing-no-calculator", !q(".sf-pv [data-est-root]"), "calculator mounted on the default landing");
    chk("default-cta-scrolls-to-form", (q(".sf-pv-actions .sf-primary-btn") || {}).getAttribute("data-sf-scroll") === "sf-pv-form", "cta target missing");
    chk("default-no-obligation-note", /no obligation/i.test((q(".sf-pv") || {}).textContent || ""), "no obligation note missing");
    /* No "Choose one" gate on the default landing: the first meaningful answer
       is already selected, so a visitor can submit without opening the select. */
    const defaultSelect = q(".sf-pv-form select[name=message]");
    chk("default-preselects-first-answer", !!defaultSelect && defaultSelect.value === "Just want to know my property value", "value=" + (defaultSelect && defaultSelect.value));

    /* ---- common questions: objections answered before the ask ---- */
    /* The FAQ must exist, start collapsed, toggle, restate only promises the
       page already makes, and add no fabricated proof. */
    const faq = q(".sf-pv-faq");
    const faqItems = faq ? Array.from(faq.querySelectorAll(".sf-pv-faq-item")) : [];
    chk("faq-present", !!faq && faqItems.length >= 5, "items=" + faqItems.length);
    chk("faq-all-collapsed", faqItems.length > 0 && faqItems.every(d => !d.open), "open=" + faqItems.filter(d => d.open).length);
    if (faqItems[0]) {
      faqItems[0].querySelector("summary").click();
      await wait(120);
      const opened = faqItems[0].open === true;
      faqItems[0].querySelector("summary").click();
      await wait(80);
      chk("faq-toggle-works", opened && faqItems[0].open === false, "afterOpen=" + opened + " afterClose=" + faqItems[0].open);
    } else {
      chk("faq-toggle-works", false, "no items");
    }
    const faqText = faq ? faq.textContent.replace(/\s+/g, " ") : "";
    chk("faq-answers-objections", /free/i.test(faqText) && /no obligation/i.test(faqText) && /one business day/i.test(faqText) && /never sold/i.test(faqText), "faq=" + faqText.slice(0, 120));
    chk("faq-no-fabricated-stats", !/\d+\s*(clients|properties sold|homes sold|years|happy families)/i.test(faqText), "stat found");
    chk("faq-privacy-link", !!q(".sf-pv-faq a[href='#/privacy']"), "no privacy link");

    /* ---- service explorer: one house, nine services ----
       The list is rendered from the same SERVICES array as the Services menu,
       so these checks compare it with the menu instead of repeating labels.
       Auto-advance only exists for a mouse user who allows motion, so the
       timing checks branch on the same media queries the page uses. Run the
       file again with -reduced-motion and -touch to cover the other branch. */
    const xReduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const xAuto = matchMedia("(hover: hover) and (pointer: fine)").matches && !xReduced;
    const xRoot = () => q("[data-sf-explorer]");
    const xBtns = () => Array.from(document.querySelectorAll("[data-sf-explorer] [data-sf-x-btn]"));
    const xDetails = () => Array.from(document.querySelectorAll("[data-sf-explorer] [data-sf-x-detail]"));
    const xActive = () => { const b = xBtns().find(el => el.getAttribute("aria-current") === "true"); return b ? Number(b.getAttribute("data-sf-x-btn")) : 0; };
    const menuHrefs = items.map(a => a.getAttribute("href"));
    const inView = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; };

    await go("#/property-value", 2200);
    chk("x-present", !!xRoot() && xBtns().length === 9, "buttons=" + xBtns().length);
    chk("x-ctas-match-menu", xDetails().length === 9 && JSON.stringify(xDetails().map(d => (d.querySelector("a") || {}).getAttribute && d.querySelector("a").getAttribute("href"))) === JSON.stringify(menuHrefs), JSON.stringify(xDetails().map(d => d.querySelector("a") && d.querySelector("a").getAttribute("href"))));
    chk("x-default-selling", xActive() === 2, "active=" + xActive());
    chk("x-one-detail-open", xDetails().filter(d => !d.hidden).length === 1 && !xDetails()[1].hidden, "open=" + xDetails().filter(d => !d.hidden).length);
    chk("x-roving-tabindex", xBtns().filter(b => b.tabIndex === 0).length === 1 && xBtns()[1].tabIndex === 0, "tabbable=" + xBtns().filter(b => b.tabIndex === 0).length);
    chk("x-no-calculator", !q(".sf-pv [data-est-root]"), "calculator on the landing");
    chk("x-no-h-scroll", document.documentElement.scrollWidth <= window.innerWidth + 2, "sw=" + document.documentElement.scrollWidth + " vw=" + window.innerWidth);

    /* Clicking a service changes the view in place: no navigation, its own CTA. */
    const hashBefore = location.hash;
    xBtns()[2].click();
    await wait(120);
    chk("x-click-selects-in-place", xActive() === 3 && location.hash === hashBefore, "active=" + xActive() + " hash=" + location.hash);
    chk("x-click-opens-its-cta", !xDetails()[2].hidden && xDetails()[1].hidden && xDetails()[2].querySelector("a").getAttribute("href") === "#/search?offer_type=rent", "href=" + xDetails()[2].querySelector("a").getAttribute("href"));

    /* Arrow keys move the selection and wrap at the ends. */
    xBtns()[2].focus();
    xBtns()[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await wait(80);
    chk("x-arrow-down", xActive() === 4 && document.activeElement === xBtns()[3], "active=" + xActive());
    xBtns()[3].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await wait(80);
    xBtns()[8].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await wait(80);
    chk("x-arrow-wraps", xActive() === 1, "active=" + xActive());
    xBtns()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    await wait(80);
    chk("x-arrow-up-wraps-back", xActive() === 9, "active=" + xActive());

    /* ?service=... opens the matching service. */
    const xMap = [["sell", 2], ["pre-selling", 4], ["appraisal", 5], ["broker", 6], ["manage", 7], ["title", 8], ["finance", 9]];
    const xBad = [];
    for (const [key, n] of xMap) {
      await go("#/property-value?service=" + key, 1500);
      if (xActive() !== n) xBad.push(key + "=" + xActive());
    }
    chk("x-service-param-opens-item", xBad.length === 0, xBad.join(", ") || "all seven match");

    /* The service that is already open must not become a dead link. */
    await go("#/property-value?service=finance", 1800);
    const sameCta = q("[data-sf-explorer] [data-sf-x-detail='9'] a");
    const hashFinance = location.hash;
    if (sameCta) sameCta.click();
    await wait(1300);
    chk("x-same-service-cta-scrolls-to-form", !!sameCta && location.hash === hashFinance && inView(q("#sf-pv-form")), "hash=" + location.hash + " formInView=" + inView(q("#sf-pv-form")));

    /* Timing rules. */
    await go("#/home", 1200);
    await go("#/property-value", 2000);
    xRoot().scrollIntoView({ block: "center" });
    await wait(700);
    const pauseBtn = () => q("[data-sf-explorer] [data-sf-x-pause]");
    chk("x-auto-flag", xRoot().getAttribute("data-auto") === (xAuto ? "on" : "off"), "data-auto=" + xRoot().getAttribute("data-auto") + " expected=" + (xAuto ? "on" : "off"));
    if (xAuto) {
      chk("x-pause-visible", !!pauseBtn() && getComputedStyle(pauseBtn()).display !== "none" && pauseBtn().getBoundingClientRect().height >= 44, "pause missing or under 44px");
      const before = xActive();
      await wait(4800);
      chk("x-auto-advances", xActive() === before + 1, "before=" + before + " after=" + xActive());
      pauseBtn().click();
      await wait(120);
      const held = xActive();
      chk("x-pause-toggles-label", /^Play$/i.test(pauseBtn().textContent.trim()) && xRoot().getAttribute("data-paused") === "true", "label=" + pauseBtn().textContent.trim());
      await wait(4800);
      chk("x-paused-holds", xActive() === held, "held=" + held + " now=" + xActive());
      pauseBtn().click();
      await wait(120);
      chk("x-play-resumes-label", /^Pause$/i.test(pauseBtn().textContent.trim()) && xRoot().getAttribute("data-paused") === "false", "label=" + pauseBtn().textContent.trim());

      await go("#/home", 1200);
      await go("#/property-value", 2000);
      xRoot().scrollIntoView({ block: "center" });
      await wait(700);
      xBtns()[4].click();
      await wait(150);
      chk("x-manual-pick-stops-auto", xRoot().getAttribute("data-paused") === "true", "paused=" + xRoot().getAttribute("data-paused"));
      await wait(4800);
      chk("x-manual-pick-stays", xActive() === 5, "active=" + xActive());
    } else {
      chk("x-no-pause-control", !pauseBtn() || getComputedStyle(pauseBtn()).display === "none", "pause control is showing");
      const before = xActive();
      await wait(4800);
      chk("x-no-auto-advance", xActive() === before, "before=" + before + " after=" + xActive());
      if (xReduced) {
        const running = xRoot().getAnimations({ subtree: true }).filter(a => a.playState === "running").length;
        chk("x-reduced-motion-nothing-runs", running === 0, "running animations=" + running);
      }
    }

    /* ---- steps: three quiet cards, no sticky stage ---- */
    chk("steps-three-cards-with-vignettes", document.querySelectorAll(".sf-pv-steps-list > li .sf-pv-vig").length === 3, "vignettes=" + document.querySelectorAll(".sf-pv-steps-list > li .sf-pv-vig").length);
    chk("steps-no-sticky-stage", !q(".sf-pv-stage") && !q("[data-sf-journey]"), "old stage still present");

    /* ---- closing band: contact details come from the shared contact setting ---- */
    const bandText = () => { const el = q("#sf-contact .sf-contact-details"); return el ? el.textContent.replace(/\s+/g, " ").trim() : ""; };
    const pvBand = bandText();
    chk("band-has-tel-and-mail", !!q("#sf-contact .sf-contact-details a[href^='tel:']") && !!q("#sf-contact .sf-contact-details a[href^='mailto:']"), "band=" + pvBand);
    chk("band-cta-scrolls-to-form", (q("#sf-contact .sf-cta-go") || {}).getAttribute && q("#sf-contact .sf-cta-go").getAttribute("data-sf-scroll") === "sf-pv-form", "cta target missing");
    await go("#/home", 2200);
    chk("band-matches-home", pvBand !== "" && pvBand === bandText(), "property-value=" + pvBand + " | home=" + bandText());
    await go("#/property-value", 1500);
  } catch (e) {
    window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.message || e) });
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
