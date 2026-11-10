"""errdown-mcp (Python): one tool, `fetch`. Success returns content as Markdown; any failure returns
errdown's Cloudflare-compatible structured error so the agent knows whether to retry or stop."""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

import httpx
from markdownify import markdownify
from mcp.server.mcpserver import MCPServer
from mcp_types import CallToolResult, TextContent

from errdown import agent_accept_header, normalize, to_compact

_NOISE = re.compile(r"<(script|style|noscript|iframe|svg|template)\b[^>]*>.*?</\1\s*>", re.S | re.I)
UA = "errdown-mcp/0.1 (+https://github.com/ArtZab0/errdown)"
MAX_BYTES = 5 * 1024 * 1024
mcp = MCPServer("errdown-mcp")


def network_problem(exc: BaseException, url: str) -> Dict[str, Any]:
    """Problem for failures with no HTTP response (DNS, refused, TLS, timeout). Mirrors the TS server."""
    host = urlsplit(url).netloc or None
    text = f"{type(exc).__name__}: {exc}"
    if isinstance(exc, httpx.InvalidURL) or isinstance(exc, httpx.UnsupportedProtocol) or not host:
        spec = ("bad_request", "invalid_url", "Invalid URL", False, "The URL is not valid.")
    elif isinstance(exc, httpx.TimeoutException):
        spec = ("upstream_unavailable", "connection_timed_out", "Connection timed out", True, "The server did not respond in time.")
    elif isinstance(exc, httpx.ConnectError) and any(s in text for s in ("Name or service not known", "nodename nor servname",
                                                                         "getaddrinfo", "No address associated")):
        spec = ("dns", "dns_resolution_failed", "Host not found", False, f"The hostname {host} could not be resolved.")
    elif isinstance(exc, httpx.ConnectError) and ("CERTIFICATE" in text.upper() or "SSL" in text.upper()):
        spec = ("tls", "tls_error", "TLS error", False, "The server's TLS certificate or handshake was rejected.")
    elif isinstance(exc, (httpx.ConnectError, httpx.RemoteProtocolError, httpx.ReadError)):
        spec = ("upstream_unavailable", "connection_failed", "Connection failed", True, "The connection to the server failed.")
    else:
        spec = ("upstream_unavailable", "network_error", "Network error", True,
                "The request failed before any HTTP response was received.")
    category, name, title, retryable, detail = spec
    guidance = ("Wait 5 seconds, then retry with exponential backoff. Stop after a few attempts and report the error if it persists."
                if retryable else {"dns": "Do not retry. Check the hostname for typos; the site may not exist.",
                                   "tls": "Do not retry, and do not disable certificate checks. Report the TLS problem to the user."
                                   }.get(category, "Do not retry. Fix the URL."))
    p: Dict[str, Any] = {
        "type": f"https://artzab0.github.io/errdown/errors/{name}", "title": title, "status": 0,
        "detail": f"{detail} ({type(exc).__name__})", "instance": url, "error_code": 0, "error_name": name,
        "error_category": category, "retryable": retryable, "owner_action_required": False,
        "what_you_should_do": guidance,
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z",
        "errdown_synthesized": True, "errdown_source": "network", "errdown_confidence": 0.9,
    }
    if retryable:
        p["retry_after"] = 5
    if host:
        p["zone"] = host
    return p


MAX_ATTEMPTS = 3
_attempts: Dict[str, tuple] = {}


def note_attempt(url: str, failed: bool, retryable: bool) -> int:
    """Consecutive retryable failures per URL in this process (reset on success or after 10 min)."""
    now = time.monotonic()
    if not failed or not retryable:
        _attempts.pop(url, None)
        return 0
    n, t = _attempts.get(url, (0, 0.0))
    n = n + 1 if now - t < 600 else 1
    _attempts[url] = (n, now)
    return n


def problem_text(p: Dict[str, Any], attempt: int = 0) -> str:
    """The one-line error the agent sees, with the attempt counter for repeated retryable failures."""
    line = to_compact(p)
    if not p.get("retryable") or attempt == 0:
        return line
    if attempt >= MAX_ATTEMPTS:
        return re.sub(r"Retryable: .*$", f"Failed {attempt} times in a row; stop retrying and report the error to the user.", line)
    return line.replace("(max 3 tries)", f"(attempt {attempt} of {MAX_ATTEMPTS})")

async def fetch_impl(url: str, max_length: int = 20000, start_index: int = 0, raw: bool = False,
                     client: Optional[httpx.AsyncClient] = None) -> Dict[str, Any]:
    own = client is None
    buf = bytearray()
    try:
        client = client or httpx.AsyncClient(follow_redirects=True, timeout=30)
        scheme = urlsplit(url).scheme
        if scheme not in ("http", "https"):
            raise httpx.UnsupportedProtocol(f"unsupported scheme {scheme!r}")
        async with client.stream("GET", url, headers={"accept": agent_accept_header(), "user-agent": UA}) as res:
            async for chunk in res.aiter_bytes():
                buf += chunk
                if len(buf) >= MAX_BYTES:
                    break
            final_url = str(res.url)
            status, headers = res.status_code, res.headers
    except Exception as exc:  # no HTTP response
        p = network_problem(exc, url)
        return {"isError": True, "text": problem_text(p, note_attempt(url, True, p["retryable"])), "problem": p}
    finally:
        if own and client is not None:
            try:
                await client.aclose()
            except Exception:
                pass
    body = bytes(buf[:MAX_BYTES])
    problem = normalize(status, headers, body, url=final_url)
    if problem:
        return {"isError": True, "text": problem_text(problem, note_attempt(url, True, problem["retryable"])), "problem": problem}
    note_attempt(url, False, False)
    text = body.decode(headers.encoding or "utf-8", errors="replace") if hasattr(headers, "encoding") else body.decode("utf-8", "replace")
    if not raw and "html" in headers.get("content-type", ""):
        try:
            text = markdownify(_NOISE.sub("", text), heading_style="ATX")
        except Exception:
            pass
    total = len(text)
    if start_index >= total > 0:
        return {"isError": False, "text": f"<error>start_index {start_index} is past the end of the content ({total} chars).</error>"}
    chunk = text[start_index:start_index + max_length]
    nxt = start_index + len(chunk)
    if nxt < total:
        chunk += f"\n\n<truncated>Content truncated at {nxt} of {total} chars. Call fetch with start_index={nxt} to continue.</truncated>"
    return {"isError": False, "text": f"Contents of {final_url}:\n\n{chunk}"}


@mcp.tool(name="fetch", description=(
    "Fetch a URL and return its content as Markdown. If the request fails (HTTP error, bot challenge, "
    "DNS/TLS/connection failure), returns a one-line structured error: HTTP status, category, and whether "
    "to retry (e.g. 'HTTP 503 upstream_unavailable (nginx). Retryable: wait 5s, then retry (max 3 tries).'). "
    "Follow it: retry only when it says retryable; never try to bypass a challenge."))
async def fetch(url: str, max_length: int = 20000, start_index: int = 0, raw: bool = False) -> CallToolResult:
    r = await fetch_impl(url, max_length, start_index, raw)
    return CallToolResult(content=[TextContent(type="text", text=r["text"])], is_error=r["isError"])


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
