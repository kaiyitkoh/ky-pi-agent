---
phase: 09-ceremonial-workflows
fixed_at: 2026-10-12T21:37:26Z
review_path: .planning/phases/09-ceremonial-workflows/09-REVIEW.md
iteration: 3
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 9: Code Review Fix Report

**Fixed at:** 2026-10-12T21:37:26Z
**Source review:** .planning/phases/09-ceremonial-workflows/09-REVIEW.md
**Iteration:** 3 (final)

**Summary:**
- Findings in scope: 4 (2 Critical, 2 Warning).
- Fixed: 4. All four change gate or guard logic, so each is marked "requires human verification".
- Skipped: 0.
- Out of scope but done because the guidance asked for it: most of IN-01, the comment-rule items.

**Verification:**
- After each fix I ran its targeted tests plus `comment-discipline`, `workflow-budgets` and `quality-rules`, with `--maxWorkers=2`, one run at a time.
- `npx tsc --noEmit` was clean after CR-01 and after WR-02.
- Final combined run of 12 files gave 483 passed and 1 skipped. The files were `git-policy`, `policy-compose`, `path-policy`, `execute-workflow`, `review-command`, `review-mr`, `ceremony-gates`, `grill-command`, `artifact-count` and the three standing checks. The skipped test is the POSIX-only glab stub.
- I did not run the full suite or audit-concurrency.

**Constraints held:**
- **FEATURES ceilings:** none moved. Measured totals are now grill 235/250, plan 199/200 (untouched), execute 194/250, review 201/250 and quick 90/100 (untouched).
- **Budget rows:** these were re-measured with ceil(measured/10)*10, and the measured figure went into each `why`:
  - `grill/index.ts`: 170 to 180 (measured 175)
  - `review/index.ts`: 150 to 160 (measured 151)
  - the grill directory: 1160 to 1170 (measured 1165)
  - the execute directory: 810 to 820 (measured 816, then 814 after the IN-01 header cut, which still rounds to 820)
- **Error budget:** `ERROR_BUDGET_ON_OWN_SOURCE` is unchanged.
- **External systems:** no glab ran and no remote was contacted. The worktree test uses a local `git worktree add`.
- **Commits:** explicit paths only, no push, no `--no-verify`. `.planning/phases/12-openspec-opt-in-skill/` was not touched.

## Fixed Issues

### CR-01: Harness state in the work repo makes every `/execute` verification and every `/review` "dirty", and `.pi/logs/` gets committed

**Files modified:** `.pi/extensions/execute/progress.ts`, `.pi/extensions/execute/index.ts`, `.pi/extensions/review/index.ts`, `.pi/extensions/grill/index.ts`, `docs/WORKFLOWS.md`, `tests/integration/execute-workflow.test.ts`, `tests/integration/review-command.test.ts`, `tests/integration/ceremony-gates.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** a6e0985
**Status:** fixed: requires human verification

**Applied fix:**
- **`ensureHarnessIgnored`** replaces `ensureWorkIgnored`:
  - For each of `.pi/work/`, `.pi/logs/` and `.pi/state/`, it probes with `git check-ignore -q`.
  - Any directory not yet ignored is appended to the file that `git rev-parse --git-path info/exclude` names, so worktrees resolve correctly.
  - It is idempotent: once a directory is ignored, the probe passes and nothing more is appended.
  - An unexpected probe status throws, so the command refuses.
- **Pattern choice:** the entries are written as `**/<dir>`. The checkpoint store writes at the repo root, while the logs and work artifacts are written at the cwd.
- **`uncommittedPaths`** is now a plain `git status --porcelain --untracked-files=all` with no carve-outs.
- **Callers:** `/grill` (inside its pre-flight try), `/execute` (at arm) and `/review` (before its clean-tree check) all call it.
- **Brief:** the `/execute` brief now says to stage only the changed files, with `git add <path>...`.

**Tests:**
- **`/execute`:** the temp repo has no `.gitignore`. The test writes `.pi/state/checkpoints.json` through the real `checkpoint/store.ts#recordCheckpoint`, and writes a `.pi/logs/wire-x.jsonl`, before the verification run. The task records, and a following `git add -A` stages nothing.
- **`/review`:** the same state written before the run still opens the MR.
- **Adjusted test:** the "stands down" test in `ceremony-gates` now ignores the new ignore notice that `/grill` emits when it arms.

