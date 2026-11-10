"""Convert captures/*.http into ../../fixtures/cloudflare-zone-<name>[-<accept>]-captured.input.json"""
import json, pathlib, sys
SRC = pathlib.Path(__file__).parent / "captures"
OUT = pathlib.Path(__file__).parent / "../../fixtures"
DROP = {"date", "content-length", "alt-svc", "report-to", "nel", "set-cookie"}
HOSTS = {"prohibited-ip": "banned", "origin-down": "down", "origin-dns": "nxorigin", "bad-origin-cert": "badcert"}
PATHS = {"worker-throw": "/throw", "worker-cpu": "/cpu", "waf-block": "/blocked", "challenge": "/challenge", "ratelimit": "/limited"}
for f in sorted(SRC.glob("*.http")):
    name, accept = f.stem.rsplit(".", 1)
    if name == "ok": continue
    raw = f.read_bytes().decode("utf-8", "replace").replace("\r\n", "\n")
    head, _, body = raw.partition("\n\n")
    lines = head.split("\n"); status = int(lines[0].split()[1])
    hdrs = {k.strip().lower(): v.strip() for k, v in (l.split(":", 1) for l in lines[1:] if ":" in l) if k.strip().lower() not in DROP}
    structured = "markdown" in hdrs.get("content-type", "") or "json" in hdrs.get("content-type", "")
    if accept != "markdown" and not structured: continue  # same body for every Accept; keep one
    host = HOSTS.get(name, "w") + ".errdown.dpdns.org"
    fx = {"status": status, "headers": hdrs, "body": body, "url": f"https://{host}{PATHS.get(name, '/')}",
          "_provenance": f"captured 2026-11-10 from Cloudflare zone errdown.dpdns.org, Accept: {accept}"}
    suffix = f"-{accept}" if structured else ""
    (OUT / f"cloudflare-zone-{name}{suffix}-captured.input.json").write_text(json.dumps(fx, indent=2) + "\n")
    print(name, accept, status)
