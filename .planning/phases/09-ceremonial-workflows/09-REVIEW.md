---
phase: 09-ceremonial-workflows
reviewed: 2026-10-13T00:00:00Z
depth: deep
iteration: 3
files_reviewed: 33
files_reviewed_list:
  - .pi/extensions/execute/handoff.ts
  - .pi/extensions/execute/index.ts
  - .pi/extensions/execute/ledger.ts
  - .pi/extensions/execute/progress.ts
  - .pi/extensions/grill/index.ts
  - .pi/extensions/grill/scorecard.ts
  - .pi/extensions/grill/scorecard-parse.ts
  - .pi/extensions/grill/spec-gate.ts
  - .pi/extensions/grill/spec-schema.ts
  - .pi/extensions/plan-ceremony/index.ts
  - .pi/extensions/plan-ceremony/plan-schema.ts
  - .pi/extensions/plan-ceremony/requirement-ids.ts
  - .pi/extensions/plan-mode/index.ts
  - .pi/extensions/plan-mode/PROVENANCE.md
  - .pi/extensions/quality/gates.ts
  - .pi/extensions/quality/index.ts
  - .pi/extensions/quality/review-schema.ts
  - .pi/extensions/review/index.ts
  - .pi/extensions/review/mr.ts
  - .pi/extensions/review/scope-drift.ts
  - .pi/extensions/safety/git.ts
  - .pi/extensions/safety/paths.ts
  - .pi/extensions/safety/policy.ts
  - .pi/extensions/workflows/index.ts
  - .pi/lib/active-workflow.ts
  - .pi/lib/work-artifacts.ts
  - .pi/agents/executor-handoff.md
  - .pi/skills/grill/SKILL.md
  - .pi/skills/plan-ceremony/SKILL.md
  - .pi/skills/review/SKILL.md
  - docs/WORKFLOWS.md
  - docs/SAFETY.md
  - docs/RUNBOOK.md
findings:
  critical: 2
  warning: 2
  info: 5
  total: 9
status: issues_found
---

# Phase 9: Code Review Report (re-review after fix iteration 2, final)

**Reviewed:** 2026-10-13
**Depth:** deep
**Files Reviewed:** 33: the 29 files from the prior pass, plus `execute/ledger.ts`, `lib/active-workflow.ts`, `safety/paths.ts` and `quality/index.ts`. To follow call chains I also read `checkpoint/index.ts`, `checkpoint/store.ts`, `checkpoint/git.ts`, `workflows/evidence.ts` and `lib/jsonl.ts`.
**Status:** issues_found

## Summary

I read all eleven fix commits (`54ae8bc..12348a3`) and traced each one into its callers.

How I checked:
- I ran the real `safety/git.ts` push classifier against 20 edge-case argv forms.
- I reproduced one bypass against a local bare remote in the scratchpad.
- I reproduced the `git status` behaviour that the clean-tree rule depends on.
- I ran one targeted test file: `git-policy.test.ts`, 97 tests passing.
- No remote was contacted and glab was not run.

Most fixes are real:
- **CR-04:** the ledger lives outside the work tree, so PROGRESS.md edits change nothing.
- **WR-01, WR-02, WR-03, WR-05, WR-06:** fixed.
- **WR-04:** fixed, with the documented partial.
- **WR-07:** fixed.
- **IN-05 (old):** fixed as a side effect.

Two regressions block shipping:

1. **The clean-tree rule (CR-03 fix) fails every `/execute` and `/review` in a real work repo.**
   - The bundled checkpoint extension writes `<repo>/.pi/state/checkpoints.json` on every `turn_start`.
   - Nothing in the work repo ignores that file, and `uncommittedPaths` does not exclude it, so every verification run counts as dirty.
   - The rule exempts `.pi/logs/` instead of ignoring it, so the model's usual `git add -A` commits the harness's wire and evidence logs. Drift then HALTs on them.
   - This repo's own `.gitignore` hides both problems, and the tests do not load the checkpoint extension.
2. **The stricter push rule (CR-01 fix) can still be bypassed.**
   - It reads `--delete`/`-d` anywhere in argv, including as the value of `-o`/`--push-option`.
   - So `git push -o -d origin feat` passes as a "delete" while git pushes `feat` to whatever `remote.origin.push` names.
   - I confirmed `feat -> main` against a bare remote.

Two warnings:
- The change gate reports `typecheck: PASS` for changes tsc never looked at. WORKFLOWS says such changes need approval.
- The ledger is keyed only by slug in the shared git common dir, so it outlives the slug's `.pi/work/` directory and leaks across worktrees.

