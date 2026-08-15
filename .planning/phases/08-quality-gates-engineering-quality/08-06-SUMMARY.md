---
phase: 08-quality-gates-engineering-quality
plan: 06
subsystem: testing
tags: [deterministic-gates, three-state-verdict, wall-clock-budget, gate-01, qual-02, qual-07]

# Dependency graph
requires:
  - phase: 08-quality-gates-engineering-quality (plan 08-02)
    provides: "runAntiPatternRules(sources) — the six QUAL-01 rule functions this plan's anti-pattern leg wraps"
  - phase: 08-quality-gates-engineering-quality (plan 08-04)
    provides: "addQualityCost({ms}) — the quality-cost ledger this plan's stage pays into exactly once per run"
provides:
  - "runDeterministicGates — the four-leg (typecheck, lint, lsp, anti-pattern) stage runner, binding order typecheck -> lint -> lsp -> anti-pattern"
  - "LegStatus — a three-arm (pass/fail/unavailable) verdict type; UNAVAILABLE never sets GateResult.blocking but always appears in report"
  - "probeLspAvailability — reads the live registered-tool-name list only, never .pi/settings.json, and requires BOTH lsp_diagnostics and lsp_fix"
  - "shouldRunDesignReview (QUAL-07) — a pure predicate over named signals and explicit escalation, false by default on an ordinary task"
  - "runTypecheckLeg / runLintLeg — injected-ExecRunner subprocess legs, testable without spawning; a throwing runner degrades to unavailable, never pass"
