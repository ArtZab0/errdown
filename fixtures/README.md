# Conformance fixtures

Each case is `<name>.input.json` (`status`, `headers`, `body`, `url`) plus `<name>.expected.json`
(the Problem, with `timestamp` removed; `null` for non-errors). See SPEC.md §11.

**Provenance:** fixtures named `*-captured` are real responses (see their `_provenance`
field). All others are hand-written from known server output. The
`cloudflare-*` ones approximate Cloudflare's format and must be replaced by real captures
(week 1 task) before any parity claim.

`packages/js/scripts/gen-expected.ts` regenerates expected files from the TS implementation.
Review every diff by hand: expected files are the ground truth, not the code.
