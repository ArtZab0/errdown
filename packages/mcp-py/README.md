# errdown-mcp

> **Pre-release (alpha).**

An MCP server with one tool, **`fetch`**. On success it returns the page as Markdown. On any
failure (HTTP error, bot challenge, DNS / TLS / connection failure) it returns a **structured
error in Cloudflare's agent format** instead of an HTML dump:

```
---
error_code: 502
error_name: nginx_bad_gateway
error_category: upstream_unavailable
status: 502
retryable: true
retry_after: 5
owner_action_required: false
errdown_source: nginx
---

# Bad gateway

## What Happened

The server returned HTTP 502 with an error page from nginx.

## What You Should Do

Wait 5 seconds, then retry with exponential backoff. Stop after a few attempts and report the error if it persists.
```

So the agent knows whether to retry, ask the user for credentials, or stop at a CAPTCHA.

## Install

Claude Code:
```
claude mcp add errdown -- uvx --prerelease allow errdown-mcp
```
Claude Desktop / Cursor / any MCP client (`mcpServers` config):
```json
{ "errdown": { "command": "uvx", "args": ["--prerelease", "allow", "errdown-mcp"] } }
```
Node alternative: `npx -y errdown-mcp@alpha`.

Tool arguments: `url`, `max_length` (default 20000), `start_index` (continue truncated
content), `raw` (HTML instead of Markdown). The server sends `Accept: text/markdown, */*`, so
sites that support Markdown for agents return it natively.

Note: like other fetch servers, it can reach any URL the host machine can, including local
network addresses.

Built on [errdown](https://github.com/ArtZab0/errdown). Not affiliated with Cloudflare.
License: Apache-2.0.
