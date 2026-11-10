import { type HeaderMap, retryAfterFromHeaders, toHeaderMap } from "./headers.ts";
import { CHALLENGES, type Fingerprint, PAGES, findFingerprint } from "./fingerprints.ts";
import { classifyStatus, defaultRetryAfter, guidance } from "./status.ts";
import type { HeadersInput, NormalizeOptions, Problem } from "./types.ts";

const MAX_BODY = 256 * 1024;
const TYPE_BASE = "https://artzab0.github.io/errdown/errors/";
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

// Cloudflare 1xxx codes seen in plain-text responses: [category, error_name, title, owner_action_required?, retryable?]
const CF_CODES: Record<number, [string, string, string, boolean?, boolean?]> = {
  1000: ["dns", "dns_loop", "DNS points to prohibited IP", true, false],
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
  1016: ["dns", "origin_dns_error", "Origin DNS error", true, false],
  1020: ["access_denied", "access_denied", "Access denied (firewall rule)"],
  1034: ["config", "edge_ip_restricted", "Edge IP restricted"],
  // Cloudflare 5xx, categorized per Cloudflare's 2026-04-27 changelog.
  520: ["upstream_unavailable", "origin_unknown_error", "Web server returned an unknown error", false, true],
  521: ["upstream_unavailable", "origin_down", "Web server is down", false, true],
  522: ["upstream_unavailable", "origin_connection_timed_out", "Connection timed out", false, true],
  523: ["upstream_unavailable", "origin_unreachable", "Origin is unreachable", false, true],
  524: ["upstream_unavailable", "origin_timeout", "A timeout occurred", false, true],
  525: ["tls", "ssl_handshake_failed", "SSL handshake failed", true, false],
  526: ["tls", "invalid_ssl_certificate", "Invalid SSL certificate", true, false],
  1101: ["worker", "worker_threw_exception", "Worker threw exception", true, false],
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
  const footer = /\n---[ \t]*\r?\n([\s\S]*?)\s*$/.exec(rest)?.[1]?.trim();
  if (footer) fm.footer = footer;
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
  // retry_after only accompanies retryable errors (as in Cloudflare's output); rate-limit
  // reset headers on e.g. a 401 say nothing about when that request would succeed.
  let retry_after = p.retry_after;
  if (retry_after === undefined && retryable) {
    retry_after = retryAfterFromHeaders(ctx.h, ctx.nowMs) ?? defaultRetryAfter(p.status);
  }
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

/** Cloudflare's ray_id omits the "-COLO" suffix that the cf-ray header carries. */
function rayId(ctx: Ctx, body = ""): string | undefined {
  const fromHeader = ctx.h.get("cf-ray")?.trim().split("-")[0];
  if (fromHeader && /^[0-9a-f]{8,32}$/i.test(fromHeader)) return fromHeader.toLowerCase();
  return /Ray ID:?\s*(?:<[^>]{0,80}>\s*)?([0-9a-f]{16})/i.exec(body)?.[1];
}

function cloudflareMeta(ctx: Ctx, body = ""): Partial<Problem> {
  const ray = rayId(ctx, body);
  return { errdown_source: "cloudflare", cloudflare_error: true, ...(ray ? { ray_id: ray } : {}) };
}

function fromFingerprint(fp: Fingerprint, ctx: Ctx, challenge: boolean, body = ""): Problem {
  const base = classifyStatus(ctx.status);
  const category = challenge ? "challenge" : (fp.category ?? base.category);
  const sourceLabel = fp.source === "unknown" ? "" : fp.source.replace(/-/g, "_") + "_";
  const error_name = fp.error_name ?? sourceLabel + base.error_name;
  const isCf = fp.source === "cloudflare";
  const what = challenge ? "a bot-verification challenge page"
    : fp.source === "unknown" ? "a block page" : `an error page from ${fp.source}`;
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
    ...(isCf ? cloudflareMeta(ctx, body) : {}),
  }, ctx);
}

