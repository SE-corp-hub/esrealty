/* Website settings reach the site_settings table (backend roadmap K1, app side).
 * The cloud client is wrapped so writes to the settings tables are recorded, not sent. Signed-in cloud accounts need a real
 * server, so this uses the local test login (a super-admin without a cloud id) and checks the settings
 * writes, which do not need one. The compliance copy needs a cloud id and is checked in
 * tests/phase2_app_node.js. */
(async function () {
  var log = [], checks = [], ok;
  window.__msLog = log; window.confirm = () => true;
  setTimeout(function () { log.push("WD"); window.__msDone = true; }, 60000);
  var wait = ms => new Promise(r => setTimeout(r, ms));
  var add = (name, pass, detail) => checks.push({ name: name, ok: !!pass, detail: detail == null ? "" : String(detail) });
  var setv = (s, v) => { var e = document.querySelector(s); if (e) { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); } return !!e; };
  try {
    var writes = [];
    // Every call on the stand-in answers "nothing, no error"; upserts are remembered.
    var reply = function (table) {
      var p = new Proxy(function () {}, {
        get: function (_, prop) {
          if (prop === "then") return function (res) { res({ data: [], error: null }); };
          return function () {
            if (prop === "upsert") writes.push({ table: table, row: arguments[0], opts: arguments[1] });
            return p;
          };
        },
        apply: function () { return p; }
      });
      return p;
    };
    // The page already holds the real (vendored) client; only the two settings tables are intercepted.
    var sb = window.ESREALTY_SUPABASE;
    add("the cloud client is loaded", !!sb && typeof sb.from === "function", "");
    var realFrom = sb.from.bind(sb);
    sb.from = function (t) { return (t === "site_settings" || t === "compliance_records") ? reply(t) : realFrom(t); };
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    document.querySelector("#auth-role").value = "super-admin";
    document.querySelector("#auth-test").click(); await wait(700);

    // Contact Us
    document.querySelector('[data-view="dashboard"]').click(); await wait(500);
    var edit = document.querySelector("#edit-site-contact");
    add("the Contact Us card is there", !!edit, "");
    edit.click(); await wait(300);
    setv("#sc-phone", "0917 555 0100"); setv("#sc-title", "Talk to us");
    document.querySelector("[data-site-contact-save]").click(); await wait(500);
    var c = writes.filter(w => w.table === "site_settings" && w.row && w.row.key === "siteContact");
    add("saving Contact Us writes one site_settings row", c.length === 1, writes.length);
    add("... key siteContact, public, with the new phone and headline", c.length === 1 && c[0].row.is_public === true && c[0].row.value.phone === "0917 555 0100" && c[0].row.value.title === "Talk to us", c.length ? JSON.stringify(c[0].row).slice(0, 120) : "none");
    add("... keyed on the setting name (one row per setting)", c.length === 1 && c[0].opts && c[0].opts.onConflict === "key", c.length ? JSON.stringify(c[0].opts) : "none");

    // Value Guide factors
    document.querySelector('[data-view="admin"]').click(); await wait(500);
    var tab = document.querySelector('[data-admin-tab="value-guide"]');
    add("the Value Guide admin tab is there", !!tab, "");
    tab.click(); await wait(500);
    document.querySelector("#vg-proxy-residential").value = "1.1"; document.querySelector("#vg-cost-mixed_chb").value = "26000"; // read when Approve is pressed
    document.querySelector("[data-vg-save]").click(); await wait(500);
    var g = writes.filter(w => w.table === "site_settings" && w.row && w.row.key === "valueGuide");
    add("approving the factors writes one site_settings row", g.length === 1, writes.length);
    add("... public, with the approved factors", g.length === 1 && g[0].row.is_public === true && g[0].row.value.proxyFactors.residential === 1.1 && g[0].row.value.construction.mixed_chb === 26000 && !!g[0].row.value.approvedAt, g.length ? JSON.stringify(g[0].row.value.proxyFactors) + JSON.stringify(g[0].row.value.construction) : "none");
    add("nothing else was written to the table", writes.filter(w => w.table === "site_settings").length === 2, writes.map(w => w.table + ":" + (w.row && w.row.key)).join(","));

    ok = checks.every(x => x.ok) && checks.length >= 9;
  } catch (e) { log.push("ERR:" + e.message); ok = false; }
  window.__msChecks = checks; window.__msOk = ok; window.__msDone = true;
})();
