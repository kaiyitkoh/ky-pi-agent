---
phase: 07-composed-extensions-pinned-reviewed
plan: 03
subsystem: extensions
tags: [checkpoint, git, vendored-extension, ext-07, boot-10]

requires:
  - phase: 04-safety-guardrails-first
    provides: "safety/git.ts's currentSha(cwd) — reused rather than a second git rev-parse HEAD"
  - phase: 07-composed-extensions-pinned-reviewed
    provides: "07-01's flat-under-.pi/extensions/ vendoring convention and NESTED_INDEX placement rule"

provides:
  - "A vendored, hardened checkpoint extension at .pi/extensions/checkpoint/ that captures untracked files, restores headless, and persists across a restart"
  - "createCheckpoint/restoreCheckpoint (git.ts) — a GIT_INDEX_FILE + write-tree + commit-tree mechanism, measured to capture what git stash create -u accepts and silently drops"
  - "recordCheckpoint/readCheckpoints (store.ts) — a durable checkpoint index under .pi/state/, atomic-rewrite, never-throw"
  - "/checkpoint-restore — a headless-reachable command, the escape hatch for defect 1 (session_before_fork's own UI-only restore path)"
  - "tests/integration/git-checkpoint.test.ts — five cases proving the restore against real temp git repositories, including the negative control on the SAME fixture and two executed-and-reverted falsification runs"

affects: [08-plan-mode-todo-parity, 09-workflows]

tech-stack:
  added: []
  patterns:
    - "GIT_INDEX_FILE scratch-index checkpointing instead of git stash create -u (measured to accept-and-ignore the flag on git 2.54.0.windows.1)"
    - "git restore --source=<sha> --worktree -- . instead of git checkout <sha> -- . (avoids silently staging into the real index)"
    - "Durable state under .pi/state/ (never-throw writer, atomic rewrite) as the sibling pattern to .pi/lib/jsonl.ts's append-only log writer, for state that must be read back rather than merely logged"

key-files:
  created:
    - .pi/extensions/checkpoint/git.ts
    - .pi/extensions/checkpoint/store.ts
    - .pi/extensions/checkpoint/index.ts
    - tests/integration/git-checkpoint.test.ts
  modified:
    - tests/unit/workflow-budgets.test.ts

key-decisions:
  - "GIT_INDEX_FILE + add -A + write-tree + commit-tree replaces git stash create entirely, per the plan's own verified_mechanism_finding — not a flag fix, a mechanism replacement"
  - "git restore --source=<sha> --worktree -- . chosen over git checkout <sha> -- . specifically to avoid rewriting the real index (T-07-12)"
  - "store.ts is a sibling to .pi/lib/jsonl.ts, not a binding to it — jsonl.ts's directory segment is hardcoded to 'logs', and checkpoint state needs whole-array atomic rewrite (read-back correctness) rather than append-only event semantics"
  - "The /checkpoint-restore command, not session_before_fork, is the primary headless-reachable restore path; session_before_fork is kept for UI parity but never returns silently when !ctx.hasUI"
  - "No agent_end handler clears anything — persistence is the fix for defect 3, and the absence of a clear-on-end handler is itself part of that fix"
  - "tests/unit/workflow-budgets.test.ts's WORKFLOW_BUDGETS/DIRECTORY_BUDGETS registries extended for the new checkpoint/ command surface (WR-03/WR-05) — required because checkpoint/index.ts spells registerCommand(, which the existing anti-offloading ratchet discovers automatically"

patterns-established:
  - "A vendored Pi example gets a PROVENANCE header naming the exact upstream file, Pi version, and each cited defect's original line number plus its fix — reused for the next vendored extension in this phase"
  - "A file honoring a strict 'must not contain the literal string X' acceptance grep documents the excluded mechanism by describing it, never by naming it verbatim in that specific file (moved the description to index.ts's provenance header instead)"

requirements-completed: [EXT-06, EXT-07]

duration: ~25min
completed: 2026-08-15
---

# Phase 7 Plan 3: Vendored Checkpoint Extension Summary

