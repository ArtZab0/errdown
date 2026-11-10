# Accuracy

## How it is measured

- Labels come from **how each fixture was produced** (the capture scenario: "no credentials
  sent", "page does not exist", "upstream port closed"), never from errdown's output
  (`lab/labels/scenario_labels.py`).
- When the server answered differently than the scenario intended (e.g. a bot block instead of a
  404), a **blind labeler** (a separate model instance that sees only the request and raw
  response, never errdown's code or output) assigns the label (`lab/labels/blind_*`).
- **Holdout batches** are captured with labels declared in the capture script before errdown runs.
  The code is frozen (commit recorded below) and evaluated once. After that the batch joins the
  dev set, and the next reported number requires a new holdout batch.
- Caveat: the scenarios were written by the same project that wrote the code. Outside
  contributions of fixtures are the path to more independent labels.

## Results

| Date | Batch | n | Category | Retryable | Code commit |
|---|---|---|---|---|---|
| 2026-11-10 | holdout #1 (new APIs, sites, platforms) | 79 | **89.9%** | **100%** | `bcddb71` |

Holdout #1 misses (8):
- 5x 400/403 meaning "credentials missing" with wording the message rule did not cover
  (Dropbox x2, ClickUp, Trello, Algolia) -> errdown said bad_request / access_denied.
- 2x Hugging Face returns 401 for nonexistent models/spaces (existence hiding) -> errdown said
  auth_required, blind label says not_found. Contestable.
- 1x WordPress.com "Checking your browser" bot check not recognized -> access_denied vs challenge.

Retryable was correct on all 79: no miss would have caused a wasted retry or a skipped one.

Dev set (170, labels scenario + blind, tuned on): 100% / 100% — not evidence, regression only.
