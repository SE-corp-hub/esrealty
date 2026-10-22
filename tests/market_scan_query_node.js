// The market-scan endpoint accepts only plain place names and the property types the app offers
// (market-scan/vercel/lib/handler.js cleanQuery), and no longer returns internal error text.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const { cleanQuery, QueryError } = require(path.join(root, "market-scan/vercel/lib/handler.js"));
let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? "  " + detail : "")); passed++; console.log("[PASS] " + name); };
const bad = q => { try { cleanQuery(q); return null; } catch (e) { return e; } };

// Every property type the Market Scan screen offers must still go through.
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const types = JSON.parse(/const MS_TYPES = (\[[^\]]*\]);/.exec(app)[1]);
ok("the screen offers the property types read from app.js", types.length >= 9 && types.indexOf("House & Lot") >= 0, types.join("|"));
ok("every property type the screen offers is accepted", types.every(t => bad({ type: t }) === null), types.filter(t => bad({ type: t })).join("|"));
ok("sale and rent are accepted", bad({ mode: "sale" }) === null && bad({ mode: "rent" }) === null);

// Place names as people type them.
["Lipa City", "Biñan", "Dasmariñas", "Sto. Tomas", "Lapu-Lapu City", "Santo Tomas, Batangas", "City of San Fernando", "Quezon City", "Muñoz", "Parañaque", "Cagayan de Oro", "Bacolod"].forEach(c => {
  ok("place accepted: " + c, bad({ city: c }) === null);
});
ok("spaces are tidied", cleanQuery({ city: "  Lipa   City " }).city === "Lipa City");
ok("a missing field becomes empty", cleanQuery({}).city === "" && cleanQuery(undefined).province === "");
ok("numbers are left for the scan to read (commas allowed)", cleanQuery({ minPrice: "1,500,000", maxResults: "40" }).minPrice === "1,500,000");

// Refused.
["Lipa<script>", "a;b", "x".repeat(61), "Lipa\u0000", "Lipa%20City", "Lipa/../", "https://evil.example", "' or 1=1 --"].forEach(c => {
  const e = bad({ city: c });
  ok("place refused: " + JSON.stringify(c).slice(0, 30), e instanceof QueryError && e.status === 400 && /city is invalid/.test(e.message));
});
ok("a repeated query parameter (array) is refused", bad({ city: ["a", "b"] }) instanceof QueryError);
ok("a very long number is refused", bad({ minPrice: "9".repeat(21) }) instanceof QueryError);
ok("a bad type is refused", bad({ type: "house;drop" }) instanceof QueryError);

const handlerSrc = fs.readFileSync(path.join(root, "market-scan/vercel/lib/handler.js"), "utf8");
ok("the shared handler validates before anything is scanned or cached", /async function handleMarketScan\(query\) \{\s*const q = cleanQuery\(query\);\s*const live = isLive\(q\);\s*const key = cacheKey\(q\);/.test(handlerSrc));
const apiSrc = fs.readFileSync(path.join(root, "market-scan/vercel/api/market-scan.js"), "utf8");
ok("a refused query answers 400, any other failure a generic 500 (cause goes to the log)", /err\.status === 400/.test(apiSrc) && /The scan could not be completed/.test(apiSrc) && !/status\(500\)\.json\(\{ ok: false, error: String\(err/.test(apiSrc));

console.log("\nmarket_scan_query_node: " + passed + " checks passed");
