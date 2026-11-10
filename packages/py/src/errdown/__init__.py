"""errdown: Cloudflare-compatible structured errors (RFC 9457) for every HTTP error an agent hits.

Pre-release (alpha). Zero dependencies. `normalize()` never raises.
"""
from ._decide import agent_accept_header, backoff, decide
from ._normalize import normalize, sanitize
from ._render import ordered, to_compact, to_json, to_markdown

__all__ = ["normalize", "to_markdown", "to_json", "to_compact", "ordered", "decide", "backoff", "agent_accept_header", "sanitize"]
__version__ = "0.1.0a2"
