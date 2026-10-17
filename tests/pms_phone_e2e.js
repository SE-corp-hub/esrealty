"use strict";
/* Property Management phone screens and the remaining fixes (2026-10-17),
   on the demo sample data:
   - P1: four figures, a "needs attention" row, counts on the sections; phones
     pick the section from a list and fold the filters behind "Filters";
   - P4: every row button says what it does;
   - B25: a unit or lease whose lease has ended can be archived;
   - B26: the owner portal's net matches the reports tab;
   - P8 / B28: the tenant portal says what is owed in words, from the ledger;
   - S6: a receipt photo stored as a private file opens from a "Photo" button;
   - S8: drop-down values are escaped. */
window.__msChecks = [];
window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail: String(detail) });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 60) { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(100); } return !!fn(); }
const q = s => document.querySelector(s);
const qa = s => Array.from(document.querySelectorAll(s));
const phone = window.innerWidth <= 760;
const visible = el => !!el && el.offsetParent !== null && getComputedStyle(el).display !== "none";
const tab = async name => { const t = q('[data-pmtab="' + name + '"]'); if (t) t.click(); await wait(450); };
const setRole = async role => { const rs = q("#user-role-select"); if (rs) { rs.value = role; rs.dispatchEvent(new Event("change", { bubbles: true })); await wait(600); } const n = q('#nav [data-view="pms"]'); if (n) n.click(); await wait(600); };

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

    // P1: the header
    check("four summary figures", qa(".pms-kpis .kpi").length === 4, qa(".pms-kpis .kpi").length);
    const owe = q('[data-pms-goto="payments:owed"]');
    check("needs-attention shows who owes rent", !!owe && /lease owes rent|leases owe rent/.test(owe.textContent), owe ? owe.textContent : "none");
    if (phone) {
      check("phone: section list instead of ten tabs", visible(q("#pms-section")) && !visible(q(".pms-tabs")));
    } else {
      check("desktop: tabs shown, section list hidden", visible(q(".pms-tabs")) && !visible(q("#pms-section")));
    }
    check("sections carry counts", /\(\d+/.test(q("#pms-section").textContent) && !!q(".pms-tab-n"));
    const sel = q("#pms-section");
    sel.value = "tenants"; sel.dispatchEvent(new Event("change", { bubbles: true })); await wait(450);
    check("choosing a section opens it", S.pmsTab === "tenants" && !!q('.pms-tabs .tab.active[data-pmtab="tenants"]'));
    q('[data-pms-goto="payments:owed"]').click(); await wait(500);
    check("the attention chip opens the rent that is owed", S.pmsTab === "payments" && S.pmsStatusFilter === "owed" && qa("[data-pms-markpaid]").length > 0 && qa("#pms-list [data-pms-edit]").length === 0);

    // P1: filters fold on a phone, with chips for what is active
    const statusSel = q("#pms-filter-status");
    if (phone) {
      check("phone: filters folded until asked", !visible(statusSel) && visible(q("[data-pms-filters]")));
      const chip = q('[data-pms-unfilter="status"]');
      check("phone: the active filter shows as a chip", !!chip && /Owed/.test(chip.textContent), chip ? chip.textContent : "none");
      q("[data-pms-filters]").click(); await wait(150);
      check("phone: Filters opens the drop-downs", visible(q("#pms-filter-status")));
      if (chip) { q('[data-pms-unfilter="status"]').click(); await wait(400); }
      check("phone: removing the chip clears the filter", S.pmsStatusFilter === "" && !q('[data-pms-unfilter="status"]'));
    } else {
      check("desktop: filters shown inline", visible(statusSel) && !visible(q("[data-pms-filters]")));
      statusSel.value = ""; statusSel.dispatchEvent(new Event("change", { bubbles: true })); await wait(400);
    }
    check("no sideways scroll on the payments section", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth);

    // P4: labelled row buttons
    for (const t of ["properties", "units", "owners", "tenants", "leases", "payments", "maintenance", "expenses", "documents"]) {
      await tab(t);
      const edits = qa("#pms-list [data-pms-edit]"), arch = qa("#pms-list [data-pms-archive]");
      const ok = edits.every(b => /Edit/.test(b.textContent)) && arch.every(b => /Archive|Delete/.test(b.textContent));
      if (!ok || !edits.length) check("row buttons are labelled on " + t, ok && edits.length > 0, edits.length + " edit buttons");
      if (phone && document.documentElement.scrollWidth > window.innerWidth + 2) check("no sideways scroll on " + t, false, document.documentElement.scrollWidth);
    }
    check("row buttons are labelled on every section", !window.__msChecks.some(c => /row buttons are labelled on (?!every)/.test(c.name)));

    // S8: an id with a quote stays intact in the property filter
    S.pms.properties.unshift({ id: 'p"x<1', title: "Quote Test", owner_id: "", createdAt: Date.now(), archived: false });
    await tab("units");
    const opt = qa("#pms-filter-property option").find(o => o.textContent === "Quote Test");
    check("drop-down values are escaped", !!opt && opt.value === 'p"x<1', opt ? opt.value : "missing");
    S.pms.properties.shift();

    // B26: owner portal net equals the reports tab
    await tab("reports");
    const lease = S.pms.leases.find(l => l.id === "l-seed-1");
    const propTitle = (S.pms.properties.find(p => p.id === lease.property_id) || {}).title;
    const incomeRow = qa("#pms-list tr").find(tr => tr.cells.length === 6 && tr.cells[0].textContent === propTitle);
    const reportNet = incomeRow ? incomeRow.cells[5].textContent.replace(/[^0-9-]/g, "") : "";

    // P8 / B28: tenant portal
    await setRole("tenant");
    const led = L.ledger(lease, S.pms.payments.filter(p => !p.archived), L.today());
    const status = q(".pms-rent-status");
    check("tenant: rent card shows what is overdue", !!status && (led.overdue > 0 ? status.textContent.replace(/[^0-9]/g, "").indexOf(String(led.overdue)) === 0 && /overdue/.test(status.textContent) : /Paid up|due/.test(status.textContent)), status ? status.textContent : "none");
    const owedRows = qa(".pms-owed-row").length;
    const wantRows = led.months.filter(m => m.balance > 0 && (m.due <= L.today() || m.key === L.today().slice(0, 7))).length;
    check("tenant: lists each month still owed", owedRows === wantRows, owedRows + " vs " + wantRows);
    check("tenant: statement button", !!q('.pms-rent-card [data-pms-print="lease:l-seed-1"]'));
    check("tenant: no demo wording for a linked tenant", !/demo account/i.test(q("#content").textContent));
    check("tenant: no sideways scroll", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth);

    // P8 / B26: owner portal
    await setRole("owner");
    check("owner: four figures", qa(".pms-kpis .kpi").length === 4, qa(".pms-kpis .kpi").length);
    const netTile = qa(".pms-kpis .kpi").find(k => /Net/i.test(k.querySelector(".k-label").textContent));
    const ownerNet = netTile ? netTile.querySelector(".k-value").textContent.replace(/[^0-9-]/g, "") : "";
    check("owner: net matches the reports tab", !!ownerNet && ownerNet === reportNet, ownerNet + " vs " + reportNet);
    const secs = qa("details.pms-sec");
    check("owner: long sections fold", secs.length >= 5 && secs.some(d => !d.open) && secs.some(d => d.open), secs.map(d => (d.open ? "+" : "-") + d.querySelector(".pms-sec-title").textContent).join(","));
    check("owner: bank account is masked", !/\b\d{8,}\b/.test((q(".pms-owner-line") || {}).textContent || ""));
    check("owner: no sideways scroll", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth);

    // S6: a receipt stored as a private file
    await setRole("super-admin");
    S.pms.payments[0].proofPath = "payments/" + S.pms.payments[0].id + "/x.jpg";
    delete S.pms.payments[0].proof;
    await tab("leases"); await tab("payments");
    const rb = qa("[data-pms-proof]").find(b => /Photo/.test(b.textContent));
    check("stored receipt photo shows a Photo button", !!rb);
    if (rb) { rb.click(); await wait(300); check("stored receipt opens a viewer", !!q("#pms-proof-view")); const c = q("[data-proof-close]"); if (c) c.click(); await wait(150); }

    // B25: ended leases don't block archiving
    lease.status = "terminated"; lease.terminated_on = "2026-01-31"; lease.end = lease.end || "2027-01-01";
    await tab("units");
    const unitId = lease.unit_id;
    const ab = q('[data-pms-archive="unit:' + unitId + '"]');
    if (ab) { ab.click(); await until(() => qa(".modal-overlay button").some(b => /^\s*Archive\s*$/.test(b.textContent)), 20); const ok = qa(".modal-overlay button").find(b => /^\s*Archive\s*$/.test(b.textContent)); if (ok) ok.click(); await wait(400); }
    const unit = S.pms.units.find(u => u.id === unitId);
    check("a unit whose lease ended can be archived", !!unit && unit.archived === true, unit ? String(unit.archived) : "no unit");
  } catch (e) {
    check("runner", false, e && e.stack ? e.stack.slice(0, 300) : e);
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
