---
phase: 09-ceremonial-workflows
fixed_at: 2026-10-12T20:38:02Z
review_path: .planning/phases/09-ceremonial-workflows/09-REVIEW.md
iteration: 1
findings_in_scope: 20
fixed: 20
skipped: 0
status: all_fixed
---

# Phase 9: Code Review Fix Report

**Fixed at:** 2026-10-12T20:38:02Z
**Source review:** .planning/phases/09-ceremonial-workflows/09-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 20 (7 Critical, 13 Warning; Info excluded by `fix_scope: critical_warning`)
- Fixed: 20 (10 of them are marked "requires human verification" because they change logic or gate semantics)
- Skipped: 0

**Verification used:** after each fix I ran the targeted tests for that fix plus `comment-discipline`, `workflow-budgets` and `quality-rules`, all with `--maxWorkers=2`, one run at a time. I ran `npx tsc --noEmit` once per fix group and it came back clean every time. A final combined run of the 26 affected test files gave 862 passed and 1 skipped. The skipped test is the POSIX-only glab stub, which has a Windows counterpart. I did not run the full suite or audit-concurrency.

**Constraints held:**
- No FEATURES text ceiling moved. The measured totals are now grill 222/250, plan 186/200, execute 165/250, review 180/250 and quick 86/100.
- `ERROR_BUDGET_ON_OWN_SOURCE` stays at 67. One new swallowed `catch` was replaced with a non-throwing `headShaOrEmpty`, and the new literal is named (`SCORE_DIGITS`).
- Every re-measured `WORKFLOW_BUDGETS` and `DIRECTORY_BUDGETS` row follows ceil(measured/10)*10. Each one's `why` gained its new measured figure in the same commit.
- No real glab ran, no remote was contacted, and `.planning/phases/12-openspec-opt-in-skill/` was not touched.

## Fixed Issues

### CR-01: `glab mr create` target check takes the FIRST target flag; glab honours the LAST

**Files modified:** `.pi/extensions/safety/git.ts`, `docs/SAFETY.md`, `tests/fixtures/evasion-corpus.ts`, `tests/unit/git-policy.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** e083aee
**Status:** fixed: requires human verification
**Applied fix:** `scanMrCreateTarget` replaces the old extractor. It allows `mr create` only when there is exactly one target flag, given straight after `create`. The value is normalised (trimmed, `refs/heads/` stripped, lower-cased) and must not be protected.
- **Refused:** a repeated target flag (any mix of `--target-branch`, `--target-branch=` and `-b`), and any clustered or attached short flag that contains `b` (`-db x`, `-bmain`).
- **Decision:** I went stricter than the review's suggestion and made position matter. pflag hands a value-taking flag the next token even when it looks like a flag. So `--title --target-branch staging` really omits the target, and glab defaults it to the protected default branch. Requiring the target first closes that case.
- **Behaviour change:** the old allow row `--draft --target-branch staging --title x` is now a block row. A `--target-branch staging --draft --title x` allow row replaces it.
- `review/mr.ts` already puts the target first, so `/review` is unaffected.
- **New tests:** corpus rows EV-80..EV-84 (repeated flag, mixed spellings, `refs/heads/main`, `"main "`, swallowed-target), plus git-policy rows.

### CR-02: `driftAbort` misses renames

**Files modified:** `.pi/extensions/execute/progress.ts`, `tests/integration/scope-drift.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** d3d09f6
**Applied fix:** `changedFiles` passes `--no-renames`, so a move lists both paths, and this overrides any `diff.renames` user config. The scope-drift test that locked in the gap now asserts both paths and shows that the source path drifts. A second test sets `diff.renames=copies` and confirms both paths still appear.

### CR-03: PROGRESS.md claims "Exit code: 0" for a verification command nothing checked was run

