from __future__ import annotations

import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Dict, Optional

from ._util import js_round

HeaderMap = Dict[str, str]


def to_header_map(h: Any) -> HeaderMap:
    """Accepts dict, list of pairs, or anything with .items() (httpx/requests/aiohttp headers)."""
    m: HeaderMap = {}
    if not h:
        return m

    def put(k: Any, v: Any) -> None:
        if not isinstance(k, str) or v is None:
            return
        m[k.lower()] = ", ".join(str(x) for x in v) if isinstance(v, (list, tuple)) else str(v)

    try:
        if hasattr(h, "multi_items"):  # httpx: keep repeated headers
            seen: Dict[str, list] = {}
            for k, v in h.multi_items():
                seen.setdefault(k.lower(), []).append(v)
            for k, vs in seen.items():
                put(k, vs if len(vs) > 1 else vs[0])
        elif hasattr(h, "items"):
            for k, v in h.items():
                put(k, v)
        else:
            for pair in h:
                if isinstance(pair, (list, tuple)) and len(pair) >= 2:
                    put(pair[0], pair[1])
    except Exception:
        pass
    return m


_MAX_RETRY = 86400
_DIGITS = re.compile(r"[0-9]+\Z")
_NUM = re.compile(r"[0-9]+(\.[0-9]+)?\Z")


def _clamp(n: float) -> int:
    return max(0, min(_MAX_RETRY, js_round(n)))


def _parse_date_ms(s: str) -> Optional[float]:
    try:
        dt = parsedate_to_datetime(s)
    except Exception:
        dt = None
    if dt is None:
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp() * 1000


def retry_after_from_headers(h: HeaderMap, now_ms: float) -> Optional[int]:
    ra = (h.get("retry-after") or "").strip()
    if ra:
        if _DIGITS.match(ra):
            return _clamp(int(ra))
        t = _parse_date_ms(ra)
        if t is not None:
            return _clamp((t - now_ms) / 1000)
    for name in ("ratelimit-reset", "x-ratelimit-reset", "x-rate-limit-reset"):
        v = (h.get(name) or "").strip()
        if v and _NUM.match(v):
            n = float(v)
            return _clamp(n - now_ms / 1000 if n > 1e9 else n)
    return None