### CR-02: `git push -o -d origin feat` passes the push guard as a delete

**Files modified:** `.pi/extensions/safety/git.ts`, `tests/unit/git-policy.test.ts`
**Commit:** 6416b9b
**Status:** fixed: requires human verification

**Applied fix:** `deleting` is now set inside the parsing loop, only on `--delete`/`-d` tokens the loop does not consume as the value of `--repo`, `-o`, `--push-option`, `--receive-pack` or `--exec`.

**New rows:**
- Block: `-o -d origin feature/x`, `--push-option --delete origin feature/x`, `--exec -d origin feature/x` and `--receive-pack --delete origin feature/x`.
- Allow: `-o ci.skip origin -d feature/old`, a genuine delete behind a consumed value.

The file now has 102 tests, all passing.

### WR-01: The change gate counts a typecheck that never saw the change

**Files modified:** `.pi/extensions/quality/index.ts`, `docs/WORKFLOWS.md`, `tests/integration/execute-workflow.test.ts`
**Commit:** 5eeed5a
**Status:** fixed: requires human verification

**Applied fix:**
- In `runChangeGateStage`, the typecheck leg is UNAVAILABLE ("no changed TypeScript/JavaScript file for tsc to check") unless the changed set contains a TS/JS path.
- Relevance is decided on the full changed list, so deleting a TS file still runs tsc.
- WORKFLOWS section 7 says a root `tsconfig.json` never vouches for a Terraform, Python or docs change.

**Tests:** both use a stubbed passing tsc.
- A `.tf`-only change with a root `tsconfig.json` asks for approval and reports `typecheck: UNAVAILABLE (no changed TypeScript/JavaScript file`. A decline records nothing.
- A `.ts` change still records `typecheck: PASS`.

**Not changed:** the arm-time baseline in `/execute` still runs tsc for every change. It only decides whether the leg is skipped later, so it cannot produce a false PASS.

### WR-02: The ledger is keyed only by slug in the shared git common dir

**Files modified:** `.pi/extensions/execute/ledger.ts`, `.pi/extensions/grill/index.ts`, `docs/WORKFLOWS.md`, `tests/integration/ceremony-gates.test.ts`, `tests/integration/review-command.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** 7cba8cf
**Status:** fixed: requires human verification

**Applied fix:**
- **Per-worktree file:** a new exported `ledgerFile(cwd, slug)` names `<common>/kypi-ledger/<slug>.<sha256(show-toplevel) first 12 hex chars>.jsonl`. Every worktree shares one key file.
- **Re-used slug:** a fresh `/grill` refuses a slug that still has a ledger in this worktree. The refusal names the file and says to delete it yourself or reword the task. This adds no command, and only the user can run `/grill`.
- **Docs:** WORKFLOWS section 10 documents the location and the recovery.

**Decision:** I did not add the reviewer's `/execute --forget` command, so the fix adds no new surface. The worktree hash covers the cross-worktree leak, and the `/grill` refusal covers re-use of a slug in the same worktree.

**Breaking change:** ledgers written before this change, named `<slug>.jsonl`, are no longer read. A slug that is mid-run then starts a fresh ledger at its next `/execute`. Phase 9 has not shipped yet, so this should not hit real data.

**Tests:**
- `/grill` with an existing ledger for the slug refuses and hands nothing to the model.
- A second worktree created with `git worktree add` reads an empty ledger for the same slug.
- The tamper test in `review-command` now locates the file through `ledgerFile`.

## Info items done outside `fix_scope`

### IN-01: New comments break AGENTS.md's comment rules

**Commit:** 2f43edd

**Applied fix:** I removed caller references from these comments:
- the `active-workflow.ts` header;
- `MrInput.sourceBranch` in `mr.ts`;
- `runTypecheckAt` in `quality/index.ts`;
- the recorder comment at `execute/index.ts:140`;
- the `spec-gate.ts` header (reader list);
- the `requirement-ids.ts` header (`validatePlan`).

I also cut the `ledger.ts` header from five lines to three.

**Left as is:** the `RB-07-02`/`RB-09-03` ids in `handoff.ts`'s runtime `reason` string. That is user-facing output pointing at RUNBOOK entries, not a comment, so the AGENTS.md comment rule does not govern it.

IN-02 to IN-05 are untouched.

---

_Fixed: 2026-10-12T21:37:26Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
