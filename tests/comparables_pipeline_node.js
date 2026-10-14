"use strict";
/* Monthly comparables pipeline (market-scan/comparables).
 *
 * Fixtures:
 *   tests/fixtures/comparables/bdo-items-sample.json - positioned text from the
 *     real BDO Luzon_Batangas.pdf (as of 10 Oct 2026), page 1 + end of page 8.
 *   tests/fixtures/comparables/bpi-luzon-sample.html - the real BPI Batangas
 *     table with the Sales Officer column blanked.
 * The BDO test PDF is rebuilt here the way Chromium/Skia prints it (flipped page
 * matrix, hex glyph runs, ToUnicode map, Flate streams), so the PDF reader is
 * exercised end to end without committing the bank's file. */
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), zlib = require("zlib");
const ROOT = process.cwd();
const BDO = require(path.join(ROOT, "market-scan/comparables/sources/bdo.js"));
const BPI = require(path.join(ROOT, "market-scan/comparables/sources/bpi.js"));
const MATCH = require(path.join(ROOT, "market-scan/comparables/match.js"));
const BUILD = require(path.join(ROOT, "market-scan/comparables/build-comparables.js"));
const FX = path.join(ROOT, "tests/fixtures/comparables");
const ITEMS = require(path.join(FX, "bdo-items-sample.json")).items.map(([page, x, y, str]) => ({ page, x, y, str }));
const BPI_HTML = fs.readFileSync(path.join(FX, "bpi-luzon-sample.html"), "utf8");

