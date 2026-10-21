import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dispatch-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "SEA ESTATES <onboarding@resend.dev>";
const SEMAPHORE_API_KEY = Deno.env.get("SEMAPHORE_API_KEY") ?? "";
const SEMAPHORE_SENDER = Deno.env.get("SEMAPHORE_SENDER") ?? "ESRealty";
const DISPATCH_SECRET = Deno.env.get("NOTIFY_DISPATCH_SECRET") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BATCH = 25;

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

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function emailHtml(title: string, bodyText: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">',
    '<div style="font-weight:800;font-size:18px;color:#1e2a3a;margin-bottom:8px">SEA ESTATES</div>',
    '<div style="font-size:16px;font-weight:700;margin-bottom:6px">' + esc(title) + "</div>",
    '<div style="font-size:14px;color:#374151;line-height:1.5">' + esc(bodyText) + "</div>",
    '<hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0">',
    '<div style="font-size:12px;color:#6b7280">You are receiving this because you have a SEA ESTATES account. Sign in to view details.</div>',
    "</div>",
  ].join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ---- Self-send mode: an authenticated user may email ONLY themselves.
  // Body: { to, subject, html } with Authorization: Bearer <user access token>.
  const authHeader = req.headers.get("authorization") ?? "";
  const secretHeader = req.headers.get("x-dispatch-secret") ?? "";
  const contentType = req.headers.get("content-type") ?? "";
  if (req.method === "POST" && contentType.includes("application/json")) {
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    if (body && typeof body === "object" && body.to && body.subject && !Array.isArray(body)) {
    if (!RESEND_API_KEY) return json({ ok: false, error: "Email not configured — RESEND_API_KEY missing" }, 503);
    // Verify the caller's JWT against GoTrue using the always-injected service key,
    // so this works regardless of legacy/new anon-key injection.
    let email = "";
    let userId = "";
    let vfail = "";
    try {
      const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
      const gotrue = await fetch(base + "/auth/v1/user", {
        headers: { Authorization: authHeader, apikey: SERVICE_KEY },
        signal: AbortSignal.timeout(8000),
      });
      if (gotrue.ok) {
        const ud = await gotrue.json();
        email = String(ud?.email ?? "");
        userId = String(ud?.id ?? "");
        if (!email) vfail = "GoTrue 200 but no email field";
      } else {
        const t = await gotrue.text();
        vfail = "GoTrue " + gotrue.status + " " + t.slice(0, 140);
      }
    } catch (e) {
      vfail = "fetch threw: " + String(e);
    }
    if (!email) {
      // Keep the diagnostic in server logs; never hand internals to the caller.
      console.error("notify-dispatch auth failed:", vfail || "token verify failed");
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
      if (String(body.to).toLowerCase() !== String(email).toLowerCase()) {
        return json({ ok: false, error: "Self-send only: you may only email your own address" }, 403);
      }
      // Only approved accounts, and at most 20 emails an hour each.
      const svc = createClient(Deno.env.get("SUPABASE_URL") ?? "", SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      const me = await svc.from("profiles").select("registration_status").eq("id", userId).maybeSingle();
      if (me.error || me.data?.registration_status !== "approved") {
        return json({ ok: false, error: "Your account must be approved first" }, 403);
      }
      const salt = Deno.env.get("INQUIRY_RATE_LIMIT_SALT") || SERVICE_KEY.slice(-32);
      const { data: allowed, error: limitError } = await svc.rpc("consume_listing_inquiry_rate_limit", {
        p_request_key_hash: await sha256(salt + ":notify-self:" + userId),
        p_limit: 20,
        p_window_seconds: 3600,
      });
      if (limitError) return json({ ok: false, error: "Could not check the sending limit" }, 500);
      if (!allowed) return json({ ok: false, error: "Too many emails. Please try again later" }, 429);
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ from: MAIL_FROM, to: [email], subject: String(body.subject).slice(0, 200), html: String(body.html || "").slice(0, 200000) }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) return json({ ok: false, error: "Resend error " + r.status }, 502);
        return json({ ok: true, sent: true, to: email });
      } catch (e) {
        console.error("notify-dispatch self-send failed", String(e));
        return json({ ok: false, error: "The email service did not answer" }, 502);
      }
    }
  }

  // Auth: shared dispatch secret OR the service-role key.
  const okSecret = !!DISPATCH_SECRET && sameSecret(secretHeader, DISPATCH_SECRET);
  const okService = !!SERVICE_KEY && sameSecret(authHeader, "Bearer " + SERVICE_KEY);
  if (!okSecret && !okService) return json({ ok: false, error: "Unauthorized" }, 401);

  if (!RESEND_API_KEY && !SEMAPHORE_API_KEY) {
    return json({ ok: true, skipped: "No RESEND_API_KEY / SEMAPHORE_API_KEY configured" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    SERVICE_KEY,
  );

  const pending = await supabase.from("notifications")
    .select("id,user_id,type,title,body,emailed_at,sms_sent_at")
    .or("emailed_at.is.null,sms_sent_at.is.null")
    .order("created_at", { ascending: false })
    .limit(BATCH);

  // The notifications table has no emailed_at / sms_sent_at columns today (that migration was
  // never applied), so this bulk mode cannot run. Say so, rather than send the same rows again
  // every time it is called. The self-send mode above does not use them.
  if (pending.error) {
    console.error("notify-dispatch bulk mode unavailable", pending.error.message);
    return json({ ok: false, error: "Bulk sending is not set up. Only the email-me-this mode is available." }, 501);
  }

  let emails = 0, sms = 0, errors = 0;

  for (const n of pending.data ?? []) {
    const prof = await supabase.from("profiles")
      .select("email,phone,full_name").eq("id", n.user_id).maybeSingle();
    const email = prof.data?.email ?? "";
    const phone = prof.data?.phone ?? "";

    // ── Email via Resend ─────────────────────────────────────────────
    if (RESEND_API_KEY && email && !(n as any).emailed_at) {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: MAIL_FROM,
            to: [email],
            subject: "SEA ESTATES — " + (n.title ?? "Notification"),
            html: emailHtml(n.title ?? "", n.body ?? ""),
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) {
          await supabase.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", n.id);
          emails++;
        } else { errors++; }
      } catch { errors++; }
    }

    // ── SMS via Semaphore (PH) — only for urgent types ───────────────
    if (SEMAPHORE_API_KEY && phone && !(n as any).sms_sent_at && ["approval", "lead"].includes(n.type ?? "")) {
      try {
        const msg = "SEA ESTATES: " + (n.title ?? "") + (n.body ? ". " + n.body : "");
        const r = await fetch("https://api.semaphore.co/api/v4/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apikey: SEMAPHORE_API_KEY, number: phone, message: msg.slice(0, 300), sendername: SEMAPHORE_SENDER }),
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) {
          await supabase.from("notifications").update({ sms_sent_at: new Date().toISOString() }).eq("id", n.id);
          sms++;
        } else { errors++; }
      } catch { errors++; }
    }
  }

  return json({ ok: true, scanned: (pending.data ?? []).length, emails, sms, errors });
});
