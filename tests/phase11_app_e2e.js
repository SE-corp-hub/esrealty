"use strict";
/* Phase 11 (22 Oct): commission engine (J1), payout approvals and statements (J2). Demo, super-admin. */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }
(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = s => document.querySelector(s), qa = s => Array.from(document.querySelectorAll(s));
    const setVal = (sel, v) => { const el = q(sel); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    window.confirm = () => true;
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    q("#auth-role").value = "super-admin";
    q("#auth-test").click(); await wait(700);
    const H = window.__ESREALTY_TEST_HELPERS, S = H.getState();
    chk("the commission engine is loaded", !!window.ESREALTY_COMMISSION && typeof window.ESREALTY_COMMISSION.splitFor === "function");
    // A deal closed this month.
    const t = (S.transactions || [])[0];
    chk("a demo deal exists", !!t);
    Object.assign(t, { stage: "doas", doasDate: new Date().toISOString().slice(0, 10), price: 5000000, agentName: "Ana Agent", referralName: "Ben Referrer", title: "Test house" });
    delete t.commission;
    S.adminTab = "commission";
    q('#nav [data-view="admin"]').click(); await wait(800);
    const tabBtn = q('[data-admin-tab="commission"]'); if (tabBtn) { tabBtn.click(); await wait(600); }
    chk("commission settings show withholding", !!q("#com-wht"));
    // Shares that do not add to 100 are refused.
    setVal("#com-agent", "60"); q("[data-com-save]").click(); await wait(400);
    chk("shares that do not add up to 100 are refused", Number(S.commission.settings.agentShare) === 50, String(S.commission.settings.agentShare));
    setVal("#com-agent", "50"); setVal("#com-wht", "10"); q("[data-com-save]").click(); await wait(500);
    chk("withholding is saved", Number(S.commission.settings.withholdingPct) === 10);
    const row = qa("table.data tr").find(r => /Test house/.test(r.textContent));
    chk("the register shows the deal with its parts", !!row && /150,000/.test(row.textContent) && /60,000/.test(row.textContent) && /75,000/.test(row.textContent) && /15,000/.test(row.textContent), row ? row.textContent : "none");
    // Per-deal split with a co-broke partner.
    q('[data-com-split="' + t.id + '"]').click(); await wait(400);
    chk("the split editor opens with a preview", !!q("#com-modal") && !!q("#cs-preview table"));
    setVal("#cs-cb-name", "XYZ Realty"); setVal("#cs-cb-pct", "50"); await wait(200);
    chk("the preview shows the co-broke share and withholding", /XYZ Realty/.test(q("#cs-preview").textContent) && /75,000/.test(q("#cs-preview").textContent) && /7,500/.test(q("#cs-preview").textContent), q("#cs-preview").textContent.slice(0, 200));
    q("[data-com-split-save]").click(); await wait(600);
    chk("the deal keeps its own split", t.commission && t.commission.cobrokeName === "XYZ Realty" && t.commission.cobrokePct === 50, JSON.stringify(t.commission));
    const row2 = qa("table.data tr").find(r => /Test house/.test(r.textContent));
    chk("the register marks it and shows the co-broke amount", !!row2 && /own split/.test(row2.textContent) && /75,000/.test(row2.textContent));
    // Payouts: pending -> approved -> paid.
    const pt = q('[data-admin-tab="payouts"]'); pt.click(); await wait(600);
    const gen = q("[data-payouts-generate]"); if (gen && !gen.disabled) { gen.click(); await wait(800); }
    const po = () => (S.commission.payouts || []).find(p => p.transactionId === t.id);
    chk("a pending payout is made for the closed deal", po() && po().status === "pending");
    chk("paying is not offered before approval", !q('[data-payout="' + t.id + '"][data-payout-status="paid"]') && !!q('[data-payout="' + t.id + '"][data-payout-status="approved"]'));
    q('[data-payout="' + t.id + '"][data-payout-status="approved"]').click(); await wait(500);
    chk("approval records who and when", po().status === "approved" && !!po().approvedBy && !!po().approvedAt, JSON.stringify(po()));
    q('[data-payout="' + t.id + '"][data-payout-status="paid"]').click(); await wait(500);
    chk("then it can be marked paid, with its history", po().status === "paid" && !!po().paidAt && (po().history || []).length === 2);
    // Statement.
    const person = q("#com-st-person");
    chk("the statement lists the people paid this month", !!person && Array.from(person.options).map(o => o.value).join() === "Ana Agent,Ben Referrer,XYZ Realty", person ? Array.from(person.options).map(o => o.value).join() : "none");
    person.value = "Ana Agent";
    q("[data-com-statement]").click(); await wait(500);
    const st = q("#com-print-root");
    chk("Ana's statement: share, withholding, net", !!st && /Ana Agent/.test(st.textContent) && /37,500/.test(st.textContent) && /3,750/.test(st.textContent) && /33,750/.test(st.textContent), st ? st.textContent.slice(0, 300) : "none");
    chk("it can be printed", !!q("[data-com-print]"));
    q("[data-com-close]").click(); await wait(200);
    // J5: deal documents.
    Object.assign(t, { buyerName: "Carla Buyer", sellerName: "Sam Seller", reservationFee: 50000, reservationDate: "2026-10-01" });
    S.txDetail = t.id;
    q('#nav [data-view="transactions"]').click(); await wait(800);
    const db = q('[data-tx-docs="' + t.id + '"]');
    chk("a deal has Documents", !!db);
    db.click(); await wait(500);
    const txt = () => (q("#docs-text") || {}).textContent || "";
    chk("the offer to buy is filled from the deal", /LETTER OF INTENT TO PURCHASE/.test(txt()) && /Carla Buyer/.test(txt()) && /Sam Seller/.test(txt()) && /Five Million Pesos/.test(txt()), txt().slice(0, 300));
    chk("unknown details are blank lines to fill in", /____________/.test(txt()) && /to fill in/.test((q(".docs-fields summary") || {}).textContent || ""));
    chk("it says to have a lawyer review it", /not legal advice/.test(q("#docs-modal").textContent));
    setVal("#docf-buyer_address", "12 Mabini St, Lipa"); await wait(100);
    chk("typing updates the document", /12 Mabini St, Lipa/.test(txt()));
    setVal("#docs-tpl", "authority"); await wait(500);
    chk("the exclusive authority to sell names the broker and the commission", /EXCLUSIVE AUTHORITY TO SELL/.test(txt()) && /commission of 3%/.test(txt()) && /90 days/.test(txt()), txt().slice(0, 400));
    chk("what was typed is kept on the deal", t.docFields && t.docFields.buyer_address === "12 Mabini St, Lipa", JSON.stringify(t.docFields));
    chk("it can be printed or copied", !!q("[data-docs-print]") && !!q("[data-docs-copy]"));
    q("[data-docs-close]").click(); await wait(200);
    chk("no sideways scroll", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth + " > " + window.innerWidth);
  } catch (e) { window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.stack || e.message || e) + "" }); }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
