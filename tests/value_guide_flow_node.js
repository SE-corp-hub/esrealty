"use strict";
/* Reference-model tests for the 3-step Value Guide.
 *
 * The golden fixture is the Bauan Poblacion III street already asserted by
 * tests/value_guide_reference_node.js:22 (RR class -> 11,500/sqm). The expected
 * totals are fixed by docs/specs/value-guide-3-step.md and must not be retuned
 * to make a code change pass. */
const assert = require("assert"), fs = require("fs"), path = require("path");
const ROOT = process.cwd();
/* Node's fetch() rejects the relative URLs the estimator loads from. Same shim
   tests/value_guide_tax_node.js uses. */
global.fetch = (u) => {
  const p = path.join(ROOT, String(u).split("?")[0]);
  return Promise.resolve({ ok: fs.existsSync(p), json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, "utf8"))) });
};
const EST = require(path.join(ROOT, "js/estimator.js"));

let count = 0;
async function check(name, fn) { await fn(); count++; console.log("[PASS] " + name); }

const OPTS = {
  municipality: "BAUAN", barangay: "POBLACION III",
  streetKey: "binay st ressurreccion st", classification: "RR",
  type: "house_lot", area: 100, floorArea: 120, construction: "mixed_chb",
  floors: "2", ageBand: "6-10", corner: false, features: [],
  landMethod: "factor", saleContext: "private-resale",
  /* zonalRecency is derived from this rather than answered (spec decision 6),
     so the fixture supplies the date the way js/app.js does. Bauan's schedule
     reads 2022-07-23, which is past the three-year window, so it scores -200. */
  effectivityDate: "2022-07-23",
  /* The one answered question: a paved barangay road at +50 bp. */
  roadAccess: "50",
  /* The test suite's clock would make this date's bucket move as time passes, so
     the recency expectation is asserted against the derivation rather than a
     frozen number in the "derived recency follows the schedule date" check. */
  _recencyNote: "2022-07-23 is over three years before 2026, so it scores -100 bp: stale, not materially stale."
};
const VACANT = Object.assign({}, OPTS, { type: "vacant_lot", floorArea: 0 });

const flow = () => require("../js/value_guide_flow.js");

/* pdf-lib writes <hex> Tj; inflate first. Same shape as
   tests/value_guide_reference_node.js:11-20. */
function pdfText(bytes) {
  const buffer = Buffer.from(bytes), text = [];
  for (let at = 0; (at = buffer.indexOf("stream", at)) >= 0;) {
    let start = at + 6; if (buffer[start] === 13) start++; if (buffer[start] === 10) start++;
    const end = buffer.indexOf("endstream", start); if (end < 0) break;
    try {
      const ops = require("zlib").inflateSync(buffer.subarray(start, end)).toString("latin1");
      for (const match of ops.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) text.push(Buffer.from(match[1], "hex").toString("latin1"));
    } catch (_) {}
    at = end + 9;
  }
  return text.join(" ");
}