let count = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* ---- a Skia-like PDF from positioned items ---- */
function makePdf(items, pageHeight) {
  pageHeight = pageHeight || 612;
  const chars = [...new Set(items.map(i => i.str).join(""))];
  const gid = ch => (chars.indexOf(ch) + 3).toString(16).toUpperCase().padStart(4, "0");
  const cmap = "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n" +
    chars.length + " beginbfchar\n" + chars.map(ch => "<" + gid(ch) + "> <" + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0") + ">").join("\n") +
    "\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
  const objs = [];
  const add = body => { objs.push(body); return objs.length; };
  const stream = (dict, text) => { const z = zlib.deflateSync(Buffer.from(text, "latin1")); return { dict: dict + " /Filter /FlateDecode /Length " + z.length, data: z }; };
  const cmapId = add(stream("<<", cmap));
  const fontId = add("<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Arial /Encoding /Identity-H /ToUnicode " + cmapId + " 0 R >>");
  const pagesId = add(null);
  const pageNums = [...new Set(items.map(i => i.page))];
  const kids = [];
  pageNums.forEach(p => {
    const ops = ["q", "1 0 0 -1 0 " + pageHeight + " cm", "q"].concat(items.filter(i => i.page === p).map(i =>
      "BT\n/F4 9 Tf\n1 0 0 -1 " + i.x + " " + (pageHeight - i.y) + " Tm\n<" + [...i.str].map(gid).join("") + "> Tj\nET")).concat(["Q", "Q"]).join("\n");
    const cId = add(stream("<<", ops));
    kids.push(add("<< /Type /Page /Parent " + pagesId + " 0 R /MediaBox [0 0 842 " + pageHeight + "] /Resources << /ProcSet [/PDF /Text] /Font << /F4 " + fontId + " 0 R >> >> /Contents " + cId + " 0 R >>"));
  });
  objs[pagesId - 1] = "<< /Type /Pages /Kids [" + kids.map(k => k + " 0 R").join(" ") + "] /Count " + kids.length + " >>";
  const parts = [Buffer.from("%PDF-1.4\n%\xD3\xEB\xE9\xE1\n", "latin1")];
  objs.forEach((o, i) => {
    if (typeof o === "string") parts.push(Buffer.from((i + 1) + " 0 obj\n" + o + "\nendobj\n", "latin1"));
    else parts.push(Buffer.from((i + 1) + " 0 obj\n" + o.dict + " >> stream\n", "latin1"), o.data, Buffer.from("\nendstream\nendobj\n", "latin1"));
  });
  parts.push(Buffer.from("trailer\n<< /Root 999 0 R >>\n%%EOF\n", "latin1"));
  return Buffer.concat(parts);
}
const inflate = async b => zlib.inflateSync(Buffer.from(b));

/* ---------------- BDO ---------------- */
test("bdo: the PDF reader recovers every positioned text run", async () => {
  const got = await BDO.extractPdfItems(new Uint8Array(makePdf(ITEMS)), inflate);
  assert.strictEqual(got.length, ITEMS.length);
  const pages = [...new Set(ITEMS.map(i => i.page))]; /* the sample keeps pages 1 and 8 -> PDF pages 1 and 2 */
  got.forEach((g, i) => assert.deepStrictEqual(g, Object.assign({}, ITEMS[i], { page: pages.indexOf(ITEMS[i].page) + 1 }), "item " + i));
});

test("bdo: rows rebuilt from the layout, wrapped cells joined, split digits kept", async () => {
  const r = await BDO.parseBdoPdf(new Uint8Array(makePdf(ITEMS)), inflate);
  assert.strictEqual(r.asOf, "2026-10-10");
  assert.strictEqual(r.rows.length, 14);
  const calaca = r.rows[0];
  assert.strictEqual(calaca.propertyType, "Industrial - Vacant Lot");
  assert.strictEqual(calaca.price, 116670000, "the kerned leading '1' belongs to the price");
  assert.strictEqual(calaca.lotArea, 11667);
  assert.ok(/Brgy\. Lumbang Calzada, Calaca, Batangas \(with Annotation\)$/.test(calaca.address), calaca.address);
  const camella = r.rows.find(x => /Camella Sto\. Tomas/.test(x.address));
  assert.strictEqual(camella.floorArea, 119);
  assert.strictEqual(camella.address, "Lot 13, Block 7, Linares St., Camella Sto. Tomas, Brgy. San Miguel, Santo Tomas, Batangas");
  const punta = r.rows.find(x => /Punta Fuego/.test(x.address));
  assert.strictEqual(punta.project, "Terrazas de Punta Fuego");
  assert.strictEqual(punta.price, 35700000);
  assert.ok(!r.rows.some(x => /visit our office/i.test(x.address)), "footer is not a row");
});

test("bdo: a changed layout throws instead of returning a partial table", () => {
  assert.throws(() => BDO.parseBdoItems(ITEMS.filter(i => !/Advertised/.test(i.str))), /layout changed/);
  assert.throws(() => BDO.parseBdoItems(ITEMS.filter(i => !(i.x >= 595 && i.x < 700 && /\d/.test(i.str)))), /no rows/);
});

/* ---------------- BPI ---------------- */
test("bpi: only the Batangas table, no sales-officer data", () => {
  const r = BPI.parseBpiHtml(BPI_HTML, "Batangas");
  assert.strictEqual(r.rows.length, 12);
  assert.ok(r.rows.every(x => /Batangas$/.test(x.address)));
  assert.ok(!JSON.stringify(r.rows).match(/officer|removed/i), "no officer column leaks");
  const avida = r.rows.find(x => /Avida/.test(x.address));
  assert.deepStrictEqual([avida.lotArea, avida.floorArea, avida.price, avida.propertyType, avida.tag], [189, 0, 3061800, "Vacant Lot", "green"]);
  assert.throws(() => BPI.parseBpiHtml(BPI_HTML.replace("Batangas Properties", "Batangas Listings")), /layout changed/);
});

/* ---------------- Pag-IBIG ---------------- */
test("pagibig: one call per town, contact people and title numbers never saved", async () => {
  const PAG = require(path.join(ROOT, "market-scan/comparables/sources/pagibig.js"));
  const calls = [];
  const get = async u => {
    calls.push(u);
    if (/LoadLocations/.test(u)) return JSON.stringify([{ result_column0: "041014000", result_column1: "CITY OF LIPA" }, { result_column0: "041006000", result_column1: "BAUAN" }]);
    return JSON.stringify({ data: [{ ropa_id: "1", prop_location: "Lot 1 Blk. 1 X, BAUAN, BATANGAS, 4201", prop_type: "Lot Only", lot_area: "100", floor_area: "0", min_sellprice: 500000,
      contact_hbc: "Juan Dela Cruz", email_hbc: "someone@example.com", handling_hbc: "Desk 3", tct_cct_no: "T-123", disposal_flag: "1" }] });
  };
  const text = await PAG.fetchPagibig(get, async () => {});
  assert.strictEqual(calls.length, 3, "towns + one search per town");
  assert.ok(/city_muni=CITY\+OF\+LIPA/.test(calls[1]), "towns are searched by name");
  assert.ok(!/Juan|example\.com|Desk 3|T-123/.test(text), "no contact person, e-mail or title number in the saved file");
  const rows = PAG.parsePagibigJson(fs.readFileSync(path.join(FX, "pagibig-batangas-sample.json"), "utf8")).rows;
  assert.strictEqual(rows.length, 6, "the condominium (no lot area) is left out");
  const lot = rows[0];
  assert.deepStrictEqual([lot.address, lot.propertyType, lot.price, lot.lotArea, lot.tag, lot.note],
    ["Lot 7 Blk. 4 DE CLARO-PUNZALAN COMPOUND ALANGILAN, BATANGAS CITY, BATANGAS", "Vacant Lot", 505890, 77, "2nd auction, up to 30% below", "unoccupied-lot - title under consolidation"]);
  assert.strictEqual(rows.find(r => /BELLAVITA/.test(r.address)).propertyType, "Townhouse");
  assert.strictEqual(rows.find(r => /BANADERO/.test(r.address)).propertyType, "House & Lot");
  assert.strictEqual(rows.find(r => /FIRST WORLD/.test(r.address)).project, "FIRST WORLD HOMES", "padding trimmed");
});

/* ---------------- matching ---------------- */
test("match: towns, barangays and subdivisions from free-text bank addresses", () => {
  const bir = MATCH.loadBir(ROOT);
  const cases = [
    ["Lot 13, Block 7, Linares St., Camella Sto. Tomas, Brgy. San Miguel, Santo Tomas, Batangas", "STO. TOMAS CITY", "SAN MIGUEL"],
    ["Lot 3 Block 3 Aster Street Avida Settings Batangas Phase 1 Barangay Poblacion III San Pascual Batangas", "SAN PASCUAL", "POBLACION I, II, III (POBLACION)"],
    ["Lot 32, Block 5, GC Berberabe Subdivision, Brgy. Pallocan East, Batangas City, Batangas", "BATANGAS CITY", "PALLOCAN SILANGAN (EAST)"],
    ["Lot 1 Block 4 Pontefino Prime Residences Barangay Gulod Labak Batangas City Batangas", "BATANGAS CITY", "GULOD LABAC"],
    ["No. 103 (Lot 12306 M), Brgy. Poblacion E, Rosario, Batangas", "ROSARIO", "BARANGAY E"],
    ["Lot 9, Block 48, Canyon Woods Residential Resort, Phase 2, Brgy. San Gabriel / San Gregorio, Laurel City, Batangas", "LAUREL", "SAN GABRIEL"],
    ["Lot 269, Lopez Jaena St., Brgy. Poblacion 2, Batangas City, Batangas", "BATANGAS CITY", "BARANGAY 2"]
  ];
  cases.forEach(([a, muni, brgy]) => {
    const m = MATCH.matchAddress(bir, a, "house_lot");
    assert.strictEqual(m.municipality, muni, a);
    assert.strictEqual(m.barangay, brgy, a);
    assert.ok(m.birRate > 0, a + ": BIR rate found");
  });
  const s = MATCH.matchAddress(bir, "Lot 11, Block 3 (LRC) PSD-41084, Road Lot 1, Abacan Subdivision, Brgy. Calicanto, Batangas City, Batangas", "house_lot");
  assert.deepStrictEqual([s.matchLevel, s.streetKey], ["street", "abacan subdivision"]);
  assert.strictEqual(MATCH.matchAddress(bir, "Lot 1 Brgy. Taysan, Legazpi City, Albay", "vacant_lot").municipality, null);
});

/* ---------------- monthly build ---------------- */
function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comparables-"));
  const raw = path.join(dir, "raw"), inbox = path.join(dir, "inbox"), out = path.join(dir, "out");
  [raw, inbox, out].forEach(d => fs.mkdirSync(d));
  return { dir, raw, inbox, out };
}
const run = (ws, today) => BUILD.build({ root: ROOT, raw: ws.raw, inbox: ws.inbox, out: ws.out, today });
const latest = ws => JSON.parse(fs.readFileSync(path.join(ws.out, "batangas-latest.json"), "utf8"));
const history = ws => JSON.parse(fs.readFileSync(path.join(ws.out, "history.json"), "utf8"));
/* Same property on BPI as a BDO row: must be merged. A different lot at the same
   price and area (common in one subdivision) must not be. */
