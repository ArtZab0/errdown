import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, toMarkdown, toJSON } from "../src/index.ts";

// Deterministic PRNG so failures reproduce.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const PIECES = ["{", "}", "[", "]", '"error"', ":", ",", "null", "---\n", "error_code: ", "\n", "<html>", "<center>nginx</center>",
  "Just a moment...", "\u0000", "\ud800", "💥", "a".repeat(1000), "Retry-After", "###", "</title>", "true", "1e999"];

test("normalize never throws and always renders", () => {
  const statuses = [0, -1, 200, 302, 400, 403, 404, 429, 500, 503, 599, 600, 1015, NaN, 1.5];
  for (let i = 0; i < 3000; i++) {
    const body = Array.from({ length: Math.floor(rnd() * 30) }, () => pick(PIECES)).join("");
    const headers: any = pick([
      {}, null, undefined, { "retry-after": pick(["-5", "abc", "1e9", "Wed, 21 Oct 2015 07:28:00 GMT", ""]) },
      { "content-type": pick(["application/problem+json", "text/markdown", 5 as any]) }, [["x"]], { a: ["1", "2"] },
    ]);
    const p = normalize(pick(statuses), headers, pick([body, null, undefined, new TextEncoder().encode(body)]));
    if (p) {
      assert.equal(typeof p.status, "number");
      assert.ok(p.errdown_confidence >= 0 && p.errdown_confidence <= 1);
      toMarkdown(p); JSON.parse(toJSON(p));
    }
  }
});

test("normalize is fast", () => {
  const body = "<html>" + "x".repeat(200_000) + "<center>nginx</center></html>";
  const t = performance.now();
  for (let i = 0; i < 200; i++) normalize(502, { server: "nginx" }, body);
  const per = (performance.now() - t) / 200;
  assert.ok(per < 5, `median-ish ${per.toFixed(2)}ms`);
});
