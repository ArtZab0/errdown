from __future__ import annotations

import random as _random
from typing import Any, Callable, Dict, Optional

_ESCALATE = {"challenge", "access_denied", "legal", "auth_required"}


def decide(p: Dict[str, Any]) -> Dict[str, Any]:
    """Cloudflare's recommended control flow: retryable -> wait; owner action -> escalate; else fail fast."""
    cat = p.get("error_category")
    if cat == "challenge":
        return {"action": "escalate", "reason": "challenge"}
    if p.get("retryable"):
        ra = p.get("retry_after")
        return {"action": "retry", "after_seconds": 5 if ra is None else ra}
    if p.get("owner_action_required"):
        return {"action": "escalate", "reason": "owner_action_required"}
    if cat in _ESCALATE:
        return {"action": "escalate", "reason": cat}
    return {"action": "fail", "reason": p.get("error_name")}


def backoff(attempt: int, *, base: float = 1, max: float = 60, min: float = 0,
            random: Optional[Callable[[], float]] = None) -> float:
    """Exponential backoff with full jitter. attempt starts at 0. Honors a server-given minimum."""
    rand = random or _random.random
    ceiling = _min(max, base * 2 ** _max(0, attempt))
    return _max(min, rand() * ceiling)


_min, _max = min, max  # keyword args above shadow the builtins inside backoff()


def agent_accept_header(mode: str = "markdown") -> str:
    """The Accept header Cloudflare recommends for agents."""
    return "application/json, */*" if mode == "json" else "text/markdown, */*"
