export type Category =
  // Cloudflare
  | "access_denied" | "rate_limit" | "dns" | "config" | "tls" | "legal"
  | "worker" | "rewrite" | "snippet" | "unsupported"
  // errdown additions
  | "not_found" | "auth_required" | "bad_request" | "server_error"
  | "upstream_unavailable" | "challenge";

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  error_code: number;
  error_name: string;
  error_category: Category | string;
  retryable: boolean;
  retry_after?: number;
  owner_action_required: boolean;
  what_you_should_do: string;
  timestamp: string;
  zone?: string;
  footer?: string;
  ray_id?: string;
  cloudflare_error?: boolean;
  errdown_synthesized: boolean;
  errdown_source: string;
  errdown_confidence: number;
  [extra: string]: unknown;
}

export type HeadersInput =
  | Record<string, string | string[] | undefined>
  | Iterable<[string, string]>
  | { forEach(cb: (value: string, key: string) => void): void };

export interface NormalizeOptions {
  /** Request URL; fills `instance` and `zone`. */
  url?: string;
  /** Override the timestamp (ISO 8601). Defaults to now. */
  now?: Date | string;
}
