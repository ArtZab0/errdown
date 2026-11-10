// Core of the errdown-mcp `fetch` tool, separated from the MCP transport so it can be tested.
import TurndownService from "turndown";
import { agentAcceptHeader, normalize, toCompact, type Problem } from "errdown";

export interface FetchArgs {
  url: string;
  max_length?: number;
  start_index?: number;
  raw?: boolean;
}

export interface FetchResult {
  isError: boolean;
  text: string;
  problem?: Problem;
}

const UA = "errdown-mcp/0.1 (+https://github.com/ArtZab0/errdown)";
const TIMEOUT_MS = 30_000;
const MAX_BYTES = 5 * 1024 * 1024;

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
td.remove(["script", "style", "noscript", "iframe", "svg"] as any);

/** A Problem for failures where no HTTP response exists (DNS, refused, TLS, timeout). */
export function networkProblem(err: unknown, url: string, now = new Date()): Problem {
  const e = err as { name?: string; code?: string; cause?: { code?: string; message?: string } };
  const code = String(e?.cause?.code ?? e?.code ?? (e?.name === "TimeoutError" || e?.name === "AbortError" ? "TIMEOUT" : "UNKNOWN"));
  let host: string | undefined;
  try { host = new URL(url).host; } catch { /* invalid URL */ }
  const [category, name, title, retryable, detail] =
    /ENOTFOUND|EAI_AGAIN|EAI_NONAME/.test(code) ? ["dns", "dns_resolution_failed", "Host not found", code === "EAI_AGAIN", `The hostname ${host ?? ""} could not be resolved.`]
    : /CERT|TLS|SSL|DEPTH_ZERO|SELF_SIGNED/.test(code) ? ["tls", "tls_error", "TLS error", false, "The server's TLS certificate or handshake was rejected."]
    : /TIMEOUT|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT/.test(code) ? ["upstream_unavailable", "connection_timed_out", "Connection timed out", true, "The server did not respond in time."]
    : /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|UND_ERR_SOCKET|EPIPE/.test(code) ? ["upstream_unavailable", "connection_failed", "Connection failed", true, "The connection to the server failed."]
    : /ERR_INVALID_URL|ERR_INVALID_ARG/.test(code) || !host ? ["bad_request", "invalid_url", "Invalid URL", false, "The URL is not valid."]
    : ["upstream_unavailable", "network_error", "Network error", true, "The request failed before any HTTP response was received."];
  const retry_after = retryable ? 5 : undefined;
  const p: Problem = {
    type: `https://artzab0.github.io/errdown/errors/${name}`,
    title, status: 0, detail: `${detail} (${code})`, instance: url,
    error_code: 0, error_name: name, error_category: category, retryable: retryable as boolean,
    ...(retry_after ? { retry_after } : {}),
    owner_action_required: false,
    what_you_should_do: retryable
      ? `Wait ${retry_after} seconds, then retry with exponential backoff. Stop after a few attempts and report the error if it persists.`
      : category === "dns" ? "Do not retry. Check the hostname for typos; the site may not exist."
      : category === "tls" ? "Do not retry, and do not disable certificate checks. Report the TLS problem to the user."
      : "Do not retry. Fix the URL.",
    timestamp: now.toISOString(),
    ...(host ? { zone: host } : {}),
    errdown_synthesized: true, errdown_source: "network", errdown_confidence: 0.9,
  };
  return p;
}

// Per-URL count of consecutive retryable failures in this server process, so a repeated error
// tells the agent where it is ("attempt 2 of 3") and when to stop. Reset on success or after 10 min.
export const MAX_ATTEMPTS = 3;
const attempts = new Map<string, { n: number; t: number }>();
export function noteAttempt(url: string, failed: boolean, retryable: boolean): number {
  const now = Date.now();
  const cur = attempts.get(url);
  if (!failed || !retryable) { attempts.delete(url); return 0; }
  const n = cur && now - cur.t < 600_000 ? cur.n + 1 : 1;
  attempts.set(url, { n, t: now });
  return n;
}

/** The one-line error the agent sees, with the attempt counter for repeated retryable failures. */
function problemText(p: Problem, attempt = 0): string {
  const line = toCompact(p);
  if (!p.retryable || attempt === 0) return line;
  return attempt >= MAX_ATTEMPTS
    ? line.replace(/Retryable: .*$/, `Failed ${attempt} times in a row; stop retrying and report the error to the user.`)
    : line.replace("(max 3 tries)", `(attempt ${attempt} of ${MAX_ATTEMPTS})`);
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  try { await reader.cancel(); } catch { /* ignore */ }
  const buf = new Uint8Array(Math.min(total, MAX_BYTES));
  let off = 0;
  for (const c of chunks) { const n = Math.min(c.byteLength, buf.length - off); buf.set(c.subarray(0, n), off); off += n; if (off >= buf.length) break; }
  return new TextDecoder().decode(buf);
}

export async function fetchTool(args: FetchArgs, fetchImpl: typeof fetch = fetch): Promise<FetchResult> {
  const { url, max_length = 20_000, start_index = 0, raw = false } = args;
  let res: Response;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw Object.assign(new Error("bad scheme"), { code: "ERR_INVALID_URL" });
    res = await fetchImpl(u, {
      headers: { accept: agentAcceptHeader("markdown"), "user-agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const p = networkProblem(err instanceof TypeError && /Invalid URL/i.test(String(err.message)) ? { code: "ERR_INVALID_URL" } : err, url);
    return { isError: true, text: problemText(p, noteAttempt(url, true, p.retryable)), problem: p };
  }
  let body = "";
  try { body = await readCapped(res); } catch { /* treat as empty */ }

  const problem = normalize(res.status, res.headers, body, { url: res.url || url });
  if (problem) return { isError: true, text: problemText(problem, noteAttempt(url, true, problem.retryable)), problem };
  noteAttempt(url, false, false);

  const ctype = res.headers.get("content-type") ?? "";
  let content = body;
  if (!raw && /html/i.test(ctype)) {
    try { content = td.turndown(body); } catch { /* fall back to raw */ }
  }
  const total = content.length;
  if (start_index >= total && total > 0) {
    return { isError: false, text: `<error>start_index ${start_index} is past the end of the content (${total} chars).</error>` };
  }
  let slice = content.slice(start_index, start_index + max_length);
  const next = start_index + slice.length;
  if (next < total) slice += `\n\n<truncated>Content truncated at ${next} of ${total} chars. Call fetch with start_index=${next} to continue.</truncated>`;
  return { isError: false, text: `Contents of ${res.url || url}:\n\n${slice}` };
}
