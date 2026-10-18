"use strict";
/* Every role, every screen (2026-10-18). Signs in as each role in the demo,
   opens each item in its menu, and checks that the screen draws, no script
   error is thrown, no "undefined" or "[object Object]" text leaks into the
   page, and (on a phone) nothing scrolls sideways. */
window.__msChecks = [];
window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail: String(detail) });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 60) { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(100); } return !!fn(); }
const q = s => document.querySelector(s);
const qa = s => Array.from(document.querySelectorAll(s));
const phone = window.innerWidth <= 760;
const errors = [];
window.addEventListener("error", e => { if (e && e.error) errors.push(String(e.error && e.error.stack || e.message).slice(0, 300)); });

(async () => {
  try {
    location.hash = "#/home";
    window.confirm = () => true;
    await until(() => q("#auth-test"));
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    q("#auth-role").value = "super-admin";
    q("#auth-test").click();
    await until(() => q("#content") && q("#content").children.length > 0);
    await wait(500);
    const roles = ["super-admin", "broker", "agent", "buyer", "seller", "owner", "tenant"];
    const problems = [];
    let screens = 0;
    for (const role of roles) {
      const rs = q("#user-role-select");
      if (!rs) { check("role switcher present", false); break; }
      rs.value = role; rs.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(700);
      const views = [...new Set(qa("#nav [data-view]:not(.nav-hidden)").map(b => b.getAttribute("data-view")))];
      if (!views.length) problems.push(role + ": empty menu");
      for (const v of views) {
        const before = errors.length;
        const btn = q('#nav [data-view="' + v + '"]:not(.nav-hidden)');
        if (!btn) continue;
        btn.click();
        await wait(650);
        screens++;
        const content = q("#content");
        const text = content ? content.innerText : "";
        if (!content || !content.children.length) problems.push(role + "/" + v + ": empty screen");
        if (errors.length > before) problems.push(role + "/" + v + ": script error " + errors.slice(before).join(" | "));
        const leak = /\bundefined\b|\[object Object\]|\bNaN\b/.exec(text);
        if (leak) problems.push(role + "/" + v + ": shows \"" + leak[0] + "\" near \"" + text.slice(Math.max(0, leak.index - 40), leak.index + 20).replace(/\s+/g, " ") + "\"");
        if (phone && document.documentElement.scrollWidth > window.innerWidth + 2) problems.push(role + "/" + v + ": scrolls sideways (" + document.documentElement.scrollWidth + "px)");
      }
    }
    check("every role's screens open cleanly (" + screens + " screens)", problems.length === 0 && screens > 30, problems.slice(0, 12).join(" || "));
  } catch (e) {
    check("runner", false, e && e.stack ? e.stack : String(e));
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
