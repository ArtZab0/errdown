"""Capture error responses from the Docker lab into fixtures/<server>-<case>-captured.input.json.

Usage: python3 capture.py [out_dir]   (containers must be running: docker compose up -d)
"""
import json, sys, urllib.request, urllib.error, datetime, pathlib

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "../../fixtures")
SERVERS = {"nginx": 8081, "apache": 8082, "caddy": 8083, "envoy": 8084, "traefik": 8085,
           "express": 8090, "flask": 8091, "fastapi": 8092, "django": 8093, "tomcat": 8094, "jetty": 8095}
FRAMEWORKS = {"express", "flask", "fastapi", "django", "tomcat", "jetty"}
CASES = [  # (case, method, path, body, repeat)
    ("404", "GET", "/missing", None, 1),
    ("403", "GET", "/forbidden", None, 1),
    ("502", "GET", "/dead", None, 1),
    ("504", "GET", "/slow", None, 1),
    ("503", "GET", "/maint", None, 1),
    ("429", "GET", "/limit", None, 3),
    ("413", "POST", "/big", b"x" * 4096, 1),
    ("upstream500", "GET", "/upstream500", None, 1),
    # edge cases (proxies and frameworks)
    ("405", "DELETE", "/missing", None, 1),
    ("414", "GET", "/" + "a" * 20000, None, 1),
    ("431", "GET", "/missing", None, 1),          # sent with a 64 KB header
    ("501", "FOO", "/", None, 1),
    # framework routes
    ("500", "GET", "/boom", None, 1),
    ("422", "GET", "/items/not-a-number", None, 1),
    ("400", "POST", "/json", b"{not json", 1),
]
FRAMEWORK_ONLY = {"500", "422", "400"}
DROP = {"date", "content-length", "connection", "keep-alive", "etag", "last-modified", "x-request-id"}
today = datetime.date.today().isoformat()

def fetch(port, method, path, body, big_header=False):
    hdrs = {"Accept": "text/markdown, */*", "User-Agent": "errdown-lab"}
    if big_header: hdrs["X-Big"] = "b" * 65536
    if body is not None: hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=body, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()

seen = set()
for server, port in SERVERS.items():
    for case, method, path, body, repeat in CASES:
        if case in FRAMEWORK_ONLY and server not in FRAMEWORKS: continue
        if server in FRAMEWORKS and case in {"502", "504", "upstream500", "413"}: continue
        status = None
        for _ in range(repeat):
            try:
                status, headers, data = fetch(port, method, path, body, big_header=(case == "431"))
            except Exception as e:
                print(f"{server:8} {case:12} ERROR {e}"); status = None; break
        if status is None:
            continue
        if status < 400:
            print(f"{server:8} {case:12} {status} (not an error, skipped)"); continue
        key = (server, status, data)
        if key in seen:
            print(f"{server:8} {case:12} {status} duplicate"); continue
        seen.add(key)
        name = f"{server}-{case}-captured" if case == str(status) else f"{server}-{case}-{status}-captured"
        hdrs = {k.lower(): v for k, v in headers.items() if k.lower() not in DROP}
        fx = {"status": status, "headers": hdrs, "body": data.decode("utf-8", "replace"),
              "url": f"https://lab.example{path if len(path) < 200 else path[:40] + '...'}",
              "_provenance": f"captured {today} from the errdown Docker lab ({server}), Accept: text/markdown, */*"}
        (OUT / f"{name}.input.json").write_text(json.dumps(fx, indent=2) + "\n")
        print(f"{server:8} {case:12} {status} -> {name} ({len(data)}B, server={hdrs.get('server','-')})")
