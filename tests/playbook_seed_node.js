/* Guards the generated starter-playbook seed against the canonical domains the
 * app and DB enforce (PLAYBOOK_STAGES/CATEGORIES/TYPES in js/app.js and the
 * CHECK constraints in supabase/archive/sales_playbooks.sql). Without this, "Load
 * starter playbooks" silently failed on 4 of 10 rows because the seed carried
 * retired stages (Qualification/Presentation/Closing/Follow-up). */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const STAGES = ["Lead Generation", "Initial Consultation", "Property Matching", "Site Viewing", "Price Negotiation", "Reservation", "Contract to Sell", "Financing", "Turnover", "Post-Sale"];
const CATEGORIES = ["OFW Buyer", "First-Time Homebuyer", "End-User", "Investor", "Balikbayan", "Relocating Expat", "Corporate Lease", "Developer Bulk"];
const TYPES = ["Condominium", "House & Lot", "Townhouse", "Shophouse", "Lot Only", "Warehouse", "Mixed-Use", "Farm Lot"];
const SECTION_KEYS = ["objective", "openingScript", "discoveryQuestions", "qualificationChecklist", "valueProposition", "presentationSteps", "objectionResponses", "closingScript", "followUpSequence", "coachingNotes", "opening", "qualification", "propertyDetails", "objections", "followUp", "closing", "coaching"];

function loadSeed() {
  const code = fs.readFileSync(path.join(__dirname, "..", "js", "playbook_seed.js"), "utf8");
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.window.ESREALTY_PLAYBOOK_SEED;
}

function run() {
  const checks = [];
  const c = (name, ok, detail) => checks.push({ name, ok, detail });

  const seed = loadSeed();
  c("seed loads as an array", Array.isArray(seed), typeof seed);
  c("seed ships starter playbooks", seed.length >= 10, String(seed.length));

  const badStage = seed.filter(p => STAGES.indexOf(p.sales_stage) < 0).map(p => p.title + ": " + p.sales_stage);
  c("every seed sales_stage is canonical", badStage.length === 0, badStage.join(", ") || "ok");
  const badCat = seed.filter(p => CATEGORIES.indexOf(p.category) < 0).map(p => p.title + ": " + p.category);
  c("every seed category is canonical", badCat.length === 0, badCat.join(", ") || "ok");
  const badType = seed.filter(p => TYPES.indexOf(p.property_type) < 0).map(p => p.title + ": " + p.property_type);
  c("every seed property_type is canonical", badType.length === 0, badType.join(", ") || "ok");
  const badStatus = seed.filter(p => ["draft", "active", "archived"].indexOf(p.status) < 0).map(p => p.title);
  c("every seed status is valid", badStatus.length === 0, badStatus.join(", ") || "ok");
  const emptySections = seed.filter(p => !p.sections || typeof p.sections !== "object" || !Object.keys(p.sections).length).map(p => p.title);
  c("every seed has a non-empty sections object", emptySections.length === 0, emptySections.join(", ") || "ok");
  const unknownKeys = seed.filter(p => Object.keys(p.sections || {}).every(k => SECTION_KEYS.indexOf(k) < 0)).map(p => p.title);
  c("every seed section uses a recognised key", unknownKeys.length === 0, unknownKeys.join(", ") || "ok");

  const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "archive", "seed_playbooks.sql"), "utf8");
  const badSql = sql.match(/\$\$(Qualification|Presentation|Closing|Follow-up)\$\$/g) || [];
  c("SQL seed has no retired stage literals", badSql.length === 0, badSql.join(", ") || "ok");

  const ok = checks.every(x => x.ok) && checks.length >= 9;
  console.log("\n[playbook_seed_node] " + checks.length + " checks");
  checks.forEach(x => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : "  " + x.detail)));
  console.log(ok ? "ALL PASS" : "FAILURES PRESENT");
  process.exit(ok ? 0 : 1);
}

run();
