// The agent pages, directory, check-an-agent and client reviews (agent websites plan). The listing
// function's shared helpers come in through agentRoutes(), so this file imports only types and the Node
// tests load it as it is (tests/agent_sites_node.js).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import type { Limits } from "./limits.ts";

type JsonRecord = Record<string, unknown>;

export type AgentDeps = Limits & {
  HttpError: new (status: number, message: string) => Error;
  json: (body: unknown, status?: number, headers?: Record<string, string>) => Response;
  stringValue: (value: unknown, max: number, field: string, required?: boolean) => string;
  phoneValue: (value: unknown, required: boolean) => string;
  enumValue: (value: unknown, allowed: Set<string>, fallback: string, field: string) => string;
  parseBody: (req: Request, maxBytes?: number) => Promise<JsonRecord>;
  callerAddress: (req: Request) => string;
  sha256: (value: string) => Promise<string>;
  pushNow: (admin: SupabaseClient, userId: string | null) => Promise<number>;
  MAX_FORM_BODY: number;
  PRIVACY_NOTICE_VERSION: string;
  PUBLIC_CACHE: Record<string, string>;
};

export const agentRoutes = (deps: AgentDeps) => {
  const { HttpError, json, stringValue, phoneValue, enumValue, parseBody, callerAddress, sha256, pushNow, limit, firstToday,
    MAX_FORM_BODY, PRIVACY_NOTICE_VERSION, PUBLIC_CACHE } = deps;

  // Agent pages (agent websites plan, Phase 1). The database decides who is public: public_agent()
  // returns a page only for an approved broker or agent with a current licence check (and, for a
  // salesperson, an accepted, licensed supervising broker), and only the fields meant for visitors.
  const AGENT_TAP_KINDS = new Set(["call", "viber", "whatsapp", "messenger", "save"]);
  const AGENT_WANTS: Record<string, string> = { viewing: "Wants a viewing", call: "Wants a call back", question: "Has a question" };

  const agentSlug = (value: string) => {
    const slug = String(value || "").trim().toLowerCase();
    if (slug.length > 70 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new HttpError(404, "Agent not found");
    return slug;
  };

  const findAgent = async (admin: SupabaseClient, slug: string) => {
    const { data, error } = await admin.rpc("public_agent", { p_slug: agentSlug(slug) });
    if (error) throw new Error(error.message);
    if (!data || !(data as JsonRecord).agent_id) throw new HttpError(404, "Agent not found");
    return data as JsonRecord;
  };

  // Once per visitor per agent per day (and per button for taps): the limiter remembers who counted.
  const countAgentOnce = async (req: Request, admin: SupabaseClient, pepper: string, agentId: string, kind: string) => {
    if (!await firstToday(admin, pepper, `agent-${kind}:${agentId}:${callerAddress(req)}`)) return;
    const { error: countError } = await admin.rpc("agent_page_count", { p_agent: agentId, p_kind: kind });
    if (countError) console.error(countError);
  };

  const getAgent = async (req: Request, slug: string, admin: SupabaseClient, pepper: string) => {
    const { agent_id, ...page } = await findAgent(admin, slug);
    // The site's Worker reads the page to write its title into the HTML (?count=0); that is not a visit.
    if (new URL(req.url).searchParams.get("count") !== "0") await countAgentOnce(req, admin, pepper, String(agent_id), "view");
    return json({ data: page });
  };

  const recordAgentTap = async (req: Request, slug: string, admin: SupabaseClient, pepper: string) => {
    const body = await parseBody(req, 2_000);
    const kind = String(body.kind || "");
    if (!AGENT_TAP_KINDS.has(kind)) throw new HttpError(400, "kind is invalid");
    const agent = await findAgent(admin, slug);
    await countAgentOnce(req, admin, pepper, String(agent.agent_id), kind);
    return json({ ok: true }, 202);
  };

  const submitAgentInquiry = async (req: Request, slug: string, admin: SupabaseClient, pepper: string) => {
    const body = await parseBody(req, MAX_FORM_BODY);
    // A hidden field people never see; a bot that fills it is told "sent" and nothing is saved.
    if (String(body.website || "").trim()) return json({ id: null, message: "Sent" }, 201);
    if (body.consent !== true) throw new HttpError(400, "consent is required");
    const fullName = stringValue(body.full_name, 160, "full_name", true);
    const phone = phoneValue(body.phone, true);
    const email = stringValue(body.email, 254, "email");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, "email is invalid");
    const message = stringValue(body.message, 2000, "message");
    const want = enumValue(body.want, new Set(Object.keys(AGENT_WANTS)), "question", "want");
    const section = enumValue(body.section, new Set(["contact", "listing", "header"]), "contact", "section");
    const listingId = stringValue(body.listing_id, 80, "listing_id");
    const idemKey = stringValue(req.headers.get("idempotency-key"), 100, "Idempotency-Key");

    const agent = await findAgent(admin, slug);
    const agentId = String(agent.agent_id);
    if (idemKey) {
      // A resend after a weak signal: the first message already arrived.
      const { data: earlier } = await admin.from("crm_leads").select("id").eq("payload->>idempotencyKey", idemKey).maybeSingle();
      if (earlier) return json({ id: earlier.id, message: "Sent" }, 201);
    }
    await limit(admin, pepper, `agent-inquiry:${agentId}:${callerAddress(req)}`, 5, "Too many messages. Please try again later");

    const { data: adminAccount, error: adminError } = await admin.from("profiles").select("id")
      .eq("role", "super-admin").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (adminError || !adminAccount) throw new HttpError(500, "No super-admin account is configured");

    const listings = Array.isArray(agent.listings) ? agent.listings as JsonRecord[] : [];
    const listing = listingId ? listings.find((l) => l.id === listingId) : undefined;
    const now = new Date().toISOString();
    const leadId = `lead-${crypto.randomUUID()}`;
    const ref = `AG-${leadId.slice(-8).toUpperCase()}`;
    const agentName = String(agent.name || "");
    const interest = listing ? `${AGENT_WANTS[want]}: ${listing.title}` : AGENT_WANTS[want];
    const lead = {
      id: leadId,
      ref,
      name: fullName,
      // Assigned to the agent whose page it came from: the routing and duplicate rules leave an
      // assigned lead alone, and the agent gets the usual "New lead for you" alert.
      assigned_to: agentName,
      assigned_to_id: agentId,
      created_by: adminAccount.id,
      updated_at: now,
      payload: {
        id: leadId, ref, name: fullName, phone, email,
        type: "buyer",
        source: "agent page",
        status: "new",
        consent: true,
        consentRecord: { at: now, notice: PRIVACY_NOTICE_VERSION, channel: "agent-page" },
        origin: "storefront",
        channel: "agent-page",
        agentSlug: String(agent.slug || ""),
        section,
        listingId: listing ? listing.id : "",
        propertyInterest: interest,
        notes: message,
        idempotencyKey: idemKey || undefined,
        assignedTo: agentName,
        assignedToId: agentId,
        createdBy: adminAccount.id,
        createdAt: now,
        updatedAt: now,
        activity: [{ date: now, text: `Message from ${agentName}'s page: ${interest}.` }],
      },
    };
    const { error: leadError } = await admin.from("crm_leads").insert(lead);
    if (leadError) throw new Error(leadError.message);
    const { error: countError } = await admin.rpc("agent_page_count", { p_agent: agentId, p_kind: "message" });
    if (countError) console.error(countError);
    await pushNow(admin, agentId);
    return json({ id: leadId, message: "Sent" }, 201);
  };

  // The agent directory (Phase 2): published agents that pass every check, filtered by the fixed
  // lists, measured reply time first.
  const listAgents = async (url: URL, admin: SupabaseClient) => {
    // ?count=1: just how many, for the site's menu link (no per-agent work).
    if (url.searchParams.get("count") === "1") {
      const { data, error } = await admin.rpc("public_agent_count");
      if (error) throw new Error(error.message);
      return json({ total: Number(data || 0) }, 200, PUBLIC_CACHE);
    }
    const pick = (name: string) => {
      const v = String(url.searchParams.get(name) || "").trim().toLowerCase();
      if (v && !/^[a-z-]{2,40}$/.test(v)) throw new HttpError(400, `${name} is invalid`);
      return v || null;
    };
    const { data, error } = await admin.rpc("public_agents", { p_town: pick("town"), p_need: pick("need"), p_language: pick("language") });
    if (error) throw new Error(error.message);
    const result = (data || {}) as JsonRecord;
    return json({ data: Array.isArray(result.agents) ? result.agents : [], total: Number(result.total || 0) }, 200, PUBLIC_CACHE);
  };

  // Check an agent (Phase 3): a licence number, or a number that contacted you. Matches public pages
  // only; a miss gets a neutral answer from the page, never a list of people.
  const checkAgent = async (req: Request, url: URL, admin: SupabaseClient, pepper: string) => {
    const q = stringValue(url.searchParams.get("q"), 40, "q", true);
    await limit(admin, pepper, `agent-check:${callerAddress(req)}`, 20, "Too many checks. Please try again later");
    const { data, error } = await admin.rpc("agent_check", { p_q: q });
    if (error) throw new Error(error.message);
    return json({ data: Array.isArray(data) ? data.slice(0, 3) : [] });
  };

  // Client reviews (Phase 3). The link's secret is never stored: the database keeps its hash. It is
  // sent in the request body, never in the address, so it stays out of request logs.
  const reviewHash = async (token: unknown) => {
    const t = String(token ?? "");
    if (!/^[0-9a-f]{64}$/.test(t)) throw new HttpError(404, "Review link not found");
    return await sha256(t);
  };
  const getReview = async (req: Request, admin: SupabaseClient) => {
    const body = await parseBody(req, MAX_FORM_BODY);
    const { data, error } = await admin.rpc("review_lookup", { p_hash: await reviewHash(body.token) });
    if (error) throw new Error(error.message);
    if (!data) throw new HttpError(404, "Review link not found");
    return json({ data });
  };
  const submitReview = async (req: Request, admin: SupabaseClient, pepper: string) => {
    const body = await parseBody(req, MAX_FORM_BODY);
    if (body.consent !== true) throw new HttpError(400, "consent is required");
    const firstName = stringValue(body.first_name, 40, "first_name", true);
    const lastName = stringValue(body.last_name, 60, "last_name");
    const words = stringValue(body.review, 1200, "review", true);
    const hash = await reviewHash(body.token);
    await limit(admin, pepper, `review:${callerAddress(req)}`, 10, "Too many requests. Please try again later");
    const { data, error } = await admin.rpc("review_submit", { p_hash: hash, p_first: firstName, p_initial: lastName, p_body: words });
    if (error) throw new HttpError(400, error.message);
    if (data !== true) throw new HttpError(410, "This review link has been used or has expired");
    return json({ message: "Thank you. Your review was sent and will appear after a quick check." }, 201);
  };

  return { getAgent, recordAgentTap, submitAgentInquiry, listAgents, checkAgent, getReview, submitReview };
};
