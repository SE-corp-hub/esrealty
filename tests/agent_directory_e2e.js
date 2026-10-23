"use strict";
/* Agent websites, Phases 2 and 3 on the public site: the Find an agent directory and its menu link,
   check-an-agent, the Verified badge, track record, reviews and seller box on an agent's page, the
   Value Guide started from that page, a client's review link, and "Listed by" on a listing.
   The listing API is stubbed, so this runs offline. Desktop and phone widths in CI. */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }
(async () => {
  const realFetch = window.fetch;
  const sent = [];
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = s => document.querySelector(s);
    const qa = s => Array.from(document.querySelectorAll(s));
    const text = s => ((q(s) || {}).textContent || "").replace(/\s+/g, " ");
    const NAMES = ["Maria Santos Dela Cruz", "Beatriz Lim", "Carlo Reyes", "Dana Uy", "Eli Ramos", "Fe Cruz", "Gino Tan", "Hana Go", "Ivy Sy", "Jun Dee", "Kat Ong", "Leo Yu"];
    const AGENTS = NAMES.map((name, i) => {
      const a = { slug: name.toLowerCase().replace(/[^a-z]+/g, "-"), name, role_label: i === 1 ? "Real estate broker" : "PRC-accredited real estate salesperson",
        towns: i % 2 ? ["batangas-city"] : ["lipa-city", "malvar", "tanauan-city"], needs: i % 3 ? ["buy"] : ["sell", "lots"], languages: ["filipino", "english"],
        licence_checked_on: "2026-10-12" };
      if (i < 6) a.reply = "within 30 minutes";
      if (i === 0) Object.assign(a, { verified_on: "2026-10-20", deals: 2, deals_since: "2025-03", listing_count: 3, review_count: 1, viber: "+639171234567" });
      if (i === 4) Object.assign(a, { deals: 14, deals_since: "2023-11", deals_window: "3y" });
      if (i === 3) Object.assign(a, { deals: 9, deals_since: "2024-11" });
      return a;
    });
    const PAGE = {
      slug: "maria-santos-dela-cruz", name: "Maria Santos Dela Cruz", role: "salesperson", role_label: "PRC-accredited real estate salesperson",
      licence: { no: "0012345", valid_until: "2027-08-31", checked_on: "2026-10-12" }, verified_on: "2026-10-20",
      broker: { name: "Alfredo B. Reyes", licence_no: "0004321" }, pitch: "Lots and homes in Lipa.", bio: "I grew up in Lipa.", bio_lang: "en",
      photo: "", towns: ["lipa-city"], needs: ["sell", "lots"], languages: ["filipino"], contacts: { call: "+639171234567" },
      sections: ["listings", "about"], accent: "rust", reply: "within 30 minutes", listing_count: 0, listings: [],
      record: { deals: 3, buyer: 1, seller: 1, rentals: 1, since: "2025-03", rows: [{ month: "2025-03", side: "buyer", type: "lot-only", town: "Lipa City", lot_sqm: 300 }, { month: "2026-05", side: "rental", type: "house-and-lot", town: "Lipa City" }] },
      reviews: [{ label: "Rhea D.", town: "Lipa City", month: "2026-09", body: "We were buying from Dubai and Maria sent the title before we paid anything.", reply: "Salamat, Rhea!" }]
    };
    const OPEN = "a".repeat(64), USED = "b".repeat(64);
    window.fetch = function (url, init) {
      const u = new URL(String(url), location.href);
      const reply = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
      const p = u.pathname;
      if (/\/agents$/.test(p)) {
        const town = u.searchParams.get("town");
        const list = AGENTS.filter(a => !town || a.towns.indexOf(town) >= 0);
        return reply(200, { data: list, total: list.length });
      }
      if (/\/agent-check$/.test(p)) {
        sent.push({ kind: "check", q: u.searchParams.get("q") });
        return reply(200, { data: u.searchParams.get("q") === "0012345" ? [{ slug: PAGE.slug, name: PAGE.name, role_label: PAGE.role_label, licence_no: "0012345", verified_on: "2026-10-20" }] : [] });
      }
      if (/\/agents\/maria-santos-dela-cruz$/.test(p)) return reply(200, { data: PAGE });
      if (/\/agents\/[^/]+\/taps$/.test(p)) { sent.push({ kind: "tap", url: p, body: JSON.parse(init.body) }); return reply(202, { ok: true }); }
      if (/\/reviews\/lookup$/.test(p)) {
        const t = JSON.parse(init.body).token;
        sent.push({ kind: "lookup", url: String(url) });
        if (t === OPEN) return reply(200, { data: { agent: "Maria Santos Dela Cruz", open: true, status: "open" } });
        if (t === USED) return reply(200, { data: { agent: "Maria Santos Dela Cruz", open: false, status: "used" } });
        return reply(404, { error: "Review link not found" });
      }
      if (/\/reviews$/.test(p)) { sent.push({ kind: "review", body: JSON.parse(init.body) }); return reply(201, { message: "Thank you." }); }
      if (/\/listings\/L1$/.test(p)) return reply(200, { data: { id: "L1", title: "Corner lot in Sabang", property_type: "lot-only", offer_type: "sale", price: 2850000, display_price: 2850000,
        city: "Lipa City", province: "Batangas", status: "available", agent_name: "Maria Santos Dela Cruz", images: [], details: { agent_prc: "0012345", agent_slug: "maria-santos-dela-cruz", license_to_sell: "LTS No. 0123", license_to_sell_until: "2027-06-30" } } });
      return realFetch.apply(this, arguments);
    };
    document.addEventListener("click", e => { const a = e.target.closest && e.target.closest("a[data-ag-tap]"); if (a) e.preventDefault(); }, true);

    // The menu link, once at least 8 agents are published.
    window.ESREALTY_STOREFRONT.refresh(); await wait(900);
    chk("Find an agent joins the menu once 8 or more agents are published", !!q('.sf-nav a[href="#/agents"]') && !!q('[data-sf-menu-panel] a[href="#/agents"]'));

    // The directory.
    location.hash = "#/agents"; await wait(1200);
    chk("the directory opens with its plain headline", /Find an agent you can check/.test(text(".agd h1")));
    chk("the page title says what it is", /^Find an agent you can check \| SEA ESTATES$/.test(document.title), document.title);
    chk("ten agents show first, with a count", qa(".agd-card").length === 10 && /12 agents/.test(text(".agd-status")), qa(".agd-card").length + " / " + text(".agd-status"));
    const first = qa(".agd-card")[0];
    chk("each card shows the licence check and its date", /Licence checked 12 Oct 2026/.test(first.textContent));
    chk("Verified shows only for an agent who passed both checks", /Verified/.test(first.textContent) && !/Verified/.test(qa(".agd-card")[1].textContent));
    chk("measured reply time shows; without it, New on SEA ESTATES", /Usually replies within 30 minutes/.test(first.textContent) && /New on SEA ESTATES/.test(qa(".agd-card")[7].textContent));
    chk("numbers show only with a record behind them", /2\s*deals since Mar 2025/.test(first.textContent) && /3\s*listings/.test(first.textContent) && /1\s*review/.test(first.textContent)
      && !qa(".agd-card")[1].querySelector(".agd-nums") && !/\b0\b/.test(qa(".agd-card")[1].textContent));
    const viber = first.querySelector("[data-agd-viber]");
    chk("a card has a Viber button when the agent published a Viber number, and only then", !!viber && /^viber:\/\/chat\?number=%2B639171234567$/.test(viber.getAttribute("href")) && !qa(".agd-card")[1].querySelector("[data-agd-viber]"));
    document.addEventListener("click", e => { if (e.target.closest && e.target.closest("[data-agd-viber]")) e.preventDefault(); }, { capture: true, once: true });
    viber.click(); await wait(300);
    chk("a Viber tap from the directory is counted for that agent", sent.some(s => s.kind === "tap" && /maria-santos-dela-cruz\/taps$/.test(s.url) && s.body.kind === "viber"));
    chk("an agent with 36 months of records shows deals in 3 years", /14\s*deals in 3 years/.test(qa(".agd-card")[4].textContent));
    chk("every card links to the agent's website", qa(".agd-card").every(c => c.querySelector('a.agd-go[href^="#/agents/"]')) && /View website: Maria Santos Dela Cruz/.test(first.querySelector(".agd-go").textContent));
    chk("the check-an-agent box and how we check are beside the list", !!q("#agd-check") && /No agent pays to be here/.test(text(".agd-aside")) && /never asks you to pay into a personal account/.test(text("#agd-check")));
    chk("a fallback ends the list", /Not finding the right person\?/.test(text(".agd-fallback")) && !!q('.agd-fallback a[href*="property-value"]'));
    q("[data-agd-more]").click(); await wait(400);
    chk("Show more adds the rest and moves focus to the first new agent", qa(".agd-card").length === 12 && document.activeElement === qa(".agd-card h2 a")[10] && !q("[data-agd-more]"));

    // Filters from the fixed lists.
    q('.agd-filters select[name="town"]').value = "lipa-city";
    q(".agd-filters button[type=submit]").click(); await wait(1000);
    chk("a town filter shows that town's agents and says so", /town=lipa-city/.test(location.hash) && /6 agents in Lipa City/.test(text(".agd-status")) && qa(".agd-card").length === 6, text(".agd-status"));
    const chip = q('[data-agd-remove="town"]');
    chk("the filter shows as a chip that can be removed", !!chip && /Remove filter: Lipa City/.test(chip.textContent));
    chip.click(); await wait(1000);
    chk("removing it shows everyone again", !/town=/.test(location.hash) && /12 agents/.test(text(".agd-status")));
    q('.agd-filters select[name="sort"]').value = "deals";
    q(".agd-filters button[type=submit]").click(); await wait(1000);
    chk("Most deals puts the agent with the most deals first", /Eli Ramos/.test(qa(".agd-card")[0].textContent) && /Dana Uy/.test(qa(".agd-card")[1].textContent));
    chk("changing a filter alone does not reload the page (it waits for Show agents)", (() => { const before = location.hash; q('.agd-filters select[name="need"]').value = "sell"; q('.agd-filters select[name="need"]').dispatchEvent(new Event("change", { bubbles: true })); return location.hash === before; })());

    // Check an agent.
    const box = q("#agd-check");
    box.querySelector("input").value = "0012345";
    box.querySelector("button[type=submit]").click(); await wait(500);
    chk("a licence number that matches shows the agent and their page", /Maria Santos Dela Cruz/.test(text(".agd-check-result")) && /Verified on 20 Oct 2026/.test(text(".agd-check-result")) && !!q('.agd-check-result a[href="#/agents/maria-santos-dela-cruz"]'));
    box.querySelector("input").value = "0999 888 7777";
    box.querySelector("button[type=submit]").click(); await wait(500);
    chk("a miss says to call the office before paying", /No published agent matches\. Call our office/.test(text(".agd-check-result")));
    box.querySelector("input").value = "12";
    box.querySelector("button[type=submit]").click(); await wait(200);
    chk("too short to check is explained without asking the server", /Enter a licence number or a full phone number/.test(text(".agd-check-result")) && sent.filter(s => s.kind === "check").length === 2);
    chk("no sideways scroll on the directory", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth + " > " + window.innerWidth);
    const small = qa(".agd button, .agd a.agd-btn, .agd select, .agd input").filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44; });
    chk("directory controls are at least 44 px tall", small.length === 0, small.map(e => e.className || e.name).join(", "));
    location.hash = "#/agents?check=1"; await wait(1200);
    chk("the agent page's Check an agent link lands in the lookup", document.activeElement && document.activeElement.id === "agd-q");

    q('[data-sf-auth="signup-agent"]').click(); await wait(600);
    chk("Join as an agent opens sign-up with the agent role and asks for the licence number",
      !q("#auth-screen").classList.contains("hidden") && q("#auth-request-role").value === "agent" && q("#auth-prc-field").style.display === "" && q("#auth-broker-field").style.display === "");
    const closeAuth = q("#auth-close"); if (closeAuth) closeAuth.click(); else q("#auth-screen").classList.add("hidden");
    await wait(400);

    // An agent's page with Phase 3 proof.
    location.hash = "#/agents/maria-santos-dela-cruz"; await wait(1200);
    chk("Verified shows in the hero and on the licence card with its date", /Verified 20 Oct 2026/.test(text(".ag-chips")) && /Verified on 20 Oct 2026: government ID seen and phone confirmed by our office\./.test(text(".ag-card")));
    chk("the hero counts deals since the first month, and reviews", /3\s*deals recorded since Mar 2025/.test(text(".ag-stats")) && /1\s*client review/.test(text(".ag-stats")));
    chk("the track record counts by side and rentals, from our records", /3 deals closed through SEA ESTATES since Mar 2025/.test(text(".ag-record")) && /1\s*as buyer’s agent/.test(text(".ag-record")) && /1\s*as seller’s agent/.test(text(".ag-record")) && /1\s*rental(?!s)/.test(text(".ag-record")), text(".ag-record").slice(0, 300));
    chk("only deals the client agreed to are listed, without a price", qa(".ag-table tbody tr").length === 2 && /Mar 2025\s*Lot, 300 sqm\s*Lipa City\s*Buyer\s*Not shown/.test(text(".ag-table tbody")) && /May 2026\s*House and lot\s*Lipa City\s*Rental/.test(text(".ag-table tbody")) && /Other deals are counted but not listed\./.test(text(".ag-record")), text(".ag-table tbody"));
    chk("the review shows with first name, initial, town and month, and the agent's reply", /We were buying from Dubai/.test(text(".ag-reviews")) && /Rhea D\., Lipa City, Sep 2026\. Linked to a closed deal\./.test(text(".ag-reviews")) && /Maria replied: Salamat, Rhea!/.test(text(".ag-reviews")));
    chk("no star ratings anywhere", !/★|\bstars?\b/i.test(text(".ag")));
    const sell = q("[data-ag-sell]");
    chk("sellers get a Value Guide button that names the agent", !!sell && /Start the Value Guide with Maria/.test(sell.textContent) && /#\/home\?section=estimator&agent=maria-santos-dela-cruz$/.test(sell.getAttribute("href")));
    chk("the footer links to check an agent", !!q('.ag-footer a[href="#/agents?check=1"]'));
    chk("no sideways scroll on the agent page", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth + " > " + window.innerWidth);
    sell.click(); await wait(1600);
    chk("the Value Guide knows whose page it came from", window.ESREALTY_VG_AGENT && window.ESREALTY_VG_AGENT.slug === "maria-santos-dela-cruz" && window.ESREALTY_VG_AGENT.name === "Maria Santos Dela Cruz", JSON.stringify(window.ESREALTY_VG_AGENT));
    chk("and tells the visitor the request goes to that agent", /Your Value Guide request goes to Maria Santos Dela Cruz, whose page you came from/.test(text(".sf-vg-agent")) && !!q('.sf-vg-agent a[href="#/agents/maria-santos-dela-cruz"]'));
    location.hash = "#/home"; await wait(900);
    chk("the plain home page has no agent note and sends nothing to an agent", !q(".sf-vg-agent") && !window.ESREALTY_VG_AGENT);

    // A client's review link.
    location.hash = "#/review/" + OPEN; await wait(1200);
    chk("an open review link shows the form for that agent", /Review Maria Santos Dela Cruz/.test(text(".sf-review h1")) && !!q("[data-sf-review]") && /There are no star ratings/.test(text(".sf-review")));
    chk("the consent box starts unticked", q('[data-sf-review] input[name="consent"]').checked === false);
    q("[data-sf-review] button[type=submit]").click(); await wait(300);
    chk("missing answers are explained beside each field", /Enter your first name\./.test(text("[data-sf-review]")) && /Tick this box so we may show your review\./.test(text("[data-sf-review]")) && !sent.some(s => s.kind === "review"));
    const f = q("[data-sf-review]");
    f.first_name.value = "Rhea"; f.last_name.value = "Dizon"; f.review.value = "Maria did the viewing on video and sent the title first."; f.consent.checked = true;
    f.querySelector("button[type=submit]").click(); await wait(800);
    const rv = sent.find(s => s.kind === "review");
    chk("the review is sent with consent", !!rv && rv.body.first_name === "Rhea" && rv.body.consent === true && rv.body.token === OPEN, JSON.stringify(rv));
    chk("the link's secret never goes in a request address", sent.filter(s => s.kind === "lookup").every(s => s.url.indexOf(OPEN) < 0));
    chk("and the client is thanked", /Thank you/.test(text(".sf-review-done")) && /after a quick check by our office/.test(text(".sf-review-done")));
    location.hash = "#/review/" + USED; await wait(1200);
    chk("a used link says so", /This review has already been sent/.test(text(".sf-review h1")) && !q("[data-sf-review]"));
    location.hash = "#/review/nope"; await wait(1200);
    chk("a broken link explains what to do", /This review link does not work/.test(text(".sf-review h1")));

    // Listed by.
    location.hash = "#/listing/L1"; await wait(1500);
    const listed = q(".sf-trust-agent a");
    chk("a pre-selling licence to sell shows with its valid-until date", /LTS No\. 0123\s*DHSUD License to Sell number for this property, valid until 2027-06-30\./.test(text(".sf-dhsud")), text(".sf-dhsud"));
    chk("Listed by links to the agent's page", !!listed && listed.getAttribute("href") === "#/agents/maria-santos-dela-cruz" && /Maria Santos Dela Cruz/.test(listed.textContent), text(".sf-trust-agent"));
  } catch (e) {
    chk("test ran without error", false, String(e && e.stack || e));
  } finally {
    window.fetch = realFetch;
    window.__msOk = window.__msChecks.length > 0 && window.__msChecks.every(c => c.ok);
    window.__msDone = true;
  }
})();
