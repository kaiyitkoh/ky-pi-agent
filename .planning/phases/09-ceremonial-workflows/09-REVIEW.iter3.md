---
phase: 09-ceremonial-workflows
reviewed: 2026-10-13T00:00:00Z
depth: deep
iteration: 2
files_reviewed: 29
files_reviewed_list:
  - .pi/extensions/execute/handoff.ts
  - .pi/extensions/execute/index.ts
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
  - .pi/extensions/quality/review-schema.ts
  - .pi/extensions/review/index.ts
  - .pi/extensions/review/mr.ts
  - .pi/extensions/review/scope-drift.ts
  - .pi/extensions/safety/git.ts
  - .pi/extensions/safety/policy.ts
  - .pi/extensions/workflows/index.ts
  - .pi/lib/work-artifacts.ts
  - .pi/agents/executor-handoff.md
  - .pi/skills/grill/SKILL.md
  - .pi/skills/plan-ceremony/SKILL.md
  - .pi/skills/review/SKILL.md
  - docs/WORKFLOWS.md
  - docs/SAFETY.md
  - docs/RUNBOOK.md
findings:
  critical: 4
  warning: 7
  info: 6
  total: 17
status: issues_found
---

# Phase 9: Code Review Report (re-review after fix iteration 1)

**Reviewed:** 2026-10-13
**Depth:** deep
**Files Reviewed:** 29: the 25 scoped files plus the four other `.pi`/`docs` files changed by `1e28a2f..HEAD`. I also read `workflows/evidence.ts` and `quality/index.ts` to follow call chains.
**Status:** issues_found

## Summary

I re-read every fix commit in `1e28a2f..HEAD` and traced each change into its callers and callees. I tested the git/glab classifier directly against the real `safety/git.ts`, and tested `git push` against a local bare remote in the scratchpad. No remote was contacted, glab was not run, and no tests were run.

Most fixes hold: CR-01, CR-02, CR-04, WR-02, WR-04, WR-07, WR-09, WR-11, WR-12 and WR-13. Four problems are serious enough to block shipping:

- **CR-07's fix is incomplete.** The matching refspec (`:`/`+:`), wildcard refspecs, and config-supplied push destinations still push `main` from a feature branch. I confirmed this against a bare remote.
- **CR-06's fix does not do what it says in a work repo.** The "deterministic gate on the committed change" is ky-pi-agent's own self-check:
  - the anti-pattern leg scans only `<cwd>/.pi/extensions/**/*.ts`;
  - the lint leg runs this repo's own test files and degrades to UNAVAILABLE anywhere else;
  - UNAVAILABLE never blocks.

  The new test passes only because it plants the bad file under `.pi/extensions/`.
- **CR-03's fix ties verification to the HEAD SHA, not to the commit's contents.** The verification command and the settle gate run on the working tree. A dirty tree, such as a new file the model forgot to `git add`, yields "Exit code: 0 @ <sha>" for a commit that does not contain what was tested.
- **The new sticky state lives in a file the model can write.** The revision cap, the drift base, and `/review`'s "every task recorded" check all trust PROGRESS.md. `.pi/work/` is now in `.git/info/exclude`, so model edits to it are invisible to drift, and a forged entry is published in the MR's Verification section.

The fixes also introduced regressions:

- **WR-01's fix lets a leaked `/execute` slot take over `/quick`.** The workflows `agent_end` handler now stands aside whenever an execute slot is armed. Nothing ever clears a leaked slot, so it consumes `/quick`'s run and logs rejections against an old task.
- **`/grill` and `/plan` stay armed across other commands.** Their per-turn injections leak into `/execute` turns. `/plan` has no budget, so it can stay armed indefinitely.
- **The budget-exhausted message contradicts the gate.** It tells the model to stamp ASSUMPTION overrides, which the new gate refuses.

Status of the prior findings:

