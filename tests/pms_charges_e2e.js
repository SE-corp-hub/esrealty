"use strict";
/* Property Management: utilities and other charges (2026-10-18, demo data).
   A charge (water, electricity, dues...) on a lease has an amount and a due
   date, shows as owed with its own Mark paid and reminders, is paid by a
   payment "For" that charge (with a receipt), never pays rent, and shows in the
   tenant portal and the owner statement. */
window.__msChecks = [];
window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail: String(detail) });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 60) { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(100); } return !!fn(); }
const q = s => document.querySelector(s);
const qa = s => Array.from(document.querySelectorAll(s));
const noSideways = () => document.documentElement.scrollWidth <= window.innerWidth + 2;
const tab = async name => { const t = q('[data-pmtab="' + name + '"]'); if (t && t.offsetParent !== null) t.click(); else { const s = q("#pms-section"); s.value = name; s.dispatchEvent(new Event("change", { bubbles: true })); } await wait(450); };
const setRole = async role => { const rs = q("#user-role-select"); if (rs) { rs.value = role; rs.dispatchEvent(new Event("change", { bubbles: true })); await wait(600); } const n = q('#nav [data-view="pms"]'); if (n) n.click(); await wait(600); };
const setVal = (sel, v) => { const el = q(sel); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
const num = s => Number(String(s || "").replace(/[^0-9.-]/g, ""));

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
    q('#nav [data-view="pms"]').click();
    await wait(800);
    const S = window.__ESREALTY_TEST_HELPERS.getState();
    const L = window.ESPMSLEDGER;
    const today = L.today();
    const lease = S.pms.leases.find(l => l.id === "l-seed-1");
    S.pms.tenants.find(t => t.id === lease.tenant_id).phone = "0917 123 4567";
    const rentBefore = L.ledger(lease, S.pms.payments.filter(p => !p.archived), today).overdue;
    const yesterday = (() => { const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() - 1); return L.today(d); })();

    // Add a charge
    await tab("leases");
    q('[data-pms-charges="' + lease.id + '"]').click(); await wait(400);
    check("a lease has a Charges dialog", /Charges/.test((q("#pms-modal h3") || {}).textContent || "") && !!q("#pms-chg-amount"));
    q('[data-pms-save="charge"]').click(); await wait(300);
    check("a charge needs an amount", !(lease.charges || []).length);
    setVal("#pms-chg-type", "Water"); setVal("#pms-chg-amount", "800"); setVal("#pms-chg-due", yesterday); setVal("#pms-chg-period", today.slice(0, 7)); setVal("#pms-chg-note", "meter 1234 to 1262");
    q('[data-pms-save="charge"]').click(); await wait(500);
    const ch = (lease.charges || [])[0];
    check("the charge is saved on the lease", !!ch && ch.type === "Water" && Number(ch.amount) === 800 && ch.due === yesterday);
    check("the dialog lists it as overdue", /Water/.test((q("#pms-modal") || {}).textContent || "") && /Overdue/.test((q("#pms-modal") || {}).textContent || ""));
    const c1 = q("[data-pms-cancel]"); if (c1) c1.click(); await wait(200);
    await tab("leases");
    const lrow = qa("#pms-list tr").find(tr => tr.querySelector('[data-pms-charges="' + lease.id + '"]'));
    check("the lease shows the charge owed", !!lrow && /Charges ₱800/.test(lrow.textContent), lrow ? lrow.textContent.slice(0, 200) : "");

    // Owed rows and reminders
    await tab("payments");
    setVal("#pms-filter-status", "owed"); await wait(400);
    const crow = qa("#pms-list tr").find(tr => /Water/.test(tr.textContent) && tr.querySelector("[data-pms-markpaid]"));
    check("the charge shows as owed with Mark paid", !!crow && /Overdue/.test(crow.textContent));
    const vb = crow && crow.querySelector('[data-pms-remind="viber"]');
    check("the reminder names the bill", !!vb && /Water/.test(decodeURIComponent(vb.getAttribute("href"))));
    crow.querySelector("[data-pms-markpaid]").click(); await wait(400);
    check("Mark paid opens the payment form set to the charge", q("#pms-pay-for") && q("#pms-pay-for").value === ch.id && num(q("#pms-pay-amount").value) === 800);
    q('[data-pms-save="payment"]').click(); await wait(500);
    const cp = S.pms.payments.find(p => p.charge_id === ch.id);
    check("the payment is recorded for the charge, with a receipt number", !!cp && cp.status === "paid" && /^AR-/.test(cp.receipt_no || ""));
    check("a charge payment doesn't pay rent", L.ledger(lease, S.pms.payments.filter(p => !p.archived), today).overdue === rentBefore, rentBefore);
    check("the charge is now paid", L.chargeStatus(lease, S.pms.payments, today)[0].status === "paid");
    setVal("#pms-filter-status", "paid"); await wait(400);
    const prow = qa("#pms-list tr").find(tr => tr.textContent.indexOf(cp.receipt_no) !== -1);
    check("the payment says what it was for", !!prow && /Water · /.test(prow.textContent));
    q('[data-pms-print="receipt:' + cp.id + '"]').click(); await wait(300);
    check("the receipt says it was for the water bill", /For:\s*Water · /.test((q("#pms-print-root") || {}).textContent || ""));
    const c2 = q("[data-pms-cancel]"); if (c2) c2.click(); await wait(200);

    // Paid charges can't be removed; unpaid ones can
    await tab("leases");
    q('[data-pms-charges="' + lease.id + '"]').click(); await wait(400);
    check("a paid charge has no Remove button", !q('[data-pms-chargedel="' + lease.id + '|' + ch.id + '"]'));
    setVal("#pms-chg-type", "Other"); setVal("#pms-chg-label", "Parking"); setVal("#pms-chg-amount", "500"); setVal("#pms-chg-due", today);
    q('[data-pms-save="charge"]').click(); await wait(500);
    const park = lease.charges.find(c => c.label === "Parking");
    q('[data-pms-chargedel="' + lease.id + '|' + park.id + '"]').click(); await wait(400);
    check("an unpaid charge can be removed", park.archived === true && !L.chargeStatus(lease, S.pms.payments, today).some(c => c.id === park.id));
    setVal("#pms-chg-type", "Electricity"); setVal("#pms-chg-amount", "2500"); setVal("#pms-chg-due", today); setVal("#pms-chg-period", today.slice(0, 7));
    q('[data-pms-save="charge"]').click(); await wait(500);
    check("the dialog has no sideways scroll", noSideways(), document.documentElement.scrollWidth);
    const c3 = q("[data-pms-cancel]"); if (c3) c3.click(); await wait(200);

    // Owner statement counts the charge apart from rent
    const owner = S.pms.owners.find(o => o.id === (S.pms.properties.find(p => p.id === lease.property_id) || {}).owner_id);
    await tab("owners");
    q('[data-pms-ownerstmt="' + owner.id + '"]').click(); await wait(400);
    const tot = Array.from(q("#pms-print-root .print-sched").querySelectorAll("tr")).pop();
    const charges = tot ? num(tot.cells[2].textContent) : -1;
    check("owner statement: charges collected this month", (cp.date || "").slice(0, 7) !== today.slice(0, 7) || charges === 800, charges);
    const c4 = q("[data-pms-cancel]"); if (c4) c4.click(); await wait(200);

    // Tenant portal
    await setRole("tenant");
    const owedBox = q(".pms-owed");
    check("tenant: the unpaid electricity bill is in what they owe", !!owedBox && /Electricity/.test(owedBox.textContent) && /2,500/.test(owedBox.textContent));
    check("tenant: their history shows the water bill payment", /Water · /.test(q("#content").textContent));
  } catch (e) {
    check("runner", false, e && e.stack ? e.stack : String(e));
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
