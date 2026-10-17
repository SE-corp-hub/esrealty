(async function () {
  var log = [], checks = [], ok;
  window.__msLog = log; window.confirm = () => true;
  setTimeout(function(){ log.push("WD"); window.__msDone = true; }, 60000);
  var wait = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  try {
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    document.querySelector("#auth-role").value="super-admin";
    document.querySelector("#auth-test").click(); await wait(500);
    document.querySelector('[data-view="pms"]').click(); await wait(700);
    checks.push({name:"pms no h-scroll", ok:document.documentElement.scrollWidth<=window.innerWidth+2, detail:"sw="+document.documentElement.scrollWidth});
    // open property modal
    var nb=document.querySelector('[data-pms-new="property"]');
    if(nb){ nb.click(); await wait(400);
      var mc=document.querySelector("#pms-modal .modal-card");
      if(mc){ var r=mc.getBoundingClientRect();
        checks.push({name:"pms modal fits", ok:r.width<=innerWidth+2 && r.left>=-2, detail:"w="+Math.round(r.width)});
        // scrollable body ok; save button reachable after internal scroll
        var sb=Array.from(mc.querySelectorAll("button")).find(function(b){return /Save/i.test(b.textContent);});
        checks.push({name:"pms save present", ok:!!sb, detail:""}); }
      var x=Array.from(document.querySelectorAll("#pms-modal button")).find(function(b){return /×|Close|Cancel/i.test(b.textContent);});
      if(x){x.click(); await wait(300);} }
    // each pms tab loads without h-scroll
    var tabNames=["units","tenants","leases","payments"];
    for(var i=0;i<tabNames.length;i++){
      var t=document.querySelector('[data-pmtab="'+tabNames[i]+'"]');
      if(t){ t.click(); await wait(350);
        var sw=document.documentElement.scrollWidth;
        log.push(tabNames[i]+": sw="+sw);
        if(sw>innerWidth+2){ checks.push({name:"tab "+tabNames[i]+" overflow", ok:false, detail:"sw="+sw}); } } }
    checks.push({name:"all tabs fit", ok:!checks.some(function(c){return !c.ok;}), detail:""});
    // buyer portal mobile
    var rs=document.querySelector("#user-role-select");
    if(rs){ rs.value="buyer"; rs.dispatchEvent(new Event("change",{bubbles:true})); await wait(550); }
    var pv=document.querySelector('[data-view="portal"]');
    if(pv){ pv.click(); await wait(600); }
    checks.push({name:"portal no h-scroll", ok:document.documentElement.scrollWidth<=window.innerWidth+2, detail:"sw="+document.documentElement.scrollWidth});
    checks.push({name:"portal renders mobile", ok:/My Buyer Portal/.test(document.querySelector("#content").innerHTML), detail:""});
    ok=checks.every(function(c){return c.ok;})&&checks.length>0;
  } catch(e){ log.push("ERR:"+e.message); ok=false; }
  window.__msChecks=checks; window.__msOk=ok; window.__msDone=true;
})();