affects: ["08-08 (advisor/consult_advisor — a natural carrier for the design-review pass shouldRunDesignReview gates)", "any future /quick-adjacent gate-composition module that wires runDeterministicGates to a real cwd/exec/registeredToolNames"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three-arm discriminated union for a verdict that must distinguish 'ran and failed' from 'did not run' — never a boolean plus a nullable reason (routing/guard.ts's two-arm GuardVerdict extended to three arms here on purpose)"
    - "Injected-runner seam (ExecRunner) for shelling a subprocess, mirroring safety/git.ts's spawnSync(..., {shell:false}) discipline but making the impure leg unit-testable without spawning anything"
    - "Structural no-model-round-trip proof via transitive local-import-graph resolution (chokepoint-lint.test.ts's raw-source-scan technique extended to resolve `from './x.ts'` specifiers recursively, not just grep the entry file)"
    - "A measured wall-clock budget carrying its own recorded figure and date in a docstring, set at ~4x the worst observed run rather than tuned to the observed minimum"

key-files:
  created:
    - .pi/extensions/quality/gates.ts
    - tests/unit/quality-gates.test.ts
  modified: []

key-decisions:
  - "The anti-pattern leg's real measured wall-clock (300-390ms over 46 tracked .pi/extensions/*.ts files, first-run cold vs. steady-state) is far higher than the plan's own illustrative '25ms' framing assumed — ANTI_PATTERN_BUDGET_MS is set to 1600ms (~4x the worst of five measured runs), not a smaller number, because the budget must be a real measurement times four, not a guess dressed as one"
  - "runAntiPatternLeg only ever reaches 'fail' when at least one ERROR-tier finding exists — warning-tier findings from literal-special-case/n-plus-one are folded into a failing leg's findings array (tagged by tier) but never on their own flip a leg from pass to fail, which is also why GateResult.blocking can be computed as a plain 'any leg is fail' reduction without a separate ERROR-tier re-check"
  - "LINT_GATE_FILES is a named, exported constant listing this repo's own twelve structural vitest gates rather than a directory glob — CONTRIBUTING.md/08-CONTEXT.md's equivalence ('lint' here means these suites, never ESLint) is enforced by naming the exact set, not by a pattern that could silently grow or shrink"
  - "DESIGN_REVIEW_FILE_SPAN is a deliberately chosen but explicitly untuned constant (8) — QUAL-07 needs a NAMED threshold, not a bare literal, and this plan's own scope is the predicate mechanism; Phase 9 (QUAL-08) owns dialing the number against real usage"

requirements-completed: [GATE-01, QUAL-02, QUAL-07]

# Metrics
duration: 55min
completed: 2026-08-15
---

# Phase 8 Plan 6: GATE-01 Deterministic Gate Stage Summary

**A pure four-leg gate runner (typecheck, lint, LSP, QUAL-01 anti-pattern rules) reporting PASS/FAIL/UNAVAILABLE per leg — with UNAVAILABLE proved structurally distinct from PASS, the "no model round trip" claim proved by resolving the module's own transitive import graph, and the anti-pattern sweep's real wall-clock measured at 300-390ms against a 1600ms budget.**

## Performance

- **Duration:** 55 min
- **Tasks:** 2
- **Files modified:** 2 (both new)

## Accomplishments

- `.pi/extensions/quality/gates.ts`: `LegStatus` (three arms: `pass` / `fail` with `findings` / `unavailable` with `reason`), `GATE_LEGS`/`LegId` in binding order `typecheck -> lint -> lsp -> anti-pattern`, `GateResult` (`legs`, `blocking`, `elapsedMsByLeg`, `totalMs`, `report`), `probeLspAvailability`, `runAntiPatternLeg`, `ExecRunner`-injected `runTypecheckLeg`/`runLintLeg`, `LINT_GATE_FILES` (the twelve authored structural vitest suites), `runDeterministicGates` (times each leg with `process.hrtime.bigint()`, calls `addQualityCost` exactly once with the summed total), and `shouldRunDesignReview`/`DESIGN_REVIEW_FILE_SPAN`/`DesignReviewSignals` for QUAL-07
- The LSP leg never reads `.pi/settings.json` — it takes the live registered-tool-name list as a plain parameter and requires BOTH `lsp_diagnostics` and `lsp_fix`, naming whichever is missing specifically (the partial-registration case a boolean check would collapse)
- `tests/unit/quality-gates.test.ts`: four `-t`-matchable groups — GATE-01 (the three-state table, including the load-bearing "unavailable never blocks but always appears in report" case paired with "an error-tier anti-pattern finding does block"), QUAL-02 (a transitive local-import-graph resolver proving `gates.ts` never reaches `diagnostics/call-model.ts`, `routing/modes.ts` or `providers/fallback.ts`, plus a measured wall-clock case), QUAL-07 (all-false → false, each signal alone → true, both sides of the `DESIGN_REVIEW_FILE_SPAN` boundary), and a vacuity group
- Three falsifications run and confirmed, each restored to a byte-identical tree before commit: (a) stubbing `probeLspAvailability` to always return `pass` turned 3 GATE-01 cases red; (b) folding `unavailable` into the `blocking` reduction turned the load-bearing case red; (c) adding a `from "../routing/modes.ts"` import to `gates.ts` turned the structural QUAL-02 case red — and the resolver correctly followed it transitively, also reporting `providers/fallback.ts` and `diagnostics/call-model.ts` as reached, since `routing/modes.ts` itself imports both

## Task Commits

1. **Task 1: The three-state gate runner and its four legs** - `a3e25a0` (feat)
2. **Task 2: Prove three states, prove no round trip, and measure the wall clock** - `af4e5ca` (test)

**Plan metadata:** _pending — this commit_

## Files Created/Modified

- `.pi/extensions/quality/gates.ts` - Pure four-leg deterministic gate runner, LSP-availability probe, anti-pattern leg wrapper, injected-runner typecheck/lint legs, and the QUAL-07 design-review predicate
- `tests/unit/quality-gates.test.ts` - Four-group test table (GATE-01, QUAL-02, QUAL-07, vacuity) plus three recorded falsifications

## Decisions Made

- **`ANTI_PATTERN_BUDGET_MS` is 1600ms, not the plan's own illustrative smaller figure.** Five back-to-back measurements of `runAntiPatternLeg` over all 46 tracked `.pi/extensions/*.ts` files gave 383.54, 308.61, 302.13, 299.02, 303.98ms on this machine — the first run costs more (cold `ts.createSourceFile`/vitest-transform warm-up), steady state is ~300ms. Per the plan's own instruction ("set the budget at roughly 4x the measured value… and say that in the `why`"), the budget is ~4x the worst observed figure (390ms), recorded with the exact numbers and the date directly in the test file rather than rounded toward a smaller, more flattering-looking number.
- **`runAntiPatternLeg`'s `LegStatus` only ever reaches `fail` on at least one ERROR-tier finding.** This makes `GateResult.blocking = GATE_LEGS.some(leg => status === "fail")` correct without a separate tier re-check anywhere in `runDeterministicGates` — the constraint "warnings alone never block" is enforced once, at the leg boundary, not re-derived at the stage boundary.
- **`LINT_GATE_FILES` names the twelve suites explicitly** (`chokepoint-lint`, `contributing-boundary`, `jsonl-append-only`, `extension-layout`, `pinning`, `gitignore-policy`, `docs-policy`, `npmrc-policy`, `secret-scan`, `ci-pinning`, `lf-and-shell`, `evasion-corpus`) rather than a `tests/unit/**` glob, so the set this leg actually runs is reviewable in one place and cannot silently grow to include every unit test in the repo (which would make "lint" indistinguishable from "the whole suite").

## Deviations from Plan

None beyond the wall-clock budget figure documented above (itself the plan's own prescribed behavior: measure, then set the budget from the real number, not from a hoped-for one).

## Issues Encountered

- The first falsification attempt for (c) used a bare `import "../routing/modes.ts";` (no `from`), which the structural test's `importSpecifiers` regex (`/from\s+["']([^"']+)["']/g`) correctly does not match — a bare side-effect import genuinely does not use `from`. Corrected to `import type {} from "../routing/modes.ts";`, which does, and the falsification then behaved as expected (and additionally proved the resolver walks the graph transitively, not just one hop).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `runDeterministicGates` is a pure, tested, importable function ready for a future `/quick`-adjacent gate-composition module to wire to a real `cwd`, a real `ExecRunner` (production `child_process.spawnSync`-backed), and a real `registeredToolNames` list sourced from `pi.getActiveTools()`/`pi.getAllTools()` inside a command handler's closure — this plan's scope was building and proving the stage in isolation, per its own PURITY discipline.
- `shouldRunDesignReview` is ready for plan 08-08's advisor/`consult_advisor` mechanism (per `08-RESEARCH.md`'s own note that GATE-09's advisor path is the natural carrier) to call before deciding whether to run a design-level pass; nothing in this plan invokes it yet.
- RB-08-02 (the live LSP leg check, once `@narumitw/pi-lsp` is actually installed) is OUTSTANDING and pre-authorised to remain so — this machine does not install it per the standing autonomous-run rules, and `probeLspAvailability`'s UNAVAILABLE branch is what the mechanism looks like until that check runs for real.
- Full suite green: `npx tsc --noEmit` clean; `npx vitest run tests/unit` — 65 files, 1617 tests, all passing.

---
*Phase: 08-quality-gates-engineering-quality*
*Completed: 2026-08-15*