const DUP_ROW = '<tr><td>99999-TEST-1</td><td>Lot 30 and 32 Block 9 Tulips St. Betzaida Village Barangay Dumantay Batangas City Batangas</td><td>133 / 83.2</td><td>PHP 3,330,000</td><td>House &amp; Lot - Green Tag</td><td>x</td></tr>';
const NOT_DUP = '<tr><td>99999-TEST-2</td><td>Lot 2 Block 9 Tulips St. Betzaida Village Barangay Dumantay Batangas City Batangas</td><td>133 / 83.2</td><td>PHP 3,315,800</td><td>House &amp; Lot - Green Tag</td><td>x</td></tr>';

test("build: snapshot, matching, de-duplication and a monthly history entry", async () => {
  const ws = workspace();
  fs.writeFileSync(path.join(ws.raw, "bdo--batangas.pdf"), makePdf(ITEMS));
  fs.writeFileSync(path.join(ws.raw, "bpi--luzon.html"), BPI_HTML.replace("</tbody></table>\n<h2>Benguet", DUP_ROW + NOT_DUP + "</tbody></table>\n<h2>Benguet"));
  fs.copyFileSync(path.join(FX, "pagibig-batangas-sample.json"), path.join(ws.raw, "pagibig--batangas.json"));
  const res = await run(ws, "2026-10-15");
  assert.ok(res.ok, JSON.stringify(res.problems));
  const L = latest(ws);
  assert.strictEqual(L.sources.find(s => s.id === "bdo").parsed, 14);
  assert.strictEqual(L.sources.find(s => s.id === "bpi").parsed, 14);
  assert.strictEqual(L.sources.find(s => s.id === "securitybank").status, "skipped");
  const pag = L.records.filter(r => r.source === "pagibig");
  assert.ok(pag.length >= 5, "Pag-IBIG records kept: " + pag.length);
  assert.ok(pag.every(r => r.saleCategory === "government-acquired" && r.priceType === "minimum_bid" && r.tag && r.note));
  assert.ok(pag.every(r => r.barangay), "every Pag-IBIG record matched to a barangay");
  assert.ok(L.rejected.some(r => r.id.indexOf("99999-TEST-1") >= 0 && /duplicate of bdo:/.test(r.reason)), "cross-source duplicate merged");
  assert.ok(L.records.some(r => /99999-TEST-2/.test(r.id)), "a different lot at the same price is kept");
  assert.ok(L.summary.matchRate >= 0.8, "match rate " + L.summary.matchRate);
  assert.ok(L.records.every(r => r.source && r.priceType && r.observedOn && r.url && r.municipality), "every record carries its provenance");
  assert.ok(!/officer|removed/i.test(JSON.stringify(L.records)), "no personal data");
  assert.strictEqual(L.records.find(r => r.source === "bdo").observedOn, "2026-10-10", "BDO keeps the PDF's own date");
  const H = history(ws);
  assert.strictEqual(H.months.length, 1);
  assert.ok(H.months[0].byTown.length > 0 && !("records" in H.months[0].byTown[0]), "history keeps summaries, not rows");
});

