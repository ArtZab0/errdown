# Token benchmark (228 captured errors)

Tokenizer: o200k_base via js-tiktoken (proxy). "md" = the error page converted with Turndown, as most
fetch tools return it. "status" = a bare "Failed to fetch URL - status code N" (reference MCP fetch server).
Reproduce: `cd packages/js && node scripts/bench-tokens.ts`

```
fixtures: 228
                 total     median
raw            656848         39
md             318128         26
status           4457         19
errdown         32513        139
compact          4792         20

responses > 1000 raw tokens (30):  name  raw -> turndown -> errdown -> compact
  holdout-site-glitch-404            153338 -> 152965 ->  131 ->  14
  site-github-404                    101634 ->  50777 ->  123 ->  14
  api-reddit-404                      87470 ->  59628 ->  141 ->  14
  holdout-site-apple-404              49371 ->   1273 ->  124 ->  14
  site-nytimes-404                    27120 ->    638 ->  126 ->  14
  holdout-site-hf-space-404           23978 ->    656 ->  122 ->  17
  holdout-site-microsoft-404          23547 ->   2264 ->  124 ->  14
  holdout-site-mozilla-404            21558 ->   2265 ->  137 ->  18
  site-x                              18047 ->    405 ->  123 ->  14
  holdout-site-substack-404           15994 ->     91 ->  133 ->  14
  site-wikipedia-404                  14601 ->   2916 ->  124 ->  14
  holdout-site-bbc-404                14473 ->  10324 ->  125 ->  14
  platform-firebase-404               13468 ->  12834 ->  132 ->  14
  holdout-site-theguardian-404        11586 ->     96 ->  125 ->  14
  holdout-site-koyeb-404              10569 ->    224 ->  134 ->  14
  holdout-site-python-404              8387 ->   2338 ->  124 ->  14
  holdout-site-surge-404               5458 ->     32 ->  133 ->  14
  site-glassdoor                       5369 ->    147 ->  178 ->  24
  platform-ghpages-path-404            5175 ->   4448 ->  134 ->  17
  platform-ghpages-404                 5108 ->   4413 ->  142 ->  17
  holdout-site-replit-404              2835 ->    626 ->  133 ->  14
  site-npmjs-404                       2733 ->     11 ->  166 ->  24
  site-medium-404                      2691 ->     11 ->  163 ->  24
  holdout-site-shopify-store-404       2688 ->     80 ->  134 ->  14
  holdout-site-docs-python-404         2686 ->    421 ->  124 ->  14
  site-stackoverflow-404               2675 ->     11 ->  164 ->  24
  holdout-site-gitlab-pages-404        2673 ->     11 ->  184 ->  24
  cloudflare-zone-challenge            2532 ->     11 ->  180 ->  24
  cloudflare-zone-waf-block            1194 ->    199 ->  163 ->  17
  site-craigslist                      1151 ->    271 ->  128 ->  14

responses < 100 raw tokens: 164; median raw 12, status-only 18, errdown 140, compact 22
```

## Reading

- **Compact** (`toCompact()`, errdown-mcp's default) costs a median **20 tokens** per error: 98.5% fewer
  than converted error pages (318k -> 4.8k tokens in total) and about the same as a bare status line,
  while still carrying the category, retry decision, wait time and the server's short message.
- **Full** Cloudflare-format Markdown costs ~140 tokens per error. Use it when you want the complete
  RFC 9457 contract; use compact when tokens matter.
- Large HTML error pages (GitHub 404: 101k tokens raw) collapse to a single line either way.
