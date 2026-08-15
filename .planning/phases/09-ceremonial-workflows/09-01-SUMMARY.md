---
phase: 09-ceremonial-workflows
plan: 01
subsystem: testing
tags: [vitest, ipc, concurrency, checkpoint-store, de-flake]

# Dependency graph
requires:
  - phase: 07-claude-code-parity
    provides: ".pi/extensions/checkpoint/store.ts (EXT-07 durable checkpoint index, WR-09/10/11/14/16 fix pass)"
provides:
  - "tests/unit/checkpoint-store.test.ts's WR-09 case de-flaked: IPC ready/release event gate replaces the Date.now()+800 wall-clock barrier"
  - "A structural interleaving proof (adjacent tag-switch count over the store's own row order) replaces the Date.now() overlap comparison"
  - "A measured MIN_TAG_SWITCHES threshold (4), derived from ~150 solo runs + 3 full-suite runs, not guessed"
affects: [09-ceremonial-workflows]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "IPC ready/release handshake for proving OS-process overlap without a wall-clock margin (child sends {type:'ready'} the instant its own async setup resolves; parent releases every child only after collecting every ready)"
    - "Structural interleaving proof: assert a property of the subject's OWN recorded output (adjacent-tag-switch count) instead of comparing two independently-measured Date.now() values"

key-files:
  created: []
  modified:
    - tests/unit/checkpoint-store.test.ts

key-decisions:
  - "spawnWriter() replaces runWriter(): each child is spawned with stdio ['ignore','pipe','pipe','ipc'] as const, sends {type:'ready',tag} the instant its dynamic import() of store.ts resolves, then blocks on its own incoming 'go' message; the parent awaits every child's ready promise before releasing any of them with child.send('go')"
  - "A child that exits/errors before sending ready REJECTS its ready promise with the exit code and stderr, so a dead child can never leave the parent awaiting Promise.all(...) forever (threat T-09-01-01)"
  - "The overlap proof reads readCheckpoints(root)'s own row order and counts adjacent tag switches, asserting the count exceeds a named MIN_TAG_SWITCHES constant -- a property the store itself produced, never a Date.now() comparison"
  - "MIN_TAG_SWITCHES=4 was MEASURED, not guessed: an initial guess of 8 flaked 3/10 on a follow-up check (real switch counts as low as 5-6 occur legitimately); instrumented ~150 solo runs (range 5-33, floor 5) plus 3 full-suite-load runs (27-33, higher under contention, not lower) before settling on 4 -- directly below the observed floor, still failing outright on the serial case's exactly-3"
  - "TypeScript narrows spawn()'s stdout/stderr to possibly-null once 'ipc' is in the stdio array; fixed with 'as const' on the stdio tuple plus an explicit null-check-and-throw rather than a non-null assertion, so a genuine null would fail loudly instead of being silently asserted away"

patterns-established:
  - "Event-gated concurrency proofs: never a wall-clock duration standing in for 'this happened', always an explicit signal (IPC message, resolved promise) the test itself controls or awaits"

requirements-completed: ["WR-09"]

# Metrics
duration: 40min
completed: 2026-08-15
---

# Phase 09 Plan 01: De-flake WR-09 concurrent-recorders case Summary

**Replaced the WR-09 checkpoint-store concurrency test's `Date.now() + 800` wall-clock barrier with an IPC ready/release event handshake, and its `Date.now()` overlap comparison with a structural tag-switch interleaving proof read from the store's own row order.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-08-15 (Phase 09 execution start, per STATE.md)
- **Completed:** 2026-08-15T20:35:29+08:00
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- The WR-09 case's four writer children are now released by a real event (`child.send("go")` after every child has sent `{type:"ready",tag}` over its own IPC channel), never by a fixed wall-clock deadline. The 587-970ms boot-cost variance measured under load in `09-RESEARCH.md` can no longer make the barrier fire before every child has genuinely reached it.
- The overlap guarantee itself is now a structural property of the store's own recorded output (adjacent tag-switch count in `readCheckpoints(root)`'s row order), not a comparison of two independently-measured `Date.now()` values.
- Both new mechanisms were falsified against the real, committed code before being trusted: removing the store's lock turns the 600-row assertion red; forcing the four children to release strictly serially turns the tag-switch assertion red at exactly the predicted boundary value (3 switches).
- `MIN_TAG_SWITCHES` was tuned from an empirical measurement, not a guess -- the plan's first attempt (8) genuinely flaked 3/10 on a follow-up check, which is exactly the "be suspicious of green" discipline the plan asked for. Final value (4) passed 30/30 in a dedicated stress check plus the required 10/10 proof run.

