"use strict";
/* Question-to-factor wiring tests for the Value Guide.
 *
 * The defect these guard: js/app.js used to hand the calculator occupancy,
 * titleStatus and inheritanceStatus while FLOW.FACTORS read lotShape,
 * terrain, roadAccess and the rest. Only `corner` existed in both, so every
 * methodology row printed 0.00% and the applied net was always zero. These
 * checks make that mismatch impossible to reintroduce. */
const assert = require("assert"), fs = require("fs"), path = require("path");
const ROOT = process.cwd();
/* The estimator loads relative URLs through fetch; this shim is copied from
   tests/value_guide_flow_node.js:10-15 and is required, not optional. */
global.fetch = (u) => {
  const p = path.join(ROOT, String(u).split("?")[0]);
  return Promise.resolve({ ok: fs.existsSync(p), json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, "utf8"))) });
};
const EST = require(path.join(ROOT, "js/estimator.js"));
const F = require(path.join(ROOT, "js/value_guide_flow.js"));

let count = 0;
async function check(name, fn) { await fn(); count++; console.log("[PASS] " + name); }

const OPTS = {
  municipality: "BAUAN", barangay: "POBLACION III",
  streetKey: "binay st ressurreccion st", classification: "RR",
  type: "house_lot", area: 100, floorArea: 120, construction: "mixed_chb",
  floors: "2", ageBand: "6-10", corner: false, features: [],
  landMethod: "factor", saleContext: "private-resale"
};

