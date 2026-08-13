---
status: partial
phase: 02-diagnostics-the-instrument
source: [02-VERIFICATION.md]
started: 2026-08-13T18:45:00Z
updated: 2026-08-13T18:45:00Z
---

## Current Test

[awaiting human testing]

These three items are the live half of Phase 2. They were pre-authorised as
outstanding under the Standing Operating Policy in `.planning/STATE.md` — the
phase was allowed to complete with them pending, but none of them may be
recorded as passed until a human actually runs them on a machine with live model
credentials. `docs/RUNBOOK.md` carries the executable procedure for all three as
RB-02-01/02/03, and `tests/unit/docs-policy.test.ts` mechanically prevents any
`RB-<phase>-<n>` entry being flipped to PASSED in the runbook without the
corresponding status line agreeing.

## Tests

### 1. RB-02-01 (DIAG-01) — one real turn per provider produces a wire dump showing the thinking parameters
expected: The DeepSeek-direct payload carries a top-level `reasoning_effort` alongside `thinking:{type:"enabled"}`; the Bedrock Claude payload carries a non-empty `additionalModelRequestFields`. Exact commands are in `docs/RUNBOOK.md` RB-02-01.
why_human: No live model credentials or provider egress exist on this development machine. `fauxProvider` builds its own payload, so a faux-driven assertion is a fixture agreeing with itself, not evidence of what a real provider adapter emits on the wire.
runbook: docs/RUNBOOK.md RB-02-01 (OUTSTANDING)
result: [pending]

### 2. RB-02-02 (DIAG-07) — no live credential appears in any wire dump
expected: A grep for credential-shaped strings across `.pi/logs/` prints nothing (exit 1), and the `main.headers` record shows every credential-shaped header as `[redacted:N chars]`.
why_human: `fauxProvider` resolves no auth, so no real credential has ever passed through the capture path on this machine. The offline proof (`tests/integration/wire-capture.test.ts` cases 3 and 4) plants a synthetic token and proves both absence-of-secret and non-over-redaction, which is necessary but not sufficient. Must be run after RB-02-01, on the work laptop, with live credentials.
runbook: docs/RUNBOOK.md RB-02-02 (OUTSTANDING)
result: [pending]

### 3. RB-02-03 (DIAG-05) — the prose-tool-call detector has fired on real DeepSeek V4 Flash traffic
expected: A working day of real traffic produces a numerator/denominator prose rate broadly comparable to the ~11% baseline in DeepSeek-V3 issue #1244, with at least one instance where the single retry recovered the turn.
why_human: The prose-tool-call failure mode only manifests on real model output. Offline, the detector is fed messages this repository wrote in order to make it fire — that measures the predicate, not the model. ROADMAP.md Success Criterion 4 explicitly splits this requirement into a built-and-unit-verified half and a "verified live on the work laptop" half.
runbook: docs/RUNBOOK.md RB-02-03 (OUTSTANDING)
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
