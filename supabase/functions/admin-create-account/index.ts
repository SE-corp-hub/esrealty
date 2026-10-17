import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const fullName = String(body.full_name || "").trim();
  const role = String(body.role || "buyer");
  const prc = String(body.prc || "").trim() || null;
  const resa = String(body.resa || "").trim() || null;
  const agency = String(body.agency || "").trim() || null;
  const broker = String(body.broker || "").trim() || null;
  const roles = ["super-admin", "broker", "agent", "buyer", "seller", "owner", "tenant"];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "A valid email is required" }, 400);
  if (password.length < 6) return json({ error: "Temporary password must be at least 6 characters" }, 400);
  if (!fullName) return json({ error: "Full name is required" }, 400);
  if (!roles.includes(role)) return json({ error: "Invalid role" }, 400);
  if (role === "broker" && !prc) return json({ error: "Broker PRC license is required" }, 400);
  if (role === "agent" && !broker) return json({ error: "Agents must be linked to a supervising broker" }, 400);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // The temporary password must be changed at first sign-in (the app sends the
    // user to Settings until they do).
    user_metadata: { full_name: fullName, requested_role: role, must_change_password: true },
  });
  if (createError || !created.user) return json({ error: createError?.message || "Could not create account" }, 400);

  const profile = {
    id: created.user.id,
    full_name: fullName,
    role,
    registration_status: "pending",
    prc,
    resa,
    agency,
    broker,
  };
  const { error: profileError } = await admin.from("profiles").upsert(profile, { onConflict: "id" });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: "Could not create account profile: " + profileError.message }, 500);
  }

  await admin.from("audit_events").insert({
    owner_id: authData.user.id,
    event_type: "manual_create",
    entity_type: "profile",
    entity_id: created.user.id,
    detail: { role },
  });

  return json({ id: created.user.id });
});
