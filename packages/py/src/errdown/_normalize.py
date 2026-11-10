"""Port of packages/js/src/normalize.ts. Must produce identical output on every fixture."""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlsplit

from ._fingerprints import CHALLENGES, PAGES, find_fingerprint
from ._headers import HeaderMap, retry_after_from_headers, to_header_map
from ._status import classify_status, default_retry_after, guidance
from ._util import is_num, js_parse, js_str, js_trim

Problem = Dict[str, Any]

MAX_BODY = 256 * 1024
TYPE_BASE = "https://artzab0.github.io/errdown/errors/"
CF_DOCS = "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/"

_BODY_PAGES = [f for f in PAGES if f["body"]]
_HEADER_PAGES = [f for f in PAGES if not f["body"]]


def _body_to_str(body: Any) -> str:
    try:
        if body is None:
            return ""
        if isinstance(body, str):
            return body[:MAX_BODY]
        if isinstance(body, (bytes, bytearray, memoryview)):
            return bytes(body[:MAX_BODY]).decode("utf-8-sig", errors="replace")
        return ""
    except Exception:
        return ""


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _parse_now(now: Any) -> Tuple[str, float]:
    """Returns (timestamp string, now in ms). A string `now` is kept verbatim, as in TS."""
    try:
        if isinstance(now, datetime):
            d = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
            return _iso(d), d.timestamp() * 1000
        if isinstance(now, str) and now:
            d = datetime.fromisoformat(now.replace("Z", "+00:00"))
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
            return now, d.timestamp() * 1000
    except Exception:
        pass
    ms = time.time() * 1000
    return _iso(datetime.fromtimestamp(ms / 1000, tz=timezone.utc)), ms


def _host_of(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    try:
        u = urlsplit(url)
        if not u.scheme or not u.hostname:
            return None
        host = u.hostname
        if ":" in host:
            host = f"[{host}]"
        port = u.port
        default = {"http": 80, "https": 443, "ws": 80, "wss": 443}.get(u.scheme.lower())
        return f"{host}:{port}" if port is not None and port != default else host
    except Exception:
        return None


_CTRL = re.compile("[\u0000-\u001f\u007f-\u009f  ]+")
_WS = re.compile(r"[\s\ufeff]+")  # JS \s includes U+FEFF


def sanitize(text: str, max_len: int = 200) -> str:
    """Strip control chars/newlines and truncate, for quoting untrusted text (SPEC §7)."""
    clean = js_trim(_WS.sub(" ", _CTRL.sub(" ", text)))
    return clean[: max_len - 1] + "…" if len(clean) > max_len else clean


def _try_json(body: str) -> Any:
    t = body.lstrip()
    if not t or t[0] not in "{[":
        return _MISSING
    try:
        return js_parse(body)
    except Exception:
        return _MISSING


_MISSING = object()

# [category, error_name, title, owner_action_required?, retryable?]
CF_CODES: Dict[int, tuple] = {
    1000: ("dns", "dns_loop", "DNS points to prohibited IP", True, False),
    1001: ("dns", "dns_resolution_error", "DNS resolution error", True),
    1003: ("config", "direct_ip_access_not_allowed", "Direct IP access not allowed"),
    1006: ("access_denied", "access_denied_ip_banned", "Access denied"),
    1007: ("access_denied", "access_denied_ip_banned", "Access denied"),
    1008: ("access_denied", "access_denied_ip_banned", "Access denied"),
    1009: ("access_denied", "access_denied_country", "Access denied (country or region banned)"),
    1010: ("access_denied", "access_denied_browser_signature", "Access denied (browser signature)"),
    1012: ("access_denied", "access_denied", "Access denied"),
    1014: ("config", "cname_cross_user_banned", "CNAME cross-user banned", True),
    1015: ("rate_limit", "rate_limited", "You are being rate limited"),
    1016: ("dns", "origin_dns_error", "Origin DNS error", True, False),
    1020: ("access_denied", "access_denied", "Access denied (firewall rule)"),
    1034: ("config", "edge_ip_restricted", "Edge IP restricted"),
    520: ("upstream_unavailable", "origin_unknown_error", "Web server returned an unknown error", False, True),
    521: ("upstream_unavailable", "origin_down", "Web server is down", False, True),
    522: ("upstream_unavailable", "origin_connection_timed_out", "Connection timed out", False, True),
    523: ("upstream_unavailable", "origin_unreachable", "Origin is unreachable", False, True),
    524: ("upstream_unavailable", "origin_timeout", "A timeout occurred", False, True),
    525: ("tls", "ssl_handshake_failed", "SSL handshake failed", True, False),
    526: ("tls", "invalid_ssl_certificate", "Invalid SSL certificate", True, False),
    1101: ("worker", "worker_threw_exception", "Worker threw exception", True, False),
    1102: ("worker", "worker_exceeded_resource_limits", "Worker exceeded resource limits", True),
}

# ---------- Cloudflare Markdown ----------

_FM = re.compile(r"^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)\Z")
_KV = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*):\s?(.*)\Z", re.S)
_NUMERIC = re.compile(r"-?[0-9]+(\.[0-9]+)?\Z")
_TITLE = re.compile(r"^#\s+(.+)$", re.M)
_FOOTER = re.compile(r"\n---[ \t]*\r?\n([\s\S]*?)\s*\Z")


