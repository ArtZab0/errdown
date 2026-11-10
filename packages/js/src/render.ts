import type { Problem } from "./types.ts";

const ORDER = [
  // Matches Cloudflare's observed JSON member order (captured 2026-11-10).
  "type", "title", "status", "detail", "instance", "error_code", "error_name", "error_category",
  "ray_id", "timestamp", "zone", "cloudflare_error", "retryable", "retry_after", "owner_action_required",
  "what_you_should_do", "footer", "errdown_synthesized", "errdown_source", "errdown_confidence",
];

/** Ordered copy of a Problem with null/undefined members removed. */
export function ordered(p: Problem): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ORDER) if (p[k] != null) out[k] = p[k];
  for (const k of Object.keys(p)) if (!(k in out) && p[k] != null) out[k] = p[k];
  return out;
}

export function toJSON(p: Problem, space?: number): string {
  return JSON.stringify(ordered(p), null, space);
}

const FM_KEYS = [
  "error_code", "error_name", "error_category", "status", "ray_id", "timestamp", "zone",
  "cloudflare_error", "retryable", "retry_after", "owner_action_required",
  "errdown_synthesized", "errdown_source", "errdown_confidence",
];

function yamlScalar(v: unknown): string {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v).replace(/[\r\n]+/g, " ");
  // Quote only when YAML would misread the value.
  return /^[\w.:\/+@-][\w .:\/+@-]*$/.test(s) && !/^(true|false|null|~|-?\d+(\.\d+)?)$/.test(s) && !/:\s/.test(s)
    ? s
    : JSON.stringify(s);
}

export function toMarkdown(p: Problem): string {
  const fm = FM_KEYS.filter((k) => p[k] != null).map((k) => `${k}: ${yamlScalar(p[k])}`);
  let md = `---\n${fm.join("\n")}\n---\n\n# ${p.title}\n\n## What Happened\n\n${p.detail}\n\n## What You Should Do\n\n${p.what_you_should_do}\n`;
  if (p.footer) md += `\n---\n\n${p.footer}\n`;
  return md;
}

/** Short guidance for the compact form. Keeps only what the agent acts on. */
function compactAdvice(p: Problem): string {
  const cat = String(p.error_category);
  if (cat === "challenge") return "Needs a human (CAPTCHA/bot check); do not retry or bypass.";
  if (p.owner_action_required) return "Site owner must fix; do not retry.";
  if (p.retryable) return `Retryable: wait ${p.retry_after ?? 5}s, then retry (max 3 tries); if it keeps failing, tell the user.`;
  switch (cat) {
    case "auth_required": return "Not retryable: needs credentials; ask the user.";
    case "access_denied": return "Not retryable: access blocked.";
    case "not_found": return "Not retryable: check the URL.";
    case "rate_limit": return "Rate limited; wait before retrying.";
    case "legal": return "Not retryable: blocked for legal reasons.";
    default: return "Not retryable: fix the request.";
  }
}

/**
 * One-line form for token-constrained agents (~20-40 tokens), e.g.
 *   Error: HTTP 503 upstream_unavailable (nginx). Retryable: wait 5s, then retry (max 3 tries); if it keeps failing, tell the user.
 * The "Error:" prefix and the closing instruction measurably stop small models (gpt-oss-20b) from
 * returning an empty reply after a repeated retryable error.
 * Includes the server's own message (sanitized, max 80 chars) when the body had one.
 */
export function toCompact(p: Problem): string {
  const status = p.status ? `HTTP ${p.status}` : "Network error";
  const code = typeof p.error_code === "number" && p.error_code >= 1000 ? ` ${p.error_code}` : "";
  const src = p.errdown_source && !["unknown", "origin", "network"].includes(String(p.errdown_source)) ? ` (${p.errdown_source})` : "";
  const said = /message \(untrusted, quoted\): "([^"]*)"/.exec(String(p.detail))?.[1];
  const msg = said ? ` Server said: "${said.length > 80 ? said.slice(0, 79) + "…" : said}".` : "";
  return `Error: ${status}${code} ${p.error_category}${src}.${msg} ${compactAdvice(p)}`;
}
