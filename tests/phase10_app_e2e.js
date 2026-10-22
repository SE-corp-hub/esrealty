"use strict";
/* Phase 10 (22 Oct): duplicate leads and merge (F2), lead score (F4), team targets (F14). Demo data, super-admin. */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }
(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = s => document.querySelector(s), qa = s => Array.from(document.querySelectorAll(s));
    window.confirm = () => true;
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    q("#auth-role").value = "super-admin";
    q("#auth-test").click(); await wait(700);
    q('#nav [data-view="leads"]').click(); await wait(900);
    const H = window.__ESREALTY_TEST_HELPERS, S = H.getState();
    const base = S.leads.find(l => l.phone) || S.leads[0];
    chk("demo leads exist", !!base && S.leads.length >= 2, String(S.leads.length));

    // F4: score chips on the cards.
    const chips = qa("[data-lead-score]");
    chk("lead cards show Hot / Warm / Cold with the score", chips.length >= 1 && chips.every(c => /^(Hot|Warm|Cold) \d+$/.test(c.textContent.trim())), chips.map(c => c.textContent).join(", "));
    chk("the reasons are on the chip", chips.length && /^Score \d+: /.test(chips[0].getAttribute("title") || ""), chips[0] && chips[0].getAttribute("title"));

    // F2: a second lead with the same phone, written differently.
    const before = S.leads.length;
    const twin = { id: "lead-twin-test", ref: "L-TWIN", name: (base.name || "Same") + " (again)", phone: (function () { const d = String(base.phone).replace(/\D/g, "").replace(/^63/, "").replace(/^0/, ""); return "0" + d.slice(0, 3) + "-" + d.slice(3); })(), email: "", source: "website", status: "new", type: base.type || "buyer",
      createdAt: new Date().toISOString(), activity: [{ date: new Date().toISOString(), text: "Lead created" }], notes: "Asked about parking", createdBy: base.createdBy || "", assignedTo: base.assignedTo || "" };
    S.leads.push(twin);
    q('#nav [data-view="leads"]').click(); await wait(700);
    chk("the CRM finds the pair", H.leadDuplicateGroups().some(g => g.some(x => x.id === twin.id) && g.some(x => x.id === base.id)), JSON.stringify(H.leadDuplicateGroups().map(g => g.map(x => x.id))));
    chk("the leads page says so", !!q("[data-lead-dup-summary]") && /share a phone number or email/.test(q("[data-lead-dup-summary]").textContent));
    q('[data-lead-open="' + twin.id + '"]').click(); await wait(700);
    const ban = q("[data-lead-dup-banner]");
    chk("the lead shows who it may be the same as", !!ban && ban.textContent.indexOf(base.name) !== -1, ban ? ban.textContent.slice(0, 120) : "none");
    chk("the lead shows its score and why", !!q("[data-lead-score-card]") && /\+10 phone number/.test(q("[data-lead-score-card]").textContent));
    q("[data-lead-dups]").click(); await wait(500);
    const modal = q("#dup-modal");
    chk("the review opens with the group and a choice of which to keep", !!modal && modal.querySelectorAll('input[type="radio"]').length >= 2);
    const keep = modal.querySelector('input[value="' + base.id + '"]'); keep.checked = true;
    modal.querySelector("[data-dup-merge]").click(); await wait(900);
    const merged = S.leads.find(l => l.id === base.id);
    chk("merging keeps one lead", S.leads.length === before && !S.leads.some(l => l.id === twin.id), S.leads.length + " vs " + before);
    chk("its notes and history include the other lead's", !!merged && /Asked about parking/.test(merged.notes || "") && (merged.activity || []).some(a => /^Merged with .*L-TWIN/.test(a.text || "")), merged ? (merged.notes || "") : "none");
    chk("the merge is remembered on the lead", !!merged && (merged.mergedFrom || []).some(m => m.id === twin.id));
    chk("no duplicates left", H.leadDuplicateGroups().length === 0);

    // F14: targets.
    state0: {
      q('[data-lead-back]') && q('[data-lead-back]').click(); await wait(600);
      const card = q("[data-team-targets]");
      chk("the leads page has the team targets card", !!card && /Team targets/.test(card.textContent));
      q("[data-targets-edit]").click(); await wait(400);
      const tm = q("#tt-modal");
      chk("a Super Admin can set targets", !!tm && !!q("#tt-def-contacted"));
      q("#tt-def-contacted").value = "5"; q("#tt-def-won").value = "2";
      q("[data-tt-save]").click(); await wait(700);
      const t = H.teamTargets();
      chk("the default targets are saved", t.cfg && t.cfg.default.contacted === 5 && t.cfg.default.won === 2, JSON.stringify(t.cfg));
      const rows = qa("#team-targets tr").slice(1);
      chk("progress shows against the target", rows.length === 0 || rows.some(r => /\/ 5/.test(r.textContent)), rows.map(r => r.textContent).join(" | "));
    }
    chk("no sideways scroll", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth + " > " + window.innerWidth);
  } catch (e) { window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.stack || e.message || e) + "" }); }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
