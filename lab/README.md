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
