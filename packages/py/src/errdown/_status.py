from __future__ import annotations

from typing import Any, Dict, Optional


def _c(category: str, error_name: str, title: str, retryable: bool = False, owner: bool = False) -> Dict[str, Any]:
    return {"category": category, "error_name": error_name, "title": title,
            "retryable": retryable, "owner_action_required": owner}


_TABLE: Dict[int, Dict[str, Any]] = {
    400: _c("bad_request", "bad_request", "Bad request"),
    401: _c("auth_required", "auth_required", "Authentication required"),
    403: _c("access_denied", "forbidden", "Access denied"),
    404: _c("not_found", "not_found", "Not found"),
    405: _c("bad_request", "method_not_allowed", "Method not allowed"),
    406: _c("bad_request", "not_acceptable", "Not acceptable"),
    407: _c("auth_required", "proxy_auth_required", "Proxy authentication required"),
    408: _c("upstream_unavailable", "request_timeout", "Request timeout", True),
    409: _c("bad_request", "conflict", "Conflict"),
    410: _c("not_found", "gone", "Gone"),
    411: _c("bad_request", "length_required", "Length required"),
    412: _c("bad_request", "precondition_failed", "Precondition failed"),
    413: _c("bad_request", "payload_too_large", "Payload too large"),
    414: _c("bad_request", "uri_too_long", "URI too long"),
    415: _c("bad_request", "unsupported_media_type", "Unsupported media type"),
    422: _c("bad_request", "unprocessable_content", "Unprocessable content"),
    429: _c("rate_limit", "rate_limited", "Rate limited", True),
    431: _c("bad_request", "request_header_fields_too_large", "Request header fields too large"),
    451: _c("legal", "unavailable_for_legal_reasons", "Unavailable for legal reasons"),
    500: _c("server_error", "internal_server_error", "Internal server error", True),
    501: _c("unsupported", "not_implemented", "Not implemented"),
    502: _c("upstream_unavailable", "bad_gateway", "Bad gateway", True),
    503: _c("upstream_unavailable", "service_unavailable", "Service unavailable", True),
    504: _c("upstream_unavailable", "gateway_timeout", "Gateway timeout", True),
}


def classify_status(status: int) -> Dict[str, Any]:
    hit = _TABLE.get(status)
    if hit:
        return dict(hit)
    if status >= 600:
        return _c("bad_request", "nonstandard_status", "Nonstandard error status")
    if status >= 500:
        return _c("server_error", "server_error", "Server error", True)
    return _c("bad_request", "client_error", "Client error")


def default_retry_after(status: int) -> int:
    return 60 if status == 429 else 5


def guidance(category: str, retryable: bool, owner: bool, retry_after: Optional[Any]) -> str:
    if category == "challenge":
        return ("Stop. This site requires a human to complete a check (CAPTCHA or bot verification). "
                "Do not retry automatically and do not attempt to bypass it. Ask the user to open the page in a browser.")
    if owner:
        return "This needs the site owner to fix. Do not retry. Report the error to the user or the site operator."
    if retryable:
        n = retry_after if retry_after is not None else 5
        from ._util import js_str
        return (f"Wait {js_str(n)} seconds, then retry with exponential backoff. "
                "Stop after a few attempts and report the error if it persists.")
    return {
        "access_denied": "Do not retry. Access was intentionally blocked. Tell the user; they may need to request access from the site owner.",
        "legal": "Do not retry. This content is unavailable in this location for legal reasons.",
        "auth_required": "Do not retry without credentials. Ask the user to authenticate or provide credentials.",
        "not_found": "Do not retry. Check the URL for mistakes, or search for the resource elsewhere.",
        "bad_request": "Do not retry the same request. Check the URL, method, headers and body, then fix the request.",
        "unsupported": "Do not retry. The server does not support this request.",
    }.get(category, "Do not retry the same request. Report the error to the user.")
