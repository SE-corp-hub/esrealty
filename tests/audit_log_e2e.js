"use strict";
/* Change log screen (roadmap K3): Users & Access > Change log, Super Admin only.
 * Runs in demo mode (no database), so it checks the screen itself: the tab, the sentences, the
 * area filter, the CSV button, and that the user list tools are not shown beside the log. The read
 * the screen makes is locked in tests/audit_view_node.js. */
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
    q('[data-view="users"]').click(); await wait(900);

    const tab = q('[data-users-tab="log"]');
    chk("Users & Access has a Change log tab", !!tab && /Change log/.test(tab.textContent), tab && tab.textContent);
    chk("the user search is shown on the people tabs", !!q("#users-search"), "");
    tab.click(); await wait(900);

    chk("the Change log tab is the active one", q('[data-users-tab="log"]').classList.contains("active"), "");
    chk("the people search is hidden beside the log", !q("#users-search"), "");
    chk("the log card says who can see it", /Only Super Admins can see this/.test((q(".audit-log") || {}).textContent || ""), "");
    let rows = qa(".audit-log tbody tr");
    chk("demo log shows five entries", rows.length === 5, "rows=" + rows.length);
    const text = rows.map(r => r.textContent).join("\n");
    chk("money entry reads as a sentence with pesos", /Posted ₱25,000 money in/.test(text), text.slice(0, 200));
    chk("lead status entry reads as a sentence", /Changed a lead from new to contacted/.test(text));
    chk("price change shows both prices", /Changed a listing price from ₱5,200,000 to ₱4,950,000/.test(text));
    chk("role change names the person", /role from agent to broker/.test(text));
    chk("every row says who and when", rows.every(r => r.children.length === 4 && r.children[0].textContent.trim() !== "" && r.children[1].textContent.trim() !== ""), "");
    chk("there are no raw event names on screen", !/lead_status|cash_posted|listing_price|role_changed/.test(text), "");
    chk("entries are newest first", /Posted/.test(rows[0].textContent) && /Created a lead/.test(rows[4].textContent), rows[0].textContent.slice(0, 60));

    // filters
    const chips = qa("[data-audit-group]");
    chk("five area filters", chips.length === 5 && chips[0].getAttribute("aria-pressed") === "true", chips.map(c => c.textContent).join());
    qa('[data-audit-group="money"]')[0].click(); await wait(700);
    rows = qa(".audit-log tbody tr");
    chk("Money filter keeps only cash entries", rows.length === 1 && /Posted/.test(rows[0].textContent), "rows=" + rows.length);
    chk("the active filter is marked", q('[data-audit-group="money"]').getAttribute("aria-pressed") === "true" && q('[data-audit-group="all"]').getAttribute("aria-pressed") === "false", "");
    qa('[data-audit-group="leads"]')[0].click(); await wait(700);
    rows = qa(".audit-log tbody tr");
    chk("Leads filter keeps the two lead entries", rows.length === 2, "rows=" + rows.length);
    qa('[data-audit-group="listings"]')[0].click(); await wait(700);
    chk("Listings filter keeps the price change", qa(".audit-log tbody tr").length === 1, "");
    qa('[data-audit-group="all"]')[0].click(); await wait(700);
    chk("Everything shows all five again", qa(".audit-log tbody tr").length === 5, "");

    // CSV
    let got = null;
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { got = { name: this.download, href: this.href }; return; } return origClick.apply(this, arguments); };
    q("[data-audit-csv]").click(); await wait(300);
    HTMLAnchorElement.prototype.click = origClick;
    const csv = got ? decodeURIComponent(got.href.replace(/^data:text\/csv;charset=utf-8,/, "")) : "";
    chk("CSV download starts with a dated file name", !!got && /^change-log-\d{4}-\d{2}-\d{2}\.csv$/.test(got.name), got && got.name);
    chk("CSV has a header and the five entries", csv.split("\r\n").filter(Boolean).length === 6 && /^"When \(UTC\)","Who","Area","What happened","Record"/.test(csv), csv.split("\r\n").length + " lines");
    chk("no more entries button when everything fits one page", !q("[data-audit-more]"), "");

    // other tabs still work and keep their own tools
    q('[data-users-tab="all"]').click(); await wait(700);
    chk("back on a people tab the log is gone and the search is back", !q(".audit-log") && !!q("#users-search"), "");
  } catch (e) {
    window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.message || e) });
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