| ID | Verdict |
|---|---|
| CR-01 | Fixed. Repeated, late, `refs/heads/` and whitespace targets all block (probed). |
| CR-02 | Fixed. |
| CR-03 | Partial. See CR-03 below. |
| CR-04 | Fixed, but see CR-04 below. |
| CR-05 | Fixed in logic, but defeatable through CR-04 and unrecoverable after a rebase (WR-05). |
| CR-06 | Not effective. See CR-02 below. |
| CR-07 | Partial. See CR-01 below. |
| WR-01 | Fixed, with a regression (WR-01 below). |
| WR-02 | Fixed. The flag is still not checked against a real glab. |
| WR-03 | Fixed, with caveats (WR-07). |
| WR-04, WR-05, WR-07, WR-08, WR-09, WR-11, WR-12, WR-13 | Fixed. |
| WR-06 | Fixed, but the stall heuristic measures the wrong quantity (WR-04 below). |
| WR-10 | Fixed in code; the tool's parameter name cannot be checked here. |

## Critical Issues

### CR-01: `git push` from a feature branch still reaches `main` through matching, wildcard and config-supplied refspecs

**File:** `.pi/extensions/safety/git.ts:183-202` (`pushTargetsProtected`), reached from `policy.ts:141`

**Issue:** The CR-07 fix strips `+` and handles `--all/--mirror/--branches`, but it compares only the literal destination side of each argv token. I ran the real classifier with HEAD=`feat` and protected=`["main","master"]`:

| Push args | Verdict |
|---|---|
| `origin :` | **allow** |
| `origin +:` | **allow** |
| `origin refs/heads/*:refs/heads/*` | **allow** |
| `origin +refs/heads/*:refs/heads/*` | **allow** |
| `origin --prune refs/heads/*:refs/heads/*` | **allow** |

Against a local bare remote (scratchpad, no network), after `git branch -f main feat` (allowed, because HEAD is not protected):
- `git push origin 'refs/heads/*:refs/heads/*'` printed `a7fc4a9..6798709  main -> main`.
- `git push origin :` printed `6798709..77e7d78  main -> main`.

Two config routes defeat the argv-only check entirely:
- `git config remote.origin.push refs/heads/feat:refs/heads/main` followed by a bare `git push`.
- `git -c push.default=matching push origin`.

`git config` is allowed because HEAD is not protected, and a bare `push` has no positional destination to inspect. `docs/SAFETY.md` now claims that pushes reaching a protected ref are blocked.

**Fix:** Treat any refspec whose destination contains `*`, and any empty-destination refspec (`:`, `+:`), as naming every protected branch. Refuse a `push` that has no explicit `src:dst` refspec, or else resolve the configured destination first with `git config --get-all remote.<r>.push` and `git config push.default`. Block `git config` writes to `remote.*.push`, `push.default` and `branch.*.merge`, and handle `-c push.*` / `-c remote.*`:

```ts
const dst = a.includes(":") ? a.slice(a.indexOf(":") + 1) : a;
const leaf = dst.replace(/^\+/, "").replace(/^refs\/heads\//, "");
if (leaf === "" || leaf.includes("*")) return true; // matching or pattern refspec reaches every branch
```

Add allow and block rows for each of these forms to `git-policy.test.ts`.

### CR-02: The "deterministic gate on the committed change" checks the harness, not the work repo's change

**File:** `.pi/extensions/execute/index.ts:82-88,154-157`, `.pi/extensions/review/index.ts:72-77`, `.pi/extensions/quality/index.ts:31-46,88-94`, `.pi/extensions/quality/gates.ts:102-135`

**Issue:** CR-06 was closed by calling `runQuickGateStage` at `/execute` settle and in `/review`. That function is ky-pi-agent's own self-check:
- **Anti-pattern leg:** `collectQualitySources` walks only `<cwd>/.pi/extensions/**/*.ts`. In the user's work repo it sees none of the change, so it always passes.
- **Lint leg:** it runs `LINT_GATE_FILES`, which are this repo's own `tests/unit/*.test.ts`. `productionExec` turns missing targets into a throw, so the leg is always UNAVAILABLE outside this repo.
- **Typecheck leg:** `tsc --noEmit` is the only leg that can observe the change, and only when the project is trusted and TypeScript is installed. Terraform, Python and every non-TS stack get nothing. An untrusted cwd makes every exec leg UNAVAILABLE.
- **Blocking rule:** `blocking` is `some(status === "fail")`, so UNAVAILABLE never blocks.

As a result, the gate passes vacuously in the user's work repo. `/review` then sends a report of PASS/UNAVAILABLE legs to the reviewer as `gateReport`.

