"use strict";
/* Property Management, 18 Oct 2026 (demo data):
   - owner monthly statement: rent received, spending, net, unpaid at month end
     and deposits held, for staff (Owners > Statement) and in the owner portal;
   - security deposits: the Rent Control Act note, and settling a deposit at
     move-out (returned + kept must add up to the deposit). */
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
    const lease = S.pms.leases.find(l => l.id === "l-seed-1");
    const prop = S.pms.properties.find(p => p.id === lease.property_id);
    const owner = S.pms.owners.find(o => o.id === prop.owner_id);

    // Owner statement (staff)
    await tab("owners");
    const sb = q('[data-pms-ownerstmt="' + owner.id + '"]');
    check("owners have a Statement button", !!sb);
    sb.click(); await wait(400);
    const root = q("#pms-print-root.pms-st");
    check("the statement opens for this month", !!root && /Owner Statement/.test(root.textContent) && root.textContent.indexOf(L.monthLabel(L.today().slice(0, 7))) !== -1, root ? root.textContent.slice(0, 120) : "none");
    check("a month list covers the last 12 months", qa("#pms-st-month option").length === 12);
    const want = L.monthStatement({ leases: S.pms.leases, payments: S.pms.payments, expenses: S.pms.expenses, maintenance: S.pms.maintenance }, S.pms.properties.filter(p => !p.archived && p.owner_id === owner.id).map(p => p.id), L.today().slice(0, 7));
    const totalRow = root ? Array.from(root.querySelectorAll(".print-sched tr")).pop() : null;
    const cells = totalRow ? Array.from(totalRow.cells).map(c => num(c.textContent)) : [];
    check("totals match the ledger: received, spending, net, unpaid, deposits", cells.length === 6 && cells[1] === want.total.collected && cells[2] === want.total.expenses + want.total.repairs && cells[3] === want.total.net && cells[4] === want.total.unpaid && cells[5] === want.total.deposits, JSON.stringify({ cells, want: want.total }));
    check("it says deposits are not income", /Deposits are held for the tenants and are not income/.test(root.textContent));
    const prevKey = q("#pms-st-month option:nth-child(2)").value;
    setVal("#pms-st-month", prevKey); await wait(400);
    check("choosing another month redraws the statement", (q("#pms-print-root.pms-st") || {}).textContent.indexOf(L.monthLabel(prevKey)) !== -1);
    check("statement: no sideways scroll", noSideways(), document.documentElement.scrollWidth);
    const close = q("[data-pms-cancel]"); if (close) close.click(); await wait(200);

    // Deposits
    await tab("leases");
    q('[data-pms-edit="lease:' + lease.id + '"]').click(); await wait(400);
    const depHint = q("#pms-lease-dep") ? q("#pms-lease-dep").closest(".field").textContent : "";
    check("the deposit field mentions the Rent Control Act limit", /RA 9653/.test(depHint) && /two months/.test(depHint));
    setVal("#pms-lease-dep", String(Number(lease.rent) * 3));
    q('[data-pms-save="lease"]').click(); await wait(500);
    check("a deposit over two months' rent saves, with a note", Number(lease.deposit) === Number(lease.rent) * 3 && /RA 9653/.test((q(".toasts") || document.body).textContent), (q(".toasts") || {}).textContent);
    await tab("leases");
    const row = qa("#pms-list tr").find(tr => tr.querySelector('[data-pms-edit="lease:' + lease.id + '"]'));
    check("the lease shows the deposit as held", !!row && /held/.test(row.textContent));
    q('[data-pms-edit="lease:' + lease.id + '"]').click(); await wait(400);
    check("editing a lease with a deposit offers the move-out settlement", !!q(".pms-dep-settle") && !!q("#pms-lease-depdate"));
    q(".pms-dep-settle").open = true;
    setVal("#pms-lease-depdate", L.today()); setVal("#pms-lease-depback", String(lease.deposit)); setVal("#pms-lease-depkept", "1000");
    q('[data-pms-save="lease"]').click(); await wait(400);
    check("returned plus kept can't be more than the deposit", !lease.deposit_settled_on && !!q("#pms-modal"));
    setVal("#pms-lease-depback", String(lease.deposit - 1000));
    q('[data-pms-save="lease"]').click(); await wait(500);
    check("the deposit is settled: returned and kept recorded", lease.deposit_settled_on === L.today() && Number(lease.deposit_refund) === lease.deposit - 1000 && Number(lease.deposit_kept) === 1000);
    await tab("leases");
    const row2 = qa("#pms-list tr").find(tr => tr.querySelector('[data-pms-edit="lease:' + lease.id + '"]'));
    check("the lease shows the settlement", !!row2 && /settled/.test(row2.textContent) && /kept/.test(row2.textContent), row2 ? row2.textContent.slice(0, 200) : "");
    check("a settled deposit is no longer held", L.depositHeld(lease, L.today()) === 0);
    await tab("payments");
    q("[data-pms-new]") && q("[data-pms-new]").click(); await wait(400);
    check("payments can be recorded as From deposit", qa("#pms-pay-method option").some(o => o.value === "From deposit"));
    const cl = q("[data-pms-cancel]"); if (cl) cl.click(); await wait(200);

    // Owner portal
    await setRole("owner");
    const mb = q('[data-pms-ownerstmt="mine"]');
    check("owner portal: a Monthly statement button", !!mb);
    if (mb) { mb.click(); await wait(400); }
    const oroot = q("#pms-print-root.pms-st");
    check("owner portal: the statement covers their properties", !!oroot && oroot.textContent.indexOf(prop.title) !== -1);
    check("owner portal: no sideways scroll", noSideways(), document.documentElement.scrollWidth);
  } catch (e) {
    check("runner", false, e && e.stack ? e.stack : String(e));
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
