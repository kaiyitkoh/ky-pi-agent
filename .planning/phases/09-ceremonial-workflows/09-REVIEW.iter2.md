---
phase: 09-ceremonial-workflows
reviewed: 2026-10-13T00:00:00Z
depth: deep
files_reviewed: 24
files_reviewed_list:
  - .pi/extensions/execute/handoff.ts
  - .pi/extensions/execute/index.ts
  - .pi/extensions/execute/progress.ts
  - .pi/extensions/grill/index.ts
  - .pi/extensions/grill/scorecard.ts
  - .pi/extensions/grill/scorecard-parse.ts
  - .pi/extensions/grill/spec-schema.ts
  - .pi/extensions/plan-ceremony/index.ts
  - .pi/extensions/plan-ceremony/plan-schema.ts
  - .pi/extensions/plan-ceremony/requirement-ids.ts
  - .pi/extensions/plan-mode/index.ts
  - .pi/extensions/quality/gates.ts
  - .pi/extensions/quality/review-schema.ts
  - .pi/extensions/review/index.ts
  - .pi/extensions/review/mr.ts
  - .pi/extensions/review/scope-drift.ts
  - .pi/extensions/safety/git.ts
  - .pi/extensions/safety/policy.ts
  - .pi/lib/work-artifacts.ts
  - .pi/agents/executor-handoff.md
  - .pi/skills/grill/SKILL.md
  - .pi/skills/plan-ceremony/SKILL.md
  - .pi/skills/review/SKILL.md
  - docs/WORKFLOWS.md
findings:
  critical: 7
  warning: 13
  info: 7
  total: 27
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-10-13
**Depth:** deep
**Files Reviewed:** 24 production/docs files, plus the listed phase-9 tests (checked for vacuity)
**Status:** issues_found

## Summary

I traced /grill -> /plan -> /execute -> /review end to end against Pi 1.1.0 source in `node_modules`: `ExtensionRunner.emit` runs handlers in order, `discoverExtensionsInDir` uses unsorted `readdirSync`, and I checked `ToolExecutionEndEvent` and `ui.confirm`. I also ran the git/glab classifiers and `git diff --name-only` against scratch inputs.

The headline problem: several gates the docs and skills present as enforced either never run in production or can be bypassed:

- The ambiguity gate, the question budget and the gated SPEC/PLAN writers have no production caller.
- `driftAbort` cannot see renames.
- PROGRESS.md writes "Exit code: 0" for a verification command nobody checked was run.
- Neither /execute nor /review ever runs the deterministic gate over the executor's change.
- The new `glab mr create` conditional allow takes the first `--target-branch` it sees, but glab honours the last one. That opens an MR-to-`main` bypass for the agent's own bash tool.

All bypasses were reproduced with the real modules. glab is not installed on this machine (`which glab` -> not found), so the `--description-file` flag could not be checked locally.

## Critical Issues

### CR-01: `glab mr create` target check takes the FIRST target flag; glab honours the LAST, so an MR to `main` is allowed

**File:** `.pi/extensions/safety/git.ts:265-290` (reached from `policy.ts:142-147` for every agent bash `glab` call, and from `review/mr.ts:107`)
**Issue:** `extractMrCreateTarget` returns the first `--target-branch`/`-b` it sees. glab parses flags with cobra/pflag, where a repeated string flag overwrites the earlier value, so the last one wins. I ran the real classifier:
- `mr create --target-branch staging --target-branch main` -> **allow**
- `mr create -b staging --target-branch=main` -> **allow**
- `mr create --target-branch=refs/heads/main` -> **allow** (`pushTargetsProtected` strips `refs/heads/`; this does not)
- `mr create --target-branch "main "` -> **allow** (value not trimmed)

