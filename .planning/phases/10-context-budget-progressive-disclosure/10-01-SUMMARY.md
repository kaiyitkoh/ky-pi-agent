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
| full composed (17 entry points + skills + AGENTS.md) | 5162 | 5576 | 10738 | 2685 | 8 |

- Wire estimate for composed tools: 6164 chars (vs 5576 by /budget formula; never compared).
- Per-extension deltas (chars): quality 511 (consult_advisor), questionnaire 1185, safety 248 (approve_ky_command), todo 310, skills index 1373; the other 12 entry points 0.
- Attribution closure residual: 0 chars (tolerance 32).
- Differs from RESEARCH's 4,255 by about 37%: the harness loads none of the installed packages and Qoder's tool deactivates when unconfigured. Recorded in the doc; RESEARCH not copied.
- Ceiling `FLOOR_CEILINGS.composedBefore` = 2765 tokens (measured 2685 + under 3%). Mutation check run: ceiling 2684 fails (expected 2685 <= 2684), restored to 2765.

## Tasks and commits
1. /budget floor line: efcd2ac
2. Composed harness helper: 95394c2
3. Context-floor test and DIAGNOSTICS.md section: 5f4679a

## Ratchet raises (workflow-budgets.test.ts)
- `.pi/extensions/diagnostics/budget.ts` file budget: 440 -> 450 (measured 441). New code: FLOOR_LABEL constant, `floor` field, one computed value with a WHY comment, one rendered row.
- `.pi/extensions/diagnostics` directory budget: 1930 -> 1940 (measured 1936, same four additions).
- Both `why` strings updated with the 2026-10-13 re-measurement.

## Decisions
- Entry points = tracked `.pi/extensions/*.ts` and `*/index.ts` carrying a top-level default export (Pi's discovery shape), 17 today; predicate copied from extension-layout test rather than imported.
- Unit is the /budget formula; wire estimate stated once.
- Harness omits the `tools` allowlist, loads everything as one user-scope inline extension, clears Qoder env vars for the session and restores them.

## Deviations from Plan
- Not exercised: the plan's "removing the floor line fails the budget-command test" mutation was not run by hand; the assertion finds the label line and would fail if removed.
- Test console output is hidden by default for passing runs; use `--reporter=verbose` to see the attribution table.

## Test results
`budget-command`, `workflow-budgets`, `context-floor`: 140 passed. `npx tsc --noEmit`: clean. No full-suite run (CPU constraint).

## Self-Check: PASSED
