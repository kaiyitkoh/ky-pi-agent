---
status: partial
phase: 10-context-budget-progressive-disclosure
source: [10-VERIFICATION.md]
started: 2026-10-13T08:30:00Z
updated: 2026-10-13T08:30:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. RB-10-01 — live minimal-vs-full context-pollution experiment
expected: `scripts/ctx-experiment.sh` run on the work laptop (account with no cloud credentials) records a decision line (DEGRADES / NO-EFFECT / INCONCLUSIVE) and a root-cause discrimination in docs/RUNBOOK.md
result: [pending]

### 2. RB-10-02 — live prompt-cache check
expected: DeepSeek turn 2 shows cacheRead covering the system prompt + tools prefix; a `/plan` toggle behaves as documented
result: [pending]

### 3. RB-10-03 — per-turn cost of the four pinned-but-uninstalled packages
expected: `/budget` per-package deltas recorded in docs/EXTENSIONS.md with keep/remove verdicts
result: [pending]

### 4. Floor numbers on macOS
expected: `tests/integration/context-floor.test.ts` and the PAD_TOKENS test pass on macOS CI
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
