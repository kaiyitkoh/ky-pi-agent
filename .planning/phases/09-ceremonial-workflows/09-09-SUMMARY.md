---
phase: 09-ceremonial-workflows
plan: 09
subsystem: workflows
tags: [plan-ceremony, plan-schema, task-form, coverage-matrix, ceremonial-workflows]

# Dependency graph
requires:
  - phase: 09-ceremonial-workflows
    provides: "plan 09-06's EXPECTED_FILE_PATTERN (spec-schema.ts) -- the repo-relative-path pattern this plan imports and reuses for task-line path validation, never re-declares"
provides:
  - "TASK_LINE_PATTERN/VERIFICATION_SEPARATOR/parseTaskLine -- the PLAN.md task-line shape as CODE: T### [P]? [R#,R#,...] verb <path> | verify: <command>"
  - "parsePlanTasks -- the whole-document task-line scanner, malformed lines returned never dropped"
  - "filesTouchedUnion -- the second input to /review's future drift baseline, alongside spec-schema.ts's ScopePin.expectedFiles"
  - "validatePlan -- the whole-document, 7-branch, numbered binding-order PLAN.md gate (shape + both-directions coverage)"
  - "renderPlanMarkdown -- the on-disk PLAN.md renderer, round-trip-proved against validatePlan"
