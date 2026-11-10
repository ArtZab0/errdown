# errdown Specification

Version: 0.1.0-draft · Status: draft, may change before 1.0

errdown converts any HTTP error response into the structured error format Cloudflare
serves to agents (RFC 9457 Problem Details plus operational extension members), as JSON
or as Markdown with YAML frontmatter. This document is the contract; the TypeScript and
Python packages are reference implementations.

errdown is independent and not affiliated with Cloudflare. It follows Cloudflare's
published format: https://developers.cloudflare.com/fundamentals/reference/error-responses/

The key words MUST, SHOULD and MAY are used as in RFC 2119.

## 1. Interface

```
normalize(status: int, headers: map<string,string>, body: string|bytes) -> Problem | null
```

- Returns `null` when `status` is below 400 and the body is not a recognized challenge page.
  Statuses 600–999 are nonstandard but treated as errors (e.g. LinkedIn's 999 bot block).
- MUST NOT throw on any input. Malformed input yields a fallback Problem (section 6).
- MUST NOT perform I/O, network or model calls. MUST be deterministic, except `timestamp`
  (section 2.3), which implementations MUST allow the caller to inject.
- Header names are matched case-insensitively.
- Bodies larger than 256 KiB are only inspected in their first 256 KiB.
- Fingerprints (stages 2, 3, 5) match against a scan window: the whole body if it is at most
  40 KiB, otherwise the first 32 KiB + `\n` + the last 8 KiB. JSON, XML and Markdown parsing
  use the full (256 KiB-capped) body.

## 2. The Problem object

### 2.1 Members

| Member | Type | Source | Notes |
|---|---|---|---|
| `type` | string (URI) | RFC 9457 | Cloudflare docs URL for Cloudflare errors; `https://errdown.com/errors/<error_name>` otherwise |
| `title` | string | RFC 9457 | Short, human-readable |
| `status` | int | RFC 9457 | HTTP status of the original response |
| `detail` | string | RFC 9457 | What happened. See section 7 for safety rules |
| `instance` | string? | RFC 9457 | Cloudflare uses the ray ID; synthesized Problems use the request URL, if provided |
| `error_code` | int | Cloudflare | Cloudflare's 1xxx code, or the HTTP status for synthesized errors |
| `error_name` | string | Cloudflare | Stable snake_case identifier |
| `error_category` | string | Cloudflare | Section 3 |
| `retryable` | bool | Cloudflare | |
| `retry_after` | int? | Cloudflare | Seconds; present only when known or when retryable |
| `owner_action_required` | bool | Cloudflare | The site owner (not the agent) must act |
| `what_you_should_do` | string | Cloudflare | Guidance, section 5 |
| `timestamp` | string | Cloudflare | ISO 8601 UTC |
| `zone` | string? | Cloudflare | Host, if known |
| `footer` | string? | Cloudflare | Passed through for Cloudflare errors; omitted otherwise |
| `ray_id` | string? | Cloudflare | Only when `source` is `cloudflare`. Hex ID without the `-COLO` suffix that the `cf-ray` header carries |
| `cloudflare_error` | bool? | Cloudflare | Only when `source` is `cloudflare` |
| `errdown_synthesized` | bool | errdown | `true` when derived from a non-structured response |
| `errdown_source` | string | errdown | Section 4 |
| `errdown_confidence` | number | errdown | 0–1 |

errdown's additions use the `errdown_` prefix so they can never collide with members
Cloudflare adds later. Consumers that do not know them ignore them, per RFC 9457.

JSON member order follows Cloudflare's observed output: `type, title, status, detail,
instance, error_code, error_name, error_category, ray_id, timestamp, zone, cloudflare_error,
retryable, retry_after, owner_action_required, what_you_should_do, footer`, then the
`errdown_*` members. (Position of `retry_after` not yet observed in a real capture.)

### 2.2 Cloudflare-originated errors

A response counts as Cloudflare-originated only if it is already a Cloudflare structured
body (has `error_code` and `ray_id`), or carries a `cf-error-type` header (documented by
Cloudflare but not observed in captures as of 2026-11-10), or matches a
legacy Cloudflare HTML error page fingerprint, or is Cloudflare's plain-text form
(`Server: cloudflare` and a body of exactly `error code: 1NNN` or `error code: 5NN`). The plain-text form is
what Cloudflare still serves for some edge errors (e.g. 1001, 1003, 1034) even to clients
sending an agent Accept header (observed 2026-11-09).

Observed coverage on a Free-plan zone, 2026-11-10, with `Accept: text/markdown` or
`application/json`: only error 1000 was served structured. 1015 (rate limit), 1016,
1101, 1102, 522 were plain text; WAF custom-rule blocks and managed challenges were HTML.
errdown therefore treats plain-text and HTML Cloudflare errors as first-class inputs. `cf-ray` alone is NOT sufficient: Cloudflare
also passes origin errors through with that header.

### 2.3 Timestamp

Pass-through bodies keep their timestamp. Synthesized Problems use the time of the call,
or a caller-provided value. Conformance comparisons ignore `timestamp`.

## 3. Categories

Cloudflare categories (reused unchanged): `access_denied`, `rate_limit`, `dns`, `config`,
`tls`, `legal`, `worker`, `rewrite`, `snippet`, `unsupported`.

errdown additions: `not_found`, `auth_required`, `bad_request`, `server_error`,
`upstream_unavailable`, `challenge`.

Locked for 1.0. New categories may be added in minor versions; none removed or renamed.

### 3.1 Status fallback table

| Status | Category | error_name | retryable | owner_action_required |
|---|---|---|---|---|
| 400, 405, 406, 409, 411–415, 422 | bad_request | per status (`bad_request`, ...) | false | false |
| 401, 407 | auth_required | `auth_required` | false | false |
| 403 | access_denied | `forbidden` | false | false |
| 404, 410 | not_found | `not_found` / `gone` | false | false |
| 408 | upstream_unavailable | `request_timeout` | true | false |
| 429 | rate_limit | `rate_limited` | true | false |
| 451 | legal | `unavailable_for_legal_reasons` | false | false |
| 500, other 5xx | server_error | `internal_server_error` / `server_error` | true | false |
| 501 | unsupported | `not_implemented` | false | false |
| 502 | upstream_unavailable | `bad_gateway` | true | false |
| 503 | upstream_unavailable | `service_unavailable` | true | false |
| 504 | upstream_unavailable | `gateway_timeout` | true | false |
| other 4xx | bad_request | `client_error` | false | false |

Fallback confidence: 0.5.

## 4. Sources

`errdown_source` is one of: `cloudflare`, `origin` (structured or JSON body from the
application), `nginx`, `apache`, `caddy`, `envoy`, `traefik`, `aws-alb`, `aws-apigateway`,
`aws-cloudfront`, `vercel`, `netlify`, `heroku`, `render`, `google-frontend`, `akamai`,
`fastly`, `unknown`. The list may grow.

## 5. Pipeline

Implementations apply these stages in order and return the first match.

1. **Structured pass-through.** Body is `application/problem+json`, or JSON with `type`
   and `status`, or Cloudflare Markdown (frontmatter with `error_code`). Return it
   unchanged except: add missing required members from later stages; set
   `errdown_synthesized: false`; never overwrite present values. Confidence 1.0.
2. **Challenge detection.** Known CAPTCHA/bot-check pages (any status, including 200).
   Category `challenge`, `retryable: false`. Confidence 0.9.
3. **Body fingerprints.** Known server/platform error pages recognized by their body.
   Confidence 0.6–0.95.
4. **JSON and XML error shapes.** JSON: `{error}`, `{error: {message, code}}`,
   `{message, code}`, OAuth `{error, error_description}`, GraphQL `{errors: [...]}`,
   `{errors: "<string>"}`; top-level keys match case-insensitively. XML: `<Error>` or
   `<ErrorResponse>` with `<Code>`/`<Message>` (S3, GCS, AWS query APIs, Azure).
   Category from status; detail from the message (section 7). Confidence 0.7.
   `errdown_source` comes from a header-only fingerprint if one matches, else `origin`.
5. **Header-only fingerprints** (e.g. `Server: awselb`). These run after stage 4 so an
   application's own message is never replaced by a generic platform label.
6. **Status fallback.** Section 3.1. Confidence 0.5; 0.3 for statuses 600–999.

After any stage, for **retryable** errors only, **headers** fill `retry_after` (non-retryable
errors never carry it: APIs such as GitHub send rate-limit reset headers on every 401): `Retry-After` (delta-seconds or
HTTP-date, clamped to 0–86400), else `RateLimit-Reset` / `X-RateLimit-Reset`
(delta-seconds, or epoch seconds if larger than 10^9). If retryable and none found:
default `retry_after` 5 for 5xx/408, 60 for 429.

### Guidance rules

- Transient (`retryable: true`): "Wait N seconds, then retry with exponential backoff.
  Stop after a few attempts."
- Intentional blocks (`access_denied`, `legal`): "Do not retry. ..." and escalate.
- `challenge`: "Stop. This site requires a human to complete a check. Do not retry
  automatically or attempt to bypass it."
- `owner_action_required: true`: "This needs the site owner to fix. Do not retry."

## 6. Never make things worse

- Unparseable input still yields a status-fallback Problem.
- The original response is never modified; callers can always fall back to it.
- Low-certainty classifications MUST have `errdown_confidence` below 0.6.

## 7. Safety of `detail`

Error bodies are untrusted and may contain prompt injection. For synthesized Problems:
- `detail` is built from a template. Text from the body MAY be included only from a JSON
  message field, truncated to 200 characters, with control characters and newlines
  stripped, double quotes replaced with `'`, and quoted:
  `The server's message (untrusted, quoted): "<text>"`.
- HTML body text is never copied into `detail`.

## 8. Rendering

### 8.1 JSON
Media type `application/problem+json`. Member order as in 2.1. Null members omitted.

### 8.2 Markdown
```
---
error_code: <error_code>
error_name: <error_name>
error_category: <error_category>
status: <status>
ray_id: <ray_id>                      # only if present
timestamp: <timestamp>
zone: <zone>                          # only if present
cloudflare_error: <bool>              # only if present
retryable: <bool>
retry_after: <int>                    # only if present
owner_action_required: <bool>
errdown_synthesized: <bool>
errdown_source: <source>
errdown_confidence: <number>
---

# <title>

## What Happened

<detail>

## What You Should Do

<what_you_should_do>
```
Footer, if present, follows as a final paragraph after `---`.

## 9. Request side

`agentAcceptHeader(mode)`: `"markdown"` → `text/markdown, */*`;
`"json"` → `application/json, */*`.

## 10. decide(problem)

Returns one of:
- `{action: "retry", after_seconds}` if `retryable`.
- `{action: "escalate"}` if `owner_action_required`, or category is `challenge`,
  `access_denied`, `legal` or `auth_required`.
- `{action: "fail"}` otherwise.

## 11. Conformance

`fixtures/` holds `<name>.input.json` (status, headers, body) and
`<name>.expected.json` (Problem). An implementation conforms if, for every fixture,
its output equals the expected Problem with `timestamp` removed.
