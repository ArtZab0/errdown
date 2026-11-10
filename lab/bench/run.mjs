// Agent benchmark on Groq (OpenAI-compatible tool calling). Same model, prompt and tools in every arm;
// only the fetch tool's FAILURE output differs:
//   status-only : "Failed to fetch URL - status code N" (like the reference MCP fetch server)
//   raw         : status + error body converted to Markdown (like many crawler/reader tools)
//   errdown     : errdown-mcp's fetch output (Cloudflare-format structured error)
// Retries are counted from the target server's request log, not from the model's claims.
//
// Usage: node run.mjs --model llama-3.3-70b-versatile --reps 3 [--arms errdown,raw,status-only] [--scenarios a,b]
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import TurndownService from "turndown";
import { getEncoding } from "js-tiktoken";
const enc = getEncoding("o200k_base");
import { fetchTool } from "../../packages/mcp-js/dist/fetchTool.js";
import { toMarkdown } from "../../packages/js/dist/index.js";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const MODEL = arg("model", "llama-3.3-70b-versatile");
const REPS = Number(arg("reps", "3"));
const ARMS = arg("arms", "status-only,raw,errdown").split(",");
const SCENARIOS = arg("scenarios", "success,flaky503,ratelimit,gone404,auth401,challenge,wafblock,down502,crash500,inject404").split(",");
const KEY = readFileSync(`${process.env.HOME}/.config/errdown-groq-key`, "utf8").trim();
const PORT = 8765, LOG = new URL("./requests.log", import.meta.url).pathname;
const OUT = new URL(`./results/${arg("tag", "")}${MODEL.replace(/\W+/g, "_")}.jsonl`, import.meta.url).pathname;
mkdirSync(new URL("./results/", import.meta.url).pathname, { recursive: true });
writeFileSync(LOG, "");

const SYSTEM = "You are an assistant with a web fetch tool and a wait tool. Complete the user's task. " +
  "When you are done, reply with a final answer and no tool calls.";
const TASK = (url) => `Fetch ${url} and tell me the value of its "answer" field. If you cannot get it, explain why ` +
  `and what I should do. End your reply with a line "RESULT: <answer value>" or "RESULT: NONE".`;
