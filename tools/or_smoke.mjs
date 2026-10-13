const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error("OPENROUTER_API_KEY is not set.");
  process.exit(2);
}

const model = process.argv[2] || "~openai/gpt-sol-latest";
const started = Date.now();
const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://tradersgag6.github.io/esrealty/",
    "X-OpenRouter-Title": "SEA ESTATES",
  },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: "Reply with exactly: ok" }],
  }),
});

const elapsed = Date.now() - started;
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  process.exit(1);
}

const data = await res.json();
const u = data.usage || {};
console.log("requested:", model);
console.log("served:   ", data.model);
console.log("elapsed:  ", `${elapsed}ms`);
console.log("usage:    ", `${u.prompt_tokens ?? "?"} in / ${u.completion_tokens ?? "?"} out`);
console.log("reasoning:", data.choices?.[0]?.message?.reasoning?.slice(0, 120) || "-");
console.log("text:     ", (data.choices?.[0]?.message?.content || "").slice(0, 200));