The regression test `execute-workflow.test.ts:228-238` passes only because it commits the bad file at `.pi/extensions/bad.ts`. The reverse also fails badly: in a TS work repo with existing `tsc` errors, the base-tree gate at `index.ts:85-86` refuses every `/execute`. WORKFLOWS section 7 ("on the base tree and again on the committed change") and the CR-06 fix entry claim protection that does not exist.

**Fix:**
- Give the workflow gate its own source set: the files in `changedFiles(cwd, base, HEAD)`.
- Run the anti-pattern rules on those files.
- Report "no deterministic check applies" when no leg could run, instead of passing.
- Drop the harness-only lint leg from `/execute` and `/review`.
- At minimum, have `/execute` and `/review` refuse, or require `ctx.ui.confirm`, when every leg is UNAVAILABLE.
- Change the CR-06 test to commit the bad file outside `.pi/extensions/`.

### CR-03: Verification and the settle gate are bound to the HEAD SHA but run on the working tree

**File:** `.pi/extensions/execute/progress.ts:269-278,320-327`, `.pi/extensions/execute/index.ts:125-130,152-158`

**Issue:** `noteToolEnd` stamps the verification run with `headShaOrEmpty(cwd)`, and `checkVerification` only compares that SHA with the recorded commit. The command itself runs against the working tree, and so do the settle gate and `/review`'s gate and `touchedFiles`. The common cheap-model failure goes through:
1. The model creates `src/new-helper.ts`.
2. It forgets to `git add` it and commits the rest.
3. It runs `npm test`, which passes because the untracked file is on disk.

PROGRESS.md then records `## T001 @ <sha>` with "Exit code: 0", and `buildMrBody` publishes it, but the commit does not contain the file the tests needed. Drift cannot see untracked files, so nothing catches the gap.

**Fix:** At the verification `tool_execution_end` and again at settle, require a clean tree apart from the ignored `.pi/work/`. Reject the run otherwise:

```ts
const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd, encoding: "utf-8", shell: false }).stdout.trim();
if (dirty !== "") return { ok: false, reason: `the working tree is not the commit -- uncommitted or untracked: ${dirty.split("\n").slice(0, 10).join(", ")}` };
```

Record `clean: boolean` in `VerificationRecord` and fail `checkVerification` when it is false. Run the same check in `/review` before the gate and before `upstreamMismatch`.

### CR-04: The sticky revision cap, drift base and recorded entries live in a file the model can write freely

**File:** `.pi/extensions/execute/progress.ts:69-125`, `.pi/extensions/execute/index.ts:69-80,107-109`, `.pi/extensions/review/mr.ts:72-82`, `.pi/extensions/review/index.ts:64-66`

**Issue:** The CR-05, WR-03 and WR-06 fixes keep their authoritative state as text in `.pi/work/<slug>/PROGRESS.md`:
- `<!-- rejected T### errors=N -->` and `<!-- reset T### -->` lines;
- the `Drift base:` line;
- the `## T### @ <sha>` entries.

Nothing protects that file. No `safety/` rule covers `.pi/work/` (grep finds none), and the executor has `write`, `edit` and `bash`. WR-05 now appends `.pi/work/` to `.git/info/exclude`, so edits to the file never reach `changedFiles` or drift. With one write call, the model can:
- **Erase the cap:** delete its rejection lines, or append `<!-- reset T001 -->`.
- **Fabricate completion:** append `## T002 @ <git rev-parse HEAD>` with a fenced "output". `/execute` then skips T002. `historyMismatch` is satisfied, because every task has an entry, the SHA is an ancestor of HEAD, and the last SHA equals HEAD. `buildMrBody` then publishes the forged block under "## Verification".

SPEC.md and PLAN.md have the same exposure. The write allowance is re-read from them at every arm, so a model can widen its own `filesTouched` during one run and have the next run accept the drift.

This is exactly the kind of model-written evidence the workflow exists to refuse.

