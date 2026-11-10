import type { HeaderMap } from "./headers.ts";
import type { Category } from "./types.ts";

/**
 * A fingerprint identifies a known error page. All regexes must be RE2-safe:
 * no backreferences, no lookaround, no nested quantifiers.
 */
export interface Fingerprint {
  id: string;
  source: string;
  confidence: number;
  status?: number[];
  header?: { name: string; pattern: RegExp };
  body?: RegExp[]; // all must match
  /** Overrides the status-based classification. */
  category?: Category;
  error_name?: string;
  title?: string;
  retryable?: boolean;
  owner_action_required?: boolean;
  detail?: string;
}

export const CHALLENGES: Fingerprint[] = [
  {
    id: "cloudflare_challenge", source: "cloudflare", confidence: 0.95,
    header: { name: "cf-mitigated", pattern: /challenge/i },
    error_name: "cloudflare_challenge", title: "Bot verification required",
  },
  {
    id: "cloudflare_challenge_page", source: "cloudflare", confidence: 0.9,
    body: [/<title>Just a moment\.\.\.<\/title>|challenges\.cloudflare\.com|cf-chl-|_cf_chl_opt/i],
    error_name: "cloudflare_challenge", title: "Bot verification required",
  },
  {
    id: "recaptcha", source: "unknown", confidence: 0.85,
    body: [/google\.com\/recaptcha|g-recaptcha/i, /captcha|verify you are human|unusual traffic/i],
    error_name: "recaptcha_challenge", title: "CAPTCHA required",
  },
  {
    id: "hcaptcha", source: "unknown", confidence: 0.85,
    body: [/hcaptcha\.com|h-captcha/i],
    error_name: "hcaptcha_challenge", title: "CAPTCHA required",
  },
  {
    id: "aws_waf_captcha", source: "aws-cloudfront", confidence: 0.9,
    header: { name: "x-amzn-waf-action", pattern: /captcha|challenge/i },
    error_name: "aws_waf_challenge", title: "Bot verification required",
  },
  {
    id: "datadome", source: "unknown", confidence: 0.85,
    header: { name: "x-datadome", pattern: /./ },
    body: [/captcha-delivery\.com|datadome/i],
    error_name: "datadome_challenge", title: "Bot verification required",
  },
  {
    id: "perimeterx", source: "unknown", confidence: 0.85,
    body: [/px-captcha|perimeterx|_pxCaptcha/i],
    error_name: "perimeterx_challenge", title: "Bot verification required",
  },
  {
    id: "browser_check_interstitial", source: "unknown", confidence: 0.85,
    body: [/<title>Checking your browser|HASHCASH_CONFIG/i],
    error_name: "browser_check", title: "Bot verification required",
  },
  {
    id: "indeed_bot_detection", source: "unknown", confidence: 0.85,
    body: [/from=bot-detection/i],
    error_name: "bot_detection_redirect", title: "Bot verification required",
  },
  {
    id: "linkedin_999", source: "linkedin", confidence: 0.85,
    status: [999], header: { name: "x-li-fabric", pattern: /./ },
    error_name: "linkedin_bot_block", title: "Blocked as automated traffic",
  },
  {
    id: "network_security_block", source: "unknown", confidence: 0.85,
    status: [403], body: [/blocked by network security/i],
    category: "access_denied", error_name: "network_security_block", title: "Blocked by network security",
  },
  {
    id: "akamai_bot", source: "akamai", confidence: 0.8,
    status: [403], body: [/<title>Access Denied<\/title>/i, /Reference #\d+\.[0-9a-f]+/i],
    category: "access_denied", error_name: "akamai_access_denied", title: "Access denied",
  },
];

export const PAGES: Fingerprint[] = [
  // Cloudflare WAF block page (observed for custom-rule blocks; no 1xxx code in the page)
  {
    id: "cloudflare_blocked", source: "cloudflare", confidence: 0.9,
    body: [/cf-error-details/i, /Sorry, you have been blocked/i],
    category: "access_denied", error_name: "cloudflare_blocked", title: "Blocked by the site's firewall",
    retryable: false, owner_action_required: false,
    detail: "The site's Cloudflare firewall blocked this request.",
  },
  // Legacy Cloudflare HTML error pages
  {
    id: "cloudflare_legacy", source: "cloudflare", confidence: 0.9,
    body: [/cf-error-details|cf-wrapper|Cloudflare Ray ID/i],
  },
  // nginx default pages
  {
    id: "nginx_default", source: "nginx", confidence: 0.9,
    body: [/<center>nginx(\/[\d.]+)?<\/center>/i],
  },
  // Apache
  {
    id: "apache_default", source: "apache", confidence: 0.9,
    body: [/<address>Apache(\/[\d.]+)?[^<]*Server at/i],
  },
  {
    id: "apache_header", source: "apache", confidence: 0.7,
    header: { name: "server", pattern: /^Apache/i },
    body: [/<title>\d{3} [^<]+<\/title>/i],
  },
  // Caddy (empty body, Server: Caddy)
  {
    id: "caddy", source: "caddy", confidence: 0.75,
    header: { name: "server", pattern: /^Caddy/i },
  },
  // Envoy
  {
    id: "envoy_upstream", source: "envoy", confidence: 0.9,
    body: [/upstream connect error or disconnect\/reset before headers|no healthy upstream/i],
    category: "upstream_unavailable", error_name: "envoy_upstream_unavailable",
    title: "Upstream unavailable", retryable: true,
  },
  {
    id: "envoy_timeout", source: "envoy", confidence: 0.9,
    body: [/^upstream request timeout\s*$/],
    category: "upstream_unavailable", error_name: "envoy_upstream_timeout",
    title: "Upstream timeout", retryable: true,
  },
  {
    // Envoy rewrites Server on proxied responses too, so only trust it with an empty body.
    id: "envoy_empty", source: "envoy", confidence: 0.75,
    header: { name: "server", pattern: /^envoy$/i },
    body: [/^\s*$/],
  },
  // Traefik (no Server header; fixed plain-text bodies)
  {
    id: "traefik_404", source: "traefik", confidence: 0.8,
    body: [/^404 page not found\s*$/],
  },
  {
    id: "traefik", source: "traefik", confidence: 0.65,
    body: [/^(Bad Gateway|Gateway Timeout|Service Unavailable|Too Many Requests|Request Entity Too Large)\s*$/],
  },
  // AWS
  {
    id: "aws_alb", source: "aws-alb", confidence: 0.9,
    header: { name: "server", pattern: /^awselb/i },
  },
  {
    id: "aws_apigateway", source: "aws-apigateway", confidence: 0.85,
    header: { name: "x-amzn-errortype", pattern: /./ },
  },
  {
    id: "aws_cloudfront", source: "aws-cloudfront", confidence: 0.9,
    body: [/Generated by cloudfront \(CloudFront\)/i],
  },
  // Vercel
  {
    id: "vercel", source: "vercel", confidence: 0.85,
    header: { name: "x-vercel-error", pattern: /./ },
  },
  {
    id: "vercel_hosted", source: "vercel", confidence: 0.6,
    header: { name: "x-vercel-id", pattern: /./ },
  },
  // GitHub Pages
  {
    id: "github_pages", source: "github-pages", confidence: 0.85,
    status: [404], header: { name: "server", pattern: /^GitHub\.com$/i },
    body: [/GitHub Pages|There isn't a GitHub Pages site here|Site not found/i],
  },
  // Netlify
  {
    id: "netlify", source: "netlify", confidence: 0.8,
    header: { name: "server", pattern: /^Netlify/i },
  },
  // Heroku
  {
    id: "heroku_no_such_app", source: "heroku", confidence: 0.95,
    body: [/<title>No such app<\/title>/i],
    category: "not_found", error_name: "heroku_no_such_app", title: "No such app",
    retryable: false, detail: "There is no Heroku app at this address.",
  },
  {
    id: "heroku_app_error", source: "heroku", confidence: 0.9,
    body: [/herokucdn\.com\/error-pages|Application error/i, /heroku/i],
    category: "server_error", error_name: "heroku_application_error",
    title: "Application error", retryable: true,
  },
  // Render
  {
    id: "render_no_server", source: "render", confidence: 0.9,
    header: { name: "x-render-routing", pattern: /no-server/i },
    category: "not_found", error_name: "render_no_server", title: "No service at this address",
    detail: "There is no Render service at this address.",
  },
  {
    id: "render", source: "render", confidence: 0.75,
    header: { name: "x-render-origin-server", pattern: /./ },
  },
  // Google Front End (App Engine / Cloud Run default 404, google.com 404)
  {
    id: "gfe_default", source: "google-frontend", confidence: 0.8,
    body: [/<h1>Error: (Page )?Not Found<\/h1>/i, /The requested URL was not found on this server/i],
  },
  {
    id: "google_404", source: "google-frontend", confidence: 0.8,
    body: [/<title>Error 404 \(Not Found\)!!1<\/title>/],
  },
  {
    id: "gfe", source: "google-frontend", confidence: 0.8,
    header: { name: "server", pattern: /^(Google Frontend|GFE|gws)/i },
  },
  // App frameworks' default error pages
  {
    id: "express_default", source: "express", confidence: 0.85,
    header: { name: "x-powered-by", pattern: /^Express$/i },
    body: [/<title>Error<\/title>/i, /<pre>/i],
  },
  {
    id: "werkzeug_default", source: "werkzeug", confidence: 0.85,
    body: [/<title>\d{3} [^<]+<\/title>\s*<h1>[^<]+<\/h1>\s*<p>/i, /(If you entered the URL manually please check your spelling|The server encountered an internal error and was unable to complete your request|You don't have the permission to access the requested resource)/i],
  },
  {
    id: "django_default", source: "django", confidence: 0.85,
    body: [/(<title>Server Error \(500\)<\/title>|The requested resource was not found on this server\.|<title>403 Forbidden<\/title>[\s\S]{0,200}<h1>403 Forbidden<\/h1>)/i],
  },
  {
    id: "tomcat_default", source: "tomcat", confidence: 0.9,
    body: [/<title>HTTP Status \d{3} \u2013 [^<]+<\/title>/],
  },
  {
    id: "jetty_default", source: "jetty", confidence: 0.9,
    body: [/<h2>HTTP ERROR \d{3}/],
  },
  {
    id: "python_http_server", source: "python-http-server", confidence: 0.8,
    body: [/<title>Error response<\/title>/, /Error code explanation:/],
  },
  {
    id: "uvicorn_plain", source: "uvicorn", confidence: 0.7,
    header: { name: "server", pattern: /^uvicorn$/i },
    body: [/^(Internal Server Error|Not Found|Method Not Allowed)\s*$/],
  },
  {
    id: "envoy_plain", source: "envoy", confidence: 0.75,
    header: { name: "server", pattern: /^envoy$/i },
    body: [/^[A-Z][A-Za-z -]{2,40}$/],
  },
  // Fastly / Varnish
  {
    id: "fastly", source: "fastly", confidence: 0.8,
    body: [/Varnish cache server|Fastly error/i],
  },
];

export function matches(fp: Fingerprint, status: number, h: HeaderMap, body: string): boolean {
  if (fp.status && !fp.status.includes(status)) return false;
  if (fp.header) {
    const v = h.get(fp.header.name);
    if (v == null || !fp.header.pattern.test(v)) return false;
  }
  if (fp.body) {
    for (const re of fp.body) if (!re.test(body)) return false;
  }
  return Boolean(fp.header || fp.body);
}

export function findFingerprint(
  list: Fingerprint[], status: number, h: HeaderMap, body: string,
): Fingerprint | undefined {
  for (const fp of list) if (matches(fp, status, h, body)) return fp;
  return undefined;
}