(async () => {

check("exactly ten questions, each mapped to a live factor", () => {
  assert.strictEqual(F.QUESTIONS.length, 10);
  const factorIds = F.FACTORS.map(f => f.id);
  F.QUESTIONS.forEach(q => assert.ok(factorIds.indexOf(q.factorId) >= 0, q.id + " -> " + q.factorId));
});

/* Spec decision 5/6: nine Details questions feed their own factors; corner is
   asked in step 1 as a boolean and zonalRecency is derived from the matched
   rate's effectivityDate. Those two are reachable without a Details question, so
   they are exempt here rather than forced into the nine. */
/* Spec decision 5/6: nine Details questions feed their own factors; corner is
   asked in step 1 as a boolean and zonalRecency is derived from the matched
   rate's effectivityDate. Those two are reachable without a Details question.
   faultProximity, amenities, community and demand have neither a question nor a
   derivation and are retired by Task 4, so until then they are the only factors
   allowed to be unreachable - and this assertion fails the moment one of them is
   neither retired nor given a question. */
/* faultProximity, amenities, community and demand have neither a question nor a
   derivation, and Task 4 retires them. Naming them here keeps that list honest:
   when the four are gone this becomes a plain reachability assertion. */
const PENDING_RETIREMENT = ["faultProximity", "amenities", "community", "demand"];

check("every factor is reachable, a step-1 boolean, or named for retirement", () => {
  const fed = F.QUESTIONS.map(q => q.factorId).concat(["cornerExposure", "zonalRecency"]);
  F.FACTORS.forEach(f => {
    assert.ok(fed.indexOf(f.id) >= 0 || PENDING_RETIREMENT.indexOf(f.id) >= 0, f.id + " unreachable");
  });
});

check("the four answerable factors are retired", () => {
  PENDING_RETIREMENT.forEach(id =>
    assert.strictEqual(F.FACTORS.filter(f => f.id === id).length, 0, id + " retired"));
});

check("pickInputs omits unanswered keys rather than zeroing them", () => {
  const out = F.pickInputs({ shape: "-150", topography: "", corner: true });
  assert.strictEqual(out.lotShape, "-150", "answered question reaches its factor's field");
  assert.ok(!("terrain" in out), "unanswered key absent entirely");
  assert.strictEqual(out.corner, true);
});

check("the draft key and the factor field are deliberately different", () => {
  /* The bug this whole file exists for: the form wrote one set of names and the
     factor table read another. Assert the translation, so a future rename cannot
     silently break the join. */
  const q = F.QUESTIONS.filter(x => x.factorId === "infrastructure")[0];
  assert.strictEqual(q.input, "utilities");
  const f = F.FACTORS.filter(x => x.id === "infrastructure")[0];
  assert.strictEqual(f.input, "infrastructure");
  assert.strictEqual(F.pickInputs({ utilities: "200" }).infrastructure, "200");
});

check("every question key is renderable from the draft", () => {
  F.QUESTIONS.forEach(q => assert.ok(typeof q.input === "string" && q.input.length, q.id));
});

check("a skipped question is NaN, not zero", () => {
  assert.ok(Number.isNaN(F.factorBp({ input: "terrain", options: [{ value: "0", bp: 0 }] }, {})));
});

check("an answered zero is a real zero, not NaN", () => {
  assert.strictEqual(F.factorBp({ input: "terrain", options: [{ value: "0", bp: 0 }] }, { terrain: "0" }), 0);
});

check("an unmatched answer is unassessed, not a silent zero", () => {
  assert.ok(Number.isNaN(F.factorBp({ input: "terrain", options: [{ value: "0", bp: 0 }] }, { terrain: "banana" })));
});

check("all nine skipped: net is zero and every unanswered factor is named", async () => {
  const r = await F.compute(Object.assign({}, OPTS, F.pickInputs({})), EST);
  /* Spec Review Focus 1 wants the nine questions named. Two others can also be
     unassessed: zonalRecency, when no schedule date is available, and nothing
     else - cornerExposure is answered by an unticked box, so it never appears
     here. The assertion is the list, not a count, so adding a legitimately
     derived factor does not need this rewritten. */
  const named = r.assumptions.map(a => a.id).sort();
  ["lotShape", "terrain", "elevation", "frontage", "roadAccess", "floodRisk", "infrastructure",
    "titleDoc", "inheritance", "ownership"].forEach(id =>
    assert.ok(named.indexOf(id) >= 0, id + " reported as skipped"));
  assert.ok(named.indexOf("zonalRecency") >= 0, "the undated schedule is reported too");
  assert.strictEqual(named.length, 11, "and nothing else: corner is an answer, not a skip");
  assert.strictEqual(r.referenceModel.skippedCount, named.length);
  assert.ok(Number.isFinite(r.total) && r.total > 0, "a usable number is still produced");
});

check("a skipped question and a zero-bp answer read differently on the result", async () => {
  /* The estimator needs its own location fields; pickInputs deliberately does not
     carry them because it only forwards question answers. Pass the merged object,
     which is how js/app.js builds the call. */
  const base = { municipality: "BAUAN", barangay: "POBLACION III",
    streetKey: "binay st ressurreccion st", classification: "RR",
    type: "vacant_lot", area: 100, saleContext: "private-resale" };
  const skipped = await F.compute(Object.assign({}, base, F.pickInputs(base)), EST);
  const answered = await F.compute(Object.assign({}, base, F.pickInputs(Object.assign({}, base, { shape: "0" }))), EST);
  const read = r => r.referenceModel.sections.filter(s => s.id === "lotShape")[0];
  assert.strictEqual(read(skipped).assessed, false);
  assert.strictEqual(read(skipped).bp, null);
  assert.strictEqual(read(answered).assessed, true);
  assert.strictEqual(read(answered).bp, 0, "an answered zero is scored zero, not skipped");
  assert.strictEqual(skipped.total, answered.total, "but the number is the same");
  assert.notStrictEqual(skipped.assumptions.length, answered.assumptions.length);
});

check("netOf treats a skipped factor as no contribution, never as NaN", () => {
  /* Returns { net, clamped } so a caller printing the net can disclose the
     limit rather than absorbing the difference silently. */
  assert.ok(Number.isFinite(F.netOf({}, true).net));
  assert.strictEqual(F.netOf({}, true).net, 0);
  assert.strictEqual(F.netOf({}, true).clamped, false, "nothing to disclose at zero");
});

check("title, estate and occupancy are three separate factors", () => {
  const byId = id => F.FACTORS.filter(f => f.id === id)[0];
  assert.ok(byId("titleDoc"), "titleDoc");
  assert.ok(byId("inheritance"), "inheritance");
  assert.ok(byId("ownership"), "ownership");
});

check("title carries its own deductions, not the old conflated range", () => {
  const t = F.FACTORS.filter(f => f.id === "titleDoc")[0];
  assert.deepStrictEqual(t.options.map(o => o.bp), [0, -800, -1500]);
  assert.strictEqual(t.min, -1500, "the declared range follows the options");
});

check("pending estate and occupancy carry the published deductions", () => {
  const i = F.FACTORS.filter(f => f.id === "inheritance")[0];
  const o = F.FACTORS.filter(f => f.id === "ownership")[0];
  assert.deepStrictEqual(i.options.map(x => x.bp), [0, -1000]);
  assert.deepStrictEqual(o.options.map(x => x.bp), [0, -500, -1000, -2500]);
});

check("the building section is gone and no building net is published", async () => {
  assert.strictEqual(F.SEC_BUILDING, undefined, "the section constant is gone");
  const r = await F.compute(Object.assign({}, OPTS, F.pickInputs({})), EST);
  assert.strictEqual(r.referenceModel.buildingNet, null, "explicitly null, not a silent zero");
});

check("the nine questions never move the improvement", async () => {
  const clean = await F.compute(Object.assign({}, OPTS, F.pickInputs({})), EST);
  const worst = await F.compute(Object.assign({}, OPTS, F.pickInputs({
    shape: "-500", topography: "-800", frontage: "-100", access: "-200",
    flood: "floods_routinely", utilities: "existing_services",
    titled: "tax_declaration", estate_settled: "pending", occupancy: "informal_settlers"
  })), EST);
  assert.strictEqual(clean.improvement, worst.improvement, "the building is untouched");
  assert.ok(worst.landValue < clean.landValue, "the land moved down");
});

check("every question's own option values resolve through its factor", () => {
  /* The join that broke silently before: a question whose option values the
     factor table does not carry scores NaN and the report prints nothing. */
  F.QUESTIONS.forEach(q => {
    const f = F.FACTORS.filter(x => x.id === q.factorId)[0];
    assert.ok(f, q.id + " has a factor");
    f.options.forEach(opt => {
      const picked = F.pickInputs({ [q.input]: opt.value });
      assert.ok(!Number.isNaN(F.factorBp(f, picked)),
        q.id + ' option "' + opt.value + '" is unresolvable');
    });
  });
});

check("no pricing field keeps the superseded model's number", async () => {
  /* applyModel used to set r.total from the new model and leave r.value holding
     the estimator's pre-model figure, so any panel reading r.value reported a
     different number from the one on screen. */
  const r = await F.compute(Object.assign({}, OPTS, F.pickInputs({})), EST);
  assert.strictEqual(r.value, r.total, "value tracks total");
  assert.strictEqual(r.marketGuide.value, r.total, "marketGuide tracks total");
  assert.strictEqual(r.marketGuide.landValue, r.landValue);
  assert.strictEqual(r.marketGuideEstimate, r.total, "public guide estimate agrees");
  assert.strictEqual(r.unadjustedTotal, r.total, "no hidden pre-factor total");
  assert.strictEqual(r.factors, null, "stale factor field stays suppressed");
  assert.strictEqual(r.factorStack, null);
  assert.strictEqual(r.appliedMultiple, null);
});

check("the range follows the single total, with the public estimator's band", async () => {
  /* 2026-11: the band is the public estimator's (measured for residential
     houses and lots, data/calibration.json range), applied to this guide's
     total; MODEL.RANGE_LOW/HIGH are only the fallback when none is in force. */
  const o = Object.assign({}, OPTS, F.pickInputs({}));
  const [r, s] = await Promise.all([F.compute(o, EST), EST.estimate(o)]);
  assert.strictEqual(r.rangeLowFactor, s.rangeLowFactor);
  assert.strictEqual(r.rangeHighFactor, s.rangeHighFactor);
  assert.strictEqual(r.rangeMethod, s.rangeMethod);
  assert.strictEqual(r.low, Math.round(r.total * r.rangeLowFactor));
  assert.strictEqual(r.high, Math.round(r.total * r.rangeHighFactor));
  assert.ok(r.low < r.total && r.total < r.high, "the band brackets the figure");
});

check("the estimator's own integrity check passes on our result", async () => {
  /* EST.core.integrityCheck requires total === landValue + improvement when
     ownershipAdjustmentPct is 0. It is the contract the whole result rests on. */
  const r = await F.compute(Object.assign({}, OPTS, F.pickInputs({ occupancy: "informal_settlers" })), EST);
  assert.strictEqual(r.ownershipAdjustmentPct, 0);
  assert.strictEqual(r.total, r.landValue + r.improvement);
  assert.strictEqual(EST.core.integrityCheck(r).ok, true, JSON.stringify(EST.core.integrityCheck(r)));
});

check("four classifications map to RR, CR, I and A50", () => {
  assert.deepStrictEqual(F.CLASSIFICATIONS.map(c => c.value), ["RR", "CR", "I", "A50"]);
  assert.deepStrictEqual(F.CLASSIFICATIONS.map(c => c.label),
    ["Residential", "Commercial", "Industrial", "Agricultural"]);
});

check("the classification picker reads the four, not all 35 codes", () => {
  /* The form used to enumerate every BIR code from ref.classifications (RR, CR,
     X, GP, A1..A50). It now renders vgClasses(), which maps over
     CLASSIFICATIONS. Asserting the render site rather than a browser DOM keeps
     this in the node suite; the e2e suite covers the rendered option list. */
  const src = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
  assert.ok(src.indexOf("vgClasses(), f.classification") >= 0,
    "the picker renders vgClasses() rather than every code");
  assert.ok(src.indexOf("classes.map(c => ({ value: c,") < 0,
    "the old all-codes enumeration is gone");
  assert.ok(src.indexOf("function vgClasses()") >= 0, "vgClasses is defined");
  const helper = src.split("function vgClasses()")[1].split("\n}")[0];
  assert.ok(helper.indexOf("CLASSIFICATIONS") >= 0, "it maps the four");
  assert.ok(helper.indexOf("ref.classifications") < 0, "it no longer walks every code");
});

check("a draft saved under the previous field names still resolves", () => {
  /* The questions renamed titleStatus -> titled and inheritanceStatus ->
     estate_settled. The option values never changed, so a saved answer is a
     rename. js/app.js:vgMigrateLegacy does it; this pins the values still match
     the factor table, which is what makes the rename safe. */
  const legacy = { occupancy: "tenants", titleStatus: "tax_declaration", inheritanceStatus: "pending" };
  const migrated = { occupancy: legacy.occupancy, titled: legacy.titleStatus, estate_settled: legacy.inheritanceStatus };
  const out = F.pickInputs(migrated);
  const bp = id => {
    const f = F.FACTORS.filter(x => x.id === id)[0];
    return F.factorBp(f, out);
  };
  assert.strictEqual(bp("ownership"), -1000, "occupancy still scores");
  assert.strictEqual(bp("titleDoc"), -1500, "title still scores");
  assert.strictEqual(bp("inheritance"), -1000, "estate still scores");
  /* Every legacy value in the old draft shape must exist as an option value. */
  const optionValues = id => F.FACTORS.filter(x => x.id === id)[0].options.map(o => o.value);
  assert.ok(optionValues("titleDoc").indexOf("tax_declaration") >= 0);
  assert.ok(optionValues("inheritance").indexOf("pending") >= 0);
  assert.ok(optionValues("ownership").indexOf("tenants") >= 0);
  /* The old field names must not be read as answers any more. */
  const stale = F.pickInputs(legacy);
  assert.ok(!("titleDoc" in stale), "an unmigrated draft does not silently score");
});

check("legacy and agricultural codes still resolve to a rate", async () => {
  /* X, GP, CL and the 29 agricultural sub-codes become unreachable from the form,
     but a saved draft may still carry one. It must price rather than fail. */
  for (const code of ["X", "GP", "CL", "A1", "A49", "A50"]) {
    const r = await F.compute(Object.assign({}, OPTS, F.pickInputs({}), { classification: code }), EST);
    assert.ok(r.available !== false, code + " resolves (" + (r.reason || "") + ")");
    assert.ok(r.total > 0, code + " produces a figure");
  }
});

check("the four offered codes each produce a distinct rate", async () => {
  const seen = {};
  for (const c of F.CLASSIFICATIONS) {
    const r = await F.compute(Object.assign({}, OPTS, F.pickInputs({}), { classification: c.value }), EST);
    assert.ok(r.available !== false, c.value + " resolves");
    seen[c.value] = r.birZonalRatePerSqm;
  }
  const rates = Object.values(seen);
  assert.strictEqual(new Set(rates).size, rates.length, "each class prices differently: " + JSON.stringify(seen));
});

check("the report states what the figure is derived from", async () => {
  const r = await F.compute(Object.assign({}, OPTS, F.pickInputs({})), EST);
  const html = F.reportSections(r, EST, []);
  assert.ok(html.indexOf("Derived from published BIR zonal values") >= 0, "the permitted claim is stated");
  assert.ok(html.indexOf("RA 9646") >= 0, "and it is not an appraisal under the Act");
  assert.ok(html.indexOf("LandValuePH") < 0, "the model is not named as the source of the number");
});

check("the report makes no market-price claim it cannot support", async () => {
  /* No Batangas listings exist, so there is no active-listing median and no
     verified sale behind any figure here. A report that said it matched the
     market would be making a claim the repo cannot evidence. */
  const r = await F.compute(Object.assign({}, OPTS, F.pickInputs({})), EST);
  const html = F.reportSections(r, EST, []).toLowerCase();
  ["market price", "market value", "fair market", "matches the market", "current asking"].forEach(phrase =>
    assert.ok(html.indexOf(phrase) < 0, 'report must not claim "' + phrase + '"'));
});

check("an empty comparables block says so in words", async () => {
  /* The listings API holds three records, all Caloocan. A blank section read as
     "we checked and there are none". */
  const r = await F.compute(Object.assign({}, OPTS, F.pickInputs({})), EST);
  const html = F.reportSections(r, EST, []);
  const block = html.split('data-vg-comparables')[1].split("</div>")[0];
  assert.ok(block.length > 0, "the block renders");
  assert.ok(/no (matching )?(batangas )?listings/i.test(block), "it says there are none: " + block.slice(0, 120));
});

check("the methodology names the rate it used", async () => {
  const r = await F.compute(Object.assign({}, OPTS, F.pickInputs({})), EST);
  const html = F.reportSections(r, EST, []);
  assert.ok(html.indexOf(String(r.referenceModel.rcnRate).replace(/\B(?=(\d{3})+(?!\d))/g, ",")) > 0,
    "the construction rate is printed, not implied");
});

check("step 2 renders one group per question, each option labelled with its bp", () => {
  /* The nine questions are rendered from QUESTIONS, not hand-listed, so a factor
     cannot be scored without a control to set it. Each option shows its own
     effect before the user picks it: the reference does this and a person who
     does not know what "estate settled" is worth needs it. */
  const src = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
  const stage2 = src.split("function vgStage2")[1].split("function vgReviewRows")[0];
  const groups = src.split("function vgQuestionGroups")[1].split("\n  }")[0];
  assert.ok(stage2.length > 0, "vgStage2 located");
  assert.ok(stage2.indexOf("vgQuestionGroups()") >= 0, "step 2 renders the question groups");
  assert.ok(groups.indexOf("QUESTIONS") >= 0, "which loop over QUESTIONS");
  assert.ok(groups.indexOf("data-vg-bp") >= 0, "each option carries its bp for display");
  assert.ok(groups.indexOf("data-vg-notsure") >= 0, "each group offers Not sure");
  assert.ok(groups.indexOf(".bp") >= 0, "the bp comes from the factor option");
  ["occupancy", "titleStatus", "inheritanceStatus"].forEach(k =>
    assert.ok(stage2.indexOf('data-vg-set=\\"' + k + '\\"') < 0, "the old hand-written " + k + " select is gone"));
  /* Not sure must delete rather than store a sentinel. */
  const handler = src.split('el.hasAttribute("data-vg-notsure")')[1].split("return; }")[0];
  assert.ok(handler.indexOf("delete draft.form[q.input]") >= 0,
    "the handler deletes the key: " + handler.replace(/\s+/g, " ").slice(0, 160));
  assert.ok(handler.indexOf("not_sure") < 0, "no sentinel value is stored");
});

check("the bp labels read from the factor, so they cannot drift from the model", () => {
  /* A label typed next to the control would be a second place to update. */
  const src = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
  const stage = src.split("function vgStage2")[1].split("function vgReviewRows")[0];
  const bpCall = stage.split("data-vg-bp=")[1];
  assert.ok(bpCall.indexOf("factorBp") >= 0 || bpCall.indexOf(".bp") >= 0,
    "the rendered bp comes from the factor option, not a literal in the markup");
  assert.ok(!/data-vg-bp="-?\d+"/.test(stage), "no hard-coded bp in the markup");
});

check("step 1 offers the reference's optional sale-stage group", () => {
  const src = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
  const stage = src.split("function vgStage1")[1].split("function vgStage2")[0];
  assert.ok(stage.indexOf("data-vg-stage1-stage") >= 0, "the group renders");
  ["just_checking", "ready_to_sell", "already_listed", "have_a_buyer"].forEach(k =>
    assert.ok(stage.indexOf('value: "' + k + '"') >= 0, k + " offered"));
  assert.ok(stage.indexOf("Optional") >= 0, "and it is marked optional");
});

check("the nine questions are all reachable from a saved draft", () => {
  /* Not sure must leave the key unset rather than store a sentinel, otherwise
     "skipped" and "answered zero" are the same value again. */
  const out = F.pickInputs({ shape: "", titled: "", occupancy: "" });
  ["lotShape", "titleDoc", "ownership"].forEach(k =>
    assert.ok(!(k in out), k + " absent when the user skips"));
  /* Only the answerable questions read unassessed. cornerExposure is answered by
     an unticked box, so it scores zero; zonalRecency needs a schedule date. */
  const rows = F.sectionsOf(out);
  const unassessed = rows.filter(s => !s.assessed).map(s => s.id);
  ["lotShape", "terrain", "frontage", "roadAccess", "floodRisk", "infrastructure",
    "titleDoc", "inheritance", "ownership", "zonalRecency"].forEach(id =>
    assert.ok(unassessed.indexOf(id) >= 0, id + " unassessed when skipped"));
  assert.strictEqual(rows.filter(s => s.id === "cornerExposure")[0].assessed, true,
    "corner is an answer, not a skip");
});

check("net cap and floor are symmetric", () => {
  assert.strictEqual(F.MODEL.NET_FLOOR, -0.15);
  assert.strictEqual(F.MODEL.NET_CAP, 0.15);
});

/* Every option value below is read out of the factor table rather than typed, so
   this cannot silently stop exercising a factor. It previously used
   flood: "floods_routinely" and utilities: "existing_services", neither of which
   is an option value - both resolved to NaN and were skipped, so Review Focus 3
   was covered by six of nine factors. */
function worstCase(questionId) {
  const f = F.FACTORS.filter(x => x.id === F.QUESTIONS.filter(q => q.id === questionId)[0].factorId)[0];
  return f.options.reduce((a, b) => (b.bp < a.bp ? b : a));
}
check("every question can be answered at its worst", () => {
  F.QUESTIONS.forEach(q => {
    const f = F.FACTORS.filter(x => x.id === q.factorId)[0];
    const out = F.pickInputs({ [q.input]: worstCase(q.id).value });
    assert.ok(!Number.isNaN(F.factorBp(f, out)), q.id + " worst option resolves");
  });
});

check("corner exposure is answered by leaving it unticked, not skipped", () => {
  /* An unticked corner box is an answer: the property is not on a corner. */
  const rows = F.sectionsOf({}).filter(s => s.id === "cornerExposure");
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].assessed, true, "corner is assessed either way");
  assert.strictEqual(rows[0].bp, 0, "unticked scores its own zero");
});