**Files modified:** `.pi/extensions/execute/index.ts`, `.pi/extensions/execute/progress.ts`, `docs/WORKFLOWS.md`, `tests/integration/execute-workflow.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** f3fb730
**Status:** fixed: requires human verification
**Applied fix:**
- **Capture:** `/execute` records each `bash` command on `tool_execution_start` (Pi 1.1.0 `ToolExecutionStartEvent.args`; `tool_execution_end` carries no args), keyed by `toolCallId`. On `tool_execution_end` it keeps only a run whose whitespace-normalised command equals `task.verificationCommand`. It stores that run's output, its exit code (`structuredContent.exit_code`, from bash.js) and the HEAD it ran at.
- **Check:** `checkVerification` rejects the run when that command never ran, exited non-zero, or ran at a SHA other than the commit being recorded.
- **Prompt change:** the brief now says "commit, THEN run the verification command".
- **What PROGRESS records:** that run's own output and exit code. The hard-coded `exitCode: 0` and the concatenation of every tool output are gone.
- **New tests:** commit-only run (rejected), verification before the commit (rejected), and unrelated output excluded from PROGRESS.

### CR-04: The ambiguity gate, question budget and gated writers never run in production

**Files modified:** `.pi/extensions/grill/spec-gate.ts` (new), `.pi/extensions/grill/index.ts`, `.pi/extensions/plan-ceremony/index.ts`, `.pi/extensions/execute/index.ts`, `.pi/extensions/review/index.ts`, `.pi/skills/grill/SKILL.md`, `.pi/skills/plan-ceremony/SKILL.md`, `docs/WORKFLOWS.md`, `tests/integration/ceremony-gates.test.ts` (new), `tests/integration/execute-workflow.test.ts`, `tests/integration/plan-command.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** b063eb5
**Status:** fixed: requires human verification
**Applied fix:**
- **One gate:** `validateGatedSpec` is the single SPEC gate. It runs `validateSpec`, then requires at least one §3 `R<n>` id and non-empty §6 and §7, then runs `gateAmbiguity` over §8. It lives in a new module so `spec-schema.ts` takes no new imports.
- **Writers:** `writeSpecIfGated` and `writePlanIfGated` now use that gate. The `/plan` pre-flight, `/execute` and `/review` revalidation use the same gate.
- **`/grill` wiring:** `/grill` arms a run. On every `before_agent_start` it injects the turn's `nextQuestionSlot`, or the exhausted message, plus the last gate refusal. On every `agent_end` it passes any changed SPEC.md through `writeSpecIfGated`. A pass re-renders the file and disarms; a refusal is fed to the next turn. Once the hard budget is spent without a passing SPEC, it disarms with an error.
- **`/plan` wiring:** `/plan` does the same with `writePlanIfGated` on PLAN.md.

Decisions:
1. The model still writes SPEC.md and PLAN.md in place. I did not add a draft file, because `ARTIFACT_FILES` fixes the set at four. An ungated SPEC.md on disk cannot flow downstream, because every reader re-runs the same gate.
2. There is no ASSUMPTION override that lets an unmet floor pass. The consumer gate cannot tell a user override from a model-written stamp. The skill and docs now say the gate cannot be overridden.
3. `/grill --resume` starts a fresh question budget, as the user's explicit choice to keep asking.

The test fixtures that used `scorecardBody: "Overall: 0.1"` now carry a full passing scorecard. `ceremony-gates.test.ts` drives both handlers and their settle hooks.

### CR-05: Drift HALT and rejected runs are not sticky

