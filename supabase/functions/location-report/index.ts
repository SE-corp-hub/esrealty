import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

// Value Guide report requests. The team calls the customer to confirm their
// details, then prepares the report in the back office (Value Guide tool) and
// emails it themselves, so this function only saves the request as a CRM lead
// with everything needed to rebuild the report. It sends no email.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BODY_BYTES = 200_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function money(n: unknown) {
  const v = Number(n || 0);
  return "₱" + new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(Math.round(v));
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

// The estimator's own inputs, so the back office can reopen the request in
// the Value Guide tool and rebuild the report exactly.
function sanitizeInputs(raw: any): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const optNum = (v: unknown) => (v === null || v === undefined || v === "" ? null : num(v));
  return {
    purpose: str(raw.purpose, 40),
    type: str(raw.type, 40),
    municipality: str(raw.municipality, 80),
    barangay: str(raw.barangay, 120),
    streetKey: str(raw.streetKey, 200),
    allOther: !!raw.allOther,
    classification: str(raw.classification, 10),
    area: num(raw.area),
    corner: !!raw.corner,
    construction: str(raw.construction, 40),
    floorArea: num(raw.floorArea),
    floors: str(raw.floors, 10),
    ageBand: str(raw.ageBand, 20),
    features: Array.isArray(raw.features) ? raw.features.map((f: unknown) => str(f, 40)).slice(0, 20) : [],
    salePrice: optNum(raw.salePrice),
    saleContext: str(raw.saleContext, 40),
  };
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
    inputs: sanitizeInputs(source.inputs),
    asOf: str(source.asOf, 60),
    disclaimer: str(source.disclaimer, 800),
    trusted: false,
    note: "All figures are client-supplied via the public estimator and were NOT recomputed server-side.",
  };
  return out;
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
  // The team calls to confirm details before sending any report.
  if (!str(body.phone, 50)) return json({ error: "phone is required" }, 400);
  if (body.consent !== true) return json({ error: "consent is required" }, 400);

  const idempotencyKey = str(req.headers.get("idempotency-key") || "", 200);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration is incomplete" }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const pepper = Deno.env.get("INQUIRY_RATE_LIMIT_SALT") || serviceRoleKey.slice(-32);

  // Its own allowance, separate from the listing inquiry and contact forms.
  const forwarded = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const keyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pepper + ":location-report:" + forwarded)).then((b) => {
    return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
  });
  const { data: permitted, error: rateError } = await admin.rpc("consume_listing_inquiry_rate_limit", {
    p_request_key_hash: keyHash,
    p_limit: 10,
    p_window_seconds: 3600,
  });
  if (rateError) {
    console.error("location-report rate limit", rateError.message);
    return json({ error: "Could not process the request. Please try again" }, 500);
  }
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
      return json({ ok: true, id: existing.id, ref: existing.ref, duplicated: true });
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
    console.error("location-report admin lookup", e instanceof Error ? e.message : e);
    return json({ error: "Could not save your request. Please try again" }, 500);
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
      // The team's workflow for this request: call to confirm the details,
      // prepare the report in the Value Guide tool, then email it.
      reportStatus: "awaiting-call",
      idempotencyKey,
    },
  };
  const { error: leadError } = await admin.from("crm_leads").insert(lead);
  if (leadError) {
    // Two taps of the same submit at once: the other one saved it (unique index on
    // the idempotency key, migration 0005). Answer with the saved lead.
    if (leadError.code === "23505" && idempotencyKey) {
      const { data: saved } = await admin.from("crm_leads").select("id,ref").eq("payload->>idempotencyKey", idempotencyKey).maybeSingle();
      if (saved && saved.id) return json({ ok: true, id: saved.id, ref: saved.ref, duplicated: true });
    }
    console.error("location-report lead insert", leadError.message);
    return json({ error: "Could not save your request. Please try again" }, 500);
  }

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

  return json({ ok: true, id: leadId, ref, message: "Request saved" }, 201);
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