This rule is new in this phase. Before it, every `mr create` fell into the unclassified-block path. The evasion corpus (EV-75..79) has no repeated-flag row, and `docs/SAFETY.md` describes the rule as closed.
**Fix:** Collect every target occurrence (both forms, plus `-b=X` and `-bX`), normalise each one, and block unless there is exactly one and it is safe:
```ts
function extractMrCreateTargets(args: readonly string[]): string[] | undefined {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--target-branch" || a === "-b") { const v = args[i + 1]; if (v === undefined || v.startsWith("-")) return undefined; out.push(v); i++; continue; }
    if (a.startsWith("--target-branch=")) { out.push(a.slice(16)); continue; }
    if (a.startsWith("-b")) return undefined; // -bmain / -b=main: refuse rather than parse
  }
  return out;
}
const norm = (b: string) => b.trim().replace(/^refs\/heads\//, "").toLowerCase();
// allow only when targets.length === 1 && norm(targets[0]) !== "" && !protected.has(norm(targets[0]))
```
Add corpus rows for the repeated-flag, `refs/heads/` and whitespace forms.

### CR-02: `driftAbort` misses renames: a commit that moves or deletes an undeclared file passes

**File:** `.pi/extensions/execute/progress.ts:184-198` (also feeds `review/scope-drift.ts:23-29`)
**Issue:** `git diff --name-only base..head` has rename detection on by default, so it lists only the destination of a rename. Scratch-repo check: `git mv infra/prod.tf allowed2.ts && git commit` gives `--name-only` = `allowed2.ts` only; `--no-renames` gives `allowed2.ts` plus `infra/prod.tf`. So an executor can delete or move any undeclared file (Terraform, CI config, another service) into a declared path, and `driftAbort` still returns `ok`, so PROGRESS is written. `tests/integration/scope-drift.test.ts` ("a rename is reported by its new path only") locks this in as expected behaviour. The `diff.renames` user config can also change the output.
**Fix:**
```ts
spawnSync("git", ["-c", "core.quotePath=false", "diff", "--name-only", "--no-renames", "-z", `${baseSha}..${headSha}`], ...)
// split on "\0" instead of "\n"
```
Then flip the scope-drift test to assert that both paths are reported.

### CR-03: PROGRESS.md claims "Exit code: 0" for a verification command that nothing checked was run

**File:** `.pi/extensions/execute/index.ts:133`, `.pi/extensions/workflows/index.ts:52-66`, `.pi/extensions/workflows/evidence.ts:61-115`
**Issue:** `appendProgress` hard-codes `exitCode: 0` and writes `Verification command: <task.verificationCommand>`. Nothing checks that this command was ever run:
- The evidence gate accepts any non-error tool record whose SHA equals the new HEAD.
- The recorder reads `currentSha` *after* each tool runs, so the `git commit` bash call records itself at the new HEAD.

A run of "edit file, `git commit -am x`" therefore passes branches (1)-(5). PROGRESS then shows `npm test`, exit 0, plus the commit's own stdout as "output". `/review` forwards this to the reviewer as `gateReport`, and `buildMrBody` publishes it under "## Verification". This fabricated evidence is exactly what the workflow exists to prevent. The happy-path test (`execute-workflow.test.ts`) fires one generic `bash` record and never proves the verification command ran.
**Fix:** Require evidence of the verification command itself. Capture `tool_call` input for `bash` (keyed by `toolCallId`) during an armed /execute run. Then require at least one non-error `bash` record whose normalised command equals `task.verificationCommand`, executed at the final HEAD. Record that call's exit status and output, not a constant and not the concatenation of every tool output.

### CR-04: The ambiguity gate, question budget and gated writers never run in production