test("build: next month replaces the data - delisted properties disappear", async () => {
  const ws = workspace();
  fs.writeFileSync(path.join(ws.raw, "bdo--batangas.pdf"), makePdf(ITEMS));
  fs.writeFileSync(path.join(ws.raw, "bpi--luzon.html"), BPI_HTML);
  await run(ws, "2026-10-15");
  const before = latest(ws).records.filter(r => r.source === "bdo").length;
  /* November: BDO sold the Calaca lot and the Lemery house. */
  const nov = ITEMS.filter(i => !(i.page === 1 && i.y <= 30) && !(i.page === 1 && i.y >= 395 && i.y <= 445))
    .map(i => /as of 10Oct2026/.test(i.str) ? Object.assign({}, i, { str: i.str.replace("10Oct2026", "05Nov2026") }) : i);
  fs.writeFileSync(path.join(ws.raw, "bdo--batangas.pdf"), makePdf(nov));
  await run(ws, "2026-11-01");
  const L = latest(ws);
  const bdo = L.records.filter(r => r.source === "bdo");
  assert.strictEqual(bdo.length, before - 2);
  assert.ok(!bdo.some(r => /Calaca|Lemery/.test(r.address)), "sold properties are gone");
  assert.ok(bdo.every(r => r.observedOn === "2026-11-05"));
  assert.deepStrictEqual(history(ws).months.map(m => m.month), ["2026-10", "2026-11"]);
});

