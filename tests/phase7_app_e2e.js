"use strict";
/* Lead routing tab (F1), demo mode. The routing itself is in the database (tests/db/test_lead_routing.sql). */
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
    q('[data-view="users"]').click(); await wait(900);
    const tab = q('[data-users-tab="routing"]');
    chk("Users & Access has a Lead routing tab", !!tab);
    tab.click(); await wait(700);
    chk("routing starts off", q("#rt-enabled") && !q("#rt-enabled").checked, "");
    const boxes = qa("[data-rt-broker]");
    chk("approved brokers are listed to choose from", boxes.length >= 1, String(boxes.length));
    q("#rt-enabled").checked = true;
    boxes.forEach(b => { b.checked = false; });
    q("[data-routing-save]").click(); await wait(300);
    chk("on with no broker is refused", /Tick at least one broker/.test(toasts()), toasts());
    boxes[0].checked = true;
    q("[data-routing-save]").click(); await wait(500);
    chk("saving reports who takes turns", /lead routing on for 1 broker/.test(toasts()), toasts());
    chk("the saved choice is shown again", q("#rt-enabled").checked && qa("[data-rt-broker]:checked").length === 1, "");
    chk("no horizontal scroll with the extra tab", document.documentElement.scrollWidth <= innerWidth + 2, document.documentElement.scrollWidth + " vs " + innerWidth);
  } catch (e) { window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.message || e) }); }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