**File:** `.pi/extensions/grill/index.ts:42-59`, `.pi/extensions/plan-ceremony/index.ts:56-73`, `.pi/extensions/grill/scorecard.ts:121,241`, `.pi/extensions/grill/spec-schema.ts:458-597`
**Issue:**
- `writeSpecIfGated`, `writePlanIfGated`, `nextQuestionSlot` and `assumptionsFromUnmetFloors` have no production caller. A grep of `.pi/` finds only their definitions; they are imported only by tests.
- /grill and /plan just call `pi.sendUserMessage`, so the model writes SPEC.md and PLAN.md with the ordinary `write` tool.
- The downstream re-checks (`/plan`, `/execute`, `/review`) call `validateSpec` only. `validateSpec` never calls `gateAmbiguity` and does not require §3, §6, §7 or §8.

As a result, a SPEC with no scorecard, or with every dimension at 0, flows through to /execute. `execute-workflow.test.ts` itself uses `scorecardBody: "Overall: 0.1"`, which `gateAmbiguity` would reject. The 5-question budget and perspective rotation exist only as skill prose. `.pi/skills/grill/SKILL.md` ("What will refuse you ... `gateAmbiguity`") and `docs/WORKFLOWS.md` section 6 ("SPEC.md must ... have passed its own ambiguity gate") claim enforcement that does not exist.
**Fix:** Enforce at the consumer. Add an `ambiguity` check to the gate every downstream command runs:
```ts
export function validateGatedSpec(md: string): SpecValidation {
  const v = validateSpec(md); if (!v.ok) return v;
  const a = gateAmbiguity(parseAmbiguityScorecard(v.spec.scorecardBody));
  if (!a.ok) return { ok: false, reason: a.reason };
  if (extractSpecRequirementIds(v.spec.requirementsBody).length === 0) return { ok: false, reason: "§3 declares no R# ids" };
  return v;
}
```
Use it in /plan, /execute and /review. Then either delete the uncalled writers or wire them in, and correct the skill and docs.

### CR-05: Drift HALT and rejected runs are not sticky, so the next `/execute` launders the offending commit

**File:** `.pi/extensions/execute/index.ts:95-96,124-132`, `.pi/extensions/review/index.ts:93-103`
**Issue:**
- On a gate reject or a drift HALT, the offending commit stays on the branch and only a notification is shown.
- The next `/execute` for the same task re-arms with `baseSha = currentSha(cwd)`, which already includes that commit. The new attempt's `changedFiles(baseSha, newSha)` never contains the drifted paths, so `driftAbort` passes and PROGRESS records the task.
- The only remaining check, `/review`'s `compareScope`, writes a "Scope Drift" table, but `decideWorkflowStop` ignores `scopeDrift`. The MR therefore opens without approval even when undeclared files changed.

**Fix:** Persist the run's base SHA per slug/task: write it in `.pi/work/<slug>/` on first arm, or record the HALT and refuse until it is resolved. Compute drift from that persisted base, or from the last accepted PROGRESS SHA. In /review, treat a non-empty `drifted` list as a stop that needs `ctx.ui.confirm` approval:
```ts
if ((review.scopeDrift?.drifted.length ?? 0) > 0) { /* needsApproval stop naming the drifted paths */ }
```

### CR-06: No deterministic gate ever checks the executor's change

**File:** `.pi/extensions/execute/index.ts:74-80`, `.pi/extensions/review/index.ts:66-77`
**Issue:**
- `/execute` runs `runQuickGateStage` *before* the model is prompted, so it type-checks and lints the pre-change tree, never the commit.
- `agent_end` re-runs nothing.
- `/review` does not run it either: it passes PROGRESS.md as `gateReport` with the comment "deterministic output was captured when each task was recorded". It was not; PROGRESS holds tool output, not gate output.

A change that breaks `tsc` is accepted, recorded and sent to an MR. That defeats the project's core value of mechanically catching what a cheap model misses.
**Fix:** In the `/execute` `agent_end` handler, after the evidence verdict and before `appendProgress`, run `runQuickGateStage(cwd, trusted)` and reject on `blocking`. In `/review`, run the deterministic stage at HEAD and pass `gate.report` as `gateReport`, never PROGRESS.

