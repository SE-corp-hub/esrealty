import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
// Copies of js/value_guide_finance.js and data/tax/ph-estate-tax-reference.json.
// The deploy bundles only supabase/functions, so the function keeps its own
// copies; tests/edge_shared_sync_node.js fails if they drift from the originals.
import "../_shared/value_guide_finance.js";
import TAX_REFERENCE from "../_shared/ph-estate-tax-reference.json" with { type: "json" };
const FINANCE = (globalThis as any).ESREALTY_FINANCE;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "SEA ESTATES <onboarding@resend.dev>";
const MAX_BODY_BYTES = 200_000;
const MAX_ESTIMATE_JSON_BYTES = 8_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(s: string) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function money(n: unknown) {
  const v = Number(n || 0);
  return "₱" + new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(Math.round(v));
}

/* PDF bodies use only the ASCII-safe Helvetica standard font family, which
   cannot encode U+20B1 (₱). Keep the peso symbol out of every drawText call
   and emit "PHP " instead — the email body (HTML/UTF-8) still uses ₱. */
function moneyPdf(n: unknown) {
  const v = Math.round(Number(n || 0));
  return "PHP " + (Number.isFinite(v) ? new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(v) : "0");
}

function str(v: unknown, max: number) {
  return String(v ?? "").trim().slice(0, max);
}

function num(v: unknown) {
  const n = Number(v);
  return isFinite(n) && n >= 0 ? n : 0;
}

class BodyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJsonLimited(req: Request, maxBytes = MAX_BODY_BYTES) {
  const declared = Number(req.headers.get("content-length") || -1);
  if (declared > maxBytes) throw new BodyError(413, "Request body is too large");
  if (!req.body) throw new BodyError(400, "Request body is required");
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new BodyError(413, "Request body is too large");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new BodyError(400, "Invalid JSON body");
  }
}