Weighed against "don't overcomplicate":
- The push strictness, the clean-tree rule and `--rebase-base` each earn their keep.
- The active-workflow slot is 14 lines and earns its keep.
- The HMAC layer on the ledger adds little over the path guard alone (IN-02). It does not cause real risk, so it is Info only.

Status of the prior findings:

| ID | Verdict |
|---|---|
| CR-01 (push refspecs) | Fixed for `:`, `+:`, wildcards, bare pushes, bare sources and `-c`. A new parser bug re-opens a config-routed push (CR-02 below). |
| CR-02 (gate checks the harness) | Fixed for TS/JS changes. The approval rule misses non-TS changes in a TS-rooted repo (WR-01 below). |
| CR-03 (working tree vs commit) | Fixed in logic. Regression: harness state makes every tree dirty (CR-01 below). |
| CR-04 (model-writable state) | Fixed. Staleness issue in WR-02 below. |
| WR-01 to WR-07 | Fixed. WR-04's second bullet is documented, not implemented, and that is acceptable. |

## Critical Issues

### CR-01: Harness state in the work repo makes every `/execute` verification and every `/review` "dirty", and `.pi/logs/` gets committed

**File:**
- `.pi/extensions/execute/progress.ts:252-257` (`uncommittedPaths`) and `:272-285` (`ensureWorkIgnored`)
- `.pi/extensions/execute/index.ts:144,168-169`
- `.pi/extensions/review/index.ts:81-82`
- The writers: `.pi/extensions/checkpoint/index.ts:30-35`, `.pi/extensions/checkpoint/store.ts:46`, `.pi/lib/jsonl.ts:135`

**Issue:** Three facts combine:
- `uncommittedPaths` excludes only `.pi/work` and `.pi/logs`.
- The checkpoint extension, loaded by default through `"extensions": ["./.pi/extensions"]`, writes `<repo root>/.pi/state/checkpoints.json` on every `turn_start`.
- `ensureWorkIgnored` adds only `/.pi/work/` to `.git/info/exclude`.

In the user's work repo, which has no `.pi/state/` ignore line, `git status --porcelain --untracked-files=all -- :/ ':(exclude).pi/work' ':(exclude).pi/logs'` prints `?? .pi/state/checkpoints.json`. I reproduced this in a scratch repo. Then:
- `noteToolEnd` records `dirty: ".pi/state/checkpoints.json"`.
- `checkVerification` rejects every attempt with "ran on a working tree that is not the commit".
- Each rejection counts toward `REVISION_CAP`, so the task escalates after three tries.
- `/review` refuses up front for the same reason.

If the model commits the file to clear the rejection, drift HALTs on an undeclared path.

The second half concerns `.pi/logs/`. The CR-03 fix hides `.pi/logs/` from the status check, but nothing ignores it. Wire, turns, audit and evidence logs land there during every turn, and wire logs carry full provider payloads. A cheap model's habitual `git add -A && git commit` therefore stages them. I confirmed that `add -A` stages both `.pi/logs/wire-*.jsonl` and `.pi/state/checkpoints.json`. Drift then HALTs, and the logs now sit in a local commit on a branch the user may push.

The `/execute` brief never tells the model to stage explicit paths.

The tests pass only because this repo's `.gitignore:79-80` ignores `.pi/logs/` and `.pi/state/`, and the integration tests do not load the checkpoint extension.

**Fix:** Ignore every harness-owned directory in the work repo, then drop the pathspec carve-outs so ignored state is invisible to both `status` and `add -A`:

```ts
// progress.ts
const HARNESS_DIRS = [".pi/work/", ".pi/logs/", ".pi/state/"] as const;
export function ensureHarnessIgnored(cwd: string): string | undefined {
	// for each dir: git check-ignore -q -- <dir>probe ; append `/${prefix}${dir}` to info/exclude when status === 1
}
export function uncommittedPaths(cwd: string): string {
	const r = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	...
}
```

- Call it from `/grill` (which also closes old IN-04), `/execute` and `/review`.
- Add "stage only the files you changed: `git add <path>...`" to the `/execute` brief.
- Add an integration test that writes `.pi/state/checkpoints.json` and `.pi/logs/wire-x.jsonl` before the verification run.

### CR-02: `git push -o -d origin feat` passes the push guard as a delete and pushes `feat` to the config-chosen destination

**File:** `.pi/extensions/safety/git.ts:207-226` (`pushRefusal`)

**Issue:** `deleting` is computed as `args.includes("--delete") || args.includes("-d")` before the loop that consumes the values of `-o`, `--push-option`, `--repo`, `--receive-pack` and `--exec`. A `-d` or `--delete` that is really the value of `-o`/`--push-option` still sets `deleting = true`. The loop then skips it as a value, and the bare `feat` refspec passes the "no explicit destination" check.