test("build: a failed source is carried over once, flagged, then dropped", async () => {
  const ws = workspace();
  fs.writeFileSync(path.join(ws.raw, "bdo--batangas.pdf"), makePdf(ITEMS));
  fs.writeFileSync(path.join(ws.raw, "bpi--luzon.html"), BPI_HTML);
  await run(ws, "2026-10-15");
  fs.unlinkSync(path.join(ws.raw, "bpi--luzon.html"));
  let res = await run(ws, "2026-11-01");
  assert.ok(res.problems.some(p => /^bpi:/.test(p)), "the failure is reported");
  let L = latest(ws);
  assert.strictEqual(L.sources.find(s => s.id === "bpi").status, "failed-carried-over");
  assert.ok(L.records.filter(r => r.source === "bpi").length > 0 && L.records.filter(r => r.source === "bpi").every(r => r.carriedOver));
  res = await run(ws, "2026-12-01");
  L = latest(ws);
  assert.strictEqual(L.records.filter(r => r.source === "bpi").length, 0, "second missed month drops them");
});

test("build: BDO falls back to a PDF a person put in the inbox; a stale one is refused", async () => {
  const ws = workspace();
  fs.writeFileSync(path.join(ws.raw, "bpi--luzon.html"), BPI_HTML);
  fs.writeFileSync(path.join(ws.inbox, "Luzon_Batangas.pdf"), makePdf(ITEMS));
  let res = await run(ws, "2026-10-20");
  assert.strictEqual(latest(ws).sources.find(s => s.id === "bdo").status, "ok");
  assert.ok(/inbox/.test(latest(ws).sources.find(s => s.id === "bdo").from));
  res = await run(ws, "2026-11-25");
  assert.ok(res.problems.some(p => /bdo: newest data is as of 2026-10-10 \(46 days old, still used\)/.test(p)), JSON.stringify(res.problems));
  assert.strictEqual(latest(ws).sources.find(s => s.id === "bdo").status, "ok");
  res = await run(ws, "2027-01-05");
  assert.ok(res.problems.some(p => /bdo: newest data is as of 2026-10-10/.test(p)), JSON.stringify(res.problems));
});

test("build: manual rows in the inbox count for a source no robot can read", async () => {
  const ws = workspace();
  fs.writeFileSync(path.join(ws.raw, "bpi--luzon.html"), BPI_HTML);
  fs.writeFileSync(path.join(ws.inbox, "securitybank.rows.json"), JSON.stringify({ observedOn: "2026-10-12", rows: [
    { address: "Lot 5 Block 2 Rancho Vista Subdivision, Brgy. Santiago, Santo Tomas, Batangas", propertyType: "Vacant Lot", price: 4500000, lotArea: 500, floorArea: 0 }] }));
  await run(ws, "2026-10-20");
  const L = latest(ws);
  const sb = L.sources.find(s => s.id === "securitybank");
  assert.deepStrictEqual([sb.status, sb.parsed, sb.observedOn], ["ok", 1, "2026-10-12"]);
  const r = L.records.find(x => x.source === "securitybank");
  assert.deepStrictEqual([r.barangay, r.streetKey, r.priceType], ["SANTIAGO", "rancho vista subd", "suggested"]);
  fs.writeFileSync(path.join(ws.inbox, "securitybank.rows.json"), JSON.stringify({ observedOn: "2026-10-12", rows: [{ address: "x" }] }));
  const res = await run(ws, "2026-10-21");
  assert.ok(res.problems.some(p => /securitybank\.rows\.json: row 0 needs/.test(p)), JSON.stringify(res.problems));
});

