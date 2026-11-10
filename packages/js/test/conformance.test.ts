import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "../src/index.ts";
import { ordered } from "../src/render.ts";

// Fixed clock so date-based headers (Retry-After dates, reset epochs) are deterministic.
const FIXTURE_NOW = "2026-11-10T00:00:00.000Z";
const dir = new URL("../../../fixtures/", import.meta.url).pathname;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".input.json"))) {
  test(`fixture ${f.replace(".input.json", "")}`, () => {
    const inp = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const expected = JSON.parse(readFileSync(join(dir, f.replace(".input.json", ".expected.json")), "utf8"));
    const p = normalize(inp.status, inp.headers, inp.body, { url: inp.url, now: FIXTURE_NOW });
    const actual = p ? ordered(p) : null;
    if (actual) delete actual.timestamp;
    assert.deepEqual(actual, expected);
  });
}