**Fix:**
- Add a `tool_call` guard that blocks `write`/`edit`, and bash commands whose parsed AST writes, on any path under `.pi/work/` while an `/execute` or `/review` run is armed. Writes to `.pi/work/` should go only through the extension's own functions.
- Cross-check each PROGRESS entry against an accepted row in the evidence JSONL (`writeEvidenceRow` already logs `headSha` and the verdict) before `/execute` treats a task as done and before `/review` accepts it.
- Snapshot the SPEC/PLAN allowance hash on the first arm, next to the drift base, and refuse when it changes.

## Warnings

### WR-01: A leaked `/execute` run slot is never cleared, and since the WR-01 fix it takes over `/quick`'s settle

**File:** `.pi/extensions/workflows/index.ts:70,82`, `.pi/extensions/execute/progress.ts:216-260,329-331`, `.pi/extensions/execute/index.ts:132-163`

**Issue:** The workflows `session_start` handler calls `endRun("", "")` to disarm "an orphaned run (no agent_end arrived)", which admits that orphaned runs happen. It does not clear `__kypiExecuteRun`, and the execute extension has no `session_start` handler. Once an execute slot leaks (session switch or reload mid-run, or a turn that never reaches `agent_end`), this sequence follows:

1. The workflows `agent_end` returns early on every turn, because `executeRunContext() !== undefined`.
2. The next `/quick` passes its `isRunArmed()` check, because the quick slot was cleared.
3. At `/quick`'s `agent_end`, the execute handler consumes the quick run via `endRun` and checks it against the stale task's verification command.
4. That check rejects the run and calls `appendAttempt` for the old slug and task, so an unrelated `/quick` uses up the old task's revision cap.
5. `/quick` reports nothing.

**Fix:** In the execute extension, add `pi.on("session_start", () => disarmExecuteRun())`. Have `/quick` refuse while `executeRunContext()` is armed, and have `/execute` check `executeRunContext()` alongside `isRunArmed()`. Better still, store the owner on the shared run slot (`startRun(..., { owner: "execute" })`) so each `agent_end` settles only runs it owns.

### WR-02: `/grill` and `/plan` stay armed across other commands and inject their briefs into unrelated turns

**File:** `.pi/extensions/grill/index.ts:79,131-160`, `.pi/extensions/plan-ceremony/index.ts:77,117-140`

**Issue:** Both runs are closure state with no cross-command disarm, no `session_start` reset and no cancel command:
- **`/grill`:** after a refused SPEC, the run stays armed until `asked > 5`. Every turn until then, including an `/execute` executor turn on another slug, gets "Question N of 5: ask exactly one question as the ..." injected by `before_agent_start`. Each of those turns also increments `asked`.
- **`/plan`:** it has no budget at all. A run whose PLAN.md is never written, or keeps failing, stays armed for the life of the process. Every later turn gets "The last PLAN.md was refused by the gate" injected, and any later PLAN.md change, including one made during an `/execute` run, is re-rendered silently.

**Fix:** Disarm both runs on `session_start` and whenever another workflow command arms. A shared "active workflow" slot on `globalThis` would do this. Give `/plan` the same hard turn budget as `/grill`, and scope each `before_agent_start` injection to its own run.

### WR-03: The budget-exhausted brief tells the model to use an override the gate now refuses

**File:** `.pi/extensions/grill/scorecard.ts:5,75,121-130`, `.pi/extensions/grill/index.ts:70-71`

**Issue:** When the budget is spent, `turnBrief` now injects `slot.reason` verbatim into the model's turn: "Every dimension that has not cleared its floor must be stamped into SPEC.md §7 via assumptionsFromUnmetFloors". The model cannot call that function. The fixer's decision 2, the skill and WORKFLOWS section 9 all say unmet floors cannot be overridden. A cheap model that follows this instruction writes ASSUMPTION lines, keeps the low scores, and `/grill` disarms with an error on the very next turn.

`assumptionsFromUnmetFloors` now has no production caller. The header (line 5) and the `HARD_QUESTION_BUDGET` JSDoc (line 75) describe a contract that no longer exists, which breaks the AGENTS.md rule that a wrong comment is worse than none.

**Fix:** Change the exhausted reason to "write SPEC.md now; a dimension below its floor keeps the SPEC refused, so ask the user to run /grill --resume". Delete `assumptionsFromUnmetFloors`, or mark it test-only, and correct both comments.

### WR-04: The escalation heuristic counts tool errors, not gate findings, so the now-hard cap misfires

