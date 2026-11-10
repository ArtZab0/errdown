# errdown

Cloudflare-compatible structured errors (RFC 9457) for every error your agent hits.

Status: alpha. Not affiliated with Cloudflare.

## Layout

- `SPEC.md` — the contract (draft 0.1)
- `fixtures/` — language-neutral conformance cases
- `packages/js` — TypeScript reference implementation (`npm test`, `npm run build`)
- `packages/py` — Python implementation, byte-identical output (`python tests/test_conformance.py`)
- `packages/mcp-js`, `packages/mcp-py` — errdown-mcp: an MCP `fetch` tool returning the contract on failure (`npx errdown-mcp@alpha` / `uvx errdown-mcp@0.1.0a3`)
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

## License

Code: [Apache-2.0](LICENSE). Spec (`SPEC.md`) and project-authored fixtures: [CC0 1.0](fixtures/CC0-1.0.txt).
Captured third-party responses in `fixtures/*-captured.input.json` remain their owners' property;
see [fixtures/LICENSE.md](fixtures/LICENSE.md).
