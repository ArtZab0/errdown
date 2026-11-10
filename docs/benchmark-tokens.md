# Token benchmark (2026-11-10, 149 captured errors)

Tokenizer: o200k_base via js-tiktoken (proxy). Generic = Turndown HTML->Markdown with script/style removed.
Reproduce: `cd packages/js && node scripts/bench-tokens.ts`

```
fixtures: 149
                 total     median
raw            300405         44
md             141156         19
errdown         21807        142

responses > 1000 raw tokens (15):  name  raw -> turndown -> errdown
  site-github-404                    101634 ->  50770 ->  123
  api-reddit-404                      87470 ->  59621 ->  141
  site-nytimes-404                    27120 ->    631 ->  126
  site-x                              18047 ->    398 ->  123
  site-wikipedia-404                  14601 ->   2909 ->  124
  platform-firebase-404               13468 ->  12827 ->  132
  site-glassdoor                       5369 ->    140 ->  178
  platform-ghpages-path-404            5175 ->   4441 ->  134
  platform-ghpages-404                 5108 ->   4406 ->  142
  site-npmjs-404                       2733 ->      4 ->  166
  site-medium-404                      2691 ->      4 ->  163
  site-stackoverflow-404               2675 ->      4 ->  164
  cloudflare-zone-challenge            2532 ->      4 ->  180
  cloudflare-zone-waf-block            1194 ->    192 ->  163
  site-craigslist                      1151 ->    264 ->  128

responses < 100 raw tokens: 112; errdown median there: 141
```

## Reading

- Large HTML error pages: errdown is 100-800x smaller than raw and far smaller than generic
  Markdown (GitHub 404: 101,634 -> 50,770 -> 123).
- Typical API errors are already small (median raw 44 tokens). errdown's fixed contract costs
  ~140 tokens, so it is *larger* on the median error. The value there is structure
  (category, retryable, retry_after, decide()), not size.
- Challenge pages convert to ~4 tokens of noise ("Just a moment...") with generic Markdown;
  errdown spends ~165 tokens to say "stop, involve a human".
- Positioning: lead with wasted retries avoided; token savings are a tail effect.
- Possible v1.x: a compact renderer for small errors.
