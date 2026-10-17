"use strict";
/* Property Management rent screens (2026-10-17), on the demo sample data:
   lease rows show what the rent ledger says is overdue, due rows offer
   "Mark paid" with the month and amount filled in, the statement preview is
   visible and splits owed-to-date from the rest of the term, receipt photos
   open inside the app, units have a capacity, leases are terminated with a
   date, and CSV exports carry a UTF-8 marker. */
window.__msChecks = [];
window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail: String(detail) });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 60) { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(100); } return !!fn(); }
const q = s => document.querySelector(s);
const tab = async name => { const t = q('[data-pmtab="' + name + '"]'); if (t) t.click(); await wait(500); };

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
    const lease = S.pms.leases.find(l => l.id === "l-seed-1");
    check("sample lease present", !!lease);
    const today = L.today();
    const led = () => L.ledger(lease, S.pms.payments, today);

    await tab("leases");
    const row = Array.from(document.querySelectorAll("#content tr")).find(tr => /Katrina Reyes/.test(tr.textContent));
    const owed = led().overdue;
    check("lease row shows the ledger's overdue amount", !!row && (owed > 0 ? row.textContent.indexOf("Overdue") >= 0 && row.textContent.replace(/[^0-9]/g, "").indexOf(String(owed)) >= 0 : /Paid to date/.test(row.textContent)), (row ? row.textContent.replace(/\s+/g, " ").slice(0, 160) : "no row") + " owed=" + owed);

    await tab("payments");
    const thisMonth = today.slice(0, 7);
    const unpaid = led().months.filter(m => m.balance > 0 && (m.due <= today || m.key === thisMonth));
    const markBtns = Array.from(document.querySelectorAll("[data-pms-markpaid]")).filter(b => b.getAttribute("data-pms-markpaid").indexOf("l-seed-1|") === 0);
    check("one Mark paid per unpaid month", markBtns.length === unpaid.length, markBtns.length + " vs " + unpaid.length);
    if (markBtns.length) {
      const first = unpaid[0];
      markBtns[markBtns.length - 1].click(); // list is newest first; the oldest owed month is last
      await until(() => q("#pms-pay-month"));
      check("Mark paid fills in the month", q("#pms-pay-month").value === first.key, q("#pms-pay-month").value + " vs " + first.key);
      check("Mark paid fills in what is owed", Number(String(q("#pms-pay-amount").value).replace(/,/g, "")) === first.balance, q("#pms-pay-amount").value);
      check("payment date defaults to today (local)", q("#pms-pay-date").value === today, q("#pms-pay-date").value);
      const before = S.pms.payments.length;
      q('[data-pms-save="payment"]').click();
      await wait(600);
      const added = S.pms.payments[0];
      check("the payment is saved for that month", S.pms.payments.length === before + 1 && added.month === first.key && added.status === "paid", JSON.stringify(added || {}).slice(0, 120));
      const left = Array.from(document.querySelectorAll("[data-pms-markpaid]")).filter(b => b.getAttribute("data-pms-markpaid").indexOf("l-seed-1|" + first.key + "|") === 0);
      check("that month's due row is gone", left.length === 0);
    }

    // Receipt photo opens inside the app
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    S.pms.payments[0].proof = png;
    await tab("leases"); await tab("payments");
    const pb = q("[data-pms-proof]");
    check("receipt photo is a button", !!pb);
    if (pb) { pb.click(); await wait(200); check("receipt opens in an in-app viewer", !!q("#pms-proof-view img")); const c = q("[data-proof-close]"); if (c) c.click(); await wait(150); }

    // Statement preview
    await tab("leases");
    const pr = q('[data-pms-print="lease:l-seed-1"]');
    if (pr) {
      pr.click();
      await until(() => q(".modal-body > .print-root"));
      const root = q(".modal-body > .print-root");
      check("statement preview is visible on screen", !!root && root.offsetHeight > 50, root ? root.offsetHeight : "none");
      check("statement splits owed to date from the rest of the term", !!root && /Owed to date/.test(root.textContent) && /Rest of term/.test(root.textContent));
      const close = Array.from(document.querySelectorAll("[data-pms-cancel]")).pop(); if (close) close.click(); await wait(200);
    } else check("print button present", false);

    // Unit capacity and lease termination date
    await tab("units");
    const ue = q('[data-pms-edit="unit:u-seed-1"]');
    if (ue) { ue.click(); await until(() => q("#pms-unit-capacity")); check("units have a capacity field", !!q("#pms-unit-capacity")); const c = q("[data-pms-cancel]"); if (c) c.click(); await wait(250); }
    await tab("leases");
    const le = q('[data-pms-edit="lease:l-seed-1"]');
    if (le) {
      le.click(); await until(() => q("#pms-lease-status"));
      const st = q("#pms-lease-status");
      check("lease status is running or terminated only", st.options.length === 2);
      st.value = "terminated"; st.dispatchEvent(new Event("change", { bubbles: true })); await wait(100);
      check("terminating asks for the date", q("#pms-lease-term-wrap").style.display !== "none" && !!q("#pms-lease-termdate").value);
      const c = q("[data-pms-cancel]"); if (c) c.click(); await wait(250);
    }

    // CSV exports
    await tab("reports");
    let captured = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = b => { captured = b; return "blob:test"; };
    const ex = q('[data-pms-export="rentroll"]');
    if (ex) ex.click();
    await wait(200);
    URL.createObjectURL = orig;
    const bytes = captured ? new Uint8Array(await captured.arrayBuffer()) : new Uint8Array();
    const text = captured ? await captured.text() : "";
    // Blob.text() drops the marker while decoding, so check the raw bytes.
    check("rent roll export exists and starts with a UTF-8 marker", bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF && /Property","Unit","Tenant/.test(text), Array.from(bytes.slice(0, 4)).join(","));
    check("rent roll lists the sample lease", /Katrina Reyes/.test(text));
  } catch (e) {
    check("runner", false, e && e.stack ? e.stack.slice(0, 300) : e);
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
