---
phase: 06-walking-skeleton-quick-evidence-gate
plan: 03
subsystem: testing
tags: [vitest, line-budget, registry-completeness, ci-gate, workflows]

requires:
  - phase: 06-02
    provides: "/quick at 73 raw lines (.pi/extensions/workflows/index.ts) and docs/WORKFLOWS.md's D-1/D-8/D-11 rationale, which this plan's registry implements as enforcement"
provides:
  - "tests/unit/workflow-budgets.test.ts -- the authoritative WORKFLOW_BUDGETS registry, a raw-line counter, a per-file budget loop, an explicit /quick 80-line ceiling, a directory-total ratchet (D-11), and registry completeness in both directions (present-but-undeclared, declared-but-absent), all over a git-index-union-working-tree discovery set spanning .pi/extensions/workflows/**/*.ts, .pi/prompts/**/*.md and .pi/skills/**/*.md"
affects: [09-ceremonial-workflows]

tech-stack:
  added: []
  patterns:
    - "Registry completeness asserted in BOTH directions as two standalone describe blocks, never folded into the per-file it.each loop -- a loop over the registry cannot see what the registry omits"
    - "Vacuity guards (non-emptiness of the discovered set AND the registry) precede every property assertion, following extension-layout.test.ts's house convention"
    - "A directory-total ratchet with a stated measurement date closes the offloading loophole a per-file budget alone cannot: moving lines into a private helper does not shrink the aggregate"

key-files:
  created:
    - tests/unit/workflow-budgets.test.ts
  modified: []

key-decisions:
  - "The registry (WORKFLOW_BUDGETS) is the single authoritative source of every workflow file's budget -- docs/WORKFLOWS.md (06-02) deliberately carries no numbers, per decision D-8"
  - "countRawLines is readFileSync(f,\"utf-8\").split(\"\\n\").length with zero stripping -- MUTATION 2 measured the comment-excluding alternative's loophole at 16 lines on index.ts alone (74 raw vs 58 comment-excluding)"
  - "WORKFLOWS_DIR_TOTAL_BUDGET is 360 (measured 353 -- 74+279 by this file's own counter -- rounded up to the next ten), a ratchet with 7 lines of incidental headroom, not a deliberate buffer"
  - "Discovery is git-index UNION working-tree (D-9) and spans three directories/.extension shapes: .pi/extensions/workflows/*.ts, .pi/prompts/*.md, .pi/skills/*.md (D-10) -- proven by MUTATION 5 (the markdown dodge) actually failing before the fix would exist"

patterns-established:
  - "A near-zero-headroom ratchet aggregate provides incidental defense-in-depth against undeclared files large enough to breach it, but is not a substitute for an explicit present-but-undeclared completeness check -- proven by re-running MUTATION 7 with a file small enough to stay under the aggregate"

requirements-completed: [FLOW-11]

duration: ~35min
completed: 2026-08-14
---

# Phase 6 Plan 3: The Workflow Line-Budget Registry Summary

**`tests/unit/workflow-budgets.test.ts` (8 tests): a single WORKFLOW_BUDGETS registry enforcing `/quick`'s 80-line ceiling and `evidence.ts`'s 280-line budget, a 360-line directory-total ratchet that closes the offloading loophole, and registry completeness in both directions over a git-index/working-tree union spanning `.ts` workflows and `.md` prompts/skills -- proven by seven executed falsifications, not assumed.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-14T22:44:00+08:00 (approx, first Read call)
- **Completed:** 2026-08-14T22:53:00+08:00
- **Tasks:** 2
- **Files modified:** 1 (created)

## Accomplishments

- `tests/unit/workflow-budgets.test.ts` created with the single authoritative `WORKFLOW_BUDGETS` registry (decision D-8), a zero-stripping raw-line counter (`countRawLines`), a per-file `it.each` budget loop, an explicit greppable `/quick` 80-line ceiling test, and a `WORKFLOWS_DIR_TOTAL_BUDGET` directory-aggregate ratchet (decision D-11) -- 6 tests, all green
- Registry completeness extended in both directions: present-but-undeclared (a discovered file absent from the registry fails) and declared-but-absent (a registry entry naming a missing file fails) -- 2 more tests, both green, 8 total
- Discovery (`discoverWorkflowFiles`) is the union of `trackedFiles()` (git index) and a locally reimplemented `walkOnDisk()` (working tree), across `.pi/extensions/workflows/*.ts`, `.pi/prompts/*.md` and `.pi/skills/*.md` -- decisions D-9 and D-10, both proven live by falsification (MUTATION 5 specifically proves the markdown dodge is closed)
- Two vacuity guards precede every property assertion in the first `describe` block, following `extension-layout.test.ts`'s house convention
- Seven falsifications executed and reverted (see below), each with real pasted vitest output, plus one supplementary falsification beyond the plan's minimum to fully isolate test 6's load-bearing property

