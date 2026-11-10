// Regenerates fixtures/*.expected.json from the current implementation.
// Review the diff by hand before committing: expected files are the spec's ground truth.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalize, toCompact, toJSON, toMarkdown } from "../src/index.ts";
import { ordered } from "../src/render.ts";

// Fixed clock so date-based headers (Retry-After dates, reset epochs) are deterministic.
const FIXTURE_NOW = "2026-11-10T00:00:00.000Z";
const dir = new URL("../../../fixtures/", import.meta.url).pathname;
// rendered.json: exact TS renderings, so other implementations can check byte-for-byte output.
const rendered: Record<string, { md: string; json: string; compact: string } | null> = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith(".input.json")).sort()) {
  const inp = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const p = normalize(inp.status, inp.headers, inp.body, { url: inp.url, now: FIXTURE_NOW });
  const out = p ? ordered(p) : null;
  if (out) delete (out as any).timestamp;
  rendered[f.replace(".input.json", "")] = p ? { md: toMarkdown(p), json: toJSON(p), compact: toCompact(p) } : null;
  writeFileSync(join(dir, f.replace(".input.json", ".expected.json")), JSON.stringify(out, null, 2) + "\n");
}
writeFileSync(join(dir, "rendered.json"), JSON.stringify(rendered, null, 1) + "\n");
