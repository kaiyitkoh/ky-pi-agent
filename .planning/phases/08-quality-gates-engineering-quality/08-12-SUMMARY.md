---
phase: 08-quality-gates-engineering-quality
plan: 12
subsystem: quality
tags: [gate-01, evidence-gate, git, tree-comparison]

# Dependency graph
requires:
  - phase: 08-quality-gates-engineering-quality
    provides: "08-11 (quality/index.ts's runQuickGateStage wired into /quick; the evidence gate's own explicitly-deferred residual, named in evidence.ts:136-143 and docs/WORKFLOWS.md section 4, is what this plan closes)"
provides:
  - "safety/git.ts's currentTree(cwd) -- reads HEAD's tree object id, copying currentSha's fail-closed contract exactly (no sentinel, throws on non-zero exit)"
  - "workflows/evidence.ts's gateCompletion sixth ordered branch: headTree === baseTree rejects, positioned between the headSha===baseSha branch and the isError branch, naming both tree ids"
  - "startRun/endRun/RunState now thread baseTree/headTree, and workflows/index.ts passes currentTree(ctx.cwd) at both call sites inside the same fail-closed try blocks as currentSha"
  - "docs/WORKFLOWS.md section 4 states what an ACCEPT now additionally guarantees (a genuine tree change), names the empty-commit gap as closed, and states the two gaps that remain open and are permanent limits, not bugs (unrelated-content commits; checkout/reset to a genuinely different commit)"
affects: []

tech-stack:
  added: []
  patterns:
    - "Branch (6) is numbered out of execution sequence on purpose: it sits between existing branches (2) and (3) in EXECUTION order, but keeps the label '(6)' throughout code, tests and docs (rather than renumbering the whole docstring) because that is the identifier the plan, this summary and every test use for it -- the docstring states the true execution position explicitly instead of relying on the number to imply it"
    - "currentTree(cwd) reads git rev-parse HEAD^{tree} via spawnSync with shell:false, an exact structural copy of currentSha's fail-closed contract (throws on launch failure and on non-zero exit, no sentinel value) -- the same reasoning currentSha's own docstring gives: no safe default exists for an unknown tree, because an unknown tree can never legitimately match a piece of evidence"
    - "workflows/index.ts's agent_end handler captures sha and tree inside the SAME try/catch, both defaulting to \"\" on any throw -- an empty tree can never accidentally equal a real baseTree (so branch (6) never falsely fires on a capture failure), and an empty sha is still caught downstream by the pre-existing stale-SHA branch (4), so the fail-closed behaviour WR-02 already established for sha is preserved without adding a second failure path"

key-files:
  created: []
  modified:
    - .pi/extensions/safety/git.ts
    - .pi/extensions/workflows/evidence.ts
    - .pi/extensions/workflows/index.ts
    - tests/unit/evidence-gate.test.ts
    - tests/unit/workflow-budgets.test.ts
    - tests/unit/workflows-entry.test.ts
    - tests/integration/quick-workflow.test.ts
    - docs/WORKFLOWS.md

key-decisions:
  - "Branch (6) is placed between branches (2) and (3), per the plan's own explicit instruction, not appended at the end -- (2) catches 'no commit at all' and (6) catches 'a commit that changed nothing', the same class of claim, and both are evaluated before the recorded-failure check (3) so a failure is still checked whenever HEAD genuinely moved to a genuinely different tree"
  - "The WHAT THIS PREDICATE DOES NOT PROVE paragraph's scope was narrowed, not deleted: it no longer claims the empty-commit gap is open (branch (6) closes it), and now states the narrower, still-true residual -- a commit of wholly unrelated content whose tree DIFFERS from the tree at arm time still accepts, because deciding whether a diff contains the CLAIMED work is a semantic judgement no tree/SHA predicate can make"
  - "docs/WORKFLOWS.md section 4 also states a THIRD fact discovered while writing the honest paragraph: HEAD moving via checkout/reset to an OLDER, genuinely different commit (CR-01 iteration 4's own PROBE W1 residual) moves BOTH the SHA and the tree, so branch (6) does not close that gap either -- it is a separate, pre-existing, still-open limit, not something this plan quietly claimed to fix by proximity"
  - "Five pre-existing fixtures in tests/integration/quick-workflow.test.ts used git commit --allow-empty as a stand-in commit for cases whose own point is either an ACCEPT or a specific rejection reason (case 4, case 6 PROBE F, case 7 PROBE P4, case 8 PROBE P7, WR-01 regression) -- now that branch (6) correctly rejects an empty commit's unchanged tree, these fixtures were changed to make a genuine content-changing commit, restoring what each test's own name claims to prove rather than letting it pass (or fail) for an unrelated reason"