## Task Commits

Each task was committed atomically:

1. **Task 1: the registry, the counter, and the per-file + aggregate budgets** - `869413b` (test)
2. **Task 2: registry completeness, both directions** - `35f57db` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `tests/unit/workflow-budgets.test.ts` - new file, 199 lines. `WORKFLOW_BUDGETS` (index.ts at 80, `why` naming FLOW-01; evidence.ts at 280, `why` naming GATE-07), `WORKFLOWS_DIR_TOTAL_BUDGET = 360`, `countRawLines`, `walkOnDisk` (copied in shape from `extension-layout.test.ts`, not imported), `discoverWorkflowFiles` (index-union-disk, three directories, D-9/D-10), two `describe` blocks: budgets-enforce (6 tests) and completeness (2 tests)

## Decisions Made

D-8 through D-11 from the plan's `<decisions>` block were followed as written; no new architectural decisions were required. Judgement calls exercised in the moment:

- **Measured numbers corrected mid-task to match the function under test.** `06-02-SUMMARY.md` records `wc -l` counts (index.ts 73, evidence.ts 278), but `countRawLines` (`split("\n").length`, per decision D-1) reports one more line per file when the file ends with a trailing newline (index.ts 74, evidence.ts 279, sum 353). The docstring and `why` fields were written against the actual `countRawLines` output, not the `wc -l` figure from the prior plan's summary, so the registry's own stated numbers are internally consistent with what the test computes. `WORKFLOWS_DIR_TOTAL_BUDGET` (360, next multiple of ten above 353) is unaffected either way.
- **The evidence.ts budget (280) was set from its own measured count**, per the plan's explicit instruction ("its measured count rounded up to the next multiple of ten"), since no ROADMAP number exists for it the way 80 exists for `/quick`.

## Deviations from Plan

None requiring a rule -- the plan's `<action>` sections were followed task-for-task. One **finding**, documented rather than silently worked around:

**MUTATION 7, as literally specified, did not reproduce "nothing fails."** The plan's acceptance criterion reads: "delete test 6 entirely -> MUTATION 4's 500-line file no longer fails anything, proving test 6 is the load-bearing assertion." Deleting the present-but-undeclared test and re-adding the same 500-line `ceremony.ts` from MUTATION 4 still failed -- the directory-aggregate test (test 5, decision D-11) independently caught it, because `WORKFLOWS_DIR_TOTAL_BUDGET`'s ratchet has only 7 lines of incidental headroom (360 - 353) and a 500-line addition blows through any near-zero headroom regardless of whether it is declared. This is not a bug: it is defense-in-depth the plan's authors likely did not anticipate interacting with MUTATION 4's specific file size. To genuinely isolate whether test 6 is load-bearing (rather than redundant with the aggregate), a **supplementary falsification** was run: with test 6 still deleted, a 3-line undeclared file (well under the 7-line headroom) was added -- all 7 remaining tests passed, proving test 6 *is* uniquely load-bearing for undeclared files that don't happen to be large enough to also trip the aggregate. Both runs are pasted below. Test 6 was then restored and the file cleaned up; final state is 8 passing tests, matching pre-mutation.

## Issues Encountered

None blocking. The trailing-newline discrepancy between `wc -l` and `split("\n").length` (noted above) required re-measuring rather than trusting the prior plan's summary numbers verbatim -- caught by actually running `countRawLines`'s own logic against the real files before writing the registry, per "be suspicious of green."

## Known Stubs

None. Every number in `WORKFLOW_BUDGETS` and `WORKFLOWS_DIR_TOTAL_BUDGET` was measured against the real, already-shipped files (`.pi/extensions/workflows/index.ts`, `.pi/extensions/workflows/evidence.ts`), not estimated or placeholder-derived.

## Threat Flags

None beyond what the plan's `<threat_model>` already names. `discoverWorkflowFiles()` reads only `join(repoRoot(), relPath)` against three hardcoded directory literals (`.pi/extensions/workflows`, `.pi/prompts`, `.pi/skills`); nothing accepts a path from the environment or from a caller, satisfying T-06-16 by construction. No package was installed and `.github/workflows/ci.yml` is untouched (verified: `git diff --name-only .github/workflows/ci.yml` produces no output), satisfying T-06-SC.

