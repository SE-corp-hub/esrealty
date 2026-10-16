"use strict";
/* Back office on phones (2026-10-16). Every back-office user works on a phone,
   so at phone width (<= 760 px, CI runs this at 390 x 844 with -Mobile) this
   checks:
   1) the header is one row (<= 64 px); language and theme sit behind
      "More options", which opens, reports its state and closes on Esc
   2) the menu button reports its state, and an agent sees every screen as
      soon as the drawer opens (no collapsed group to tap first)
   3) CRM: one main button plus a More menu; filters fold behind a Filters
      button with search still visible; the first lead is on the first screen
   4) lead cards carry Call / WhatsApp / Viber links, 44 px tall, and tapping
      one does not open the lead
   5) the Add Lead pop-up is a labelled dialog, its fields fill the form,
      phone and email bring up the right keyboard, and the page behind locks
   6) the transaction select box is a 44 px target; stat tiles sit two per row
   At desktop width it checks the same controls stay inline (no More buttons,
   filters open, pop-up fields not squeezed). */
window.__msChecks = [];
window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail: String(detail) });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 60) { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(100); } return !!fn(); }
const q = s => document.querySelector(s);
const shown = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
const rect = e => e.getBoundingClientRect();
async function login(role) {
  localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
  q("#auth-role").value = role;
  q("#auth-test").click();
  await until(() => q("#content") && q("#content").children.length > 0);
  await wait(400);
}
async function go(view) {
  const b = q('#nav [data-view="' + view + '"]');
  if (b) b.click();
  await wait(700);
  window.scrollTo(0, 0);
}