def _parse_scalar(v: str) -> Any:
    s = js_trim(v)
    if s == "true":
        return True
    if s == "false":
        return False
    if s in ("null", "~", ""):
        return _MISSING
    if _NUMERIC.match(s):
        return float(s) if "." in s else int(s)
    if len(s) >= 2 and ((s[0] == '"' and s[-1] == '"') or (s[0] == "'" and s[-1] == "'")):
        return s[1:-1]
    if s in ('"', "'"):
        return s
    return s


def _section(rest: str, name: str) -> Optional[str]:
    rx = re.compile(r"^##\s+" + name + r"\s*$([\s\S]*?)(?=^##\s|^---\s*$|\Z)", re.M | re.I)
    m = rx.search(rest)
    return js_trim(m.group(1)) if m else None


def _parse_cf_markdown(body: str) -> Optional[Dict[str, Any]]:
    m = _FM.match(body)
    if not m:
        return None
    fm: Dict[str, Any] = {}
    for line in re.split(r"\r?\n", m.group(1)):
        kv = _KV.match(line)
        if kv:
            v = _parse_scalar(kv.group(2))
            if v is not _MISSING:
                fm[kv.group(1)] = v
    if "error_code" not in fm:
        return None
    rest = m.group(2)
    t = _TITLE.search(rest)
    title = js_trim(t.group(1)) if t else None
    if title:
        fm["title"] = title
    detail = _section(rest, "What Happened")
    if detail:
        fm["detail"] = detail
    todo = _section(rest, "What You Should Do")
    if todo:
        fm["what_you_should_do"] = todo
    f = _FOOTER.search(rest)
    footer = js_trim(f.group(1)) if f else None
    if footer:
        fm["footer"] = footer
    return fm


# ---------- Assembly ----------

class _Ctx:
    __slots__ = ("status", "h", "url", "timestamp", "now_ms")

    def __init__(self, status: int, h: HeaderMap, url: Optional[str], timestamp: str, now_ms: float):
        self.status, self.h, self.url, self.timestamp, self.now_ms = status, h, url, timestamp, now_ms


def _nn(v: Any, d: Any) -> Any:
    """JS `v ?? d`."""
    return d if v is None else v


def _finish(p: Dict[str, Any], ctx: _Ctx) -> Problem:
    status = p["status"]
    base = classify_status(status)
    category = _nn(p.get("error_category"), base["category"])
    retryable = _nn(p.get("retryable"), base["retryable"])
    owner = _nn(p.get("owner_action_required"), base["owner_action_required"])
    retry_after = p.get("retry_after")
    if retry_after is None and retryable:
        retry_after = _nn(retry_after_from_headers(ctx.h, ctx.now_ms), default_retry_after(status))
    error_name = _nn(p.get("error_name"), base["error_name"])

    out: Dict[str, Any] = {
        "type": _nn(p.get("type"), TYPE_BASE + js_str(error_name)),
        "title": _nn(p.get("title"), base["title"]),
        "status": status,
        "detail": _nn(p.get("detail"), f"The server returned HTTP {status}."),
        "instance": _nn(p.get("instance"), ctx.url),
        "error_code": _nn(p.get("error_code"), status),
        "error_name": error_name,
        "error_category": category,
        "retryable": retryable,
        "retry_after": retry_after,
        "owner_action_required": owner,
        "what_you_should_do": _nn(p.get("what_you_should_do"), guidance(category, bool(retryable), bool(owner), retry_after)),
        "timestamp": _nn(p.get("timestamp"), ctx.timestamp),
        "zone": _nn(p.get("zone"), _host_of(ctx.url)),
        "footer": p.get("footer"),
        "ray_id": p.get("ray_id"),
        "cloudflare_error": p.get("cloudflare_error"),
        "errdown_synthesized": _nn(p.get("errdown_synthesized"), True),
        "errdown_source": _nn(p.get("errdown_source"), "unknown"),
        "errdown_confidence": _nn(p.get("errdown_confidence"), 0.5),
    }
    for k, v in p.items():
        if k not in out:
            out[k] = v
    # TS deletes `undefined` core members; extension members are kept as-is (ordered() drops nulls).
    return {k: v for k, v in out.items() if not (k in _CORE and v is None)}


