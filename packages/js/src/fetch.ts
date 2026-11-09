import { agentAcceptHeader, type AcceptMode } from "./decide.ts";
import { normalize } from "./normalize.ts";
import type { Problem } from "./types.ts";

export type ErrdownResult =
  | { ok: true; response: Response; problem: null }
  | { ok: false; response: Response; problem: Problem };

/**
 * fetch() wrapper: sends the agent Accept header (unless the caller set one) and,
 * on errors, returns a normalized Problem. The original Response is always returned
 * too; its body is read via clone() so the caller can still consume it.
 */
export async function errdownFetch(
  input: string | URL | Request, init: RequestInit & { accept?: AcceptMode } = {},
): Promise<ErrdownResult> {
  const { accept, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (!headers.has("accept")) headers.set("accept", agentAcceptHeader(accept));
  const res = await fetch(input, { ...rest, headers });
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const mayBeChallenge = res.status === 200 && res.headers.has("cf-mitigated");
  if (res.ok && !mayBeChallenge) return { ok: true, response: res, problem: null };
  let body = "";
  try { body = await res.clone().text(); } catch { /* ignore */ }
  const problem = normalize(res.status, res.headers, body, { url });
  return problem ? { ok: false, response: res, problem } : { ok: true, response: res, problem: null };
}
