#!/usr/bin/env bash
# Captures raw responses from the errdown.dpdns.org lab into ./captures/<name>.<accept>.http
set -uo pipefail
D=errdown.dpdns.org; S=${SCHEME:-https}
mkdir -p captures
declare -A URLS=(
  [worker-throw]="$S://w.$D/throw" [worker-cpu]="$S://w.$D/cpu" [ok]="$S://w.$D/ok"
  [waf-block]="$S://w.$D/blocked" [challenge]="$S://w.$D/challenge" [ratelimit]="$S://w.$D/limited"
  [origin-down]="$S://down.$D/" [prohibited-ip]="$S://banned.$D/" [origin-dns]="$S://nxorigin.$D/"
  [bad-origin-cert]="https://badcert.$D/"
)
for name in "${!URLS[@]}"; do
  for acc in markdown json html; do
    case $acc in markdown) h="text/markdown, */*";; json) h="application/json, */*";; html) h="text/html,application/xhtml+xml";; esac
    [ "$name" = ratelimit ] && { curl -s -o /dev/null --max-time 30 -H "Accept: $h" "${URLS[$name]}"; }
    curl -s -i --max-time 90 -H "Accept: $h" -A "errdown-lab/0.1" "${URLS[$name]}" > "captures/$name.$acc.http"
    printf "%-16s %-8s %s\n" "$name" "$acc" "$(head -1 captures/$name.$acc.http | tr -d '\r')"
    [ "$name" = ratelimit ] && sleep 12
  done
done