check("zonalRecency is derived from the schedule date, not asked", async () => {
  /* Spec decision 6: the BIR schedule date is a fact about the source, so it is
     looked up. A current schedule scores 0, a stale one a deduction. */
  const recent = await F.compute(Object.assign({}, OPTS, F.pickInputs({}), { effectivityDate: "2026-01-01" }), EST);
  const stale = await F.compute(Object.assign({}, OPTS, F.pickInputs({}), { effectivityDate: "2020-01-01" }), EST);
  const read = r => r.referenceModel.sections.filter(s => s.id === "zonalRecency")[0];
  assert.strictEqual(read(recent).assessed, true, "a current schedule is assessed");
  assert.strictEqual(read(recent).bp, 0);
  assert.strictEqual(read(stale).assessed, true, "a stale schedule is assessed too");
  assert.strictEqual(read(stale).bp, -200, "materially stale costs 200 bp");
  assert.ok(stale.total < recent.total, "and it moves the figure");
  const none = await F.compute(Object.assign({}, OPTS, F.pickInputs({})), EST);
  assert.strictEqual(read(none).assessed, false, "no date means unassessed, not assumed current");
});

check("a report where nothing was skipped has an empty assumptions list", async () => {
  /* With all ten answered and a schedule date present, nothing should be
     reported unassessed. This is what a permanently-unassessed factor breaks. */
  const r = await F.compute(Object.assign({}, OPTS, F.pickInputs({
    shape: "0", topography: "0", elevation: "0", frontage: "0", access: "0", flood: "0",
    utilities: "0", titled: "titled_self", estate_settled: "settled",
    occupancy: "empty", corner: false
  }), { effectivityDate: "2026-06-01" }), EST);
  assert.deepStrictEqual(r.assumptions, [], "nothing reported unassessed");
  assert.strictEqual(r.referenceModel.skippedCount, 0);
});

