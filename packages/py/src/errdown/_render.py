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
