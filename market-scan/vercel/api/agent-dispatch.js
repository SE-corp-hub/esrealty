"use strict";

// Headless scheduler shim for the CRM Autopilot. Called by a Vercel Cron
// (see vercel.json "crons"). When AGENT_EDGE_URL + AGENT_EDGE_TOKEN are set it
// pings the Supabase agent-dispatch edge function, which claims due tasks and
// writes evidence steps. Without those envs this is a harmless no-op, so local
// development and cold deploys are unaffected.

const AGENT_EDGE_URL = process.env.AGENT_EDGE_URL || "";
const AGENT_EDGE_TOKEN = process.env.AGENT_EDGE_TOKEN || "";
// Vercel sends "Authorization: Bearer <CRON_SECRET>" on cron calls when the
// CRON_SECRET environment variable is set. Nobody else can start a dispatch
// run from the open internet; without the variable the endpoint refuses every
// call (it used to run for anyone).
const CRON_SECRET = process.env.CRON_SECRET || "";

function sameSecret(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

module.exports = async function handler(req, res) {
  // Called by the Vercel scheduler only, never from a browser: no CORS headers.
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  if (!CRON_SECRET || !sameSecret(req.headers.authorization || "", "Bearer " + CRON_SECRET)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }
  if (!AGENT_EDGE_URL || !AGENT_EDGE_TOKEN) {
    res.status(200).json({ ok: true, skipped: "agent edge not configured" });
    return;
  }
  try {
    const r = await fetch(AGENT_EDGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-dispatch-secret": AGENT_EDGE_TOKEN,
      },
      body: JSON.stringify({ max: 25 }),
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    res.setHeader("Content-Type", "application/json");
    res.status(r.status).end(text);
  } catch (e) {
    console.error("agent-dispatch relay failed:", String((e && e.message) || e));
    res.status(502).json({ ok: false, error: "The dispatch service did not answer" });
  }
};
module.exports.sameSecret = sameSecret;
