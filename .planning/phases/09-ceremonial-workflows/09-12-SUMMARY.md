---
phase: 09-ceremonial-workflows
plan: 12
subsystem: quality
tags: [quality-gates, workflows, gate-depth, selector, vitest]

# Dependency graph
requires:
  - phase: 08-quality-levers
    provides: runDeterministicGates, shouldRunDesignReview (gates.ts), runReview/validateReview
      (reviewer.ts/review-schema.ts), runBoundedReviewLoop (verdict.ts), scoreCalibration
      (calibration.ts) -- the four mechanisms this plan dials, none rebuilt
provides:
  - gateDepthFor(workflow) -- a pure selector returning which of the four Phase 8 quality
    mechanisms run for a given workflow
  - GATE_DEPTH_BY_WORKFLOW -- the exhaustive, frozen, compile-checked table gateDepthFor reads
  - QUALITY_MECHANISMS / MechanismId -- the named, four-entry mechanism enumeration
  - WORKFLOW_IDS / WorkflowId -- the single source of the five workflow names
affects: [09-13, 09-15]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gate-depth-as-data: a workflow's quality scrutiny is a SET of mechanism ids
      (GateDepth.mechanisms), never a numeric level -- a level would make 'which mechanisms'
      implicit and untestable"
    - "Record<WorkflowId, ...> (never Partial<...>) makes a missing workflow row a tsc
      compile error, demonstrated live rather than merely asserted"
    - "Both-directions equality testing over containment: toEqual/toContain-not, never
      toContain-only, so a selector that always returns everything cannot pass"

key-files:
  created:
    - tests/unit/gate-depth-selector.test.ts
  modified:
    - .pi/extensions/quality/gates.ts
    - tests/unit/workflow-budgets.test.ts
    - .planning/phases/09-ceremonial-workflows/deferred-items.md

key-decisions:
  - "gateDepthFor lives in gates.ts, beside shouldRunDesignReview, never as a branch inside
    /quick's own workflows/index.ts -- git diff --stat -- .pi/extensions/workflows/ stayed
    empty for the whole plan"
  - "No runsMechanism() convenience export added -- nothing in this plan's own scope consumes
    it; plans 09-13/09-15 add it if and when they need it"
  - "The AGREEMENT WITH SHIPPED BEHAVIOUR test is deliberately structural (GATE_LEGS'
    four legs are all deterministic-class; runQuickGateStage's own source never mentions
    runReview/validateReview/runBoundedReviewLoop/scoreCalibration), not a live
    runQuickGateStage() call -- a live call needs a trusted cwd with real node_modules,
    which quick-workflow.test.ts and quality-gate-order.test.ts already exercise; duplicating
    it here would not add honest evidence"

requirements-completed: [QUAL-08]

# Metrics
duration: 35min
completed: 2026-08-16
---

# Phase 09 Plan 12: Gate-Depth Selector Summary

**A pure `gateDepthFor(workflow)` selector in `gates.ts` dials `/quick` to deterministic-only and every ceremonial workflow to all four Phase 8 quality mechanisms, proved by equality in both directions and falsified three ways by inversion.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-08-16T00:35:00+08:00 (approx.)
- **Completed:** 2026-08-16T00:46:07+08:00
- **Tasks:** 2/2 completed
- **Files modified:** 3 (1 created, 2 modified) + 1 docs file (deferred-items.md)

## Accomplishments

- `gateDepthFor("quick")` returns exactly `{ mechanisms: ["deterministic"] }`; every ceremonial
  workflow (`grill`, `plan`, `execute`, `review`) returns all four mechanism ids -- proved by
  array **equality**, never `toContain`, so a constant selector cannot pass.
- `GATE_DEPTH_BY_WORKFLOW` is typed `Record<WorkflowId, readonly MechanismId[]>` (not
  `Partial<...>`), and a missing workflow row is a **compile error**, demonstrated live (see
  below), not merely asserted in a comment.