check("a clamped net says so rather than silently absorbing the difference", async () => {
  /* Title "tax declaration only" alone is -15%, exactly the floor, so any second
     adverse answer is dropped. The report has to disclose it or its own table
     does not reconcile with its own total. */
  const clamped = await F.compute(Object.assign({}, OPTS, F.pickInputs({
    titled: "tax_declaration", occupancy: "informal_settlers"
  })), EST);
  assert.strictEqual(clamped.referenceModel.netClamped, true, "the clamp is reported");
  assert.strictEqual(clamped.referenceModel.net, F.MODEL.NET_FLOOR);
  const html = F.reportSections(clamped, EST, []);
  assert.ok(/limit/i.test(html), "the rendered report mentions the limit");
  const clean = await F.compute(Object.assign({}, OPTS, F.pickInputs({})), EST);
  assert.strictEqual(clean.referenceModel.netClamped, false, "and stays silent when it does not bind");
});

check("every answer at its worst clamps to the floor and stays positive", async () => {
  const worst = await F.compute(Object.assign({}, OPTS, F.pickInputs({
    shape: "-500", topography: "-800", frontage: "-100", access: "-200",
    flood: "floods_routinely", utilities: "existing_services",
    titled: "tax_declaration", estate_settled: "pending", occupancy: "informal_settlers",
    zonalRecency: "-200", corner: true
  })), EST);
  assert.strictEqual(worst.referenceModel.net, F.MODEL.NET_FLOOR, "clamped, not merely negative");
  assert.ok(worst.landValue > 0, "land value stays positive");
  assert.ok(worst.total > 0, "total stays positive");
});

