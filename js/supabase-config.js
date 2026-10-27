/* Public Supabase connection settings. RLS policies in supabase/archive/schema.sql
 * protect data; never place a secret/service-role key in this browser file. */
(function () {
  "use strict";
  /* The vendored supabase-js client is injected here, at parse time, on
   * purpose. Deferring it was tried and reverted: the boot sequence in app.js
   * calls sbUp() to restore a returning session, and whether a visitor is
   * signed in cannot be known without the client that owns the session token.
   * Loading it on first interaction would silently sign people out on reload.
   * ~31 KB gzip is the honest cost of "stay signed in".
   *
   * Do not "optimise" this into an on-demand loader — it cannot work while the
   * session token lives in supabase-js's own storage. */
  var sbScript = document.createElement("script");
  sbScript.src = "vendor/supabase/supabase.js";
  sbScript.defer = true;
  document.head.appendChild(sbScript);

  const url = "https://hdkmvwxgjgzbuycjrbyq.supabase.co";
  const publishableKey = "sb_publishable_cZYofHijKLif1YXkHY8QLA_jK5SxY2I";
  window.ESREALTY_API_BASE = url + "/functions/v1/listing-api/api";
  /* Public market-scan fallback used only when internal Batangas listings do
   * not provide a usable comparable. Results remain source-attributed asking
   * price evidence, never verified transactions. */
  window.ESREALTY_MARKET_SCAN_BASE = "https://esrealty-market-scan.vercel.app";
  function boot() {
    if (!window.supabase) return false;
    window.ESREALTY_SUPABASE = window.supabase.createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return true;
  }
  if (boot()) return;
  /* The supabase-js script may still be loading when this file runs.
   * Retry briefly so login does not fail with "Supabase client could not load". */
  let tries = 0;
  const timer = setInterval(function () {
    tries += 1;
    if (boot() || tries >= 50) clearInterval(timer);
  }, 200);
})();