**Hardened vendor of Pi's bundled `git-checkpoint.ts`: a `GIT_INDEX_FILE`/`write-tree`/`commit-tree` mechanism replaces `git stash create -u` (measured to accept and silently drop untracked files), restore uses `git restore --worktree` to avoid touching the real index, and a `/checkpoint-restore` command plus a `.pi/state/`-persisted index replace the in-memory `Map` cleared on `agent_end`.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-15T03:15:00+08:00 (approx, file reads)
- **Completed:** 2026-08-15T03:42:51+08:00
- **Tasks:** 2 completed
- **Files modified:** 5 (3 created under `.pi/extensions/checkpoint/`, 1 new test file, 1 existing test file extended)

## Accomplishments

- Vendored and hardened all three cited defects in Pi 0.84.1's bundled `examples/extensions/git-checkpoint.ts`, with a provenance header citing the exact upstream lines and Pi version
- Measured (not assumed) that `git stash create -u` accepts its flag and silently produces a tree with no untracked file, on this machine's git 2.54.0.windows.1 — pinned as a live regression check in Case 2, not just a plan-time note
- Proved the working tree is genuinely restored — tracked modification AND untracked file, byte-exact — against a real disposable git repository, with a negative control on the identical fixture shape showing the unhardened mechanism fails the same assertion
- Proved checkpoint persistence survives a fresh OS process (spawned `node` reading `store.ts` directly), not merely an in-process variable
- Executed and reverted two falsification runs, each confirming the exact test cases the plan predicted would turn red

## Task Commits

Each task was committed atomically:

1. **Task 1: Vendor and harden the checkpoint extension** - `dfffb5d` (feat)
2. **Task 2: tests/integration/git-checkpoint.test.ts — prove the restore, both directions** - `078ccc4` (test)

**Plan metadata:** (this commit) — SUMMARY, STATE, ROADMAP

## Files Created/Modified

- `.pi/extensions/checkpoint/git.ts` - `createCheckpoint`/`restoreCheckpoint` — the GIT_INDEX_FILE scratch-index mechanism and the `git restore --worktree` restore
- `.pi/extensions/checkpoint/store.ts` - `recordCheckpoint`/`readCheckpoints` — durable `.pi/state/checkpoints.json`, atomic rewrite, never-throw
- `.pi/extensions/checkpoint/index.ts` - entry point: `turn_start` capture, `/checkpoint-restore` command, `session_before_fork` headless-safe restore prompt
- `tests/integration/git-checkpoint.test.ts` - five cases against real temp git repositories (capture+restore, negative control, gitignore boundary, cross-process persistence, headless reachability)
- `tests/unit/workflow-budgets.test.ts` - extended `WORKFLOW_BUDGETS` (`checkpoint/index.ts`, 170-line budget) and `DIRECTORY_BUDGETS` (`checkpoint/`, 530-line budget) for the new command surface

## Decisions Made

- **The mechanism is a full replacement, not a flag fix.** `git stash create -u` was measured during planning (and re-verified while writing `git.ts`) to accept `-u` and exit 0 while the resulting commit's tree contains no untracked file. `createCheckpoint` never calls the upstream subcommand at all — it uses `GIT_INDEX_FILE` pointed at a scratch index under the real `.git` directory, `git add -A` (respects `.gitignore` — the deliberate scope boundary for T-07-10/T-07-11), `git write-tree`, then `git commit-tree <tree> -p HEAD -m <label>` against the real `HEAD`.
- **Restore avoids touching the real index.** `git restore --source=<sha> --worktree -- .` restores working-tree content only; `git checkout <sha> -- .` was measured to additionally stage the restored paths into the real index, which `restoreCheckpoint` deliberately avoids (T-07-12).
- **`store.ts` is a sibling to `.pi/lib/jsonl.ts`, not a binding to it.** `jsonl.ts`'s directory segment is hardcoded to `"logs"` and its append-only semantics fit an event log, not state meant to be read back and acted on. `store.ts` applies the same two-layer confinement discipline (base-name allowlist + resolved-path containment) but writes a whole-array atomic rewrite (temp file + `renameSync`) under `.pi/state/` instead.
- **`/checkpoint-restore` is the primary headless-reachable path**, not `session_before_fork` — a command needs no event and no UI to run at all. `session_before_fork`'s own handler is kept for UI parity with the upstream example, but its `!ctx.hasUI` branch calls `ctx.ui.notify` naming the checkpoint and the command, rather than returning silently (defect 1's fix).
- **No `agent_end` handler clears anything.** The upstream example's `checkpoints.clear()` on `agent_end` is simply absent here — persistence to `.pi/state/` is defect 3's fix, and the absence of a clearing handler is part of that fix, not an oversight.
- **`tests/unit/workflow-budgets.test.ts`'s registries were extended**, not bypassed. `checkpoint/index.ts` spells `registerCommand(`, which the existing WR-03/WR-05 anti-offloading ratchet discovers automatically (`isCommandSource`) — this is the registry working as designed against a new command surface, not a plan deviation needing special justification beyond "add the entry."

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Provenance comment tripped the file's own BOOT-10 tool-registration substring gate**

