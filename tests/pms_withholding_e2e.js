"use strict";
/* Property Management: withholding tax for company tenants (2026-10-18, demo
   data). A tenant marked as withholding (5%) pays rent less the tax and gives a
   BIR Form 2307; the payment records both, the month counts as paid, the list
   shows "2307 to collect" until it's received, and the receipt and the owner
   statement show the tax. Charges and other tenants have no withholding. */
window.__msChecks = [];
window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail: String(detail) });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 60) { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(100); } return !!fn(); }
const q = s => document.querySelector(s);
const qa = s => Array.from(document.querySelectorAll(s));
const noSideways = () => document.documentElement.scrollWidth <= window.innerWidth + 2;
const tab = async name => { const t = q('[data-pmtab="' + name + '"]'); if (t && t.offsetParent !== null) t.click(); else { const s = q("#pms-section"); s.value = name; s.dispatchEvent(new Event("change", { bubbles: true })); } await wait(450); };
const setVal = (sel, v) => { const el = q(sel); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
const num = s => Number(String(s || "").replace(/[^0-9.-]/g, ""));
const shown = sel => { const el = q(sel); return !!el && el.style.display !== "none"; };

(async () => {
  try {
    location.hash = "#/home";
    window.confirm = () => true;
    await until(() => q("#auth-test"));
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    q("#auth-role").value = "super-admin";
    q("#auth-test").click();
    await until(() => q("#content") && q("#content").children.length > 0);
    await wait(400);
    q('#nav [data-view="pms"]').click(); await wait(800);
    const S = window.__ESREALTY_TEST_HELPERS.getState();
    const L = window.ESPMSLEDGER;
    const lease = S.pms.leases.find(l => l.id === "l-seed-1");
    const tenant = S.pms.tenants.find(t => t.id === lease.tenant_id);
    const other = S.pms.leases.find(l => l.id !== lease.id && !l.archived && l.tenant_id !== lease.tenant_id && l.rent_type !== "lease");

    // Mark the tenant as a company tenant that withholds 5%
    await tab("tenants");
    q('[data-pms-edit="tenant:' + tenant.id + '"]').click(); await wait(400);
    check("tenant form: withholding is off by default, rate hidden", !!q("#pms-ten-wht") && !q("#pms-ten-wht").checked && !shown("#pms-ten-whtrate-wrap"));
    q("#pms-ten-wht").click(); await wait(100);
    // The demo tenant shares its email with a demo login, which the form refuses.
    if (!q("#pms-ten-email").disabled) setVal("#pms-ten-email", "company-tenant@example.ph");
    check("ticking it shows the rate, 5% suggested", shown("#pms-ten-whtrate-wrap") && num(q("#pms-ten-whtrate").value) === 5);
    q('[data-pms-save="tenant"]').click(); await wait(900);
    const saved = S.pms.tenants.find(t => t.id === tenant.id);
    check("the tenant is saved as withholding 5%", saved.withholds === true && Number(saved.wht_rate) === 5, JSON.stringify({ w: saved.withholds, r: saved.wht_rate, toast: (q(".toasts") || {}).textContent }));

    // Mark a month paid: cash = rent less 5%
    await tab("payments");
    setVal("#pms-filter-status", "owed"); await wait(400);
    const mp = qa("[data-pms-markpaid]").find(b => { const p = b.getAttribute("data-pms-markpaid").split("|"); return p[0] === lease.id && !p[3]; });
    check("the lease has an owed rent month", !!mp);
    const parts = mp.getAttribute("data-pms-markpaid").split("|"), owedAmt = Number(parts[2]), month = parts[1];
    mp.click(); await wait(400);
    const wht = L.withholding(owedAmt, 5);
    check("payment form: tax withheld shown and filled in (5%)", shown("#pms-pay-wht-wrap") && num(q("#pms-pay-wht").value) === wht, q("#pms-pay-wht").value + " vs " + wht);
    check("payment form: amount received is the rent less the tax", num(q("#pms-pay-amount").value) === owedAmt - wht, q("#pms-pay-amount").value);
    check("payment form: a BIR Form 2307 tick box", shown("#pms-pay-2307-wrap") && !q("#pms-pay-2307").checked);
    const before = S.pms.payments.length;
    q('[data-pms-save="payment"]').click(); await wait(600);
    const pay = S.pms.payments.find(p => p.lease_id === lease.id && p.month === month && Number(p.withheld) === wht);
    check("saved with cash and tax withheld", !!pay && S.pms.payments.length === before + 1 && Number(pay.amount) === owedAmt - wht && pay.form2307 === false, JSON.stringify(pay));
    const led = L.ledger(lease, S.pms.payments.filter(p => !p.archived), L.today());
    check("the month counts as fully paid", (led.months.find(m => m.key === month) || {}).status === "paid");

    // The list and the 2307 filter
    setVal("#pms-filter-status", ""); await wait(400);
    const row = qa("#pms-list tr").find(tr => tr.querySelector('[data-pms-edit="payment:' + (pay && pay.id) + '"]'));
    check("list: shows the tax withheld and 2307 to collect", !!row && /tax withheld/.test(row.textContent) && /2307 to collect/.test(row.textContent), row ? row.textContent.slice(0, 200) : "no row");
    setVal("#pms-filter-status", "form2307"); await wait(400);
    check("filter 'BIR Form 2307 to collect' lists it", qa("#pms-list tr").some(tr => tr.querySelector('[data-pms-edit="payment:' + pay.id + '"]')));
    q('[data-pms-edit="payment:' + pay.id + '"]').click(); await wait(400);
    check("editing keeps the amounts", num(q("#pms-pay-amount").value) === owedAmt - wht && num(q("#pms-pay-wht").value) === wht);
    q("#pms-pay-2307").click();
    q('[data-pms-save="payment"]').click(); await wait(500);
    check("2307 marked received", pay.form2307 === true && Number(pay.withheld) === wht);
    setVal("#pms-filter-status", "form2307"); await wait(400);
    check("then it leaves the 2307 list", !qa("#pms-list tr").some(tr => tr.querySelector('[data-pms-edit="payment:' + pay.id + '"]')));
    setVal("#pms-filter-status", ""); await wait(300);

    // Receipt
    const pr = q('[data-pms-print="receipt:' + pay.id + '"]');
    if (pr) { pr.click(); await wait(400); }
    const ar = q("#pms-print-root.pms-ar");
    check("receipt: cash received, tax withheld and total credited", !!ar && /Tax withheld by the tenant \(BIR Form 2307\)/.test(ar.textContent) && /Total credited to the rent/.test(ar.textContent), ar ? ar.textContent.slice(0, 300) : "no receipt");
    const cl = q("[data-pms-cancel]"); if (cl) cl.click(); await wait(200);

    // Owner statement (payment month = the payment's date month)
    const prop = S.pms.properties.find(p => p.id === lease.property_id);
    await tab("owners");
    q('[data-pms-ownerstmt="' + prop.owner_id + '"]').click(); await wait(400);
    const key = String(pay.date).slice(0, 7);
    if (q("#pms-st-month").value !== key && qa("#pms-st-month option").some(o => o.value === key)) { setVal("#pms-st-month", key); await wait(400); }
    const st = q("#pms-print-root.pms-st");
    check("owner statement: rent counts in full, the tax is explained", !!st && /tax withheld by company tenants/.test(st.textContent) && /cash \+/.test(st.textContent), st ? st.textContent.slice(-400) : "none");
    const c2 = q("[data-pms-cancel]"); if (c2) c2.click(); await wait(200);

    // Charges and other tenants: no withholding
    await tab("payments");
    q("[data-pms-new]").click(); await wait(400);
    setVal("#pms-pay-lease", lease.id); await wait(200);
    check("new payment for this tenant: withholding shown", shown("#pms-pay-wht-wrap"));
    if (other) { setVal("#pms-pay-lease", other.id); await wait(200); check("another tenant: no withholding", !shown("#pms-pay-wht-wrap") && !shown("#pms-pay-2307-wrap")); }
    check("payment form: no sideways scroll", noSideways(), document.documentElement.scrollWidth);
    const c3 = q("[data-pms-cancel]"); if (c3) c3.click();
  } catch (e) {
    check("runner", false, e && e.stack ? e.stack : String(e));
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