**Files modified:** `.pi/extensions/execute/index.ts`, `.pi/extensions/execute/progress.ts`, `.pi/extensions/review/index.ts`, `docs/WORKFLOWS.md`, `tests/integration/execute-workflow.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** bf019d6
**Status:** fixed: requires human verification
**Applied fix:**
- **Pinned base:** on a slug's first arm, `/execute` appends a `Drift base: <sha>` line to PROGRESS.md. Drift is then measured from the last accepted entry's SHA, or from that pinned base, never from the new attempt's HEAD. The evidence gate's own run base stays the current HEAD. A rejected or halted commit stays inside every later diff until it is reverted. The test shows a second `/execute` still HALTs on the earlier `src/b.ts`.
- **`/review`:** a non-empty `scopeDrift.drifted` list now joins the stop reasons and needs `ctx.ui.confirm` approval. A non-approvable stop still refuses outright.

### CR-06: No deterministic gate ever checks the executor's change

**Files modified:** `.pi/extensions/execute/index.ts`, `.pi/extensions/review/index.ts`, `tests/integration/execute-workflow.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** bcaad77
**Status:** fixed: requires human verification
**Applied fix:**
- **`/execute`:** the settle handler re-runs `runQuickGateStage(cwd, ctx.isProjectTrusted())` after the evidence, verification and drift checks and before `appendProgress`, and rejects on `blocking`. I kept the pre-run gate on the base tree as a baseline, so a settle failure belongs to the change.
- **`/review`:** it runs the deterministic stage at HEAD, refuses on `blocking`, and passes `gate.report` as `gateReport` instead of PROGRESS.
- **New test:** a committed anti-pattern is rejected at settle.

### CR-07: forced and all-branch pushes from a feature branch are allowed

**Files modified:** `.pi/extensions/safety/git.ts`, `docs/SAFETY.md`, `tests/unit/git-policy.test.ts`
**Commit:** 6d66456
**Status:** fixed: requires human verification
**Applied fix:** `pushTargetsProtected` strips a leading `+` before the `refs/heads/` strip, and treats `--all`, `--mirror` and `--branches` as targeting every protected branch.
- **Rows added (HEAD=`feature/x`):** `+main`, `+refs/heads/main`, `+feature/x:main`, `--mirror`, `--all --force`, `--branches`, plus a paired allow for `+feature/x`.
- **Decision:** these rows went into the git-policy table, not the evasion corpus. The corpus evaluates with HEAD=`main`, where every push already blocks, so corpus rows there would pass vacuously.

### WR-01: `/execute` recording depends on directory listing order

**Files modified:** `.pi/extensions/workflows/index.ts`, `docs/WORKFLOWS.md`, `tests/integration/execute-workflow.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** cf163d3
**Status:** fixed: requires human verification
**Applied fix:** the workflows `agent_end` returns early while `executeRunContext()` is armed, so `/execute` alone settles its run. The test that asserted the broken outcome ("workflows loaded first consumes the run") now asserts that `/execute` records with workflows loaded first.

### WR-02: `--description-file` is very likely not a glab flag

**Files modified:** `.pi/extensions/review/mr.ts`, `.pi/extensions/review/index.ts`, `docs/RUNBOOK.md`, `docs/WORKFLOWS.md`, `tests/integration/review-mr.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** 404e681
**Applied fix:** the body is now passed as one argv element after `--description`, glab's documented `-d/--description`. The temp body file is gone.

Decisions:
- **No shell anywhere:** `spawnExec` spawns `glab` with `shell: false` on every platform, so the body never meets cmd.exe. A `.cmd` shim glab is not found without a shell, and is reported as "could not be started without a shell", never run. A Windows test covers this. Removing `shell: true` also resolves IN-04.
- **Length cap:** a body over 30,000 characters is refused, not truncated. Windows' CreateProcess caps a command line at 32,767 characters.
- **No `--yes`:** I did not add it, because I could not verify it without glab.
- **Upstream check:** the "branch has no upstream" check is part of WR-03.

### WR-03: The MR is not tied to what was reviewed or recorded

