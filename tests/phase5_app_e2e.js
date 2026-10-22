"use strict";
/* Phase 5 app: staff announcement tab (K8) in demo mode, and that the xlsx writer is loaded (J7). */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }

(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = s => document.querySelector(s), qa = s => Array.from(document.querySelectorAll(s));
    const toasts = () => qa(".toast").map(t => t.textContent).join(" | ");
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    q("#auth-role").value = "super-admin";
    q("#auth-test").click(); await wait(600);
    chk("the xlsx writer is loaded", !!window.ESREALTY_XLSX && typeof window.ESREALTY_XLSX.build === "function");
    q('[data-view="users"]').click(); await wait(800);
    const tab = q('[data-users-tab="announce"]');
    chk("Users & Access has an Announcement tab", !!tab);
    tab.click(); await wait(500);
    chk("brokers and agents are ticked by default", qa("[data-an-role]:checked").map(c => c.value).join() === "broker,agent", qa("[data-an-role]:checked").map(c => c.value).join());
    chk("every field has a label", ["an-title", "an-body"].every(id => q('label[for="' + id + '"]')));
    q("[data-an-send]").click(); await wait(300);
    chk("a title is required", /Add a title/.test(document.body.textContent), "");
    q("#an-title").value = "Office closed Friday";
    qa("[data-an-role]").forEach(c => { c.checked = false; });
    q("[data-an-send]").click(); await wait(300);
    chk("someone must receive it", /Tick at least one role/.test(toasts()), toasts());
    q('[data-an-role][value="agent"]').checked = true;
    q("[data-an-send]").click(); await wait(400);
    // The test driver confirms the "Send announcement" dialog by itself (cdp_driver_runner.js).
    chk("demo mode says what would be sent", /Demo: the announcement would be sent to 1 role/.test(toasts()), toasts());
  } catch (e) {
    window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.message || e) });
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