function wrap(font: any, text: string, maxWidth: number) {
  const words = String(text).normalize("NFKD").replace(/[^\x20-\x7e\n]/g, "").split(/\s+/).filter(Boolean).flatMap(word => {
    const chunks: string[] = []; let chunk = "";
    for (const char of word) { if (chunk && font.widthOfTextAtSize(chunk + char, 9) > maxWidth) { chunks.push(chunk); chunk = ""; } chunk += char; }
    if (chunk) chunks.push(chunk); return chunks;
  });
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? line + " " + w : w;
    if (!line || font.widthOfTextAtSize(candidate, 9) <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/* ------------------------------------------------------------------ */
/* field/schema sanitation — the estimate stored on a CRM lead is      */
/* CLIENT-SUPPLIED. We cap every field and keep a truthfulness marker  */
/* so the CRM can never mistake a self-reported figure for a verified  */
/* BIR appraisal. (Full server-side recomputation needs the imported   */
/* schedule files; that is a follow-up, not silently assumed.)         */
/* ------------------------------------------------------------------ */

const SCORE_KEYS = [
  "accessibilityScore", "trafficScore", "populationScore",
  "futureDevScore", "competitionScore", "commercialGrowthScore",
];

function sanitizeEstimate(raw: any): any {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, unknown> = {};
  const numberKeys = ["taxReferenceValue", "total", "marketGuideEstimate", "recommendedAskingPrice", "low", "high", "perSqm", "birZonalRatePerSqm", "birZonalValue", "landValue", "improvement", "area", "floorArea", "landPerSqm", "salePrice", "ownershipAdjustmentPct",
    "cornerPct", "proxyFactor", "bandMid", "regionalAdj", "buildCostPerSqm", "floorsMultiplier", "ageMidpoint", "depreciatedPct", "featuresTotal"];
  for (const k of numberKeys) {
    if (k in raw) { const n = Number(raw[k]); if (isFinite(n)) out[k] = Math.round(n * 100) / 100; }
  }
  const stringKeys = ["municipality", "barangay", "street", "classification",
    "classificationLabel", "use", "coverage", "sourceLevel", "purpose", "type",
    "typeLabel", "calculationVersion", "dataVersion", "factorSettingsVersion", "conditions", "birReferenceLabel", "saleContext", "landMethod", "planningMethodLabel", "asOf", "schedule", "occupancy", "titleStatus", "inheritanceStatus"];
  for (const k of stringKeys) {
    if (raw[k] != null) out[k] = str(raw[k], 120);
  }
  if (raw.marketGuideAvailable != null) out.marketGuideAvailable = raw.marketGuideAvailable === true;
  if (raw.birReferenceConfirmed != null) out.birReferenceConfirmed = raw.birReferenceConfirmed === true;
  if (raw.referenceVerification && typeof raw.referenceVerification === "object") {
    const v = raw.referenceVerification;
    out.referenceVerification = { code: str(v.code, 50), label: str(v.label, 100), scheduleEffectiveDate: str(v.scheduleEffectiveDate, 20), datasetGeneratedAt: str(v.datasetGeneratedAt, 40), importDate: v.importDate == null ? null : str(v.importDate, 40), lastAttemptedCheck: str(v.lastAttemptedCheck, 20), successfullyVerifiedOn: v.successfullyVerifiedOn == null ? null : str(v.successfullyVerifiedOn, 20), verificationNote: str(v.verificationNote, 300) };
  }
  if (raw.timeIndex && typeof raw.timeIndex === "object") {
    const t = raw.timeIndex;
    const clean: any = { baseDate: str(t.baseDate, 20), targetDate: str(t.targetDate, 20), source: str(t.source, 100), evidenceId: str(t.evidenceId, 100), note: str(t.note, 350), formula: str(t.formula, 250) };
    for (const key of ["annualPct", "elapsedYears", "factor", "originalRate", "rawRate", "landAmount"]) if (Number.isFinite(Number(t[key]))) clean[key] = Number(t[key]);
    out.timeIndex = clean;
  }
  if (raw.costOptions && typeof raw.costOptions === "object") {
    const c = raw.costOptions;
    const clean: any = { saleContext: ["private-resale", "developer", "unknown"].includes(c.saleContext) ? c.saleContext : "unknown" };
    for (const key of ["developerFees", "notarial", "fairMarketValue", "brokerPct"]) if (c[key] != null && Number.isFinite(Number(c[key])) && Number(c[key]) >= 0) clean[key] = key === "brokerPct" ? Math.min(1, Number(c[key])) : num(c[key]);
    out.costOptions = clean;
  }
  if (raw.askingIndication && typeof raw.askingIndication === "object") {
    out.askingIndication = { value: num(raw.askingIndication.value), low: num(raw.askingIndication.low), high: num(raw.askingIndication.high), count: num(raw.askingIndication.count), method: str(raw.askingIndication.method, 200), basis: "Client-supplied asking indication; not verified closing prices" };
  }
  if (raw.cornerApplied != null) out.cornerApplied = raw.cornerApplied === true;
  /* Provenance is allowlisted here as well: the report must be able to state
   * where the figure came from, but only from fields we recognise. */
  if (raw.provenance && typeof raw.provenance === "object") {
    const p = raw.provenance as Record<string, unknown>;
    const arr = (v: unknown, max: number, len: number): string[] =>
      Array.isArray(v) ? v.slice(0, max).map((x) => str(x, len)).filter(Boolean) : [];
    out.provenance = {
      basisOfValue: str(p.basisOfValue, 80),
      basisNote: str(p.basisNote, 300),
      order: arr(p.order, 12, 90),
      rangeMeaning: str(p.rangeMeaning, 300),
      currencyCheckedOn: str(p.currencyCheckedOn, 20),
      nextCurrencyReview: str(p.nextCurrencyReview, 20),
      limitations: arr(p.limitations, 10, 220),
      sources: Array.isArray(p.sources) ? p.sources.slice(0, 6).map((s) => {
        const rec = s as Record<string, unknown>;
        return {
          instrument: str(rec.instrument, 80),
          authority: str(rec.authority, 80),
          coverage: str(rec.coverage, 120),
          effectiveDate: str(rec.effectiveDate, 20),
          revision: str(rec.revision, 20),
          status: str(rec.status, 40),
        };
      }).filter((r) => r.instrument) : [],
    };
  }
  if (raw.confidencePct != null) { const n = Number(raw.confidencePct); if (isFinite(n)) out.confidencePct = n; }
  if (raw.source && typeof raw.source === "object") {
    const s = raw.source as Record<string, unknown>;
    out.source = {
      level: str(s.level, 60),
      depth: Number(s.depth),
      pct: Number.isFinite(Number(s.pct)) ? Number(s.pct) : null,
      label: str(s.label, 160),
      count: Number.isFinite(Number(s.count)) ? Number(s.count) : null,
    };
  }
  if (raw.marketGuide && typeof raw.marketGuide === "object") {
    const m = raw.marketGuide as Record<string, unknown>;
    out.marketGuide = {
      sourceType: str(m.sourceType, 120),
      comparableCount: Number.isFinite(Number(m.comparableCount)) ? Number(m.comparableCount) : 0,
      comparableMedianPricePerSqm: Number.isFinite(Number(m.comparableMedianPricePerSqm)) ? Number(m.comparableMedianPricePerSqm) : 0,
      status: str(m.status, 80),
    };
  }
  return out;
}

function sanitizeReport(raw: any): any {
  const source = raw && typeof raw === "object" ? raw : {};
  const property = (source.property && typeof source.property === "object") ? source.property : {};
  const location = (source.location && typeof source.location === "object") ? source.location : {};
  const estimate = sanitizeEstimate(source.estimate);
  const out: Record<string, unknown> = {
    property: {
      purpose: str(property.purpose, 80),
      type: str(property.type, 40),
      typeLabel: str(property.typeLabel, 80),
      kind: property.kind === "built" ? "built" : property.kind === "land" ? "land" : "",
      area: num(property.area),
      corner: !!property.corner,
      floorArea: num(property.floorArea),
      floors: str(property.floors, 20),
      ageBand: str(property.ageBand, 20),
      construction: str(property.construction, 40),
      features: Array.isArray(property.features) ? property.features.map((f: unknown) => str(f, 40)).slice(0, 20) : [],
    },
    location: {
      region: str(location.region, 80),
      province: str(location.province, 80),
      town: str(location.town, 80),
      barangay: str(location.barangay, 120),
      address: str(location.address, 200),
      streetListed: !!location.streetListed,
      lat: location.lat == null ? null : num(location.lat),
      lng: location.lng == null ? null : num(location.lng),
    },
    estimate,
    asOf: str(source.asOf, 60),
    disclaimer: str(source.disclaimer, 800),
    trusted: false,
    note: "All figures are client-supplied via the public estimator and were NOT recomputed server-side.",
  };
  return out;
}

async function buildPdf(p: any) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595.28, 841.89]);
  let y = page.getHeight() - 48;
  const W = page.getWidth();
  const navy = rgb(0.12, 0.16, 0.23);
  const tan = rgb(0.49, 0.33, 0.11);
  const gray = rgb(0.36, 0.4, 0.44);
  let currentPart = "";

  function newPage() {
    page = doc.addPage([595.28, 841.89]);
    y = page.getHeight() - 48;
    page.drawText("SEA ESTATES", { x: 48, y, size: 11, font: bold, color: navy });
    y -= 20;
    if (currentPart) { page.drawText(currentPart + " - continued", { x: 48, y, size: 10, font: bold, color: tan }); y -= 24; }
  }

  function ensure(space: number) {
    if (y < 60 + space) newPage();
  }

  function heading(text: string, color = navy) {
    if (/^0[1-6] /.test(text)) currentPart = "";
    ensure(28);
    if (/^0[1-6] /.test(text)) currentPart = text;
    page.drawText(text, { x: 48, y, size: 13, font: bold, color });
    y -= 8;
    page.drawRectangle({ x: 48, y: y - 3, width: 90, height: 2, color: tan });
    y -= 20;
  }

  function line(label: string, value: string) {
    const labels = wrap(bold, label, 130), lines = wrap(font, value, W - 238);
    ensure(Math.min(Math.max(labels.length, lines.length, 1) * 13 + 4, 650));
    for (let i = 0; i < Math.max(labels.length, lines.length, 1); i++) {
      ensure(13);
      if (labels[i]) page.drawText(labels[i], { x: 48, y, size: 9, font: bold, color: gray });
      if (lines[i]) page.drawText(lines[i], { x: 190, y, size: 9, font, color: navy });
      y -= 13;
    }
    y -= 4;
  }

  function para(text: string, size = 9, color = gray) {
    const lines = wrap(font, text, 500);
    for (const l of lines) {
      ensure(size + 3);
      page.drawText(l, { x: 48, y, size, font, color });
      y -= size + 3;
    }
  }

  page.drawText("SEA ESTATES", { x: 48, y, size: 18, font: bold, color: navy });
  page.drawText("Batangas Value Guide - Planning Report", { x: 48, y: y - 18, size: 11, font: bold, color: tan });
  page.drawText("SEA ESTATES · seaestate@gmail.com · 0905 307 9119", { x: 48, y: y - 32, size: 8, font, color: gray });
  y -= 46;
  const report = p.report || {};
  const property = report.property || {};
  const location = report.location || {};
  const analysis = report.analysis || {};
  const estimate = report.estimate || {};
  heading("01 Valuation Summary");
  if (Number(estimate.marketGuideEstimate) > 0) {
    line("Central planning estimate", moneyPdf(estimate.marketGuideEstimate));
    line("Planning scenario range", moneyPdf(estimate.low) + " - " + moneyPdf(estimate.high) + " (85%-130%; not statistical confidence)");
    line(str(estimate.birReferenceLabel, 120) || "Separate BIR zonal reference", moneyPdf(estimate.birZonalValue));
    line("Calculation / data version", str(estimate.calculationVersion, 50) + " / " + str(estimate.dataVersion, 60));
    line("Selected planning method", str(estimate.planningMethodLabel, 120) || "Factor-based planning guide");
    if (estimate.referenceVerification) {
      line("Government applicability", estimate.referenceVerification.label + " (client-supplied status; not server verified)");
      line("Schedule / dataset dates", estimate.referenceVerification.scheduleEffectiveDate + " / " + estimate.referenceVerification.datasetGeneratedAt);
      line("Verification attempt / success", estimate.referenceVerification.lastAttemptedCheck + " / " + (estimate.referenceVerification.successfullyVerifiedOn || "Not verified"));
      line("Import/download date", estimate.referenceVerification.importDate || "Not established separately");
      para(estimate.referenceVerification.verificationNote);
    }
  }

  heading("Property");
  line("Type", property.typeLabel || str(property.type, 80) || "—");
  line("Classification", (property.kind === "built" ? "Built (land + replacement construction)" : property.kind === "land" ? "Land" : "—"));
  line("Lot / land area", num(property.area) > 0 ? num(property.area) + " sqm" : "—");
  if (property.kind === "built") {
    line("Floor / built-up area", num(property.floorArea) > 0 ? num(property.floorArea) + " sqm" : "auto");
    line("Age band", str(property.ageBand, 40) || "Not supplied");
    line("Construction", str(property.construction, 40) || "Not supplied");
  }

  heading("Location");
  line("Pinned coordinates", (location.lat != null && location.lng != null) ? num(location.lat).toFixed(6) + ", " + num(location.lng).toFixed(6) : "—");
  line("Address", location.address || "—");
  line("Town", location.town || "—");
  line("Barangay", location.barangay || "—");
  line("Province", location.province || "—");
  line("Region", location.region || "—");

  if (analysis.present > 0) {
  heading("Nearby establishments (within 1 km — OpenStreetMap scan)");
  if (analysis.present > 0) {
    for (const [k, v] of Object.entries(analysis.nearbyCounts || {})) {
      line(str(k, 40), String(num(v)) + (num(v) > 0 ? "" : " (none)"));
    }
  } else {
    para("No nearby establishment data was found for this pin at scan time.", 9, gray);
  }

  heading("Neighborhood analysis");
  const tags = Array.isArray(analysis.tags) ? analysis.tags.join(", ") : "—";
  line("Neighborhood tags", tags);
  const highlights = Array.isArray(analysis.highlights) ? analysis.highlights.join(" · ") : "—";
  line("Highlights", highlights || "None");
  const risks = Array.isArray(analysis.risks) ? analysis.risks.join(" · ") : "—";
  line("Risks", risks || "None");

  heading("Location scores /100");
  const scoreRows: Array<[string, number]> = [
    ["Accessibility", num(analysis.accessibilityScore)],
    ["Traffic load", num(analysis.trafficScore)],
    ["Population", num(analysis.populationScore)],
    ["Future development", num(analysis.futureDevScore)],
    ["Competition", num(analysis.competitionScore)],
    ["Commercial growth", num(analysis.commercialGrowthScore)],
  ];
  for (const [k, v] of scoreRows) line(k, String(v));
  } else {
    para("Neighborhood and location scores were not assessed by this property guide.", 9, gray);
  }

  heading("02 Detailed Computation and Legal Basis");
  const hasEstimate = Number(estimate.marketGuideEstimate) > 0;
  const hasComparableContext = estimate.marketGuideAvailable === true;
  if (estimate && (estimate.birZonalValue || estimate.total)) {
    line(str(estimate.birReferenceLabel, 120) || "Official BIR zonal value", moneyPdf(estimate.birZonalValue || estimate.total));
    if (hasEstimate) {
      line("Central planning estimate", moneyPdf(estimate.marketGuideEstimate));
      line("Upper planning scenario", moneyPdf(estimate.high));
      line("Comparable listing context", hasComparableContext ? "Available; asking prices are context only and are not direct calculation inputs." : "No comparable asking listings were available; the estimate uses the disclosed BIR-based factors.");
    } else {
      line("Recommended asking price", "Unavailable for this location and classification");
    }
    line("BIR rate per sqm", moneyPdf(estimate.birZonalRatePerSqm || estimate.perSqm) + " on " + num(estimate.area) + " sqm");
    line("Land component", moneyPdf(estimate.landValue || estimate.birZonalValue));
    if (property.kind === "built") {
      line("Improvement component", moneyPdf(estimate.improvement) + " (" + num(estimate.depreciatedPct) + "% age-depreciated)");
    }
    line("Data coverage", str(estimate.coverage, 40) || "good");
    /* Audit trail: show the arithmetic so a reader can check it, not just the
     * answer. Factors are echoed from the sanitized clone, never recomputed. */
    if (estimate.timeIndex) {
      const t = estimate.timeIndex;
      line("Original reference rate", moneyPdf(t.originalRate) + "/sqm (unchanged)");
      line("Indexed reference rate", String(Math.round(t.rawRate * 100) / 100) + " PHP/sqm (display rounded)");
      line("Annual change / dates", t.annualPct + "% / " + t.baseDate + " to " + t.targetDate + " / " + t.source);
      line("Indexed land amount", moneyPdf(t.landAmount));
      para("No stacked market, region, corner or property-use multipliers are applied to this indexed scenario.");
      para(t.formula + ". " + t.note + " Full precision used before final land rounding.");
    } else if (estimate.landPerSqm > 0 && estimate.proxyFactor > 0) {
      line("Effective land rate build-up",
        moneyPdf(estimate.birZonalRatePerSqm) + "/sqm BIR base" +
        (estimate.cornerApplied ? " x (1+" + num(Math.round(Number(estimate.cornerPct || 0) * 1000) / 10) + "% corner)" : " (no corner adj.)") +
        " x " + num(estimate.proxyFactor) + " use x " + num(estimate.bandMid) + " band x " + num(estimate.regionalAdj) + " region" +
        " = " + moneyPdf(estimate.landPerSqm) + "/sqm");
    }
    if (estimate.buildCostPerSqm > 0) {
      line("Improvement build-up",
        moneyPdf(estimate.buildCostPerSqm) + "/sqm RCN" +
        " x " + num(estimate.floorArea || property.floorArea) + " sqm built-up area" +
        " x storeys " + num(estimate.floorsMultiplier) +
        " less " + num(estimate.depreciatedPct) + "% depreciation (age midpoint " + num(estimate.ageMidpoint) + " yrs)" +
        (Number(estimate.featuresTotal) > 0 ? " + " + moneyPdf(Number(estimate.featuresTotal)) + " improvements" : ""));
    }
    if (estimate.occupancy || estimate.titleStatus || estimate.inheritanceStatus) {
      line("Ownership/title review", "Occupancy: " + str(estimate.occupancy, 50) + " · title: " + str(estimate.titleStatus, 60) + " · inheritance: " + str(estimate.inheritanceStatus, 50));
      line("Indicative marketability adjustment", estimate.ownershipAdjustmentPct ? "-" + num(estimate.ownershipAdjustmentPct) + "%" : "None recorded");
    }
  } else {
    para("No estimate was produced for this location (not yet a covered Batangas town). Our team can check it on the ground.", 9, gray);
  }

  /* Provenance block: basis, source of record, order of adjustments, and what
   * the guide does not cover. This is the part that makes the figure auditable
   * once the PDF is separated from the website. */
  const prov: any = estimate && estimate.provenance;
  if (prov && (prov.basisOfValue || (prov.sources && prov.sources.length))) {
    y -= 10;
    ensure(70);
    page.drawText("Basis and provenance", { x: 48, y, size: 10, font: bold, color: navy });
    y -= 18;
    if (prov.basisOfValue) line("Basis of value", str(prov.basisOfValue, 80));
    if (prov.basisNote) para(str(prov.basisNote, 300), 8, gray);
    for (const s of prov.sources) {
      line(str(s.instrument, 80) + " - " + str(s.authority, 60),
        str(s.coverage, 110) + " · eff " + str(s.effectiveDate, 20) +
        (s.revision ? " · " + str(s.revision, 20) : "") + " · " + str(s.status, 30));
    }
    if (prov.currencyCheckedOn) {
      line("Schedule currency check", "Checked " + str(prov.currencyCheckedOn, 20) +
        (prov.nextCurrencyReview ? "; next review " + str(prov.nextCurrencyReview, 20) : ""));
    }
    if (prov.order && prov.order.length) {
      para("Order of adjustments: " + prov.order.join(" -> "), 8, gray);
    }
    if (prov.rangeMeaning) para(str(prov.rangeMeaning, 300), 8, gray);
    if (prov.limitations && prov.limitations.length) {
      para("This guide does not cover: " + prov.limitations.join(" "), 8, gray);
    }
  }

  y -= 10;
  ensure(40);
  heading("03 Transaction Costs and Inheritance");
  const costs = FINANCE.transaction({}, estimate.marketGuideEstimate, { ...(estimate.costOptions || {}), salePrice: estimate.salePrice, birZonalValue: estimate.taxReferenceValue != null ? estimate.taxReferenceValue : estimate.birZonalValue, marketGuideEstimate: estimate.marketGuideEstimate, transactionPrice: estimate.marketGuideEstimate });
  if (costs.available) {
    line("Entered/assumed price", moneyPdf(costs.projectedTransactionPrice));
    line("Illustrative tax base", moneyPdf(costs.base) + " / " + costs.baseBasis);
    line("Capital gains tax 6%", moneyPdf(costs.cgt));
    line("Documentary stamp tax ~1.5%", moneyPdf(costs.dst));
    line("Transfer illustration ~0.5%", moneyPdf(costs.transfer));
    line("Registration estimate ~0.1%", moneyPdf(costs.registration));
    line("All transaction costs", moneyPdf(costs.total));
    line("After all transaction costs", moneyPdf(costs.netAfterAllTransactionCosts) + " (before broker/notary; all four costs deducted)");
    line("Seller commission scenario " + num(costs.brokerPct * 100) + "%", moneyPdf(costs.broker));
    line("Seller-paid costs / proceeds", moneyPdf(costs.sellerCosts) + " / " + moneyPdf(costs.projectedNetProceeds) + " (CGT, commission and quoted notary seller-paid)");
    line("Buyer acquisition budget", moneyPdf(costs.buyerTotal));
    line("Decision purpose", str(estimate.purpose, 80) + " / same underlying guide, different party costs");
    para("Qualifying capital-asset sale assumed. Assessor FMV, exemptions and notarial fees are not supplied. Transfer rate depends on the LGU; cities may use up to 0.75%. Confirm actual fees and payer allocation. " + TAX_REFERENCE.taxBaseNote);
    const estate = FINANCE.estate(estimate.marketGuideEstimate);
    line("Property-only estate scenario", moneyPdf(estate.gross) + " less citizen/resident standard deduction " + moneyPdf(estate.standardDeduction) + "; scenario tax " + moneyPdf(estate.tax));
    para(TAX_REFERENCE.estate.note);
  } else {
    line("Tax context", "Quotation required; no universal capital-asset CGT applied");
    if (costs.quotationRequired) { para(costs.note); line("Quoted developer charges", costs.quotedDeveloperFees == null ? "Not supplied" : moneyPdf(costs.quotedDeveloperFees)); line("Buyer acquisition budget", costs.buyerTotal == null ? "Not determined" : moneyPdf(costs.buyerTotal)); }
  }

  heading("04 Market Evidence");
  if (estimate.askingIndication) {
    line("Asking-price indication", moneyPdf(estimate.askingIndication.value));
    line("Observed asking spread", moneyPdf(estimate.askingIndication.low) + " - " + moneyPdf(estimate.askingIndication.high));
    para(estimate.askingIndication.basis + ". " + estimate.askingIndication.method);
  } else para("Insufficient qualified asking evidence for a numerical indication. The factor guide is not calibrated to completed sales.");
  line("Source match", str(estimate.sourceLevel, 80) || "Not supplied");
  line("Comparable evidence", hasComparableContext ? str(estimate.marketGuide?.comparableCount, 20) + " listing(s), context only; not calculation inputs" : "No comparable asking listings available. Disclosed factors were used.");
  heading("05 Documents and Filing Guide");
  for (const item of TAX_REFERENCE.sellerDocuments) para("Seller: " + item);
  for (const item of TAX_REFERENCE.buyerDocuments) para("Buyer: " + item);
  for (const step of TAX_REFERENCE.steps) para(step.n + ". " + step.label + " / " + step.where + " / " + step.deadline);
  heading("06 Pricing Scenarios and Limitations");
  line("Lower planning scenario (85%)", moneyPdf(estimate.low));
  line("Central planning estimate", moneyPdf(estimate.marketGuideEstimate));
  line("Upper planning scenario (130%)", moneyPdf(estimate.high));
  para("Scenario endpoints are reference points, not mandatory walk-away or listing prices. No certified-appraisal or PVS-compliance claim is made. Valuation inputs are client-supplied and not verified by a site or document inspection.");
  const contact = report.contact || {};
  if (contact.purpose) line("Client purpose", str(contact.purpose, 80));
  if (contact.budget) line("Client budget", str(contact.budget, 80));
  if (contact.timeline) line("Client timeline", str(contact.timeline, 80));
  if (contact.notes) line("Client notes", str(contact.notes, 240));
  y -= 6;
  para("Reference data as of " + str(report.asOf, 40) + ". " + str(report.disclaimer, 600), 8, gray);
  para("Generated by SEA ESTATES. Review the source schedule, match level, and stated calculation factors. Property condition, title, local evidence, and buyer demand can affect transaction value. For a formal valuation assignment, request a licensed real estate appraiser's site and document review.", 8, gray);

  const pages = doc.getPages();
  pages.forEach((sheet, i) => sheet.drawText("SEA ESTATES | Planning guide | Page " + (i + 1) + " of " + pages.length, { x: 48, y: 28, size: 8, font, color: gray }));
  const bytes = await doc.save();
  return bytes;
}

