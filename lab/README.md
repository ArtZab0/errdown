# Capture labs

Real error responses for `fixtures/` (named `*-captured`). Re-run after server upgrades to catch fingerprint drift.

## docker/ — nginx, Apache, Caddy, Envoy, Traefik
```
cd lab/docker && docker compose up -d && python3 capture.py && docker compose down
```
Each server fronts a tiny backend and exposes `/missing` (404), `/forbidden` (403), `/dead` (closed port),
`/slow` (2s upstream timeout), `/maint` (503), `/limit` (rate limit), `/big` (body limit), `/upstream500`
(origin 500 passed through). Ports bind to 127.0.0.1 only. Not every server supports every case; the
script skips non-errors and duplicates. Then regenerate expected files (`packages/js/scripts/gen-expected.ts`)
and review the diff.

## cf-worker/ — Cloudflare Workers (1101, 1102)
Deployed at https://errdown-lab.errdown.workers.dev. `npx wrangler@4 deploy`, then `./capture.sh <url>`.
Finding (2026-11-10): workers.dev and edge errors (1001/1003/1034/1101/1102) return plain
`error code: NNNN` regardless of Accept header; structured output needs a full Cloudflare zone.

## cf-zone/ — full Cloudflare zone (errdown.dpdns.org, Free plan)
`setup.sh` configures DNS, a Worker route, WAF block/challenge rules, a rate limit and a strict-SSL
config rule (token in `~/.config/errdown-cf-token`). `capture.sh` records each case with markdown,
json and html Accept headers; `to-fixtures.py` turns them into `fixtures/cloudflare-zone-*`.
`packages/js/test/parity.test.ts` checks errdown reproduces Cloudflare's structured bytes exactly.
Hosts: `w.` (worker: /throw /cpu /blocked /challenge /limited), `down.` (522), `banned.` (1000),
`nxorigin.` (530/1016), `badcert.` (meant for 526; currently 522 — needs an origin answering on 443).
