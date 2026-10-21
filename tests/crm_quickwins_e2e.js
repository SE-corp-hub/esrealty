(async function () {
  var log = [], checks = [], ok;
  window.__msLog = log; window.confirm = () => true;
  setTimeout(function(){ log.push("WD"); window.__msDone = true; }, 60000);
  var wait = ms => new Promise(r => setTimeout(r, ms));
  var setv = (s, v) => { var e = document.querySelector(s); if (e) { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); return true; } return false; };
  try {
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    document.querySelector("#auth-role").value="super-admin";
    document.querySelector("#auth-test").click(); await wait(500);
    document.querySelector('[data-view="leads"]').click(); await wait(700);
    // SEARCH
    setv("#lf-q","a"); await wait(400);
    var before=Array.from(document.querySelectorAll(".lead-col")).map(c=>c.querySelectorAll("[data-lead-open]").length).reduce((a,b)=>a+b,0);
    setv("#lf-q","zzzznotfound"); await wait(400);
    var after=Array.from(document.querySelectorAll(".lead-col")).map(c=>c.querySelectorAll("[data-lead-open]").length).reduce((a,b)=>a+b,0);
    checks.push({name:"search filters board", ok: before>0 && after===0, detail:before+"->"+after});
    setv("#lf-q",""); await wait(350);
    // OVERDUE stat + badge: create a lead with yesterday followup via edit modal on first card
    var ed=document.querySelector("[data-lead-edit]");
    if(ed){ ed.click(); await wait(350);
      var fu=document.getElementById("ld-followup");
      if(fu){ var y=new Date(Date.now()-86400000); var iso=y.toISOString().slice(0,10);
        fu.value=iso; fu.dispatchEvent(new Event("input",{bubbles:true})); }
      var sb=Array.from((document.querySelector("#ld-modal")||{querySelectorAll:()=>[]}).querySelectorAll("button")).find(b=>/Save/i.test(b.textContent));
      if(sb) sb.click(); await wait(450);
    }
    var html=document.querySelector("#content").innerHTML;
    checks.push({name:"overdue badge", ok:/Overdue \d+d/.test(html), detail:(html.match(/Overdue \d+d/)||["none"])[0]});
    checks.push({name:"followups-due stat", ok:/Follow-ups due/.test(html), detail:(html.match(/ls-stat-v"[^>]*>\d+<\/div><div class="ls-stat-l dim">Follow-ups due/)||["?"])[0].slice(-40)});
    // MARK LOST from detail
    var card=document.querySelector("[data-lead-open]");
    if(card) card.click(); await wait(400);
    var lostB=document.querySelector("[data-lead-lost]");
    checks.push({name:"mark-lost btn", ok:!!lostB, detail:""});
    if(lostB) lostB.click(); await wait(400);
    // Marking a lead lost asks why (F5): the button stays off until a reason is chosen.
    var lostOk=document.querySelector("#lost-ok");
    checks.push({name:"lost asks for a reason first", ok:!!lostOk && lostOk.disabled, detail:""});
    var lostSel=document.querySelector("#lost-reason");
    if(lostSel){ lostSel.value="financing"; lostSel.dispatchEvent(new Event("change",{bubbles:true})); }
    if(lostOk) lostOk.click(); await wait(500);
    html=document.querySelector("#content").innerHTML;
    checks.push({name:"lost reason is recorded", ok:/Lost \(Financing fell through\)/.test(html), detail:(html.match(/Status changed:[^<]*/)||["?"])[0].slice(0,80)});
    checks.push({name:"status lost logged", ok:/→ Lost|Lost</.test(html), detail:(html.match(/Status changed:[^<]*/)||["?"])[0].slice(0,50)});
    checks.push({name:"lost btn hidden after", ok:!document.querySelector("[data-lead-lost]"), detail:""});
    // mobile re-check of new elements
    ok = checks.every(c=>c.ok)&&checks.length>0;
  } catch(e){ log.push("ERR:"+e.message); ok=false; }
  window.__msChecks=checks; window.__msOk=ok; window.__msDone=true;
})();