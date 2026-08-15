---
phase: 08-quality-gates-engineering-quality
plan: 02
subsystem: testing
tags: [typescript-compiler-api, ast, quality-gates, deterministic-lint, qual-01]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: typescript@5.9.3 as an already-pinned devDependency, in the tool path via `tsc --noEmit`, plus the exactly-six-devDependencies pinning gate that forbids adding a linter
provides:
  - Six pure, syntax-only anti-pattern rule functions (magic-number, literal-special-case, copy-paste, swallowed-exception, shipped-todo, n-plus-one) walking a real ts.SourceFile via ts.forEachChild
  - A runAntiPatternRules(sources) aggregator with tests/fixtures/ exemption and a quality-allow:<rule-id> — <reason> suppression marker, both proven in both directions
  - A dead-rule guard proving every rule fires against an inline fixture, plus a per-rule falsification (stub-to-[] then restore) confirming each rule's own tests turn red when it does
  - A measured, dated ERROR_BUDGET_ON_OWN_SOURCE (22 error-tier findings) recording this rule set's real false-positive rate against six phases of pre-existing .pi/extensions/ source, rather than tuning to zero
affects: [08-03, 08-04, gate-integration plans that build the /quick-callable deterministic gate module]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Syntax-only TS compiler API detector: ts.createSourceFile(..., setParentNodes: true) + ts.forEachChild, never ts.createProgram/getTypeChecker, never regex over source text"
    - "Documented, testable false-positive scope per rule (const-declaration exclusion, NEVER-THROWS marker, N_PLUS_ONE_CALLEES allowlist) rather than tuning a rule to silence on this repo's own style"
    - "WARNING-tier for honestly undecidable rules (literal-special-case, n-plus-one) so they can never fail a build alone"
    - "Path-prefix exemption and line-comment suppression marker proven in BOTH directions on identical text (never one-sided)"

key-files:
  created:
    - .pi/extensions/quality/rules.ts
    - tests/unit/quality-rules.test.ts
  modified: []

key-decisions:
  - "Rewrote this module's own docstrings to reference SHIPPED_TODO_TOKENS by name instead of literally spelling TODO/FIXME/XXX/HACK/hack in prose, after the first Group D sweep run found the module self-flagging its own documentation"
  - "ERROR_BUDGET_ON_OWN_SOURCE is 22, the real measured count against Phase 1-7 .pi/extensions/ source, not a padded or rounded number, and not tuned toward zero"
  - "Fixing the 22 pre-existing findings (17 swallowed-exception, 5 magic-number) is out of this plan's scope — the plan builds and proves the rules; remediating six phases of prior code belongs to a future gate-integration or triage plan"

patterns-established:
  - "Every anti-pattern rule ships a docstring naming its own honest false-positive scope, mirroring safety/shell.ts's WHY-sections"
  - "A combined single fixture that trips every rule at once, asserted via a dead-rule guard that names any rule matching nothing"

requirements-completed: [QUAL-01]

# Metrics
duration: 55min
completed: 2026-08-15
---

# Phase 8 Plan 2: Six Syntax-Only Anti-Pattern Rules Summary

**Six deterministic QUAL-01 rules (magic-number, literal-special-case, copy-paste, swallowed-exception, shipped-todo, n-plus-one) implemented as pure TypeScript-compiler-API syntax walkers, each proven live in both directions and measured — not assumed — against this repository's own real source.**

## Performance

- **Duration:** 55 min
- **Tasks:** 2
- **Files modified:** 2 (both new)

## Accomplishments