Classifier results with HEAD=`feat`:

| Push args | Verdict |
|---|---|
| `-o -d origin feat` | **allow** |
| `--push-option --delete origin feat` | **allow** |

Against a local bare remote with `receive.advertisePushOptions=true`, after `git config remote.origin.push refs/heads/feat:refs/heads/main` (allowed, because HEAD is not protected), `git push -o -d origin feat` printed `c9326ed..b93ab5c  feat -> main`. GitLab advertises push options (`ci.skip` and others), so this works against the real server too.

SAFETY.md:62-63 says "`--delete <name>` is the one bare-name form allowed". The code does not enforce that.

**Fix:** Detect deletion inside the loop, only on tokens that are not consumed as values:

```ts
let deleting = false;
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (PUSH_VALUE_FLAGS.has(a)) { remoteGiven ||= a === "--repo"; i++; continue; }
	if (a === "--delete" || a === "-d") { deleting = true; continue; }
	...
}
```

Add block rows for `-o -d origin feat`, `--push-option --delete origin feat` and `--exec -d origin feat` to `git-policy.test.ts`.

## Warnings

### WR-01: The change gate counts a typecheck that never saw the change, so Terraform, Python and docs changes in a TS-rooted repo record "PASS" with no approval

**File:** `.pi/extensions/quality/index.ts:187-210` (`runChangeGateStage`), `.pi/extensions/execute/index.ts:179-182`, `.pi/extensions/review/index.ts:96-97`, `docs/WORKFLOWS.md:327-332`

**Issue:** `ranAny` is true whenever `tsc --noEmit` ran, whatever the change contains. Take a work repo with a root `tsconfig.json`, the user's full-stack case, and a change to `infra/main.tf`:
- the anti-pattern leg reports UNAVAILABLE;
- the typecheck leg reports `PASS`;
- so `ranAny` is true and the task records with "Deterministic gate: typecheck: PASS" and no `ctx.ui.confirm`.

WORKFLOWS section 7 says a Terraform, Python or docs-only change needs the user's approval. In practice that holds only in repos with no tsc, while the MR shows a PASS that covered none of the changed files.

The reverse also misleads. In a repo where TS lives only in a subdirectory, a root `tsc` exits non-zero. `/review` then asks for approval on every MR with "the typecheck fails at HEAD".

**Fix:** Make the typecheck leg relevant only when the change contains TS/JS files:

```ts
const typecheck: LegStatus = code.length === 0
	? { status: "unavailable", reason: "no changed TypeScript/JavaScript file for tsc to check" }
	: input.baseTypecheckFailed ? { status: "unavailable", reason: "..." } : runTypecheckAt(input.cwd, input.projectTrusted);
```

Add a test with a root `tsconfig.json` and a `.tf`-only change that requires approval.

### WR-02: The ledger is keyed only by slug in the shared git common dir, so a re-used slug or another worktree inherits old accepted entries

**File:** `.pi/extensions/execute/ledger.ts:28-32,50-79`, `.pi/extensions/execute/index.ts:70-89`, `.pi/extensions/review/index.ts:69-79`, `.pi/extensions/grill/index.ts:111-114`

**Issue:** `<git common dir>/kypi-ledger/<slug>.jsonl` outlives `.pi/work/<slug>/`. `.pi/work/` is untracked, while the common dir is shared by every worktree. `deriveSlug` builds the slug from the task description, so a later `/grill fix login redirect` reproduces an earlier slug. That happens either after the user deleted the old work directory or in a fresh worktree, where `.pi/work/` does not exist.

Then:
- **Allowance changed:** `/execute` refuses with "the SPEC/PLAN write allowance changed" and points at `--rebase-base`.
- **After a re-pin, or when the allowance happens to match:** the old `accepted` rows mark T001, T002 and so on as done, because task ids restart at T001. `/execute` skips them or reports "every PLAN task already has a PROGRESS entry".
- **In `/review`:** the old entries are exempt from the ancestry check after a re-pin, and they are published in the new MR's Verification section as evidence for work they never covered.

There is no user command to retire a ledger. The model is blocked from the directory, and the docs do not say where to delete it.

**Fix:**
- Bind each ledger to its SPEC. Store a random run id in the first `base` row and refuse a ledger whose first base is not an ancestor of HEAD.
- Simpler still: have `/grill` refuse a new slug while `<common>/kypi-ledger/<slug>.jsonl` exists, and add a user-confirmed `/execute <slug> --forget` that renames the file.
- Document the location and the recovery in WORKFLOWS section 10.

## Info

