/* Phase 4 (2026-10-21): lead CSV import parser (F6), listing keyword search (H2). Shipped code. */
const fs = require("fs");
const path = require("path");
const LI = require("../js/lead_import.js");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const checks = [];
const c = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || "" });

// ---- CSV parser
let rows = LI.parseCsv('Name,Phone\r\n"Cruz, Ana","0917 555 0101"\r\n"He said ""hi""",x\n\n"multi\nline",y');
c("quoted commas, doubled quotes, CRLF and LF, blank lines skipped", rows.length === 4 && rows[1][0] === "Cruz, Ana" && rows[2][0] === 'He said "hi"' && rows[3][0] === "multi\nline", JSON.stringify(rows));
c("a byte-order mark from Excel is dropped", LI.parseCsv("﻿Name\nA")[0][0] === "Name");
c("last line without a newline is kept", LI.parseCsv("a,b\n1,2")[1].join() === "1,2");
c("empty fields stay as empty strings", LI.parseCsv("a,b,c\n1,,3")[1].join("|") === "1||3");

// ---- header mapping and rows
let res = LI.toLeads(LI.parseCsv([
  "Full Name,Mobile Number,E-mail,Lead Source,Interested in,Budget,Remarks,Type",
  "Maria Santos,0917 111 2222,MARIA@Example.com,Facebook,3BR Lipa,\"₱5,500,000\",called once,seller",
  "No Contact,,,,,,,",
  ",0917 000 0000,,,,,,",
  "Bad Mail,,not-an-email,,,,,",
  "Short Budget,0918 333 4444,,fb,,5.5M,,",
  "Odd Source,,a@b.ph,billboard,,2k,,unknown"
].join("\n")), { sources: ["listing", "facebook", "referral", "website", "other"] });
c("usual header names are recognised", res.map.name === 0 && res.map.phone === 1 && res.map.email === 2 && res.map.source === 3 && res.map.propertyInterest === 4 && res.map.budget === 5 && res.map.notes === 6 && res.map.type === 7, JSON.stringify(res.map));
c("three good rows become leads", res.leads.length === 3, res.leads.map(l => l.name).join());
const m = res.leads[0];
c("fields are read and cleaned", m.name === "Maria Santos" && m.phone === "0917 111 2222" && m.email === "maria@example.com" && m.source === "facebook" && m.propertyInterest === "3BR Lipa" && m.budget === 5500000 && m.notes === "called once" && m.type === "seller", JSON.stringify(m));
c("budget '5.5M' and 'fb' are understood", res.leads[1].budget === 5500000 && res.leads[1].source === "facebook", JSON.stringify(res.leads[1]));
c("unknown source becomes other, unknown type becomes buyer, 2k is 2,000", res.leads[2].source === "other" && res.leads[2].type === "buyer" && res.leads[2].budget === 2000, JSON.stringify(res.leads[2]));
c("skipped rows say which line and why", res.skipped.map(s => s.line + ":" + s.reason).join("|") === "3:no phone or email|4:no name|5:email looks wrong", JSON.stringify(res.skipped));
res = LI.toLeads(LI.parseCsv("Phone,Email\n0917,x@y.ph"));
c("a file without a Name column imports nothing and says so", res.leads.length === 0 && res.skipped[0].reason === "no Name column");
const big = ["Name,Phone"].concat(Array.from({ length: 520 }, (_, i) => "P" + i + ",0917" + i)).join("\n");
res = LI.toLeads(LI.parseCsv(big));
c("at most 500 rows are read, and the cap is reported", res.leads.length === 500 && res.tooMany, String(res.leads.length));
c("long values are cut to the database limits", LI.toLeads(LI.parseCsv("Name,Phone\n" + "x".repeat(300) + ",1"))[0] === undefined && LI.toLeads(LI.parseCsv("Name,Phone\n" + "x".repeat(300) + ",1")).leads[0].name.length === 160);

// ---- H2 keyword search in the listing API
const api = read("supabase/functions/listing-api/index.ts");
const cut = re => re.exec(api)[0];
const src = cut(/const SEARCH_COLUMNS = [^\n]*/) + "\n" + cut(/const searchWords = [\s\S]*?\n};/) + "\n" + cut(/const searchFilter = [^\n]*/);
const { searchWords, searchFilter } = new Function(src.replace(/\(raw: string \| null\): string\[\]/, "(raw)").replace(/\(w\)/g, "(w)").replace("(word: string)", "(word)").replace(/\(c\)/g, "(c)") + "\nreturn { searchWords, searchFilter };")();
c("words are split and short ones dropped", searchWords("pool  near a school").join("|") === "pool|near|school", searchWords("pool  near a school").join("|"));
c("filter syntax and wildcards are removed", searchWords("a,b.c(d)*%_e:f").join("|") === "", searchWords("a,b.c(d)*%_e:f").join("|"));
c("PostgREST punctuation never survives inside a word", searchWords("lot,price.eq.1 or(title)").every(w => !/[,.()*%:]/.test(w)), searchWords("lot,price.eq.1 or(title)").join("|"));
c("Filipino letters and hyphens are kept", searchWords("Barangay Niño, Sto. Tomas-Batangas").join("|") === "Barangay|Niño|Sto|Tomas-Batangas", searchWords("Barangay Niño, Sto. Tomas-Batangas").join("|"));
c("at most four words", searchWords("one two three four five six").length === 4);
c("no query, no filter", searchWords(null).length === 0 && searchWords("").length === 0);
c("each word is matched in title, description, address, barangay, city and reference", searchFilter("pool") === "title.ilike.*pool*,description.ilike.*pool*,address.ilike.*pool*,barangay.ilike.*pool*,city.ilike.*pool*,ref.ilike.*pool*");
c("the list endpoint applies one filter per word", /for \(const word of searchWords\(url\.searchParams\.get\("q"\)\)\) query = query\.or\(searchFilter\(word\)\);/.test(api));

// ---- website form
const sf = read("js/storefront.js"), css = read("css/storefront.css");
c("the search form has a Keyword field (q) shown as a chip like every filter", /\{ name: "q", label: "Keyword", kind: "text"[^}]*wide: true \}/.test(sf));
c("the keyword field takes its own row", /\.sf-search-form label\.sf-search-wide \{ grid-column: 1 \/ -1;/.test(css));

// ---- registrations
c("the import script is loaded and cached", /<script src="js\/lead_import\.js" defer><\/script>/.test(read("index.html")) && /"\.\/js\/lead_import\.js"/.test(read("sw.js")));

const ok = checks.every(x => x.ok) && checks.length >= 24;
console.log("\n[phase4_node] " + checks.length + " checks");
checks.forEach(x => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : "  " + x.detail)));
console.log(ok ? "ALL PASS" : "FAILURES PRESENT");
process.exit(ok ? 0 : 1);
