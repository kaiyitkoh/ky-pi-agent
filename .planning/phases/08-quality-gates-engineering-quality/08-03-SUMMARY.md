---
phase: 08-quality-gates-engineering-quality
plan: 03
subsystem: quality
tags: [typebox, StringEnum, GATE-03, GATE-04, GATE-05, QUAL-04, QUAL-06, submit_review]

# Dependency graph
requires:
  - phase: 08-quality-gates-engineering-quality
    provides: "08-01 (routing/agent-overrides for nested-role calls), 08-02 (quality/rules.ts's magic-number/StringEnum precedent and vitest mutation-baseline test style)"
provides:
  - "submit_review typebox parameters (submitReviewParameters) -- the forced tool schema that IS the REVIEW artifact's shape"
  - "validateReview(raw, expectedRequirementIds) -- the nine-branch, first-match-wins cross-field validator (GATE-03/04/05, QUAL-04/06)"
  - "ReviewArtifact/ReviewVerdict/ReviewFinding types, NIT_CAP=5, renderReviewMarkdown() for the on-disk REVIEW.md rendering"
affects: [09-ceremonial-workflows, reviewer-subagent, gate-composition]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Forced structured tool call (submit_review) instead of free-text/regex REVIEW.md parsing -- Pi's own JSON-Schema tool-call validation rejects a bad severity/status before this module's validator runs"
    - "Nine-branch, first-match-wins predicate with a numbered, binding-order docstring, mirroring workflows/evidence.ts's gateCompletion() and routing/guard.ts's GuardVerdict two-arm shape"
    - "Mutation-baseline test discipline: one valid baseline object, every rejection case mutates exactly one field, a vacuity guard runs first, and every reject reason is asserted to CONTAIN the offending value or field name"

key-files:
  created:
    - .pi/extensions/quality/review-schema.ts
    - tests/unit/quality-schema.test.ts
  modified: []

key-decisions:
  - "validateReview() was written and committed alongside the schema in Task 1's commit (ee86bff) rather than split into a separate Task 2 commit, since both live in the same pure, single-purpose module and there is no meaningful intermediate state where the schema exists without its validator -- documented as a deviation below"
  - "Falsification of branches (2)/(5)/(6)/(7) was run in-place against the already-committed file (commit-then-falsify-then-restore via git checkout --), never committed in a broken state"

patterns-established:
  - "REVIEW artifact validation: JSON-Schema-expressible rules (closed enums) enforced at the tool-call boundary by typebox/StringEnum; cross-field rules (coverage, non-empty sections, workaround-implies-proper-fix) enforced by a pure validator function with a numbered binding-order docstring"

requirements-completed: [GATE-03, GATE-04, GATE-05, QUAL-04, QUAL-06]

# Metrics
duration: ~35min
completed: 2026-08-15
---

# Phase 08 Plan 03: REVIEW Artifact Schema and Validator Summary

**A forced `submit_review` tool call whose typebox schema IS the REVIEW artifact's shape, backed by a nine-branch `validateReview()` that structurally rejects an unclassified finding, a missing verdict, silent review, or an unrecorded workaround -- proven with a 27-case mutation-baseline test suite and four live falsification runs.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2 (both complete)
- **Files modified:** 2 (both created)

## Accomplishments