- **Found during:** Task 1, first `tests/unit/contributing-boundary.test.ts` run
- **Issue:** `index.ts`'s provenance header originally wrote "This module never calls `registerTool`" in prose — `contributing-boundary.test.ts` matches `registerTool` as a plain substring across every tracked `.ts` under `.pi/extensions/`, deliberately including comments, so a file that names the call even to disclaim it trips the gate. `grep -c 'registerTool' .pi/extensions/checkpoint/*.ts` returned 1, not the plan's required 0.
- **Fix:** Reworded the header to describe the boundary rule without naming the forbidden call, matching the same discipline `.pi/lib/jsonl.ts`'s own docstring already uses for `createWriteStream` (never spelled, described in words instead).
- **Files modified:** `.pi/extensions/checkpoint/index.ts`
- **Verification:** `grep -c 'registerTool' .pi/extensions/checkpoint/*.ts` returns 0 for all three files; `tests/unit/contributing-boundary.test.ts` passes with no new allowlist entry.
- **Committed in:** `dfffb5d` (Task 1 commit)

**2. [Rule 1 - Bug] `git.ts`'s own docstring named the excluded subcommand, violating the plan's own acceptance grep**

- **Found during:** Task 1, running the plan's stated acceptance criterion `grep -n 'stash' .pi/extensions/checkpoint/git.ts` (must return nothing)
- **Issue:** The first draft of `git.ts`'s provenance/mechanism docstring quoted the upstream file's exact commands (including the excluded subcommand name) to explain what was being replaced and why — informative, but it directly violated the plan's own stated acceptance criterion that the string must not appear in this file at all.
- **Fix:** Reworded every mention to describe the excluded mechanism without naming it (e.g. "the subcommand named in `index.ts`'s provenance header"), and moved the verbatim upstream quotation to `index.ts`'s own provenance header, which carries no such restriction.
- **Files modified:** `.pi/extensions/checkpoint/git.ts`
- **Verification:** `grep -n 'stash' .pi/extensions/checkpoint/git.ts` returns nothing; `grep -n 'commit-tree' .pi/extensions/checkpoint/git.ts` still matches, confirming the positive half of the acceptance criterion.
- **Committed in:** `dfffb5d` (Task 1 commit)

**3. [Rule 2 - Missing Critical] The new command surface was undiscovered by the standing anti-offloading ratchet**

- **Found during:** Task 2, full-suite run after adding the integration test
- **Issue:** `.pi/extensions/checkpoint/index.ts` spells `registerCommand(`, which `tests/unit/workflow-budgets.test.ts`'s `discoverWorkflowFiles()`/`isCommandSource()` machinery (WR-03/WR-05, a standing regression gate from Phase 6/7's own prior work, not something this plan introduced) discovers automatically. Two "present-but-undeclared" assertions failed: `checkpoint/index.ts` had no `WORKFLOW_BUDGETS` entry and `.pi/extensions/checkpoint` had no `DIRECTORY_BUDGETS` entry.
- **Fix:** Added both registry entries following the file's own established convention: `WORKFLOW_BUDGETS` entry for `checkpoint/index.ts` at 170 (measured 161 raw lines, rounded up to the next ten), `DIRECTORY_BUDGETS` entry for `.pi/extensions/checkpoint` at 530 (measured 521 raw lines across all three files — `git.ts` and `store.ts` never spell `registerCommand(` themselves but count toward the directory total per WR-03's own stated rule, closing the exact "unbudgeted sibling" hole the registry exists to catch).
- **Files modified:** `tests/unit/workflow-budgets.test.ts`
- **Verification:** `npx vitest run tests/unit/workflow-budgets.test.ts` passes (26/26); full suite passes (1447/1447 across 85 files).
- **Committed in:** `078ccc4` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bug fixes to satisfy the plan's own stated acceptance greps, 1 Rule 2 missing-registry-entry fix for a pre-existing regression gate)
**Impact on plan:** All three were required for the plan's own stated acceptance criteria and the pre-existing test suite to pass. No scope creep — no new files beyond what the plan specified, no mechanism change.

