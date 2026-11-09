import type { Problem } from "./types.ts";

export type Decision =
  | { action: "retry"; after_seconds: number }
  | { action: "escalate"; reason: string }
  | { action: "fail"; reason: string };

const ESCALATE = new Set(["challenge", "access_denied", "legal", "auth_required"]);

/** Cloudflare's recommended control flow: retryable → wait; owner action → escalate; else fail fast. */
export function decide(p: Pick<Problem, "retryable" | "retry_after" | "owner_action_required" | "error_category" | "error_name">): Decision {
  if (p.error_category === "challenge") return { action: "escalate", reason: "challenge" };
  if (p.retryable) return { action: "retry", after_seconds: p.retry_after ?? 5 };
  if (p.owner_action_required) return { action: "escalate", reason: "owner_action_required" };
  if (ESCALATE.has(p.error_category)) return { action: "escalate", reason: p.error_category };
  return { action: "fail", reason: p.error_name };
}

/** Exponential backoff with full jitter. attempt starts at 0. Honors a server-given minimum. */
export function backoff(attempt: number, opts: { base?: number; max?: number; min?: number; random?: () => number } = {}): number {
  const base = opts.base ?? 1;
  const max = opts.max ?? 60;
  const rand = opts.random ?? Math.random;
  const ceiling = Math.min(max, base * 2 ** Math.max(0, attempt));
  return Math.max(opts.min ?? 0, rand() * ceiling);
}

export type AcceptMode = "markdown" | "json";

/** The Accept header Cloudflare recommends for agents. */
export function agentAcceptHeader(mode: AcceptMode = "markdown"): string {
  return mode === "json" ? "application/json, */*" : "text/markdown, */*";
}
