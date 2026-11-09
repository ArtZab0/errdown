import type { Category } from "./types.ts";

export interface Classification {
  category: Category;
  error_name: string;
  title: string;
  retryable: boolean;
  owner_action_required: boolean;
}

const c = (
  category: Category, error_name: string, title: string,
  retryable = false, owner_action_required = false,
): Classification => ({ category, error_name, title, retryable, owner_action_required });

const TABLE: Record<number, Classification> = {
  400: c("bad_request", "bad_request", "Bad request"),
  401: c("auth_required", "auth_required", "Authentication required"),
  403: c("access_denied", "forbidden", "Access denied"),
  404: c("not_found", "not_found", "Not found"),
  405: c("bad_request", "method_not_allowed", "Method not allowed"),
  406: c("bad_request", "not_acceptable", "Not acceptable"),
  407: c("auth_required", "proxy_auth_required", "Proxy authentication required"),
  408: c("upstream_unavailable", "request_timeout", "Request timeout", true),
  409: c("bad_request", "conflict", "Conflict"),
  410: c("not_found", "gone", "Gone"),
  411: c("bad_request", "length_required", "Length required"),
  412: c("bad_request", "precondition_failed", "Precondition failed"),
  413: c("bad_request", "payload_too_large", "Payload too large"),
  414: c("bad_request", "uri_too_long", "URI too long"),
  415: c("bad_request", "unsupported_media_type", "Unsupported media type"),
  422: c("bad_request", "unprocessable_content", "Unprocessable content"),
  429: c("rate_limit", "rate_limited", "Rate limited", true),
  451: c("legal", "unavailable_for_legal_reasons", "Unavailable for legal reasons"),
  500: c("server_error", "internal_server_error", "Internal server error", true),
  501: c("unsupported", "not_implemented", "Not implemented"),
  502: c("upstream_unavailable", "bad_gateway", "Bad gateway", true),
  503: c("upstream_unavailable", "service_unavailable", "Service unavailable", true),
  504: c("upstream_unavailable", "gateway_timeout", "Gateway timeout", true),
};

export function classifyStatus(status: number): Classification {
  const hit = TABLE[status];
  if (hit) return { ...hit };
  if (status >= 500) return c("server_error", "server_error", "Server error", true);
  return c("bad_request", "client_error", "Client error");
}

export function defaultRetryAfter(status: number): number {
  return status === 429 ? 60 : 5;
}

export function guidance(p: {
  error_category: string; retryable: boolean; owner_action_required: boolean; retry_after?: number;
}): string {
  if (p.error_category === "challenge") {
    return "Stop. This site requires a human to complete a check (CAPTCHA or bot verification). Do not retry automatically and do not attempt to bypass it. Ask the user to open the page in a browser.";
  }
  if (p.owner_action_required) {
    return "This needs the site owner to fix. Do not retry. Report the error to the user or the site operator.";
  }
  if (p.retryable) {
    const n = p.retry_after ?? 5;
    return `Wait ${n} seconds, then retry with exponential backoff. Stop after a few attempts and report the error if it persists.`;
  }
  switch (p.error_category) {
    case "access_denied":
      return "Do not retry. Access was intentionally blocked. Tell the user; they may need to request access from the site owner.";
    case "legal":
      return "Do not retry. This content is unavailable in this location for legal reasons.";
    case "auth_required":
      return "Do not retry without credentials. Ask the user to authenticate or provide credentials.";
    case "not_found":
      return "Do not retry. Check the URL for mistakes, or search for the resource elsewhere.";
    case "bad_request":
      return "Do not retry the same request. Check the URL, method, headers and body, then fix the request.";
    case "unsupported":
      return "Do not retry. The server does not support this request.";
    default:
      return "Do not retry the same request. Report the error to the user.";
  }
}
