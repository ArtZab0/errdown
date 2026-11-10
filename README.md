# errdown

Cloudflare-compatible structured errors (RFC 9457) for every error your agent hits.

Status: pre-alpha, private.

## Layout

- `SPEC.md` — the contract (draft 0.1)
- `fixtures/` — language-neutral conformance cases
- `packages/js` — TypeScript reference implementation (`npm test`, `npm run build`)
- `packages/py` — Python implementation, byte-identical output (`python tests/test_conformance.py`)
- `lab/` — capture labs (Docker servers, Cloudflare zone, public endpoints)
- `docs/` — benchmarks

## Quick look

```ts
import { normalize, toMarkdown, decide } from "errdown";

const problem = normalize(res.status, res.headers, await res.text(), { url });
if (problem) {
  console.log(toMarkdown(problem));   // Cloudflare-format Markdown
  decide(problem);                    // { action: "retry", after_seconds: 5 } | escalate | fail
}
```
