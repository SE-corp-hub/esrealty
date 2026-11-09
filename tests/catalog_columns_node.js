// The public catalog view on live has exactly these columns (2026-10-16
// snapshot). Selecting any other column makes listing-api /listings answer
// 500, which empties the storefront. Update this list only together with a
// SQL change to public_listing_catalog that has been applied on live.
const fs = require("fs");
const path = require("path");
const LIVE_CATALOG = ["id", "ref", "title", "description", "property_type", "offer_type", "status",
  "price", "rent", "address", "barangay", "city", "province", "region", "postal_code", "latitude",
  "longitude", "bedrooms", "bathrooms", "floor_area_sqm", "floor_area_sqft", "lot_size_sqm",
  "lot_size_sqft", "year_built", "featured", "agent_id", "agent_name", "views", "inquiries",
  "published_at", "updated_at", "images", "display_price",
  // Added by migration 0022 (2026-11-09). Apply 0022 on live BEFORE deploying listing-api.
  "office_checked", "previous_price"];
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const listOf = (src, name) => {
  const m = new RegExp("const " + name + " = \\[([\\s\\S]*?)\\]").exec(src);
  if (!m) throw new Error(name + " not found");
  return m[1].match(/"([^"]+)"/g).map((x) => x.slice(1, -1));
};
let failed = 0;
for (const [file, name] of [["supabase/functions/listing-api/index.ts", "PUBLIC_LISTING_COLUMNS"], ["supabase/functions/seo/index.ts", "PUBLIC_COLUMNS"]]) {
  const missing = listOf(read(file), name).filter((c) => LIVE_CATALOG.indexOf(c) < 0);
  if (missing.length) { failed++; console.log("FAIL " + file + " " + name + " selects columns the live catalog lacks: " + missing.join(", ")); }
  else console.log("PASS " + file + " " + name + " fits the live catalog");
}
const mig = read("supabase/migrations/0022_site_upgrades.sql");
if (!/AS office_checked/.test(mig) || !/AS previous_price/.test(mig)) { failed++; console.log("FAIL migration 0022 must add office_checked and previous_price"); }
else console.log("PASS migration 0022 adds office_checked and previous_price");
if (failed) process.exit(1);
