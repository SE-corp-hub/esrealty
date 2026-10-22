"use strict";
/* Phase 13 (22 Oct): bank statement matching (I2), meter readings (I7), work orders (I5). Demo, super-admin. */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }
(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = s => document.querySelector(s), qa = s => Array.from(document.querySelectorAll(s));
    const setVal = (sel, v) => { const el = q(sel); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    const tab = async name => { const t = q('[data-pmtab="' + name + '"]'); if (t && t.offsetParent !== null) t.click(); else { const s = q("#pms-section"); s.value = name; s.dispatchEvent(new Event("change", { bubbles: true })); } await wait(500); };
    window.confirm = () => true;
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    q("#auth-role").value = "super-admin";
    q("#auth-test").click(); await wait(700);
    q('#nav [data-view="pms"]').click(); await wait(900);
    const H = window.__ESREALTY_TEST_HELPERS, S = H.getState(), L = window.ESPMSLEDGER;
    const lease = S.pms.leases.find(l => l.id === "l-seed-1");
    const back = new Date(); back.setMonth(back.getMonth() - 6); lease.start = L.today(back);
    const tenant = S.pms.tenants.find(t => t.id === lease.tenant_id);
    const items = H.pmsOpenItems().filter(i => i.leaseId === lease.id && !i.chargeId);
    chk("the lease owes rent months", items.length >= 1, JSON.stringify(items.map(i => i.month)));

    // I2: statement matching.
    await tab("payments");
    const rb = q("[data-pms-recon]");
    chk("Payments has Match bank statement", !!rb);
    rb.click(); await wait(400);
    const today = L.today();
    setVal("#pms-recon-text", "Date,Description,Debit,Credit\n" + today + ",INSTAPAY FROM " + String(tenant.name).toUpperCase() + " REF AB12345,,\"" + items[0].amount.toLocaleString("en-US") + "\"\n" + today + ",ATM WITHDRAWAL,5000,\n" + today + ",GCASH FROM SOMEONE ELSE,,123.45\n");
    q("[data-pms-recon-run]").click(); await wait(500);
    const rows = qa(".pms-recon tr").slice(1);
    chk("money-in lines are listed, money out is skipped", rows.length === 2, String(rows.length));
    chk("the tenant's transfer is a sure match", /Sure/.test(rows[0].textContent) && rows[0].textContent.indexOf(tenant.name) !== -1, rows[0] ? rows[0].textContent.slice(0, 200) : "");
    chk("an unknown amount is not matched", /No match/.test(rows[1].textContent));
    const before = S.pms.payments.length;
    q('[data-pms-recon-record="0"]').click(); await wait(500);
    chk("Record opens the payment form filled in", (q("#pms-pay-ref") || {}).value === "AB12345" && (q("#pms-pay-method") || {}).value === "Bank Transfer" && (q("#pms-pay-date") || {}).value === today, [(q("#pms-pay-ref") || {}).value, (q("#pms-pay-method") || {}).value].join(" "));
    q('[data-pms-save="payment"]').click(); await wait(700);
    const pay = S.pms.payments.find(p => p.reference === "AB12345");
    chk("saving records the payment as usual", S.pms.payments.length === before + 1 && !!pay && pay.status === "paid" && pay.lease_id === lease.id, pay ? JSON.stringify({ a: pay.amount, m: pay.month }) : "none");

    // I7: meter readings.
    await tab("leases");
    q('[data-pms-charges="' + lease.id + '"]').click(); await wait(400);
    setVal("#pms-chg-type", "Water");
    setVal("#pms-chg-from", "100"); setVal("#pms-chg-to", "130"); setVal("#pms-chg-rate", "50"); await wait(100);
    chk("the amount is worked out from the readings", (q("#pms-chg-amount") || {}).value === "1500", (q("#pms-chg-amount") || {}).value);
    setVal("#pms-chg-due", today);
    q('[data-pms-save="charge"]').click(); await wait(500);
    const ch = (lease.charges || []).find(c => c.type === "Water" && c.meterTo === 130);
    chk("the charge keeps its readings and a note", !!ch && ch.amount === 1500 && ch.meterFrom === 100 && /meter 100 → 130, 30 units/.test(ch.note || ""), ch ? JSON.stringify(ch) : "none");
    chk("next time the previous reading is filled in", (q("#pms-chg-from") || {}).value === "130" && (q("#pms-chg-rate") || {}).value === "50", (q("#pms-chg-from") || {}).value);
    const cx = q("[data-pms-cancel]"); if (cx) cx.click(); await wait(200);

    // I5: work orders.
    await tab("maintenance");
    const m0 = S.pms.maintenance.find(m => m.id === "m-seed-1");
    q('[data-pms-edit="maintenance:m-seed-1"]').click(); await wait(400);
    chk("work orders have quote, a vendor list and repeat", !!q("#pms-maint-quote") && !!q("#pms-vendor-list") && !!q("#pms-maint-repeat"));
    setVal("#pms-maint-quote", "4000"); setVal("#pms-maint-repeat", "6"); setVal("#pms-maint-status", "completed");
    const countBefore = S.pms.maintenance.length;
    q('[data-pms-save="maintenance"]').click(); await wait(600);
    const nextJob = S.pms.maintenance.find(m => m.repeatOf === "m-seed-1");
    chk("finishing a repeating job adds the next one", S.pms.maintenance.length === countBefore + 1 && !!nextJob && nextJob.status === "open" && nextJob.date > today, nextJob ? nextJob.date : "none");
    chk("the finish date is recorded", m0.completedAt === today && m0.quote === 4000);
    await tab("reports");
    chk("Reports show repairs by contractor", !!q("[data-pms-repairs]") && /CoolAir PH/.test(q("[data-pms-repairs]").textContent));
    chk("no sideways scroll", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth + " > " + window.innerWidth);
  } catch (e) { window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.stack || e.message || e) + "" }); }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
