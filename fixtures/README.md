# Conformance fixtures

Each case is `<name>.input.json` (`status`, `headers`, `body`, `url`) plus `<name>.expected.json`
(the Problem, with `timestamp` removed; `null` for non-errors). See SPEC.md §11.

**Provenance:** fixtures named `*-captured` are real responses (see their `_provenance`
field). All others are hand-written from known server output. The
`cloudflare-*` ones approximate Cloudflare's format and must be replaced by real captures
(week 1 task) before any parity claim.

`packages/js/scripts/gen-expected.ts` regenerates expected files from the TS implementation.
Review every diff by hand: expected files are the ground truth, not the code.

## Labels and accuracy

`labels.json` holds the ground-truth `category` and `retryable` per fixture, independent of
`*.expected.json` (which records full output for regression testing). `split` is `dev` or
`holdout`. Run `node packages/js/scripts/eval.ts [--split holdout]`.

Honesty rules:
- Current `dev` labels were seeded from errdown output and reviewed by hand, so dev accuracy
  is not evidence of anything. It only catches regressions.
- `holdout` fixtures are captured in a fresh batch and labelled **before** errdown is run on
  them. Fingerprints are never tuned on holdout misses; the reported accuracy is holdout only.
- `blind-label-sheet.csv`: 30 cases for a human to label without seeing errdown output.
