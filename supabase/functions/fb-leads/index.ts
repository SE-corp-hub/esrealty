import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
const PAGE_TOKEN = Deno.env.get("META_PAGE_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const DEFAULT_ASSIGN_EMAIL = Deno.env.get("FB_LEADS_DEFAULT_BROKER_EMAIL") ?? "";
// v19.0 expired on 21 May 2026; v25.0 is supported until July 2028.
const GRAPH_VERSION = (Deno.env.get("META_GRAPH_VERSION") ?? "v25.0").replace(/[^v0-9.]/g, "") || "v25.0";

// Same-length comparison that doesn't stop at the first different character.
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function verifySignature(raw: string, signature: string): Promise<boolean> {
  if (!APP_SECRET) return false; // fail closed: never accept an unsigned webhook
  if (!signature.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return sameSecret(hex, signature.slice(7));
}

function pick(fields: Array<{ name: string; values: string[] }>, keys: string[]): string {
  for (const k of keys) {
    const f = fields.find(f => (f.name || "").toLowerCase() === k);
    if (f && f.values && f.values[0]) return f.values[0];
  }
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);

  // ── Meta webhook verification handshake ────────────────────────────
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && VERIFY_TOKEN && sameSecret(token, VERIFY_TOKEN)) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return json({ ok: false, error: "Verification failed" }, 403);
  }

  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  // ── Signature check (when APP_SECRET configured) ────────────────────
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  if (!(await verifySignature(raw, signature))) {
    return json({ ok: false, error: "Invalid signature" }, 401);
  }

  let body: any;
  try { body = JSON.parse(raw); } catch { return json({ ok: false, error: "Bad JSON" }, 400); }
  if (body.object !== "page") return json({ ok: true, ignored: true });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Default assignee: configured email first, else any approved super-admin.
  let assigneeId: string | null = null;
  if (DEFAULT_ASSIGN_EMAIL) {
    const p = await supabase.from("profiles")
      .select("id").eq("email", DEFAULT_ASSIGN_EMAIL.toLowerCase())
      .eq("registration_status", "approved").limit(1).maybeSingle();
    if (p.data) assigneeId = p.data.id;
  }
  if (!assigneeId) {
    const sa = await supabase.from("profiles")
      .select("id").eq("role", "super-admin")
      .eq("registration_status", "approved").limit(1).maybeSingle();
    if (sa.data) assigneeId = sa.data.id;
  }
  if (!assigneeId) {
    return json({ ok: false, error: "No approved broker/admin to assign leads to" }, 500);
  }

  const results: Array<{ leadgen_id: string; action: string }> = [];
  let failed = 0;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const v = change.value ?? {};
      const leadgenId = String(v.leadgen_id || "");
      if (!leadgenId) continue;

      // dedupe by id
      const existing = await supabase.from("crm_leads")
        .select("id").eq("id", "fb-" + leadgenId).maybeSingle();
      if (existing.data) { results.push({ leadgen_id: leadgenId, action: "duplicate" }); continue; }

      // Fetch the lead's answers. The token goes in a header, not the URL, so it
      // never lands in request logs.
      let fields: Array<{ name: string; values: string[] }> = [];
      let fetchProblem = "";
      if (!PAGE_TOKEN) fetchProblem = "META_PAGE_TOKEN is not set";
      else {
        try {
          const gr = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(leadgenId)}`, {
            headers: { Authorization: "Bearer " + PAGE_TOKEN },
            signal: AbortSignal.timeout(8000),
          });
          const gj = await gr.json().catch(() => ({}));
          if (!gr.ok) fetchProblem = "Graph API " + gr.status + (gj?.error?.message ? ": " + String(gj.error.message).slice(0, 160) : "");
          else fields = Array.isArray(gj.field_data) ? gj.field_data : [];
        } catch (e) {
          fetchProblem = "Graph API unreachable: " + String(e).slice(0, 120);
        }
      }
      if (fetchProblem) console.error("fb-leads", leadgenId, fetchProblem);

      const name = pick(fields, ["full_name", "name"]) || "Facebook Lead";
      const email = pick(fields, ["email"]);
      const phone = pick(fields, ["phone_number", "phone"]);

      const insert = await supabase.from("crm_leads").insert({
        id: "fb-" + leadgenId,
        ref: "FB-" + leadgenId.slice(-6),
        name,
        assigned_to_id: assigneeId,
        payload: {
          status: "new",
          source: "facebook",
          email,
          phone,
          form_id: String(v.form_id || ""),
          page_id: String(v.page_id || ""),
          created_time: v.created_time || "",
          // Still saved when the answers couldn't be fetched, so the team can look the lead up in Meta.
          notes: fetchProblem
            ? "Auto-imported from Facebook Lead Ads, but the answers couldn't be fetched (" + fetchProblem + "). Open the lead in Meta Business Suite, lead id " + leadgenId + "."
            : "Auto-imported from Facebook Lead Ads.",
        },
        created_by: assigneeId,
      });

      if (insert.error) {
        // Meta delivered it twice at once: the other copy saved it. Not a failure.
        if (insert.error.code === "23505") { results.push({ leadgen_id: leadgenId, action: "duplicate" }); continue; }
        console.error("fb-leads insert", leadgenId, insert.error.message);
        results.push({ leadgen_id: leadgenId, action: "insert-failed" });
        failed++;
        continue; // no "new lead" notice for a lead that wasn't saved
      }
      results.push({ leadgen_id: leadgenId, action: fetchProblem ? "created-without-answers" : "created" });

      const note = await supabase.rpc("notify_user", {
        target_user: assigneeId,
        n_type: "lead",
        n_title: "New Facebook lead: " + name,
        n_body: [email, phone].filter(Boolean).join(" · ") || "Open CRM to view details.",
        n_link: "leads",
      });
      if (note.error) console.error("fb-leads notify", leadgenId, note.error.message);
    }
  }

  // A lead that could not be saved must not be answered with 200: Meta only
  // sends the webhook again when it gets an error. Saved leads are skipped on
  // the retry (the id check above), so a retry cannot double them.
  if (failed > 0) return json({ ok: false, error: "Some leads could not be saved", results }, 500);
  return json({ ok: true, results });
});
