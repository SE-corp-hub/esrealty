/* Lead follow-up dates and honest assistant wording (backend roadmap A3, A11).
 *  - "Next follow-up" in the lead form is a date picker, not free text.
 *  - A lead whose follow-up is today shows "Due today"; clearing the date clears it.
 *  - The assistant answers at once and says it is not a live AI model.
 * The inquiry list ("In Leads" for web inquiries) needs cloud data, so it is not covered here. */
(async function () {
  var log = [], checks = [], ok;
  window.__msLog = log; window.confirm = () => true;
  setTimeout(function () { log.push("WD"); window.__msDone = true; }, 60000);
  var wait = ms => new Promise(r => setTimeout(r, ms));
  var add = (name, pass, detail) => checks.push({ name: name, ok: !!pass, detail: detail == null ? "" : String(detail) });
  var localIso = n => { var d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  var setDate = (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
  var saveModal = async () => {
    var btn = Array.from((document.querySelector("#ld-modal") || { querySelectorAll: () => [] }).querySelectorAll("button")).find(b => /Save/i.test(b.textContent));
    if (btn) btn.click();
    await wait(500);
    return !!btn;
  };
  try {
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    document.querySelector("#auth-role").value = "super-admin";
    document.querySelector("#auth-test").click(); await wait(600);
    document.querySelector('[data-view="leads"]').click(); await wait(800);

    // The form: a date picker, showing the demo lead's date.
    var edit = document.querySelector("[data-lead-edit]");
    edit.click(); await wait(400);
    var fu = document.getElementById("ld-followup");
    add("follow-up is a date picker", fu && fu.type === "date", fu ? fu.type : "missing");
    add("it shows the lead's saved date", fu && /^\d{4}-\d{2}-\d{2}$/.test(fu.value), fu ? fu.value : "");
    add("no old-note hint on a dated lead", !/Earlier note/.test(document.querySelector("#ld-modal").innerHTML), "");

    // Today -> "Due today".
    setDate(fu, localIso(0));
    add("saved", await saveModal(), "");
    var html = document.querySelector("#content").innerHTML;
    add("a follow-up for today shows Due today", /Due today/.test(html), (html.match(/Due today/) || ["none"])[0]);

    // Yesterday -> overdue.
    document.querySelector("[data-lead-edit]").click(); await wait(400);
    var reopened = document.getElementById("ld-followup");
    add("the saved date comes back in the picker", reopened && reopened.value === localIso(0), reopened ? reopened.value : "");
    setDate(reopened, localIso(-3));
    await saveModal();
    html = document.querySelector("#content").innerHTML;
    add("a follow-up three days ago shows Overdue 3d", /Overdue 3d/.test(html), (html.match(/Overdue \d+d/) || ["none"])[0]);

    // Cleared -> no longer due.
    document.querySelector("[data-lead-edit]").click(); await wait(400);
    var again = document.getElementById("ld-followup");
    setDate(again, "");
    await saveModal();
    html = document.querySelector("#content").innerHTML;
    add("clearing the date removes the reminder", !/Overdue 3d/.test(html), (html.match(/Overdue \d+d/) || ["none"])[0]);

    // Assistant: honest wording, instant answer.
    document.querySelector('[data-view="assistant"]').click(); await wait(500);
    var hero = (document.querySelector("#content .hero") || {}).textContent || "";
    add("assistant says it is not a live AI model", /not by a live AI model/.test(hero), hero.slice(0, 120));
    var before = document.querySelectorAll("#chat-log .msg.bot").length;
    var sug = document.querySelector("#chat-sugs .chat-sug");
    sug.click(); await wait(60);
    var bots = document.querySelectorAll("#chat-log .msg.bot");
    var last = bots[bots.length - 1];
    add("the answer is there at once", bots.length === before + 1 && last && !/Thinking/.test(last.textContent), last ? last.textContent.slice(0, 80) : "none");

    ok = checks.every(c => c.ok) && checks.length >= 10;
  } catch (e) { log.push("ERR:" + e.message); ok = false; }
  window.__msChecks = checks; window.__msOk = ok; window.__msDone = true;
})();