- `.pi/extensions/quality/rules.ts`: six exported rule functions plus `runAntiPatternRules`, `RULE_IDS`, `SCAN_EXEMPT_PREFIXES`, `SUPPRESSION_MARKER` — every rule walks `ts.createSourceFile`/`ts.forEachChild`, never regex, and each documents its own honest false-positive scope (const-declaration exclusion for `magic-number`, a `NEVER THROWS` marker convention for `swallowed-exception`, a caller-tunable callee allowlist for `n-plus-one`)
- `literal-special-case` and `n-plus-one` ship at WARNING tier with their undecidability stated in their own docstrings, and can never fail a build on their own
- `tests/unit/quality-rules.test.ts`: 19 tests across Group A (6 per-rule positives), Group B (4 negatives drawn from this repo's own deliberate style), Group C (one combined fixture trips all six, with a dead-rule guard), Group D (a false-positive sweep over every tracked `.pi/extensions/*.ts` file with a measured, dated error budget), plus both directions of the `tests/fixtures/` exemption, both directions of the `quality-allow:` suppression marker, and a T-08-04 parse-safety case
- Per-rule falsification exercise run and confirmed: stubbing each rule's body to `return [];` (one at a time, committed state restored after each) turned exactly that rule's Group A positive case and the Group C dead-rule guard red — for `shipped-todo` it also turned the exemption and bare-marker-suppression cases red, since those fixtures happen to route through that rule

## Task Commits

1. **Task 1: The six rules, as syntax-only detectors over a real AST** - `fc1f56e` (feat)
2. **Task 2: Two-directional rule table plus a false-positive sweep over this repo's real files** - `4eaa885` (test)

**Plan metadata:** _pending — this commit_

## Files Created/Modified

- `.pi/extensions/quality/rules.ts` - Six pure anti-pattern rules over `ts.SourceFile`, an aggregator, exemption and suppression mechanisms
- `tests/unit/quality-rules.test.ts` - Four-group test table plus exemption/suppression/parse-safety cases

## Decisions Made

- **Rewrote the module's own docstrings to name-reference `SHIPPED_TODO_TOKENS` rather than spell the four literal task-marker tokens in comment prose.** The first Group D sweep run measured 4 `shipped-todo` findings inside `rules.ts` itself, because its own documentation explained the rule by literally writing the words it detects (in `TODO`/`FIXME`/`HACK`-shaped comments). This was treated as a genuine finding on real source per `08-RESEARCH.md` Pitfall 2 ("if a finding on real source is genuine, fix the source and say so") and fixed by rewording — not by narrowing the rule or widening `SCAN_EXEMPT_PREFIXES` to cover this module.
- **`ERROR_BUDGET_ON_OWN_SOURCE = 22` is the real measured count**, run against every tracked `.pi/extensions/*.ts` file (Phase 1-7 code): 17 `swallowed-exception`, 5 `magic-number`, 0 `shipped-todo` (after the fix above), 0 `copy-paste`. This is recorded as a ratchet, not tuned toward zero — a future rise means either a genuine new anti-pattern (fix the source) or a rule needing narrowing (record the shape that forced it).
- **Fixing the 22 pre-existing findings is explicitly out of this plan's scope.** `08-02-PLAN.md`'s job is to build and prove the six rules; the findings are real signal about six phases of prior code (mostly undocumented `catch` blocks that may or may not be deliberate NEVER-THROWS shapes, plus `todo.ts`'s repeated `5`-item truncation literal), and triaging them belongs to whichever future plan wires this module into the callable `/quick`-adjacent gate.

## Deviations from Plan

None beyond the self-referential `shipped-todo` docstring fix documented above, which is itself the plan's own prescribed Group D behavior (measure, and fix genuine findings on real source) rather than an unplanned deviation.

## Issues Encountered

- The first `typescript` compiler-API import attempt considered `import ts from "typescript"` (default import), which fails under this repo's `tsconfig.json` (`esModuleInterop` unset, `moduleResolution: "bundler"`) because the package's `.d.ts` uses `export = ts`. Resolved by using `import * as ts from "typescript";`, the standard namespace-import form for `export =` modules, which typechecks cleanly and resolves correctly under vitest's esbuild-based transform.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `runAntiPatternRules` is a pure, tested, importable function ready for a future plan to wire into a `/quick`-callable deterministic gate module (per `08-CONTEXT.md` decision 8: gate logic lives in a module `/quick` calls, never inlined).
- Not yet wired into any gate, workflow, or JSONL cost record — this plan's scope was building and proving the six rules in isolation (QUAL-01 only). GATE-01's full four-leg deterministic stage (typecheck + lint + LSP + these six rules, feeding errors back before any model review) and QUAL-02's wall-clock measurement remain for a later plan in this phase.
- No blockers. Full suite green: 1819 tests / 99 files, `tsc --noEmit` clean.

---
*Phase: 08-quality-gates-engineering-quality*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `.pi/extensions/quality/rules.ts`
- FOUND: `tests/unit/quality-rules.test.ts`
- FOUND commit `fc1f56e` (Task 1)
- FOUND commit `4eaa885` (Task 2)
