"use strict";
/* The Barangay dropdown must agree with the model.
 *
 * Without a leading placeholder, the browser highlights the first option all
 * by itself, so the control displayed "ADYA" in Lipa City while est.barangay
 * was still "". The guide then looked like it had auto-selected a barangay -
 * and disagreed with the value actually driving the estimate.
 *
 * Covers: no pre-selection before or after choosing a municipality, the
 * placeholder appearing and disappearing, the selection clearing when the
 * municipality changes, and the gate still blocking and naming the field.
 */
window.__msChecks = [];
window.__msLog = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }
setTimeout(function () { window.__msDone = true; }, 180000);

var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
async function waitFor(fn, tries, gap) {
  for (var i = 0; i < (tries || 40); i++) { if (fn()) return true; await wait(gap || 150); }
  return fn();
}
function q(s) { return document.querySelector(s); }
function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

function brSnap() {
  var s = q("[data-est-barangay]");
  if (!s) return null;
  var sel = Array.prototype.filter.call(s.options, function (o) { return o.selected; });
  return {
    value: s.value,
    index: s.selectedIndex,
    first: s.options[0] ? s.options[0].textContent : null,
    selectedCount: sel.length,
    selectedText: sel.map(function (o) { return o.textContent; }).join("|"),
    optionCount: s.options.length
  };
}

function chooseMuni(name) {
  var m = q("[data-est-muni]");
  if (!m) return false;
  m.value = name;
  m.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

(async function () {
  try {
    await waitFor(function () { return q("[data-est-muni]"); }, 60, 150);
    chk("the public guide is present on the home page", !!q("[data-est-muni]"), "");

    /* ---- 1. before a municipality is chosen ---- */
    var s = brSnap();
    chk("barangay shows a prompt before a municipality is chosen",
      !!s && s.optionCount === 1, s ? s.first : "select missing");

    /* ---- 2. choosing a municipality must NOT select a barangay ---- */
    var munis = qa("[data-est-muni] option").map(function (o) { return o.value; }).filter(Boolean);
    chk("municipalities are listed", munis.length > 5, munis.length + " options");
    chooseMuni("LIPA CITY");
    await waitFor(function () { var t = brSnap(); return t && t.optionCount > 1; }, 80, 150);
    await wait(400);

    s = brSnap();
    chk("no barangay is auto-selected after choosing a municipality",
      !!s && s.value === "", "value=" + JSON.stringify(s && s.value));
    chk("the prompt is the selected option, not a barangay",
      !!s && /choose a barangay/i.test(s.selectedText || ""), s ? s.selectedText : "-");
    chk("exactly one option is selected (the prompt itself)",
      !!s && s.selectedCount === 1, "count=" + (s && s.selectedCount));
    chk("real barangays are still listed beneath the prompt",
      !!s && s.optionCount > 10, s ? s.optionCount + " options" : "-");
    chk("nothing is marked selected below the prompt",
      !!s && s.index === 0, "selectedIndex=" + (s && s.index));

    /* ---- 3. choosing a real barangay works ---- */
    var real = q("[data-est-barangay]").options[1];
    real = real ? real.value : null;
    chk("a real barangay exists to choose", !!real, real || "none");
    if (real) {
      var sel = q("[data-est-barangay]");
      sel.value = real;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(700);
      s = brSnap();
      chk("the chosen barangay is the one displayed",
        !!s && s.value === real && s.selectedText.toUpperCase() === real.toUpperCase(),
        "value=" + (s && s.value) + " shown=" + (s && s.selectedText));
      chk("the prompt is no longer selected once a barangay is chosen",
        !!s && !/choose a barangay/i.test(s.selectedText || ""), s ? s.selectedText : "-");
    }

    /* ---- 4. changing municipality clears the choice ---- */
    chooseMuni("BAUAN");
    await waitFor(function () { var t = brSnap(); return t && t.optionCount > 1; }, 80, 150);
    await wait(400);
    s = brSnap();
    chk("changing municipality clears the barangay",
      !!s && s.value === "", "value=" + JSON.stringify(s && s.value));
    chk("changing municipality restores the prompt",
      !!s && /choose a barangay/i.test(s.selectedText || ""), s ? s.selectedText : "-");
    chk("the previous barangay is not left selected",
      !!s && s.selectedText !== real, "still showing: " + (s && s.selectedText));

    /* ---- 5. the gate still blocks and names the field ---- */
    var btn = q("[data-est-next]");
    if (btn) {
      btn.click();
      await wait(450);
      var hint = q("[data-est-next-hint]");
      chk("the gate blocks with a message naming the field still needed",
        !!hint && /municipality|barangay/i.test(hint.textContent), hint ? hint.textContent.trim().slice(0, 70) : "no message");
      chk("the gate message is announced to screen readers",
        !!hint && hint.getAttribute("role") === "alert", hint ? hint.getAttribute("role") : "-");
    } else {
      chk("the continue button exists", false, "missing");
    }

    finish();
  } catch (e) {
    chk("runner", false, (e && e.message) || String(e));
    finish();
  }
})();

function finish() {
  window.__msOk = window.__msChecks.every(function (c) { return c.ok; });
  window.__msDone = true;
}