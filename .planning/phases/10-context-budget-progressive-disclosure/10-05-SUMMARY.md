---
phase: 10-context-budget-progressive-disclosure
plan: 05
subsystem: context-experiment
tags: [experiment, statistics, newcombe-interval, tdd]
requires: ["10-04"]
provides:
  - "scripts/ctx-experiment-core.ts: pre-registered constants, seeded balanced interleaved run plan, Newcombe hybrid-score interval, decide(), discriminate()"
  - "trial prompt, JSON-mode output parser, scoreTrial over the existing scoreCalibration grader, summarise with isProseToolCall"
  - "armArgs for the four arms, padFileText, PAD_TOKENS checked against the composed harness"
key-files:
  created:
    - scripts/ctx-experiment-core.ts
    - tests/unit/ctx-experiment.test.ts
requirements-completed: [CTX-05]
completed: 2026-10-13
---

# Phase 10 Plan 05: Offline experiment core Summary

A pure module (no model call, no I/O, named exports only) holds the minimal-vs-full experiment's protocol: constants pinned by tests, a deterministic plan, a Newcombe interval verified against the published 56/70 vs 48/80 example (0.0524 to 0.3339), a boundary-tested decision rule, and a scoring path that reuses `scoreCalibration`.

## Pinned values
- DEGRADE_POINTS 0.15, Z_90 1.6449, PROSE_RATE_THRESHOLD 0.10, FIRST_STAGE_REPEATS 10, SECOND_STAGE_REPEATS 20.
- Added constants (also pinned by behaviour in tests): PROSE_CONCENTRATION 0.5, LOW_CATCH_RATE 0.5.
- **PAD_TOKENS = 2907** (full floor 4233 minus bare floor 1326, estimator ceil(chars/4)); a test re-measures both with `measureFloor` and requires equality, so a drift of one token fails.

## Verified flag spellings (docs/cli.md, docs/json.md)
`--mode json`, `-p`/`--print`, `-ne`/`--no-extensions`, `-ns`/`--no-skills`, `-nc`/`--no-context-files`, `-np`/`--no-prompt-templates`, `--tools read,bash,edit,write`, `--append-system-prompt <text|path>`, plus the harness flag `--ky-profile` (registered in routing/index.ts). JSON events: assistant results are read from `message_end` records with `role: "assistant"`.
- A = common + the four no-* flags + tools; C = A + append pair; B/F = common + `--ky-profile implement|full`.

## Decisions
- `scoreTrial(finalText, defectId, allExpectations)` takes all six expectations so the grader's cross-contamination guard still applies per trial. Seeded expectations get their `id` from the defect id.
- `buildTrialPrompt` takes the already-read file contents (`{diff, touchedFiles:[{path, contents}]}`), keeping the core free of file I/O; the CLI (10-06) reads them. The prompt states a single requirement id `R1`; a review that omits its verdict is counted malformed.
- `discriminate` prose check runs first (any arm), then A-vs-F/C. A sixth outcome `provider-misconfiguration` is returned when A is low on the primary route and a supplied second-route run of A differs; with a healthy catch rate and no difference the answer is `inconclusive`.
- JSON fixtures are hand-built from `fauxAssistantMessage` values (driving a harness session was not cheap enough).
- No ratchet raised: `scripts/` is not a ratcheted directory.

## Tests
`npx vitest run tests/unit/ctx-experiment.test.ts --maxWorkers=2`: 49 pass (plan balance/determinism/interleaving, interval reference and boundaries, 10-row decision table, discrimination, six defects caught by crafted answers and missed by generic ones, blind and shotgun controls score zero, malformed output counted, arm-arg diffs, padding, summarise, PAD_TOKENS).
`npx tsc --noEmit` exits 0. Deliberate type error (`PAD_TOKENS: string = 2907`) made tsc fail with TS2322; reverted. So the core is type-checked through the test import.

## Commits
- 5fe0645 test: plan, interval, decision, discrimination (RED)
- cfe7f21 feat: those pieces (GREEN)
- deefb71 test: prompt, parsing, scoring, controls, arms, padding (RED)
- 482478f feat: those pieces (GREEN)

## Deviations from Plan
None of substance. The `d = -0.15` boundary uses a 1e-9 slack so float rounding cannot flip it; equal 30/60 vs 30/60 lands at lower bound -0.1469, just inside NO_DETECTABLE_EFFECT (hand-derived in the test comment).

## Known Stubs
None.

## Self-Check: PASSED