**File:** `.pi/extensions/execute/index.ts:111,129,146-148`, `.pi/extensions/execute/progress.ts:80-90,184-186`

**Issue:** `errors=N` is the number of `isError` tool results in the run. Two consequences:
- **Spurious stalls:** two consecutive rejections with zero tool errors count as stalled (`0 >= 0`), for example "verification command never run" twice, or a settle-gate failure whose findings dropped from 20 to 1. The task is then refused after two attempts, even though the cap is 2 (three attempts), and even when the work is improving.
- **TDD runs always fail:** gateCompletion branch (3) rejects any run with a failed tool result. A natural red-then-green loop inside one attempt, where the tests fail before the fix, is therefore always rejected, and it records `errors>=1`.

WR-06 made the cap binding, so these misfires now block work until `--reset`.

**Fix:**
- Record the measure the stall rule means: the settle gate's finding count, or the verification output's failure count. Treat "unknown" as not stalled.
- Count only verification failures that happen after the commit.
- Document in the `/execute` brief that a failed tool call rejects the attempt.

### WR-05: The pinned drift base and `historyMismatch` cannot recover from a rebase or a legitimate user commit

**File:** `.pi/extensions/execute/progress.ts:112-125`, `.pi/extensions/execute/index.ts:107-109,152-153`, `.pi/extensions/review/mr.ts:72-82`

**Issue:** Drift is measured from the last recorded SHA or the pinned base, and `/review` requires every recorded SHA to be an ancestor of HEAD. Some normal events break this:
- **Rebase:** rebasing onto `staging` to resolve a conflict makes every recorded SHA a non-ancestor. `last..HEAD` then contains all of upstream's changes. Every later `/execute` HALTs and `/review` refuses.
- **User commit:** a user's own commit to an undeclared file, such as a lockfile bump, has the same effect.

`--reset` only resets attempt counts. HALTs are not counted and cannot be acknowledged, and nothing in the code or docs gives a recovery path other than hand-editing PROGRESS.md. That hand edit is the same model-writable weakness as CR-04.

**Fix:** Add an explicit, user-only re-pin, such as `/execute <slug> --rebase-base`, that requires `ctx.ui.confirm`. It should show the drifted paths, record a new `Drift base:` line and the reason, and have `/review` honour the re-pin. Document this in WORKFLOWS section 7.

### WR-06: Every glab spawn error is reported as "could not be started without a shell", including a timeout after the MR was created

**File:** `.pi/extensions/review/mr.ts:126-133,140-150`

**Issue:** `spawnSync` sets `r.error` for many causes:
- `ETIMEDOUT`: the 60 s timeout fired, and glab may already have created the MR;
- `ENAMETOOLONG`/`E2BIG`: Node's Windows argv quoting turns each `"` into `\"`, so a body under `MAX_MR_BODY_CHARS` can still exceed 32,767 characters;
- `ENOENT`.

All of them are reported as "could not be started without a shell ... install glab as a native executable". After a timeout the user is told glab is mis-installed, re-runs `/review`, and creates a duplicate MR. IN-06 (duplicate-MR detection) is still open.

**Fix:** Branch on `r.error.code`:
- `ENOENT`: keep the native-executable message.
- `ETIMEDOUT`: "glab timed out; check `glab mr list --source-branch <branch>` before retrying".
- Any other code: show the raw message.

