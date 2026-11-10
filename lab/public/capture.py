"""Capture public error responses (unauthenticated API calls, nonexistent pages/buckets).
One harmless request per case. Usage: python3 capture.py [only_name...]"""
import json, sys, pathlib, datetime, urllib.request, urllib.error, ssl

OUT = pathlib.Path(__file__).parent / "../../fixtures"
UA = "errdown-corpus/0.1 (+https://github.com/ArtZab0/errdown)"
J = {"Content-Type": "application/json"}
CASES = [
  # --- JSON APIs
  ("api-github-401", "GET", "https://api.github.com/user", {}, None),
  ("api-github-404", "GET", "https://api.github.com/repos/errdown-nonexistent-q8z3/none", {}, None),
  ("api-github-graphql-401", "POST", "https://api.github.com/graphql", J, b'{"query":"{viewer{login}}"}'),
  ("api-gitlab-401", "GET", "https://gitlab.com/api/v4/user", {}, None),
  ("api-gitlab-404", "GET", "https://gitlab.com/api/v4/projects/999999999999", {}, None),
  ("api-stripe-401", "GET", "https://api.stripe.com/v1/charges", {}, None),
  ("api-openai-401", "GET", "https://api.openai.com/v1/models", {}, None),
  ("api-anthropic-401", "POST", "https://api.anthropic.com/v1/messages", {**J, "anthropic-version": "2023-06-01"}, b"{}"),
  ("api-slack-200-error", "GET", "https://slack.com/api/auth.test", {}, None),
  ("api-twilio-401", "GET", "https://api.twilio.com/2010-04-01/Accounts.json", {}, None),
  ("api-shopify-404", "GET", "https://errdown-nonexistent-q8z3.myshopify.com/admin/api/2024-01/shop.json", {}, None),
  ("api-discord-401", "GET", "https://discord.com/api/v10/users/@me", {}, None),
  ("api-notion-401", "GET", "https://api.notion.com/v1/users", {"Notion-Version": "2022-06-28"}, None),
  ("api-spotify-401", "GET", "https://api.spotify.com/v1/me", {}, None),
  ("api-google-401", "GET", "https://www.googleapis.com/drive/v3/files", {}, None),
  ("api-google-400-key", "GET", "https://www.googleapis.com/youtube/v3/videos?part=id&id=x&key=invalid", {}, None),
  ("api-huggingface-401", "GET", "https://huggingface.co/api/whoami-v2", {}, None),
  ("api-npm-404", "GET", "https://registry.npmjs.org/errdown-nonexistent-q8z3-pkg", {}, None),
  ("api-pypi-404", "GET", "https://pypi.org/pypi/errdown-nonexistent-q8z3-pkg/json", {}, None),
  ("api-dockerhub-404", "GET", "https://hub.docker.com/v2/repositories/errdownq8z3/none/", {}, None),
  ("api-cloudflare-400", "GET", "https://api.cloudflare.com/client/v4/user", {}, None),
  ("api-vercel-403", "GET", "https://api.vercel.com/v2/user", {}, None),
  ("api-netlify-401", "GET", "https://api.netlify.com/api/v1/user", {}, None),
  ("api-digitalocean-401", "GET", "https://api.digitalocean.com/v2/account", {}, None),
  ("api-linear-400", "POST", "https://api.linear.app/graphql", J, b'{"query":"{viewer{id}}"}'),
  ("api-sentry-401", "GET", "https://sentry.io/api/0/organizations/", {}, None),
  ("api-mailgun-401", "GET", "https://api.mailgun.net/v3/domains", {}, None),
  ("api-sendgrid-401", "GET", "https://api.sendgrid.com/v3/user/profile", {}, None),
  ("api-heroku-401", "GET", "https://api.heroku.com/account", {"Accept": "application/vnd.heroku+json; version=3"}, None),
  ("api-reddit-404", "GET", "https://www.reddit.com/r/errdownnonexistentq8z3/about.json", {}, None),
  ("api-wikipedia-404", "GET", "https://en.wikipedia.org/api/rest_v1/page/summary/Errdown_nonexistent_q8z3", {}, None),
  ("api-mastodon-404", "GET", "https://mastodon.social/api/v1/accounts/lookup?acct=errdownnonexistentq8z3", {}, None),
  ("api-azure-401", "GET", "https://management.azure.com/subscriptions?api-version=2020-01-01", {}, None),
  ("api-aws-sts-403", "GET", "https://sts.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15", {}, None),
  ("api-gemini-403", "GET", "https://generativelanguage.googleapis.com/v1beta/models", {}, None),
  ("api-mistral-401", "GET", "https://api.mistral.ai/v1/models", {}, None),
  ("api-groq-401", "GET", "https://api.groq.com/openai/v1/models", {}, None),
  ("api-replicate-401", "GET", "https://api.replicate.com/v1/account", {}, None),
  ("api-supabase-404", "GET", "https://api.supabase.com/v1/projects", {}, None),
  # --- Object storage (XML)
  ("storage-s3-nosuchbucket", "GET", "https://errdown-nonexistent-q8z3.s3.amazonaws.com/x", {}, None),
  ("storage-s3-accessdenied", "GET", "https://s3.amazonaws.com/", {}, None),
  ("storage-gcs-404", "GET", "https://storage.googleapis.com/errdown-nonexistent-q8z3/x", {}, None),
  ("storage-azure-blob", "GET", "https://errdownq8z3.blob.core.windows.net/c/x", {}, None),
  # --- Hosting platforms (nonexistent pages/projects)
  ("platform-vercel-404", "GET", "https://errdown-nonexistent-q8z3.vercel.app/", {}, None),
  ("platform-vercel-page-404", "GET", "https://vercel.com/errdown-nonexistent-q8z3-page", {}, None),
  ("platform-netlify-404", "GET", "https://errdown-nonexistent-q8z3.netlify.app/", {}, None),
  ("platform-heroku-404", "GET", "https://errdown-nonexistent-q8z3.herokuapp.com/", {}, None),
  ("platform-render-404", "GET", "https://errdown-nonexistent-q8z3.onrender.com/", {}, None),
  ("platform-ghpages-404", "GET", "https://errdown-nonexistent-q8z3.github.io/", {}, None),
  ("platform-ghpages-path-404", "GET", "https://pages.github.com/errdown-nonexistent-q8z3", {}, None),
  ("platform-fly-404", "GET", "https://errdown-nonexistent-q8z3.fly.dev/", {}, None),
  ("platform-railway-404", "GET", "https://errdown-nonexistent-q8z3.up.railway.app/", {}, None),
  ("platform-firebase-404", "GET", "https://errdown-nonexistent-q8z3.web.app/", {}, None),
  ("platform-cfpages-404", "GET", "https://errdown-nonexistent-q8z3.pages.dev/", {}, None),
  ("platform-appengine-404", "GET", "https://errdown-nonexistent-q8z3.appspot.com/", {}, None),
  ("platform-azurewebsites-404", "GET", "https://errdown-nonexistent-q8z3.azurewebsites.net/", {}, None),
  ("platform-deno-404", "GET", "https://errdown-nonexistent-q8z3.deno.dev/", {}, None),
  ("platform-cloudfront-403", "GET", "https://d1234567890abc.cloudfront.net/", {}, None),
  ("platform-apigw-403", "GET", "https://abcdef1234.execute-api.us-east-1.amazonaws.com/", {}, None),
  ("platform-lambda-url-403", "GET", "https://abcdefghijklmnopqrstuvwxyz123456.lambda-url.us-east-1.on.aws/", {}, None),
  ("platform-google-404", "GET", "https://www.google.com/errdown-nonexistent-q8z3", {}, None),
  ("platform-gfe-cloudrun-404", "GET", "https://errdown-nonexistent-q8z3-uc.a.run.app/", {}, None),
  # --- Big sites' own 404 pages
  ("site-amazon-404", "GET", "https://www.amazon.com/errdown-nonexistent-q8z3", {}, None),
  ("site-github-404", "GET", "https://github.com/errdown-nonexistent-q8z3/none", {}, None),
  ("site-stackoverflow-404", "GET", "https://stackoverflow.com/questions/0/errdown-nonexistent", {}, None),
  ("site-npmjs-404", "GET", "https://www.npmjs.com/package/errdown-nonexistent-q8z3-pkg", {}, None),
  ("site-medium-404", "GET", "https://medium.com/@errdownnonexistentq8z3/none", {}, None),
  ("site-wikipedia-404", "GET", "https://en.wikipedia.org/wiki/Errdown_nonexistent_q8z3", {}, None),
  ("site-nytimes-404", "GET", "https://www.nytimes.com/errdown-nonexistent-q8z3", {}, None),
  ("site-linkedin", "GET", "https://www.linkedin.com/in/errdown-nonexistent-q8z3", {}, None),
  ("site-x", "GET", "https://x.com/errdownnonexistentq8z3", {}, None),
  ("site-instagram", "GET", "https://www.instagram.com/errdownnonexistentq8z3/", {}, None),
  ("site-zillow", "GET", "https://www.zillow.com/homes/errdown_rb/", {}, None),
  ("site-g2", "GET", "https://www.g2.com/products/errdown/reviews", {}, None),
  ("site-indeed", "GET", "https://www.indeed.com/viewjob?jk=0", {}, None),
  ("site-glassdoor", "GET", "https://www.glassdoor.com/Reviews/errdown-reviews-SRCH_KE0,7.htm", {}, None),
  ("site-craigslist", "GET", "https://sfbay.craigslist.org/errdown-nonexistent", {}, None),
]
DROP = {"date", "content-length", "set-cookie", "report-to", "nel", "alt-svc", "etag", "last-modified",
        "x-request-id", "x-amz-request-id", "x-amz-id-2", "x-github-request-id", "cf-ray", "x-runtime",
        "strict-transport-security", "content-security-policy", "permissions-policy", "expires", "age"}
