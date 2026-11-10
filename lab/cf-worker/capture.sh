#!/usr/bin/env bash
# Usage: ./capture.sh https://errdown-lab.<account>.workers.dev
# Writes raw responses to ./captures/<path>.<accept>.http
set -euo pipefail
base="${1:?worker URL}"
mkdir -p captures
for path in throw cpu ok; do
  for acc in markdown json html; do
    case $acc in
      markdown) h="text/markdown, */*";;
      json) h="application/json, */*";;
      html) h="text/html,application/xhtml+xml";;
    esac
    curl -s -i --max-time 90 -H "Accept: $h" "$base/$path" > "captures/$path.$acc.http" || true
    echo "$path/$acc: $(head -1 captures/$path.$acc.http)"
  done
done