**Files modified:** `.pi/extensions/review/mr.ts`, `.pi/extensions/review/index.ts`, `.pi/extensions/execute/progress.ts`, `docs/WORKFLOWS.md`, `tests/integration/review-mr.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** 5b8d025
**Status:** fixed: requires human verification
**Applied fix:**
- **Early check (`historyMismatch`, before the model review):** every PLAN task has a PROGRESS entry, every recorded SHA passes `git merge-base --is-ancestor <sha> HEAD`, and the last recorded SHA equals HEAD.
- **Before `openMr` (`upstreamMismatch`):** `@{u}` exists and equals HEAD.
- **Decision:** commits after the last entry are refused rather than listed in the body.
- **Tests:** they use a local tracking branch as `@{u}`, so no remote is ever needed.

### WR-04: Raw tool output breaks PROGRESS.md and can mark tasks done

**Files modified:** `.pi/extensions/execute/progress.ts`, `.pi/extensions/execute/index.ts`, `.pi/extensions/review/mr.ts`, `tests/integration/execute-workflow.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** c290400
**Applied fix:**
- **Fence length:** output is fenced with a backtick run one longer than the longest run inside it (minimum 3).
- **Shared parser:** a fence-aware scanner (`progressBlocks`, `recordedEntries`) is now used for `/execute`'s done-task detection, the drift base and the MR's Verification section. A `## T002 @ ...` line inside output can no longer mark a task done or split entries.

### WR-05: PROGRESS.md stores unredacted, unbounded tool output

**Files modified:** `.pi/extensions/execute/progress.ts`, `.pi/extensions/execute/index.ts`, `docs/WORKFLOWS.md`, `tests/integration/execute-workflow.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** 51107c7
**Applied fix:**
- **What is stored:** only the verification run's output, through `redactString` and cut to its last 8,000 characters with an elision marker. CR-03 had already stopped all other output from being stored.
- **Ignore check:** before arming, `/execute` runs `git check-ignore`. If nothing ignores `.pi/work/`, it appends `/<prefix>.pi/work/` to the repo's `git rev-parse --git-path info/exclude`. That file is local and never committed. It refuses if git cannot answer.
- **Decision:** I chose the exclude file over refusing. Adding the line to the work repo's `.gitignore` would itself be a tracked change that drift then flags.

### WR-06: `REVISION_CAP` is advisory and its counters leak across tasks and slugs

**Files modified:** `.pi/extensions/execute/progress.ts`, `.pi/extensions/execute/index.ts`, `docs/WORKFLOWS.md`, `tests/integration/execute-workflow.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** 35ddaa9
**Status:** fixed: requires human verification
**Applied fix:**
- **Persistence:** each rejection (evidence, verification or settle gate) appends `<!-- rejected T### errors=N -->` to PROGRESS.md. It is an HTML comment, so it stays invisible in the MR. The count is per task, read fence-aware, and survives restarts and other slugs. The closure counters are removed.
- **Enforcement:** `/execute` refuses to arm a task that is past `REVISION_CAP`, or whose last two rejections did not lower the error count. It stays refused until the user runs `/execute <slug> --reset`, which appends a `<!-- reset T### -->` line.
- **Test helper:** the execute tests' byte-identity helper now ignores this attempt log only.

### WR-07: The overall ambiguity score is taken from the model

**Files modified:** `.pi/extensions/grill/scorecard.ts`, `.pi/skills/grill/SKILL.md`, `docs/WORKFLOWS.md`, `tests/unit/grill-scorecard.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** 6c38649
**Status:** fixed: requires human verification
**Applied fix:** `gateAmbiguity` gates `max(self-reported Overall, derivedOverall)`, where `derivedOverall = 1 - mean(dimension scores)`. The model can make the score stricter but never more lenient. Four dimensions at the 0.7 floor now fail the 0.2 gate.
- **Test change:** the "every floor exactly at floor" accept row became two rows. A single dimension at its floor is accepted. All four at the floor with a self-reported 0.1 is rejected.

### WR-08: Gate-depth notices claim mechanisms that never run

**Files modified:** `.pi/extensions/execute/index.ts`, `.pi/extensions/review/index.ts`, `docs/WORKFLOWS.md`, `tests/unit/workflow-budgets.test.ts`
**Commit:** 4d2481b
**Applied fix:** I took the review's first option: notices name only what runs. `/execute` announces the deterministic gate (base tree and committed change), and `/review` announces every mechanism except calibration. `GATE_DEPTH_BY_WORKFLOW` is unchanged, because QUAL-08's selector tests assert it. WORKFLOWS section 7 now says `/grill` and `/plan` consult none of the four mechanisms.

### WR-09: The requirement-id grammar differs across modules

**Files modified:** `.pi/extensions/plan-ceremony/requirement-ids.ts`, `.pi/extensions/grill/spec-gate.ts`, `.pi/extensions/execute/handoff.ts`, `.pi/skills/grill/SKILL.md`, `tests/unit/handoff-packet.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** 07b26b2
**Status:** fixed: requires human verification
**Applied fix:**
- **One parser:** `parseRequirementEntries` is a line-based parser with no length cap. An entry opens on a line whose first token, after list, quote, heading or bold markers, is `R<n>` (`R1:`, `R1.`, `- **R1** -`). The handoff now uses this parser.
- **Gate:** `validateGatedSpec` refuses a §3 that mentions an id with no entry of its own, so `/plan` and `/execute` can no longer accept a plan the handoff later throws on.
- **Facts:** a §2 fact travels with the packet when its claim carries an `[R#]` tag for one of the task's ids. The old substring match is kept as well. The skill's §2 and §3 rows document the convention.