### CR-07: `git push origin +main`, `+refs/heads/main`, `--mirror` and `--all` from a feature branch are allowed

**File:** `.pi/extensions/safety/git.ts:189-198,204-216`
**Issue:** I ran `classifyGitInvocation` with HEAD=`feat`:

| Push args | Verdict |
|---|---|
| `origin +main` | **allow** |
| `origin +refs/heads/main` | **allow** |
| `--mirror origin` | **allow** |
| `--all --force origin` | **allow** |

`pushTargetsProtected` does not strip the leading `+` force marker before comparing names, and it ignores flags that push every ref. `+main` is the canonical force-push spelling, and the function's own comment says force pushes to protected targets are blocked. This code predates the phase but the file is in scope, and /review relies on it.
**Fix:** Strip `/^\+/` before the `refs/heads/` strip. Treat `--all`, `--mirror` and `--branches` as targeting every protected branch:
```ts
if (args.some((a) => a === "--all" || a === "--mirror" || a === "--branches")) return true;
const leaf = dst.replace(/^\+/, "").replace(/^refs\/heads\//, "");
```
Add corpus rows for each form.

## Warnings

### WR-01: Whether `/execute` ever records anything depends on directory listing order

**File:** `.pi/extensions/execute/index.ts:113-123`, `.pi/extensions/workflows/index.ts:68-79`
**Issue:**
- Both extensions call `endRun` in `agent_end`, and the first one consumes the run.
- Pi 1.1.0 runs handlers in load order (`runner.js:813-838`). Load order is unsorted `fs.readdirSync` (`loader.js:638`): alphabetical on NTFS, but not guaranteed on APFS or ext4, which are the target macOS and the Linux CI.
- When `workflows/` loads first, every `/execute` run silently ends with "no evidence verdict". The test `"workflows loaded first consumes the run"` asserts that broken outcome as expected behaviour.

**Fix:** Keep one owner of `endRun`. Have the workflows `agent_end` return early while `executeRunContext() !== undefined`, or tag the run with its owner (`startRun(..., owner: "execute")`) and only let the owner settle it.

### WR-02: `--description-file` is very likely not a glab flag; `/review` would fail at the last step

**File:** `.pi/extensions/review/mr.ts:17,70-72`
**Issue:** glab is not installed here, so `glab mr create --help` could not be run. As far as I know, glab's `mr create` takes the body through `-d/--description` and has no `--description-file`. RUNBOOK RB-09-02 and the 09-15 summary record the flag as never checked. The stub test (`review-mr.test.ts:103,152`) asserts the unverified flag, so it would stay green either way. Two more gaps: no `--yes`, and the source branch is never confirmed to be pushed.
**Fix:** Check against real glab before trusting this path. If the flag does not exist, pass `--description "$(cat file)"`-equivalent through argv on POSIX. On Windows, use `shell:false` against `glab.exe` (see IN-04) so a long body never meets cmd.exe. Fail with a clear message if the branch has no upstream.

### WR-03: The MR is not tied to what was reviewed or recorded

**File:** `.pi/extensions/review/index.ts:64-114`
**Issue:**
- /review reviews local `HEAD`, but `glab mr create` opens an MR for the *remote* source branch, which may be stale or different. Nothing checks that `HEAD` is pushed and equals `@{u}`.
- Nothing checks that every PLAN task has a PROGRESS entry.
- Nothing checks that the recorded SHAs are ancestors of HEAD, or that no unrecorded commits follow the last entry.

So an MR can carry unreviewed or unverified commits under a "Verification" section that implies otherwise.
**Fix:** Before `openMr`, require all of:
- every `plan.tasks[i].id` has a `## T### @ <sha>` entry
- each recorded `<sha>` passes `git merge-base --is-ancestor <sha> HEAD`
- the last recorded SHA equals HEAD, or the commits after it are named in the body
- `git rev-parse @{u}` equals HEAD

