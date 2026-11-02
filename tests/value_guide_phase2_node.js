"use strict";
/* Accuracy plan Phases 2 and 3 (2026-11-01): every result says how it was
 * checked (the monthly bank check, or a low-evidence mark for farm,
 * industrial and commercial land), until when it holds (bank data date plus
 * 90 days), and where to check hazards (HazardHunterPH, with a Taal 14-km
 * note for the towns inside it); a reviewed town trend is shown for context
 * only; closed Value Guide deals record a final sale price and the back
 * office keeps the ledger; the monthly run writes trend proposals.
 *
 * tests/value_guide_phase1_node.js covers the model re-fit these sit on. */
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os");
const ROOT = process.cwd();
global.fetch = (u) => {
  const p = path.join(ROOT, String(u).split("?")[0]);
  return Promise.resolve({ ok: fs.existsSync(p), json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, "utf8"))) });
};
const EST = require(path.join(ROOT, "js/estimator.js"));
const FLOW = require(path.join(ROOT, "js/value_guide_flow.js"));
const ATTR = require(path.join(ROOT, "js/attribution.js"));
const TREND = require(path.join(ROOT, "market-scan/comparables/trend.js"));
const TAX = require(path.join(ROOT, "js/value_guide_tax.js"));
const PDF = require(path.join(ROOT, "js/value_guide_pdf.js"));
const PDFLib = require(path.join(ROOT, "vendor/pdf-lib/pdf-lib.min.js"));
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const SNAP = read("data/comparables/batangas-latest.json"), ACC = read("data/comparables/accuracy-latest.json");
const ESTSRC = fs.readFileSync(path.join(ROOT, "js/estimator.js"), "utf8");
const APPSRC = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
const PDFSRC = fs.readFileSync(path.join(ROOT, "js/value_guide_pdf.js"), "utf8");