## Falsifications Executed (all seven plan-required mutations, plus one supplementary)

All commands were run for real from the repo root; output pasted verbatim (trimmed to the relevant lines). Every mutation was reverted and confirmed clean via `git status --porcelain` before the next step.

### MUTATION 1 -- inflate index.ts past 80 lines

Appended 10 blank lines to `.pi/extensions/workflows/index.ts` (73 -> 84 raw by `wc -l`; the test's own `split("\n").length` measure reported 84 too since the file already had no trailing blank line before mutation).

```
 ❯ tests/unit/workflow-budgets.test.ts (6 tests | 3 failed) 6ms
     × '.pi/extensions/workflows/index.ts' stays within its declared budget 2ms
     × /quick (index.ts) never exceeds the explicit 80-line ceiling 1ms
     × the workflows/ directory total never exceeds its ratchet aggregate 1ms

AssertionError: .pi/extensions/workflows/index.ts is 84 raw lines, over its budget of 80 ...
AssertionError: .pi/extensions/workflows/index.ts is 84 raw lines -- the ROADMAP states that "above 100 it has FAILED"; ...
AssertionError: decision D-11: .pi/extensions/workflows/**/*.ts totals 363 raw lines against a ratchet of 360 ...

 Test Files  1 failed (1)
      Tests  3 failed | 3 passed (6)
```

Both test 3 (per-file budget) AND test 4 (explicit ceiling) went red as the plan requires; test 5 (aggregate) also went red incidentally. Reverted with `git checkout -- .pi/extensions/workflows/index.ts`; confirmed back to 73 lines and `git status --porcelain` clean.

### MUTATION 2 -- comment-excluding counter, measure the loophole

Replaced `countRawLines`'s body with a block-comment-stripping, blank-line-and-`//`-filtering variant.

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

Test 4 (the explicit ceiling) still passed, as the plan predicts. Measured difference on `index.ts`:

```
index.ts raw: 74 comment-excluding: 58 loophole size: 16
```

**16 raw lines of loophole on a single file already at its budget** -- decision D-1's rejection of a comment-excluding count is not theoretical. Reverted `countRawLines` to the raw-line body; re-ran, confirmed 6/6 green.

### MUTATION 3 -- lower the aggregate below the measured total

Set `WORKFLOWS_DIR_TOTAL_BUDGET` to `352` (measured total 353 minus 1).

```
 ❯ tests/unit/workflow-budgets.test.ts (6 tests | 1 failed) 5ms
     × the workflows/ directory total never exceeds its ratchet aggregate 2ms

AssertionError: decision D-11: .pi/extensions/workflows/**/*.ts totals 353 raw lines against a ratchet of 352 ...

 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

Test 5 went red as required; the other five tests were unaffected. Reverted to `360`; re-ran, confirmed 6/6 green.

### MUTATION 4 -- undeclared 500-line .ts file

Created `.pi/extensions/workflows/ceremony.ts` (500 lines).

```
 FAIL  ... the workflows/ directory total never exceeds its ratchet aggregate
AssertionError: ... totals 854 raw lines against a ratchet of 360 ...

 FAIL  ... present-but-undeclared: every discovered workflow file has a budget entry
AssertionError: ... expected [ Array(1) ] to deeply equal []
+ [
+   ".pi/extensions/workflows/ceremony.ts",
+ ]

 Test Files  1 failed (1)
      Tests  2 failed | 6 passed (8)
```

Test 6 (present-but-undeclared) went red, naming the exact offending path, as required. Deleted `ceremony.ts`; re-ran, confirmed 8/8 green and `git status --porcelain` clean of the mutation.

### MUTATION 5 -- the markdown dodge: undeclared .md under .pi/prompts/

Created `.pi/prompts/grill.md` (200 lines) -- `.pi/prompts/` did not exist before this mutation.

```
 ❯ tests/unit/workflow-budgets.test.ts (8 tests | 1 failed) 7ms
     × present-but-undeclared: every discovered workflow file has a budget entry 4ms

AssertionError: ... expected [ '.pi/prompts/grill.md' ] to deeply equal []
+ [
+   ".pi/prompts/grill.md",
+ ]

 Test Files  1 failed (1)
      Tests  1 failed | 7 passed (8)
```

The markdown dodge is proven closed, not assumed: test 6 caught the `.md` file under `.pi/prompts/` naming the exact path. Deleted `grill.md` and removed the now-empty `.pi/prompts/` directory; re-ran, confirmed 8/8 green and `git status --porcelain` clean.

### MUTATION 6 -- stale registry entry

Added `{ file: ".pi/extensions/workflows/nope.ts", budget: 10, why: "MUTATION 6 (temporary)" }` to `WORKFLOW_BUDGETS`.

```
 ❯ tests/unit/workflow-budgets.test.ts (9 tests | 2 failed) 8ms
     × '.pi/extensions/workflows/nope.ts' stays within its declared budget 2ms
     × declared-but-absent: every WORKFLOW_BUDGETS entry names a file that still exists 2ms

Error: ENOENT: no such file or directory, open '...\.pi\extensions\workflows\nope.ts'
 ❯ countRawLines tests/unit/workflow-budgets.test.ts:73:9

AssertionError: ... expected [ '.pi/extensions/workflows/nope.ts' ] to deeply equal []
+ [
+   ".pi/extensions/workflows/nope.ts",
+ ]

 Test Files  1 failed (1)
      Tests  2 failed | 7 passed (9)
```

Test 7 (declared-but-absent) went red naming the exact stale path, as required. The per-file `it.each` loop also threw (`ENOENT`) on the same nonexistent file -- expected collateral, since `countRawLines` has no defensive existence check and none is needed (that is precisely what test 7 governs). Reverted the registry addition; re-ran, confirmed 8/8 green.

### MUTATION 7 -- delete test 6, re-probe MUTATION 4's file (plus a supplementary isolation run)

Deleted the `present-but-undeclared` `it()` block entirely, then re-created the same 500-line `.pi/extensions/workflows/ceremony.ts` from MUTATION 4.

```
 ❯ tests/unit/workflow-budgets.test.ts (7 tests | 1 failed) 6ms
     × the workflows/ directory total never exceeds its ratchet aggregate 2ms

AssertionError: ... totals 854 raw lines against a ratchet of 360 ...

 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

**This is the finding documented above under Deviations:** contrary to the plan's literal expectation ("no longer fails anything"), the aggregate test (D-11's ratchet, which has only 7 lines of incidental headroom) still caught this specific 500-line file. To genuinely isolate test 6's load-bearing property from this incidental overlap, a supplementary falsification was run with test 6 still deleted: `ceremony.ts` was removed and replaced with a 3-line undeclared file (`.pi/extensions/workflows/tiny.ts`, well under the aggregate's 7-line headroom):

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

