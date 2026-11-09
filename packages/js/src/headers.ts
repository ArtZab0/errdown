import type { HeadersInput } from "./types.ts";

export type HeaderMap = Map<string, string>;

export function toHeaderMap(h: HeadersInput | undefined | null): HeaderMap {
  const m: HeaderMap = new Map();
  if (!h) return m;
  try {
    const put = (k: unknown, v: unknown) => {
      if (typeof k !== "string" || v == null) return;
      const val = Array.isArray(v) ? v.join(", ") : String(v);
      m.set(k.toLowerCase(), val);
    };
    if (typeof (h as any).forEach === "function" && !Array.isArray(h)) {
      (h as any).forEach((v: string, k: string) => put(k, v));
    } else if (typeof (h as any)[Symbol.iterator] === "function") {
      for (const pair of h as Iterable<[string, string]>) {
        if (Array.isArray(pair)) put(pair[0], pair[1]);
      }
    } else {
      for (const [k, v] of Object.entries(h)) put(k, v);
    }
  } catch {
    /* never throw */
  }
  return m;
}

const MAX_RETRY = 86400;
const clamp = (n: number) => Math.max(0, Math.min(MAX_RETRY, Math.round(n)));

/** Parse Retry-After / RateLimit-Reset style headers into seconds. */
export function retryAfterFromHeaders(h: HeaderMap, nowMs: number): number | undefined {
  const ra = h.get("retry-after")?.trim();
  if (ra) {
    if (/^\d+$/.test(ra)) return clamp(Number(ra));
    const t = Date.parse(ra);
    if (!Number.isNaN(t)) return clamp((t - nowMs) / 1000);
  }
  for (const name of ["ratelimit-reset", "x-ratelimit-reset", "x-rate-limit-reset"]) {
    const v = h.get(name)?.trim();
    if (v && /^\d+(\.\d+)?$/.test(v)) {
      const n = Number(v);
      return clamp(n > 1e9 ? n - nowMs / 1000 : n);
    }
  }
  return undefined;
}
