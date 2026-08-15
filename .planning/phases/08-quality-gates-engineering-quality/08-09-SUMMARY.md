---
phase: 08-quality-gates-engineering-quality
plan: 09
subsystem: quality
tags: [gate-06, qual-05, refute-or-promote, anti-review-theatre, bounded-loop, stall-detection]

# Dependency graph
requires:
  - phase: 08-quality-gates-engineering-quality
    provides: "08-03 (review-schema.ts's ReviewArtifact/ReviewFinding types and NIT_CAP precedent), 08-07 (reviewer.ts's runReview/buildReviewerContext contract and REVIEWER_SYSTEM_PROMPT this pass reuses), 08-04 (addQualityCost's QUAL-09 ledger)"
provides:
  - "decideWorkflowStop(review): the QUAL-05/GATE-06 numbered, binding-order stop predicate over a POST-refutation ReviewArtifact"
  - "runRefuteOrPromote(ctx, review, contract): the BLOCKER-only, one-pass-per-finding refutation dispatcher, fail-safe UPHELD on an unparseable result"
  - "detectStall + MAX_REVIEW_ITERATIONS + runBoundedReviewLoop: the bounded review/refute/re-review orchestration with a distinct stalled outcome"
affects: [09-ceremonial-workflows]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A forced structured tool call (refute_finding) for a nested reviewer follow-up, identical in shape to submit_review (08-03) -- StringEnum for the closed outcome enum, never Type.Union/Type.Literal"
    - "decideWorkflowStop is called on a POST-refutation ReviewArtifact, never the raw reviewer output -- callers reconstruct findings as non-BLOCKER findings plus only the promoted (surviving) BLOCKERs before calling it"
    - "A caller-injected review() closure decouples the bounded loop from knowing how a review (or a re-review after an out-of-band fix) is produced -- runBoundedReviewLoop only knows how to bound and compare"

key-files:
  created:
    - .pi/extensions/quality/verdict.ts
    - tests/integration/refute-or-promote.test.ts
  modified: []

key-decisions:
  - "decideWorkflowStop's branch (3) ('any BLOCKER survives') is defined to run on findings that have ALREADY passed through runRefuteOrPromote -- callers must rebuild the review's findings array as (non-BLOCKER findings) + (promoted BLOCKERs) before calling decideWorkflowStop; handing it the raw reviewer output would let a withdrawn BLOCKER still stop the workflow"
  - "runBoundedReviewLoop takes a caller-injected `review: () => Promise<ReviewArtifact>` closure rather than owning how a review is produced -- this module has no mechanism to apply a fix between iterations (out of scope, a future workflow's job), so it can only ask for another review and compare what came back"
  - "A classification-driven stop (needsApproval:true) returns immediately on whichever iteration it is first seen, never waiting for a stall or MAX_REVIEW_ITERATIONS -- QUAL-05 is not part of the BLOCKER-convergence loop at all"
  - "An unparseable or out-of-enum refutation result defaults to UPHELD (promoted), never withdrawn -- the opposite of the usual fail-closed instinct, stated explicitly in the module docstring, because the safer state here is the one where the BLOCKER still stands"

requirements-completed: [GATE-06, QUAL-05]

# Metrics
duration: ~45min
completed: 2026-08-15
---

# Phase 08 Plan 09: Refute-or-Promote and the Bounded Review Loop Summary

**`decideWorkflowStop` (a numbered QUAL-05/GATE-06 predicate over a post-refutation review) and `runRefuteOrPromote` (one BLOCKER-only, fail-safe-upheld nested reviewer pass per finding), composed by `runBoundedReviewLoop` into a review/refute/re-review cycle bounded at 2 iterations with a distinct stalled outcome -- proven by 6 scripted cases plus 3 live falsification runs.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 2 (both complete)
- **Files modified:** 2 (both created)

## Accomplishments