### WR-04: Raw tool output is written into PROGRESS.md unescaped, which breaks the markdown and can mark tasks done

**File:** `.pi/extensions/execute/progress.ts:24-37`, `.pi/extensions/execute/index.ts:68-69`, `.pi/extensions/review/mr.ts:30-32,46-48`
**Issue:**
- Output containing a ```` ``` ```` line closes the fence early.
- Output containing a line `## T002 @ ...` (from a `cat PROGRESS.md`, a markdown file, or `git log`) makes `done.includes("## T002 @ ")` treat T002 as done, so it is skipped forever.
- The same line makes `progressEntries` split the MR's Verification section into fabricated entries.

**Fix:** Fence with a delimiter longer than any backtick run in the output, for example `"`".repeat(maxRun + 1)`. Find completed tasks with a line-anchored regex that ignores fenced content, or keep a separate machine-readable index such as a JSON sidecar or a front-matter list.

### WR-05: PROGRESS.md stores unredacted, unbounded tool output in the work repo

**File:** `.pi/extensions/execute/index.ts:107-111,133`, `.pi/extensions/execute/progress.ts:116-132`
**Issue:**
- Every tool result of the run is stored verbatim on disk, including whole file bodies from `read` (`.env`, tfvars, kube config if allowed). Redaction happens only in `buildMrBody` and the reviewer context.
- `.pi/work/` is git-ignored in *this* repo only, not in the user's work repo where /execute runs. A model `git add .` therefore commits PROGRESS.md. `driftAbort` HALTs on it, but per CR-05 the commit stays.

**Fix:** Record only the verification command's output (see CR-03), passed through `redactString` and size-capped. Have /grill or /execute refuse (or append to `.git/info/exclude`) when `.pi/work/` is not ignored in the cwd repo.

### WR-06: `REVISION_CAP` is advisory, and its counters leak across tasks and slugs

**File:** `.pi/extensions/execute/index.ts:35-39,124-129`
**Issue:**
- `attempts > REVISION_CAP` and `stallDetected` only change the wording of the error notification; `/execute` never refuses a further attempt.
- `attempts` and `lastErrors` live in the extension closure and reset only on success, so the count follows the user across tasks and slugs.

**Fix:** Persist attempts per `(slug, taskId)` and refuse arming once the cap is exceeded or a stall is detected, until the user explicitly resets.

### WR-07: The overall ambiguity score is taken from the model, not computed

**File:** `.pi/extensions/grill/scorecard.ts:200-221`, `.pi/extensions/grill/scorecard-parse.ts:11,18-19`
**Issue:** `gateAmbiguity` trusts a model-written `Overall:` number. All four dimensions at the 0.7 floor imply roughly 0.3 ambiguity, above `SCORE_GATE` 0.2. A self-reported `Overall: 0.1` still passes. Also, `OVERALL_PATTERN` takes the first "overall" anywhere in §8.
**Fix:** Derive the overall score, for example `overall = 1 - mean(dimension scores)`. Either ignore the model's value or reject when the two disagree.

### WR-08: Gate-depth notices claim mechanisms that never run

**File:** `.pi/extensions/execute/index.ts:75-80`, `.pi/extensions/review/index.ts:66-67`, `.pi/extensions/quality/gates.ts:245-251`
**Issue:**
- `/execute` tells the user "gate depth ...: deterministic, model-review, refute-or-promote, calibration" but runs only the (pre-change) deterministic stage.
- `/review` announces all four but runs neither deterministic nor calibration.
- `grill` and `plan` are listed with ALL_MECHANISMS but consult none.

Notifications should describe what ran, not what is allowed.
**Fix:** Have each command report only the mechanisms it actually executed, or narrow `GATE_DEPTH_BY_WORKFLOW` to what each command implements.

### WR-09: The requirement-id grammar differs across modules, so delegated mode throws on valid plans