## Task Commits

Each task was committed atomically (Task 1 and Task 2 landed as two commits; see "Deviations" for why Task 2's own further correction became a second follow-up commit rather than amending):

1. **Task 1 + Task 2 (combined): IPC handshake + structural interleaving proof** - `d03cee8` (test)
2. **Task 2 refinement: measured MIN_TAG_SWITCHES threshold** - `10565c1` (test)

**Plan metadata:** pending (this SUMMARY + STATE/ROADMAP update)

## Files Created/Modified

- `tests/unit/checkpoint-store.test.ts` - `runWriter()` replaced by `spawnWriter()` (IPC-channel spawn, `ready`/`go` event gate, dead-child rejection); the generated writer child script now sends `process.send({type:"ready",tag})` and blocks on its own `"go"` message instead of sleeping until a shared `Date.now()+800` instant; the overlap assertion is now a structural adjacent-tag-switch count over `readCheckpoints(root)`'s own row order, gated by a measured `MIN_TAG_SWITCHES=4` constant.

## Decisions Made

See `key-decisions` in frontmatter above. The single decision worth calling out in prose: the plan's own acceptance criteria named a mechanism ("IPC or the documented sentinel fallback") but left the interleaving threshold's exact value to be chosen by the executor with the constraint "chosen so that four strictly contiguous blocks (3 switches) fails and genuine interleaving passes." The first value chosen (8) technically satisfied that constraint on paper but was not actually safe in practice -- it flaked on a follow-up 10-run check. Rather than accept a threshold that had not been checked against real variance, ~150 additional runs were spent finding the true floor (5) and setting the threshold just below it (4), then re-running the full 10-run proof and the falsification to confirm the new value still discriminates correctly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `stdio: [..., "ipc"]` made `spawn()`'s `child.stdout`/`child.stderr` types possibly-null under TypeScript, breaking `npx tsc --noEmit` and (transitively) `tests/unit/quality-production-exec.test.ts`'s self-typecheck assertion**
- **Found during:** Task 1, first full-suite run after wiring the IPC stdio array
- **Issue:** TypeScript's `spawn()` overload resolution for a non-tuple `stdio` array (even with `"ipc"` as the fourth element) falls back to the general overload where `stdout`/`stderr` are `Readable | null`. This is purely a type-inference gap (the runtime value is never null with `"pipe"` at those two slots) but it failed `npx tsc --noEmit`, which `tests/unit/quality-production-exec.test.ts`'s own self-typecheck case runs against this repository's real source and asserts is clean.
- **Fix:** Typed the `stdio` array as `as const` (a readonly tuple, which narrows the overload correctly) and added an explicit `if (child.stdout === null || child.stderr === null) throw ...` guard before use, rather than a non-null assertion -- so a genuine future regression would fail loudly instead of being silently asserted away.
- **Files modified:** `tests/unit/checkpoint-store.test.ts`
- **Verification:** `npx tsc --noEmit` clean; full suite green (108/108 files, 2024/2024 tests).
- **Committed in:** `d03cee8` (Task 1 commit)

**2. [Rule 1 - Bug] Initial `MIN_TAG_SWITCHES=8` was an unverified guess and genuinely flaked**
- **Found during:** Task 2, a follow-up 10-consecutive-run check performed specifically because the plan's "BE SUSPICIOUS OF GREEN" instruction requires satisfying yourself a passing assertion is not a lucky accident
- **Issue:** `MIN_TAG_SWITCHES=8` satisfied the plan's stated constraint on paper ("chosen so that four strictly contiguous blocks (3 switches) fails and genuine interleaving passes") but had never been checked against the real distribution of switch counts a genuinely-overlapping run produces. A follow-up 10-run check showed 3/10 failures with observed switch counts of 6 and 3 (the latter being the falsification-mutation run left uncommitted from testing, correctly excluded from this count) -- genuine overlapping runs legitimately produced as few as 5-6 switches.
- **Fix:** Instrumented ~150 solo runs and 3 full-suite runs (temporarily, never committed) to measure the real distribution: solo runs ranged 5-33 (floor 5, typical mid-teens); full-suite-load runs were higher (27-33) because lock contention adds interleaving rather than removing it. Set `MIN_TAG_SWITCHES=4`, directly below the observed floor. Re-verified 30/30 green and re-ran falsification (b), which still correctly failed ("expected 3 to be greater than 4").
- **Files modified:** `tests/unit/checkpoint-store.test.ts`
- **Verification:** 30 consecutive solo runs green; the required 10-consecutive-run PROOF (see Verification Evidence below) green; falsification (b) still fails at the new threshold; full suite green; `npx tsc --noEmit` clean.
- **Committed in:** `10565c1` (Task 2 refinement commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 bug). Both were direct, necessary consequences of implementing the plan's own design faithfully and its explicit "be suspicious of green" instruction -- no scope creep, no architectural changes.
**Impact on plan:** None on scope. Both fixes were required for the plan's own acceptance criteria (the file typechecking cleanly, and the WR-09 case being genuinely non-flaky rather than merely appearing so in a single lucky run) to be met at all.

## Task Commit Note

Tasks 1 and 2's core mechanism landed in a single commit (`d03cee8`) rather than two, because Task 2's structural interleaving proof reads Task 1's release-ordering event directly (`readCheckpoints(root)`'s row order after the IPC-gated release) -- splitting them would have meant reverting and reapplying the same lines with no independently-testable intermediate state. Task 2's own further correction (the measured threshold) is its own separate commit (`10565c1`), landed after the falsifications below were run against the first commit's already-committed code, satisfying the plan's "commit the file BEFORE mutating" requirement.