let n = 0;
function ok(name, cond, detail) {
  if (!cond) { console.log("[FAIL] " + name + (detail != null ? " -- " + detail : "")); process.exit(1); }
  n++; console.log("[PASS] " + name);
}
const plusDays = (iso, d) => { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

/* pdf-lib writes <hex> Tj; inflate first (same shape as value_guide_flow_node). */
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

const HOUSE = { purpose: "Selling", type: "house_lot", municipality: "BAUAN", barangay: "POBLACION III", streetKey: "binay st ressurreccion st",
  classification: "RR", area: 100, landMethod: "factor", saleContext: "private-resale", floorArea: 120, floors: "2", ageBand: "6-10", construction: "mixed_chb", features: [] };
const FARM = { purpose: "Selling", type: "vacant_lot", municipality: "LIPA CITY", barangay: "DAGATAN", streetKey: "", classification: "A50", area: 5000, landMethod: "factor", saleContext: "private-resale" };
const INDUSTRIAL = { purpose: "Selling", type: "vacant_lot", municipality: "BATANGAS CITY", barangay: "ALANGILAN", streetKey: "", classification: "I", area: 2000, landMethod: "factor", saleContext: "private-resale" };

(async () => {
  const data = await EST.loadData();
  const core = EST.core, cfg = data.config, ev = cfg.evidence;

  /* ---- the evidence context compacted at load ---- */
  ok("the config carries the evidence context from the bank snapshot", ev && ev.month === SNAP.month && ev.date === SNAP.generatedOn && ev.records === SNAP.records.length, JSON.stringify(ev && { month: ev.month, date: ev.date, records: ev.records }));
  ok("every snapshot record is counted under one use", ev.counts.house_lot + ev.counts.vacant_lot + ev.counts.agricultural + ev.counts.industrial + ev.counts.commercial === SNAP.records.length, JSON.stringify(ev.counts));
  ok("houses and townhouses count as houses, the accuracy report's own count", ev.counts.house_lot === ACC.overall.house_lot.n, ev.counts.house_lot + " vs " + ACC.overall.house_lot.n);
  ok("the accuracy report rides along", ev.accuracy && ev.accuracy.calculationVersion === ACC.calculationVersion && ev.accuracy.house_lot.medianAbs === ACC.overall.house_lot.medianAbs);
  ok("a missing accuracy file or trend file leaves nulls, not a crash", (() => { const c = core.evidenceContext({ records: [] }, null, null, null); return c.accuracy === null && c.trend === null && c.records === 0 && c.date === ""; })());

  /* ---- validity: data date + 90 days ---- */
  const v = core.validity(cfg);
  ok("validity is the bank data date plus 90 days", v && v.days === 90 && v.dataDate === SNAP.generatedOn && v.reviewAfter === plusDays(SNAP.generatedOn, 90), JSON.stringify(v));
  ok("the validity sentence names the date and the data month", /until \d{4}-\d{2}-\d{2} \(bank and Pag-IBIG data of [A-Z][a-z]{2} \d{4} plus 90 days\); after that, run it again\./.test(v.text), v.text);
  ok("no snapshot, no validity (the report says nothing rather than inventing a date)", core.validity({}) === null && core.validity({ evidence: { month: "", date: "" } }) === null);

  /* ---- evidence level by use ---- */
  const eh = core.evidenceLevel(cfg, "residential", "house_lot"), el = core.evidenceLevel(cfg, "residential", "vacant_lot");
  ok("residential houses are checked monthly, with the report's own numbers", eh.level === "checked" && eh.records === ACC.overall.house_lot.n && eh.projects === ACC.overall.house_lot.projects && eh.medianAbs === ACC.overall.house_lot.medianAbs && eh.inBand === ACC.overall.house_lot.inBand, JSON.stringify(eh));
  ok("the sentence states the typical miss and the share inside the range", new RegExp("^Monthly check \\(" + "[A-Z][a-z]{2} \\d{4}" + "\\): houses were typically within " + Math.round(eh.medianAbs * 100) + "% of bank and Pag-IBIG prices, and " + Math.round(eh.inBand * 100) + "% of those prices fell inside the guide's range \\(" + eh.records.toLocaleString("en-US") + " prices, " + eh.projects + " developments\\)\\.$").test(eh.text), eh.text);
  ok("the short form drops the counts", eh.shortText.length < eh.text.length && !/prices, \d+ developments/.test(eh.shortText), eh.shortText);
  ok("residential lots are checked too", el.level === "checked" && el.records === ACC.overall.vacant_lot.n && /lots were typically/.test(el.text));
  const ea = core.evidenceLevel(cfg, "agricultural", "vacant_lot"), ei = core.evidenceLevel(cfg, "industrial", "vacant_lot"), ec = core.evidenceLevel(cfg, "commercial", "vacant_lot");
  ok("farm land is low evidence until 20 farm prices exist", ea.level === "low" && ea.needed === 20 && ea.records === ev.counts.agricultural && /^Low evidence: the monthly bank check holds \d+ farm prices? \(20 needed\)/.test(ea.text), ea.text);
  ok("industrial land is low evidence until 10 industrial prices exist", ei.level === "low" && ei.needed === 10 && ei.records === ev.counts.industrial, JSON.stringify(ei));
  ok("commercial land is low evidence until 10 commercial prices exist", ec.level === "low" && ec.needed === 10, JSON.stringify(ec));
  ok("the low-evidence sentence points at an appraiser", /Treat it as a starting point for an appraiser\.$/.test(ea.text));
  const enough = core.evidenceLevel({ evidence: Object.assign({}, ev, { counts: Object.assign({}, ev.counts, { agricultural: 25 }) }) }, "agricultural", "vacant_lot");
  ok("with enough farm prices the mark becomes 'unmeasured' until the check covers that use", enough.level === "unmeasured" && /does not yet measure farm land/.test(enough.text), enough.text);
  ok("no accuracy report: residential is 'unchecked', never 'checked'", core.evidenceLevel({ evidence: Object.assign({}, ev, { accuracy: null }) }, "residential", "house_lot").level === "unchecked");

  /* ---- hazard ---- */
  ok("fourteen towns are inside Taal's 14-km radius, spelled as the index spells them", core.TAAL_14KM_TOWNS.length === 14 && core.TAAL_14KM_TOWNS.every(t => data.index.municipalities.some(m => m.name === t)), JSON.stringify(core.TAAL_14KM_TOWNS.filter(t => !data.index.municipalities.some(m => m.name === t))));
  const hl = core.hazardContext("LIPA CITY"), hb = core.hazardContext("BAUAN");
  ok("Lipa carries the Taal note, Bauan does not", hl.taalZone === true && /Parts of Lipa City lie within 14 km of Taal Volcano/.test(hl.note) && hb.taalZone === false && hb.note === "");
  ok("both point at HazardHunterPH and say no deduction is made", hl.url === "https://hazardhunter.georisk.gov.ph/" && /HazardHunterPH \(https:\/\/hazardhunter\.georisk\.gov\.ph\/\)/.test(hb.text) && /makes no deduction/.test(hl.note) && /not checked against the map/.test(hb.text));

  /* ---- trend: reviewed rows only ---- */
  const trendCfg = { evidence: Object.assign({}, ev, { trend: { generatedOn: "2027-02-01", towns: [
    { town: "LIPA CITY", kind: "built", status: "proposed", changePct: 0.08, months: 6 },
    { town: "LIPA CITY", kind: "vacant", status: "reviewed", changePct: -0.031, months: 9, from: "2026-11", to: "2027-08", reviewedBy: "Owner" }
  ] } }) };
  ok("a proposed trend row is never shown", core.trendFor(trendCfg, "LIPA CITY", "house_lot") === null);
  const tr = core.trendFor(trendCfg, "Lipa City", "vacant_lot");
  ok("a reviewed row is shown for context, with its reviewer, and says the figure is not indexed", tr && tr.changePct === -0.031 && tr.text === "Prices here: -3.1% over 9 months (bank and Pag-IBIG lot medians, Nov 2026 to Aug 2027, reviewed by Owner). Shown for context; the figure is not indexed by it.", tr && tr.text);
  ok("today's trend file has no reviewed row, so nothing is shown", core.trendFor(cfg, "LIPA CITY", "vacant_lot") === null && data.trend && data.trend.status === "insufficient-history");

  /* ---- the result carries them, on both surfaces ---- */
  const pub = await EST.estimate(HOUSE);
  ok("the public result carries validity, evidence and hazard", pub.available && pub.validity && pub.validity.reviewAfter === v.reviewAfter && pub.evidence.level === "checked" && pub.hazard && pub.hazard.taalZone === false && pub.trend === null);
  const office = await FLOW.compute(HOUSE, EST);
  ok("the back office carries the very same sentences", office.validity.text === pub.validity.text && office.evidence.text === pub.evidence.text && office.hazard.text === pub.hazard.text);
  const farm = await EST.estimate(FARM), ind = await EST.estimate(INDUSTRIAL);
  ok("a farm lot in Lipa is low evidence and inside the Taal radius", farm.available && farm.evidence.level === "low" && farm.evidence.needed === 20 && farm.hazard.taalZone === true, farm.reason);
  ok("an industrial lot is low evidence", ind.available && ind.evidence.level === "low" && ind.evidence.needed === 10, ind.reason);
  ok("the mark changes no number: the farm figure equals land value", farm.total === farm.landValue && farm.evidence.level === "low");

  /* ---- the public report prints them ---- */
  ok("the result summary prints the evidence line, the trend and the validity", /evidenceLinesHtml\(r\)/.test(ESTSRC) && /data-est-evidence="' \+ esc\(e\.level\)/.test(ESTSRC) && /data-est-trend>/.test(ESTSRC) && /data-est-valid>/.test(ESTSRC));
  ok("a low-evidence result is badged and boxed", /r\.evidence\.level === "low" \? "Low evidence · "/.test(ESTSRC) && /sf-est-result-lowev/.test(ESTSRC));
  ok("the data strip shows the bank data month and the review date", /<b>Bank data as of<\/b><small>' \+ esc\(monthLabel\(r\.validity\.dataMonth\)\) \+ ' · review after ' \+ esc\(r\.validity\.reviewAfter\)/.test(ESTSRC));
  ok("the full report repeats validity, the check and the hazard line", /data-est-valid-note/.test(ESTSRC) && /data-est-check-note/.test(ESTSRC) && /data-est-low-evidence-note/.test(ESTSRC) && /hazardHtml\(r\) \}\);/.test(ESTSRC));
  ok("the Surroundings questions carry the HazardHunterPH note", /"roadAccess"\),\n\s+hazardNoteHtml\(\)\n\s+\]\) \+/.test(ESTSRC) && /data-est-hazard-note/.test(ESTSRC));
  ok("the quick figure prints the short monthly check", /data-quick-check>' \+ esc\(r\.evidence\.shortText\)/.test(ESTSRC));

  /* ---- the PDF prints them ---- */
  const reference = EST.reference();
  const meta = { preparedFor: "phase 2 check", preparedBy: "SEA ESTATES", generatedOn: "2026-11-01", tax: await TAX.full(pub), provenance: EST.provenance(), muniRow: reference.index.municipalities.find(m => m.name === "BAUAN") };
  const text = pdfText(await (await PDF.toBlob(PDFLib, pub, meta)).arrayBuffer());
  ok("the PDF footer carries the review date", new RegExp("review after " + pub.validity.reviewAfter).test(text), text.slice(0, 200));
  ok("the PDF model table carries the bank data month and the review date", /Bank data month/.test(text) && /Review after/.test(text) && new RegExp(pub.validity.dataMonth.replace("-", "\\-")).test(text));
  ok("the PDF prints the monthly check sentence", /Monthly check \(/.test(text) && /of bank and Pag-IBIG prices/.test(text));
  ok("the PDF limitations point at HazardHunterPH", /HazardHunterPH/.test(text));
  const farmMeta = Object.assign({}, meta, { tax: await TAX.full(farm), muniRow: reference.index.municipalities.find(m => m.name === "LIPA CITY") });
  const farmText = pdfText(await (await PDF.toBlob(PDFLib, farm, farmMeta)).arrayBuffer());
  ok("a low-evidence PDF carries the mark and the Taal note", /Low evidence: the monthly bank check holds/.test(farmText) && /Taal Volcano/.test(farmText), farmText.slice(0, 120));
  ok("the PDF builds its lines from the result, not its own wording", /r\.evidence\.text/.test(PDFSRC) && /r\.validity\.text/.test(PDFSRC) && /r\.hazard\.text/.test(PDFSRC) && !/Monthly check \(/.test(PDFSRC));

  /* ---- the back office prints them, and keeps the sales ledger ---- */
  ok("the back-office result shows the check, the review date and a low-evidence banner", /data-vg-evidence="' \+ esc\(r\.evidence\.level\)/.test(APPSRC) && /data-vg-valid/.test(APPSRC) && /data-vg-low-evidence/.test(APPSRC) && /data-vg-hazard/.test(APPSRC) && /data-vg-trend/.test(APPSRC));
  ok("a closed Value Guide lead offers a final sale price to record", /function leadFinalPriceCard/.test(APPSRC) && /html \+= leadFinalPriceCard\(l, can\);/.test(APPSRC) && /data-lead-final-price-input/.test(APPSRC) && /l\.status !== "closed" && !l\.finalSalePrice\)\) return ""/.test(APPSRC));
  ok("saving it is logged on the lead and synced", /function leadRecordFinalPrice/.test(APPSRC) && /Final sale price recorded: /.test(APPSRC) && /l\.finalSaleOn = new Date\(\)\.toISOString\(\);\n\s+l\.updatedAt = l\.finalSaleOn;[\s\S]{0,600}syncLead\(l\);/.test(APPSRC) && /closest\("\[data-lead-final-price\]"\)/.test(APPSRC));
  ok("the Value Guide view ends with the guide-vs-sale ledger", /\+ vgAccuracyLedgerHtml\(\);\n  \}/.test(APPSRC) && /data-vg-ledger/.test(APPSRC));
  const acc = ATTR.guideAccuracy([
    { id: "a", name: "Ana", status: "closed", fullReport: { estimate: { marketGuideEstimate: 2000000 } }, finalSalePrice: 2100000, finalSaleOn: "2026-11-02T00:00:00Z" },
    { id: "b", name: "Ben", status: "closed", fullReport: { estimate: { marketGuideEstimate: 3000000 } }, finalSalePrice: 2700000, finalSaleOn: "2026-11-01T00:00:00Z" },
    { id: "c", name: "No price", status: "closed", fullReport: { estimate: { marketGuideEstimate: 3000000 } } },
    { id: "d", name: "No guide", status: "closed", finalSalePrice: 1000000 },
    { id: "e", name: "Bad", status: "closed", fullReport: { estimate: { marketGuideEstimate: 3000000 } }, finalSalePrice: -5 }
  ]);
  ok("the ledger counts only leads with both a guide and a positive final price, newest first", acc.n === 2 && acc.rows.map(r => r.id).join() === "a,b", JSON.stringify(acc));
  ok("error = sale / guide - 1, with the median and the typical miss", acc.rows[0].error === 0.05 && acc.rows[1].error === -0.1 && acc.median === -0.025 && acc.medianAbs === 0.075, JSON.stringify(acc));
  ok("no deals: an empty ledger, no NaN", (() => { const z = ATTR.guideAccuracy([]); return z.n === 0 && z.median === null && z.medianAbs === null; })());

  /* ---- trend proposals from the monthly history ---- */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vg-trend-"));
  const hist = m => ({ months: m });
  const row = (month, town, kind, n, med) => ({ month, generatedOn: month + "-01", records: n, byTown: [{ town, kind, n, medianPricePerSqm: med }] });
  fs.writeFileSync(path.join(tmp, "history.json"), JSON.stringify(hist([row("2026-10", "LIPA CITY", "built", 61, 22367), row("2026-11", "LIPA CITY", "built", 80, 22500)])));
  let out = TREND.trend({ dir: tmp, today: "2026-11-01" });
  ok("two months of history: insufficient, the file says what it needs", out.status === "insufficient-history" && out.towns.length === 0 && /needs 3 months with 5\+ prices/.test(out.statusNote) && fs.existsSync(path.join(tmp, "trend-latest.json")), out.statusNote);
  ok("the committed trend file is the real run on the real history", (() => { const t = read("data/comparables/trend-latest.json"); return t.status === "insufficient-history" && t.monthsOfHistory === read("data/comparables/history.json").months.length && t.towns.length === 0 && /Residential Property Price Index/.test(t.context.index); })());
  fs.writeFileSync(path.join(tmp, "history.json"), JSON.stringify(hist([
    row("2026-10", "LIPA CITY", "built", 61, 20000), row("2026-11", "LIPA CITY", "built", 80, 20400), row("2026-12", "LIPA CITY", "built", 3, 30000),
    row("2027-01", "LIPA CITY", "built", 70, 22000), { month: "2027-01", generatedOn: "2027-01-01", records: 9, byTown: [{ town: "BAUAN", kind: "vacant", n: 9, medianPricePerSqm: 5000 }] }
  ])));
  out = TREND.trend({ dir: tmp, today: "2027-01-01" });
  ok("three months with 5+ prices: a proposed row, thin months skipped, the change from first to last", out.status === "proposed" && out.towns.length === 1 && out.towns[0].town === "LIPA CITY" && out.towns[0].points === 3 && out.towns[0].months === 3 && out.towns[0].changePct === 0.1 && out.towns[0].status === "proposed", JSON.stringify(out.towns));
  ok("the annualised rate follows the span", Math.abs(out.towns[0].annualizedPct - (Math.pow(1.1, 4) - 1)) < 0.002, out.towns[0].annualizedPct);
  const f = JSON.parse(fs.readFileSync(path.join(tmp, "trend-latest.json"), "utf8"));
  f.towns[0].status = "reviewed"; f.towns[0].reviewedBy = "Owner"; f.towns[0].reviewedOn = "2027-01-02"; f.context.note = "reviewer's own note";
  fs.writeFileSync(path.join(tmp, "trend-latest.json"), JSON.stringify(f));
  out = TREND.trend({ dir: tmp, today: "2027-01-03" });
  ok("a reviewed row survives the next run while its figure holds, and so does the reviewer's context note", out.towns[0].status === "reviewed" && out.towns[0].reviewedBy === "Owner" && out.context.note === "reviewer's own note", JSON.stringify(out.towns[0]));
  fs.writeFileSync(path.join(tmp, "history.json"), JSON.stringify(hist([
    row("2026-10", "LIPA CITY", "built", 61, 20000), row("2026-11", "LIPA CITY", "built", 80, 20400), row("2027-01", "LIPA CITY", "built", 70, 23000)
  ])));
  out = TREND.trend({ dir: tmp, today: "2027-01-04" });
  ok("when the figure moves by more than 2 points the row goes back to re-review", out.towns[0].status === "re-review" && out.towns[0].changePct === 0.15, JSON.stringify(out.towns[0]));
  ok("re-review rows are not shown by the estimator", core.trendFor({ evidence: Object.assign({}, ev, { trend: { towns: out.towns } }) }, "LIPA CITY", "house_lot") === null);
  ok("the monthly workflow runs the trend script after the fit", (() => { const y = fs.readFileSync(path.join(ROOT, ".github/workflows/comparables-monthly.yml"), "utf8"); return /fit-model\.js\n[\s\S]*trend\.js\n/.test(y) && /name: Trend proposals/.test(y); })());

  console.log("\nvalue_guide_phase2_node: " + n + " checks passed");
})().catch(e => { console.error("CRASH " + (e && e.stack || e)); process.exit(1); });
