"use strict";
/* Agent websites, Phases 2 and 3 in the back office, in demo mode so this runs offline:
   the Verified checks in the licence check, an agent on each side of a deal with the client's say,
   review links from closed deals, Reviews in Users & Access, town rules in Lead routing, and a
   one-time reply to a review in My website. Desktop and phone widths in CI. */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }
(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = s => document.querySelector(s);
    const qa = s => Array.from(document.querySelectorAll(s));
    const text = s => ((q(s) || {}).textContent || "").replace(/\s+/g, " ");
    const signIn = async role => {
      localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
      location.hash = "";
      q("#auth-role").value = role;
      q("#auth-test").click(); await wait(900);
    };
    const go = async view => { q('#nav [data-view="' + view + '"]').click(); await wait(900); };
    const tab = async name => { q('[data-users-tab="' + name + '"]').click(); await wait(700); };

    // An agent replies once to a published review.
    await signIn("agent");
    await go("website");
    chk("My website lists the agent's published reviews", /Client reviews/.test(text(".site-reviews")) && /asking price was too high/.test(text(".site-reviews")));
    const replyBtn = q("[data-site-reply]");
    q(".site-reviews textarea").value = "Salamat po, Jun!";
    replyBtn.click(); await wait(600);
    chk("a reply is posted once and can no longer be edited", /Your reply: Salamat po, Jun!/.test(text(".site-reviews")) && !q("[data-site-reply]") && !q(".site-reviews textarea"));
    chk("the editor explains when the record and reviews show", /closed deals that name you, and reviews our office published/.test(text(".site-editor")));

    // A Super Admin records the Verified checks.
    await signIn("super-admin");
    await go("users");
    await tab("approved");
    q('[data-licence-check="demo-approved-1"]').click(); await wait(300);
    chk("the licence check offers the two Verified checks, unticked", !!q("#lc-id") && !!q("#lc-phone") && !q("#lc-id").checked && !q("#lc-phone").checked && /Do not keep a copy of the ID/.test(text("#lc-modal")));
    q("#lc-no").value = "0012345"; q("#lc-name").value = "Ana M. Lopez"; q("#lc-until").value = "2027-08-31";
    const bk = q("#lc-broker"); if (bk) bk.checked = true;
    q("#lc-id").checked = true;
    q("[data-lc-save]").click(); await wait(700);
    const card = () => (q('[data-licence-check="demo-approved-1"]') || document.body).closest(".user-card");
    chk("one check alone does not make Verified", /Licence checked, valid until 2027-08-31/.test(card().textContent) && !card().querySelector("[data-verified-chip]"));
    q('[data-licence-check="demo-approved-1"]').click(); await wait(300);
    chk("the ID check stays ticked when the box opens again", q("#lc-id").checked === true);
    q("#lc-phone").checked = true;
    q("[data-lc-save]").click(); await wait(700);
    chk("both checks show Verified on the account", !!card().querySelector("[data-verified-chip]"));

    // Reviews: the published rule, then publish one.
    await tab("reviews");
    chk("Reviews shows the published rule", /Our review rule\./.test(text("#reviews")) && /never decline a review because it is critical/.test(text("#reviews")));
    chk("a sent review waits for a Super Admin", /Waiting for you \(1\)/.test(text("#reviews")) && /Published \(0\)/.test(text("#reviews")));
    q('[data-review-moderate="approved"]').click(); await wait(700);
    chk("publishing moves it to Published", /Waiting for you \(0\)/.test(text("#reviews")) && /Published \(1\)/.test(text("#reviews")) && !!q('[data-review-moderate="rejected"]'));

    // Lead routing: a town rule.
    await tab("routing");
    chk("Lead routing has town rules for Value Guide requests", /Town rules for Value Guide requests/.test(text("#routing")) && /No town rules yet/.test(text("#routing")));
    q("#rt-town").value = "lipa-city"; q("#rt-town").dispatchEvent(new Event("change", { bubbles: true }));
    const person = q('[data-rt-town-person][value="demo-approved-1"]');
    person.checked = true;
    q("[data-rt-town-set]").click(); await wait(500);
    chk("a town rule lists the town and its people", /Lipa City\s*Ana Lopez/.test(text(".rt-town-list")), text(".rt-town-list"));
    q("#rt-enabled").checked = true;
    q("[data-routing-save]").click(); await wait(700);
    chk("saving keeps the rule, even with no broker ticked", /Lipa City\s*Ana Lopez/.test(text(".rt-town-list")) && q("#rt-enabled").checked);
    q("#rt-town").value = "lipa-city"; q("#rt-town").dispatchEvent(new Event("change", { bubbles: true })); await wait(100);
    chk("choosing a town ticks the people already set for it", q('[data-rt-town-person][value="demo-approved-1"]').checked === true);
    q('[data-rt-town-remove="lipa-city"]').click(); await wait(400);
    chk("a rule can be removed", !q(".rt-town-list"));

    // A deal with an agent on each side and the client's say, then a review link once it closes.
    await go("transactions");
    q('[data-tx-open="tx-seed-2"]').click(); await wait(700);
    q("[data-tx-edit]").click(); await wait(400);
    chk("the deal form names a buyer's agent and a seller's agent from the team", !!q("#tx-buyer-agent") && !!q('#tx-buyer-agent option[value="demo-approved-1"]') && !!q('#tx-seller-agent option[value="demo-approved-2"]'));
    chk("the client's choices start unticked", q("#tx-show-deal").checked === false && q("#tx-show-price").checked === false);
    q("#tx-buyer-agent").value = "demo-approved-1"; q("#tx-seller-agent").value = "demo-approved-2";
    q("#tx-show-deal").checked = false; q("#tx-show-price").checked = true;
    q("[data-tx-save]").click(); await wait(700);
    chk("the deal shows both agents, counted but not listed (price alone is not enough)",
      /Buyer's agent\s*Ana Lopez/.test(text(".hero ~ .grid")) && /Seller's agent\s*Marco Villanueva/.test(text(".hero ~ .grid")) && /Counted, not listed/.test(text(".hero ~ .grid")), text(".hero ~ .grid").slice(0, 400));
    chk("an open deal has no review link", !q("[data-tx-review]"));
    ["title", "taxdec", "authority"].forEach(k => { const box = q('[data-tx-chk="tx-seed-2"][data-chk-key="' + k + '"]'); if (box && !box.checked) box.click(); });
    await wait(300);
    q("[data-tx-advance]").click(); await wait(700);
    const links = qa("[data-tx-review]");
    chk("a closed deal offers a review link for each agent on it", links.length === 2 && /Review link for Ana Lopez/.test(links[0].textContent), links.map(l => l.textContent).join(" | "));
    links[0].click(); await wait(500);
    chk("the review link is shown to copy, and says it works once for 30 days", /#\/review\/[0-9a-z]{64}$/.test((q("#rv-link") || {}).value || "") && /works once, for 30 days/.test(text("#rv-modal")));
    q("[data-rv-close]").click(); await wait(200);
    chk("no sideways scroll", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth + " > " + window.innerWidth);
  } catch (e) {
    chk("test ran without error", false, String(e && e.stack || e));
  } finally {
    window.__msOk = window.__msChecks.length > 0 && window.__msChecks.every(c => c.ok);
    window.__msDone = true;
  }
})();
