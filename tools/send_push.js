#!/usr/bin/env node
// Passes new notifications on to the phones that turned alerts on, for
// .github/workflows/push-alerts.yml (every 10 minutes once PUSH_ALERTS is on).
//
// Reads notifications from the last 6 hours that weren't pushed yet and are
// still unread, sends each to its person's phones (web push, VAPID), marks
// them pushed, and forgets phones the push service says are gone. The log
// shows counts only (the repository is public).
//
// Needs: SUPABASE_ACCESS_TOKEN (Management API) and VAPID_PRIVATE_KEY. The
// public key is read from push_config (made in Settings by a super-admin).
"use strict";
const { runSql, dollarTag } = require("./supabase_sql.js");

const SITE = "https://esrealty.tradersgag6.workers.dev";

function payloadFor(n) {
  const view = /^[a-z-]{2,30}$/.test(String(n.link_view || "")) ? n.link_view : "";
  return JSON.stringify({ title: String(n.title || "SEA ESTATES").slice(0, 120), body: String(n.body || "").slice(0, 300), tag: String(n.id), url: "./index.html" + (view ? "?open=" + view : "") });
}

const PENDING = "select n.id, n.title, n.body, n.link_view, s.endpoint, s.p256dh, s.auth " +
  "from public.notifications n join public.push_subscriptions s on s.user_id = n.user_id " +
  "where n.pushed_at is null and n.read_at is null and n.created_at > now() - interval '6 hours' " +
  "order by n.created_at limit 300";

async function main(env = process.env, deps = {}) {
  const run = deps.run || runSql, out = deps.out || console.log;
  const priv = String(env.VAPID_PRIVATE_KEY || "").replace(/\s+/g, "");
  if (!priv) { out("Phone alerts aren't set up: add the VAPID_PRIVATE_KEY secret (Settings > Phone alerts shows how)."); return { sent: 0 }; }
  const cfg = await run("select public_key from public.push_config where id = 1");
  const pub = cfg[0] && cfg[0].public_key;
  if (!pub) { out("No public key yet: a super-admin makes the keys in Settings > Phone alerts."); return { sent: 0 }; }
  const webpush = deps.webpush || require("web-push");
  webpush.setVapidDetails(env.VAPID_SUBJECT || SITE, pub, priv);
  const rows = await run(PENDING);
  const ids = new Set(), gone = new Set();
  let sent = 0, failed = 0;
  for (const r of rows) {
    ids.add(r.id);
    if (gone.has(r.endpoint)) continue;
    try {
      await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payloadFor(r), { TTL: 6 * 3600, urgency: "high" });
      sent++;
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) gone.add(r.endpoint); else failed++;
    }
  }
  if (ids.size) {
    const list = JSON.stringify([...ids]), tag = dollarTag(list);
    await run("update public.notifications set pushed_at = now() where id in (select value::uuid from json_array_elements_text(" + tag + list + tag + "::json))");
  }
  if (gone.size) {
    const list = JSON.stringify([...gone]), tag = dollarTag(list);
    await run("delete from public.push_subscriptions where endpoint in (select value from json_array_elements_text(" + tag + list + tag + "::json))");
  }
  out("Phone alerts: " + sent + " sent for " + ids.size + " notifications" + (failed ? ", " + failed + " failed (will not retry)" : "") + (gone.size ? ", " + gone.size + " phones no longer reachable (removed)" : "") + ".");
  return { sent, failed, gone: gone.size, marked: ids.size };
}

if (require.main === module) {
  main().then(() => process.exit(0), e => { console.error("::error::" + (e && e.message || e)); process.exit(1); });
}
module.exports = { main, payloadFor, PENDING };
