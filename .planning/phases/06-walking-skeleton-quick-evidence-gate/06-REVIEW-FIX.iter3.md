---
phase: 06-walking-skeleton-quick-evidence-gate
fixed_at: 2026-08-14T16:43:25Z
review_path: .planning/phases/06-walking-skeleton-quick-evidence-gate/06-REVIEW.md
iteration: 2
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 6: Code Review Fix Report

**Fixed at:** 2026-08-14T16:43:25Z
**Source review:** .planning/phases/06-walking-skeleton-quick-evidence-gate/06-REVIEW.md (iteration 2)
**Iteration:** 2

**Summary:**
- Findings in scope: 6 (CR-01, WR-01, WR-02, WR-03, WR-04, WR-05 -- iteration 2's own numbering)
- Fixed: 6
- Skipped: 0

This is iteration 2 of the fix/re-review loop -- the last fix round before
the cap. Iteration 2's reviewer re-verified iteration 1's fixes EMPIRICALLY
by driving the real `/quick` against a real faux session and found the
headline requirement (GATE-07) still not fully met: the gate could not
distinguish "a commit landed via a tool call that exited 0" from "the
claimed work was verified", and a run holding a captured structured
FAILURE from its own execution could still print `quick: evidence
accepted` as long as a commit landed afterwards. All six iteration-2
findings are now fixed, each verified with a real RED-then-GREEN mutation
test, several reproduced live against the real `/quick` command through a
real faux session (not merely at the pure-function level).

## Fixed Issues

### CR-01: the gate endorsed a run whose only verification FAILED, and could not tell a real fix from an empty commit

**Files modified:** `.pi/extensions/workflows/evidence.ts`, `.pi/extensions/workflows/index.ts`, `tests/unit/evidence-gate.test.ts`, `tests/integration/quick-workflow.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commits:** `61ecfd5` (core predicate fix), `2d3233a` (index.ts wording, entangled with WR-02's rewrite of the same `agent_end` block), `39184dc` (budget bump, entangled with WR-03/WR-04's rewrite of the same file)
**Applied fix:** `gateCompletion` gained a new branch -- "(3) any failed tool
result ANYWHERE in this run -> reject" -- placed **before** the `headSha`
narrowing (the reviewer's own prescription), so a recorded failure cannot
be aged out of relevance by a commit that lands afterwards. The docstring's
branch list was renumbered and rewritten to state plainly what the
predicate does and does not prove. Per the reviewer's honest-wording
requirement, both the `agent_end` notification text (`index.ts`) and the
written JSONL row's own `reason` field (`evidence.ts`'s `endRun`) were
changed from the overclaiming `quick: evidence accepted at <sha>` to
`quick: a commit landed at <sha> with no failed tool result -- the work
itself is NOT verified`. `docs/WORKFLOWS.md` section 4 (WR-05, below)
states the same rule for readers.

The rejection keys ONLY on `EvidenceRecord.isError` (a structural boolean
Pi's own tool-execution machinery computes from the real process exit
code) and the two real git SHAs -- never on the model's transcript text.
PROBE E and PROBE G (an empty commit, and a commit of unrelated content)
are **not** closed by this branch and cannot be closed by any SHA/exit-code
predicate -- distinguishing "the commit contains the work" from "the commit
is empty" needs a diff or a tree hash, which this phase does not have
(Phase 8's job, per `06-04-SUMMARY.md:177`). This is why item 2 (the honest
wording) exists: the gate now says what it actually checked rather than
overclaiming.

**Mutation test 1 (pure predicate, executed, RED then GREEN, real output):**
```
$ [const failing = records.filter((r) => false && r.isError);]
$ npx vitest run tests/unit/evidence-gate.test.ts
 FAIL tests/unit/evidence-gate.test.ts > GATE-07 -- gateCompletion > R3 -- failed command at the current SHA
   AssertionError: ... expected true to be false
 FAIL tests/unit/evidence-gate.test.ts > GATE-07 -- gateCompletion > M1 -- no borrowing: stale-but-passing plus fresh-but-failing
   AssertionError: ... expected true to be false
 FAIL tests/unit/evidence-gate.test.ts > GATE-07 -- gateCompletion > CR-01c (iteration 2, PROBE F) -- a failure at the STALE sha cannot be buried by a later commit's own passing record at headSha
   AssertionError: PROBE F, verbatim: ... got {"ok":true,"sha":"eba2ac7d09bbef4b33d610bbb534e11438b5f692"}: expected true to be false
   Tests  3 failed | 16 passed (19)

$ [fix restored]
$ npx vitest run tests/unit/evidence-gate.test.ts
   Tests  19 passed (19)
```

**Mutation test 2 (LIVE reproduction of PROBE F through the real `/quick` command, real faux session, real safety extension -- executed, RED then GREEN, real output):**
```
$ [same one-line mutation as above, in the running .pi/extensions/workflows/evidence.ts]
$ npx vitest run tests/integration/quick-workflow.test.ts -t "case 6"
 FAIL  ... case 6 (CR-01 iteration 2 regression, PROBE F) -- a failed verification command is not buried by a commit that lands afterwards
   AssertionError: PROBE F: a run holding a recorded failure must be REJECTED even though a commit landed
   afterwards, got: {"ts":1786725627282,"event":"workflows.evidence","verdict":"accept",
   "reason":"a commit landed at 3ff3c684f02903ec6a7eac6f2d45b27d7f727824 with no failed tool result recorded
   during this run -- the work itself is not verified","baseSha":"2cad78ef5dd561c3e5114e28c42dd71b7d2b0f2d",
   "headSha":"3ff3c684f02903ec6a7eac6f2d45b27d7f727824","recordCount":2,"tools":["bash"]}:
   expected 'accept' to be 'reject'
   Tests  1 failed | 10 skipped (11)

$ [fix restored]
$ npx vitest run tests/integration/quick-workflow.test.ts
   Tests  11 passed (11)
```
This is the reviewer's own PROBE F, reproduced against the real `/quick`
command, a real faux session and the real safety extension -- the same
harness `tests/integration/quick-workflow.test.ts` already uses -- not a
unit test written to the fix.

**Regression coverage added:** `CR-01c` row in `evidence-gate.test.ts`
(pure predicate, exact PROBE F shape: failing record at `baseSha`, passing
record at `headSha`, HEAD genuinely moved). `case 6` in
`quick-workflow.test.ts` (session-level, PROBE F verbatim: `bash 'exit 1'`
then `git commit --allow-empty` then `"tests pass, done"`, asserting
`verdict === "reject"`, `recordCount === 2`, and the reason names `bash`).

**Line cost:** `evidence.ts` 298 -> 328 raw lines (budget 300 -> 330, `why`
updated). `index.ts`'s wording change is a string edit, zero net lines
(entangled with WR-02's rewrite of the same block -- see WR-02 below for
the combined line-cost accounting). `WORKFLOWS_DIR_TOTAL_BUDGET`
(now `DIRECTORY_BUDGETS`'s `workflows` entry, WR-03) raised 380 -> 410 to
cover `evidence.ts`'s growth plus `index.ts` staying at exactly 80.

**Note (requires human verification):** this is a logic-shaped fix (a new
branch in a first-match-wins predicate, and its position relative to the
existing branches is load-bearing). Both mutation tests above pass, but
per the verification strategy's logic-bug limitation, please confirm on
read that branch (3) truly sits BEFORE the `headSha` narrowing (it does --
`evidence.ts` lines 133-160) and that the docstring's renumbered branch
list (1-5) matches the code order.

### WR-01: `/quick` typed while an ordinary turn is streaming gated that turn instead, and left its own task ungated

**Files modified:** `.pi/extensions/workflows/index.ts`, `tests/integration/quick-workflow.test.ts`
**Commit:** `2d3233a` (entangled with WR-02 and CR-01's wording change -- all three land in the same few lines of `index.ts`'s command handler and `agent_end` handler)
**Applied fix:** the reviewer's own prescribed fix, applied as written:
`if (isRunArmed() || !ctx.isIdle()) return void ctx.ui.notify("quick: a
turn is already in flight -- wait for it to finish", "error");` -- zero net
lines (replaces the prior single-condition check). `ctx.isIdle()` is
available on `ExtensionCommandContext` per the CLAUDE.md `ctx` surface
table. This closes the door the original WR-01 fix (guarding only against
a second `/quick`) could not see: an ORDINARY turn already streaming (via
`session.prompt`, not through `/quick` at all) now also triggers the
refusal, so its tool results are never silently attributed to a `/quick`
run, and `/quick`'s own task is never handed off while already disarmed by
someone else's turn.

**Mutation test (executed, RED then GREEN, real output):**
```
$ [if (isRunArmed() || !ctx.isIdle()) replaced by if (isRunArmed())]
$ npx vitest run tests/integration/quick-workflow.test.ts -t "WR-01 iteration 2"
 FAIL  ... WR-01 iteration 2 regression (PROBE H2) -- /quick refuses while an ORDINARY turn ...
   AssertionError: a refusal must still report an outcome: expected +0 to be 1
   Tests  1 failed | 9 skipped (10)

$ [fix restored]
$ npx vitest run tests/integration/quick-workflow.test.ts -t "WR-01 iteration 2"
   Tests  1 passed | 9 skipped (10)
```

**Regression coverage added:** `WR-01 iteration 2 regression (PROBE H2)` in
`quick-workflow.test.ts` -- starts an ORDINARY `session.prompt(...)` (not a
second `/quick`), polls until `!ctx.isIdle()`, then calls `/quick`'s own
handler and asserts the refusal fires with `"already in flight"`, and that
no evidence row is ever written for the refused run (proving no run was
armed at all, not merely that the notification fired).

### WR-02: a `git rev-parse HEAD` failure inside `agent_end` swallowed the verdict and armed `/quick` forever

**Files modified:** `.pi/extensions/workflows/index.ts`, `tests/integration/quick-workflow.test.ts`
**Commit:** `2d3233a` (same commit as WR-01/CR-01's index.ts changes -- see above)
**Applied fix:** the reviewer's option (b) -- combined with WR-01's
zero-net-line rewrite rather than the reviewer's option (a)
(`endRunAtHead(cwd)` exported from `evidence.ts`). **Judgement call:**
option (a) would require `evidence.ts` to import `currentSha` from
`../safety/git.ts`, directly contradicting that module's own docstring
(`evidence.ts:32-37`, CONTEXT.md decision 8: "subsystems meet only inside a
command, never through an import" -- `evidence.ts` states explicitly it
"imports nothing from `../safety/`"). Nothing currently *tests* that
boundary (`contributing-boundary.test.ts` only checks for
`registerTool`/`registerCommand`), but violating a module's own stated
architectural contract to save index.ts lines is not a fix I was willing to
make silently. Option (b) keeps `currentSha` in `index.ts` (where safety
imports already live) and reads it defensively:
```ts
let sha = "";
try { sha = currentSha(armedCwd() ?? ctx.cwd); } catch { /* gate rejects on unknown SHA below */ }
```
then always calls `endRun(sha)` (never skipped), so a broken repository
still disarms and produces a REJECT verdict -- `gateCompletion`'s own
empty-records or stale-evidence branches reject on an empty-string SHA,
which is exactly the fail-closed behaviour `currentSha`'s own docstring
(`safety/git.ts:171`) asks callers to provide.

**Mutation test (executed, RED then GREEN, real output):**
```
$ [agent_end reverted to the pre-fix shape: const verdict = endRun(currentSha(...)); inside one try/catch]
$ npx vitest run tests/integration/quick-workflow.test.ts -t "WR-02 regression"
 FAIL  ... WR-02 regression (PROBE I) -- a currentSha failure inside agent_end still disarms ...
   Error: waitFor: "a reject row to land after agent_end's currentSha() failure" was not met within 5000ms
   Tests  1 failed | 1 passed | 8 skipped (10)

$ [fix restored]
$ npx vitest run tests/integration/quick-workflow.test.ts -t "WR-02 regression"
   Tests  1 passed | 9 skipped (10)
```
The RED signal here is a real timeout, not an assertion failure -- exactly
what "no verdict is ever produced" looks like from a test's perspective,
matching the reviewer's PROBE I finding precisely.

**Regression coverage added:** `WR-02 regression (PROBE I)` in
`quick-workflow.test.ts` -- reproduces the destructive command
(`git commit --allow-empty -m "done" && rm -rf .git`), waits for a reject
row to land, asserts it is a genuine `reject`, and then asserts the slot is
free (a second `/quick` is servable again, not permanently refused).

**Line cost:** `index.ts` stayed at exactly 78 -> 80 raw lines across the
combined WR-01 + WR-02 + CR-01-wording rewrite of the `agent_end` and
command-handler blocks -- **zero headroom remains**, and the file is at,
not over, the FLOW-01 80-line ceiling (`toBeLessThanOrEqual(80)`).

### WR-03: the anti-offloading directory aggregate was still scoped to `workflows/` only

**Files modified:** `tests/unit/workflow-budgets.test.ts`
**Commit:** `39184dc` (entangled with WR-04's fix and CR-01's budget bump -- all three land in a single coherent rewrite of this file, see below)
**Applied fix:** replaced the single `WORKFLOWS_DIR_TOTAL_BUDGET` constant
with a `DIRECTORY_BUDGETS` registry (`{dir, budget, why}[]`) and a new
`filesInDir(dir)` helper that sums the WHOLE `.ts`/`.js` total of a
directory -- deliberately not limited to files that individually pass
`isCommandSource`, so a sibling helper (the `grill/steps.ts` shape) is
counted even though it never spells `registerCommand(` itself. A new
"present-but-undeclared" completeness check requires every directory
holding a discovered command source to have a `DIRECTORY_BUDGETS` entry.
**Judgement call:** this generalizes the ratchet to `routing/`, `harness/`
and `diagnostics/` too (all three are now discoverable via WR-05's widened
`isCommandSource`, and each has sibling files -- `routing/modes.ts`,
`diagnostics/wire.ts`, etc. -- that were never individually budgeted). I
measured each directory's real current total and grandfathered them in
(`routing` 2224 -> 2230, `harness` 99 -> 100, `diagnostics` 3662 -> 3670),
explicitly NOT re-reviewing their tightness, per the exact precedent WR-05
set for their per-file entries in iteration 1.

**Mutation test (executed with the reviewer's own planted scenario -- RED, then RED-under-a-naive-partial-fix, then GREEN, real output):**
```
$ mkdir .pi/extensions/grill && printf '...registerCommand(...' > .pi/extensions/grill/index.ts (3 lines)
$ node -e '...1200 filler lines...' > .pi/extensions/grill/steps.ts
$ git add -f .pi/extensions/grill/
$ npx vitest run tests/unit/workflow-budgets.test.ts
 FAIL  ... present-but-undeclared: every directory holding a command source has a DIRECTORY_BUDGETS entry
   AssertionError: ... expected [ '.pi/extensions/grill' ] to deeply equal []
 FAIL  ... present-but-undeclared: every discovered workflow file has a budget entry
   AssertionError: ... expected [ '.pi/extensions/grill/index.ts' ] to deeply equal []
   Tests  2 failed | 20 passed (22)

$ # Simulated the reviewer's own predicted failure mode: declare ONLY grill/index.ts
$ # in WORKFLOW_BUDGETS (the naive fix a Phase-9 author would reach for)
$ npx vitest run tests/unit/workflow-budgets.test.ts
 FAIL  ... present-but-undeclared: every directory holding a command source has a DIRECTORY_BUDGETS entry
   AssertionError: ... expected [ '.pi/extensions/grill' ] to deeply equal []
   Tests  1 failed | 22 passed (23)
```
This proves the specific claim WR-03 makes: under the OLD mechanism (a
per-file registry only), declaring `grill/index.ts` alone would have made
the registry green while `grill/steps.ts`'s 1,200 lines shipped unbudgeted
-- the exact failure the reviewer demonstrated. The NEW directory-level
check still catches it.
```
$ [both simulated files/entries removed, git index cleaned]
$ npx vitest run tests/unit/workflow-budgets.test.ts
   Tests  22 passed (22)
```

**Regression coverage added:** `WR-03 proof: filesInDir counts a sibling
file that does NOT itself spell registerCommand( (routing/modes.ts)` --
asserts `filesInDir(".pi/extensions/routing")` includes `modes.ts` while
`isCommandSource("...modes.ts")` is `false`, directly proving the mechanism
that closes the `grill/steps.ts`-shaped hole.

### WR-04: the `existsSync` guard for a tracked-but-deleted file ran after the call that throws

**Files modified:** `tests/unit/workflow-budgets.test.ts`
**Commit:** `39184dc` (same commit as WR-03/CR-01's budget rewrite)
**Applied fix:** the reviewer's own prescription, applied as written: the
`existsSync` filter now runs FIRST in `discoverWorkflowFiles()`'s filter
chain, before `isCommandSource(p)` (which reads the file) is ever called.
`isCommandSource` itself was also made non-throwing by construction (a
`try { ... } catch { return false; }` around the read), so it can never
throw regardless of call order or a race with a concurrent delete.

**Mutation test (executed with a REAL tracked-but-deleted file -- the exact reviewer's own repro -- RED then GREEN, real output):**
```
$ echo "// probe" > .pi/extensions/zzprobe.ts && git add -f .pi/extensions/zzprobe.ts && rm .pi/extensions/zzprobe.ts
$ git status --porcelain -- .pi/extensions/zzprobe.ts
AD .pi/extensions/zzprobe.ts
$ [isCommandSource and the filter order both reverted to the pre-fix shape]
$ npx vitest run tests/unit/workflow-budgets.test.ts
 FAIL  tests/unit/workflow-budgets.test.ts [ tests/unit/workflow-budgets.test.ts ]
Error: ENOENT: no such file or directory, open 'C:\...\.pi\extensions\zzprobe.ts'
 ❯ isCommandSource tests/unit/workflow-budgets.test.ts:174:33
 ❯ discoverWorkflowFiles tests/unit/workflow-budgets.test.ts:227:5
   Tests  no tests

$ [fix restored, git index cleaned: git rm --cached -f .pi/extensions/zzprobe.ts]
$ npx vitest run tests/unit/workflow-budgets.test.ts
   Tests  22 passed (22)
```
`Tests no tests` under the mutation is the exact silent-total-disablement
shape the reviewer described: FLOW-11's registry, the 80-line ceiling and
the completeness check all stop enforcing at once, with no red assertion
naming what broke -- only a raw ENOENT at collection time.

**Regression coverage added:** `WR-04 -- a path that does not exist on disk
classifies as false, never throws` -- direct unit coverage of
`isCommandSource(".pi/extensions/does-not-exist.ts")` returning `false`
rather than throwing, plus a smoke assertion that `discoverWorkflowFiles()`
itself never throws.

### WR-05: `docs/WORKFLOWS.md` described a `/quick` that no longer existed

**Files modified:** `docs/WORKFLOWS.md`
**Commit:** `d235878`
**Applied fix:** section 2's step list rewritten from five to the real
seven steps, naming the two undocumented refusals (session-model match,
run-in-flight guard including the `!ctx.isIdle()` half) with their exact
refusal text and remedy. Section 4 rewritten to state the `baseSha`/
`headSha` rule explicitly (HEAD must move; a global recorded failure
rejects before the SHA narrowing, per CR-01) and -- matching CR-01's item 2
-- to state plainly what an ACCEPT verdict does and does not guarantee: a
commit landed with no captured failure, never "the work is verified"; an
empty or unrelated commit still accepts, by design, because that
distinction needs a diff or tree hash this phase does not have.

**Verification:** no automated test enforces `docs/WORKFLOWS.md`'s prose
content (confirmed: `grep -rn "WORKFLOWS.md" tests/unit/docs-policy.test.ts
tests/unit/budget-sections.test.ts` found nothing), so this fix was
verified by re-reading the file against the actual shipped `index.ts` and
`evidence.ts` line by line after all other commits landed, confirming the
seven-step list and the SHA-based accept/reject rules match the code
exactly. No line budget applies to `docs/`.

## Skipped Issues

None -- all 6 in-scope findings (CR-01, WR-01, WR-02, WR-03, WR-04, WR-05)
were fixed within the stated constraints.

## Iteration 1 findings -- carried forward (one-line status, unchanged by this round)

| ID | iteration-1 status | iteration-2 disposition |
|---|---|---|
| CR-01 (orig.) | fixed | **Re-opened and fixed again** -- iteration 2's CR-01 is the second half of the same defect (see above). |
| WR-01 (orig.) | fixed | **Re-opened and fixed again** -- iteration 2's WR-01 is a different door into the same failure shape (see above). |
| WR-02 (orig., routing pre-flight) | fixed | Untouched this round; still verified fixed by iteration 2's reviewer. |
| WR-03 (orig., armedCwd() SHA source) | fixed | Untouched this round; still verified fixed (acknowledged as unit-proven, not session-proven until Phase 7). |
| WR-04 (orig., pruneEvidenceLogs wiring) | fixed | Untouched this round; still verified fixed. |
| WR-05 (orig., budget registry discovery) | partially fixed | **Superseded by iteration-2 WR-03** (directory aggregate) above -- the file-level discovery fix from iteration 1 stands; iteration 2 closed the directory-aggregate gap it left open. |
| WR-06 (orig., run-state/security test coverage) | fixed | Untouched this round; still verified fixed. |
| IN-01 (orig.) | deliberately not fixed | Out of iteration-2 scope (Info); untouched. |
| IN-02 (orig., ENOENT ordering) | still present, worse | **Superseded by iteration-2 WR-04** above -- fixed this round. |
| IN-03 (orig., baseSha!==headSha accept-path assertion) | fixed | Untouched this round; still present in `quick-workflow.test.ts` case 4. |

## Judgement calls recorded (the user was asleep; decisions made per the task's hard constraints)

1. **WR-02 kept `currentSha` in `index.ts` rather than moving it into
   `evidence.ts`'s new `endRunAtHead(cwd)`** (the reviewer's option (a)).
   Option (a) would require `evidence.ts` to import `currentSha` from
   `../safety/git.ts`, directly contradicting that module's own docstring
   ("imports nothing from `../safety/`", CONTEXT.md decision 8). Nothing
   currently tests this boundary, but I was not willing to silently violate
   a module's stated architecture to save index.ts lines when the
   reviewer's own option (b) achieves the identical fail-closed behaviour
   without doing so. This is why WR-01, WR-02 and CR-01's wording change
   all landed entangled in one commit (`2d3233a`) -- they share the exact
   same few lines of `index.ts`.
2. **WR-03 was applied at its widest scope**: the directory-level ratchet
   now covers `routing/`, `harness/` and `diagnostics/` too, not only a
   hypothetical new directory. This closes the SAME hole in the three
   subsystems WR-05 (iteration 1) already made discoverable but never
   directory-aggregated. I measured and grandfathered their current totals
   rather than re-reviewing tightness, per WR-05's own established
   precedent.
3. **Several commits combine multiple finding IDs** (`2d3233a`:
   CR-01(wording)+WR-01+WR-02; `39184dc`: CR-01(budget)+WR-03+WR-04) because
   the underlying Edit-tool changes landed in the same file, in adjacent or
   overlapping lines, and could not be cleanly separated into per-finding
   git commits without hand-authoring patches. Each combined commit's
   message names every finding it contains, and each finding's "Files
   modified"/"Commit" fields above point at the correct combined commit.
4. **Mutation tests were executed twice for CR-01** -- once against the
   pure `gateCompletion` predicate (fast, isolated) and once as a LIVE
   reproduction of the reviewer's own PROBE F through the real `/quick`
   command in a real faux session (`case 6`), specifically because the
   task's hard constraints call out that "a unit test written to the fix
   rather than to the requirement is exactly what this loop is trying to
   catch" -- the session-level probe is the one that cannot be gamed that
   way.

## Final verification (real output, executed at the end of this run)

```
$ npx tsc --noEmit
   (no output -- clean)

$ npx vitest run
    Test Files  84 passed (84)
         Tests  1434 passed (1434)
    Duration    31.38s

$ node -e "console.log(require('fs').readFileSync('.pi/extensions/workflows/index.ts','utf-8').split('\n').length)"
80
$ node -e "console.log(require('fs').readFileSync('.pi/extensions/workflows/evidence.ts','utf-8').split('\n').length)"
328
```

`.pi/extensions/workflows/index.ts` is **exactly 80** raw lines by the
enforced `split("\n").length` measure -- at, not over, the FLOW-01 ceiling,
with zero headroom remaining. `evidence.ts` is 328/330. The workflows
directory total is 408/410 (`DIRECTORY_BUDGETS`). `git status --porcelain`
in the working worktree showed only the six source/test files intentionally
modified; every planted mutation-test fixture (`.pi/extensions/grill/`,
`.pi/extensions/zzprobe.ts`) was removed and its git-index entry cleaned
before the corresponding commit.

## Budget registry state after this run

| File / directory | Budget (was) | Budget (now) | Measured |
|---|---|---|---|
| `.pi/extensions/workflows/index.ts` | 80 | 80 (unchanged -- not a knob) | 80/80 |
| `.pi/extensions/workflows/evidence.ts` | 300 | 330 | 328 |
| `DIRECTORY_BUDGETS`: `.pi/extensions/workflows` | 380 | 410 | 408 |
| `DIRECTORY_BUDGETS`: `.pi/extensions/routing` | (undeclared) | 2230 (new, WR-03) | 2224 |
| `DIRECTORY_BUDGETS`: `.pi/extensions/harness` | (undeclared) | 100 (new, WR-03) | 99 |
| `DIRECTORY_BUDGETS`: `.pi/extensions/diagnostics` | (undeclared) | 3670 (new, WR-03) | 3662 |

## Commits (in order)

| Finding(s) | Commit | Files |
|---|---|---|
| CR-01 (core predicate) | `61ecfd5` | `.pi/extensions/workflows/evidence.ts`, `tests/unit/evidence-gate.test.ts` |
| WR-01 + WR-02 + CR-01 (wording) | `2d3233a` | `.pi/extensions/workflows/index.ts`, `tests/integration/quick-workflow.test.ts` |
| WR-03 + WR-04 + CR-01 (budget) | `39184dc` | `tests/unit/workflow-budgets.test.ts` |
| WR-05 | `d235878` | `docs/WORKFLOWS.md` |

Each commit above was verified GREEN (`npx tsc --noEmit` clean, relevant
`npx vitest run` passing) at the moment it was made. The final verification
section above re-confirms the whole suite green after all four commits, in
an isolated worktree (`gsd-reviewfix/06-*`) that will be fast-forwarded
into `main` by the orchestrator's cleanup step.

---

_Fixed: 2026-08-14T16:43:25Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
