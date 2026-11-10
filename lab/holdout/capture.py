"""Holdout batch: labels are declared HERE, before errdown is run on any response.
Never tune fingerprints on holdout misses. Output: fixtures/holdout-*-captured.input.json
plus split=holdout labels merged into fixtures/labels.json.

Usage: python3 capture.py
"""
import json, pathlib, datetime, urllib.request, urllib.error, ssl

FIX = pathlib.Path(__file__).resolve().parents[2] / "fixtures"
UA = "errdown-corpus/0.1 (+https://github.com/ArtZab0/errdown)"
A, NF, BR, RL, SE, UU = "auth_required", "not_found", "bad_request", "rate_limit", "server_error", "upstream_unavailable"
J = {"Content-Type": "application/json"}
# (name, method, url, headers, body, expected_category, expected_retryable, scenario)
CASES = [
  # --- unauthenticated API calls: credentials missing -> auth_required, not retryable
  ("api-box", "GET", "https://api.box.com/2.0/users/me", {}, None, A, False, "no token"),
  ("api-dropbox", "POST", "https://api.dropboxapi.com/2/users/get_current_account", {}, None, A, False, "no token"),
  ("api-zoom", "GET", "https://api.zoom.us/v2/users/me", {}, None, A, False, "no token"),
  ("api-pagerduty", "GET", "https://api.pagerduty.com/users", {}, None, A, False, "no token"),
  ("api-cohere", "GET", "https://api.cohere.com/v1/models", {}, None, A, False, "no key"),
  ("api-together", "GET", "https://api.together.xyz/v1/models", {}, None, A, False, "no key"),
  ("api-openrouter", "GET", "https://openrouter.ai/api/v1/auth/key", {}, None, A, False, "no key"),
  ("api-deepseek", "GET", "https://api.deepseek.com/models", {}, None, A, False, "no key"),
  ("api-perplexity", "POST", "https://api.perplexity.ai/chat/completions", J, b"{}", A, False, "no key"),
  ("api-elevenlabs", "GET", "https://api.elevenlabs.io/v1/user", {}, None, A, False, "no key"),
  ("api-airtable", "GET", "https://api.airtable.com/v0/meta/whoami", {}, None, A, False, "no token"),
  ("api-hubspot", "GET", "https://api.hubapi.com/crm/v3/objects/contacts", {}, None, A, False, "no token"),
  ("api-intercom", "GET", "https://api.intercom.io/me", {}, None, A, False, "no token"),
  ("api-figma", "GET", "https://api.figma.com/v1/me", {}, None, A, False, "no token"),
  ("api-asana", "GET", "https://app.asana.com/api/1.0/users/me", {}, None, A, False, "no token"),
  ("api-clickup", "GET", "https://api.clickup.com/api/v2/user", {}, None, A, False, "no token"),
  ("api-monday", "POST", "https://api.monday.com/v2", J, b'{"query":"{me{id}}"}', A, False, "no token, GraphQL"),
  ("api-bitbucket", "GET", "https://api.bitbucket.org/2.0/user", {}, None, A, False, "no token"),
  ("api-circleci", "GET", "https://circleci.com/api/v2/me", {}, None, A, False, "no token"),
  ("api-paypal", "GET", "https://api-m.paypal.com/v1/identity/oauth2/userinfo", {}, None, A, False, "no token"),
  ("api-square", "GET", "https://connect.squareup.com/v2/locations", {}, None, A, False, "no token"),
  ("api-coinbase", "GET", "https://api.coinbase.com/v2/user", {}, None, A, False, "no token"),
  ("api-pinecone", "GET", "https://api.pinecone.io/indexes", {}, None, A, False, "no key"),
  ("api-algolia", "GET", "https://latency-dsn.algolia.net/1/indexes", {}, None, A, False, "no key"),
  ("api-contentful", "GET", "https://api.contentful.com/users/me", {}, None, A, False, "no token"),
  ("api-trello", "GET", "https://api.trello.com/1/members/me", {}, None, A, False, "no key"),
  ("api-fastly", "GET", "https://api.fastly.com/current_user", {}, None, A, False, "no token"),
  ("api-bitly", "GET", "https://api-ssl.bitly.com/v4/user", {}, None, A, False, "no token"),
  ("api-dropbox-content", "POST", "https://content.dropboxapi.com/2/files/download", {}, None, A, False, "no token"),
  ("api-netlify-sites", "GET", "https://api.netlify.com/api/v1/sites", {}, None, A, False, "no token"),
  # --- nonexistent resources on public APIs -> not_found
  ("api-crates-404", "GET", "https://crates.io/api/v1/crates/errdown-nonexistent-q8z3", {}, None, NF, False, "missing crate"),
  ("api-rubygems-404", "GET", "https://rubygems.org/api/v1/gems/errdown-nonexistent-q8z3.json", {}, None, NF, False, "missing gem"),
  ("api-packagist-404", "GET", "https://repo.packagist.org/p2/errdown/nonexistent-q8z3.json", {}, None, NF, False, "missing package"),
  ("api-nuget-404", "GET", "https://api.nuget.org/v3-flatcontainer/errdown-nonexistent-q8z3/index.json", {}, None, NF, False, "missing package"),
  ("api-hex-404", "GET", "https://hex.pm/api/packages/errdown_nonexistent_q8z3", {}, None, NF, False, "missing package"),
  ("api-gopkg-404", "GET", "https://proxy.golang.org/github.com/errdown-nonexistent-q8z3/x/@v/list", {}, None, NF, False, "missing module"),
  ("api-hf-model-404", "GET", "https://huggingface.co/api/models/errdown-nonexistent-q8z3/none", {}, None, NF, False, "missing model"),
  ("api-arxiv-404", "GET", "https://export.arxiv.org/abs/9999.99999", {}, None, NF, False, "missing paper"),
  ("api-openlibrary-404", "GET", "https://openlibrary.org/works/OL0000000000W.json", {}, None, NF, False, "missing work"),
  ("api-jsdelivr-404", "GET", "https://cdn.jsdelivr.net/npm/errdown-nonexistent-q8z3@1.0.0/index.js", {}, None, NF, False, "missing package"),
  ("api-unpkg-404", "GET", "https://unpkg.com/errdown-nonexistent-q8z3@1.0.0/index.js", {}, None, NF, False, "missing package"),
  ("api-ghraw-404", "GET", "https://raw.githubusercontent.com/errdown-nonexistent-q8z3/none/main/README.md", {}, None, NF, False, "missing file"),
  ("api-gist-404", "GET", "https://api.github.com/gists/0000000000000000000000000000000000", {}, None, NF, False, "missing gist"),
  ("api-dockerhub-tags-404", "GET", "https://registry.hub.docker.com/v2/repositories/library/errdownq8z3/tags", {}, None, NF, False, "missing image"),
  ("api-swapi-404", "GET", "https://swapi.dev/api/people/99999/", {}, None, NF, False, "missing record"),
  ("api-pokeapi-404", "GET", "https://pokeapi.co/api/v2/pokemon/errdownq8z3", {}, None, NF, False, "missing record"),
  # --- bad requests
  ("api-github-422", "POST", "https://api.github.com/markdown", J, b'{"text": 5}', BR, False, "invalid body type"),
  ("api-jsonplaceholder-404", "GET", "https://jsonplaceholder.typicode.com/posts/999999", {}, None, NF, False, "missing record"),
  ("api-httpbin-status-400", "GET", "https://httpbin.org/status/400", {}, None, BR, False, "synthetic 400"),
  ("api-httpbin-status-429", "GET", "https://httpbin.org/status/429", {}, None, RL, True, "synthetic 429"),
  ("api-httpbin-status-503", "GET", "https://httpbin.org/status/503", {}, None, UU, True, "synthetic 503"),
  ("api-httpbin-status-500", "GET", "https://httpbin.org/status/500", {}, None, SE, True, "synthetic 500"),
  # --- nonexistent pages on sites/platforms -> not_found
  ("site-python-404", "GET", "https://www.python.org/errdown-nonexistent-q8z3", {}, None, NF, False, "missing page"),
  ("site-apple-404", "GET", "https://www.apple.com/errdown-nonexistent-q8z3", {}, None, NF, False, "missing page"),
  ("site-microsoft-404", "GET", "https://www.microsoft.com/en-us/errdown-nonexistent-q8z3", {}, None, NF, False, "missing page"),
  ("site-mozilla-404", "GET", "https://developer.mozilla.org/en-US/docs/errdown-nonexistent-q8z3", {}, None, NF, False, "missing page"),
  ("site-bbc-404", "GET", "https://www.bbc.com/errdown-nonexistent-q8z3", {}, None, NF, False, "missing page"),
  ("site-theguardian-404", "GET", "https://www.theguardian.com/errdown-nonexistent-q8z3", {}, None, NF, False, "missing page"),
  ("site-hn-404", "GET", "https://news.ycombinator.com/errdown-nonexistent-q8z3", {}, None, NF, False, "missing page"),
  ("site-docs-python-404", "GET", "https://docs.python.org/3/errdown-nonexistent-q8z3.html", {}, None, NF, False, "missing page"),
  ("site-readthedocs-404", "GET", "https://errdown-nonexistent-q8z3.readthedocs.io/", {}, None, NF, False, "missing project"),
  ("site-gitlab-pages-404", "GET", "https://errdown-nonexistent-q8z3.gitlab.io/", {}, None, NF, False, "missing site"),
  ("site-neocities-404", "GET", "https://errdown-nonexistent-q8z3.neocities.org/", {}, None, NF, False, "missing site"),
  ("site-surge-404", "GET", "https://errdown-nonexistent-q8z3.surge.sh/", {}, None, NF, False, "missing site"),
  ("site-glitch-404", "GET", "https://errdown-nonexistent-q8z3.glitch.me/", {}, None, NF, False, "missing site"),
  ("site-wordpress-404", "GET", "https://errdown-nonexistent-q8z3.wordpress.com/", {}, None, NF, False, "missing site"),
  ("site-blogspot-404", "GET", "https://errdown-nonexistent-q8z3.blogspot.com/", {}, None, NF, False, "missing site"),
  ("site-substack-404", "GET", "https://errdown-nonexistent-q8z3.substack.com/", {}, None, NF, False, "missing site"),
  ("site-notion-site-404", "GET", "https://errdown-nonexistent-q8z3.notion.site/", {}, None, NF, False, "missing site"),
  ("site-azurestatic-404", "GET", "https://errdown-nonexistent-q8z3.azurestaticapps.net/", {}, None, NF, False, "missing site"),
  ("site-s3-website-404", "GET", "http://errdown-nonexistent-q8z3.s3-website-us-east-1.amazonaws.com/", {}, None, NF, False, "missing bucket"),
  ("site-kinsta-404", "GET", "https://errdown-nonexistent-q8z3.kinsta.cloud/", {}, None, NF, False, "missing site"),
  ("site-replit-404", "GET", "https://errdown-nonexistent-q8z3.replit.app/", {}, None, NF, False, "missing app"),
  ("site-streamlit-404", "GET", "https://errdown-nonexistent-q8z3.streamlit.app/", {}, None, NF, False, "missing app"),
  ("site-hf-space-404", "GET", "https://huggingface.co/spaces/errdown-nonexistent-q8z3/none", {}, None, NF, False, "missing space"),
  ("site-shopify-store-404", "GET", "https://errdown-nonexistent-q8z3.myshopify.com/", {}, None, NF, False, "missing store"),
  ("site-squarespace-404", "GET", "https://errdown-nonexistent-q8z3.squarespace.com/", {}, None, NF, False, "missing site"),
  ("site-wix-404", "GET", "https://errdownnonexistentq8z3.wixsite.com/site", {}, None, NF, False, "missing site"),
  ("site-webflow-404", "GET", "https://errdown-nonexistent-q8z3.webflow.io/", {}, None, NF, False, "missing site"),
  ("site-framer-404", "GET", "https://errdown-nonexistent-q8z3.framer.website/", {}, None, NF, False, "missing site"),
  ("site-ngrok-404", "GET", "https://errdown-nonexistent-q8z3.ngrok.app/", {}, None, NF, False, "offline tunnel"),
  ("site-koyeb-404", "GET", "https://errdown-nonexistent-q8z3.koyeb.app/", {}, None, NF, False, "missing app"),
  ("site-northflank-404", "GET", "https://errdown-nonexistent-q8z3.code.run/", {}, None, NF, False, "missing app"),
]
DROP = {"date", "content-length", "set-cookie", "report-to", "nel", "alt-svc", "etag", "last-modified",
        "x-request-id", "x-amz-request-id", "x-amz-id-2", "x-github-request-id", "x-runtime",
        "strict-transport-security", "content-security-policy", "permissions-policy", "expires", "age"}
