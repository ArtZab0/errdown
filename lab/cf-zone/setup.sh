#!/usr/bin/env bash
# Configures errdown.dpdns.org as a Cloudflare error lab. Idempotent-ish; token in ~/.config/errdown-cf-token.
set -euo pipefail
T=$(cat ~/.config/errdown-cf-token); Z=9e53ffe020277f32292141a3ad17b36a; D=errdown.dpdns.org
api() { curl -s -X "$1" "https://api.cloudflare.com/client/v4/zones/$Z$2" -H "Authorization: Bearer $T" -H "Content-Type: application/json" ${3:+-d "$3"} | python3 -c "import json,sys;d=json.load(sys.stdin);print('  ok' if d.get('success') else '  FAIL '+json.dumps(d.get('errors')))"; }
rec() { echo "dns $2.$D -> $3"; api POST /dns_records "{\"type\":\"$1\",\"name\":\"$2.$D\",\"content\":\"$3\",\"proxied\":true,\"ttl\":1}"; }

rec AAAA w     100::                       # Worker host (+ WAF/rate-limit/challenge paths)
rec A    down  192.0.2.1                   # TEST-NET, unroutable -> 522
rec A    banned 104.16.0.1                 # Cloudflare IP as origin -> 1000
rec CNAME nxorigin nonexistent-q8z3.invalid # unresolvable origin -> 1016
rec A    badcert 93.184.215.14             # origin cert doesn't match (+ strict SSL) -> 526

echo "worker route w.$D/*"
api POST /workers/routes "{\"pattern\":\"w.$D/*\",\"script\":\"errdown-lab\"}"

echo "WAF custom rules: /blocked -> block, /challenge -> managed challenge"
api PUT /rulesets/phases/http_request_firewall_custom/entrypoint '{"rules":[
 {"description":"errdown lab block","expression":"(http.host eq \"w.errdown.dpdns.org\" and http.request.uri.path eq \"/blocked\")","action":"block"},
 {"description":"errdown lab challenge","expression":"(http.host eq \"w.errdown.dpdns.org\" and http.request.uri.path eq \"/challenge\")","action":"managed_challenge"}]}'

echo "rate limit: /limited > 1 req / 10s"
api PUT /rulesets/phases/http_ratelimit/entrypoint '{"rules":[
 {"description":"errdown lab rate limit","expression":"(http.host eq \"w.errdown.dpdns.org\" and http.request.uri.path eq \"/limited\")","action":"block",
  "ratelimit":{"characteristics":["cf.colo.id","ip.src"],"period":10,"requests_per_period":1,"mitigation_timeout":10}}]}'

echo "config rule: strict SSL on badcert.$D"
api PUT /rulesets/phases/http_config_settings/entrypoint '{"rules":[
 {"description":"errdown lab strict ssl","expression":"(http.host eq \"badcert.errdown.dpdns.org\")","action":"set_config","action_parameters":{"ssl":"strict"}}]}'