function emailHtml(p: any) {
  const report = p.report || {};
  const property = report.property || {};
  const location = report.location || {};
  const estimate = report.estimate || {};
  const hasEstimate = Number(estimate.marketGuideEstimate) > 0;
  const hasComparableContext = estimate.marketGuideAvailable === true;
  const rows = [
    ["Property type", esc(property.typeLabel || property.type || "—")],
    ["Area", esc((num(property.area) || "—") + " sqm") + (property.kind === "built" ? " · " + esc((num(property.floorArea) || "auto") + " sqm floor") : "")],
    ["Location", esc([location.town, location.barangay, location.address].filter(Boolean).join(" · ") || "Pinned location")],
    ["BIR reference / central planning estimate", hasEstimate ? esc(money(estimate.birZonalValue || 0)) + " BIR reference · planning estimate " + esc(money(estimate.marketGuideEstimate)) : (estimate.birZonalValue ? esc(money(estimate.birZonalValue)) + " BIR reference" : "Not estimated")],
    ["Planning range", hasEstimate ? esc(money(estimate.low)) + " - " + esc(money(estimate.high)) + " (85%-130% scenarios)" : "Not estimated"],
    ["Comparable listing context", hasComparableContext ? "Available; asking-listing prices are not direct calculation inputs." : "No comparable asking listings available; guide uses disclosed BIR-based factors."],
  ].map((r) => "<tr><td style='padding:6px 12px;font-size:13px;color:#5f6771'>" + r[0] + "</td><td style='padding:6px 12px;font-size:13px;font-weight:700;color:#1e2a3a'>" + r[1] + "</td></tr>").join("");
  /* Same provenance as the PDF, so the email alone still explains the figure. */
  const prov: any = estimate.provenance;
  const provHtml = prov && (prov.basisOfValue || (prov.sources && prov.sources.length))
    ? '<div style="margin:4px 0 16px;padding:12px;border:1px solid #e8e2d7;border-radius:10px;background:#fdfaf5">' +
      '<div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#7d531d;margin-bottom:8px">Basis and provenance</div>' +
      (prov.basisOfValue ? '<p style="margin:0 0 6px;font-size:13px;color:#1e2a3a"><b>' + esc(str(prov.basisOfValue, 80)) + "</b></p>" : "") +
      (prov.basisNote ? '<p style="margin:0 0 8px;font-size:12px;color:#5f6771;line-height:1.6">' + esc(str(prov.basisNote, 300)) + "</p>" : "") +
      (prov.sources || []).map((s: any) =>
        '<p style="margin:0 0 4px;font-size:12px;color:#374151;line-height:1.6"><b>' + esc(str(s.instrument, 80)) + "</b> &middot; " + esc(str(s.coverage, 110)) +
        '<br><span style="color:#6b7280">eff ' + esc(str(s.effectiveDate, 20)) +
        (s.revision ? " &middot; " + esc(str(s.revision, 20)) : "") +
        " &middot; " + esc(str(s.status, 30)) + "</span></p>").join("") +
      (Number(estimate.landPerSqm) > 0 && Number(estimate.proxyFactor) > 0
        ? '<p style="margin:8px 0 0;font-size:12px;color:#374151;line-height:1.6">Land rate build-up: ' +
          esc(money(estimate.birZonalRatePerSqm)) + "/sqm BIR base" +
          (estimate.cornerApplied ? " &times; (1+" + esc(String(Math.round(Number(estimate.cornerPct || 0) * 1000) / 10)) + "% corner)" : " (no corner adjustment)") +
          " &times; " + esc(num(estimate.proxyFactor)) + " use &times; " + esc(num(estimate.bandMid)) + " band &times; " + esc(num(estimate.regionalAdj)) + " region = <b>" + esc(money(estimate.landPerSqm)) + "/sqm</b></p>"
        : "") +
      (prov.rangeMeaning ? '<p style="margin:8px 0 0;font-size:12px;color:#5f6771;line-height:1.6">' + esc(str(prov.rangeMeaning, 300)) + "</p>" : "") +
      (prov.limitations && prov.limitations.length
        ? '<p style="margin:8px 0 0;font-size:12px;color:#5f6771;line-height:1.6"><b>Not covered:</b> ' +
          esc(prov.limitations.slice(0, 10).map((l: unknown) => str(l, 220)).join(" ")) + "</p>"
        : "") +
      "</div>"
    : "";
  return [
    '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">',
    '<div style="font-weight:800;font-size:18px;color:#1e2a3a;margin-bottom:4px">SEA ESTATES</div>',
    '<div style="font-size:15px;font-weight:700;color:#7d531d;margin-bottom:14px">Your full Location Analysis Report</div>',
    '<p style="font-size:14px;color:#374151;line-height:1.6">Hi ' + esc(p.full_name || "") + ',</p>',
    '<p style="font-size:14px;color:#374151;line-height:1.6">Thanks for your interest. Attached is the full location analysis for your property — nearby establishments, neighborhood scores, and the indicative estimate described below.</p>',
    '<table style="width:100%;border-collapse:collapse;margin:8px 0 16px">' + rows + "</table>",
    provHtml,
    '<p style="font-size:12px;color:#6b7280;line-height:1.6">Your details have been sent to the SEA ESTATES team. Reply to this email if you have a question about your report.</p>',
    '<p style="font-size:12px;color:#6b7280;line-height:1.6">Your guide shows the reference and factors used. A site and document review can refine it for your property.</p>',
    "</div>",
  ].join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST, OPTIONS" },
    });
  }

  let body: any;
  try {
    body = await readJsonLimited(req);
  } catch (e) {
    if (e instanceof BodyError) return json({ error: e.message }, e.status);
    return json({ error: "Invalid JSON body" }, 400);
  }

  const email = str(body.email, 254).toLowerCase();
  const fullName = str(body.full_name, 160);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "email is invalid" }, 400);
  if (!fullName) return json({ error: "full_name is required" }, 400);
  if (body.consent !== true) return json({ error: "consent is required" }, 400);

  const idempotencyKey = str(req.headers.get("idempotency-key") || "", 200);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration is incomplete" }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const pepper = Deno.env.get("INQUIRY_RATE_LIMIT_SALT") || serviceRoleKey.slice(-32);

  const forwarded = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const keyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pepper + ":" + forwarded + ":public")).then((b) => {
    return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
  });
  const { data: permitted, error: rateError } = await admin.rpc("consume_listing_inquiry_rate_limit", {
    p_request_key_hash: keyHash,
    p_limit: 10,
    p_window_seconds: 3600,
  });
  if (rateError) return json({ error: rateError.message }, 500);
  if (!permitted) return json({ error: "Too many requests. Please try again later" }, 429);

  const now = new Date().toISOString();

  // Idempotency: a retried submit with the same key returns the original lead
  // instead of creating a duplicate CRM record / duplicate follow-up email.
  if (idempotencyKey) {
    const { data: existing } = await admin
      .from("crm_leads")
      .select("id,ref")
      .eq("payload->>idempotencyKey", idempotencyKey)
      .maybeSingle();
    if (existing && existing.id) {
      return json({ ok: true, id: existing.id, ref: existing.ref, duplicated: true, emailSkipped: false, pdfSent: false });
    }
  }

  const report = sanitizeReport(body.report);
  const location = report.location || {};
  const estimate = report.estimate || {};
  const inquiryType = str(body.inquiry_type, 80) === "professional-appraisal-request"
    ? "professional-appraisal-request"
    : str(body.inquiry_type, 80) === "broker-consultation"
      ? "broker-consultation"
      : "location-analysis";
  /* The service the user asked for, carried on the lead so the CRM can route it
     without reading the message. `service_requested` is the human label shown in
     the lead list; `inquiry_type` is the machine value. */
  const serviceRequested = inquiryType === "professional-appraisal-request"
    ? "Appraisal consultation"
    : inquiryType === "broker-consultation"
      ? "Broker consultation"
      : "Location analysis report";
  const summary = [
    inquiryType === "professional-appraisal-request" ? "Professional appraisal consultation request" : inquiryType === "broker-consultation" ? "Broker consultation request" : "Location analysis full report request",
    location.town ? "Town: " + location.town + (location.barangay ? " · " + location.barangay : "") : "",
    location.address ? "Address: " + location.address : "",
    Number(estimate.marketGuideEstimate) > 0 ? "Central planning estimate: " + money(estimate.marketGuideEstimate) + " · " + (estimate.marketGuideAvailable === true ? "asking listings shown as context" : "no comparable asking listings available") : (estimate.birZonalValue ? "BIR zonal reference: " + money(estimate.birZonalValue) + " · no estimate available" : "Not estimated"),
    estimate.birZonalValue ? "BIR zonal: " + money(estimate.birZonalValue) : "",
    body.purpose ? "Purpose: " + str(body.purpose, 80) : "",
    body.budget ? "Budget: " + str(body.budget, 80) : "",
    body.timeline ? "Timeline: " + str(body.timeline, 80) : "",
    body.notes ? "Notes: " + str(body.notes, 800) : "",
  ].filter(Boolean).join(" | ");

  let adminId: string;
  try {
    adminId = (await requireAdmin(admin)).id;
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "No super-admin account is configured" }, 500);
  }

  const leadId = "lead-" + crypto.randomUUID();
  const ref = "LOC-" + leadId.slice(-8).toUpperCase();
  const lead = {
    id: leadId,
    ref,
    name: fullName || email || "Website lead",
    assigned_to: "",
    assigned_to_id: null,
    created_by: adminId,
    updated_at: now,
    payload: {
      id: leadId,
      ref,
      name: fullName || email || "Website lead",
      phone: str(body.phone, 50),
      email,
      type: "buyer",
      source: "website",
      status: "new",
      consent: true,
      origin: "storefront",
      channel: inquiryType,
      /* Label the requested service on the lead so the CRM routes it without
         parsing prose. Shown in the lead list; never a pricing input. */
      serviceRequested: serviceRequested,
      serviceTransacted: null,
      propertyInterest: report.property?.typeLabel || "Location analysis report",
      notes: summary,
      assignedTo: "",
      assignedToId: null,
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
      activity: [{ date: now, text: inquiryType === "professional-appraisal-request" ? "Professional appraisal consultation requested from the website." : inquiryType === "broker-consultation" ? "Broker consultation requested from the website." : "Full location analysis report requested from the website." }],
      fullReport: report,
      idempotencyKey,
    },
  };
  const { error: leadError } = await admin.from("crm_leads").insert(lead);
  if (leadError) return json({ error: leadError.message }, 500);

  // Archive copy for super-admins. Best-effort: the lead is already saved.
  try {
    const { error: auditError } = await admin.from("storefront_inquiries").insert({
      inquiry_type: inquiryType,
      user_id: null,
      full_name: fullName,
      phone: str(body.phone, 50),
      email,
      message: summary,
      consent_at: now,
      source: "value-guide",
      metadata: { crmLeadId: leadId, ref },
    });
    if (auditError) console.error("storefront_inquiries audit insert failed", auditError.message);
  } catch (e) {
    console.error(e);
  }

  let emailSkipped = false;
  let pdfSent = false;
  try {
    // Keep the PDF's bytes small and bounded: only the sanitized report clone
    // (capped to MAX_ESTIMATE_JSON_BYTES) feeds the generator.
    const pdfReport = JSON.parse(JSON.stringify({ report, full_name: fullName, email }));
    const pdfBytes = await buildPdf(pdfReport);
    // Chunked: spreading a large PDF into one call overflows the stack.
    let binary = "";
    for (let i = 0; i < pdfBytes.length; i += 0x8000) {
      binary += String.fromCharCode(...pdfBytes.subarray(i, i + 0x8000));
    }
    const b64 = btoa(binary);
    if (RESEND_API_KEY) {
      const subjectPrefix = inquiryType === "professional-appraisal-request"
        ? "Your SEA ESTATES Property Value Report — "
        : inquiryType === "broker-consultation"
          ? "Your SEA ESTATES Property Value Report — "
          : "Your SEA ESTATES Location Analysis Report — ";
      const attachmentName = inquiryType === "location-analysis"
        ? "SEA-ESTATES-Location-Analysis.pdf"
        : "SEA-ESTATES-Property-Value-Report.pdf";
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + RESEND_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: MAIL_FROM,
          to: [email],
          subject: subjectPrefix + (location.town || "pin"),
          html: emailHtml({ full_name: fullName, report }),
          attachments: [{ filename: attachmentName, content: b64 }],
        }),
      });
      pdfSent = resp.ok;
      if (!resp.ok) {
        emailSkipped = true;
        console.error("Resend rejected the report email", resp.status, await resp.text().catch(() => ""));
      }
    } else {
      emailSkipped = true;
    }
  } catch (e) {
    console.error("report PDF/email failed", e);
    emailSkipped = true;
  }

  return json({
    ok: true,
    id: leadId,
    ref,
    message: "Location analysis report queued",
    emailSkipped,
    pdfSent,
  }, 201);
});

async function requireAdmin(admin: any) {
  const { data: adminAccount, error: adminError } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "super-admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (adminError || !adminAccount) throw new BodyError(500, "No super-admin account is configured");
  return adminAccount;
}