test("build: nothing usable leaves the previous snapshot untouched", async () => {
  const ws = workspace();
  const res = await run(ws, "2026-10-15");
  assert.strictEqual(res.ok, false);
  assert.ok(!fs.existsSync(path.join(ws.out, "batangas-latest.json")));
});

test("result page: bank listings near the subject, ranked and summarised (display only)", () => {
  const E = require(path.join(ROOT, "js/value_guide_evidence.js"));
  const rec = (brgy, kind, lot, price, extra) => Object.assign({ source: "bdo", priceType: "advertised", municipality: "LIPA CITY", barangay: brgy, kind, lotArea: lot, price, pricePerSqmLot: Math.round(price / lot), observedOn: "2026-10-10" }, extra);
  const snap = { generatedOn: "2026-10-14", records: [
    rec("CUMBA", "vacant_lot", 200, 1200000), rec("CUMBA", "vacant_lot", 150, 870000), rec("TIBIG", "vacant_lot", 210, 1300000),
    rec("CUMBA", "house_lot", 100, 3000000), rec("TIBIG", "vacant_lot", 1000, 9000000, { source: "bpi", observedOn: "2026-10-14" }),
    rec("POBLACION", "vacant_lot", 200, 1000000, { municipality: "TAAL" }) ] };
  const n = E.bankNearby(snap, { municipality: "Lipa City", barangay: "Cumba", type: "vacant_lot", area: 200, landPerSqm: 6300 });
  assert.strictEqual(n.total, 5, "only the subject's town");
  assert.strictEqual(n.inBarangay, 3);
  assert.strictEqual(n.sameKind, 4, "houses are not in the vacant-lot median");
  assert.strictEqual(n.medianPricePerSqm, 6095);
  assert.deepStrictEqual(n.records.slice(0, 3).map(r => [r.barangay, r.kind, r.lotArea]), [["CUMBA", "vacant_lot", 200], ["CUMBA", "vacant_lot", 150], ["CUMBA", "house_lot", 100]],
    "same barangay and kind first, closest size first");
  assert.strictEqual(n.newest, "2026-10-14");
  assert.deepStrictEqual(n.sources.sort(), ["bdo", "bpi"]);
  assert.strictEqual(n.subjectVsMedian, +(6300 / 6095 - 1).toFixed(3));
  assert.ok(n.cluster && n.cluster.count / n.sameKind >= 0.6);
  const few = E.bankNearby(snap, { municipality: "TAAL", barangay: "BULI", type: "house_lot", area: 100, total: 3e6 });
  assert.deepStrictEqual([few.total, few.sameKind, few.medianPricePerSqm], [1, 0, null], "no median under 3 records");
  assert.strictEqual(E.bankNearby({ records: [] }, { municipality: "LIPA CITY" }).total, 0);
  /* never an estimator input */
  const src = fs.readFileSync(path.join(ROOT, "js/estimator.js"), "utf8");
  const compute = src.slice(src.indexOf("function computeEstimate("), src.indexOf("function ownershipRiskPct("));
  assert.ok(!/bankComparables|bankNearby/.test(compute), "computeEstimate must not read bank listings");
});

