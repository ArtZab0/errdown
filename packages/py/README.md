# errdown

> **Pre-release (alpha).** API and output may change.

Cloudflare-compatible structured errors (RFC 9457 Problem Details) for every HTTP error your
agent hits: nginx, AWS, Vercel, framework defaults, JSON/XML API errors, bot challenges.
Zero dependencies, pure function, never throws. Independent project, not affiliated with Cloudflare.

```python
import httpx
from errdown import normalize, to_markdown, decide, agent_accept_header

res = httpx.get(url, headers={"accept": agent_accept_header()})
if res.is_error:
    problem = normalize(res.status_code, res.headers, res.content, url=url)
    if problem:
        to_markdown(problem)  # Cloudflare-format Markdown for the model
        decide(problem)       # {"action": "retry", "after_seconds": 5} | escalate | fail
```

Spec and conformance fixtures: https://github.com/ArtZab0/errdown

License: Apache-2.0. Spec and fixtures: CC0 (captured third-party responses excepted).
