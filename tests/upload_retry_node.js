// Uploads on a weak signal (2026-10-18): a photo or file upload that drops
// is tried once more; other errors are not; a second try that finds the file
// already there counts as done. Runs the real functions from js/app.js with a
// stand-in for Supabase Storage.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const app = fs.readFileSync(path.join(__dirname, "..", "js/app.js"), "utf8");
let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? "  " + detail : "")); passed++; console.log("[PASS] " + name); };

function grab(name) {
  const start = app.indexOf((name === "isNetworkError" || name === "waitForSignal" ? "function " : "async function ") + name + "(");
  assert.ok(start >= 0, "found " + name);
  let i = app.indexOf("{", start), depth = 0;
  for (; i < app.length; i++) { if (app[i] === "{") depth++; else if (app[i] === "}" && --depth === 0) break; }
  return app.slice(start, i + 1);
}
const src = ["isNetworkError", "waitForSignal", "retryOnNetwork", "storageUpload"].map(grab).join("\n");

function sandbox(replies, online = true) {
  const calls = [], waits = [], listeners = {};
  const ctx = {
    navigator: { onLine: online },
    window: { addEventListener: (ev, fn) => { listeners[ev] = fn; }, removeEventListener: ev => { delete listeners[ev]; } },
    // Short pauses run at once; the 20-second offline wait only ends when cleared.
    setTimeout: (fn, ms) => { waits.push(ms); return setTimeout(fn, ms >= 10000 ? 60000 : 0); },
    clearTimeout: t => clearTimeout(t),
    SB: { storage: { from: bucket => ({ upload: async (p, body, opts) => {
      calls.push({ bucket, p, opts });
      const r = replies[calls.length - 1];
      if (r instanceof Error) throw r;
      return r;
    } }) } },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, calls, waits, listeners };
}

(async () => {
  // 1. Works first time: one call, no wait.
  let s = sandbox([{ data: { path: "a" }, error: null }]);
  let r = await s.ctx.storageUpload("listing-photos", "u/a.jpg", "blob", { upsert: false });
  ok("an upload that works is sent once", !r.error && s.calls.length === 1 && s.waits.length === 0);

  // 2. Dropped, then works.
  s = sandbox([{ data: null, error: { message: "Failed to fetch" } }, { data: { path: "a" }, error: null }]);
  let told = 0;
  r = await s.ctx.storageUpload("pms-receipts", "b/p/1.jpg", "blob", { upsert: false }, () => told++);
  ok("a dropped upload is tried once more and succeeds", !r.error && s.calls.length === 2 && r.retried === true);
  ok("the screen is told it is trying again", told === 1);
  ok("it waits a moment before trying again", s.waits.includes(1500));

  // 3. Dropped twice: the error comes back after two tries, not more.
  s = sandbox([{ error: { message: "Failed to fetch" } }, { error: { message: "Failed to fetch" } }, { data: {} }]);
  r = await s.ctx.storageUpload("listing-photos", "u/c.jpg", "blob", { upsert: false });
  ok("two drops: gives up after the second try", !!r.error && s.calls.length === 2);

  // 4. A thrown network error is treated the same.
  s = sandbox([new TypeError("NetworkError when attempting to fetch resource."), { data: { path: "d" }, error: null }]);
  r = await s.ctx.storageUpload("private-documents", "u/d.pdf", "file", {});
  ok("a thrown network error is tried again too", !r.error && s.calls.length === 2);

  // 5. Not a network error: no second try.
  s = sandbox([{ error: { message: "new row violates row-level security policy" } }, { data: {} }]);
  r = await s.ctx.storageUpload("pms-receipts", "x/y.jpg", "blob", { upsert: false });
  ok("a refusal (not the signal) is not tried again", !!r.error && s.calls.length === 1);

  // 6. First try reached the server: the second is told it exists.
  s = sandbox([{ error: { message: "Load failed" } }, { error: { message: "The resource already exists", error: "Duplicate", statusCode: "409" } }]);
  r = await s.ctx.storageUpload("listing-photos", "u/e.jpg", "blob", { upsert: false });
  ok("second try finds the file already there: counts as uploaded", !r.error && r.data && r.data.path === "u/e.jpg");

  // 7. "Already exists" on a first try is a real error.
  s = sandbox([{ error: { message: "The resource already exists" } }]);
  r = await s.ctx.storageUpload("listing-photos", "u/f.jpg", "blob", { upsert: false });
  ok("'already exists' on the first try is still an error", !!r.error && s.calls.length === 1);

  // 8. Offline: waits for the online event instead of a fixed pause.
  s = sandbox([{ error: { message: "Failed to fetch" } }, { data: { path: "g" }, error: null }], false);
  const p = s.ctx.storageUpload("pms-receipts", "b/g.jpg", "blob", { upsert: false });
  await new Promise(res => setTimeout(res, 5));
  ok("offline: it waits for the connection (up to 20 seconds)", s.waits.includes(20000) && typeof s.listeners.online === "function" && s.calls.length === 1);
  s.ctx.navigator.onLine = true; s.listeners.online();
  r = await p;
  ok("back online: the upload goes out", !r.error && s.calls.length === 2 && !s.listeners.online);

  // 9. Every upload in the app goes through it.
  const direct = (app.match(/SB\.storage\.from\([^)]*\)\.upload\(/g) || []).length;
  ok("every upload in the app uses the retry (only the helper calls Storage directly)", direct === 1, "direct calls: " + direct);
  ok("the tenant's photo link is retried too", /retryOnNetwork\(\(\) => SB\.rpc\("pms_tenant_attach_proof"/.test(app));

  console.log("\nupload_retry_node: " + passed + " checks passed");
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