test("accuracy: project-weighted, banded, and a month-over-month alert", async () => {
  const ACC = require(path.join(ROOT, "market-scan/comparables/accuracy.js"));
  const EST = ACC.loadEstimator(ROOT); /* installs the file-system fetch the estimator loads its data with */
  const opts = area => ({ purpose: "selling", type: "vacant_lot", municipality: "LIPA CITY", barangay: "CUMBA", streetKey: "", allOther: true,
    classification: "RR", area, saleContext: "private-resale", landMethod: "factor", features: [], floorArea: 0, construction: "mixed_chb", floors: "1", ageBand: "6-10" });
  const model = (await EST.estimate(opts(200))).total;
  assert.ok(model > 0);
  const lot = (project, factor, i) => ({ id: "t:" + project + i, source: "bdo", kind: "vacant_lot", municipality: "LIPA CITY", barangay: "CUMBA", streetKey: null,
    project, lotArea: 200, floorArea: 0, price: Math.round(model / factor), pricePerSqmLot: 1, birRate: 4000, matchLevel: "barangay" });
  /* one big project priced at half the guide (+100% error) and five single lots at the guide (0%) */
  const month = (bigFactor, today) => {
    const records = Array.from({ length: 10 }, (_, i) => lot("Big Estate", bigFactor, i)).concat(["Acacia", "Banaba", "Camia", "Dahlia", "Ilang"].map(p => lot(p + " Homes", 1, 0)));
    return { snap: { month: today.slice(0, 7), records }, today };
  };
  const ws = workspace();
  const write = m => {
    fs.writeFileSync(path.join(ws.out, "batangas-latest.json"), JSON.stringify(m.snap));
    const h = fs.existsSync(path.join(ws.out, "history.json")) ? JSON.parse(fs.readFileSync(path.join(ws.out, "history.json"))) : { months: [] };
    h.months.push({ month: m.snap.month });
    fs.writeFileSync(path.join(ws.out, "history.json"), JSON.stringify(h));
  };
  let m = month(2, "2026-10-14"); write(m);
  let res = await ACC.accuracy({ root: ROOT, dir: ws.out, today: m.today });
  const o = res.report.overall.vacant_lot;
  assert.strictEqual(o.n, 15);
  assert.strictEqual(o.projects, 6);
  assert.ok(Math.abs(o.median - 1) < 0.01, "plain median is dominated by the big project");
  assert.ok(Math.abs(o.projectWeightedMedian) < 0.01, "project-weighted median is not");
  assert.deepStrictEqual(res.problems, []);
  assert.ok(Math.abs(JSON.parse(fs.readFileSync(path.join(ws.out, "history.json"))).months[0].accuracy.vacant_lot) < 0.01, "headline kept in history");
  assert.ok(fs.existsSync(path.join(ws.out, "accuracy-latest.json")));
  /* next month every project is priced 40% under the guide: out of band and a big move */
  m = month(1 / 0.6, "2026-11-01"); m.snap.records.forEach(r => { r.price = Math.round(model * 0.6); }); write(m);
  res = await ACC.accuracy({ root: ROOT, dir: ws.out, today: m.today });
  assert.ok(res.problems.some(p => /vacant_lot guide vs bank prices \+67%.*outside -15% to \+35%/.test(p)), JSON.stringify(res.problems));
  assert.ok(res.problems.some(p => /vacant_lot moved from \+0% last month to \+67%/.test(p)), JSON.stringify(res.problems));
});