- `.pi/extensions/workflows/index.ts` (`/quick`'s own command file) is byte-for-byte unchanged
  -- `git diff --stat -- .pi/extensions/workflows/` was empty at every check throughout this
  plan.
- Three falsifications, each committed-before-mutated and restored, prove the test suite is not
  vacuous (verbatim RED output below).

## Task Commits

Each task was committed atomically:

1. **Task 1: gateDepthFor -- a pure selector beside shouldRunDesignReview** - `fe53c4a` (feat)
2. **Task 2: gate-depth-selector.test.ts -- both directions, falsified by inversion** - `53518a9` (test)

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified

- `.pi/extensions/quality/gates.ts` - added `QUALITY_MECHANISMS`, `MechanismId`, `WORKFLOW_IDS`,
  `WorkflowId`, `GateDepth`, `GATE_DEPTH_BY_WORKFLOW`, `gateDepthFor` (426 -> 486 raw lines)
- `tests/unit/workflow-budgets.test.ts` - raised `.pi/extensions/quality`'s `DIRECTORY_BUDGETS`
  row 3750 -> 3810 (re-measured 3,808 raw lines across the same 8 files), with `why` naming this
  plan, QUAL-08, the previous figure and the re-measured figure
- `tests/unit/gate-depth-selector.test.ts` (new) - the both-directions, falsified-by-inversion
  test suite, 19 tests across vacuity / direction one-four / exhaustiveness / agreement-with-
  shipped-behaviour / purity
- `.planning/phases/09-ceremonial-workflows/deferred-items.md` - logged a pre-existing,
  out-of-scope full-suite failure discovered while verifying this plan (see Issues Encountered)

## Decisions Made

- Named `runReview` (`reviewer.ts:373`) + `validateReview` (`review-schema.ts:319`) together as
  the `model-review` mechanism, `runBoundedReviewLoop` (`verdict.ts:488`) as `refute-or-promote`,
  and `scoreCalibration` (`calibration.ts:220`) as `calibration` -- these are the exact function
  names read from source per the plan's own instruction to name mechanisms from the code, not
  invent a fifth or rename one.
- `GATE_DEPTH_BY_WORKFLOW`'s arrays are explicitly `Object.freeze`d (not merely typed
  `readonly`) so the purity tests can assert mutation *throws* at runtime, not just that TypeScript
  disallows it at compile time -- `readonly` alone is erased at runtime and would let a caller with
  a type-cast silently corrupt the shared table.
- The "AGREEMENT WITH SHIPPED BEHAVIOUR" test asserts structurally (`GATE_LEGS`' four legs are all
  deterministic-class; `runQuickGateStage`'s own function source contains none of
  `runReview|validateReview|runBoundedReviewLoop|scoreCalibration`) rather than driving a live
  `runQuickGateStage()` call, per the plan's own instruction not to fabricate an assertion that
  needs credentials/trust/`node_modules` this test file doesn't have -- that stronger binding
  already exists in `quick-workflow.test.ts` / `quality-gate-order.test.ts`.

## Deviations from Plan

None - plan executed exactly as written. `runsMechanism` was explicitly **not** added, per the
plan's own "omit it" instruction, since no caller in this plan's scope needs it.

## Falsifications (verbatim, all three restored before their respective commits)

**(a) Inverted the table** (`quick` -> all four; `grill`/`plan`/`execute`/`review` -> deterministic
only). Confirmed BOTH direction one and direction three turned RED (plus, as an expected side
effect, direction two and the purity mutation-check, since `quick` no longer holds
`["deterministic"]`):

```
FAIL  tests/unit/gate-depth-selector.test.ts > DIRECTION ONE -- /quick is deterministic-only, by equality > gateDepthFor("quick").mechanisms EQUALS ["deterministic"] exactly
AssertionError: expected [ 'deterministic', …(3) ] to deeply equal [ 'deterministic' ]

FAIL  tests/unit/gate-depth-selector.test.ts > DIRECTION THREE -- every ceremonial workflow runs all four, by equality > gateDepthFor(grill).mechanisms EQUALS QUALITY_MECHANISMS' full id list
AssertionError: expected [ 'deterministic' ] to deeply equal [ 'deterministic', …(3) ]
```
(plan/execute/review repeated the same direction-three failure; 9/19 tests red in total)

**(b) Gave `quick` a second mechanism** (`["deterministic", "model-review"]`). Direction two
turned RED, naming the leaked mechanism:

```
FAIL  tests/unit/gate-depth-selector.test.ts > DIRECTION TWO -- /quick does NOT leak any ceremonial mechanism > does not contain model-review
AssertionError: expected [ 'deterministic', 'model-review' ] to not include 'model-review'
```
(direction one and the purity mutation-check also turned red, as expected, since `quick` no
longer equals `["deterministic"]`; 3/19 tests red in total)

**(c) Added a fifth, invented mechanism id** (`"invented-mechanism"`) to `grill`'s row via a type
cast, bypassing the type system to prove the *runtime* check catches it independently. Direction
four turned RED on both its assertions, naming the invented id:

