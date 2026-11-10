// Byte-for-byte parity with real Cloudflare structured responses (SPEC §8, §11).
// For a Cloudflare-issued body, rendering errdown's Problem in the same format, minus the
// errdown_* members, must reproduce Cloudflare's bytes exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize, toJSON, toMarkdown } from "../src/index.ts";
import type { Problem } from "../src/index.ts";

const dir = new URL("../../../fixtures/", import.meta.url).pathname;
const strip = (p: Problem): Problem => {
  const q = { ...p };
  for (const k of Object.keys(q)) if (k.startsWith("errdown_")) delete q[k];
  return q;
};

for (const f of readdirSync(dir).filter((f) => /captured\.input\.json$/.test(f))) {
  const inp = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const ct: string = inp.headers["content-type"] ?? "";
  if (!ct.includes("markdown") && !ct.includes("json")) continue;
  if (inp.headers.server !== "cloudflare") continue;
  test(`parity ${f.replace(".input.json", "")}`, () => {
    const p = strip(normalize(inp.status, inp.headers, inp.body, { url: inp.url })!);
    const out = ct.includes("markdown") ? toMarkdown(p) : toJSON(p);
    assert.equal(out.trim(), inp.body.trim());
  });
}
