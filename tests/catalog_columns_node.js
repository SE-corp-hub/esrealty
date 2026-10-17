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
  "published_at", "updated_at", "images", "display_price"];
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
if (failed) process.exit(1);
