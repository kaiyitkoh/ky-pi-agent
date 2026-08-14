---
phase: 06-walking-skeleton-quick-evidence-gate
fixed_at: 2026-08-15T00:10:00Z
review_path: .planning/phases/06-walking-skeleton-quick-evidence-gate/06-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 6: Code Review Fix Report

**Fixed at:** 2026-08-15T00:10:00Z
**Source review:** .planning/phases/06-walking-skeleton-quick-evidence-gate/06-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (CR-01, WR-01, WR-02, WR-03, WR-04, WR-05, WR-06)
- Fixed: 7
- Skipped: 0

Two Info findings were picked up as natural one-line additions riding
alongside their related Warning fixes, per the task instructions:
- **IN-02** (a tracked-but-deleted workflow file throwing a raw ENOENT)
  was folded into WR-05's commit, since both touch the exact same
  `discoverWorkflowFiles()` function.
- **IN-03** (no test asserting `baseSha !== headSha` in the accepted
  case) was folded into CR-01's commit, since it is literally the
  negation of CR-01's own regression proof.

IN-01 was left alone (dropping `EvidenceRecord.command`'s field would
be a design change outside this review-fix pass's remit, and giving it
a consumer would have cost more than a one-line addition).

## Fixed Issues

### CR-01: the evidence gate accepts a run in which nothing was committed and nothing was verified