test("calibration: proposals are project-weighted, shrunk, and reach the estimator only via data/calibration.json", async () => {
  const ACC = require(path.join(ROOT, "market-scan/comparables/accuracy.js"));
  const CAL = require(path.join(ROOT, "market-scan/comparables/calibrate.js"));
  const EST = ACC.loadEstimator(ROOT);
  const base = { purpose: "selling", type: "vacant_lot", municipality: "LIPA CITY", barangay: "CUMBA", streetKey: "", allOther: true,
    classification: "RR", area: 200, saleContext: "private-resale", landMethod: "factor", features: [] };
  const land = (await EST.estimate(base)).landValue;
  /* every record priced so that price x 1.10 / guide land = 0.80 */
  const price = Math.round(land * 0.8 / 1.1);
  const lot = (project, i, address) => ({ id: "c:" + project + i, source: "bdo", kind: "vacant_lot", municipality: "LIPA CITY", barangay: "CUMBA",
    streetKey: null, project, address: address || "Lot " + i + ", Brgy. Cumba, Lipa City, Batangas", lotArea: 200, price, matchLevel: "barangay" });
  const recs = [];
  ["Alpha Homes", "Beta Village", "Gamma Estates"].forEach(p => { for (let i = 0; i < 4; i++) recs.push(lot(p, i)); });
  /* a BPI-style row with no project field joins its development by address */
  recs.push(lot("", 9, "Lot 9 Block 1 Alpha Homes Barangay Cumba Lipa City Batangas"));
  const ws = workspace();
  const calFile = path.join(ws.dir, "calibration.json");
  fs.writeFileSync(path.join(ws.out, "batangas-latest.json"), JSON.stringify({ month: "2026-10", records: recs }));
  let out = await CAL.calibrate({ root: ROOT, dir: ws.out, calibrationFile: calFile, today: "2026-10-14", writeCalibration: true });
  const t = out.towns.find(x => x.town === "LIPA CITY");
  assert.deepStrictEqual([t.records, t.projects, t.status], [13, 3, "proposed"]);
  assert.strictEqual(t.projectDetail.find(p => p.name === "ALPHA").n, 5, "the project-less row joined Alpha Homes");
  assert.ok(Math.abs(t.townRatio - 0.8) < 0.002);
  const expected = Math.round((1 + 3 / 13 * (t.townRatio - 1)) * 1000) / 1000;
  assert.strictEqual(t.proposed, expected, "shrunk toward no change by projects / (projects + 10)");
  const cal = JSON.parse(fs.readFileSync(calFile, "utf8"));
  assert.strictEqual(cal.towns["LIPA CITY"].residentialLandFactor, expected);

  /* the estimator applies it to residential land only, and shows it */
  const D = await EST.loadData(true);
  const md = await EST.loadMunicipality("lipa-city");
  const plain = EST.core.computeEstimate(D.config, D.index, md, base);
  const withCal = EST.core.computeEstimate(Object.assign({}, D.config, { townCalibration: cal }), D.index, md, base);
  assert.strictEqual(withCal.landValue, Math.round(plain.landValue * expected));
  assert.strictEqual(withCal.townCalibration.factor, expected);
  assert.ok(EST.core.integrityCheck(withCal).ok);
  const commercial = EST.core.computeEstimate(Object.assign({}, D.config, { townCalibration: cal }), D.index, md, Object.assign({}, base, { classification: "CR" }));
  assert.strictEqual(commercial.townCalibration, null, "commercial land is not corrected by residential lot prices");
  const bad = EST.core.computeEstimate(Object.assign({}, D.config, { townCalibration: { towns: { "LIPA CITY": { residentialLandFactor: 1.6 } } } }), D.index, md, base);
  assert.strictEqual(bad.landValue, plain.landValue, "an out-of-range factor is ignored, not clamped");

  /* next month starts from the approved factor; two projects are not enough */
  out = await CAL.calibrate({ root: ROOT, dir: ws.out, calibrationFile: calFile, today: "2026-11-01" });
  assert.strictEqual(out.towns.find(x => x.town === "LIPA CITY").current, expected);
  fs.writeFileSync(path.join(ws.out, "batangas-latest.json"), JSON.stringify({ month: "2026-11", records: recs.filter(r => r.project !== "Gamma Estates") }));
  out = await CAL.calibrate({ root: ROOT, dir: ws.out, calibrationFile: path.join(ws.dir, "none.json"), today: "2026-11-01" });
  assert.strictEqual(out.towns.find(x => x.town === "LIPA CITY").status, "not enough records");
});

test("helpers: property kinds and lot/block keys", () => {
  assert.strictEqual(BUILD.kindOf("Residential - House & Lot"), "house_lot");
  assert.strictEqual(BUILD.kindOf("Residential - Vacant Lot"), "vacant_lot");
  assert.strictEqual(BUILD.kindOf("Industrial - Vacant Lot"), "industrial_lot");
  assert.strictEqual(BUILD.kindOf("Townhouse"), "townhouse");
  assert.strictEqual(BUILD.lotBlockKey("Lots 30 and 32, Block 9, Tulips St."), BUILD.lotBlockKey("Lot 30 and 32 Block 9 Tulips St."));
  assert.notStrictEqual(BUILD.lotBlockKey("Lot 10, Block 13"), BUILD.lotBlockKey("Lot 14, Block 13"));
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); count++; console.log("[PASS] " + name); }
    catch (e) { console.error("[FAIL] " + name + "\n" + (e && e.stack || e)); process.exit(1); }
  }
  console.log("ALL GREEN (" + count + " checks)");
})();
