# errdown-mcp

> **Pre-release (alpha).**

An MCP server with one tool, **`fetch`**. On success it returns the page as Markdown. On any
failure (HTTP error, bot challenge, DNS / TLS / connection failure) it returns **one line** the
agent can act on, instead of an HTML dump:

```
HTTP 502 upstream_unavailable (nginx). Retryable: wait 5s, then retry (max 3 tries).
HTTP 401 auth_required. Server said: "Requires authentication". Not retryable: needs credentials; ask the user.
HTTP 403 challenge (cloudflare). Needs a human (CAPTCHA/bot check); do not retry or bypass.
```

About 20 tokens per error (median, 228 real captured errors): 98.5% fewer than the error page
converted to Markdown, about the same as a bare "status code 404", but with the category and retry
decision. Pass `format: "full"` for Cloudflare's full structured error format (RFC 9457 fields in
Markdown frontmatter).

So the agent knows whether to retry, ask the user for credentials, or stop at a CAPTCHA.

## Install

Claude Code:
```
claude mcp add errdown -- uvx errdown-mcp@0.1.0a3
```
Claude Desktop / Cursor / any MCP client (`mcpServers` config):
```json
{ "errdown": { "command": "uvx", "args": ["errdown-mcp@0.1.0a3"] } }
```
Node alternative: `npx -y errdown-mcp@alpha`.

Tool arguments: `url`, `max_length` (default 20000), `start_index` (continue truncated
content), `raw` (HTML instead of Markdown). The server sends `Accept: text/markdown, */*`, so
sites that support Markdown for agents return it natively.

Note: like other fetch servers, it can reach any URL the host machine can, including local
network addresses.

Built on [errdown](https://github.com/ArtZab0/errdown). Not affiliated with Cloudflare.
License: Apache-2.0.