### WR-10: The delegated dispatch never names `executor-handoff`

**Files modified:** `.pi/extensions/execute/handoff.ts`, `.pi/extensions/execute/index.ts`, `tests/integration/execute-workflow.test.ts`, `tests/unit/handoff-packet.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** 2e09930
**Applied fix:**
- **Agent name:** the delegated brief names `agent: "executor-handoff"` through the `HANDOFF_AGENT` constant, and a test checks it against the agent file's `name:`. The brief also states that the child's report is not evidence.
- **Verification stays with the parent:** CR-03 already makes the parent's own bash run of the verification command mandatory. A delegated-mode test shows that a `subagent` result alone is rejected with "never run".
- **Caveat:** the `agent` parameter name of pi-subagents' tool could not be verified here, because pi-subagents is not installed (RB-09-03).

### WR-11: Plan-mode messages still point to `/plan`

**Files modified:** `.pi/extensions/plan-mode/index.ts`, `.pi/extensions/plan-mode/PROVENANCE.md`
**Commit:** fe55653
**Applied fix:** the blocked-command reason and the empty-todo hint now say `/plan-mode`, and so do the three comments that described the toggle. DEVIATION 6 in PROVENANCE.md records the change.

### WR-12: `git diff --name-only` quotes non-ASCII paths

**Files modified:** `.pi/extensions/execute/progress.ts`, `tests/integration/scope-drift.test.ts`
**Commit:** 21477b8
**Applied fix:** `changedFiles` now runs `git -c core.quotePath=false diff --name-only --no-renames -z` and splits on NUL. A test shows `é.ts` coming back verbatim.

### WR-13: Several phase tests don't exercise the production path

**Files modified:** `tests/integration/review-command.test.ts` (new)
**Commit:** 5bfe514
**Applied fix:**
- **New test:** `review-command.test.ts` drives the real `/review` handler in a temp repo. It replaces `runReview`, `runRefuteOrPromote` and glab's `spawnExec` with `vi.mock`.
- **Cases it covers:** REVIEW.md is written before the single MR call targeting staging; undeclared drift needs approval, and a decline opens nothing; a BLOCKER stops without asking; slug resolution refuses with no PROGRESS; an unpushed HEAD is refused.
- **Covered by earlier commits:** the rename and description-flag gaps (CR-02, WR-02); the verification-ran proof (CR-03); and handler-driven `/grill` and `/plan` (`ceremony-gates.test.ts`, CR-04). Since CR-04, the gated writers that `artifact-count`, `grill-command` and `plan-command` exercise are real production paths.
- **Left as is:** `artifact-count` still writes REVIEW.md directly. `review-command.test.ts` now covers the real REVIEW.md write.

## Skipped Issues

None. All 20 in-scope findings were fixed.

Out of scope and left untouched, per `fix_scope: critical_warning`: IN-01, IN-02, IN-03, IN-05, IN-06 and IN-07. IN-04 (glab `shell: true`) was resolved as a side effect of WR-02.

---

_Fixed: 2026-10-12T20:38:02Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