check("the best possible answers reach the cap without exceeding it", async () => {
  const best = await F.compute(Object.assign({}, OPTS, F.pickInputs({
    shape: "0", topography: "0", frontage: "150", access: "200",
    flood: "0", utilities: "200", titled: "titled_self",
    estate_settled: "settled", occupancy: "empty", zonalRecency: "0", corner: true
  })), EST);
  assert.ok(best.referenceModel.net <= F.MODEL.NET_CAP, "never above the cap");
  assert.ok(best.referenceModel.net > 0, "the good answers do lift the value");
});

check("an option outside its declared range is clamped to it", () => {
  /* Declared min/max were never enforced at runtime before, so a bad edit to the
     table would silently exceed the published range. */
  const f = { input: "x", min: -200, max: 200, options: [{ value: "a", bp: -9999 }] };
  assert.strictEqual(F.clampBp(f, -9999), -200);
  assert.strictEqual(F.clampBp(f, 9999), 200);
  assert.strictEqual(F.clampBp(f, 50), 50);
});

check("net stays inside every factor's declared range", () => {
  F.FACTORS.forEach(f => f.options.forEach(o =>
    assert.ok(o.bp >= f.min && o.bp <= f.max, f.id + " option " + o.value + " outside its range")));
});

check("no ownership deduction reaches ownershipAdjustmentPct", async () => {
  const r = await F.compute(Object.assign({}, OPTS, F.pickInputs({
    occupancy: "informal_settlers", titled: "tax_declaration", estate_settled: "pending"
  })), EST);
  const read = s => r.referenceModel.sections.filter(x => x.id === s)[0];
  assert.strictEqual(read("titleDoc").bp, -1500);
  assert.strictEqual(read("inheritance").bp, -1000);
  assert.strictEqual(read("ownership").bp, -2500);
  assert.strictEqual(r.ownershipAdjustmentPct, 0, "that field stays neutral by design");
  assert.ok(r.total < (await F.compute(Object.assign({}, OPTS, F.pickInputs({})), EST)).total,
    "but the answers do move the number");
});

console.log("ALL GREEN (" + count + " checks)");
})().catch(error => { console.error(error); process.exitCode = 1; });