requirements-completed: [GATE-01]

# Metrics
duration: "~70min"
completed: 2026-08-15
---

# Phase 08 Plan 12: The Evidence Gate's Tree-Comparison Branch Summary

**`gateCompletion` gains a sixth ordered branch comparing `git rev-parse HEAD^{tree}` at arm time and at `agent_end`, so `git commit --allow-empty` (and any other commit whose tree is byte-identical to its parent's) can no longer satisfy a `/quick` completion claim.**

## Performance

- **Duration:** ~70 min
- **Tasks:** 2 (both complete)
- **Files modified:** 8 (0 created, 8 modified)

## Accomplishments

- `.pi/extensions/safety/git.ts` gained `currentTree(cwd)`, an exact structural copy of `currentSha`'s fail-closed contract (`git rev-parse HEAD^{tree}`, `spawnSync` with `shell:false`, throws on launch failure or non-zero exit, no sentinel).
- `.pi/extensions/workflows/evidence.ts`'s `gateCompletion` gained branch (6): `headTree === baseTree` rejects, naming both tree ids, positioned immediately after the `headSha === baseSha` branch (2) and before the recorded-failure branch (3) — matching the plan's own binding-order instruction exactly. `startRun`/`endRun`/`RunState` thread `baseTree`/`headTree` alongside the existing `baseSha`/`headSha`. The docstring's WHAT THIS PREDICATE DOES NOT PROVE paragraph was narrowed: the empty-commit sentence is struck; the narrower, still-true unrelated-content limit remains stated.
- `.pi/extensions/workflows/index.ts` passes `currentTree(ctx.cwd)` at both call sites (`startRun` inside `/quick`'s own outer try, and `agent_end`'s handler, inside the same try as `currentSha`), and the accept notification text now says "with a changed tree" without overstating that the work itself was verified.
- `docs/WORKFLOWS.md` section 4 rewritten to state precisely what an ACCEPT now additionally guarantees, what Phase 8 plan 08-12 closes (named explicitly), and what remains open as two SEPARATE, permanent limits: unrelated-content commits (tree differs, semantic judgement needed) and checkout/reset to an older commit (moves both SHA and tree, CR-01 iteration 4's own residual, untouched by this plan).
- `tests/unit/evidence-gate.test.ts`: the pre-existing `ROWS` table now threads two genuinely different real tree ids (`treeA`/`treeB`, read via a local `treeOfSha` helper and the real `currentTree`) through `gateCompletion`'s new 5-arg signature. A new `GATE-01` describe block, on its own dedicated temp repo (so it cannot shift what `head`/`shaA`/`shaB` mean for the pre-existing table), proves: EMPTY COMMIT rejects naming both tree ids; a PAIRED POSITIVE (genuine content change) accepts; ORDER PRESERVED (a failed tool result still rejects with the failure reason even when the tree DID change, proving branch (6) did not displace branch (3)); and `currentTree` throws on a non-repository directory.
- `tests/unit/workflow-budgets.test.ts`: `evidence.ts`'s per-file budget raised 340 → 390 (measured 381 raw lines) and the `workflows/` directory aggregate raised 430 → 480 (measured 476), both dated and reasoned; `index.ts`'s per-file budget stayed at 100 (measured 95, still within the existing ceiling).

## Task Commits

1. **Task 1 (`currentTree`, `gateCompletion` branch (6), `startRun`/`endRun` threading, wiring)** — `3884b80` (feat)
2. **Task 2 (empty-commit/paired-positive/order-preserved/throw tests, docs section 4 rewrite)** — `78187cd` (test)

**Plan metadata:** _pending — this commit_

## Files Created/Modified

- `.pi/extensions/safety/git.ts` — `currentTree(cwd)`, copying `currentSha`'s fail-closed contract.
- `.pi/extensions/workflows/evidence.ts` — `gateCompletion`'s sixth ordered branch; `RunState`/`startRun`/`endRun` thread trees.
- `.pi/extensions/workflows/index.ts` — passes `currentTree(ctx.cwd)` at both call sites; updated accept notification text.
- `tests/unit/evidence-gate.test.ts` — `ROWS` table threads real tree ids; new GATE-01 describe block (empty commit, paired positive, order preserved, throw).
- `tests/unit/workflow-budgets.test.ts` — raised `evidence.ts`'s per-file budget and the `workflows/` directory aggregate, both dated.
- `tests/unit/workflows-entry.test.ts` — one `startRun()` call site updated to the new 3-arg signature (Rule 3).
- `tests/integration/quick-workflow.test.ts` — five `git commit --allow-empty` fixtures changed to genuine content-changing commits, restoring what each test's own name claims to prove (Rule 1).
- `docs/WORKFLOWS.md` — section 4 rewritten to state what the gate now proves, what it closes, and what remains open.

## Decisions Made

See `key-decisions` in the frontmatter. In addition:

- **`currentTree` is not exposed through `evidence.ts` itself** — it lives in `safety/git.ts` beside `currentSha`/`currentBranch`, and `evidence.ts` continues to import nothing from `safety/` per CONTEXT.md decision 8 (subsystems meet only inside a command). `workflows/index.ts` is the command that imports both and threads the values through.
- **The new GATE-01 describe block in `evidence-gate.test.ts` uses its own dedicated temp repo (`gate01Repo`)**, separate from the pre-existing `repo`/`shaA`/`shaB` fixture, because the pre-existing `ROWS` table's `it`s read `currentSha(repo)`/`currentTree(repo)` fresh on every run — a later commit to the SAME repo would silently change what "HEAD" means for every row that ran after it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — blocking compile error] `tests/unit/workflows-entry.test.ts` called `startRun()` with the old 2-arg signature**
- **Found during:** Task 1 (typecheck after extending `startRun`'s signature)
- **Issue:** `npx tsc --noEmit` failed: `startRun(cwd, "fixture-base-sha")` no longer matched the new 3-arg signature.
- **Fix:** Updated the one call site to `startRun(cwd, "fixture-base-sha", "fixture-base-tree")`. The test only exercises `armedCwd()`/disarm behaviour, so the tree value's content is immaterial to what it asserts.
- **Files modified:** `tests/unit/workflows-entry.test.ts`
- **Verification:** `npx tsc --noEmit` clean; the file's own suite green.
- **Committed in:** `3884b80` (Task 1 commit)

**2. [Rule 1 — bug, pre-existing tests silently weakened by correct new behaviour] Five `quick-workflow.test.ts` fixtures used `git commit --allow-empty` as a stand-in commit**
- **Found during:** Task 2 (running the full suite after wiring branch (6))
- **Issue:** Case 4, case 6 (PROBE F), case 8 (PROBE P7) and the WR-01 regression test all broke outright — each expected either an ACCEPT or a rejection reason naming a specific failing/blocked tool, but branch (6) now correctly rejects an allow-empty commit's byte-identical tree first, replacing the expected outcome with a tree-comparison verdict. Case 7 (PROBE P4) did not break, but only because it never asserted the rejection reason's content — it was passing for the wrong reason (satisfied by the new tree-comparison message instead of the blocked-push message its own name and docstring claim to test).
- **Fix:** All five fixtures' commit commands were changed from `git commit --allow-empty -m "..."` to a genuine content-changing commit (`echo ... >> file && git add file && git commit -m "..."`). Case 4's audit-row filter (which matched the literal string `"git commit --allow-empty"`) was updated to match the new `COMMIT_COMMAND` variable. Case 7 gained an explicit `row.reason` assertion (`toContain("bash")`) so it once again demonstrates that the BLOCKED push, not the tree state, is what its own rejection is about.
- **Files modified:** `tests/integration/quick-workflow.test.ts`
- **Verification:** `npx vitest run tests/integration/quick-workflow.test.ts` — 14/14 green after the fix; full suite (106 files / 1941 tests) green afterward.
- **Committed in:** `78187cd` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking compile error, 1 bug in pre-existing tests exposed by correct new behaviour)
**Impact on plan:** Both auto-fixes were necessary consequences of `startRun`/`endRun`/`gateCompletion`'s signature change and branch (6)'s new, correct rejection of empty commits. No scope creep — no test's assertion intent was weakened; each now proves what its own name claims again.

## Known Stubs

None. `currentTree` genuinely shells `git rev-parse HEAD^{tree}` in production; branch (6) genuinely compares two tree ids read from real git state at both call sites in `/quick`'s own command handler.

## Threat Flags

None beyond what the plan's own threat register already names and mitigates (T-08-45..T-08-48, all exercised directly: the real empty-commit-and-paired-positive proof, `currentTree`'s asserted throw, the order-preserved case, and the grep-absent "work verified" phrasing). No new network endpoint, auth path, file-access pattern, or schema change at a trust boundary was introduced.

## Falsification (per Task 2's own acceptance criteria)

Both task commits (`3884b80`, `78187cd`) were made BEFORE any mutation, per the plan's own "Commit before falsifying" instruction. Each mutation was reverted via `git checkout -- .pi/extensions/workflows/evidence.ts` and confirmed via `git diff --stat` producing no output before the next.

1. **Delete branch (6) entirely.** `npx vitest run tests/unit/evidence-gate.test.ts -t "EMPTY COMMIT"`: 1 of 1 failed — `an empty commit must not satisfy a completion claim -- this is the exact gap Phase 8 closes -- got {"ok":true,"sha":"..."}`. Restored; re-ran the full evidence-gate suite: 24/24 green.
2. **Move branch (6) ahead of branch (3), and further ahead than its documented position (ahead of branch (2) too).** The plan's own acceptance criteria name this falsification as making "the order-preserved case" turn red; executed exactly as described, the dedicated ORDER PRESERVED test (failure + a genuinely CHANGED tree) stayed green, because branch (6)'s condition (`headTree === baseTree`) is false whenever the tree genuinely changed regardless of its position relative to branch (3) — that is precisely what the acceptance criteria's own wording ("even when the tree DID change") describes, and it is why that specific test's outcome is invariant under this reordering. Moving branch (6) ahead of branch (2) instead (a stronger reordering, genuinely ahead of everything) DID turn a test red: `npx vitest run tests/unit/evidence-gate.test.ts` — 1 of 24 failed, the pre-existing `CR-01a` row (`HEAD never moved: no commit landed, one passing record at the unchanged HEAD`), whose reason no longer contained `"no commit"` because branch (6) fired first with a tree-comparison message for a case where `headSha === baseSha` (and therefore, trivially, `headTree === baseTree` too). This is real, executed evidence that branch (6)'s position is load-bearing, caught by the pre-existing ordering assertions in this same file even though the newly-written dedicated test does not itself depend on that particular reordering. Restored; re-ran `tests/unit/evidence-gate.test.ts`, `tests/unit/workflow-budgets.test.ts`, `tests/integration/quick-workflow.test.ts`, `tests/unit/workflows-entry.test.ts`: 92/92 green.

Final state: `npx tsc --noEmit` clean; `npx vitest run` 106 files / 1941 tests, all green, run once after every falsification was restored.

## Issues Encountered

- **The plan's own falsification instruction ("move branch (6) ahead of branch (3) → the order-preserved case turns red") does not literally apply to the dedicated ORDER PRESERVED test as written**, because that test's own scenario (a failure recorded alongside a genuinely CHANGED tree) makes branch (6)'s condition false regardless of its position relative to branch (3) — reordering two branches whose conditions are mutually exclusive on a given input cannot change that input's outcome. Investigated by executing the reordering and observing which test (if any) actually turned red rather than assuming the plan's exact wording; the CR-01a row in the pre-existing table did, for the reason given above. Documented rather than silently working around, since the honest finding is that ordering-sensitivity requires BOTH branch conditions to hold simultaneously on the same input, which only the `headSha === baseSha` (and therefore trivially `headTree === baseTree`) case exercises among this file's existing fixtures.

## User Setup Required

None — no external service configuration required. No `[RUNBOOK]` item executed; no real provider inference request issued. No package was installed.

## Next Phase Readiness

- The evidence gate's one explicitly-deferred residual (named in `evidence.ts:136-143` and `docs/WORKFLOWS.md` section 4 before this plan) is closed for the empty-commit case, with the two remaining, permanent limits (unrelated-content commits; checkout/reset to an older commit) stated honestly in the same section rather than implied to be fixed.
- `safety/` still imports nothing from `routing/` — verified directly (`grep -n "^import" .pi/extensions/safety/git.ts` shows only `node:child_process`).
- Plan 08-13 (docs/RUNBOOK.md's RB-08-01/02/03 entries) is untouched by this plan, per the autonomous-run rules.

---
*Phase: 08-quality-gates-engineering-quality*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `.pi/extensions/safety/git.ts` (modified, `currentTree` present)
- FOUND: `.pi/extensions/workflows/evidence.ts` (modified, branch (6) present)
- FOUND: `.pi/extensions/workflows/index.ts` (modified, both `currentTree` call sites present)
- FOUND: `tests/unit/evidence-gate.test.ts` (modified, GATE-01 describe block present)
- FOUND: `tests/unit/workflow-budgets.test.ts` (modified, budgets raised and dated)
- FOUND: `tests/unit/workflows-entry.test.ts` (modified, call site fixed)
- FOUND: `tests/integration/quick-workflow.test.ts` (modified, five fixtures fixed)
- FOUND: `docs/WORKFLOWS.md` (modified, section 4 rewritten)
- FOUND commit `3884b80` (Task 1)
- FOUND commit `78187cd` (Task 2)
- `npx tsc --noEmit`: clean
- `npx vitest run`: 106 files / 1941 tests, all green
