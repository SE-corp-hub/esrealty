import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-dispatch-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Same-length comparison that doesn't stop at the first different character.
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function addDays(d: Date, n: number) {
  const t = new Date(d);
  t.setDate(t.getDate() + n);
  return t;
}

// Deterministic "what comes next" after a task completes. No LLM, no guessing:
// the ladder is derived from facts already on the task. Both the client tick
// (js/app.js) and this worker share the same kind→recheck rules.
function nextRecheck(task: any): { due: Date; reason: string } | null {
  const kind = String(task?.kind ?? "follow-up");
  if (task?.lead_id) {
    if (String(task?.task_meta?.status) === "closed" || String(task?.task_meta?.status) === "lost") {
      return null; // agent_snooze_lead should have cancelled open work already.
    }
  }
  switch (kind) {
    case "stale-new": return { due: addDays(new Date(), 2), reason: "Stale new lead — recheck for a reply or status change" };
    case "contacted": return { due: new Date(), reason: "Follow-up date passed — surface to the owner's pipeline" };
    case "site-visit": return { due: addDays(new Date(), 1), reason: "Upcoming site visit — recheck booking status" };
    case "negotiation": return { due: addDays(new Date(), 2), reason: "Offer in play — recheck for movement" };
    case "dormant": return { due: addDays(new Date(), 7), reason: "Dormant control — no artificial work, hold" };
    case "compliance": return { due: addDays(new Date(), 1), reason: "Compliance record expiring — renew or update the registry" };
    default: return { due: addDays(new Date(), 2), reason: "Follow-up scheduled on completion" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("authorization") ?? "";
  const secretHeader = req.headers.get("x-agent-dispatch-secret") ?? "";
  const DISPATCH_SECRET = Deno.env.get("AGENT_DISPATCH_SECRET") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const okSecret = !!DISPATCH_SECRET && sameSecret(secretHeader, DISPATCH_SECRET);
  const okService = !!SERVICE_KEY && sameSecret(authHeader, "Bearer " + SERVICE_KEY);
  if (!okSecret && !okService) return json({ ok: false, error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (!url || !SERVICE_KEY) return json({ ok: true, skipped: "No SUPABASE_URL / SERVICE_ROLE_KEY configured" });
  const supabase = createClient(url, SERVICE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const pMax = Math.max(1, Math.min(25, Number(body?.max) || 10));

  const { data: claimed, error } = await supabase.rpc("agent_claim_due", { p_max: pMax });
  if (error) {
    console.error("agent-dispatch claim failed", error.message);
    return json({ ok: false, error: "Could not claim tasks" }, 500);
  }
  if (!Array.isArray(claimed) || claimed.length === 0) return json({ ok: true, claimed: 0, done: 0 });

  let done = 0, skipped = 0;
  for (const task of claimed) {
    const next = nextRecheck(task);
    if (!next) { skipped++; continue; } // closed/lost — nothing to schedule.
    const steps = [{
      lead_id: task.lead_id,
      kind: "observation",
      summary: "Follow-up due — " + (task.reason || task.kind || "scheduled work"),
      detail: { kind: task.kind, due_at: task.due_at, reason: task.reason },
      confident: true,
      done_by: "agent",
    }];
    const { error: cerr } = await supabase.rpc("agent_complete", {
      p_task: task.id,
      p_steps: steps,
      p_next_due: next.due.toISOString(),
      p_next_reason: next.reason,
    });
    if (cerr) { skipped++; continue; }
    done++;
  }

  return json({ ok: true, claimed: claimed.length, done, skipped });
});