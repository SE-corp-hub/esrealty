"use strict";

const { handleMarketScan } = require("../lib/handler");

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async function (req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const { payload, cacheControl } = await handleMarketScan(req.query || {});
    res.setHeader("Cache-Control", cacheControl);
    res.status(200).json(payload);
  } catch (err) {
    if (err && err.status === 400) {
      res.status(400).json({ ok: false, error: String(err.message) });
      return;
    }
    // The cause goes to the server log, not to whoever called.
    console.error("market-scan failed:", String(err && err.message || err));
    res.status(500).json({ ok: false, error: "The scan could not be completed" });
  }
};