---
phase: 10-context-budget-progressive-disclosure
plan: 03
subsystem: context-floor
tags: [shell-policy, vendored-patch, floor-ceilings]
requires: ["10-02"]
provides:
  - "background shell-policy guidance gated on bg_run being selected (PROVENANCE deviation 9)"
  - "per-profile CI floor ceilings and the AFTER record in docs/DIAGNOSTICS.md"
key-files:
  modified:
    - .pi/extensions/background-tasks/src/core/shell-policy.ts
    - .pi/extensions/background-tasks/PROVENANCE.md
    - tests/unit/workflow-budgets.test.ts
    - tests/integration/context-floor.test.ts
    - docs/DIAGNOSTICS.md
  created:
    - tests/unit/shell-policy-gate.test.ts
requirements-completed: [CTX-06, CTX-01]
completed: 2026-10-13
---

# Phase 10 Plan 03: Shell-policy gate and per-profile floors Summary

The vendored shell-policy section is omitted unless `bg_run` is selected, and each profile's per-turn floor is now held under a named CI ceiling with AFTER numbers recorded beside BEFORE.

## BEFORE vs AFTER floor (`/budget` formula, tokens)

| Profile | BEFORE (full composed) | AFTER | Delta | Ceiling |
|---|---|---|---|---|
| recon | 4233 | 1818 | -2415 (-57.0%) | 1870 |
| review | 4233 | 1945 | -2288 (-54.1%) | 2000 |
| implement (default) | 4233 | 2389 | -1844 (-43.6%) | 2460 |
| full | 4233 | 4233 | 0 | 4360 |

The ~1,850 target is met by recon only (1818). The default profile lands at 2389, so the 1,850 figure is not claimed for it.

## Tasks and commits
1. Gate on bg_run, PROVENANCE deviation 9, unit test, ratchet: 19e9d51
2. Per-profile ceilings, assertions, AFTER table: c8ae264

## Ratchet raise (workflow-budgets.test.ts)
- `.pi/extensions/background-tasks`: 10340 -> 10350 (measured 10343). The 3 added lines are new code (the early return in the handler), not slack. `why` updated.

## Verification
- Passing: shell-policy-gate, vendor-license-audit, workflow-budgets, context-floor (targeted, sequential). `npx tsc --noEmit` clean. No full-suite run.
- Mutation proofs, each restored: removing the early return fails the gate unit test, and fails context-floor (recon measured 1946 > 1870 ceiling).
- Attribution closure residual still 0 chars.

## Deviations from Plan
- None. The gate sits in `createShellPolicyGuidanceHandler` (smallest diff). `selectedTools` read from `event.systemPromptOptions` (verified in system-prompt.d.ts).

## Self-Check: PASSED