today = datetime.date.today().isoformat()
labels_path = FIX / "labels.json"
labels = json.loads(labels_path.read_text())
ctx = ssl.create_default_context()
kept = 0
for name, method, url, hdrs, body, cat, retry, scenario in CASES:
    req = urllib.request.Request(url, data=body, method=method, headers={"User-Agent": UA, "Accept": "text/markdown, */*", **hdrs})
    try:
        with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
            status, rh, data = r.status, r.headers, r.read(300_000)
    except urllib.error.HTTPError as e:
        status, rh, data = e.code, e.headers, e.read(300_000)
    except Exception as e:
        print(f"{name:26} ERROR {type(e).__name__}: {str(e)[:60]}"); continue
    if status < 400:
        print(f"{name:26} {status} (not an error, dropped)"); continue
    h = {k.lower(): v for k, v in rh.items() if k.lower() not in DROP}
    fname = f"holdout-{name}-captured"
    (FIX / f"{fname}.input.json").write_text(json.dumps({
        "status": status, "headers": h, "body": data.decode("utf-8", "replace"), "url": url,
        "_provenance": f"captured {today}, holdout batch, {method}, scenario: {scenario}"}, indent=2) + "\n")
    intended = {A: 401, NF: 404, BR: 400, RL: 429, SE: 500, UU: 503}[cat]
    labels[fname] = {"category": cat, "retryable": retry, "split": "holdout", "labeler": "scenario:holdout-predeclared",
                     "intended_status": intended, "actual_status": status, "needs_blind_review": status != intended
                     and not (cat == A and status == 403)}
    kept += 1
    print(f"{name:26} {status}  {h.get('content-type','-')[:28]:28} server={h.get('server','-')[:18]}")
labels_path.write_text(json.dumps(labels, indent=1, sort_keys=True) + "\n")
print(f"kept {kept} holdout fixtures")
