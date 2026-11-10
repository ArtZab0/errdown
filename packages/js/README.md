# errdown

> **Pre-release (alpha).** API and output may change.

Cloudflare-compatible structured errors (RFC 9457 Problem Details) for every HTTP error your
agent hits: nginx, AWS, Vercel, framework defaults, JSON/XML API errors, bot challenges.
Zero dependencies, pure function, never throws. Independent project, not affiliated with Cloudflare.

```ts
import { normalize, toMarkdown, decide, agentAcceptHeader } from "errdown";

const res = await fetch(url, { headers: { accept: agentAcceptHeader() } });
if (!res.ok) {
  const problem = normalize(res.status, res.headers, await res.text(), { url });
  if (problem) {
    toMarkdown(problem); // Cloudflare-format Markdown for the model
    decide(problem);     // { action: "retry", after_seconds } | { action: "escalate" } | { action: "fail" }
  }
}
```

Spec and conformance fixtures: https://github.com/ArtZab0/errdown

License: Apache-2.0. Spec and fixtures: CC0 (captured third-party responses excepted).