**File:** `.pi/extensions/plan-ceremony/requirement-ids.ts:7`, `.pi/extensions/execute/handoff.ts:55-68,71-74,85-93`
**Issue:**
- `extractSpecRequirementIds` accepts any `R\d{1,4}` token, so `validatePlan` passes.
- `buildHandoffPacket` only recognises `R<n>:` entries (colon required, body capped at 2000 characters, terminated only by the next `R\d:` or end of string). `- **R1** - ...`, `R1. ...`, or a final entry followed by more than 2000 characters makes it throw, after `/execute` has already validated the plan.
- `selectReferencedFacts` requires a §2 claim to appear verbatim inside requirement text, which almost never happens, so the child almost never gets the §2 facts.

**Fix:** Share one parser that both `validatePlan` and the handoff use, and reject a SPEC whose §3 ids lack an entry at /plan time. Select facts by an explicit `[R#]` tag on §2 rows instead of substring matching.

### WR-10: The delegated dispatch never names `executor-handoff`, and its evidence would be the parent's view only

**File:** `.pi/extensions/execute/index.ts:85-87`, `.pi/agents/executor-handoff.md`
**Issue:**
- The brief says "Dispatch this packet to the subagent tool" without naming the agent, so the model may pick any agent and the isolated-context contract is not guaranteed.
- Child tool results do not raise the parent's `tool_execution_end`. In delegated mode the evidence is the `subagent`/`bg_wait` tool's summary text, which is a model claim.

**Fix:** Put `agent: "executor-handoff"` into the brief explicitly. In delegated mode, require the parent to re-run the verification command itself after `bg_wait` (ties to CR-03).

### WR-11: Plan-mode messages still point to `/plan`, which now launches the ceremony

**File:** `.pi/extensions/plan-mode/index.ts:116,295,327`
**Issue:**
- The block reason shown when plan mode refuses a command says "Use /plan to disable plan mode first".
- The todo hint says "Create a plan first with /plan".

After the rename, `/plan` starts the ceremony, which asks a read-only session to write PLAN.md.
**Fix:** Update all three strings to `/plan-mode` and record this as part of DEVIATION 6.

### WR-12: `git diff --name-only` quotes non-ASCII paths

**File:** `.pi/extensions/execute/progress.ts:185-197`, `.pi/extensions/review/index.ts:70-71`
**Issue:** Verified: a file `é.ts` comes back as `"\303\251.ts"`. In /execute this fails closed (the path is "malformed"). In /review the quoted path fails `existsSync`, so the file's contents silently drop out of the reviewer contract, and it shows as bogus drift.
**Fix:** Same as CR-02: use `-z` with `core.quotePath=false`.

### WR-13: Several phase tests don't exercise the production path

**File:** `tests/unit/artifact-count.test.ts:119-140`, `tests/integration/grill-command.test.ts:246+`, `tests/integration/plan-command.test.ts:258+`, `tests/integration/scope-drift.test.ts:44-51`, `tests/integration/review-mr.test.ts:96-104,152`, `tests/integration/execute-workflow.test.ts:144-162`
**Issue:**
- `artifact-count` ("drives the real write paths"), `grill-command` and `plan-command` prove `writeSpecIfGated`/`writePlanIfGated`, which no command calls (CR-04). `artifact-count` also writes REVIEW.md itself.
- `scope-drift` asserts the rename gap as correct (CR-02).
- `review-mr` asserts the unverified flag (WR-02).
- No test drives the `/review` command handler: slug resolution, the stop/approval branch, "MR only after REVIEW.md".
- The execute happy path never proves the verification command ran (CR-03).

**Fix:** Drive each command handler through its real path. Add a /review handler test with a stubbed `runReview` and glab. Turn the rename and duplicate-flag cases into failing-then-passing regressions.

## Info

### IN-01: Rendered SPEC and PLAN footers point to a section that no longer exists

