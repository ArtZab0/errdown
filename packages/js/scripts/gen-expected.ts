// Regenerates fixtures/*.expected.json from the current implementation.
// Review the diff by hand before committing: expected files are the spec's ground truth.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "../src/index.ts";
import { ordered } from "../src/render.ts";

const dir = new URL("../../../fixtures/", import.meta.url).pathname;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".input.json"))) {
  const inp = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const p = normalize(inp.status, inp.headers, inp.body, { url: inp.url, now: "2026-01-01T00:00:00.000Z" });
  const out = p ? ordered(p) : null;
  if (out) delete (out as any).timestamp;
  writeFileSync(join(dir, f.replace(".input.json", ".expected.json")), JSON.stringify(out, null, 2) + "\n");
}
