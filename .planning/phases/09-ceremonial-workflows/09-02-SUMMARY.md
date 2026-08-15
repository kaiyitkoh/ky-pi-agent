---
phase: 09-ceremonial-workflows
plan: 02
subsystem: testing
tags: [vitest, static-analysis, ratchet, line-budget, resource-edges]

# Dependency graph
requires:
  - phase: 08-quality-review
    provides: tests/unit/workflow-budgets.test.ts's existing WORKFLOW_BUDGETS/DIRECTORY_BUDGETS/importedSubsystemDirs machinery, extended (not rebuilt) here
provides:
  - "RESOURCE_EDGES registry + resourceEdgeCandidates() scanner: closes the .pi/agents/*.md and non-.md skill/prompt-asset holes in the sideways-ratchet"
  - "WORKFLOW_TEXT_BUDGETS + FEATURES_CEILINGS: a frozen, FEATURES.md-sourced per-workflow readable-text ceiling that cannot be raised to absorb growth"
  - "corrected stale '96 raw lines' narrative on workflows/index.ts's WORKFLOW_BUDGETS entry (true figure: 99, one line of headroom)"
affects: [09-08-grill, 09-10-plan, 09-13-execute, 09-15-review, 09-16-completeness-gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Test-side-only static registry + completeness scanner (no production module) -- same precedent as importedSubsystemDirs"
    - "Comment-stripping before a path-literal regex scan, to distinguish a genuine code reference from a JSDoc citation of a sibling file"
    - "A FROZEN ceiling table (FEATURES_CEILINGS) asserted with budget === ceiling, distinct from every other registry in the file which asserts budget === Math.ceil(actual/10)*10"

key-files:
  created: []
  modified:
    - tests/unit/workflow-budgets.test.ts

key-decisions:
  - "RESOURCE_EDGES scans three genuinely-open edges only (.pi/agents/*.md, non-.md skill/prompt assets, .pi/-shaped path literals in real code) -- the .md skill/prompt-body half was already closed by discoverWorkflowFiles(); re-covering it would have been Pitfall 3"
  - "Path-literal scanning strips comments first -- an empirical run without stripping produced 9 false positives, all JSDoc citations of a sibling file's path (e.g. 'see .pi/lib/jsonl.ts's docstring'), never a genuine resource load"
  - ".pi/agents/planner.md and .pi/agents/reviewer.md are declared to quality/reviewer.ts as their honest owner, even though nothing loads either file at runtime today (RB-08-03, OUTSTANDING) -- an unreachable file still needs a budget"
  - "WORKFLOW_TEXT_BUDGETS' ceiling is a spec number (FEATURES_CEILINGS, sourced from FEATURES.md Part 2), not a rounded measurement -- it may not move to absorb growth, unlike every other registry in this file"
  - "Only the 'quick' row exists in WORKFLOW_TEXT_BUDGETS today -- the four ceremonial rows are added by the plans that create their command files (09-08/10/13/15), not as placeholders; the 'every FEATURES_CEILINGS name has a row' completeness gate is explicitly handed off to plan 09-16"

patterns-established:
  - "Pattern: a frozen spec-sourced ceiling (budget === CONST[name]) is a DIFFERENT assertion shape from a ratchet (budget === Math.ceil(actual/10)*10) -- do not conflate the two in future registries"

requirements-completed: ["FLOW-11"]

# Metrics
duration: 20min
completed: 2026-08-15
---

# Phase 9 Plan 2: Sideways-Ratchet Closure (RESOURCE_EDGES + WORKFLOW_TEXT_BUDGETS) Summary

**Closed the two genuinely-open holes in the workflow line-budget ratchet (`.pi/agents/*.md` and non-`.md` skill/prompt assets via a new `RESOURCE_EDGES` registry) and added a frozen, FEATURES.md-sourced per-workflow text ceiling (`WORKFLOW_TEXT_BUDGETS`/`FEATURES_CEILINGS`) that cannot be raised to absorb growth.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2
- **Files modified:** 1 (`tests/unit/workflow-budgets.test.ts`)

## Accomplishments
- `RESOURCE_EDGES` + `resourceEdgeCandidates()`: a completeness scanner over the three genuinely-invisible `.pi/` edges (agent files, non-`.md` skill/prompt assets, real-code path literals), both directions (present-but-undeclared, declared-but-absent), plus its own budget/rounding assertions.
- `.pi/agents/planner.md` and `.pi/agents/reviewer.md` — the two files that were invisible to every budget in this repository before this plan — are now declared and budgeted (109 raw lines, budget 110).
- `WORKFLOW_TEXT_BUDGETS` + `FEATURES_CEILINGS`: a frozen, source-cited ceiling table (`/grill`<=250, `/plan`<=200, `/execute`<=250, `/review`<=250, `/quick`<=100), with the ceiling asserted `toBe` the spec number, never a rounded measurement.
- Corrected the stale "measured 96" narrative on `workflows/index.ts`'s existing `WORKFLOW_BUDGETS` entry — true figure is 99 (confirmed with `countRawLines`), one line of headroom, not four (09-RESEARCH.md Pitfall 2).
- Added a claimed-bodies completeness check: every discovered `.pi/skills/**.md`/`.pi/prompts/**.md` file must be claimed by exactly one `WORKFLOW_TEXT_BUDGETS` row (vacuous today; the first real exercise is 09-08).
- Test count grew from the pre-plan baseline of 64 to 78 (both directions of both new registries, plus vacuity guards).

## Task Commits

1. **Task 1: RESOURCE_EDGES registry + non-import resource-edge completeness scanner** - `94de315` (test)
2. **Task 2: WORKFLOW_TEXT_BUDGETS — the per-workflow readable-text ceiling** - `50e86a5` (test)

_Both tasks modify the same single test file per the plan's `files_modified`; no separate plan-metadata commit was required beyond this SUMMARY's own commit._

## Files Created/Modified
- `tests/unit/workflow-budgets.test.ts` - Added `RESOURCE_EDGES`/`resourceEdgeCandidates()`/`filesUnion()`/`stripComments()`/`PI_PATH_LITERAL` (Task 1) and `WORKFLOW_TEXT_BUDGETS`/`FEATURES_CEILINGS` (Task 2), plus two new `describe` blocks, two new module-docstring decisions (D-12, D-13), and a corrected `why` narrative on the pre-existing `workflows/index.ts` `WORKFLOW_BUDGETS` entry.

## Decisions Made
- See `key-decisions` in frontmatter above. The most consequential: the path-literal scanner (edge iii) required comment-stripping that was not spelled out in the plan text — an unstripped first pass produced 9 false positives, all JSDoc cross-references to a sibling module's path, never a genuine resource load. Documented in `stripComments`'s own docstring with the exact false-positive set that motivated it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added comment-stripping before the `.pi/`-path-literal regex scan**
- **Found during:** Task 1, first `npx vitest run` after implementing `resourceEdgeCandidates()`
- **Issue:** The plan's `PI_PATH_LITERAL` regex, applied to raw source, matched every JSDoc citation of a sibling module's path (e.g. `checkpoint/store.ts:9`'s "`.pi/lib/jsonl.ts` is a real, hardened writer..."), producing 9 false-positive candidates (`.pi/extensions/qoder/index.ts`, `.pi/lib/jsonl.ts`, `.pi/extensions/plan-mode/`, etc.) that would have required declaring every doc cross-reference in `RESOURCE_EDGES` — defeating the registry's purpose and guaranteeing constant unrelated churn.
- **Fix:** Added `stripComments()` (best-effort block-comment/line-comment removal, documented as not a full parser) applied to source text before the `PI_PATH_LITERAL` scan. Re-run confirmed all 9 false positives disappeared with zero loss of real coverage (the `.pi/agents/*.md` candidates, which are filesystem-discovered, not literal-discovered, were unaffected).
- **Files modified:** tests/unit/workflow-budgets.test.ts
- **Verification:** `npx vitest run tests/unit/workflow-budgets.test.ts` green (0 offenders) after the fix; Falsification 3 (below) confirms the mechanism still catches a genuine undeclared literal in real code.
- **Committed in:** `94de315` (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary correctness fix — without it the scanner would have been unusable (constant false-positive noise on ordinary documentation prose). No scope creep; the fix stays entirely inside the one file the plan already scoped.

## Issues Encountered
None beyond the deviation above.

## Falsifications (verbatim RED output, all reverted)

### Falsification 1 — present-but-undeclared: planted `.pi/agents/__falsify.md` (5 lines)
```
FAIL  tests/unit/workflow-budgets.test.ts > Item 1 (D-12) -- RESOURCE_EDGES: the non-import resource-edge closure > present-but-undeclared: every resource-edge candidate is named in some RESOURCE_EDGES row
AssertionError: a .pi/ path reachable only by name (not a static import, not a discovered .md skill/prompt body) and not declared in RESOURCE_EDGES is invisible to every budget in this repository -- declare each of these in a RESOURCE_EDGES row with a budget and a reason: expected [ '.pi/agents/__falsify.md' ] to deeply equal []
```
Deleted; suite returned to 71/71 green.

### Falsification 2 — non-`.md` asset: planted `.pi/skills/__falsify/helper.sh`
```
FAIL  tests/unit/workflow-budgets.test.ts > Item 1 (D-12) -- RESOURCE_EDGES: the non-import resource-edge closure > present-but-undeclared: every resource-edge candidate is named in some RESOURCE_EDGES row
AssertionError: ...: expected [ '.pi/skills/__falsify/helper.sh' ] to deeply equal []
```
Deleted; suite returned to 71/71 green.

### Falsification 3 — path literal in real (non-comment) code: added `const __RESOURCE_EDGE_FALSIFICATION_PROBE__ = ".pi/extensions/quality/index.ts";` to `workflows/index.ts` (a genuinely undeclared, existing file, referenced as real code, not a comment)
```
FAIL  tests/unit/workflow-budgets.test.ts > Item 1 (D-12) -- RESOURCE_EDGES: the non-import resource-edge closure > present-but-undeclared: every resource-edge candidate is named in some RESOURCE_EDGES row
AssertionError: ...: expected [ '.pi/extensions/quality/index.ts' ] to deeply equal []
```
Adding this one line also pushed `workflows/index.ts` from 99 to 100 raw lines, which crossed the `.pi/extensions/workflows` `DIRECTORY_BUDGETS` ratchet (480 -> 481) — a direct, incidental demonstration of 09-RESEARCH.md Pitfall 2's "one line of headroom, not four" finding:
```
FAIL  ... '.pi/extensions/workflows''s WHOLE .ts/.js total stays within its declared directory budget
AssertionError: .pi/extensions/workflows totals 481 raw lines across 2 files, over its directory budget of 480 (...): expected 481 to be less than or equal to 480
FAIL  ... '.pi/extensions/workflows''s budget IS the measured total rounded up to the next ten
AssertionError: .pi/extensions/workflows totals 481 raw lines across 2 files (evidence.ts 381, index.ts 100), so its budget must be 490. It is declared as 480. ...: expected 480 to be 490
```
Reverted; suite returned to 71/71 green (confirmed via `git diff --stat` showing zero diff on `workflows/index.ts`).

### Falsification 4 — RESOURCE_EDGES rounding is `toBe`: changed the reviewer-agents row's budget from 110 to 120 (ten over the rounded figure)
```
FAIL  tests/unit/workflow-budgets.test.ts > Item 1 (D-12) -- RESOURCE_EDGES: the non-import resource-edge closure > '.pi/extensions/quality/reviewer.ts (d…''s budget IS the measured total rounded up to the next ten
AssertionError: .pi/extensions/quality/reviewer.ts (declared owner -- see this entry's own why)'s declared paths total 109 raw lines, so its budget must be 110 -- the next multiple of ten. It is declared as 120. ...: expected 120 to be 110
```
Restored to 110; suite returned to 71/71 green.

### Falsification 5 — `WORKFLOW_TEXT_BUDGETS` ceiling may not move: changed `quick`'s budget from 100 to 110
```
FAIL  tests/unit/workflow-budgets.test.ts > Item 1(d) (D-13) -- WORKFLOW_TEXT_BUDGETS: the per-workflow readable-text ceiling > 'quick''s budget IS the FEATURES.md ceiling -- it may not move to absorb growth
AssertionError: quick's WORKFLOW_TEXT_BUDGETS budget is 110 but FEATURES_CEILINGS['quick'] is 100 -- unlike WORKFLOW_BUDGETS/DIRECTORY_BUDGETS, this ceiling is not a rounded measurement; it is the spec number from FEATURES.md Part 2, and it MAY NOT MOVE. Over budget means cut text, not raise the number: expected 110 to be 100
```
Restored to 100; suite returned to 78/78 green.

### Falsification 6 — unclaimed skill body: planted a 200-line `.pi/skills/__falsify/SKILL.md`
```
FAIL  tests/unit/workflow-budgets.test.ts > FLOW-11 -- registry completeness, both directions > present-but-undeclared: every discovered workflow file has a budget entry
AssertionError: ...: expected [ '.pi/skills/__falsify/SKILL.md' ] to deeply equal []

FAIL  tests/unit/workflow-budgets.test.ts > Item 1(d) (D-13) -- WORKFLOW_TEXT_BUDGETS: the per-workflow readable-text ceiling > claimed-bodies completeness: every discovered skill/prompt .md file is claimed by exactly one WORKFLOW_TEXT_BUDGETS row
AssertionError: .pi/skills/__falsify/SKILL.md is a discovered skill/prompt body claimed by 0 WORKFLOW_TEXT_BUDGETS rows (must be exactly 1) -- a skill body no workflow claims is text the model reads that nothing bounds: expected +0 to be 1
```
Deleted; suite returned to 78/78 green.

### Falsification 7 — `commandFile` that does not register the claimed command: pointed `quick`'s `commandFile` at `.pi/extensions/workflows/evidence.ts` (exists, does not spell `registerCommand("quick"`)
```
FAIL  tests/unit/workflow-budgets.test.ts > Item 1(d) (D-13) -- WORKFLOW_TEXT_BUDGETS: the per-workflow readable-text ceiling > 'quick''s commandFile exists and registers the command by name
AssertionError: .pi/extensions/workflows/evidence.ts does not spell registerCommand("quick" -- WORKFLOW_TEXT_BUDGETS' commandFile must actually register the command it claims to budget: expected false to be true

FAIL  ... 'quick''s command file + declared bodies stay within its budget
AssertionError: quick's readable text is 381 raw lines (.pi/extensions/workflows/evidence.ts 381), over its budget of 100 (...): expected 381 to be less than or equal to 100
```
Restored `commandFile` to `.pi/extensions/workflows/index.ts`; suite returned to 78/78 green.

### The scanner does NOT re-flag `.md` skill/prompt bodies (Pitfall 3 proof)
With all falsification fixtures deleted, `resourceEdgeCandidates()` contains no path ending in `.md` other than under `.pi/agents/` — asserted directly by the "does not re-flag a .md skill/prompt body" test, which passed on every run above (it is a standing assertion in the suite, not a one-off falsification).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `RESOURCE_EDGES`, `resourceEdgeCandidates()`, `WORKFLOW_TEXT_BUDGETS` and `FEATURES_CEILINGS` are all in place before any ceremonial workflow file exists — the load-bearing precondition this plan's objective named.
- Plans 09-08 (`/grill`), 09-10 (`/plan`), 09-13 (`/execute`) and 09-15 (`/review`) must each add: a `WORKFLOW_BUDGETS` row, a `DIRECTORY_BUDGETS` row (new subsystem directory), and a `WORKFLOW_TEXT_BUDGETS` row (budget fixed at the corresponding `FEATURES_CEILINGS` value — 250/200/250/250, never a different number) in the same commit that creates their command file.
- Plan 09-16 must add the "every `FEATURES_CEILINGS` name has a `WORKFLOW_TEXT_BUDGETS` row" completeness assertion, deliberately deferred here per the hand-off comment in the registry's own docstring.
- No blockers.

---
*Phase: 09-ceremonial-workflows*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `tests/unit/workflow-budgets.test.ts`
- FOUND: commit `94de315` (Task 1)
- FOUND: commit `50e86a5` (Task 2)
- `RESOURCE_EDGES` appears 14 times in the file (declaration + scanner references + describe/it text)
- `WORKFLOW_TEXT_BUDGETS` appears 15 times in the file
- `npx vitest run tests/unit/workflow-budgets.test.ts`: 78/78 passed
- `npx vitest run` (full suite): 108 files / 2038 tests passed
- `npx tsc --noEmit`: clean
