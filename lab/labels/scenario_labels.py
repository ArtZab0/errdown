"""Ground-truth labels derived from HOW each fixture was produced (the capture scenario),
never from errdown's output. Writes fixtures/labels.json.

A label is marked `needs_blind_review` when the server's actual status differs from what the
scenario intended (e.g. we asked for a missing page and got a bot block), because then the
scenario alone no longer tells us the truth. Those get a blind label (see blind_review.md).
"""
import json, pathlib, re, sys

FIX = pathlib.Path(__file__).resolve().parents[2] / "fixtures"
T, F = True, False

# Docker lab: case id -> (intended status, category, retryable). Cause is known by construction.
DOCKER = {
    "404": (404, "not_found", F),            # GET /missing
    "403": (403, "access_denied", F),        # deny rule / abort(403)
    "502": (502, "upstream_unavailable", T), # upstream port closed
    "504": (504, "upstream_unavailable", T), # upstream hangs past proxy timeout
    "503": (503, "upstream_unavailable", T), # maintenance / abort(503)
    "429": (429, "rate_limit", T),           # rate-limit rule
    "413": (413, "bad_request", F),          # body over limit
    "upstream500": (500, "server_error", T), # origin returned 500, proxied
    "405": (405, "bad_request", F),          # DELETE on GET-only path
    "414": (414, "bad_request", F),          # 20 KB URI
    "431": (431, "bad_request", F),          # 64 KB header
    "501": (501, "unsupported", F),          # unknown method FOO
    "500": (500, "server_error", T),         # handler raised
    "422": (422, "bad_request", F),          # path param fails validation
    "400": (400, "bad_request", F),          # malformed JSON body
}
SERVERS = "nginx|apache|caddy|envoy|traefik|express|flask|fastapi|django|tomcat|jetty"

# Cloudflare labs: cause known by construction (we configured each one).
CLOUDFLARE = {
    "cloudflare-1001-plain": (409, "dns", F),            # host with no zone on Cloudflare
    "cloudflare-1003-plain": (403, "config", F),         # direct IP access
    "cloudflare-1034-plain": (403, "config", F),         # edge IP restricted
    "cloudflare-1101-plain": (500, "worker", F),         # worker throws
    "cloudflare-1102-plain": (503, "worker", T),         # worker CPU limit
    "cloudflare-zone-worker-throw": (500, "worker", F),
    "cloudflare-zone-worker-cpu": (503, "worker", T),
    "cloudflare-zone-waf-block": (403, "access_denied", F),
    "cloudflare-zone-challenge": (403, "challenge", F),
    "cloudflare-zone-ratelimit": (429, "rate_limit", T),
    "cloudflare-zone-origin-down": (522, "upstream_unavailable", T),
    "cloudflare-zone-prohibited-ip-json": (403, "dns", F),
    "cloudflare-zone-prohibited-ip-markdown": (403, "dns", F),
    "cloudflare-zone-origin-dns": (530, "dns", F),
    "cloudflare-zone-bad-origin-cert": (526, "tls", F),  # intended 526; origin timed out instead
}

# Hand-written fixtures: labels are part of their design.
HAND = {
    "apache-403": (403, "access_denied", F), "aws-alb-504": (504, "upstream_unavailable", T),
    "cloudflare-1015-json": (429, "rate_limit", T), "cloudflare-1020-markdown": (403, "access_denied", F),
    "cloudflare-challenge-403": (403, "challenge", F), "cloudfront-403": (403, "access_denied", F),
    "envoy-503": (503, "upstream_unavailable", T), "graphql-400": (400, "bad_request", F),
    "heroku-503": (503, "server_error", T), "html-generic-418": (418, "bad_request", F),
    "json-error-object-429": (429, "rate_limit", T), "json-injection-500": (500, "server_error", T),
    "json-oauth-401": (401, "auth_required", F), "nginx-404": (404, "not_found", F),
    "nginx-502": (502, "upstream_unavailable", T), "ok-200": (200, None, None),
    "plain-500-empty": (500, "server_error", T), "problem-json-passthrough": (403, "access_denied", F),
    "traefik-404": (404, "not_found", F), "vercel-404": (404, "not_found", F),
}


def public(name):
    """Public captures: unauthenticated API calls -> auth_required; nonexistent resource -> not_found."""
    if name == "api-slack-200-error":
        return (200, None, None)  # soft error, out of scope by design
    if name.startswith("api-"):
        # these probes sent no credentials (the -404 ones ask for a resource that doesn't exist,
        # except supabase/linear which also require auth for the listing)
        if name.endswith("-404") and name not in ("api-supabase-404",):
            return (404, "not_found", F)
        return (401, "auth_required", F)
    if name.startswith("storage-"):
        return (404, "not_found", F)
    if name.startswith(("platform-", "site-")):
        return (404, "not_found", F)  # every platform/site probe requested a nonexistent page
    return None


def main():
    labels = {}
    for p in sorted(FIX.glob("*.input.json")):
        name = p.name[: -len(".input.json")]
        actual = json.loads(p.read_text())["status"]
        base = name[: -len("-captured")] if name.endswith("-captured") else name
        m = re.match(rf"^({SERVERS})-([a-z0-9]+?)(?:-(\d{{3}}))?$", base)
        if base in HAND:
            spec, how = HAND[base], "designed"
        elif base in CLOUDFLARE:
            spec, how = CLOUDFLARE[base], "configured"
        elif m and m.group(2) in DOCKER and name.endswith("captured"):
            spec, how = DOCKER[m.group(2)], "docker-scenario"
        else:
            spec, how = public(base), "public-probe"
        if name.startswith("holdout-"):
            continue  # labelled by lab/holdout/capture.py
        if spec is None:
            print("NO SCENARIO:", name, file=sys.stderr); continue
        intended, cat, retry = spec
        labels[name] = {"category": cat, "retryable": retry, "split": "dev", "labeler": f"scenario:{how}",
                        "intended_status": intended, "actual_status": actual,
                        "needs_blind_review": intended != actual}
    old = json.loads((FIX / "labels.json").read_text()) if (FIX / "labels.json").exists() else {}
    for n, l in old.items():  # holdout labels are owned by lab/holdout/capture.py: never rebuild them here
        if l.get("split") == "holdout":
            labels[n] = l
    for n, l in old.items():  # keep holdout split and any blind labels already assigned
        if n in labels and l.get("split") == "holdout":
            labels[n]["split"] = "holdout"
        if n in labels and l.get("labeler", "").startswith("blind"):
            labels[n].update({k: l[k] for k in ("category", "retryable", "labeler", "blind_note") if k in l})
    (FIX / "labels.json").write_text(json.dumps(labels, indent=1, sort_keys=True) + "\n")
    rev = [n for n, l in labels.items() if l["needs_blind_review"]]
    print(f"{len(labels)} labels; {len(rev)} need blind review")
    for n in rev: print("  ", n, labels[n]["intended_status"], "->", labels[n]["actual_status"])


if __name__ == "__main__":
    main()