- `submitReviewParameters` -- a `Type.Object` typebox schema for the `submit_review` tool, using `StringEnum` (not `Type.Union`/`Type.Literal`) for all three closed string enums (verdict `status`, finding `severity`, `classification`), matching `qoder/index.ts:64-81`'s schema-construction style and `safety/index.ts:459`'s `StringEnum` precedent.
- `validateReview(raw, expectedRequirementIds): ReviewValidation` -- the nine-branch, first-match-wins cross-field validator, in `workflows/evidence.ts`'s `gateCompletion()` numbered-docstring style: malformed shape, unclassified severity (GATE-05), verdict coverage in both directions, malformed `file:line` evidence, empty `checkedAndCleared` (GATE-04), malformed `classification` (QUAL-04), an unrecorded workaround (QUAL-06), and the NIT cap -- before accepting and normalising into a `ReviewArtifact`.
- `renderReviewMarkdown(review): string` -- the on-disk `REVIEW.md` rendering; where it lands inside an MR body is explicitly left to Phase 9.
- A module docstring carrying the BOOT-10 boundary rule (registers nothing; does not spell the tool-registration call anywhere, in code or prose) and a **WHAT THIS DOES NOT PROVE** section stating `evidence`/`location` are model-authored `file:line` strings, never equivalent to `workflows/evidence.ts`'s `tool_result`-derived, SHA-bound GATE-07 evidence (T-08-08).
- 27 test cases in `tests/unit/quality-schema.test.ts`, across six groups (`verdict`, `malformed`, `checked and cleared`, `classification`, `workaround`, `NIT cap`) plus a vacuity guard and a `clone()`-sanity pair, every rejection case mutating exactly one field of a single baseline object and asserting its reason contains the offending value or field name.
- Live falsification of branches (2), (5), (6), (7): each branch was deleted in turn, `npx vitest run tests/unit/quality-schema.test.ts` re-run, and confirmed that **exactly** the matching test group turned red while every other group stayed green, then the file was restored via `git checkout --` before the next falsification (never committed in a broken state).

## Task Commits

Each task was committed atomically:

1. **Task 1: The submit_review schema and the REVIEW artifact type** - `ee86bff` (feat) -- also carries `validateReview` itself; see Deviations below.
2. **Task 2: validateReview -- the rejection engine, proved in both directions** - `b9b0196` (test) -- `tests/unit/quality-schema.test.ts`, 27 cases.

## Files Created/Modified

- `.pi/extensions/quality/review-schema.ts` (541 lines) - `submitReviewParameters`, `SUBMIT_REVIEW_TOOL_NAME`/`SUBMIT_REVIEW_DESCRIPTION`, `ReviewVerdict`/`ReviewFinding`/`ReviewArtifact` types, `NIT_CAP`, `validateReview()`, `renderReviewMarkdown()`.
- `tests/unit/quality-schema.test.ts` (313 lines) - the mutation-baseline rejection/acceptance table.

## Decisions Made

- **`validateReview` was written into the same commit as the schema (Task 1's `ee86bff`), not split into Task 2's own commit.** The plan's task boundary asked for the schema first and the validator second as separate commits; since both live in one pure, single-purpose file with no legitimate intermediate state (a schema with no validator is not independently useful or testable), and the file was written once as a single coherent module, the atomic-commit-per-task discipline was applied at the file level instead: `ee86bff` = the whole module (schema + validator + renderer), `b9b0196` = the test file that proves it. This is a deviation from strict plan wording, not from the plan's substance -- both deliverables described by Task 1 and Task 2 exist, are committed, and are proven; see `git log --oneline -2` (`b9b0196`, `ee86bff`).
- **`describeValue`/`describeType` helpers build every reject reason from the received data**, never from a caller-supplied string, matching `gateCompletion`'s and `classifyGitInvocation`'s house style -- this is what makes the "reason CONTAINS the offending value" acceptance criterion mechanically true rather than merely intended.
- **Malformed verdict items degrade to an empty `requirementId`/`evidence` rather than throwing.** A verdict item that is not an object, or whose `requirementId`/`evidence` is not a string, is treated as `""` for that field -- an empty `requirementId` naturally fails to cover any expected id (branch 3) and an empty `evidence` naturally fails the `file:line` shape check (branch 4), so a malformed verdict item still produces an actionable, field-attributed rejection instead of a runtime exception. This is Rule 1 (bug prevention): `validateReview` must never throw on adversarial input, since it validates untrusted model tool-call arguments.
- **NIT count is computed after all nine branches' worth of shape-checking is complete for findings' severity (branch 2 already guaranteed every `severity` is valid by the time branch 8 runs)**, so `findings.filter(f => f.severity === "NIT").length` never miscounts a malformed severity as a non-NIT.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `classification` needed an explicit cast to satisfy `tsc --noEmit`**
- **Found during:** Task 1 (writing the accept-branch construction of `ReviewArtifact`)
- **Issue:** `classification` is narrowed by `typeof classification !== "string" || !VALID_CLASSIFICATIONS.has(classification)` returning early, but `VALID_CLASSIFICATIONS` is a `Set<string>` (not a type predicate), so TypeScript does not narrow the local `classification` binding to the union `"root-cause" | "symptomatic" | "workaround"` at the point it is assigned into `ReviewArtifact`. `npx tsc --noEmit` reported `TS2322`.
- **Fix:** `classification: classification as ReviewArtifact["classification"]` -- a targeted cast at the one call site where the branch-6 check has already run and the value is known-valid by construction.
- **Files modified:** `.pi/extensions/quality/review-schema.ts`
- **Verification:** `npx tsc --noEmit` clean; `npx vitest run tests/unit/quality-schema.test.ts` green (27/27)
- **Committed in:** `ee86bff` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking type error), plus 1 task-boundary consolidation (documented above under Decisions Made, not a Rule 1-4 deviation -- no functionality was added or changed, only which commit carries which lines).
**Impact on plan:** No scope change. Both plan deliverables (schema, validator, renderer, module docstring, test suite, falsification proof) exist exactly as specified; only the commit split differs from the plan's literal task-by-task wording.