## Issues Encountered

- **Windows `core.autocrlf` line-ending rewriting broke the first test run.** This machine's global git config (Windows default) rewrites LF to CRLF on checkout, which corrupted the byte-exact content assertions in Cases 1, 2 and 5 — a property of this machine's git config, not of `createCheckpoint`/`restoreCheckpoint`. Fixed by forcing `core.autocrlf false` on every temp repository the test fixture creates (`trackedRepo()` helper), documented inline in the test file. Verified this is unrelated to the checkpoint mechanism itself by confirming the mismatch was pure CRLF-vs-LF (`'line1\r\nline2\r\n'` vs `'line1\nline2\n'`).

## Exact Git Mechanism Shipped

Measured end to end on this machine (git 2.54.0.windows.1), re-verified by hand before writing `git.ts` and again by the test suite:

1. `git rev-parse --absolute-git-dir` — resolve the real `.git` directory
2. Point `GIT_INDEX_FILE` at a uniquely-named scratch index under it (never the caller's real staged changes)
3. `git add -A` against the scratch index (respects `.gitignore` — the scope boundary)
4. `git write-tree` against the scratch index
5. `git commit-tree <tree> -p <HEAD> -m <label>` against the real `HEAD` (commit-tree reads no index at all) — returns the checkpoint SHA, unreachable from any ref
6. Restore: `git restore --source=<sha> --worktree -- .` (never `git checkout <sha> -- .`, which was measured to additionally stage into the real index)

## Falsification Runs (executed and reverted, not committed as a permanent mode)

Both matched the plan's prediction exactly:

1. **`createCheckpoint` reverted to `git stash create -u`** (the upstream mechanism) → Case 1 turned red (`DEFECT 2 FIX: the untracked file must be restored: expected false to be true`) and Case 3 also turned red as a side effect (empty stash ref on an unmodified fixture, so `restoreCheckpoint` threw on an empty SHA) — reverted cleanly, `git diff` empty afterward.
2. **`restoreCheckpoint` stubbed to a no-op** → Cases 1 and 5 turned red exactly as predicted (`the tracked modification must come back byte-exact: expected 'line1\n' to be 'line1\nline2\n'`) — reverted cleanly, `git diff` empty afterward.

After each revert: `npx tsc --noEmit` clean, `npx vitest run tests/integration/git-checkpoint.test.ts tests/unit/extension-layout.test.ts tests/unit/contributing-boundary.test.ts tests/unit/workflow-budgets.test.ts` green (46/46), and the full suite green (1447/1447 across 85 files).

## Stated Gitignore Scope Boundary

`git add -A` respects `.gitignore`, so gitignored paths — `node_modules/`, `.pi/logs/`, `.pi/state/`, `.env` — are deliberately **not** captured by a checkpoint. This is stated in `git.ts`'s docstring and proven, not merely asserted: Case 3 commits a `.gitignore` rule, plants a file inside the ignored directory, checkpoints, deletes the directory, restores, and asserts the directory is **not** brought back.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- EXT-06 and EXT-07 both complete. The vendored checkpoint extension sits flat under `.pi/extensions/checkpoint/` (three files, matching the `NESTED_INDEX` one-directory-level convention established in 07-01), registers a command and no tool, and is fully proven against real git repositories rather than a mock.
- No blockers for the remaining Phase 7 plans (07-04 through 07-13): this plan touched no shared registry beyond the two `workflow-budgets.test.ts` entries a future plan's own command surfaces will need to extend the same way.
- The `/checkpoint-restore` command and the `.pi/state/checkpoints.json` store are both new composable primitives — a future phase wanting programmatic access to checkpoint history can import `readCheckpoints`/`recordCheckpoint` from `store.ts` directly, as this plan's own test suite does.

## Self-Check: PASSED

- FOUND: `.pi/extensions/checkpoint/git.ts`
- FOUND: `.pi/extensions/checkpoint/store.ts`
- FOUND: `.pi/extensions/checkpoint/index.ts`
- FOUND: `tests/integration/git-checkpoint.test.ts`
- FOUND commit `dfffb5d` (Task 1)
- FOUND commit `078ccc4` (Task 2)

---
*Phase: 07-composed-extensions-pinned-reviewed*
*Completed: 2026-08-15*