## Falsification Evidence (verbatim)

Both falsifications were run against the committed file (`d03cee8`), per the plan's explicit "commit before mutating" requirement (the 03-11 lesson: `git checkout --` after an uncommitted edit would silently destroy it, making a mutation run against an unmutated original indistinguishable from a genuine pass). Both mutations were reverted via `Edit` and confirmed byte-identical to `HEAD` with `git diff --exit-code`, which reported `exit=0` in both cases.

### FALSIFICATION (a) -- neutralise `withLock`'s locking in `.pi/extensions/checkpoint/store.ts`

Mutation: `withLock<T>(file, body)` reduced to `return body();`, bypassing lock acquisition entirely.

```
FAIL  tests/unit/checkpoint-store.test.ts > WR-09 -- concurrent recorders do not lose each other's entries > four overlapping OS processes each recording 150 entries produce all 600 rows
AssertionError: every one of the 600 entries four overlapping processes recorded must be present. A lost entry is a checkpoint the user can never restore, and its loss is silent: expected 61 to be 600 // Object.is equality

- Expected
+ Received

- 600
+ 61
```

Restored: `git diff --exit-code .pi/extensions/checkpoint/store.ts` -> `exit=0`.

### FALSIFICATION (b) -- force the four children to run strictly serially

Mutation (test file only): released and awaited each child's report one at a time in a `for` loop, instead of releasing all four together and awaiting them concurrently.

At `MIN_TAG_SWITCHES=8` (the first attempt):
```
AssertionError: the four writers' rows must be genuinely INTERLEAVED in the store's own recorded order, not four contiguous blocks. Four strictly-serial blocks produce exactly 3 switches; 8 is well above that so a serialised run (FALSIFICATION (b)) turns this red while a genuinely overlapping run stays green: expected 3 to be greater than 8
```

Re-run after tightening to `MIN_TAG_SWITCHES=4` (the shipped value), confirming the falsification still holds at the new threshold:
```
AssertionError: the four writers' rows must be genuinely INTERLEAVED in the store's own recorded order, not four contiguous blocks. Four strictly-serial blocks produce exactly 3 switches; 4 is well above that so a serialised run (FALSIFICATION (b)) turns this red while a genuinely overlapping run stays green: expected 3 to be greater than 4
```

Restored: `git diff --exit-code tests/unit/checkpoint-store.test.ts` -> `exit=0` (before the Task 2 refinement commit).

## Verification Evidence

### 10 consecutive runs of `tests/unit/checkpoint-store.test.ts` at the shipped `MIN_TAG_SWITCHES=4` (the required PROOF)