**Files modified:** `.pi/extensions/workflows/evidence.ts`, `tests/unit/evidence-gate.test.ts`, `tests/unit/workflow-budgets.test.ts`, `tests/integration/quick-workflow.test.ts`
**Commit:** `4181be6`
**Applied fix:** `gateCompletion` now takes a `baseSha` parameter and rejects
whenever `headSha === baseSha` (HEAD never moved during the run), naming the
unmoved SHA in the reason. `endRun` passes `state.baseSha` through, so no
change to `/quick`'s call sites in `index.ts` was needed. This is the
reviewer's own prescribed fix, applied as written. `WORKFLOW_BUDGETS`'s
`evidence.ts` entry raised 280 -> 300 and `WORKFLOWS_DIR_TOTAL_BUDGET`
raised 360 -> 370 (later 380, in WR-03's commit) in the same commit as the
growth, per the registry's own ratchet procedure.

Regression coverage: two new unit rows (`CR-01a`: one passing record at
an unmoved HEAD; `CR-01b`: no records and an unmoved HEAD) in
`evidence-gate.test.ts`, plus an integration case 5 in
`quick-workflow.test.ts` reproducing PROBE A verbatim (`bash echo hi`,
no commit, model claims "I made the commit and the tests pass") and
asserting `verdict === "reject"` and the commit count is unchanged.
IN-03's one-line addition to case 4 asserts `row.baseSha !== row.headSha`
on the accept path.

**Mutation test (executed, RED then GREEN, real output):**
```
$ npx vitest run tests/unit/evidence-gate.test.ts tests/integration/quick-workflow.test.ts
   [with `if (headSha === baseSha)` replaced by `if (false && headSha === baseSha)`]
 FAIL  ... CR-01a -- HEAD never moved: ...
   AssertionError: PROBE A: `bash echo hi` with no commit must not satisfy a completion
   claim ... -- got {"ok":true,"sha":"31fa7e0b..."}: expected true to be false
 FAIL  ... case 5 (CR-01 regression) -- a real tool call that makes NO commit is rejected ...
   AssertionError: CR-01 regression: a run with no commit must be REJECTED, got:
   {"verdict":"accept","reason":"evidence accepted at b8bfe2d5...", ...}: expected 'accept' to be 'reject'
   Tests  2 failed | 24 passed (26)

$ [fix restored]
$ npx vitest run tests/unit/evidence-gate.test.ts tests/integration/quick-workflow.test.ts
   Tests  26 passed (26)
```

**Note (requires human verification):** this is a logic-shaped fix (a new
branch in a first-match-wins predicate). Both tiers of automated
verification (syntax, and the mutation test above) pass, but per the
verification strategy's logic-bug limitation, please confirm the branch
ORDER is correct on read: it sits after the empty-records check and before
the stale-SHA check, matching the reviewer's own prescription and the
updated docstring's renumbered branch list.

### WR-01: a second /quick while a turn is in flight silently steals the buffer and leaves its own run entirely ungated

**Files modified:** `.pi/extensions/workflows/index.ts`, `tests/integration/quick-workflow.test.ts`
**Commit:** `cc93880`
**Applied fix:** `isRunArmed()` is checked in the command handler immediately
before `startRun()`, refusing a second arming with `"quick: a run is already
in flight -- wait for its verdict"`. This is the reviewer's own prescribed
fix, written as a single-line `if`/`return void notify(...)` to stay inside
the line budget (index.ts was 74/80 with 6 lines of headroom shared across
WR-01, WR-02 and WR-04).

Regression coverage: a new integration case exploits the fact that
`pi.sendUserMessage` is fire-and-forget (the command handler returns before
run 1's turn settles) -- it calls `command.handler` twice back to back and
asserts the second call is refused synchronously, then lets run 1 finish and
asserts exactly one evidence row landed with `verdict === "accept"`.

**Mutation test (executed, RED then GREEN, real output):**
```
$ npx vitest run tests/integration/quick-workflow.test.ts
   [with `if (isRunArmed()) ...` replaced by `if (false && isRunArmed()) ...`]
 FAIL  ... WR-01 regression -- a second /quick while a run is in flight is refused ...
   AssertionError: the second /quick call must report exactly one refusal, synchronously,
   before run 1's turn settles: expected +0 to be 1
   Tests  1 failed | 7 passed (8)

$ [fix restored]
$ npx vitest run tests/integration/quick-workflow.test.ts
   Tests  8 passed (8)
```

### WR-02: the routing pre-flight validates a model /quick never applies

**Files modified:** `.pi/extensions/workflows/index.ts`, `tests/integration/quick-workflow.test.ts`
**Commit:** `3c1fb5a`
**Applied fix:** the command handler now refuses when
`ctx.model?.id !== plan.model.id || ctx.model?.provider !== plan.model.provider`,
naming the routed executor in the refusal text. Judgement call recorded per
the task's hard constraints: the review explicitly names this a "genuine
seam limitation... may be" and leaves the call to the fixer; I applied the
reviewer's own suggested fix rather than treating it as a non-fix, because
(a) the reviewer supplied a concrete, working code snippet, (b) it closes a
real correctness gap (the capability guard's approval is otherwise only
true by convention), and (c) the line-budget arithmetic the reviewer worried
about resolved cleanly once WR-01's own check was written as a one-liner,
leaving comfortable headroom for both.

Regression coverage: a new integration case registers TWO models under the
routed candidate's provider (`models[0]` becomes the session's own
`ctx.model`; the reviewer's own note that "the fixture registers exactly
one model, so `ctx.model === plan.model` always" is exactly what this test
breaks), asserts `plan.model.id !== ctx.model?.id` genuinely differ, then
asserts the refusal names the routed executor and costs zero provider
requests.

**Mutation test (executed, RED then GREEN, real output):**
```
$ npx vitest run tests/integration/quick-workflow.test.ts
   [with the WR-02 `if` wrapped in `if (false && (...))`]
 FAIL  ... WR-02 regression -- two models registered, session on the NON-routed one ...
   AssertionError: a refusal must still report an outcome: expected +0 to be 1
   Tests  5 failed | 3 passed (8)
```
(The other 4 failures in that run are collateral: with the guard disabled,
`/quick` armed a real run against the decoy model, which had no scripted
faux responses, leaking the global run-state slot into subsequent tests in
the same file -- itself informative confirmation the guard matters, not a
flaw in the regression test.)
```
$ [fix restored]
$ npx vitest run tests/integration/quick-workflow.test.ts
   Tests  8 passed (8)
```

### WR-03: the SHA is read from ctx.cwd, not from the repository the run was armed against

**Files modified:** `.pi/extensions/workflows/evidence.ts`, `.pi/extensions/workflows/index.ts`, `tests/unit/evidence-gate.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** `9156f35`
**Applied fix:** `evidence.ts` exports `armedCwd()` (the armed run's stored
`cwd`, or `undefined`). Both SHA reads in `index.ts` (`tool_result` and
`agent_end` handlers) changed from `currentSha(ctx.cwd)` to
`currentSha(armedCwd() ?? ctx.cwd)` -- zero net lines in `index.ts`, exactly
as the reviewer predicted.

Regression coverage: a direct unit test on `armedCwd()`'s own contract
(`undefined` before `startRun`, the exact armed cwd once armed, `undefined`
again once `endRun` disarms). A full session-level proof of the divergent-
cwd scenario (a worktree-isolated subagent recording into a different repo
than the one `/quick` was armed against) was NOT attempted -- `pi-subagents`
is not installed until Phase 7, and there is no way to give a faux session a
`ctx.cwd` that differs from the armed cwd without a subagent harness this
phase does not have. This is stated plainly rather than hidden: the unit
test proves the accessor is correct; it does not prove the two index.ts call
sites matter in a live divergent-cwd session, because no such session is
constructible yet.

**Mutation test (executed, RED then GREEN, real output):**
```
$ npx vitest run tests/unit/evidence-gate.test.ts
   [with `armedCwd()`'s body replaced by `return undefined;`]
 FAIL  ... WR-03: armedCwd() reports the cwd the run was armed against ...
   AssertionError: armedCwd() must return the exact cwd startRun() was called with, not
   some other ambient cwd: expected undefined to be 'C:\Users\Admin\...\quick-evidence-...'
   Tests  1 failed | 17 passed (18)

$ [fix restored]
$ npx vitest run tests/unit/evidence-gate.test.ts
   Tests  18 passed (18)
```

### WR-04: pruneEvidenceLogs is dead code, and the evidence stream is the only log stream with no retention

**Files modified:** `.pi/extensions/workflows/index.ts`, `tests/unit/workflows-entry.test.ts` (new file)
**Commit:** `61fc808`
**Applied fix:** wired `pi.on("session_start", (_event, ctx) => { pruneEvidenceLogs(ctx.cwd); })`,
mirroring `safety/index.ts` and `diagnostics/index.ts`'s own retention hooks
-- the reviewer's first option, chosen over deleting the function, since the
line budget turned out to have room (index.ts landed at 78/80 raw lines
after all four fixes).

Regression coverage: `routing/index.ts`'s own docstring states `session_start`
does NOT fire in the headless `createAgentSession` harness every
`tests/integration/*.test.ts` fixture uses -- so a session-level proof of
this wiring is structurally impossible with the tools this repo has. Added
`tests/unit/workflows-entry.test.ts`, mirroring `tests/unit/safety-entry.test.ts`'s
`stubPi()` recording-stub pattern: drives the REAL registered `session_start`
handler directly (captured via the stub, never a session), against a real
temp `.pi/logs/evidence-2000-01-01.jsonl` fixture file older than the
14-day default retention window, and asserts it is deleted. Also asserts
the entry point registers exactly `["tool_result", "agent_end",
"session_start"]` and exactly one command (`quick`).

**Mutation test (executed, RED then GREEN, real output):**
```
$ npx vitest run tests/unit/workflows-entry.test.ts
   [with the session_start handler's body commented out]
 FAIL  ... WR-04 -- the registered session_start handler actually prunes the evidence stream ...
   AssertionError: WR-04: the aged evidence log must have been deleted by pruneEvidenceLogs,
   called from the REAL registered session_start handler -- without the fix this file
   survives forever: expected [ 'evidence-2000-01-01.jsonl' ] to not include
   'evidence-2000-01-01.jsonl'
   Tests  1 failed | 3 passed (4)

$ [fix restored]
$ npx vitest run tests/unit/workflows-entry.test.ts
   Tests  4 passed (4)
```

### WR-05: the line-budget registry can be dodged by a file extension or a directory name

**Files modified:** `tests/unit/workflow-budgets.test.ts`
**Commit:** `308a9db`
**Applied fix:** `discoverWorkflowFiles()` now unions in any `.ts`/`.js` file
under `.pi/extensions/` (not just `workflows/`) that contains the literal
`registerCommand(` (`isCommandSource`), and the `workflows/` filter itself
widened from `.ts`-only to `/\.(ts|js)$/`. The three real command surfaces
this discovery now finds outside `workflows/` --
`.pi/extensions/routing/index.ts` (681 lines), `.pi/extensions/harness/index.ts`
(99 lines), `.pi/extensions/diagnostics/budget.ts` (703 lines) -- are
declared in `WORKFLOW_BUDGETS` in the same commit, each keeping its own
measured size as its budget (rounded up), per the reviewer's own note that
this is "the correct outcome... but it means adding their current counts as
declared entries in the same commit." IN-02's filter (`existsSync` before
summing, dropping a tracked-but-deleted file) rides in the same commit since
it touches the exact same function.

Regression coverage: the directory-aggregate test itself cannot distinguish
"the predicate works" from "everything it would catch is already declared"
(this commit declares all three files the widened discovery finds), so a
direct unit test asserts `isCommandSource` against two real files already in
the repo: `true` for `routing/index.ts` (registers `/mode`/`/escalate`) and
`false` for `evidence.ts` (whose own module docstring states it registers
nothing, per the boundary-rule test).

**Mutation test (executed, RED then GREEN, real output):**
```
$ npx vitest run tests/unit/workflow-budgets.test.ts
   [with `isCommandSource`'s body prefixed `return false && ...`]
 FAIL  ... WR-05 -- isCommandSource discovers a command surface by content, not by location
   > is true for a real file outside workflows/ that spells registerCommand( (routing/index.ts)
   AssertionError: routing/index.ts registers /mode and /escalate -- WR-05's whole point is
   that this must be discoverable even though it is not under workflows/: expected false to
   be true
   Tests  1 failed | 12 passed (13)

$ [fix restored]
$ npx vitest run tests/unit/workflow-budgets.test.ts
   Tests  13 passed (13)
```

### WR-06: the run-state machinery, the record builder and the row writer have no tests at all

**Files modified:** `tests/unit/evidence-gate.test.ts`, `tests/unit/logs-gitignored.test.ts`
**Commit:** `7aa8456`
**Applied fix:** no source change (this finding asks for missing test
coverage, not a behavioural change). Added direct unit coverage for both
documented-but-unasserted security claims (`recordFromToolResult` copies
only `command`/`path`, never any other `toolInput` field; a secret-shaped
command is redacted before storage), and for the run-state contract
(`isRunArmed()` false and `recordToolResult`/`endRun` no-ops before any
`startRun()`; a second `startRun()` discards the first buffer; `endRun()`
disarms). Also extended `logs-gitignored.test.ts`'s two halves for the
`evidence-*` stream, matching the pattern already used for the Phase 4
audit stream (a hand-written table entry plus a real `writeEvidenceRow`
call inside the "paths the writer actually produced" reality check). No
40-hex fixture literal was introduced for the log-path fixture -- non-SHA
placeholder strings (`"not-a-real-sha-base"` / `"not-a-real-sha-head"`) are
used there since that test asserts on the PATH written, never on the row's
own SHA content.

**Mutation test (executed, RED then GREEN, real output) -- the security claim, the one the reviewer specifically flagged:**
```
$ npx vitest run tests/unit/evidence-gate.test.ts
   [with recordFromToolResult's body replaced by `const raw = JSON.stringify(input.toolInput); const command = raw.slice(0, 2000);`]
 FAIL  ... copies only `command`/`path`, never any other field on toolInput (e.g. a file body)
   AssertionError: expected '{"path":"x.ts","content":"AKIAABCDEFG...' to be 'x.ts'
 FAIL  ... redacts a secret-shaped command before it is ever stored
   AssertionError: expected '{"command":"curl -H \'Authorization: ...' not to contain
   'sk-abcdefghijklmnopqrstuvwx'
   Tests  2 failed | 16 passed (18)

$ [fix restored]
$ npx vitest run tests/unit/evidence-gate.test.ts
   Tests  18 passed (18)
```

## Skipped Issues

None -- all 7 in-scope findings (CR-01, WR-01..WR-06) were fixed.

## Info findings left alone

- **IN-01** (`EvidenceRecord.command` built, redacted, truncated, never
  read): not touched. Giving it a real consumer (better reject-reason text)
  or deleting the field are both design decisions beyond a one-line fix, and
  the field's existence is not itself a defect -- left for a future plan.

## Final verification (real output, executed at the end of this run)

```
$ npx tsc --noEmit
   (no output -- clean)

$ npx vitest run
    Test Files  84 passed (84)
         Tests  1421 passed (1421)
    Duration    31.13s

$ wc -l .pi/extensions/workflows/index.ts
   77 .pi/extensions/workflows/index.ts
```

`.pi/extensions/workflows/index.ts` is 77 raw lines by `wc -l` (78 by the
budget test's own `split("\n").length` method, which counts the trailing
newline as an extra element) -- both well within the FLOW-01 80-line
ceiling, which was never treated as a knob at any point in this fix pass.

## Budget registry state after this run

| File | Budget (was) | Budget (now) | Measured |
|---|---|---|---|
| `.pi/extensions/workflows/index.ts` | 80 | 80 (unchanged -- not a knob) | 77/78 |
| `.pi/extensions/workflows/evidence.ts` | 280 | 300 | 298 |
| `WORKFLOWS_DIR_TOTAL_BUDGET` | 360 | 380 | 376 |
| `.pi/extensions/routing/index.ts` | (undeclared) | 690 (new, WR-05) | 681 |
| `.pi/extensions/harness/index.ts` | (undeclared) | 100 (new, WR-05) | 99 |
| `.pi/extensions/diagnostics/budget.ts` | (undeclared) | 710 (new, WR-05) | 703 |

## Judgement calls recorded (the user was asleep; decisions made per the task's hard constraints)

1. **WR-02 was applied as a real fix**, not skipped as "a genuine seam
   limitation." The review explicitly left this to the fixer's judgement;
   the reviewer's own code snippet was correct, closed a real gap, and the
   line-budget concern the review raised turned out not to bind once WR-01
   was written tersely. Recorded here in one paragraph as the hard
   constraints require.
2. **WR-05 was applied in full**, including the cross-subsystem discovery
   widening and the three new `WORKFLOW_BUDGETS` entries for
   `routing/index.ts`, `harness/index.ts` and `diagnostics/budget.ts`. This
   is the wider of the two options the review sanctioned for WR-05, chosen
   because the narrower option (only fixing the `.ts`/`.js` blind spot
   inside `workflows/`) would have left the second, more important escape
   (a command surface added entirely outside `workflows/`, which is
   literally Phase 9's `/grill`/`/plan`/`/execute`/`/review` risk this
   registry exists to catch) unfixed.
3. **WR-03's regression test stops at the accessor's own contract.** A
   session-level proof of the divergent-cwd scenario (worktree-isolated
   subagent) is not constructible with this repo's current test harness
   (`pi-subagents` is a Phase 7 install). Stated plainly rather than
   claimed as fully proven.
4. **IN-02 and IN-03** were folded into WR-05's and CR-01's commits
   respectively, per the task's "one-line fix falls out naturally" allowance
   -- both touch the exact function/test case their parent fix was already
   editing.

## Commits (in order)

| Finding | Commit | Files |
|---|---|---|
| CR-01 | `4181be6` | `.pi/extensions/workflows/evidence.ts`, `tests/unit/evidence-gate.test.ts`, `tests/unit/workflow-budgets.test.ts`, `tests/integration/quick-workflow.test.ts` |
| WR-01 | `cc93880` | `.pi/extensions/workflows/index.ts`, `tests/integration/quick-workflow.test.ts` |
| WR-02 | `3c1fb5a` | `.pi/extensions/workflows/index.ts`, `tests/integration/quick-workflow.test.ts` |
| WR-03 | `9156f35` | `.pi/extensions/workflows/evidence.ts`, `.pi/extensions/workflows/index.ts`, `tests/unit/evidence-gate.test.ts`, `tests/unit/workflow-budgets.test.ts` |
| WR-04 | `61fc808` | `.pi/extensions/workflows/index.ts`, `tests/unit/workflows-entry.test.ts` (new) |
| WR-05 (+ IN-02) | `308a9db` | `tests/unit/workflow-budgets.test.ts` |
| WR-06 (+ IN-03 folded into CR-01 above) | `7aa8456` | `tests/unit/evidence-gate.test.ts`, `tests/unit/logs-gitignored.test.ts` |

Each commit above was independently verified GREEN (`npx tsc --noEmit` clean,
relevant `npx vitest run` passing) at the moment it was made, by rebuilding
the fix history incrementally from the pre-review baseline rather than
splitting a single combined diff after the fact.

---

_Fixed: 2026-08-15T00:10:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