_CORE = {"type", "title", "status", "detail", "instance", "error_code", "error_name", "error_category",
         "retryable", "retry_after", "owner_action_required", "what_you_should_do", "timestamp", "zone",
         "footer", "ray_id", "cloudflare_error", "errdown_synthesized", "errdown_source", "errdown_confidence"}

_RAY_HDR = re.compile(r"[0-9a-f]{8,32}\Z", re.I)
_RAY_BODY = re.compile(r"Ray ID:?\s*(?:<[^>]{0,80}>\s*)?([0-9a-f]{16})", re.I)


def _ray_id(ctx: _Ctx, body: str = "") -> Optional[str]:
    hdr = ctx.h.get("cf-ray")
    if hdr is not None:
        first = js_trim(hdr).split("-")[0]
        if first and _RAY_HDR.match(first):
            return first.lower()
    m = _RAY_BODY.search(body)
    return m.group(1) if m else None


def _cf_meta(ctx: _Ctx, body: str = "") -> Dict[str, Any]:
    ray = _ray_id(ctx, body)
    meta: Dict[str, Any] = {"errdown_source": "cloudflare", "cloudflare_error": True}
    if ray:
        meta["ray_id"] = ray
    return meta


def _from_fp(fp: Dict[str, Any], ctx: _Ctx, challenge: bool, body: str = "") -> Problem:
    base = classify_status(ctx.status)
    category = "challenge" if challenge else _nn(fp.get("category"), base["category"])
    label = "" if fp["source"] == "unknown" else fp["source"].replace("-", "_") + "_"
    error_name = _nn(fp.get("error_name"), label + base["error_name"])
    if challenge:
        what = "a bot-verification challenge page"
    elif fp["source"] == "unknown":
        what = "a block page"
    else:
        what = f"an error page from {fp['source']}"
    p: Dict[str, Any] = {
        "status": ctx.status,
        "title": _nn(fp.get("title"), base["title"]),
        "detail": _nn(fp.get("detail"), f"The server returned HTTP {ctx.status} with {what}."),
        "error_name": error_name,
        "error_category": category,
        "retryable": False if challenge else _nn(fp.get("retryable"), base["retryable"]),
        "owner_action_required": _nn(fp.get("owner_action_required"), base["owner_action_required"]),
        "errdown_source": fp["source"],
        "errdown_confidence": fp["confidence"],
    }
    if fp["source"] == "cloudflare":
        p.update(_cf_meta(ctx, body))
    return _finish(p, ctx)


def _str(v: Any) -> Optional[str]:
    if isinstance(v, str) and js_trim(v):
        return v
    if is_num(v):
        return js_str(v)
    return None


def _first(*vals: Optional[str]) -> Optional[str]:
    for v in vals:
        if v is not None:
            return v
    return None


def _message_from_json(j: Any) -> Optional[Dict[str, Optional[str]]]:
    if not isinstance(j, dict):
        return None
    j = {str(k).lower(): v for k, v in j.items()}
    errors = j.get("errors")
    if isinstance(errors, list) and errors:
        e = errors[0]
        if isinstance(e, dict):
            ext = e.get("extensions") if isinstance(e.get("extensions"), dict) else {}
            return {"message": _str(e.get("message")), "code": _first(_str(ext.get("code")), _str(e.get("code")))}
        if isinstance(e, str):
            return {"message": e, "code": None}
    if isinstance(errors, str):
        return {"message": errors, "code": None}
    detail = j.get("detail")
    if isinstance(detail, list) and detail and isinstance(detail[0], dict):
        d0 = detail[0]
        return {"message": _first(_str(d0.get("msg")), _str(d0.get("message"))), "code": _str(d0.get("type"))}
    err = j.get("error")
    if isinstance(err, str) and isinstance(j.get("error_description"), str):
        return {"message": j["error_description"], "code": err}
    if isinstance(err, dict):
        em = {"message": _first(_str(err.get("message")), _str(err.get("detail"))),
              "code": _first(_str(err.get("code")), _str(err.get("type")))}
        if em["message"] or em["code"]:
            return em  # else fall through (e.g. Dropbox {"error": {".tag": ...}})
    if isinstance(err, str):
        return {"message": _first(_str(j.get("message")), err), "code": _str(j.get("code"))}
    um = j.get("user_message")
    if isinstance(um, dict) and _str(um.get("text")):
        return {"message": _str(um.get("text")), "code": _str(j.get("error_summary"))}
    if _str(j.get("err")):
        return {"message": _str(j.get("err")), "code": _first(_str(j.get("ecode")), _str(j.get("code")))}
    if _str(j.get("message")) or _str(detail):
        return {"message": _first(_str(j.get("message")), _str(detail)), "code": _str(j.get("code"))}
    return None