Command: `for i in 1 2 3 4 5 6 7 8 9 10; do npx vitest run tests/unit/checkpoint-store.test.ts; done`

```
RUN 1:  Test Files  1 passed (1)  |  Tests  17 passed (17)
RUN 2:  Test Files  1 passed (1)  |  Tests  17 passed (17)
RUN 3:  Test Files  1 passed (1)  |  Tests  17 passed (17)
RUN 4:  Test Files  1 passed (1)  |  Tests  17 passed (17)
RUN 5:  Test Files  1 passed (1)  |  Tests  17 passed (17)
RUN 6:  Test Files  1 passed (1)  |  Tests  17 passed (17)
RUN 7:  Test Files  1 passed (1)  |  Tests  17 passed (17)
RUN 8:  Test Files  1 passed (1)  |  Tests  17 passed (17)
RUN 9:  Test Files  1 passed (1)  |  Tests  17 passed (17)
RUN 10: Test Files  1 passed (1)  |  Tests  17 passed (17)
```

**10/10 green.**

### Additional stress check: 30 further consecutive solo runs at `MIN_TAG_SWITCHES=4`

**30/30 green** (0 failures), run specifically to build confidence beyond the minimum required 10 after the threshold-8 attempt was shown to flake.

### Full suite + typecheck (run twice each, before and after the Task 2 threshold refinement)

```
npx vitest run          -> Test Files  108 passed (108)  |  Tests  2024 passed (2024)
npx tsc --noEmit         -> clean, no output
```

Two unrelated, pre-existing intermittent failures (`tests/integration/audit-concurrency.test.ts`, `tests/integration/global-teardown-exit-code.test.ts`) were observed in two of the full-suite runs performed during this plan's work, each in files this plan never touched. Both passed cleanly when re-run in isolation and again on a subsequent full-suite run, confirming they are pre-existing flakes out of scope for this plan (per the executor's scope-boundary rule: only issues directly caused by this plan's own changes are in scope). Logged here rather than in a separate `deferred-items.md` since a full incident writeup was not warranted -- both are known-flaky, unrelated files, and re-running immediately without changes was sufficient to confirm scope.

### Prohibited-mechanism check (grep-checkable, run against the task diff)

```
git diff -- tests/unit/checkpoint-store.test.ts | grep -nE "retry:|it\.skip|describe\.skip|\.todo\(|testTimeout|fileParallelism"
-> NONE FOUND (grep exit code 1)
```

```
grep -n "startAt" tests/unit/checkpoint-store.test.ts        -> NONE FOUND
grep -c "800" tests/unit/checkpoint-store.test.ts             -> 2 (both inside the WR-09 describe block's docstring, explaining the removed mechanism; no executable occurrence)
grep -n '"ipc"' tests/unit/checkpoint-store.test.ts            -> present (stdio array + docstring references)
grep -n "process.send\|child.send" tests/unit/checkpoint-store.test.ts -> present (both directions of the handshake)
grep -n "timeout: 120_000" tests/unit/checkpoint-store.test.ts -> present, unchanged
```

## Issues Encountered

None beyond the two auto-fixed deviations documented above, both anticipated categories (a TypeScript inference gap from adding `"ipc"` to `stdio`, and an unverified concurrency-proof threshold that needed real measurement rather than a single plausible-looking number).

## User Setup Required

None - no external service configuration required. This plan modifies one test file only; no production code changed.

## Next Phase Readiness

- `tests/unit/checkpoint-store.test.ts`'s WR-09 case is now a trustworthy backdrop for every verification run in Phases 09-05 through 09-17, as the plan's objective stated -- it no longer depends on any wall-clock margin, and both of its load-bearing assertions have been demonstrated (via committed-then-mutated falsification) to fail when their subject is genuinely broken.
- No blockers for subsequent Phase 09 plans. This plan touched no production code, so nothing here changes the checkpoint store's shipped behaviour.

---
*Phase: 09-ceremonial-workflows*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `tests/unit/checkpoint-store.test.ts`
- FOUND: `.planning/phases/09-ceremonial-workflows/09-01-SUMMARY.md`
- FOUND commit: `d03cee8` (Task 1 + Task 2 mechanism)
- FOUND commit: `10565c1` (Task 2 threshold refinement)
- FOUND commit: `39bbb09` (this SUMMARY)
