import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration is incomplete" }, 500);
  if (!token) return json({ error: "Authentication required" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

  const { data: caller, error: callerError } = await admin
    .from("profiles")
    .select("role, registration_status")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (callerError || caller?.role !== "super-admin" || caller.registration_status !== "approved") {
    return json({ error: "Super Admin access required" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const targetId = String(body.user_id || "").trim();
  if (!targetId) return json({ error: "user_id is required" }, 400);
  if (targetId === authData.user.id) return json({ error: "You cannot delete your own account" }, 400);

  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("full_name, email, role")
    .eq("id", targetId)
    .maybeSingle();
  if (targetError) return json({ error: targetError.message }, 500);
  if (!target) return json({ error: "Account not found" }, 404);

  const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
  if (deleteError) return json({ error: deleteError.message }, 500);

  await admin.from("audit_events").insert({
    owner_id: authData.user.id,
    event_type: "delete_account",
    entity_type: "profile",
    entity_id: targetId,
    detail: { email: target.email, role: target.role },
  });

  return json({ ok: true });
});