(async () => {
  /* ---- 1. golden house-and-lot ---------------------------------------- */
  await check("golden house-and-lot fixture", async () => {
    const r = await flow().compute(OPTS, EST);
    assert.strictEqual(r.birZonalRatePerSqm, 11500, "BIR rate unchanged");
    assert.strictEqual(r.birZonalValue, 1150000, "BIR value unchanged");
    /* 2026-10-14: land = public estimator land 2,352,500 (BIR x ramped band
       2.0457) x (1 + net -0.5%); building = 16,000 x 120 x (1 - 8/40). */
    assert.strictEqual(r.landValue, 2340738);
    assert.strictEqual(r.improvement, 1536000);
    assert.strictEqual(r.total, 3876738);
    assert.strictEqual(r.low, 3295227);
    assert.strictEqual(r.high, 5039759);
    assert.strictEqual(r.perSqm, 38767);
  });

  /* ---- 2. vacant-lot vector ------------------------------------------- */
  await check("vacant-lot vector carries no improvement", async () => {
    const r = await flow().compute(VACANT, EST);
    assert.strictEqual(r.improvement, 0);
    assert.strictEqual(r.total, 2340738);
    assert.strictEqual(r.low, 1989627);
    assert.strictEqual(r.high, 3042959);
    assert.strictEqual(r.perSqm, 23407);
  });

  /* ---- 3. the model constants ---------------------------------------- */
  await check("construction rates come from the shared config, not the guide", () => {
    const F = flow();
    assert.strictEqual(F.MODEL.RCN, undefined, "the guide has its own rate table again");
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "data/zonal-config.json"), "utf8"));
    assert.strictEqual(cfg.construction.mixed_chb.costPerSqm, 16000);
    assert.strictEqual(cfg.construction.wood_prefab.costPerSqm, 11000);
    assert.strictEqual(cfg.construction.rca_steel.costPerSqm, 22000);
    assert.strictEqual(F.MODEL.valuationYear, undefined, "no valuation year");
    assert.ok(!/1\.02/.test(fs.readFileSync(path.join(ROOT, "js/value_guide_flow.js"), "utf8")), "no escalation factor in source");
  });
  await check("the 1.174 market indicator is retired", () =>
    assert.strictEqual(flow().MODEL.MARKET_IND, undefined));
  await check("range band is 0.85 / 1.30", () => {
    assert.strictEqual(flow().MODEL.RANGE_LOW, 0.85);
    assert.strictEqual(flow().MODEL.RANGE_HIGH, 1.30);
  });
  await check("depreciation cap matches the shared config (0.95 on a 40-year life)", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "data/zonal-config.json"), "utf8"));
    assert.strictEqual(flow().MODEL.DEP_CAP, cfg.depreciation.maxPct);
    assert.strictEqual(cfg.depreciation.lifeYears, 40);
  });
  await check("twelve surviving factors, each with a section", () => {
    const F = flow();
    /* Ten questions (the reference splits slope from elevation-vs-road) plus
       cornerExposure plus the derived zonalRecency. */
    assert.strictEqual(F.QUESTIONS.length, 10);
    assert.strictEqual(F.FACTORS.length, 12);
    F.FACTORS.forEach(f => assert.ok(f.section && f.options && f.options.length, f.id));
  });

  /* ---- 4. rules ------------------------------------------------------- */
  await check("no ownership adjustment", async () =>
    assert.strictEqual((await flow().compute(OPTS, EST)).ownershipAdjustmentPct, 0));

  await check("the oldest band depreciates 35/40 = 87.5%", async () => {
    const r = await flow().compute(Object.assign({}, OPTS, { ageBand: "31plus" }), EST);
    assert.strictEqual(r.depreciatedPct, 87.5);
    assert.strictEqual(r.improvement, 120 * 16000 * 0.125);
  });

  await check("the youngest band barely depreciates", async () => {
    const r = await flow().compute(Object.assign({}, OPTS, { ageBand: "0-5" }), EST);
    assert.strictEqual(r.depreciatedPct, 6.25);
    assert.strictEqual(r.improvement, Math.round(120 * 16000 * (1 - 0.0625)));
  });

  await check("integrity check passes on the produced result", async () => {
    const r = await flow().compute(OPTS, EST);
    assert.ok(r.integrity && r.integrity.ok, JSON.stringify(r.integrity));
  });

  await check("an unavailable estimate passes through untouched", async () => {
    const r = await flow().compute(Object.assign({}, OPTS, { area: 0 }), EST);
    assert.strictEqual(r.available, false);
    assert.strictEqual(r.reason, "no-area");
  });

  await check("the BIR figure is never blended into the estimate", async () => {
    const r = await flow().compute(OPTS, EST);
    assert.strictEqual(r.birZonalValue, 1150000);
    assert.strictEqual(r.taxReferenceValue, 1150000);
    assert.notStrictEqual(r.total, r.birZonalValue);
  });

  /* ---- 5. no building-section split ------------------------------------
     Every surviving factor is a land or ownership characteristic, so there is one
     net and it applies to the land. The building is priced by cost approach and
     no question may move it. */
  await check("no factor can move the building", async () => {
    const a = await flow().compute(OPTS, EST);
    const b = await flow().compute(Object.assign({}, OPTS, {
      lotShape: "-500", terrain: "-800", frontage: "-100", roadAccess: "-200",
      floodRisk: "-500", infrastructure: "0", titleDoc: "tax_declaration",
      inheritance: "pending", ownership: "informal_settlers", zonalRecency: "-200"
    }), EST);
    assert.strictEqual(b.improvement, a.improvement, "the building is untouched");
    assert.ok(b.landValue < a.landValue, "the land moved");
  });

  await check("the land net never touches the building component", async () => {
    const r = await flow().compute(OPTS, EST);
    assert.strictEqual(r.improvement, 1536000);
  });

  /* ---- 6. additive net ------------------------------------------------ */
  await check("net is additive, not compounded", async () => {
    const F = flow();
    /* A current schedule date each time, so the derived recency factor contributes
       nothing and only the two answered questions are in play. */
    const CUR = { effectivityDate: "2026-06-01" };
    const zero = await F.compute(Object.assign({}, VACANT, CUR, { roadAccess: "", infrastructure: "" }), EST);
    const one  = await F.compute(Object.assign({}, VACANT, CUR, { roadAccess: "50", infrastructure: "" }), EST);
    const two  = await F.compute(Object.assign({}, VACANT, CUR, { roadAccess: "50", infrastructure: "50" }), EST);
    assert.strictEqual(zero.referenceModel.net, 0);
    assert.strictEqual(one.referenceModel.net, 0.005);
    assert.strictEqual(two.referenceModel.net, 0.01, "50bp + 50bp = 100bp, not 1.05 x 1.05");
    const compounded = 1.005 * 1.005;
    assert.notStrictEqual(1 + two.referenceModel.net, compounded);
  });

  /* The golden fixture answers roadAccess +50 and carries the 2022-07-23 schedule
     date js/app.js passes, which derives zonalRecency -100 (between one and two
     years old, not yet "materially stale"), for -50 bp overall. Both surviving
     factors are land-bound, so the building figure is unchanged at 1536000 -
     which is the proof the building was never in the net. */
  await check("the golden fixture lands on the net of -50 bp", async () => {
    const r = await flow().compute(OPTS, EST);
    assert.strictEqual(r.referenceModel.net, -0.005);
    assert.strictEqual(r.referenceModel.netClamped, false);
    const scored = r.referenceModel.sections.filter(s => s.assessed).map(s => s.id);
    assert.deepStrictEqual(scored.sort(), ["cornerExposure", "roadAccess", "zonalRecency"],
      "the answered question, the unticked corner box, and the derived schedule");
  });

  await check("the derived recency follows the schedule date, not the fixture", async () => {
    const F = flow();
    const fresh = await F.compute(Object.assign({}, OPTS, { effectivityDate: "2026-06-01" }), EST);
    const stale = await F.compute(Object.assign({}, OPTS, { effectivityDate: "2019-01-01" }), EST);
    const none = await F.compute(Object.assign({}, OPTS, { effectivityDate: null }), EST);
    const read = r => r.referenceModel.sections.filter(s => s.id === "zonalRecency")[0];
    assert.strictEqual(read(fresh).bp, 0, "a current schedule scores zero");
    assert.strictEqual(read(stale).bp, -200, "a materially stale one scores -200");
    assert.strictEqual(read(none).assessed, false, "an undated schedule is unassessed");
    assert.strictEqual(read(none).bp, null, "and prints nothing rather than assuming zero");
  });

  await check("net stays inside every published factor range", async () => {
    const F = flow();
    F.FACTORS.forEach(f => f.options.forEach(o => {
      assert.ok(o.bp >= f.min && o.bp <= f.max, f.id + " option " + o.value + " outside published range");
    }));
  });

  /* ---- 7. the model is named ------------------------------------------ */
  await check("the result names its model", async () => {
    const r = await flow().compute(OPTS, EST);
    assert.strictEqual(r.referenceModel.name, "SEA ESTATES factor model");
    assert.ok(Math.abs(r.referenceModel.marketInd - 2.0457) < 1e-3, "marketInd is the ramped band for Binay St");
    assert.strictEqual(r.appliedMultiple, null, "stale public multiple suppressed");
    assert.strictEqual(r.factorStack, null);
  });

  /* ---- 8. the wizard shape ------------------------------------------- */
  await check("wizard has exactly three stages", () => {
    const APP = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
    const m = APP.match(/const VG_STAGES = \[([\s\S]*?)\];/);
    assert.ok(m, "VG_STAGES still present");
    assert.strictEqual((m[1].match(/\{ n:/g) || []).length, 3);
    assert.ok(/Location/.test(m[1]) && /Details/.test(m[1]) && /Report/.test(m[1]));
  });

  await check("calculate routes through the flow module", () => {
    const APP = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
    assert.ok(/ESREALTY_VG_FLOW/.test(APP), "flow module referenced");
    assert.ok(!/vgEst\(\)\.estimate\(vgOpts\(\)\)/.test(APP), "raw estimate() call removed");
  });

  await check("old stage helpers are gone", () => {
    const APP = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
    ["function vgStage4", "vgUnavailableReason", "vgAboutGroup", "vgDisclosure"].forEach(n =>
      assert.ok(APP.indexOf(n) < 0, n + " should be deleted"));
  });

  await check("index.html loads the flow module before the bundle", () => {
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const i = html.indexOf("js/value_guide_flow.js"), j = html.indexOf("js/app.min.js");
    assert.ok(i > 0 && j > 0 && i < j, "script order: flow at " + i + ", bundle at " + j);
  });

  /* ---- 9. report sections -------------------------------------------- */
  await check("report names its model verbatim", async () => {
    const F = flow();
    const r = await F.compute(OPTS, EST);
    const html = F.reportSections(r, EST, []);
    /* The callout now leads with what the figure is derived from rather than naming
       the reference tool, which is a competitor and not the source of the number. */
    assert.strictEqual(html.indexOf("Derived from published BIR zonal values"), 0, "callout is first");
    assert.ok(html.indexOf("same SEA ESTATES factor model as the public site calculator") > 0, "says both surfaces share the model");
    assert.ok(html.indexOf("2.14x") < 0, "the retired divergence figure is gone");
    assert.ok(html.indexOf("not a real estate appraisal under RA 9646") > 0, "closes the caveat");
    assert.ok(html.indexOf("LandValuePH") < 0, "a competitor is not named as the source of the figure");
  });

  await check("comparables block renders even when empty", async () => {
    const F = flow();
    const r = await F.compute(OPTS, EST);
    const html = F.reportSections(r, EST, []);
    assert.ok(html.indexOf("data-vg-comparables") > 0, "block present");
    /* The catalog holds three records, all Caloocan, so this is the normal path.
       It has to say the absence rather than read as a blank section. */
    assert.ok(html.indexOf("No Batangas listings") > 0, "empty state stated");
    assert.ok(html.indexOf("completed sales") > 0, "and says nothing was checked against sales");
  });

  await check("comparables never move the numbers", async () => {
    const F = flow();
    const a = await F.compute(OPTS, EST);
    const b = Object.assign({}, a);
    b.comparableSummary = { count: 5, medianPricePerSqm: 99999, askingIndication: { value: 1 } };
    F.applyComparables(b, [{ price: 999999999 }], EST);
    assert.strictEqual(b.total, a.total, "total frozen");
    assert.strictEqual(b.low, a.low, "low frozen");
    assert.strictEqual(b.high, a.high, "high frozen");
    assert.strictEqual(b.perSqm, a.perSqm, "per-sqm frozen");
    assert.strictEqual(b.landValue, a.landValue, "land frozen");
    assert.strictEqual(b.improvement, a.improvement, "improvement frozen");
    assert.ok(b.comparableSummary, "a summary is still attached");
    assert.strictEqual(b.comparableListingCount, 1, "listing count recorded");
  });

  await check("methodology prints every factor row and the applied net", async () => {
    const F = flow();
    const r = await F.compute(OPTS, EST);
    const html = F.reportSections(r, EST, []);
    assert.strictEqual((html.match(/data-vf=/g) || []).length, F.FACTORS.length, "one row per factor");
    /* Read the net off the model rather than hard-coding a string: this fixture's
       net depends on the derived recency factor, which moves as the clock does. */
    assert.ok(html.indexOf((r.referenceModel.net * 100).toFixed(2) + "%") > 0, "applied net printed");
    F.FACTORS.forEach(f => assert.ok(html.indexOf('data-vf="' + f.id + '"') > 0, f.id + " row"));
  });

  /* The 0.00% defect in its original form: a row the user never answered used to
     print 0.00%, which read as "checked, nothing found". */
  await check("an unanswered factor prints Not assessed, never 0.00%", async () => {
    const F = flow();
    const r = await F.compute(OPTS, EST);
    const html = F.reportSections(r, EST, []);
    const unassessed = r.referenceModel.sections.filter(s => !s.assessed);
    assert.ok(unassessed.length > 0, "the golden fixture leaves questions open");
    unassessed.forEach(s => {
      const row = html.split('data-vf="' + s.id + '"')[1].split("</tr>")[0];
      assert.ok(row.indexOf("Not assessed") > 0, s.id + " reads Not assessed");
      assert.ok(row.indexOf("0.00%") < 0, s.id + " does not fake a zero");
      assert.ok(html.indexOf('data-vf-unassessed') > 0, "the row is marked for the PDF path");
    });
    assert.ok(html.indexOf("What we didn&#39;t check") > 0 || html.indexOf("What we didn't check") > 0,
      "the skipped questions are listed by name");
    assert.ok(html.indexOf("on land.") > 0, "the net is stated as land-only");
  });

  await check("loadComparables degrades to an empty list in Node", async () => {
    const rows = await flow().loadComparables(OPTS, EST);
    assert.ok(Array.isArray(rows), "always an array");
    assert.strictEqual(rows.length, 0, "no listings API here");
  });

  /* ---- 10. PDF sections ------------------------------------------------ */
  await check("PDF carries the model name and the construction disclosure", async () => {
    const PDFLib = require(path.join(ROOT, "vendor/pdf-lib/pdf-lib.min.js"));
    const PDF = require(path.join(ROOT, "js/value_guide_pdf.js"));
    const r = await flow().compute(OPTS, EST);
    const blob = await PDF.toBlob(PDFLib, r, { preparedFor: "3-step flow", preparedBy: "SEA ESTATES", generatedOn: "2026-10-06" });
    const text = pdfText(await blob.arrayBuffer());
    /* Spec decision 1 and the ledger ruling: a competitor is not named as the
       source of the figure in a customer document. The permitted claim is. */
    assert.ok(text.indexOf("Derived from published BIR zonal values") >= 0, "the permitted claim is stated");
    assert.ok(text.indexOf("RA 9646") >= 0, "and it is not an appraisal under the Act");
    assert.ok(text.indexOf("LandValuePH") < 0, "no reference branding in the PDF");
    assert.ok(text.indexOf("twelve") < 0, "the stale factor count is gone: " + text.match(/\w+ published \w+/));
    assert.ok(text.indexOf("16,000") >= 0, "construction rate shown");
    assert.ok(text.indexOf("replacement-cost rate") >= 0, "rate named as a replacement cost, not a price");
    assert.ok(text.indexOf("SEA ESTATES market band factor") < 0, "stale factor label gone");
  });

  await check("PDF gains model, methodology, construction and comparables parts", async () => {
    const PDF = require(path.join(ROOT, "js/value_guide_pdf.js"));
    const keys = PDF.PARTS.map(p => p.key);
    ["model", "methodology", "construction", "comparables"].forEach(k =>
      assert.ok(keys.indexOf(k) >= 0, "part " + k + " present"));
    assert.strictEqual(keys.slice(0, 6).join(","),
      "summary,computation,tax,market,documents,negotiation", "existing six untouched");
    assert.strictEqual(keys.length, PDF.PARTS.length, "no duplicate keys");
    PDF.PARTS.forEach((p, i) => assert.strictEqual(p.no, String(i + 1).padStart(2, "0"), p.key + " numbered in order"));
  });

  console.log("ALL GREEN (" + count + " checks)");
})().catch(error => { console.error(error); process.exitCode = 1; });
