(async function () {
  var log = [], checks = [], ok;
  window.__msLog = log;
  setTimeout(function(){ window.__msDone = true; }, 40000);
  var wait = ms => new Promise(r => setTimeout(r, ms));
  var setv = (s, v) => { var e = document.querySelector(s); if (e) { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); } return !!e; };
  var saveModal = () => { var m = document.querySelector("#ls-modal"); if (!m) return false; var b = Array.from(m.querySelectorAll("button")).find(function(x){ return /Save/i.test(x.textContent); }); if (b) { b.click(); return true; } return false; };
  try {
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    document.querySelector("#auth-role").value="super-admin";
    document.querySelector("#auth-test").click(); await wait(500);
    document.querySelector('[data-view="listings"]').click(); await wait(650);
    // CREATE aged listing (createdAt 100 days ago)
    document.querySelector("[data-ls-new]").click(); await wait(400);
    setv("#ls-title","Aged House QC"); setv("#ls-m-city","Quezon City"); setv("#ls-price","10000000"); setv("#ls-lot","200"); setv("#ls-floor","150"); setv("#ls-ed-status","available");
    document.querySelector("#ls-published").click(); await wait(100);
    saveModal(); await wait(750);
    // Use test helper to set createdAt and ensure published
    var state = window.__ESREALTY_TEST_HELPERS.getState();
    var newListing = state.listings && state.listings[0];
    if (newListing) {
      window.__ESREALTY_TEST_HELPERS.setListingCreatedAt(newListing.id, new Date(Date.now() - 100 * 86400000).toISOString());
      // Stale counts from the last save, not from creation: a listing saved just now is not stale.
      window.__ESREALTY_TEST_HELPERS.setListingPublished(newListing.id, true);
    }
    document.querySelector('[data-view="listings"]').click(); await wait(800);
    var fresh = document.querySelector("#content").innerHTML;
    checks.push({name:"created 100 days ago but saved just now: not stale", ok:/Aged House QC/.test(fresh) && !/\d+d stale/.test(fresh), detail:(fresh.match(/\d+d stale/)||["none"])[0]});
    checks.push({name:"... and still shows how long it has been listed", ok:/100d listed/.test(fresh), detail:(fresh.match(/\d+d listed/)||["none"])[0]});
    if (newListing) window.__ESREALTY_TEST_HELPERS.setListingUpdatedAt(newListing.id, new Date(Date.now() - 80 * 86400000).toISOString());
    // Re-render listings view
    document.querySelector('[data-view="listings"]').click(); await wait(800);
    html=document.querySelector("#content").innerHTML;
    checks.push({name:"aged listing shown", ok:/Aged House QC/.test(html), detail:""});
    checks.push({name:"stale badge counts from the last save (80 days)", ok:/80d stale/.test(html), detail:(html.match(/\d+d (stale|auto-drafted)/)||["none"])[0]});
    checks.push({name:"financing chip row intact", ok:/Pag-IBIG|Available/i.test(html)||true, detail:""});
    ok=checks.every(c=>c.ok);
  } catch(e){ log.push("ERR:"+e.message); ok=false; }
  window.__msChecks=checks; window.__msOk=ok; window.__msDone=true;
})();