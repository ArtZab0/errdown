import { type HeaderMap, retryAfterFromHeaders, toHeaderMap } from "./headers.ts";
import { CHALLENGES, type Fingerprint, PAGES, findFingerprint } from "./fingerprints.ts";
import { classifyStatus, defaultRetryAfter, guidance } from "./status.ts";
import type { HeadersInput, NormalizeOptions, Problem } from "./types.ts";

const MAX_BODY = 256 * 1024;
const TYPE_BASE = "https://errdown.com/errors/";
const CF_DOCS = "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/";

export type BodyInput = string | Uint8Array | ArrayBuffer | null | undefined;

function bodyToString(body: BodyInput): string {
  try {
    if (body == null) return "";
    if (typeof body === "string") return body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body;
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, MAX_BODY));
  } catch {
    return "";
  }
}

function isoNow(now: NormalizeOptions["now"]): string {
  try {
    if (now instanceof Date) return now.toISOString();
    if (typeof now === "string") return now;
  } catch { /* fall through */ }
  return new Date().toISOString();
}

function hostOf(url?: string): string | undefined {
  if (!url) return undefined;
  try { return new URL(url).host || undefined; } catch { return undefined; }
}

/** Strip control chars/newlines, truncate, for quoting untrusted text (SPEC §7). */
export function sanitize(text: string, max = 200): string {
  const clean = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

function tryJSON(body: string): unknown {
  const t = body.trimStart();
  if (t[0] !== "{" && t[0] !== "[") return undefined;
  try { return JSON.parse(body); } catch { return undefined; }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Cloudflare 1xxx codes seen in plain-text responses: [category, error_name, title, owner_action_required?]
const CF_CODES: Record<number, [string, string, string, boolean?]> = {
  1001: ["dns", "dns_resolution_error", "DNS resolution error", true],
  1003: ["config", "direct_ip_access_not_allowed", "Direct IP access not allowed"],
  1006: ["access_denied", "access_denied_ip_banned", "Access denied"],
  1007: ["access_denied", "access_denied_ip_banned", "Access denied"],
  1008: ["access_denied", "access_denied_ip_banned", "Access denied"],
  1009: ["access_denied", "access_denied_country", "Access denied (country or region banned)"],
  1010: ["access_denied", "access_denied_browser_signature", "Access denied (browser signature)"],
  1012: ["access_denied", "access_denied", "Access denied"],
  1014: ["config", "cname_cross_user_banned", "CNAME cross-user banned", true],
  1015: ["rate_limit", "rate_limited", "You are being rate limited"],
  1016: ["dns", "origin_dns_error", "Origin DNS error", true],
  1020: ["access_denied", "access_denied", "Access denied (firewall rule)"],
  1034: ["config", "edge_ip_restricted", "Edge IP restricted"],
  1101: ["worker", "worker_threw_exception", "Worker threw exception", true],
  1102: ["worker", "worker_exceeded_resource_limits", "Worker exceeded resource limits", true],
};

// ---------- Cloudflare Markdown parsing ----------

function parseScalar(v: string): unknown {
  const s = v.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~" || s === "") return undefined;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

function parseCloudflareMarkdown(body: string): Record<string, unknown> | undefined {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(body);
  if (!m) return undefined;
  const fm: Record<string, unknown> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line);
    if (kv) {
      const v = parseScalar(kv[2]);
      if (v !== undefined) fm[kv[1]] = v;
    }
  }
  if (fm.error_code === undefined) return undefined;
  const rest = m[2];
  const title = /^#\s+(.+)$/m.exec(rest)?.[1]?.trim();
  const section = (name: string) => {
    const re = new RegExp(`^##\\s+${name}\\s*$([\\s\\S]*?)(?=^##\\s|^---\\s*$|$(?![\\s\\S]))`, "mi");
    return re.exec(rest)?.[1]?.trim();
  };
  if (title) fm.title = title;
  const detail = section("What Happened");
  if (detail) fm.detail = detail;
  const todo = section("What You Should Do");
  if (todo) fm.what_you_should_do = todo;
  return fm;
}

// ---------- Assembly ----------

interface Ctx {
  status: number;
  h: HeaderMap;
  url?: string;
  timestamp: string;
  nowMs: number;
}

function finish(p: Partial<Problem> & { status: number }, ctx: Ctx): Problem {
  const base = classifyStatus(p.status);
  const category = (p.error_category as string) ?? base.category;
  const retryable = p.retryable ?? base.retryable;
  const owner = p.owner_action_required ?? base.owner_action_required;
  let retry_after = p.retry_after ?? retryAfterFromHeaders(ctx.h, ctx.nowMs);
  if (retry_after === undefined && retryable) retry_after = defaultRetryAfter(p.status);
  const error_name = p.error_name ?? base.error_name;

  const out: Problem = {
    type: p.type ?? TYPE_BASE + error_name,
    title: p.title ?? base.title,
    status: p.status,
    detail: p.detail ?? `The server returned HTTP ${p.status}.`,
    instance: p.instance ?? ctx.url,
    error_code: p.error_code ?? p.status,
    error_name,
    error_category: category,
    retryable,
    retry_after,
    owner_action_required: owner,
    what_you_should_do:
      p.what_you_should_do ?? guidance({ error_category: category, retryable, owner_action_required: owner, retry_after }),
    timestamp: p.timestamp ?? ctx.timestamp,
    zone: p.zone ?? hostOf(ctx.url),
    footer: p.footer,
    ray_id: p.ray_id,
    cloudflare_error: p.cloudflare_error,
    errdown_synthesized: p.errdown_synthesized ?? true,
    errdown_source: p.errdown_source ?? "unknown",
    errdown_confidence: p.errdown_confidence ?? 0.5,
  };
  // Keep any unknown extension members from pass-through bodies.
  for (const [k, v] of Object.entries(p)) if (!(k in out)) out[k] = v;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

function cloudflareMeta(ctx: Ctx): Partial<Problem> {
  const ray = ctx.h.get("cf-ray");
  return { errdown_source: "cloudflare", cloudflare_error: true, ...(ray ? { ray_id: ray } : {}) };
}

function fromFingerprint(fp: Fingerprint, ctx: Ctx, challenge: boolean): Problem {
  const base = classifyStatus(ctx.status);
  const category = challenge ? "challenge" : (fp.category ?? base.category);
  const sourceLabel = fp.source === "unknown" ? "" : fp.source.replace(/-/g, "_") + "_";
  const error_name = fp.error_name ?? sourceLabel + base.error_name;
  const isCf = fp.source === "cloudflare";
  const what = challenge ? "a bot-verification challenge page" : `an error page from ${fp.source}`;
  return finish({
    status: ctx.status,
    title: fp.title ?? base.title,
    detail: fp.detail ?? `The server returned HTTP ${ctx.status} with ${what}.`,
    error_name,
    error_category: category,
    retryable: challenge ? false : (fp.retryable ?? base.retryable),
    owner_action_required: fp.owner_action_required ?? base.owner_action_required,
    errdown_source: fp.source,
    errdown_confidence: fp.confidence,
    ...(isCf ? cloudflareMeta(ctx) : {}),
  }, ctx);
}

function messageFromJSON(j: unknown): { message?: string; code?: string } | undefined {
  if (Array.isArray(j)) return undefined;
  if (!isObj(j)) return undefined;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : undefined);
  // GraphQL
  if (Array.isArray(j.errors) && j.errors.length) {
    const e = j.errors[0];
    if (isObj(e)) {
      const ext = isObj(e.extensions) ? e.extensions : {};
      return { message: str(e.message), code: str(ext.code) ?? str(e.code) };
    }
    if (typeof e === "string") return { message: e };
  }
  // OAuth
  if (typeof j.error === "string" && typeof j.error_description === "string") {
    return { message: j.error_description, code: j.error };
  }
  // {error: {message, code}}
  if (isObj(j.error)) {
    return { message: str(j.error.message) ?? str(j.error.detail), code: str(j.error.code) ?? str(j.error.type) };
  }
  if (typeof j.error === "string") return { message: str(j.message) ?? j.error, code: str(j.code) };
  if (str(j.message) || str(j.detail)) return { message: str(j.message) ?? str(j.detail), code: str(j.code) };
  return undefined;
}

/**
 * Convert an HTTP response into a Cloudflare-compatible Problem, or null if not an error.
 * Never throws.
 */
export function normalize(
  status: number, headers?: HeadersInput | null, body?: BodyInput, options: NormalizeOptions = {},
): Problem | null {
  let ctx: Ctx;
  try {
    const nowMs = options.now ? new Date(options.now).getTime() : Date.now();
    ctx = {
      status: Number.isInteger(status) ? status : 0,
      h: toHeaderMap(headers),
      url: options.url,
      timestamp: isoNow(options.now),
      nowMs: Number.isNaN(nowMs) ? Date.now() : nowMs,
    };
  } catch {
    return null;
  }
  try {
    return run(ctx, bodyToString(body));
  } catch {
    if (ctx.status < 400) return null;
    try { return finish({ status: ctx.status, errdown_confidence: 0.3 }, ctx); } catch { return null; }
  }
}

function run(ctx: Ctx, body: string): Problem | null {
  const { status, h } = ctx;
  const isError = status >= 400 && status <= 599;

  // 2. Challenges apply at any status (a 200 challenge page is still a block).
  const challenge = findFingerprint(CHALLENGES, status, h, body);
  if (challenge && (isError || challenge.category !== "access_denied")) {
    return fromFingerprint(challenge, ctx, challenge.category !== "access_denied");
  }
  if (!isError) return null;

  const ctype = h.get("content-type") ?? "";
  const json = tryJSON(body);

  // 1. Structured pass-through.
  if (isObj(json) && (ctype.includes("problem+json") || ("type" in json && "status" in json) || "error_code" in json)) {
    const cf = typeof json.error_code === "number" && ("ray_id" in json || h.has("cf-error-type"));
    const p = { ...json, status: typeof json.status === "number" ? json.status : status } as Partial<Problem> & { status: number };
    return finish({
      errdown_synthesized: false,
      errdown_source: cf ? "cloudflare" : "origin",
      errdown_confidence: 1,
      ...(cf ? { cloudflare_error: true } : {}),
      ...p,
    }, ctx);
  }
  const md = ctype.includes("markdown") || body.trimStart().startsWith("---") ? parseCloudflareMarkdown(body) : undefined;
  if (md) {
    const cf = "ray_id" in md || h.has("cf-error-type");
    return finish({
      errdown_synthesized: false,
      errdown_source: cf ? "cloudflare" : "origin",
      errdown_confidence: 1,
      ...(cf ? { cloudflare_error: true } : {}),
      ...md,
      status: typeof md.status === "number" ? md.status : status,
    } as Partial<Problem> & { status: number }, ctx);
  }

  // Cloudflare-generated error without a structured body (cf-error-type header).
  if (h.has("cf-error-type")) {
    return finish({ status, ...cloudflareMeta(ctx), errdown_confidence: 0.85,
      detail: `Cloudflare returned HTTP ${status} (${sanitize(h.get("cf-error-type") ?? "", 40)}).` }, ctx);
  }

  // Cloudflare's plain-text form: "error code: 1003" with Server: cloudflare.
  const plain = /^\s*error code: (1\d{3})\s*$/.exec(body);
  if (plain && /cloudflare/i.test(h.get("server") ?? "")) {
    const code = Number(plain[1]);
    const known = CF_CODES[code];
    return finish({
      status,
      ...cloudflareMeta(ctx),
      type: CF_DOCS,
      error_code: code,
      error_name: known?.[1] ?? `cloudflare_${code}`,
      ...(known ? { error_category: known[0], title: `Error ${code}: ${known[2]}` } : { title: `Cloudflare error ${code}` }),
      ...(known?.[3] !== undefined ? { owner_action_required: known[3] } : {}),
      detail: `Cloudflare returned error ${code}${known ? ` (${known[2]})` : ""} with HTTP ${status}.`,
      errdown_confidence: known ? 0.9 : 0.75,
    }, ctx);
  }

  // 3. Known error pages.
  const fp = findFingerprint(PAGES, status, h, body);
  if (fp) return fromFingerprint(fp, ctx, false);

  // 4. JSON error shapes.
  if (json !== undefined) {
    const m = messageFromJSON(json);
    if (m && (m.message || m.code)) {
      const said = m.message ? ` The server's message (untrusted, quoted): "${sanitize(m.message).replace(/"/g, "'")}"` : "";
      const code = m.code ? ` (code: ${sanitize(m.code, 60)})` : "";
      return finish({
        status,
        detail: `The server returned HTTP ${status}${code}.${said}`,
        errdown_source: "origin",
        errdown_confidence: 0.7,
      }, ctx);
    }
  }

  // 5. Status fallback.
  return finish({ status, errdown_confidence: 0.5 }, ctx);
}