### IN-01: New comments break AGENTS.md's comment rules

**File:**
- `.pi/lib/active-workflow.ts:1-4`
- `.pi/extensions/review/mr.ts:109`
- `.pi/extensions/quality/index.ts:150`
- `.pi/extensions/execute/ledger.ts:1-6`
- `.pi/extensions/execute/index.ts:140`

**Issue:**
- **Caller references:**
  - the `active-workflow.ts` header names its callers ("/grill and /plan keep per-turn hooks");
  - `MrInput.sourceBranch` cites "The branch `upstreamMismatch` checked";
  - `runTypecheckAt` is "a baseline for `runChangeGateStage`";
  - `execute/index.ts:140` describes the workflows recorder.
- **Length:** `ledger.ts`'s header runs to four dense lines. The rule allows one or two.

Prior IN-02 is also still open:
- the `spec-gate.ts` header lists its readers;
- the `requirement-ids.ts` header names `validatePlan`;
- `handoff.ts:32-34` still puts `RB-07-02`/`RB-09-03` in a runtime string.

**Fix:** Cut each comment to the WHY and delete the caller names and planning ids.

### IN-02: The HMAC layer adds little over the path guard, and the grep/find containment check does not cover the ledger

**File:** `.pi/extensions/execute/ledger.ts:34-79`, `.pi/extensions/safety/paths.ts:269-273`

**Issue:** Moving the state out of the work tree and blocking `kypi-ledger` paths does the real work. A process that evades the guard to write a row can usually evade it to read `key` too, by the same glob or variable route, which docs/SAFETY.md already lists. So the signature mostly catches accidental damage. In exchange it adds a hard failure mode: a lost `key` refuses the slug forever, with no documented recovery.

Separately, `grep`/`find`'s `path` containment check covers `~/.aws` but not the ledger. `grep { path: ".git", pattern: "[0-9a-f]{64}" }` prints the key, and WORKFLOWS' residual list does not name this route.

**Fix:** Add the ledger directory to the containment-aware search roots, and name the route in the residuals. Optionally drop the HMAC and keep the guarded location.

### IN-03: The strict push rule refuses tag pushes and misleads for `.`-tracked branches

**File:** `.pi/extensions/safety/git.ts:223-226`, `.pi/extensions/review/mr.ts:101-103`

**Issue:**
- **Tag pushes:** `git push origin --tags` and `git push origin v1.2.0` are refused as "destination comes from config", which is fail-closed but misleading for tags. The accepted form, `refs/tags/v1.2.0:refs/tags/v1.2.0`, is not named.
- **`.`-tracked branches:** for a branch with `branch.<b>.remote = .` (a local tracking setup), `upstreamMismatch` suggests `git push . feat:feat`, which is a no-op local push.

**Fix:** Name the tag form in the block reason. In `upstreamMismatch`, treat a remote of `.` as unset and fall back to `origin`.

### IN-04: `/quick` still runs the harness's own self-check in a work repo

**File:** `.pi/extensions/workflows/index.ts:42`, `.pi/extensions/quality/index.ts:141-147`

**Issue:** CR-02 moved `/execute` and `/review` to `runChangeGateStage`. `/quick` still runs `runQuickGateStage`, which in a work repo has three weaknesses:
- the anti-pattern leg scans `<cwd>/.pi/extensions` only;
- the lint leg runs this repo's own tests;
- UNAVAILABLE never blocks.

So `/quick`'s pre-flight gate passes vacuously there. This is pre-existing and was outside the prior finding's scope.

**Fix:** Make `/quick` use the change gate at settle, or document that `/quick`'s gate only means something inside ky-pi-agent.

### IN-05: Prior Info findings still open

**File:** see `09-REVIEW.iter3.md`

**Issue:**
- **Fixed:** iter3 IN-01, the dangling WORKFLOWS fragment, now reads correctly.
- **Still open:**
  - IN-03: `sanitizeTitle` keeps a leading `-`, so a goal beginning "-b ..." becomes a title the `mr create` scanner refuses.
  - IN-04: `.pi/work/` is ignored only from `/execute` onward, and a tracked `.pi/work` file is not detected. CR-01 above extends this.
  - IN-06 items: the stale footers, the `executor-handoff.md` version, the raw ENOENT for a missing SPEC in `/execute`, a duplicate MR on a re-run, and the stale local `staging` merge-base.
- **Coupling:** `/plan` now imports `HARD_QUESTION_BUDGET`, a `/grill` question constant, as its turn budget. A named shared constant would make that intent explicit.

**Fix:** As described in the prior review. Strip leading `-` in `sanitizeTitle`.

---

_Reviewed: 2026-10-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
