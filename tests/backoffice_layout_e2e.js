/* Back-office layout: on every screen and tab a super-admin can open, nothing
 * pushes the page sideways, no button or label spills out of its box, and
 * nothing sticks out past the edge of its card. Run at desktop, tablet (820)
 * and phone widths in CI. */
(async function () {
  var log = [], checks = [];
  window.__msLog = log; window.__msChecks = checks; window.confirm = () => true; window.alert = () => {};
  var done = () => { checks.filter(c => !c.ok).forEach(c => log.push("FAIL " + c.name + ": " + (c.detail || ""))); window.__msOk = checks.length > 0 && checks.every(c => c.ok); window.__msDone = true; };
  setTimeout(function () { log.push("WD"); done(); }, 200000);
  var wait = ms => new Promise(r => setTimeout(r, ms));
  var vis = e => { var r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && +s.opacity > 0; };
  var name = e => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : "");
  function problems() {
    var out = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push("page scrolls sideways (" + document.documentElement.scrollWidth + " > " + innerWidth + ")");
    var root = document.querySelector("#content");
    Array.prototype.forEach.call(root.querySelectorAll("*"), function (e) {
      if (e.closest("svg") || !vis(e)) return;
      var s = getComputedStyle(e);
      var hasText = Array.prototype.some.call(e.childNodes, n => n.nodeType === 3 && n.textContent.trim());
      if (hasText && !/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(e.tagName) && !/(auto|scroll)/.test(s.overflowX) && s.textOverflow !== "ellipsis" && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 2)
        out.push("text spills out of " + name(e) + ": " + e.textContent.trim().slice(0, 40));
      if (/^(BUTTON|A|INPUT|SELECT|TABLE)$/.test(e.tagName)) {
        var card = e.parentElement && e.parentElement.closest(".card, .lead-card, .kpi");
        if (!card) return;
        for (var p = e.parentElement; p && p !== card.parentElement; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return;
        var r = e.getBoundingClientRect(), c = card.getBoundingClientRect();
        if (r.right > c.right + 2 || r.left < c.left - 2) out.push(name(e) + " sticks out of " + name(card) + " (" + (e.textContent || "").trim().slice(0, 30) + ")");
      }
    });
    return out.filter((x, i, a) => a.indexOf(x) === i);
  }
  try {
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    document.querySelector("#auth-role").value = "super-admin";
    document.querySelector("#auth-test").click(); await wait(1500);
    var views = Array.from(new Set(Array.prototype.map.call(document.querySelectorAll("#nav [data-view]"), n => n.dataset.view)));
    checks.push({ name: "found the back-office screens", ok: views.length >= 10, detail: views.join(",") });
    var tabSel = "#content .tab, #content [role=tab]";
    for (var v of views) {
      var nav = document.querySelector('#nav [data-view="' + v + '"]');
      if (!nav) continue;
      nav.click(); await wait(900);
      var p = problems();
      checks.push({ name: v + ": fits the screen", ok: p.length === 0, detail: p.slice(0, 4).join(" | ") });
      var n = Array.prototype.filter.call(document.querySelectorAll(tabSel), t => t.offsetParent).length;
      for (var i = 0; i < n; i++) {
        var t = Array.prototype.filter.call(document.querySelectorAll(tabSel), t => t.offsetParent)[i];
        if (!t) continue;
        var label = (t.textContent || "").trim().slice(0, 24);
        t.click(); await wait(600);
        p = problems();
        checks.push({ name: v + " > " + label + ": fits the screen", ok: p.length === 0, detail: p.slice(0, 4).join(" | ") });
      }
    }
    // Lead cards: the snooze / edit buttons and contact buttons stay inside the card
    document.querySelector('#nav [data-view="leads"]').click(); await wait(900);
    var bad = Array.prototype.filter.call(document.querySelectorAll(".lead-card"), function (card) {
      var c = card.getBoundingClientRect();
      return Array.prototype.some.call(card.querySelectorAll("button, a"), b => { var r = b.getBoundingClientRect(); return r.width && (r.right > c.right + 1 || b.scrollWidth > b.clientWidth + 2); });
    });
    checks.push({ name: "lead cards: every button fits inside its card", ok: document.querySelectorAll(".lead-card").length > 0 && bad.length === 0, detail: bad.length + " cards" });
    checks.push({ name: "lead cards: edit button is in the card's bottom row", ok: !!document.querySelector(".lead-card-foot [data-lead-edit]"), detail: "" });
  } catch (e) { checks.push({ name: "no script error", ok: false, detail: String(e && e.stack || e).slice(0, 300) }); }
  done();
})();
