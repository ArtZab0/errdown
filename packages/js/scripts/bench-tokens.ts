// Token cost per error: raw body vs generic HTML->Markdown (Turndown, what many fetch tools do)
// vs errdown Markdown. Tokenizer: o200k_base via js-tiktoken (a proxy; Claude's tokenizer differs).
import { readdirSync, readFileSync } from "node:fs";
import TurndownService from "turndown";
import { getEncoding } from "js-tiktoken";
import { normalize, toCompact, toMarkdown } from "../src/index.ts";

const enc = getEncoding("o200k_base");
const td = new TurndownService();
td.remove(["script", "style", "noscript", "head"] as any);
const tok = (s: string) => enc.encode(s).length;
const dir = new URL("../../../fixtures/", import.meta.url).pathname;

type Row = { name: string; raw: number; md: number; status: number; errdown: number; compact: number };
const rows: Row[] = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith("captured.input.json"))) {
  const inp = JSON.parse(readFileSync(dir + f, "utf8"));
  const p = normalize(inp.status, inp.headers, inp.body, { url: inp.url, now: "2026-11-10T00:00:00.000Z" });
  if (!p) continue;
  const isHtml = /html/i.test(inp.headers["content-type"] ?? "") || /^\s*<(!doctype|html)/i.test(inp.body);
  let md = inp.body;
  if (isHtml) { try { md = td.turndown(inp.body); } catch { /* keep raw */ } }
  rows.push({ name: f.replace("-captured.input.json", ""), raw: tok(inp.body), md: tok(`Failed - status code ${inp.status}\n\n${md}`), status: tok(`Failed to fetch ${inp.url} - status code ${inp.status}`), errdown: tok(toMarkdown(p)), compact: tok(toCompact(p)) });
}
const sum = (k: keyof Row) => rows.reduce((a, r) => a + (r[k] as number), 0);
const med = (k: keyof Row) => { const v = rows.map((r) => r[k] as number).sort((a, b) => a - b); return v[v.length >> 1]; };
console.log(`fixtures: ${rows.length}`);
console.log(`                 total     median`);
for (const k of ["raw", "md", "status", "errdown", "compact"] as const) console.log(`${k.padEnd(10)} ${String(sum(k)).padStart(10)} ${String(med(k)).padStart(10)}`);
const big = rows.filter((r) => r.raw > 1000).sort((a, b) => b.raw - a.raw);
console.log(`\nresponses > 1000 raw tokens (${big.length}):  name  raw -> turndown -> errdown -> compact`);
for (const r of big) console.log(`  ${r.name.padEnd(34)} ${String(r.raw).padStart(6)} -> ${String(r.md).padStart(6)} -> ${String(r.errdown).padStart(4)} -> ${String(r.compact).padStart(3)}`);
const small = rows.filter((r) => r.raw < 100);
const m = (k: keyof Row, xs: Row[]) => xs.map((r) => r[k] as number).sort((a, b) => a - b)[xs.length >> 1];
console.log(`\nresponses < 100 raw tokens: ${small.length}; median raw ${m('raw', small)}, status-only ${m('status', small)}, errdown ${m('errdown', small)}, compact ${m('compact', small)}`);
