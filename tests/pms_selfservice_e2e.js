"use strict";
/* Property Management, 17 Oct 2026 (demo data, so the browser keeps the records):
   - B14: owed rows say "Overdue" or "Due" from the dates; a paid month says how
     many days after the due date it came in; the form offers Paid or Not cleared yet;
   - acknowledgement receipts: a paid payment gets the next AR number and prints
     with the amount in words;
   - reminders by text message and by Viber;
   - tenants send proof of a payment and ask for repairs; the manager confirms
     (receipt number) or doesn't accept (with a reason), and sees the requests. */
window.__msChecks = [];
window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail: String(detail) });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 60) { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(100); } return !!fn(); }
const q = s => document.querySelector(s);
const qa = s => Array.from(document.querySelectorAll(s));
const phone = window.innerWidth <= 760;
const noSideways = () => document.documentElement.scrollWidth <= window.innerWidth + 2;
const tab = async name => { const t = q('[data-pmtab="' + name + '"]'); if (t) t.click(); else { const s = q("#pms-section"); s.value = name; s.dispatchEvent(new Event("change", { bubbles: true })); } await wait(450); };
const setRole = async role => { const rs = q("#user-role-select"); if (rs) { rs.value = role; rs.dispatchEvent(new Event("change", { bubbles: true })); await wait(600); } const n = q('#nav [data-view="pms"]'); if (n) n.click(); await wait(600); };
const setVal = (sel, v) => { const el = q(sel); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };

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
    const tenant = S.pms.tenants.find(t => t.id === lease.tenant_id);
    tenant.phone = "0917 123 4567";

    // B14: owed rows
    await tab("payments");
    setVal("#pms-filter-status", "owed"); await wait(400);
    const owedRows = qa("#pms-list tr").filter(tr => tr.querySelector("[data-pms-markpaid]"));
    const badgeOf = tr => tr.cells[5].textContent;
    const wrong = owedRows.filter(tr => { const due = tr.cells[0].textContent.trim(); return due < today ? !/Overdue/.test(badgeOf(tr)) : !/^Due/.test(badgeOf(tr).trim()); });
    check("B14: owed rows say Overdue once the due date has passed, Due before", owedRows.length > 0 && wrong.length === 0, owedRows.length + " rows, wrong: " + wrong.map(badgeOf).join(" | "));
    const od = owedRows.find(tr => /Overdue/.test(badgeOf(tr)));
    check("B14: an overdue row says how many days", !od || /\d+ days? overdue/.test(od.cells[3].textContent), od ? od.cells[3].textContent : "no overdue row");
    check("B14: no 'Late' status is offered as a filter", !qa("#pms-filter-status option").some(o => /^Late/.test(o.textContent)));

    // Reminders
    const viber = owedRows.length ? owedRows[0].querySelector('[data-pms-remind="viber"]') : null;
    check("reminder: a Viber button with the tenant's number in international form", !!viber && /^viber:\/\/chat\?number=%2B639171234567&draft=/.test(viber.getAttribute("href")), viber ? viber.getAttribute("href").slice(0, 60) : "none");
    check("reminder: the Viber message names the rent and the month", !!viber && /rent%20of/.test(viber.getAttribute("href")));
    check("reminder: a text-message button too", owedRows.length > 0 && !!owedRows[0].querySelector('[data-pms-remind="sms"]'));

    // Mark paid: the form, then a numbered receipt
    owedRows[0].querySelector("[data-pms-markpaid]").click(); await wait(400);
    const statusOpts = qa("#pms-pay-status option").map(o => o.textContent);
    check("B14: the form offers Paid or Not cleared yet, nothing else", statusOpts.join("|") === "Paid|Not cleared yet", statusOpts.join("|"));
    setVal("#pms-pay-ref", "GC-778");
    const before = S.pms.payments.length;
    q('[data-pms-save="payment"]').click(); await wait(500);
    const paid = S.pms.payments[0];
    check("receipt: a paid payment gets an AR number", S.pms.payments.length === before + 1 && /^AR-\d{4}-\d{4}$/.test(paid.receipt_no || ""), paid.receipt_no);
    check("receipt: the reference is kept", paid.reference === "GC-778");
    setVal("#pms-filter-status", "paid"); await wait(400);
    const rbtn = q('[data-pms-print="receipt:' + paid.id + '"]');
    check("receipt: the paid row has a Receipt button and shows the number", !!rbtn && rbtn.closest("tr").textContent.indexOf(paid.receipt_no) !== -1);
    if (rbtn) { rbtn.click(); await wait(300); }
    const ar = q("#pms-print-root.pms-ar");
    check("receipt: prints as an acknowledgement receipt with the amount in words", !!ar && /Acknowledgement Receipt/.test(ar.textContent) && ar.textContent.indexOf(paid.receipt_no) !== -1 && ar.textContent.indexOf(L.amountInWords(paid.amount)) !== -1, ar ? ar.textContent.slice(0, 160) : "none");
    check("receipt: says it is not a BIR official receipt", !!ar && /not a BIR official receipt/.test(ar.textContent));
    check("receipt: no sideways scroll", noSideways(), document.documentElement.scrollWidth);
    const close = q("[data-pms-cancel]"); if (close) close.click(); await wait(200);
    // The next one gets the next number
    const n1 = +paid.receipt_no.slice(-4);
    await tab("payments"); setVal("#pms-filter-status", "owed"); await wait(400);
    const next = qa("#pms-list [data-pms-markpaid]")[0];
    if (next) { next.click(); await wait(400); q('[data-pms-save="payment"]').click(); await wait(500); }
    check("receipt: the next payment gets the next number", !next || +String(S.pms.payments[0].receipt_no).slice(-4) === n1 + 1, S.pms.payments[0].receipt_no);

    // B14: a month paid late says so
    const m0 = L.ledger(lease, [], today).months[0];
    const lateDate = (() => { const d = new Date(m0.due + "T00:00:00"); d.setDate(d.getDate() + 12); return L.today(d); })();
    S.pms.payments.unshift({ id: "p-late-test", lease_id: lease.id, property_id: lease.property_id, unit_id: lease.unit_id, tenant_id: lease.tenant_id, amount: 1, date: lateDate, month: m0.key, method: "Cash", status: "paid", receipt_no: "AR-2000-0001", createdAt: Date.now(), archived: false });
    setVal("#pms-filter-status", "paid"); await wait(400);
    const lateRow = qa("#pms-list tr").find(tr => tr.textContent.indexOf("AR-2000-0001") !== -1);
    check("B14: a month paid 12 days after its due date says so", !!lateRow && /12 days after due/.test(lateRow.textContent), lateRow ? lateRow.cells[5].textContent : "none");
    S.pms.payments.shift();

    // Tenant: send proof, ask for a repair
    await setRole("tenant");
    const send = q('[data-pms-sendpay="' + lease.id + '"]'), ask = q('[data-pms-askfix="' + lease.id + '"]');
    check("tenant: buttons to send proof and ask for a repair", !!send && !!ask);
    send.click(); await wait(300);
    check("tenant: the proof form opens", !!q("#pms-tenant-pay") && !!q("#pms-tp-amount") && !!q("#pms-tp-photo"));
    check("tenant: the form has no sideways scroll", noSideways(), document.documentElement.scrollWidth);
    setVal("#pms-tp-amount", "5000"); setVal("#pms-tp-ref", "GC-9001");
    q("#pms-tenant-pay [data-td-ok]").click(); await wait(500);
    const sent = S.pms.payments.find(p => p.reference === "GC-9001");
    check("tenant: the payment is saved as sent, not paid", !!sent && sent.status === "submitted" && sent.amount === 5000 && !sent.receipt_no, sent ? sent.status : "missing");
    check("tenant: the rent card says it was sent and waits for a check", /You sent ₱5,000/.test((q(".pms-sent-line") || {}).textContent || ""), (q(".pms-sent-line") || {}).textContent);
    check("tenant: the history shows it as being checked", /Sent — being checked/.test(q("#content").textContent));
    q('[data-pms-askfix="' + lease.id + '"]').click(); await wait(300);
    q("#pms-tenant-fix [data-td-ok]").click(); await wait(300);
    check("tenant: a repair request needs a title", !!q("#pms-tenant-fix"));
    setVal("#pms-tr-title", "Leaking faucet"); setVal("#pms-tr-details", "Kitchen sink drips all night");
    q("#pms-tenant-fix [data-td-ok]").click(); await wait(500);
    const req = S.pms.maintenance.find(m => m.title === "Leaking faucet");
    check("tenant: the request lands in the work orders, marked as theirs", !!req && req.source === "tenant" && req.status === "open" && req.unit_id === lease.unit_id && req.request === "Kitchen sink drips all night");
    const reqSec = qa("details.pms-sec").find(d => /Repair requests/.test(d.textContent));
    check("tenant: their requests are listed with a plain status", !!reqSec && /Leaking faucet/.test(reqSec.textContent) && /Received/.test(reqSec.textContent));
    check("tenant: no sideways scroll", noSideways(), document.documentElement.scrollWidth);

    // Manager: what tenants sent
    await setRole("super-admin");
    const payChip = q('[data-pms-goto="payments:submitted"]'), fixChip = q('[data-pms-goto="maintenance:from-tenant"]');
    check("manager: needs-attention shows payments sent by tenants", !!payChip && /1 payment sent by a tenant/.test(payChip.textContent), payChip ? payChip.textContent : "none");
    check("manager: needs-attention shows repair requests", !!fixChip && /1 repair request/.test(fixChip.textContent), fixChip ? fixChip.textContent : "none");
    payChip.click(); await wait(500);
    const cbtn = q('[data-pms-confirm="' + sent.id + '"]');
    check("manager: the sent payment can be confirmed or not accepted", !!cbtn && !!q('[data-pms-reject="' + sent.id + '"]') && !q('#pms-list [data-pms-edit="payment:' + sent.id + '"]'));
    cbtn.click(); await wait(400);
    check("manager: confirming opens the form set to Paid", /Confirm Payment/.test((q("#pms-modal h3") || {}).textContent || "") && q("#pms-pay-status").value === "paid" && !!q(".pms-sent-note"));
    q('[data-pms-save="payment"]').click(); await wait(500);
    check("manager: a confirmed payment is paid, numbered and dated", sent.status === "paid" && /^AR-/.test(sent.receipt_no || "") && !!sent.confirmed_at && sent.sent_by, sent.status + " " + sent.receipt_no);
    // Not accepted, with a reason
    await setRole("tenant");
    q('[data-pms-sendpay="' + lease.id + '"]').click(); await wait(300);
    setVal("#pms-tp-amount", "777"); setVal("#pms-tp-ref", "WRONG-1");
    q("#pms-tenant-pay [data-td-ok]").click(); await wait(500);
    const bad = S.pms.payments.find(p => p.reference === "WRONG-1");
    await setRole("super-admin");
    q('[data-pms-goto="payments:submitted"]').click(); await wait(500);
    q('[data-pms-reject="' + bad.id + '"]').click(); await wait(300);
    q('[data-pms-save="reject"]').click(); await wait(200);
    check("manager: not accepting needs a reason", bad.status === "submitted" && !!q("#pms-modal"));
    setVal("#pms-reject-reason", "Not in our GCash account");
    q('[data-pms-save="reject"]').click(); await wait(400);
    check("manager: the payment is marked not accepted, with the reason", bad.status === "rejected" && bad.reject_reason === "Not in our GCash account" && !bad.receipt_no);
    // The repair request
    q('[data-pms-goto="maintenance:from-tenant"]').click(); await wait(500);
    const reqRow = qa("#pms-list tr").find(tr => /Leaking faucet/.test(tr.textContent));
    check("manager: the request shows as from the tenant, with their words", !!reqRow && /From tenant/.test(reqRow.textContent) && /Kitchen sink drips all night/.test(reqRow.textContent));
    q('[data-pms-edit="maintenance:' + req.id + '"]').click(); await wait(300);
    check("manager: the work order shows the tenant's request", /Request from/.test((q(".pms-sent-note") || {}).textContent || ""));
    setVal("#pms-maint-status", "in progress");
    q('[data-pms-save="maintenance"]').click(); await wait(400);
    await setRole("tenant");
    const reqSec2 = qa("details.pms-sec").find(d => /Repair requests/.test(d.textContent));
    check("tenant: sees the repair is being fixed", !!reqSec2 && /Being fixed/.test(reqSec2.textContent));
    check("tenant: sees the payment was not accepted, and why", /Not accepted/.test(q("#content").textContent) && /Not in our GCash account/.test(q("#content").textContent));
    const tr = q('[data-pms-print="receipt:' + sent.id + '"]');
    check("tenant: can print the receipt for the confirmed payment", !!tr);
  } catch (e) {
    check("runner", false, e && e.stack ? e.stack : String(e));
  }
  window.__msDone = true;
})();
