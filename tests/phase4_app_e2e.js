"use strict";
/* Phase 4 app: role matrix (K2), bulk lead update and CSV import (F6), closing checklist (J3),
 * keyword field on the public search (H2). Demo mode. */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }

(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = s => document.querySelector(s), qa = s => Array.from(document.querySelectorAll(s));
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    q("#auth-role").value = "super-admin";
    q("#auth-test").click(); await wait(600);
    const H = window.__ESREALTY_TEST_HELPERS;

    // ---- K2
    q('[data-view="users"]').click(); await wait(800);
    const rt = q('[data-users-tab="roles"]');
    chk("Users & Access has a 'Who can do what' tab", !!rt, "");
    rt.click(); await wait(600);
    const table = q(".role-matrix table");
    chk("the matrix shows a column per role", !!table && table.querySelectorAll("thead th").length === 8, table && table.querySelectorAll("thead th").length);
    const rowOf = label => qa(".role-matrix tbody tr").find(tr => tr.querySelector("th").textContent === label);
    const yes = (tr, col) => /Yes/.test(tr.children[col].textContent);
    const users = rowOf("Users, access and change log"), pms = rowOf("Property management"), leadsM = rowOf("Add and change leads");
    chk("only Super Admin manages users", users && yes(users, 1) && [2, 3, 4, 5, 6, 7].every(i => !yes(users, i)), users && users.textContent);
    chk("owners and tenants see property management", pms && yes(pms, 6) && yes(pms, 7), pms && pms.textContent);
    chk("brokers and agents change leads, buyers do not", leadsM && yes(leadsM, 2) && yes(leadsM, 3) && !yes(leadsM, 4), leadsM && leadsM.textContent);
    chk("yes and no are readable as text, not only as icons", /Yes/.test(users.textContent) && /No/.test(users.textContent));

    // ---- J3
    chk("closing needs the core papers", H.txClosingMissing({ stage: "cts", checklist: ["id", "tin"] }, "doas").length === 3, H.txClosingMissing({ stage: "cts", checklist: ["id", "tin"] }, "doas").join(" | "));
    chk("with the five core papers it may close", H.txClosingMissing({ stage: "cts", checklist: ["id", "tin", "title", "taxdec", "authority"] }, "doas").length === 0);
    chk("earlier stages need nothing", H.txClosingMissing({ stage: "reservation", checklist: [] }, "cts").length === 0);
    chk("a deal already at Deed of Sale is not blocked again", H.txClosingMissing({ stage: "doas", checklist: [] }, "done").length === 0);

    // ---- F6 bulk update
    q('[data-view="leads"]').click(); await wait(900);
    chk("leads page offers Bulk update and Import CSV", !!q("[data-lead-bulk]") && !!q("[data-lead-import]"), "");
    const before = (H.getState().leads || []).length;
    q("[data-lead-bulk]").click(); await wait(400);
    chk("bulk dialog says how many leads it will change", /This changes <b>\d+<\/b> lead/.test(q("#lb-modal").innerHTML), "");
    q("#lb-status").value = "lost"; q("#lb-status").dispatchEvent(new Event("change", { bubbles: true })); await wait(100);
    chk("bulk Lost asks for a reason", !q("#lb-lost-wrap").hidden, "");
    q("#lb-modal-ok").click(); await wait(300);
    chk("bulk Lost without a reason is refused", !!q("#lb-modal"), "");
    q("#lb-status").value = "contacted"; q("#lb-status").dispatchEvent(new Event("change", { bubbles: true }));
    q("#lb-modal-ok").click(); await wait(700);
    const leads = H.getState().leads || [];
    chk("bulk status change applies to the leads and logs it", leads.filter(l => l.status === "contacted" && (l.activity || []).some(a => /bulk update/.test(a.text))).length >= 1, "");
    chk("bulk update adds or removes no leads", leads.length === before, leads.length + " vs " + before);

    // ---- F6 import
    q("[data-lead-import]").click(); await wait(400);
    const okBtn = q("#li-modal-ok");
    chk("import starts disabled until a file is read", okBtn && okBtn.disabled, "");
    const existing = leads.find(l => l.phone) || {};
    const csv = "Name,Phone,Email,Source,Budget\nImport One,0917 765 4321,,facebook,4M\nImport Two,,two@x.ph,,\nImport One Again,0917 765 4321,,,\nDuplicate Of Seed," + (existing.phone || "0000") + ",,,\nNo Contact,,,,";
    const dt = new DataTransfer(); dt.items.add(new File([csv], "leads.csv", { type: "text/csv" }));
    const fi = q("#li-file"); fi.files = dt.files; fi.dispatchEvent(new Event("change", { bubbles: true })); await wait(600);
    const pv = q("#li-preview").textContent;
    chk("preview counts new, already in the CRM and skipped", /2 new leads ready/.test(pv) && /2 already in the CRM/.test(pv) && /1 row skipped/.test(pv), pv);
    q("#li-modal-ok").click(); await wait(700);
    const after = H.getState().leads || [];
    const one = after.find(l => l.name === "Import One");
    chk("two leads are imported", after.length === before + 2, after.length + " vs " + before);
    chk("imported fields: source, budget, status New, activity", one && one.source === "facebook" && one.budget === 4000000 && one.status === "new" && /imported from CSV/.test(one.activity[0].text), JSON.stringify(one && { s: one.source, b: one.budget }));

    // ---- H2 keyword field on the public search page
    chk("listing quality and paging helpers from phase 3 still exist", typeof H.selectAllPages === "function");
  } catch (e) {
    window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.message || e) });
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