```
FAIL  tests/unit/gate-depth-selector.test.ts > DIRECTION FOUR -- the union over all workflows equals QUALITY_MECHANISMS, no invented ids > the union of every workflow's mechanism set equals QUALITY_MECHANISMS' id list
AssertionError: expected [ Array(5) ] to deeply equal [ Array(4) ]

FAIL  tests/unit/gate-depth-selector.test.ts > DIRECTION FOUR -- the union over all workflows equals QUALITY_MECHANISMS, no invented ids > no workflow's mechanism set contains an id outside QUALITY_MECHANISMS
AssertionError: grill names unknown mechanism id invented-mechanism: expected false to be true // Object.is equality
```
(direction three's `grill` case also turned red as an expected side effect; 3/19 tests red)

All three mutations were made, run, and reverted via a saved-and-restored copy of `gates.ts`
(never `git checkout --`, per this plan's own falsification-must-be-committed-first discipline
applied to the already-committed Task 1 state) -- `git status --short` / `git diff --stat` showed
zero residual diff after each restore, confirmed before proceeding to the next falsification.

## Compile-time exhaustiveness (Task 1 acceptance criterion)

Deleted the `execute` key from `GATE_DEPTH_BY_WORKFLOW`'s object literal and ran `npx tsc --noEmit`:

```
.pi/extensions/quality/gates.ts(469,14): error TS2741: Property 'execute' is missing in type
'Readonly<{ quick: readonly ("deterministic" | "model-review" | "refute-or-promote" |
"calibration")[]; grill: readonly (...)[]; plan: readonly (...)[]; review: readonly
(...)[]; }>' but required in type 'Readonly<Record<"quick" | "grill" | "plan" | "execute" |
"review", readonly ("deterministic" | "model-review" | "refute-or-promote" | "calibration")[]>>'.
```

Restored; `npx tsc --noEmit` confirmed clean again, and `git status --short` showed zero residual
diff.

## Issues Encountered

Running the full suite (`npx vitest run`) at the end of Task 2 surfaced one pre-existing failure
unrelated to this plan: `tests/unit/subagent-agents-config.test.ts`'s "present-but-undeclared"
completeness check fails because `.pi/agents/executor-handoff.md` (added by plan 09-11, commit
`5a5db3a`) names no role in `AGENT_NAME_BY_ROLE` and is not in `UNROUTED_AGENT_ALLOWLIST`.
Confirmed pre-existing via `git log --oneline -3 -- .pi/agents/executor-handoff.md
tests/unit/subagent-agents-config.test.ts` (last touched by plan 09-11, before this plan started)
and `git status --short`/`git diff --stat` showing this plan never touched either file. Logged to
`deferred-items.md` under this plan's own scope-boundary rule rather than fixed -- fixing it would
mean either wiring a role for `/execute`'s subagent handoff (a later plan's job, FLOW-09's own
follow-on) or adding a reasoned `UNROUTED_AGENT_ALLOWLIST` entry, neither of which is this plan's
QUAL-08 selector work. Not re-run hoping it resolves.

Also noted for honesty: Task 1's own acceptance-criterion grep
(`git diff -- .pi/extensions/quality/gates.ts | grep -nE "await |readFile|spawn|exec"`) matches
three lines, but all three are the substring `exec` inside the workflow id **`execute`**
(`WORKFLOW_IDS`, a doc comment, and the `execute: ALL_MECHANISMS` table row) -- there is no added
`exec(...)`/`await`/`readFile`/`spawn` call. Recorded here rather than silently narrowing the grep,
since the acceptance criterion's own wording is what was run verbatim.

## User Setup Required

None - no external service configuration required.

## Verification Evidence

```
$ npx tsc --noEmit
(clean, no output)

$ npx vitest run tests/unit/gate-depth-selector.test.ts tests/unit/quality-gates.test.ts tests/unit/workflow-budgets.test.ts
 Test Files  3 passed (3)
      Tests  142 passed (142)

$ npx vitest run
 Test Files  1 failed | 116 passed (117)
      Tests  1 failed | 2221 passed (2222)
```

The one failing test (`subagent-agents-config.test.ts`) is the pre-existing, out-of-scope issue
documented above and in `deferred-items.md` -- confirmed present before this plan's first commit
and untouched by any file this plan modified.

## Next Phase Readiness

`gateDepthFor` and `GATE_DEPTH_BY_WORKFLOW` are exported from `.pi/extensions/quality/gates.ts`
and ready for plans 09-13 and 09-15 to wire into their respective ceremonial workflows' gate
stages. The one pre-existing full-suite failure (subagent role routing for `executor-handoff`) is
a blocker for a *fully green* suite, not for this plan's own QUAL-08 deliverable, and is tracked
in `deferred-items.md` for whichever plan owns `/execute`'s subagent wiring.

---
*Phase: 09-ceremonial-workflows*
*Completed: 2026-08-16*

## Self-Check: PASSED

All created/modified files verified present on disk; both task commit hashes (`fe53c4a`, `53518a9`) verified present in `git log --oneline --all`. No missing items.