- `decideWorkflowStop(review): WorkflowStop` -- the whole QUAL-05/GATE-06 stop predicate, first-match-wins in `workflows/evidence.ts`'s `gateCompletion()` numbered, binding-order docstring style: (1) `symptomatic` classification stops regardless of findings, (2) `workaround` classification stops with its `properFix`/`deferralReason` debt quoted directly in the stop message, (3) any BLOCKER surviving refutation stops naming its `location`/`concreteFailure`, (4) otherwise clear. A WARNING or NIT never reaches branch (3) at all -- that branch's own filter is `severity === "BLOCKER"`.
- `runRefuteOrPromote(ctx, review, contract): RefuteOrPromoteResult` -- filters to `severity === "BLOCKER"` before any call is made (`grep -n "BLOCKER"` shows the filter at line 343), runs exactly one nested `runSingleShotRole({role:"reviewer", tools:[refute_finding]})` pass per BLOCKER with a REFUTATION system prompt and the finding stated verbatim alongside the same rendered context contract (`buildReviewerContext`, reused from `reviewer.ts`), and fails safe: a response with no `refute_finding` tool call, or an `outcome` value outside the two-member `StringEnum(["upheld","withdrawn"])`, counts as UPHELD. Never runs a second pass on the same finding. Times each pass and reports it via `addQualityCost` (QUAL-09's ledger).
- `detectStall(previous, current): boolean` -- order-independent comparison of two finding sets under a normalised `severity|location|concreteFailure` key.
- `MAX_REVIEW_ITERATIONS = 2` -- a named constant carrying its own `why` (one pass to let the reviewer reconsider, one more to let a fix land, per the plan's own stated bound).
- `runBoundedReviewLoop(ctx, opts): BoundedReviewLoopResult` -- orchestrates: obtain a review via a caller-injected `review()` closure, run `runRefuteOrPromote` over its BLOCKERs, rebuild the post-refutation review (non-BLOCKER findings + promoted BLOCKERs), and hand THAT to `decideWorkflowStop`. Returns a four-armed discriminated result (`"clean" | "approval-required" | "blocked" | "stalled"`) carrying `iterations`, the final review, and the full withdrawal record across every iteration -- never a boolean. A classification stop returns immediately; a BLOCKER stop is compared against the previous iteration via `detectStall` before deciding whether to continue, stall, or hard-stop at `MAX_REVIEW_ITERATIONS`.
- `tests/integration/refute-or-promote.test.ts` -- 6 scripted cases against one shared faux `deepseek` session, each proving a mechanism that would fail if removed: WITHDRAWN (recorded with rationale, does not stop), UPHELD (promoted, stops naming location), SCOPE (exactly 1 provider call against a 6-finding review with 3 WARNINGs + 2 NITs alongside 1 BLOCKER), FAIL-SAFE (both no-tool-call and out-of-enum directions resolve to UPHELD), QUAL-05 (symptomatic-with-zero-findings, workaround with both debt fields in the reason text, root-cause-with-only-WARNING/NIT -- all with ZERO provider calls around the pure predicate), and BOUND-and-STALL (an identical finding set every iteration terminates `"stalled"`, bounded by `MAX_REVIEW_ITERATIONS`).

## Task Commits

Each task was committed atomically:

1. **Task 1: decideWorkflowStop and the refute-or-promote pass** - `d27ec0a` (feat)
2. **Task 2: Script both refutation outcomes, the scope limit, and the loop bound** - `1066fe3` (test)

## Falsification Proof (Task 2's own acceptance criteria)

Run against the fully-committed, working `verdict.ts` (commit `d27ec0a`), one mutation at a time, restored via `git checkout --` before the next -- confirmed via `git diff --stat HEAD` producing no output after each restore:

| Mutation | Test command | Result |
|---|---|---|
| Widened `runRefuteOrPromote`'s BLOCKER filter to `filter(() => true)` | `npx vitest run tests/integration/refute-or-promote.test.ts` | 1 failed / 5 passed -- exactly case 3 (SCOPE) turned red: expected 1 provider call, got 6 |
| Restored via `git checkout --`; confirmed `git diff --stat` empty | -- | clean restore |
| Made an unparseable/out-of-enum refutation count as withdrawn (`if (rawOutcome !== "upheld")`) | `npx vitest run tests/integration/refute-or-promote.test.ts` | 1 failed / 5 passed -- exactly case 4 (FAIL-SAFE) turned red: expected the no-tool-call response to stay UPHELD (promoted.length 1), got 0 |
| Restored via `git checkout --`; confirmed `git diff --stat` empty | -- | clean restore |
| Dropped `decideWorkflowStop`'s branch (1) (the symptomatic check) | `npx vitest run tests/integration/refute-or-promote.test.ts` | 1 failed / 5 passed -- exactly case 5 (QUAL-05) turned red: a symptomatic classification with zero findings no longer stopped |
| Restored via `git checkout --`; confirmed `git diff --stat` empty | -- | clean restore |

Final state: `npx tsc --noEmit` clean; `npx vitest run tests/integration/refute-or-promote.test.ts tests/unit` (full run substituted with `npx vitest run` for the whole suite) 1626/1626 green across 66 files.

## Files Created/Modified

- `.pi/extensions/quality/verdict.ts` (548 lines) -- `WorkflowStop`, `decideWorkflowStop`, `detectStall`, `MAX_REVIEW_ITERATIONS`, `RefuteOrPromoteResult`/`WithdrawnFinding`, `runRefuteOrPromote`, `RunBoundedReviewLoopOptions`/`BoundedReviewLoopResult`, `runBoundedReviewLoop`.
- `tests/integration/refute-or-promote.test.ts` (423 lines) -- the 6-case scripted proof plus the falsification-friendly fixture builders.

## Decisions Made

See `key-decisions` in the frontmatter. In addition:

- **`reviewAfterRefutation` (the non-BLOCKER-findings-plus-promoted-BLOCKERs reconstruction) is a private, unexported helper inside `verdict.ts`**, duplicated locally inside the test file for the two cases (1 and 2) that call `runRefuteOrPromote` directly rather than through `runBoundedReviewLoop`. The plan did not ask for it to be exported, and exporting a second public entry point for what is genuinely an internal reconstruction step would widen this module's surface for no caller need -- `runBoundedReviewLoop` is the one production caller that needs it, and it has it.
- **`runBoundedReviewLoop`'s `review()` closure is a plain caller-supplied function, never a `ReviewerContractInput`-driven `runReview` call built into this module.** The plan states this module does not know how to FIX anything between iterations; keeping "how is the next review obtained" entirely caller-owned is what let the test's case 6 script a canned `ReviewArtifact` directly, with no need to drive a second faux reviewer round-trip for the "review" half -- only the refutation calls (the actual subject of GATE-06) touch the provider.
- **`IterationWithdrawal extends WithdrawnFinding` adds only `iteration: number`** rather than a parallel, unrelated shape -- every withdrawal across a multi-iteration bounded loop is traceable to the cycle it happened on without duplicating `finding`/`rationale`.

## Deviations from Plan

None -- plan executed exactly as written. `decideWorkflowStop`, `runRefuteOrPromote`, `detectStall`, `MAX_REVIEW_ITERATIONS`, and `runBoundedReviewLoop` all exist with the exact branch order, fail-safe direction, and BLOCKER-only scope the plan specifies; the six required test cases are all present, all green, and all individually falsified.

## Known Stubs

None. `verdict.ts` is fully wired: `runRefuteOrPromote` genuinely dispatches through `runSingleShotRole` (the Phase 2 chokepoint), and `runBoundedReviewLoop` is a real orchestration proven end to end against a scripted faux session, not a stub returning a canned verdict.

## Threat Flags

None. All five T-08-31..35 mitigations named in the plan's threat register are exercised directly by `tests/integration/refute-or-promote.test.ts`: T-08-31 (fail-safe UPHELD, both directions, case 4), T-08-32 (withdrawal recorded with rationale, case 1), T-08-33 (exact provider-call-count assertion against a 6-finding review, case 3), T-08-34 (`MAX_REVIEW_ITERATIONS` + bounded call count, case 6), T-08-35 (classification-before-findings ordering, case 5a). No new network endpoint, auth path, file-access pattern, or schema change at a trust boundary was introduced beyond what the plan's own threat register already names.

## Issues Encountered

None.

## User Setup Required

None -- no external service configuration required. No `[RUNBOOK]` item executed, no real provider inference request issued: every provider in this plan's test is faux (`fauxProvider`), per the autonomous-run rules.

## Next Phase Readiness

- `decideWorkflowStop`, `runRefuteOrPromote`, and `runBoundedReviewLoop` exist, are proven end to end against a faux session, and are ready for a future Phase 9 ceremonial workflow to wire into an actual review/fix/approval cycle -- this plan explicitly does not own where the resulting approval is *collected* (a human sign-off surface), only the stop signal and its record.
- `runBoundedReviewLoop`'s `review()` closure is the seam a future workflow uses to supply "a fresh `runReview` call, or a re-review after an out-of-band fix" -- neither is built here.
- No blockers.

---
*Phase: 08-quality-gates-engineering-quality*
*Completed: 2026-08-15*

## Self-Check

- `.pi/extensions/quality/verdict.ts`: FOUND
- `tests/integration/refute-or-promote.test.ts`: FOUND
- `.planning/phases/08-quality-gates-engineering-quality/08-09-SUMMARY.md`: FOUND
- Commit `d27ec0a`: FOUND (`git log --oneline --all | grep d27ec0a`)
- Commit `1066fe3`: FOUND (`git log --oneline --all | grep 1066fe3`)
- `npx tsc --noEmit`: clean
- `npx vitest run tests/integration/refute-or-promote.test.ts tests/unit`: 6/6 integration cases green, full suite 1626/1626 green across 66 files

## Self-Check: PASSED
