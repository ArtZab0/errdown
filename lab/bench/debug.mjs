// Replays one compact flaky503 conversation and prints Groq's raw final response.
import { readFileSync } from "node:fs";
const KEY = readFileSync(`${process.env.HOME}/.config/errdown-groq-key`, "utf8").trim();
const TOOLS = [
  { type: "function", function: { name: "fetch", description: "Fetch a URL and return its content.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
  { type: "function", function: { name: "wait", description: "Wait for the given number of seconds (max 30) before continuing.", parameters: { type: "object", properties: { seconds: { type: "number" } }, required: ["seconds"] } } },
];
const url = "http://bench.localtest.me:8765/rdebug/flaky503";
const V = process.argv[2] ?? "A";
const line = (n) => ({
  A: `HTTP 503 upstream_unavailable (nginx). Retryable: wait 5s, then retry (attempt ${n} of 3).`,
  B: `Error: HTTP 503 upstream_unavailable (nginx). Retryable: wait 5s, then retry (attempt ${n} of 3). If it keeps failing, tell the user.`,
  C: `Fetch failed: HTTP 503 upstream_unavailable (nginx). This is temporary. Wait 5s, then retry (attempt ${n} of 3); after 3 failed attempts, stop and report the error to the user.`,
  E: `Error: HTTP 503 upstream_unavailable (nginx). Retryable: wait 5s, then retry (attempt ${n} of 3).`,
  F: `HTTP 503 upstream_unavailable (nginx). Retryable: wait 5s, then retry (attempt ${n} of 3). If it keeps failing, tell the user.`,
  D: `HTTP 503 upstream_unavailable (nginx).\nretryable: true\nretry_after: 5\nattempt: ${n} of 3\nnext: wait 5s, then fetch again; after 3 failures, report the error to the user.`,
})[V];
const messages = [
  { role: "system", content: "You are an assistant with a web fetch tool and a wait tool. Complete the user's task. When you are done, reply with a final answer and no tool calls." },
  { role: "user", content: `Fetch ${url} and tell me the value of its "answer" field. If you cannot get it, explain why and what I should do. End your reply with a line "RESULT: <answer value>" or "RESULT: NONE".` },
  { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "fetch", arguments: JSON.stringify({ url }) } }] },
  { role: "tool", tool_call_id: "c1", content: line(1) },
  { role: "assistant", content: "", tool_calls: [{ id: "c2", type: "function", function: { name: "wait", arguments: '{"seconds":5}' } }] },
  { role: "tool", tool_call_id: "c2", content: "Waited 5s." },
  { role: "assistant", content: "", tool_calls: [{ id: "c3", type: "function", function: { name: "fetch", arguments: JSON.stringify({ url }) } }] },
  { role: "tool", tool_call_id: "c3", content: line(2) },
];
for (let i = 0; i < 2; i++) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "openai/gpt-oss-20b", messages, tools: TOOLS, tool_choice: "auto", temperature: 0, max_tokens: 1024 }) });
  const j = await r.json();
  const c = j.choices?.[0];
  console.log(`${V} try ${i}: status=${r.status} finish=${c?.finish_reason} content=${JSON.stringify(c?.message?.content)?.slice(0, 120)} tool_calls=${JSON.stringify(c?.message?.tool_calls)?.slice(0, 160)} reasoning=${JSON.stringify(c?.message?.reasoning)?.slice(0, 200)}`);
}
