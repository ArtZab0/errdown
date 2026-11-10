from __future__ import annotations

import json
import re
from typing import Any, Dict

from ._util import is_num, js_str, js_stringify

_ORDER = [
    "type", "title", "status", "detail", "instance", "error_code", "error_name", "error_category",
    "ray_id", "timestamp", "zone", "cloudflare_error", "retryable", "retry_after", "owner_action_required",
    "what_you_should_do", "footer", "errdown_synthesized", "errdown_source", "errdown_confidence",
]
_FM_KEYS = [
    "error_code", "error_name", "error_category", "status", "ray_id", "timestamp", "zone",
    "cloudflare_error", "retryable", "retry_after", "owner_action_required",
    "errdown_synthesized", "errdown_source", "errdown_confidence",
]


def ordered(p: Dict[str, Any]) -> Dict[str, Any]:
    """Ordered copy (Cloudflare's member order) with None members removed."""
    out = {k: p[k] for k in _ORDER if p.get(k) is not None}
    for k, v in p.items():
        if k not in out and v is not None:
            out[k] = v
    return out


def to_json(p: Dict[str, Any], indent: Any = None) -> str:
    return js_stringify(ordered(p), indent)


_SAFE = re.compile(r"[A-Za-z0-9_.:/+@-][A-Za-z0-9_ .:/+@-]*\Z")
_RESERVED = re.compile(r"(true|false|null|~|-?[0-9]+(\.[0-9]+)?)\Z")


def _yaml_scalar(v: Any) -> str:
    if is_num(v) or isinstance(v, bool):
        return js_str(v)
    s = re.sub(r"[\r\n]+", " ", js_str(v))
    if _SAFE.match(s) and not _RESERVED.match(s) and not re.search(r":\s", s):
        return s
    return json.dumps(s, ensure_ascii=False)


def to_markdown(p: Dict[str, Any]) -> str:
    fm = [f"{k}: {_yaml_scalar(p[k])}" for k in _FM_KEYS if p.get(k) is not None]
    md = (f"---\n" + "\n".join(fm) + f"\n---\n\n# {js_str(p.get('title'))}\n\n## What Happened\n\n"
          f"{js_str(p.get('detail'))}\n\n## What You Should Do\n\n{js_str(p.get('what_you_should_do'))}\n")
    if p.get("footer"):
        md += f"\n---\n\n{js_str(p['footer'])}\n"
    return md


def _compact_advice(p: Dict[str, Any]) -> str:
    cat = str(p.get("error_category"))
    if cat == "challenge":
        return "Needs a human (CAPTCHA/bot check); do not retry or bypass."
    if p.get("owner_action_required"):
        return "Site owner must fix; do not retry."
    if p.get("retryable"):
        ra = p.get("retry_after")
        return f"Retryable: wait {js_str(5 if ra is None else ra)}s, then retry (max 3 tries); if it keeps failing, tell the user."
    return {
        "auth_required": "Not retryable: needs credentials; ask the user.",
        "access_denied": "Not retryable: access blocked.",
        "not_found": "Not retryable: check the URL.",
        "rate_limit": "Rate limited; wait before retrying.",
        "legal": "Not retryable: blocked for legal reasons.",
    }.get(cat, "Not retryable: fix the request.")


_SAID = re.compile(r'message \(untrusted, quoted\): "([^"]*)"')


def to_compact(p: Dict[str, Any]) -> str:
    """One-line form for token-constrained agents (~20-40 tokens). Byte-identical to TS toCompact()."""
    status = f"HTTP {js_str(p['status'])}" if p.get("status") else "Network error"
    ec = p.get("error_code")
    code = f" {js_str(ec)}" if is_num(ec) and ec >= 1000 else ""
    src_v = p.get("errdown_source")
    src = f" ({src_v})" if src_v and src_v not in ("unknown", "origin", "network") else ""
    m = _SAID.search(str(p.get("detail")))
    said = m.group(1) if m else None
    msg = f' Server said: "{said[:79] + chr(0x2026) if len(said) > 80 else said}".' if said else ""
    return f"Error: {status}{code} {p.get('error_category')}{src}.{msg} {_compact_advice(p)}"