All 7 remaining tests passed -- proving test 6 is genuinely the load-bearing assertion for undeclared files, independent of the aggregate's incidental catch on large ones. Deleted `tiny.ts`, restored the `present-but-undeclared` `it()` block verbatim; re-ran, confirmed 8/8 green.

## Full Verification

```
$ npx vitest run tests/unit/workflow-budgets.test.ts
 Test Files  1 passed (1)
      Tests  8 passed (8)

$ npx tsc --noEmit
(no output -- exit 0)

$ npx vitest run
 Test Files  82 passed (82)
      Tests  1394 passed (1394)
   Duration  32.22s

$ git diff --name-only .github/workflows/ci.yml
(no output -- unmodified)

$ ls .pi/prompts .pi/skills
(both absent, as before this plan)

$ git status --porcelain
(clean at the end of this plan's work)
```

## Next Phase Readiness

- FLOW-11 is complete: over-budget fails, unlisted fails (both `.ts` under `workflows/` and `.md` under `prompts/`), stale-entry fails, and the directory aggregate independently fails on offloading -- every direction proven by an executed falsification, not assumed.
- The markdown dodge (`.pi/prompts/*.md`, `.pi/skills/*.md`) is proven closed, satisfying the phase's explicit instruction that this not be assumed.
- No second CI mechanism was added; `.github/workflows/ci.yml`'s existing `npx vitest run` step is the only enforcement, unchanged.
- Phase 9's four ceremonial workflows (`/grill`, `/plan`, `/execute`, `/review`) will each need a `WORKFLOW_BUDGETS` entry with a `why` at the moment they are authored, or `tests/unit/workflow-budgets.test.ts` fails the build immediately -- this is the mechanism the ROADMAP asked for.
- No blockers. Full suite (1394 tests / 82 files) and `tsc --noEmit` both green.

---
*Phase: 06-walking-skeleton-quick-evidence-gate*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: tests/unit/workflow-budgets.test.ts
- FOUND commit: 869413b (Task 1)
- FOUND commit: 35f57db (Task 2)