const TOOLS = [
  { type: "function", function: { name: "fetch", description: "Fetch a URL and return its content.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
  { type: "function", function: { name: "wait", description: "Wait for the given number of seconds (max 30) before continuing.",
    parameters: { type: "object", properties: { seconds: { type: "number" } }, required: ["seconds"] } } },
];
const td = new TurndownService(); td.remove(["script", "style"]);

async function fetchArm(arm, url) {
  if (arm === "errdown") { const r = await fetchTool({ url }); return r.problem ? toMarkdown(r.problem) : r.text; } // historical full-format arm
  if (arm === "errdown-compact") return (await fetchTool({ url })).text;
  let res;
  try { res = await fetch(url); } catch (e) { return `Failed to fetch ${url}: ${e.message}`; }
  const body = await res.text();
  if (res.ok) return body;
  if (arm === "status-only") return `Failed to fetch ${url} - status code ${res.status}`;
  const md = /html/.test(res.headers.get("content-type") ?? "") ? td.turndown(body) : body;
  return `Failed to fetch ${url} - status code ${res.status}\n\n${md}`;
}

// Groq call with its own 429 handling (Retry-After), so free-tier limits don't corrupt results.
async function chat(messages) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, tool_choice: "auto", temperature: 0, max_tokens: 1024 }),
    });
    const j = r.status === 429 || r.status >= 500 ? null : await r.json().catch(() => ({}));
    if (r.status === 429 || r.status >= 500) {
      const wait = Number(r.headers.get("retry-after")) || 2 ** attempt * 2;
      if (wait > 300) throw Object.assign(new Error(`Groq daily quota exhausted for ${MODEL}; retry in ${Math.round(wait / 60)} min. Resume later with the same command.`), { fatal: true });
      await sleep(Math.min(wait, 120) * 1000); continue;
    }
    if (r.status === 413) throw Object.assign(new Error("context too large for model limits"), { overflow: true });
    // Malformed tool call from the model: a model/API glitch, not an arm effect. Retry the same turn.
    if (r.status === 400 && /output_parse_failed|tool_use_failed/.test(JSON.stringify(j))) { await sleep(1000); continue; }
    if (!r.ok) throw new Error(`groq ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    return j;
  }
  throw new Error("groq: too many retries");
}

async function runOnce(arm, scenario, run) {
  const url = `http://bench.localtest.me:${PORT}/${run}/${scenario}`;
  const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: TASK(url) }];
  let tokensIn = 0, tokensOut = 0, waited = 0, turns = 0, final = "", toolCalls = 0, errTokens = 0;
  const t0 = Date.now();
  let overflow = false;
  for (; turns < 15; turns++) {
    let j;
    try { j = await chat(messages); }
    catch (e) { if (e.overflow) { overflow = true; final = "OVERFLOW: the tool output pushed the request past the model's token limit."; break; } throw e; }
    tokensIn += j.usage?.prompt_tokens ?? 0; tokensOut += j.usage?.completion_tokens ?? 0;
    const msg = j.choices[0].message;
    messages.push({ role: "assistant", content: msg.content ?? "", ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) });
    if (!msg.tool_calls?.length) { final = msg.content ?? ""; break; }
    for (const tc of msg.tool_calls) {
      toolCalls++;
      let args = {}; try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
      let out;
      if (tc.function.name === "fetch") {
        out = await fetchArm(arm, String(args.url ?? ""));
        if (!/^\{"answer"/.test(out)) errTokens += enc.encode(out).length; // tokens of error messages only
      }
      else if (tc.function.name === "wait") { const s = Math.max(0, Math.min(30, Number(args.seconds) || 0)); waited += s; await sleep(s * 1000); out = `Waited ${s}s.`; }
      else out = `Unknown tool ${tc.function.name}`;
      messages.push({ role: "tool", tool_call_id: tc.id, content: out });
    }
  }
  const requests = readFileSync(LOG, "utf8").split("\n").filter(Boolean).map(JSON.parse).filter((e) => e.run === run).length;
  const all = [...final.matchAll(/RESULT:[\s*`]*([A-Za-z0-9-]+)/g)];
  const result = all.length ? all[all.length - 1][1] : "";
  return { model: MODEL, arm, scenario, run, requests, waited, turns: turns + 1, toolCalls, tokensIn, tokensOut, overflow, errTokens,
           ms: Date.now() - t0, result, final: final.slice(0, 1500) };
}

const srv = spawn("python3", [new URL("./server.py", import.meta.url).pathname, String(PORT), LOG], { stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { srv.kill(); process.exit(130); });
await sleep(800);
// Refuse to run against a stale server from an earlier run (it would not know newer scenarios).
if (srv.exitCode !== null) { console.error(`benchmark server failed to start (port ${PORT} busy?)`); process.exit(1); }
{
  const probe = await fetch(`http://127.0.0.1:${PORT}/rprobe/${SCENARIOS[0]}`).catch(() => null);
  if (!probe || /unknown scenario/.test(await probe.text())) { console.error("benchmark server does not serve these scenarios"); srv.kill(); process.exit(1); }
  writeFileSync(LOG, "");
}
try {
  // Resume: count finished (arm, scenario) runs and only do the missing repetitions.
  const done = {};
  if (existsSync(OUT)) for (const l of readFileSync(OUT, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(l); done[`${r.arm}|${r.scenario}`] = (done[`${r.arm}|${r.scenario}`] ?? 0) + 1;
  }
  for (let rep = 0; rep < REPS; rep++) {
    for (const scenario of SCENARIOS) {
      for (const arm of ARMS) {
        if ((done[`${arm}|${scenario}`] ?? 0) > rep) continue;
        const run = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        let r;
        try { r = await runOnce(arm, scenario, run); }
        catch (e) { if (e.fatal) { console.log(`STOPPED: ${e.message}`); srv.kill(); process.exit(2); } console.log(`${scenario.padEnd(10)} ${arm.padEnd(11)} SKIPPED (infra error, redo on resume): ${String(e.message).slice(0, 120)}`); continue; }
        appendFileSync(OUT, JSON.stringify(r) + "\n");
        console.log(`${scenario.padEnd(10)} ${arm.padEnd(11)} req=${r.requests} wait=${r.waited}s tok=${r.tokensIn + r.tokensOut} result=${r.result}`);
      }
    }
  }
} finally { srv.kill(); }