## Falsification Proof (acceptance criterion, Task 2)

Run against the fully-committed, working `review-schema.ts` (commit `ee86bff`), one branch at a time, restored via `git checkout -- .pi/extensions/quality/review-schema.ts` before the next:

| Branch deleted | Test command | Result |
|---|---|---|
| (2) severity malformed check | `npx vitest run tests/unit/quality-schema.test.ts` | 4 failed / 23 passed -- exactly the four `malformed` severity cases (`blocker`, `CRITICAL`, `""`, absent) turned red; `LGTM` and zero-findings cases (unrelated to severity) stayed green |
| (5) `checkedAndCleared` empty/whitespace check | same | 3 failed / 24 passed -- exactly the three `checked and cleared` rejection cases (absent, `""`, `"   "`) turned red; the one-sentence acceptance case stayed green |
| (6) `classification`/`classificationJustification` check | same | 3 failed / 24 passed -- exactly the three `classification` cases (absent, `"refactor"`, empty justification) turned red |
| (7) workaround `properFix`/`deferralReason` check | same | 2 failed / 25 passed -- exactly the two `workaround` rejection cases turned red; the both-present acceptance case stayed green |

After each falsification, `git checkout --` restored the file; `git diff --stat HEAD -- .pi/extensions/quality/review-schema.ts` produced no output each time, confirming a clean restore. Final state: `npx tsc --noEmit` clean, `npx vitest run tests/unit/quality-schema.test.ts` 27/27 green, full suite `npx vitest run` 1846/1846 green across 100 files.

## Known Stubs

None. `review-schema.ts` is pure and self-contained; it is not wired to any caller yet (no `runSingleShotRole`/`callModel` invocation passes `submitReviewParameters` as a tool), which is explicitly out of scope for this plan -- the plan's own objective states this module "makes no model call, registers nothing, and reads no files" and that a future gate-composition module owns wiring it in.

## Issues Encountered

None beyond the type-cast fix documented above.

## Self-Check

- `.pi/extensions/quality/review-schema.ts`: FOUND
- `tests/unit/quality-schema.test.ts`: FOUND
- Commit `ee86bff`: FOUND (`git log --oneline --all | grep ee86bff`)
- Commit `b9b0196`: FOUND (`git log --oneline --all | grep b9b0196`)
- `npx tsc --noEmit`: clean
- `npx vitest run tests/unit/quality-schema.test.ts`: 27/27 passed
- `npx vitest run` (full suite): 1846/1846 passed, 100 files

## Self-Check: PASSED

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `submitReviewParameters`, `validateReview`, and `renderReviewMarkdown` exist, are unit-proven in both directions, and are ready for a future gate-composition module (not built in this plan) to pass `submitReviewParameters` through `callModel()`'s existing `tools?: Tool[]` field via `runSingleShotRole`, per `08-RESEARCH.md` Pattern 2.
- The reviewer's actual invocation (`.pi/agents/reviewer.md`, the nested `callModel()` call, and wiring the validated `ReviewArtifact` into GATE-06's refute-or-promote pass) remains for a later plan in this phase or Phase 9.
- No blockers.

---
*Phase: 08-quality-gates-engineering-quality*
*Completed: 2026-08-15*