(async () => {
  try {
    location.hash = "#/home";
    window.confirm = () => true;
    await until(() => q("#auth-test"));
    await login("agent");
    const phone = window.innerWidth <= 760;
    check("viewport", true, window.innerWidth + "px, phone=" + phone);

    /* 1) header */
    const topH = Math.round(rect(q(".topbar")).height);
    if (phone) {
      check("header is one row on a phone (<= 64 px)", topH <= 64, topH + "px");
      check("More options button shown", shown(q("#topbar-more")));
      check("language toggle folded away until More is opened", !shown(q("#language-toggle")));
      q("#topbar-more").click(); await wait(150);
      check("More options opens and reports expanded", shown(q("#language-toggle")) && shown(q("#theme-toggle")) && q("#topbar-more").getAttribute("aria-expanded") === "true");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await wait(150);
      check("Esc closes More options", !shown(q("#language-toggle")) && q("#topbar-more").getAttribute("aria-expanded") === "false");
    } else {
      check("desktop header keeps controls inline", !shown(q("#topbar-more")) && shown(q("#language-toggle")), topH + "px");
    }
    check("theme toggle is keyboard reachable", q("#theme-toggle").getAttribute("role") === "button" && q("#theme-toggle").tabIndex === 0);

    /* 2) menu */
    const menuBtn = q("#menu-btn");
    check("menu button names the drawer it controls", menuBtn.getAttribute("aria-controls") === "sidebar" && /menu/i.test(menuBtn.getAttribute("aria-label") || ""));
    if (phone) {
      menuBtn.click(); await wait(200);
      check("menu button reports the drawer open", menuBtn.getAttribute("aria-expanded") === "true", menuBtn.getAttribute("aria-expanded"));
    }
    const agentViews = Array.prototype.filter.call(document.querySelectorAll("#nav [data-view]"), b => !b.classList.contains("nav-hidden"));
    const visibleViews = agentViews.filter(shown);
    check("agent sees every screen without opening a group", agentViews.length >= 7 && visibleViews.length === agentViews.length, visibleViews.length + "/" + agentViews.length);
    check("menu groups report their state", Array.prototype.every.call(document.querySelectorAll("#nav .nav-dropdown-trigger"), t => /^(true|false)$/.test(t.getAttribute("aria-expanded") || "") && !!document.getElementById(t.getAttribute("aria-controls"))));
    if (phone) {
      menuBtn.click(); await wait(200);
      check("menu button reports the drawer closed", menuBtn.getAttribute("aria-expanded") === "false");
    }

    /* 3) CRM layout */
    await go("leads");
    await until(() => q(".lead-card"));
    const moreBtn = q("#content .actions-more-btn");
    check("CRM keeps Add Lead as the main button", shown(q("[data-lead-new]")));
    if (phone) {
      check("secondary CRM actions start folded under More", shown(moreBtn) && !shown(q("[data-lead-csv]")));
      moreBtn.click(); await wait(150);
      check("More opens the secondary actions", shown(q("[data-lead-csv]")) && shown(q("[data-lead-sheet]")) && moreBtn.getAttribute("aria-expanded") === "true");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await wait(150);
      check("Esc closes the More menu", !shown(q("[data-lead-csv]")) && moreBtn.getAttribute("aria-expanded") === "false");
      check("filters fold away, search stays", shown(q("#lf-q")) && !shown(q("#lf-type")) && shown(q('[data-filters-toggle="lf"]')));
      q('[data-filters-toggle="lf"]').click(); await wait(150);
      check("Filters button opens the rest", shown(q("#lf-type")) && shown(q("#lf-source")) && q('[data-filters-toggle="lf"]').getAttribute("aria-expanded") === "true");
      q('[data-filters-toggle="lf"]').click(); await wait(150);
      check("Filters button folds them again", !shown(q("#lf-type")));
      window.scrollTo(0, 0); await wait(100);
      const firstY = Math.round(rect(q(".lead-card")).top + window.scrollY);
      check("first lead is on the first screen", firstY < window.innerHeight, firstY + "px of " + window.innerHeight);
    } else {
      check("desktop shows CRM actions inline", !shown(moreBtn) && shown(q("[data-lead-csv]")));
      check("desktop shows every filter", shown(q("#lf-type")) && !shown(q('[data-filters-toggle="lf"]')));
    }

    /* 4) contact buttons */
    const card = Array.prototype.find.call(document.querySelectorAll(".lead-card"), c => c.querySelector("[data-lead-contact]"));
    check("lead cards carry contact buttons", !!card);
    if (card) {
      const links = card.querySelectorAll("[data-lead-contact]");
      const call = card.querySelector('[data-lead-contact="call"]');
      check("Call, WhatsApp and Viber on the card", links.length === 3, links.length);
      check("Call dials an international number", /^tel:\+\d{10,15}$/.test(call.getAttribute("href")), call.getAttribute("href"));
      if (phone) check("contact buttons are 44 px tall", Array.prototype.every.call(links, a => rect(a).height >= 44), Array.prototype.map.call(links, a => Math.round(rect(a).height)).join(","));
      const stop = e => e.preventDefault();
      document.addEventListener("click", stop, true);
      call.click(); await wait(300);
      document.removeEventListener("click", stop, true);
      check("tapping Call does not open the lead", !q("[data-lead-back]") && !!q(".lead-card"));
    }

    /* 5) Add Lead pop-up */
    window.scrollTo(0, 0);
    q("[data-lead-new]").click();
    await until(() => shown(q("#ld-name")));
    await wait(250);
    const dlg = q("#ld-name").closest(".modal-card");
    check("pop-up is a modal dialog", dlg && dlg.getAttribute("role") === "dialog" && dlg.getAttribute("aria-modal") === "true");
    const title = dlg && document.getElementById(dlg.getAttribute("aria-labelledby") || "");
    check("pop-up is named by its heading", !!title && /Add Lead/i.test(title.textContent), title ? title.textContent : "none");
    check("focus moved into the pop-up", dlg && dlg.contains(document.activeElement));
    check("page behind the pop-up is locked", document.documentElement.classList.contains("modal-open"));
    const ctls = Array.prototype.filter.call(dlg.querySelectorAll("input:not([type=hidden]), select, textarea"), shown);
    const unnamed = ctls.filter(c => !(c.labels && c.labels.length) && !c.getAttribute("aria-label"));
    check("every pop-up field has a label", ctls.length >= 10 && unnamed.length === 0, unnamed.length + " unlabelled of " + ctls.length + (unnamed[0] ? " e.g. " + unnamed[0].id : ""));
    check("phone field brings up the phone keypad", q("#ld-phone").type === "tel");
    check("email field brings up the email keyboard", q("#ld-email").type === "email");
    const body = dlg.querySelector(".modal-body");
    const ratio = rect(q("#ld-name")).width / body.clientWidth;
    if (phone) check("pop-up fields fill the form on a phone", ratio >= 0.85, Math.round(ratio * 100) + "%");
    else check("pop-up fields are not squeezed on desktop", ratio >= 0.4, Math.round(ratio * 100) + "%");
    const cancel = Array.prototype.find.call(dlg.querySelectorAll("button"), b => /cancel/i.test(b.textContent));
    if (cancel) cancel.click();
    await until(() => !shown(q("#ld-name")));
    await until(() => !document.documentElement.classList.contains("modal-open"), 40);
    check("closing the pop-up unlocks the page", !document.documentElement.classList.contains("modal-open"));

    /* 6) transaction select box and stat tiles */
    await login("super-admin");
    await go("transactions");
    const box = q(".tx-bulk-label");
    check("transaction select box is a 44 px target", !!box && rect(box).width >= 44 && rect(box).height >= 44, box ? Math.round(rect(box).width) + "x" + Math.round(rect(box).height) : "none");
    if (phone) {
      const st = Math.round(rect(q(".topbar")).height);
      check("super-admin header is one row too", st <= 64, st + "px");
    }
    await go("portfolio");
    const tiles = Array.prototype.find.call(document.querySelectorAll("#content .grid"), g => g.querySelector(":scope > .kpi"));
    const cols = tiles ? getComputedStyle(tiles).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
    check(phone ? "stat tiles sit two per row on a phone" : "stat tiles sit in a row on desktop", phone ? cols === 2 : cols >= 2, cols + " columns");

    /* ---- Phase 6 ---- */
    /* 7) wide tables become cards on a phone and stay tables on desktop */
    await go("portal");
    const wide = q("#content .table-wrap table.tbl-stack");
    check("wide tables are marked for the card layout", !!wide);
    if (wide) {
      const row = Array.prototype.find.call(wide.rows, r => !r.classList.contains("tbl-head"));
      const disp = row ? getComputedStyle(row).display : "";
      if (phone) {
        check("each table row is a card on a phone", disp === "block" && !!row.querySelector("[data-label]"), disp);
        check("no table needs sideways swiping", Array.prototype.every.call(document.querySelectorAll("#content .table-wrap"), w => w.scrollWidth <= w.clientWidth + 2));
      } else check("tables stay tables on desktop", disp === "table-row", disp);
    }
    check("offline banner hidden while online", !shown(q("#offline-banner")));

    /* 8) agent: bottom tab bar, Today home, Back gesture, filter chips */
    await login("agent");
    await go("dashboard");
    const tabs = Array.prototype.slice.call(document.querySelectorAll("#tabbar .tabbar-item"));
    if (phone) {
      check("bottom tab bar shows for agents", shown(q("#tabbar")) && tabs.map(t => t.textContent.trim()).join(",") === "Home,Leads,Listings,Deals,More", tabs.map(t => t.textContent.trim()).join(","));
      check("tab bar marks the current screen", !!q('#tabbar [data-tab-view="dashboard"][aria-current="page"]'));
      check("tab bar buttons are large touch targets", tabs.every(t => rect(t).height >= 48), tabs.map(t => Math.round(rect(t).height)).join(","));
      check("menu button gives way to the More tab", !shown(q("#menu-btn")));
      q("#tabbar [data-tab-more]").click(); await wait(200);
      check("More tab opens the drawer", q("#sidebar").classList.contains("open") && q("#tabbar [data-tab-more]").getAttribute("aria-expanded") === "true");
      q("#sidebar").classList.remove("open"); await wait(150);
    } else {
      check("no bottom tab bar on desktop", !shown(q("#tabbar")));
    }
    check("agent home starts with today's work", /Today/.test((q("#content h1") || {}).textContent || "") && /Follow-ups due/.test(q("#content").textContent) && /New leads/.test(q("#content").textContent));
    if (phone) {
      q('#tabbar [data-tab-view="leads"]').click();
      await until(() => q(".lead-card"));
      history.back();
      await until(() => q(".today-hero"), 40);
      check("Back returns to the previous screen", !!q(".today-hero") && /Dashboard/.test(q("#topbar-title").textContent), q("#topbar-title").textContent);
      history.forward();
      await until(() => q(".lead-card"), 40);
      const typeSel = q("#lf-type");
      typeSel.value = typeSel.options[1].value; typeSel.dispatchEvent(new Event("change", { bubbles: true }));
      await until(() => q(".filter-chip"));
      const chip = q(".filter-chip");
      check("an active filter shows as a chip while filters are folded", shown(chip) && /Lead type/.test(chip.textContent), chip ? chip.textContent : "none");
      if (chip) chip.click();
      await until(() => !q(".filter-chip"));
      check("the chip removes its filter", !q(".filter-chip") && q("#lf-type").value === "");

      /* 9) form pop-ups are full-height sheets with an unsaved-changes guard */
      q("[data-lead-new]").click();
      await until(() => shown(q("#ld-name")));
      await wait(250);
      const sheet = q("#ld-name").closest(".modal-card");
      check("form pop-ups open as full-height sheets", rect(sheet).top <= 1 && rect(sheet).height >= window.innerHeight - 2, Math.round(rect(sheet).top) + "/" + Math.round(rect(sheet).height));
      sheet.dataset.dirty = "1"; /* typed changes (synthetic input events are not trusted) */
      const closeX = Array.prototype.find.call(sheet.querySelectorAll(".modal-head button"), b => /×|close/i.test(b.textContent + (b.title || "")));
      closeX.click(); await wait(250);
      check("× asks once before throwing away typed changes", shown(q("#ld-name")) && !!sheet.querySelector(".dlg-unsaved"));
      closeX.click();
      await until(() => !shown(q("#ld-name")));
      check("× again closes the pop-up", !shown(q("#ld-name")));
    }
  } catch (e) { check("runner", false, e && e.stack || e); }
  window.__msOk = window.__msChecks.every(c => c.ok); window.__msDone = true;
})();