Check the body length after escaping, or keep a margin, for example by counting each `"` and `\` twice.

### WR-07: `upstreamMismatch` checks `@{u}`, which is not necessarily the branch glab opens the MR from

**File:** `.pi/extensions/review/mr.ts:85-90`

**Issue:** `@{u}` is whatever upstream is configured, and it is a local remote-tracking ref that may be stale. A branch created with `git checkout -b feat origin/staging` tracks `origin/staging`, which produces a false refusal. A branch pushed with `git push -u origin feat:other` tracks `origin/other`, and the check passes while `glab mr create` uses the local branch name `feat` as its source. Nothing confirms that `<remote>/<current-branch>` exists or equals HEAD.

**Fix:** Resolve the source explicitly. Compare `refs/remotes/origin/<currentBranch>` with HEAD, optionally after `git fetch origin <branch>`. Pass `--source-branch <currentBranch>` in `mrCreateArgv`, after the target so the CR-01 ordering rule still holds, so the MR source is the branch that was checked.

## Info

### IN-01: WORKFLOWS.md section 7 has an orphaned sentence fragment

**File:** `docs/WORKFLOWS.md:421-425`
**Issue:** "...no other tool output is kept. The shared workflows" is followed by the rejection-log sentences, and then "The shared workflows settle handler stands aside...". The WR-06 insertion was spliced into the middle of a sentence.
**Fix:** Delete the dangling "The shared workflows" on line 421.

### IN-02: New and edited comments break AGENTS.md's comment rules

**File:** `.pi/extensions/grill/spec-gate.ts:1-4`, `.pi/extensions/execute/progress.ts:1-5`, `.pi/extensions/plan-ceremony/requirement-ids.ts:1-4`, `.pi/extensions/execute/handoff.ts:32-34`
**Issue:**
- `spec-gate.ts`'s header names its callers ("by the /grill writer and again by every reader (/plan, /execute, /review)").
- `progress.ts`'s header says the file "only renders what that gate has already accepted". It now rejects (`checkVerification`) and keeps the attempt log, so the comment is wrong.
- `requirement-ids.ts` still says it exists "for validatePlan's coverage matrix", but the handoff now uses it too.
- `handoff.ts`'s runtime reason still carries `RB-07-02`/`RB-09-03` (prior IN-02).
**Fix:** Cut each header down to the WHY. Delete the caller lists and the planning IDs from the runtime strings.

### IN-03: The `mr create` "target first" rule refuses the agent's natural spelling and some `/review` titles

**File:** `.pi/extensions/safety/git.ts:285-316`, `.pi/extensions/review/mr.ts:104-107`
**Issue:** The rule is correct and fail-closed: no main-target allow was found among repeated, late, `refs/heads/`, whitespace and clustered forms. Two side effects:
- The most common agent spelling, `glab mr create --title x --description y --target-branch staging`, is now refused. The block reason does explain the fix.
- `sanitizeTitle` keeps a leading `-`, so a SPEC goal such as "-b flag handling" becomes a `--title` value that the scanner refuses as a short-flag cluster. `/review` then refuses its own MR.
**Fix:** Strip leading `-` in `sanitizeTitle`. Optionally, name the exact accepted spelling in the block reason.

### IN-04: `.pi/work/` is excluded only from `/execute` onward, and only for untracked paths

**File:** `.pi/extensions/execute/progress.ts:293-306`
**Issue:** `/grill` and `/plan` create `.pi/work/<slug>/` before `ensureWorkIgnored` ever runs. Also, `git check-ignore` matches patterns even for tracked files, so if any `.pi/work/` file was already committed, the probe still reports "ignored", the files stay tracked, and later edits keep appearing in diffs. I confirmed that `check-ignore --no-index` returns 0 for a tracked path once the exclude line exists.
**Fix:** Call `ensureWorkIgnored` from `/grill` too. Refuse when `git ls-files .pi/work` is non-empty.

### IN-05: `--reset` is consumed even when the arm is refused later

**File:** `.pi/extensions/execute/index.ts:76-87,104`
**Issue:** The reset line is appended before the base-tree gate and before `ensureWorkIgnored`. If either one refuses, the reset is recorded but no attempt ran.
**Fix:** Append the reset only after every pre-flight check has passed, just before `armExecuteRun`.

### IN-06: Prior Info findings left open by `fix_scope: critical_warning`

**File:** see `09-REVIEW.iter2.md`
**Issue:** These are still present:
- IN-01: SPEC and PLAN footers cite a section that no longer exists.
- IN-03: `executor-handoff.md` cites `pi-subagents@0.49.0` and sends a planning HTML comment into the child's replace-mode prompt.
- IN-05: raw ENOENT when SPEC.md is missing in `/execute`, at `index.ts:59`.
- IN-06: a re-run of `/review` opens a second MR, and withdrawn BLOCKERs are dropped. WR-06 above makes this worse.
- IN-07: `/review` merge-bases against a possibly stale local `staging`.

IN-04 was resolved as a side effect of WR-02.
**Fix:** As described in the prior review.

---

_Reviewed: 2026-10-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
