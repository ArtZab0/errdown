// Category / retryable accuracy against fixtures/labels.json (independent of *.expected.json).
// Usage: node scripts/eval.ts [--split holdout]
import { readFileSync } from "node:fs";
import { normalize } from "../src/index.ts";

const dir = new URL("../../../fixtures/", import.meta.url).pathname;
const labels: Record<string, { category: string | null; retryable: boolean | null; split: string }> =
  JSON.parse(readFileSync(dir + "labels.json", "utf8"));
const only = process.argv.includes("--split") ? process.argv[process.argv.indexOf("--split") + 1] : undefined;

const by: Record<string, { n: number; cat: number; retry: number }> = {};
const misses: string[] = [];
for (const [name, l] of Object.entries(labels)) {
  if (only && l.split !== only) continue;
  const inp = JSON.parse(readFileSync(`${dir}${name}.input.json`, "utf8"));
  const p = normalize(inp.status, inp.headers, inp.body, { url: inp.url, now: "2026-11-10T00:00:00.000Z" });
  const s = (by[l.split] ??= { n: 0, cat: 0, retry: 0 });
  s.n++;
  const cat = p?.error_category ?? null, retry = p?.retryable ?? null;
  if (cat === l.category) s.cat++; else misses.push(`${name}: category ${cat} != label ${l.category}`);
  if (retry === l.retryable) s.retry++; else misses.push(`${name}: retryable ${retry} != label ${l.retryable}`);
}
for (const [split, s] of Object.entries(by)) {
  console.log(`${split.padEnd(8)} n=${s.n}  category ${(100 * s.cat / s.n).toFixed(1)}%  retryable ${(100 * s.retry / s.n).toFixed(1)}%`);
}
if (misses.length) console.log("\nMisses:\n  " + misses.join("\n  "));