function messageFromJSON(j: unknown): { message?: string; code?: string } | undefined {
  if (Array.isArray(j)) return undefined;
  if (!isObj(j)) return undefined;
  // Normalize top-level keys to lower case ({"Error": ...}, {"Message": ...}).
  j = Object.fromEntries(Object.entries(j).map(([k, v]) => [k.toLowerCase(), v]));
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
  if (typeof j.errors === "string") return { message: j.errors };
  // FastAPI / Pydantic validation: {"detail": [{"msg": ..., "type": ...}]}
  if (Array.isArray(j.detail) && isObj(j.detail[0])) {
    return { message: str(j.detail[0].msg) ?? str(j.detail[0].message), code: str(j.detail[0].type) };
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

/** S3 / GCS / AWS query-API / Azure style XML: <Error><Code>..</Code><Message>..</Message> */
function messageFromXML(body: string): { message?: string; code?: string } | undefined {
  if (!/^\s*(<\?xml[^>]{0,200}\?>\s*)?<(Error|ErrorResponse)[\s>]/.test(body)) return undefined;
  const tag = (t: string) => new RegExp(`<${t}>([^<]{1,500})</${t}>`).exec(body)?.[1]?.trim();
  const code = tag("Code"), message = tag("Message");
  return code || message ? { code, message } : undefined;
}

// SPEC §5 stage 4: on 400/403, an explicit message about credentials or rate limits decides the category.
const MSG_AUTH = /missing[ -]?authenticat|authentication (token|required|failed)|unauthenticated|unregistered callers|api[ _-]?key (is )?(not valid|invalid|missing|required)|(missing|invalid|no) (api[ _-]?key|access token|auth token|bearer token|credentials|authorization header)|missing x-auth|not authenticated|login required/i;
const MSG_RATE = /rate[ -]?limit(ed)? exceeded|too many requests|quota exceeded|api rate limit/i;
function categoryFromMessage(status: number, m: { message?: string; code?: string }): Partial<Problem> {
  if (status !== 400 && status !== 403) return {};
  const text = `${m.code ?? ""} ${m.message ?? ""}`.slice(0, 1000);
  if (MSG_RATE.test(text)) return { error_category: "rate_limit", error_name: "rate_limited", title: "Rate limited", retryable: true };
  if (MSG_AUTH.test(text) || /^(MissingAuthenticationToken|UNAUTHENTICATED|InvalidClientTokenId)\b/.test(m.code ?? ""))
    return { error_category: "auth_required", error_name: "auth_required", title: "Authentication required", retryable: false };
  return {};
}

const XML_SOURCES: [string, RegExp, string][] = [
  ["server", /^AmazonS3$/i, "aws-s3"],
  ["server", /^UploadServer$/i, "google-cloud-storage"],
  ["x-amzn-requestid", /./, "aws"],
  ["x-ms-request-id", /./, "azure"],
];

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

/** Fingerprints only look at the head and tail of large bodies (SPEC §5): error-page markers
 *  sit near the top or bottom, and this bounds regex cost on 200 KB+ pages. */
export function scanWindow(body: string): string {
  return body.length > 40960 ? body.slice(0, 32768) + "\n" + body.slice(-8192) : body;
}

function run(ctx: Ctx, fullBody: string): Problem | null {
  const { status, h } = ctx;
  const body = scanWindow(fullBody);
  const isError = status >= 400 && status <= 999; // 6xx–9xx: nonstandard (e.g. LinkedIn 999)

  // 2. Challenges apply at any status (a 200 challenge page is still a block).
  const challenge = findFingerprint(CHALLENGES, status, h, body);
  if (challenge && (isError || challenge.category !== "access_denied")) {
    return fromFingerprint(challenge, ctx, challenge.category !== "access_denied", body);
  }
  if (!isError) return null;

  const ctype = h.get("content-type") ?? "";
  const json = tryJSON(fullBody);

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
  const md = ctype.includes("markdown") || body.trimStart().startsWith("---") ? parseCloudflareMarkdown(fullBody) : undefined;
  if (md) {
    const cf = "ray_id" in md || h.has("cf-error-type");
    return finish({
      errdown_synthesized: false,
      errdown_source: cf ? "cloudflare" : "origin",
      errdown_confidence: 1,
      ...(cf ? { cloudflare_error: true } : {}),
      // Cloudflare's Markdown omits `type`; its JSON uses the per-code docs page.
      ...(cf && typeof md.error_code === "number" && md.error_code >= 1000 ? { type: `${CF_DOCS}error-${md.error_code}/` } : {}),
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
  const plain = /^\s*error code: (1\d{3}|5\d{2})\s*$/.exec(body);
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
      ...(known?.[4] !== undefined ? { retryable: known[4] } : {}),
      ...(code < 1000 && !known ? { error_category: classifyStatus(code).category } : {}),
      detail: `Cloudflare returned error ${code}${known ? ` (${known[2]})` : ""} with HTTP ${status}.`,
      errdown_confidence: known ? 0.9 : 0.75,
    }, ctx);
  }

  // 3a. Known error pages identified by their body.
  const fp = findFingerprint(PAGES.filter((f) => f.body), status, h, body);
  if (fp) return fromFingerprint(fp, ctx, false, body);
  // Header-only fingerprints identify the platform, but an app's own JSON/XML message wins.
  const hfp = findFingerprint(PAGES.filter((f) => !f.body), status, h, body);

  // 4. JSON / XML error shapes.
  {
    const m = json !== undefined ? messageFromJSON(json) : messageFromXML(fullBody);
    const xmlSource = json === undefined ? XML_SOURCES.find(([n, re]) => re.test(h.get(n) ?? ""))?.[2] : undefined;
    if (m && (m.message || m.code)) {
      const said = m.message ? ` The server's message (untrusted, quoted): "${sanitize(m.message).replace(/"/g, "'")}"` : "";
      const code = m.code ? ` (code: ${sanitize(m.code, 60)})` : "";
      return finish({
        status,
        detail: `The server returned HTTP ${status}${code}.${said}`,
        ...categoryFromMessage(status, m),
        errdown_source: xmlSource ?? hfp?.source ?? "origin",
        errdown_confidence: 0.7,
      }, ctx);
    }
  }
  if (hfp) return fromFingerprint(hfp, ctx, false, body);

  // 5. Status fallback (nonstandard statuses are lower confidence).
  return finish({ status, errdown_confidence: status >= 600 ? 0.3 : 0.5 }, ctx);
}