only = set(sys.argv[1:])
today = datetime.date.today().isoformat()
ctx = ssl.create_default_context()
for name, method, url, hdrs, body in CASES:
    if only and name not in only: continue
    req = urllib.request.Request(url, data=body, method=method, headers={"User-Agent": UA, "Accept": "text/markdown, */*", **hdrs})
    try:
        with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
            status, rh, data = r.status, r.headers, r.read(300_000)
    except urllib.error.HTTPError as e:
        status, rh, data = e.code, e.headers, e.read(300_000)
    except Exception as e:
        print(f"{name:30} ERROR {type(e).__name__}: {str(e)[:70]}"); continue
    keep_200 = name.endswith("200-error")
    if status < 400 and not keep_200:
        print(f"{name:30} {status} (not an error, skipped)"); continue
    h = {k.lower(): v for k, v in rh.items() if k.lower() not in DROP}
    fx = {"status": status, "headers": h, "body": data.decode("utf-8", "replace"), "url": url,
          "_provenance": f"captured {today}, public endpoint, {method}, Accept: text/markdown, */*"}
    (OUT / f"{name}-captured.input.json").write_text(json.dumps(fx, indent=2) + "\n")
    print(f"{name:30} {status} {h.get('content-type','-')[:30]:30} {len(data)}B server={h.get('server','-')[:20]}")