_MSG_AUTH = re.compile(r"missing[ -]?authenticat|authentication (token|required|failed)|unauthenticated|unregistered callers|api[ _-]?key (is )?(not valid|invalid|missing|required)|(missing|invalid|no) (api[ _-]?key|access token|auth token|bearer token|token|credentials|authorization)|invalid [a-z-]+ or api[ _-]?key|authorization (header )?(is )?required|missing x-auth|not authenticated|login required", re.I)
_MSG_RATE = re.compile(r"rate[ -]?limit(ed)? exceeded|too many requests|quota exceeded|api rate limit", re.I)
_AUTH_CODES = re.compile(r"^(MissingAuthenticationToken|UNAUTHENTICATED|InvalidClientTokenId)\b")


def _category_from_message(status: int, m: Dict[str, Optional[str]]) -> Dict[str, Any]:
    """SPEC §5 stage 4: on 400/403, an explicit message about credentials or rate limits decides."""
    if status not in (400, 403):
        return {}
    text = f"{m.get('code') or ''} {m.get('message') or ''}"[:1000]
    if _MSG_RATE.search(text):
        return {"error_category": "rate_limit", "error_name": "rate_limited", "title": "Rate limited", "retryable": True}
    if _MSG_AUTH.search(text) or _AUTH_CODES.search(m.get("code") or ""):
        return {"error_category": "auth_required", "error_name": "auth_required", "title": "Authentication required",
                "retryable": False}
    return {}


_XML_HEAD = re.compile(r"^[\s\ufeff]*(<\?xml[^>]{0,200}\?>[\s\ufeff]*)?<(Error|ErrorResponse)[\s\ufeff>]")


def _message_from_xml(body: str) -> Optional[Dict[str, Optional[str]]]:
    if not _XML_HEAD.search(body):
        return None

    def tag(t: str) -> Optional[str]:
        m = re.search("<" + t + ">([^<]{1,500})</" + t + ">", body)
        return js_trim(m.group(1)) if m else None

    code, message = tag("Code"), tag("Message")
    return {"code": code, "message": message} if (code or message) else None


_XML_SOURCES = [
    ("server", re.compile(r"^AmazonS3\Z", re.I), "aws-s3"),
    ("server", re.compile(r"^UploadServer\Z", re.I), "google-cloud-storage"),
    ("x-amzn-requestid", re.compile(r"."), "aws"),
    ("x-ms-request-id", re.compile(r"."), "azure"),
]
_PLAIN_CF = re.compile(r"^[\s\ufeff]*error code: (1[0-9]{3}|5[0-9]{2})[\s\ufeff]*\Z")


def normalize(status: int, headers: Any = None, body: Any = None, *, url: Optional[str] = None,
              now: Any = None) -> Optional[Problem]:
    """Convert an HTTP response into a Cloudflare-compatible Problem, or None if not an error.

    Never raises. `body` may be str or bytes; `headers` a dict, list of pairs, or any object
    with .items() (httpx, requests, aiohttp). `now` (datetime or ISO string) pins the timestamp.
    """
    try:
        timestamp, now_ms = _parse_now(now)
        st = status if isinstance(status, int) and not isinstance(status, bool) else 0
        ctx = _Ctx(st, to_header_map(headers), url, timestamp, now_ms)
    except Exception:
        return None
    try:
        return _run(ctx, _body_to_str(body))
    except Exception:
        if ctx.status < 400:
            return None
        try:
            return _finish({"status": ctx.status, "errdown_confidence": 0.3}, ctx)
        except Exception:
            return None


def scan_window(body: str) -> str:
    """Fingerprints only look at the head and tail of large bodies (SPEC §5)."""
    return body[:32768] + "\n" + body[-8192:] if len(body) > 40960 else body


