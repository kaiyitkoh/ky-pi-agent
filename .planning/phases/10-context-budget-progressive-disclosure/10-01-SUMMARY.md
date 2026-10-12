---
phase: 10-context-budget-progressive-disclosure
plan: 01
subsystem: diagnostics
tags: [budget, context-floor, faux-session, measurement]
requires: []
provides:
  - "/budget per-turn floor line (BudgetReport.floor, FLOOR_LABEL)"
  - "tests/helpers/harness-session.ts composed offline harness (createHarnessSession, measureFloor, listEntryPoints, normalisePaths, withHarnessSession)"
  - "BEFORE floor + per-extension attribution, recorded in docs/DIAGNOSTICS.md"
affects: [10-02, 10-03, 10-07]
key-files:
  created:
    - tests/helpers/harness-session.ts
    - tests/integration/context-floor.test.ts
  modified:
    - .pi/extensions/diagnostics/budget.ts
    - tests/unit/budget-command.test.ts
    - tests/unit/workflow-budgets.test.ts
    - docs/DIAGNOSTICS.md
requirements-completed: [CTX-06]
duration: ~25min
completed: 2026-10-13
---

# Phase 10 Plan 01: Per-turn floor instrument Summary

`/budget` now prints a per-turn floor line, a composed offline harness measures the real floor, and the BEFORE numbers are recorded from committed code.

## Measured BEFORE (path-normalised, /budget formula Math.ceil(chars/4), win32, Node 24.16.0, Pi 1.1.0)

| Configuration | system chars | tool chars | floor chars | floor tokens | tools |
|---|---|---|---|---|---|
| bare Pi | 2758 | 2544 | 5302 | 1326 | 4 |
| bare Pi + AGENTS.md | 4567 | 2544 | 7111 | 1778 | 4 |
| full composed (18 entry points + skills + AGENTS.md) | 8479 | 8450 | 16929 | 4233 | 12 |

- Wire estimate for composed tools: 9206 chars (vs 8450 by /budget formula; never compared).
- Per-extension deltas (chars): background-tasks 6191 chars / 1548 tokens (bg_run, bg_status, bg_logs, bg_kill + prompt section), quality 511 (consult_advisor), questionnaire 1185, safety 248 (approve_ky_command), todo 310, skills index 1373; the other 12 entry points (incl. loop-police) 0.
- Attribution closure residual: 0 chars (tolerance 32).
- Within 1% of RESEARCH's 4,255 (measured, not copied).
- Ceiling `FLOOR_CEILINGS.composedBefore` = 4360 tokens (measured 4233 + under 3%). Mutation check run on the first (superseded) measurement: ceiling 2684 vs 2685 failed as expected.

## Tasks and commits
1. /budget floor line: efcd2ac
2. Composed harness helper: 95394c2
3. Context-floor test and DIAGNOSTICS.md section: 5f4679a

## Ratchet raises (workflow-budgets.test.ts)
- `.pi/extensions/diagnostics/budget.ts` file budget: 440 -> 450 (measured 441). New code: FLOOR_LABEL constant, `floor` field, one computed value with a WHY comment, one rendered row.
- `.pi/extensions/diagnostics` directory budget: 1930 -> 1940 (measured 1936, same four additions).
- Both `why` strings updated with the 2026-10-13 re-measurement.

## Decisions
- Entry points = tracked `.pi/extensions/*.ts` and `*/index.ts` as Pi's loader discovers them (loader.js discoverExtensionsInDir: no export inspection), 18 today.
- Unit is the /budget formula; wire estimate stated once.
- Harness omits the `tools` allowlist, loads everything as one user-scope inline extension, clears Qoder env vars for the session and restores them.

## Deviations from Plan
- [Rule 1 - Bug] Orchestrator found the default-export predicate silently excluded re-exported defaults (background-tasks, loop-police), undercounting the floor (first reading 2685 tokens). Predicate removed to mirror Pi's discovery; guard assertion added that both are in listEntryPoints() and bg_run is registered.
- Not exercised: the plan's "removing the floor line fails the budget-command test" mutation was not run by hand; the assertion finds the label line and would fail if removed.
- Test console output is hidden by default for passing runs; use `--reporter=verbose` to see the attribution table.

## Test results
`budget-command`, `workflow-budgets`, `context-floor`: 140 passed. `npx tsc --noEmit`: clean. No full-suite run (CPU constraint).

## Self-Check: PASSED
