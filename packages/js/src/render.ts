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