**File:** `.pi/extensions/grill/spec-schema.ts:680-684`, `.pi/extensions/plan-ceremony/plan-schema.ts:281-286`
**Issue:** Both footers say "see this module's own 'WHAT THIS VALIDATOR DOES NOT, AND CANNOT, PROVE' section". That section was removed when the headers were trimmed.
**Fix:** Point to `docs/WORKFLOWS.md` or drop the reference.

### IN-02: Comment discipline (AGENTS.md) in new production code

**File:** `.pi/lib/work-artifacts.ts:1-11,16-25,49-57,60-70`; `.pi/extensions/execute/handoff.ts:3-4`; `.pi/extensions/grill/scorecard.ts:1-8,22,71`; `.pi/extensions/grill/spec-schema.ts:9,281`
**Issue:** These comments break AGENTS.md's rules:
- Headers and JSDoc run far past one or two lines.
- They name tests and callers: "contributing-boundary.test.ts matches...", "tests/unit/work-artifacts.test.ts asserts the count", "Named so quality/rules.ts magic-number does not fire".
- They cite internal planning documents (FEATURES.md Part 2/3) rather than external facts.

Requirement IDs also leak into model- and user-facing strings, which the comment scanner cannot see: `FLOW-04`, `FLOW-05`, `QUAL-03` in `spec-schema.ts`; `RB-07-02`/`RB-09-03` in `handoff.ts:28-30` and `gates.ts:44-46`; FEATURES.md references in the scorecard `why` strings.
**Fix:** Trim to the WHY, move the rationale into docs/WORKFLOWS.md, and remove planning IDs from runtime strings.

### IN-03: `executor-handoff.md` cites a stale version and ships a planning note into the child prompt

**File:** `.pi/agents/executor-handoff.md:13-32`
**Issue:** The file cites `pi-subagents@0.49.0`, but settings pin `0.76.1` and `handoff.ts` cites `0.76.1`. With `systemPromptMode: replace`, the HTML comment full of RB/ROUTE/FLOW IDs is likely sent verbatim as part of the child's system prompt, which wastes tokens on a cheap model.
**Fix:** Move the note to docs and update the version citation.

### IN-04: Windows glab spawn uses `shell: true` without needing it

**File:** `.pi/extensions/review/mr.ts:93-97,110`
**Issue:** glab ships as `glab.exe`, not a `.cmd` shim. Routing it through cmd.exe adds `%VAR%` expansion inside quoted arguments (for example a temp path) for no benefit.
**Fix:** Use `shell: false` for glab on every platform.

### IN-05: Unguarded throws and raw ENOENT messages

**File:** `.pi/extensions/grill/index.ts:73-77`, `.pi/extensions/plan-ceremony/index.ts:80-84`, `.pi/extensions/execute/index.ts:58`
**Issue:**
- `currentBranch` can throw (git missing), and in /grill and /plan it sits outside the try.
- /execute reads SPEC.md without an existence check, so the user sees a raw ENOENT.

**Fix:** Move the git check inside the try, and check that SPEC.md exists with a named message.

### IN-06: Re-running `/review` opens another MR, and withdrawn BLOCKERs disappear

**File:** `.pi/extensions/review/index.ts:89-92,105-117`
**Issue:**
- A second `/review` calls `glab mr create` again.
- BLOCKERs withdrawn by refutation are dropped from REVIEW.md without trace (`withdrawn` is discarded).

**Fix:** Detect an existing MR with `glab mr list --source-branch` (an allowed read). Render a "Withdrawn after refutation" list.

### IN-07: `/review` diffs against the local `staging` ref, which may be stale

**File:** `.pi/extensions/review/index.ts:69`
**Issue:** If local `staging` lags `origin/staging`, the merge-base is older than it should be. Upstream files then show as drift and land in the reviewed diff.
**Fix:** Run `git fetch origin staging`, then take the merge-base with `origin/staging` (both are allowed reads).

---

_Reviewed: 2026-10-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