def _run(ctx: _Ctx, full_body: str) -> Optional[Problem]:
    status, h = ctx.status, ctx.h
    body = scan_window(full_body)
    is_error = 400 <= status <= 999

    challenge = find_fingerprint(CHALLENGES, status, h, body)
    if challenge and (is_error or challenge.get("category") != "access_denied"):
        return _from_fp(challenge, ctx, challenge.get("category") != "access_denied", body)
    if not is_error:
        return None

    ctype = h.get("content-type", "")
    j = _try_json(full_body)

    # 1. Structured pass-through.
    if isinstance(j, dict) and ("problem+json" in ctype or ("type" in j and "status" in j) or "error_code" in j):
        cf = is_num(j.get("error_code")) and ("ray_id" in j or "cf-error-type" in h)
        p: Dict[str, Any] = {"errdown_synthesized": False, "errdown_source": "cloudflare" if cf else "origin",
                             "errdown_confidence": 1}
        if cf:
            p["cloudflare_error"] = True
        p.update(j)
        p["status"] = j["status"] if is_num(j.get("status")) else status
        return _finish(p, ctx)
    md = _parse_cf_markdown(full_body) if ("markdown" in ctype or body.lstrip().startswith("---")) else None
    if md:
        cf = "ray_id" in md or "cf-error-type" in h
        p = {"errdown_synthesized": False, "errdown_source": "cloudflare" if cf else "origin", "errdown_confidence": 1}
        if cf:
            p["cloudflare_error"] = True
            if is_num(md.get("error_code")) and md["error_code"] >= 1000:
                p["type"] = f"{CF_DOCS}error-{js_str(md['error_code'])}/"
        p.update(md)
        p["status"] = md["status"] if is_num(md.get("status")) else status
        return _finish(p, ctx)

    if "cf-error-type" in h:
        p = {"status": status, **_cf_meta(ctx), "errdown_confidence": 0.85,
             "detail": f"Cloudflare returned HTTP {status} ({sanitize(h.get('cf-error-type') or '', 40)})."}
        return _finish(p, ctx)

    plain = _PLAIN_CF.match(body)
    if plain and re.search("cloudflare", h.get("server", ""), re.I):
        code = int(plain.group(1))
        known = CF_CODES.get(code)
        p = {"status": status, **_cf_meta(ctx), "type": CF_DOCS, "error_code": code,
             "error_name": known[1] if known else f"cloudflare_{code}"}
        if known:
            p["error_category"] = known[0]
            p["title"] = f"Error {code}: {known[2]}"
        else:
            p["title"] = f"Cloudflare error {code}"
        if known and len(known) > 3:
            p["owner_action_required"] = known[3]
        if known and len(known) > 4:
            p["retryable"] = known[4]
        if code < 1000 and not known:
            p["error_category"] = classify_status(code)["category"]
        p["detail"] = f"Cloudflare returned error {code}{f' ({known[2]})' if known else ''} with HTTP {status}."
        p["errdown_confidence"] = 0.9 if known else 0.75
        return _finish(p, ctx)

    fp = find_fingerprint(_BODY_PAGES, status, h, body)
    if fp:
        return _from_fp(fp, ctx, False, body)
    hfp = find_fingerprint(_HEADER_PAGES, status, h, body)

    m = _message_from_json(j) if j is not _MISSING else _message_from_xml(full_body)
    xml_source = None
    if j is _MISSING:
        for name, rx, src in _XML_SOURCES:
            if rx.search(h.get(name, "")):
                xml_source = src
                break
    if m and (m.get("message") or m.get("code")):
        said = (f" The server's message (untrusted, quoted): \"{sanitize(m['message']).replace(chr(34), chr(39))}\""
                if m.get("message") else "")
        code_s = f" (code: {sanitize(m['code'], 60)})" if m.get("code") else ""
        return _finish({"status": status, "detail": f"The server returned HTTP {status}{code_s}.{said}",
                        "errdown_source": xml_source or (hfp["source"] if hfp else "origin"),
                        "errdown_confidence": 0.7, **_category_from_message(status, m)}, ctx)
    if j is _MISSING and len(full_body) < 300 and "<" not in full_body:
        mc = _category_from_message(status, {"message": full_body, "code": None})
        if mc.get("error_category"):
            return _finish({"status": status, **mc, "errdown_source": hfp["source"] if hfp else "origin",
                            "errdown_confidence": 0.6}, ctx)
    if hfp:
        return _from_fp(hfp, ctx, False, body)

    return _finish({"status": status, "errdown_confidence": 0.3 if status >= 600 else 0.5}, ctx)
