"""Conformance: identical output to the TypeScript reference on every fixture."""
import json
import pathlib
import random
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))
from errdown import agent_accept_header, backoff, decide, normalize, ordered, to_json, to_markdown  # noqa: E402

FIX = pathlib.Path(__file__).resolve().parents[3] / "fixtures"
NOW = "2026-11-10T00:00:00.000Z"
RENDERED = json.loads((FIX / "rendered.json").read_text())


def load(name):
    return json.loads((FIX / f"{name}.input.json").read_text())


NAMES = sorted(p.name[: -len(".input.json")] for p in FIX.glob("*.input.json"))


class Conformance(unittest.TestCase):
    def test_fixtures_match_expected(self):
        for name in NAMES:
            with self.subTest(name):
                i = load(name)
                p = normalize(i["status"], i["headers"], i["body"], url=i["url"], now=NOW)
                got = ordered(p) if p else None
                if got:
                    got.pop("timestamp", None)
                want = json.loads((FIX / f"{name}.expected.json").read_text())
                self.assertEqual(got, want)

    def test_rendering_byte_identical_to_typescript(self):
        for name in NAMES:
            with self.subTest(name):
                i = load(name)
                p = normalize(i["status"], i["headers"], i["body"], url=i["url"], now=NOW)
                want = RENDERED[name]
                if want is None:
                    self.assertIsNone(p)
                    continue
                self.assertEqual(to_markdown(p), want["md"])
                self.assertEqual(to_json(p), want["json"])

    def test_cloudflare_parity(self):
        for name in NAMES:
            if not name.endswith("captured"):
                continue  # only real Cloudflare output defines the exact bytes
            i = load(name)
            ct = i["headers"].get("content-type", "")
            if not ("ray_id" in i["body"] and "error_code" in i["body"] and ("markdown" in ct or "json" in ct)):
                continue
            with self.subTest(name):
                p = {k: v for k, v in normalize(i["status"], i["headers"], i["body"], url=i["url"]).items()
                     if not k.startswith("errdown_")}
                out = to_markdown(p) if "markdown" in ct else to_json(p)
                self.assertEqual(out.strip(), i["body"].strip())


class Helpers(unittest.TestCase):
    def test_decide_backoff_accept(self):
        self.assertEqual(decide(normalize(503, {}, "")), {"action": "retry", "after_seconds": 5})
        self.assertEqual(decide(normalize(403, {}, ""))["action"], "escalate")
        self.assertEqual(decide(normalize(404, {}, ""))["action"], "fail")
        self.assertEqual(backoff(3, random=lambda: 1), 8)
        self.assertEqual(backoff(20, random=lambda: 1, max=30), 30)
        self.assertEqual(backoff(0, random=lambda: 0, min=10), 10)
        self.assertEqual(agent_accept_header(), "text/markdown, */*")
        self.assertEqual(agent_accept_header("json"), "application/json, */*")

    def test_header_inputs_and_bytes(self):
        self.assertEqual(normalize(429, [("Retry-After", "4")], "")["retry_after"], 4)
        self.assertEqual(normalize(429, {"retry-after": "3"}, b"")["retry_after"], 3)
        self.assertIn("nope", normalize(400, {}, b'{"error":"nope"}')["detail"])
        self.assertIsNone(normalize(200, {}, "ok"))


class Fuzz(unittest.TestCase):
    def test_never_raises(self):
        rnd = random.Random(42)
        pieces = ["{", "}", "[", "]", '"error"', ":", ",", "null", "---\n", "error_code: ", "\n", "<html>",
                  "<center>nginx</center>", "Just a moment...", "\x00", "\ud800", "💥", "a" * 1000, "NaN", "1e999"]
        statuses = [0, -1, 200, 302, 400, 403, 404, 429, 500, 503, 599, 600, 999, 1015, True, None, "500", 1.5]
        headers = [{}, None, {"retry-after": "-5"}, {"retry-after": "Wed, 21 Oct 2015 07:28:00 GMT"},
                   {"content-type": "application/problem+json"}, [("x",)], {"a": ["1", "2"]}, {1: 2}, object()]
        for _ in range(3000):
            body = "".join(rnd.choice(pieces) for _ in range(rnd.randrange(30)))
            b = rnd.choice([body, None, body.encode("utf-8", "surrogatepass"), 42])
            p = normalize(rnd.choice(statuses), rnd.choice(headers), b)
            if p:
                to_markdown(p)
                json.loads(to_json(p))
                self.assertTrue(0 <= p["errdown_confidence"] <= 1)


if __name__ == "__main__":
    unittest.main()