affects: [09-10 (wires validatePlan into /plan's actual write path, closing FLOW-06), 09-VALIDATION.md's FLOW-06 row]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LAST-token path extraction, not first-matching-token search -- EXPECTED_FILE_PATTERN legally accepts a bare single-segment word with no dot or slash (a real repo-relative path can be a bare filename), so scanning every token in a sentence for the FIRST match misidentifies an ordinary prose word ('to', 'the') as the path. The path is the LAST whitespace-delimited token before the verification separator, matching FEATURES.md's own example where the path is written last in the sentence. Discovered as a genuine design bug while constructing this plan's own falsification fixtures, not merely theorised -- see Deviations."
    - "A named separator constant with NO trailing space, so the boundary case ('a path but nothing after the separator') needs no invisible trailing whitespace in a fixture string -- the renderer adds its own single space explicitly, at the call site, not baked into the constant"
    - "Bounded quantifiers (\\S{1,200}, \\S.{0,2000}) for the verb and remainder captures of a per-line forcing-function regex applied to model-authored text, mirroring spec-schema.ts's IF_THEN_PATTERN discipline -- closes T-09-09-04 (catastrophic backtracking)"
    - "Coverage checked in BOTH directions as two independently-falsifiable branches (6)/(7), mirroring review-schema.ts's ReviewVerdict coverage precedent -- proved by two SEPARATE mutations so neither branch can cover for the other"

key-files:
  created:
    - .pi/extensions/plan-ceremony/plan-schema.ts
    - tests/unit/plan-task-form.test.ts
  modified:
    - tests/unit/workflow-budgets.test.ts
    - .planning/phases/09-ceremonial-workflows/deferred-items.md

key-decisions:
  - "The path is extracted as the LAST token before the verification separator, not the first token anywhere matching EXPECTED_FILE_PATTERN -- the original first-match design false-positived on ordinary prose words during Task 2's own fixture construction; fixed inline (Rule 1) before the fixture table was even written, so no red-then-fixed cycle was needed for the production code itself"
  - "VERIFICATION_SEPARATOR carries no trailing space (' | verify:', not ' | verify: ') -- avoids a fixture needing invisible trailing whitespace to exercise the commandless-task case; the renderer supplies the one rendering space explicitly at its own call site"
  - ".pi/extensions/plan-ceremony is a new directory, deliberately not named plan-mode, to avoid colliding with the vendored Pi bundled example's own concept (per 09-RESEARCH.md and this plan's own frontmatter) -- follows plan 09-05's identical precedent of declaring a DIRECTORY_BUDGETS row ahead of any registerCommand( call, since /plan itself is wired in 09-10"
  - "Falsification (c)'s actual behaviour diverged from the plan's literal prediction, and is recorded honestly rather than restated to match -- see Falsifications section below"

requirements-completed: []

# Metrics
duration: ~20min
completed: 2026-08-15
---

# Phase 9 Plan 9: PLAN.md task-form parser and both-directions coverage matrix Summary

**`validatePlan` in `.pi/extensions/plan-ceremony/plan-schema.ts`: a 7-branch, numbered, binding-order whole-document gate that structurally rejects a PLAN.md task line missing its id, its `[R#]` requirement group, its explicit file path, or its verification command, and enforces requirement coverage in both directions independently -- proved with a 13-row fixture table (asserting on reason text, not merely `ok===false`) and four source-level falsifications.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-15T14:57Z (approx, from STATE.md `last_updated` at the prior plan's completion)
- **Completed:** 2026-08-15T15:15Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `TASK_LINE_PATTERN` (FLOW-06): the anchored, bounded-quantifier task-line form `- [ ] T### [P]? [R#,R#,...] verb <remainder>`, with `(?!\d)` after a fixed `\d{3}` so `T1` and `T0001` are both rejected, and an at-least-one-`R\d+` requirement group so an absent group and an empty `[]` group fail the same way.
- `VERIFICATION_SEPARATOR`/`parseTaskLine`: the declared, named convention for extracting the explicit path (the LAST token before the separator, checked against `EXPECTED_FILE_PATTERN` imported from `spec-schema.ts` -- one declaration site, confirmed by `git grep`) and the verification command (the trimmed text after the separator).
- `parsePlanTasks`: malformed candidate lines (opens with the checkbox prefix, fails `TASK_LINE_PATTERN`) are returned with a diagnosis naming the specific missing element, never silently dropped.
- `filesTouchedUnion`: the sorted, de-duplicated path union -- `/review`'s second future drift-baseline input, alongside SPEC §5's `expectedFiles`.
- `validatePlan`: 7 numbered reject branches (zero tasks, any malformed line, duplicate ids, pathless tasks, commandless tasks, coverage direction one, coverage direction two) plus accept, constructing `PlanArtifact` at exactly one site.
- `renderPlanMarkdown`: copies `renderReviewMarkdown`'s accumulator shape, round-trip-proved (`validatePlan(renderPlanMarkdown(validatePlan(x).plan), ids)` accepts).
- 16-test fixture-table suite (`tests/unit/plan-task-form.test.ts`): 13 rows (3 accept, 10 reject, every reject asserting on reason TEXT), a vacuity guard, a `filesTouchedUnion` dedup case, and the round-trip case.
- Four falsifications performed and recorded verbatim below, each restored to a clean `git diff` before the next mutation.
- `.pi/extensions/plan-ceremony` `DIRECTORY_BUDGETS` row added and re-measured within the same plan (560 -> 580, final measured 578) after Task 2's own path-extraction fix grew the file.

## Task Commits

Each task was committed atomically:

1. **Task 1: plan-schema.ts -- task-form parser, coverage matrix, files-touched union** - `c2b8ef2` (feat)
2. **Task 2: plan-task-form fixture table, and the deviation fix to path extraction** - `85dac1a` (test)

**Plan metadata:** _pending -- final commit created after this SUMMARY._

## Files Created/Modified

- `.pi/extensions/plan-ceremony/plan-schema.ts` (578 raw lines, new) - `TASK_LINE_PATTERN`, `VERIFICATION_SEPARATOR`, `CHECKBOX_LINE_PATTERN`, `REQUIREMENT_GROUP_PROBE_PATTERN`, `ID_TOKEN_PROBE_PATTERN`, `diagnoseMalformedLine`, `ParsedTask`, `extractPathAndCommand`, `parseTaskLine`, `parsePlanTasks`, `filesTouchedUnion`, `PlanArtifact`, `PlanValidation`, `validatePlan`, `renderPlanMarkdown`
- `tests/unit/plan-task-form.test.ts` (223 lines, new) - `buildPlan` fixture builder, the 13-row `ROWS` table, vacuity guard, `filesTouchedUnion` dedup case, round-trip case
- `tests/unit/workflow-budgets.test.ts` - `.pi/extensions/plan-ceremony` `DIRECTORY_BUDGETS` entry added (Task 1: 560, measured 556) and re-measured (Task 2: 580, measured 578) in the same commit as each growth
- `.planning/phases/09-ceremonial-workflows/deferred-items.md` - logged the same pre-existing `checkpoint-store.test.ts` flaky-under-load timing test already logged for plan 09-08, out of this plan's scope

## Decisions Made

See `key-decisions` in the frontmatter above. In short: path extraction uses the LAST token before the separator (not the first matching token anywhere), the separator constant carries no trailing space, the new directory is named `plan-ceremony` (not `plan-mode`) to avoid colliding with the vendored example, and falsification (c)'s real, plan-diverging result is recorded honestly rather than restated to match the plan's prediction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Path extraction used a "first matching token anywhere" strategy that false-positived on ordinary prose**
- **Found during:** Task 2, while constructing the "no path token" and "path but no command" fixture rows
- **Issue:** `EXPECTED_FILE_PATTERN` (imported from `spec-schema.ts`) legally accepts a bare single-segment word with no `.` or `/` at all, because a real repo-relative path CAN be a bare filename in the repo root. The original `extractPathAndCommand` searched the remainder's tokens left-to-right for the FIRST one matching `EXPECTED_FILE_PATTERN`, which meant an ordinary prose word earlier in the sentence ("the", "in", "to") was frequently misidentified as the path before the real path token was ever reached.
- **Fix:** Switched to checking only the LAST whitespace-delimited token before the verification separator (matching `FEATURES.md`'s own worked example, where the path is written last in the sentence). Also dropped `VERIFICATION_SEPARATOR`'s trailing space (`" | verify:"` instead of `" | verify: "`) so the "path but no verification command" boundary case needs no invisible trailing whitespace in a test fixture string; `renderPlanMarkdown` now adds that one rendering space explicitly at its own call site.
- **Files modified:** `.pi/extensions/plan-ceremony/plan-schema.ts`
- **Verification:** All 16 tests in `tests/unit/plan-task-form.test.ts` pass with the fixed extraction; full suite green; `npx tsc --noEmit` clean.
- **Committed in:** `85dac1a` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug, discovered and fixed while constructing this plan's own falsification-adjacent fixtures, before any code shipped with the flaw)
**Impact on plan:** No impact on the shipped Task 1 commit's correctness claim in retrospect -- the flaw would have made `validatePlan` accept plans whose "path" was actually a stray prose word, silently widening `/review`'s future drift-detector allowance (the exact T-09-09-01 threat this plan's own threat register names). Caught before Task 1's commit was relied upon by any other code.

## Falsifications (recorded verbatim, per this plan's `<verification>` requirement)

All four falsifications were performed by editing `.pi/extensions/plan-ceremony/plan-schema.ts` in place (via the `Edit` tool), running `npx vitest run tests/unit/plan-task-form.test.ts`, capturing the RED output below, then reverting the edit and confirming `git diff --stat .pi/extensions/plan-ceremony/plan-schema.ts` was empty before proceeding to the next falsification. `tests/unit/plan-task-form.test.ts` itself was committed (`85dac1a`) before any mutation began.

### Falsification (a) -- delete coverage branch (6) (`if (uncoveredRequirementIds.length > 0)` neutered to `if (false && ...)`)

Exactly the uncovered-requirement case turned RED, as predicted.

```
 ❯ tests/unit/plan-task-form.test.ts (16 tests | 1 failed) 7ms
     × 'a requirement in the SPEC list with z…' -> false ('R3 is declared by the SPEC but no tas…') 3ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

AssertionError: expected ok=false, got {"ok":true,"plan":{"tasks":[...],"coverageMatrix":{},"filesTouched":["src/auth/session.ts","src/auth/store.ts"]}}: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ tests/unit/plan-task-form.test.ts:181:83

 Test Files  1 failed (1)
      Tests  1 failed | 15 passed (16)
```

### Falsification (b) -- delete coverage branch (7) (`if (inventedCitations.length > 0)` neutered to `if (false && ...)`)

Exactly the invented-`R9` case turned RED, and ONLY that case -- proving directions (a) and (b) are independently enforced, run as separate mutations per this plan's own instruction.

```
 ❯ tests/unit/plan-task-form.test.ts (16 tests | 1 failed) 9ms
     × 'a task citing R9 when the SPEC declar…' -> false ('a task inventing a requirement id nob…') 4ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

AssertionError: expected ok=false, got {"ok":true,"plan":{"tasks":[...,{"id":"T003","parallel":false,"requirementIds":["R3","R9"],...}],"coverageMatrix":{},...}}: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ tests/unit/plan-task-form.test.ts:181:83

 Test Files  1 failed (1)
      Tests  1 failed | 15 passed (16)
```

### Falsification (c) -- drop malformed lines instead of returning them (`parsePlanTasks`'s `malformed.push(...)` replaced with a no-op)

**Recorded honestly, DIFFERING from this plan's own stated prediction.** The plan text read: "the pathless-task and commandless-task cases must turn RED." Under this module's actual design, a pathless or commandless task line is NOT a malformed line -- it matches `TASK_LINE_PATTERN` structurally (id, requirement group, verb and remainder all present) and is caught instead by `validatePlan`'s own branches (4)/(5), which read `ParsedTask.path`/`.verificationCommand` directly, never by `parsePlanTasks`'s `malformed` array. Dropping malformed lines therefore turned RED the three fixtures that genuinely ARE malformed lines (the two-digit-short id, the absent `[R#]` group, and the empty `[]` group cases) -- each of those single-task plans lost its only task line, so `tasks.length === 0 && malformed.length === 0` fired branch (1)'s "no task lines found" instead of the fixture's own expected reject reason, which the reason-text assertion (not the boolean) correctly caught as wrong. This is the same "record the true, weaker-or-different result honestly" discipline `09-06-SUMMARY.md`'s own falsification (a) established.

```
 ❯ tests/unit/plan-task-form.test.ts (16 tests | 3 failed) 9ms
     × 'a two-digit-short task id (T1)' -> false ('T### requires EXACTLY three digits --…') 3ms
     × 'a task line with no [R#] group at all' -> false ('the requirement group is REQUIRED, no…') 0ms
     × 'a task line with an empty [] requirem…' -> false ('an empty [] group must fail the SAME …') 0ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

AssertionError: reason "no task lines found in this PLAN.md -- every stated requirement needs at least one task, and an empty task list would satisfy every later check vacuously" must include "missing or malformed task id": expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ tests/unit/plan-task-form.test.ts:188:7

AssertionError: reason "no task lines found in this PLAN.md -- every stated requirement needs at least one task, and an empty task list would satisfy every later check vacuously" must include "requirement id group": expected false to be true // Object.is equality

 Test Files  1 failed (1)
      Tests  3 failed | 13 passed (16)
```

### Falsification (d) -- make `[P]` required (`(?: (\[P\]))?` changed to a mandatory `(\[P\])`)

**Stronger than the plan's own prediction** ("the `[P]`-absent accept case must turn RED"). 8 of 16 tests turned red -- not only the one dedicated "`[P]` present and absent, same plan" accept case, but also the "completed task (`[x]`)" accept case, the duplicate-id, commandless-task, uncovered-requirement, `filesTouchedUnion`-dedup and round-trip cases, all of which use at least one well-formed task line that happens to omit `[P]`. This is the correct, thorough outcome: an unconditional `[P]` requirement breaks every fixture built from a `[P]`-absent task line, which in this suite is the large majority -- the base fixtures were deliberately built with `[P]` used only where FEATURES.md's own example shows it, so the marker's optionality is load-bearing almost everywhere, not just in the one case named for it. Mirrors `09-06-SUMMARY.md`'s falsification (c) precedent for the identical "stronger than predicted" shape.

```
 ❯ tests/unit/plan-task-form.test.ts (16 tests | 8 failed) ~10ms
     × 'duplicate T003 ids on two otherwise w…' -> false ('every T### id must be unique -- the r…')
     × 'a task with a path but nothing after …' -> false ('a path with an empty command is still…')
     × 'a requirement in the SPEC list with z…' -> false ('R3 is declared by the SPEC but no tas…')
     × 'a task with [P] present and a task wi…' -> true ('[P] is OPTIONAL -- without this case,…')
     × 'a completed task (checkbox marked [x]…' -> true ('the checkbox\'s checked/unchecked sta…')
     × filesTouchedUnion de-duplicates and sorts: two tasks touching the same path yield one entry
     × round-trips: validatePlan(renderPlanMarkdown(plan), ids) accepts

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 8 ⎯⎯⎯⎯⎯⎯⎯

AssertionError: expected ok=true, got {"ok":false,"reason":"this PLAN.md carries 1 malformed task line(s): does not match the required task-line form \"- [ ] T### [P] [R#,R#,...] <verb> <path> | verify:<command>\": \"- [ ] T001 [R1] Add refresh-token rotation to src/auth/session.ts | verify: npx vitest run tests/unit/auth-session.test.ts\""}: expected false to be true // Object.is equality

 Test Files  1 failed (1)
      Tests  8 failed | 8 passed (16)
```

After each falsification, the source file was restored and `git diff --stat .pi/extensions/plan-ceremony/plan-schema.ts` confirmed empty before proceeding.

## Issues Encountered

None beyond the one auto-fixed deviation documented above (a genuine path-extraction design flaw caught and corrected while building this plan's own fixtures, before it shipped in any relied-upon commit).

## Known Stubs

None. `plan-schema.ts` is a complete, pure module -- every export (`parseTaskLine`, `parsePlanTasks`, `filesTouchedUnion`, `validatePlan`, `renderPlanMarkdown`) is a real implementation with no placeholder value, no hardcoded empty return feeding a UI, and no "coming soon" text.

## Threat Flags

None beyond this plan's own `<threat_model>`, all of which were dispositioned by the plan itself and closed by this implementation:
- T-09-09-01 (a glob/absolute/`..` path widens `/execute`'s drift allowance) -- `EXPECTED_FILE_PATTERN` is imported, not re-declared (confirmed by `git grep`, exactly one declaration site); the glob fixture row proves the reuse is live. The Rule 1 deviation above closes a SECOND, narrower instance of this same threat class (a prose word being misidentified as a path), which this plan's own falsification-fixture construction surfaced.
- T-09-09-02 (a one-directional coverage check invents or under-covers requirements) -- branches (6)/(7), falsified as SEPARATE mutations, neither covering for the other.
- T-09-09-03 (malformed task lines silently dropped, hiding a pathless task from the drift check) -- `parsePlanTasks` returns malformed lines; branch (2) rejects on any; falsification (c) proves dropping them is detectable, even though the specific fixtures it turns red diverge from the plan's own prediction (recorded honestly above).
- T-09-09-04 (catastrophic backtracking on `TASK_LINE_PATTERN`) -- bounded quantifiers (`\S{1,200}`, `\S.{0,2000}`), no nested quantifier over an unbounded group.
- T-09-09-05 (the module reaches a model or registers a tool) -- pure module; `chokepoint-lint` and `contributing-boundary` both pass with the new directory in scope; allowlist stays at 5.
- T-09-09-SC (supply chain) -- no install occurred; `tests/unit/pinning.test.ts` unaffected.

No new network endpoint, auth path, file access pattern, or schema change at a trust boundary was introduced beyond what the plan already named.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `.pi/extensions/plan-ceremony/plan-schema.ts` now exports the complete PLAN.md schema/validator/renderer surface plan 09-10 needs to wire `/plan`'s actual write path: `validatePlan`, `renderPlanMarkdown`, `filesTouchedUnion` (for `/review`'s future drift baseline alongside `spec-schema.ts`'s `ScopePin.expectedFiles`).
- `requirements-completed` is intentionally empty in this SUMMARY's frontmatter: this plan's own frontmatter/objective states FLOW-06 "closes when 09-10 wires it to the `/plan` command's write path" -- the PLAN.md text carries FLOW-06 as this plan's requirement, but the plan's own objective is explicit that the requirement itself does not close until the wiring plan lands, matching plan 09-06's identical precedent for FLOW-05's declaration half.
- No blockers. Full suite green (2169/2169 in the run immediately preceding the falsifications; one pre-existing, unrelated flaky concurrency test in `checkpoint-store.test.ts` observed and confirmed non-reproducing in isolation, logged to `deferred-items.md`); `npx tsc --noEmit` clean throughout.

---
*Phase: 09-ceremonial-workflows*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `.pi/extensions/plan-ceremony/plan-schema.ts`
- FOUND: `tests/unit/plan-task-form.test.ts`
- FOUND: `.planning/phases/09-ceremonial-workflows/09-09-SUMMARY.md`
- FOUND commit: `c2b8ef2` (Task 1)
- FOUND commit: `85dac1a` (Task 2)
- CONFIRMED: `git diff --stat .pi/extensions/plan-ceremony/plan-schema.ts` empty after all four falsification restores
