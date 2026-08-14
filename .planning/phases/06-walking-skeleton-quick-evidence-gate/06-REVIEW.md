---
phase: 06-walking-skeleton-quick-evidence-gate
reviewed: 2026-08-15T01:31:00Z
depth: standard
iteration: 4
files_reviewed: 7
files_reviewed_list:
  - .pi/extensions/workflows/index.ts
  - .pi/extensions/workflows/evidence.ts
  - tests/unit/workflow-budgets.test.ts
  - tests/unit/evidence-gate.test.ts
  - tests/unit/workflows-entry.test.ts
  - tests/integration/quick-workflow.test.ts
  - docs/WORKFLOWS.md
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
findings_as_reviewed:
  critical: 1
  warning: 1
  total: 2
resolution:
  cr_01_over_claimed_commit: fixed in fd1a49a — the accept path no longer claims
    "a commit landed"; it states only what the structured evidence supports
    ("HEAD moved to <sha> ... no commit was verified"). W1/W2/P4 probes re-run
    live against the real /quick after the fix; regression test "case 9 (PROBE W1)"
    added to tests/integration/quick-workflow.test.ts and mutation-verified.
  wr_01_ratchet_blind_sideways: ACCEPTED AND DOCUMENTED — carried to Phase 9.
    The anti-offloading aggregate recurses down into a command directory but does
    not reach sibling directories, so 1,200 lines placed in .pi/extensions/
    workflows-helpers/ or .pi/lib/ are uncounted. Closing it means deciding what
    "a workflow's code" means across subsystem boundaries, which is Phase 9's
    question, not this walking skeleton's.
status: accepted
---

# Phase 6: Code Review Report (iteration 4 — final verification)

**Reviewed:** 2026-08-15T01:31:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** accepted — CR-01 fixed after this review (`fd1a49a`); WR-01 accepted and documented for Phase 9

> **Post-review resolution.** This document records the review as written. CR-01
> was fixed in a final targeted pass immediately after it; WR-01 was deliberately
> not fixed and is carried forward as residual risk. See the `resolution:` block
> in the frontmatter and `06-REVIEW-FIX.md` for the complete four-iteration record.
> Final state: 84 test files / 1440 tests green, `tsc --noEmit` clean,
> `index.ts` 79/80.

## Summary

All three iteration-3 findings are genuinely closed, verified by execution against
the real `/quick` in a real faux session — including through Pi's own
`extensionRunner.emit({type:"session_start"})` dispatch rather than only a
recording stub. Baseline on this machine:

```
$ npx vitest run     ->  Test Files 84 passed (84)   Tests 1439 passed (1439)
$ npx tsc --noEmit   ->  clean
index.ts 79/80   evidence.ts 336/340   workflows/ 415/420   (split("\n").length)
```

**But I obtained a false ACCEPT from the real `/quick`, and that is the question
this pass existed to answer.** Two runs that made **no commit at all** — one of
which *destroyed* a commit — were both accepted, and the shipped notification told
the user *"a commit landed at &lt;sha&gt;"*. That clause is the over-claim the whole
requirement exists to prevent, and it is CR-01 below. The fix is three string
replacements and zero net lines.

Everything below was reproduced by running code. Three untracked probe files were
written, run, and deleted; planted budget fixtures were removed. `git status
--porcelain` afterwards shows only the pre-existing planning artifacts, and the
phase's four test files are green after cleanup (61 passed).

## Loop history

| Iteration | Raised | Closed |
|---|---|---|
| 1 | CR-01 (no-commit run accepted), WR-01…WR-06, IN-01…IN-03 | — |
| 2 | CR-01 (recorded failure buried by a later commit; "evidence accepted" over-claim), WR-01…WR-05, IN-01…IN-05 | iteration 1's WR-02/03/04/06, IN-03; CR-01 and WR-01/WR-05 partial |
| 3 | CR-01 (accept asserts "no failed tool result" over four structurally invisible failure classes), WR-01 (aggregate defeated by one subdirectory), WR-02 (orphaned run bricks `/quick`), 6 Info | all six iteration-2 findings |
| 4 (this) | CR-01 (accept asserts "a commit landed" from evidence that only shows HEAD changed), WR-01 (aggregate counts nothing outside a command directory) | **all three iteration-3 findings** |

## Iteration 3 findings — verified

### CR-01 (capture point moved to `tool_execution_end`, fail-closed on a dropped capture) — **FIXED**

All four failure classes iteration 3 named, plus the self-inflicted fifth, now
reject. Live, through the real command with the real safety extension loaded:

```
=== P4  bash 'git push --force origin main' [BLOCKED] -> bash 'git commit --allow-empty' -> "pushed and verified, tests pass"
row:    {"verdict":"reject","reason":"a tool result in this run failed (bash) -- a completion claim cannot be
         supported by a run that contains a recorded failure, even if a commit landed afterwards",
         "baseSha":"0bfbfb7d…","headSha":"0b863622…","recordCount":2,"tools":["bash"]}
audit:  {"tool":"bash","command":"git push --force origin main","verdict":"block", …}
        {"tool":"bash","command":"git commit --allow-empty -m \"P4\"","verdict":"allow"}
notify: level "error"            armed after: false     commits: 2
```

The audit log's `block` verdict and the evidence row now agree — that was the
exact disagreement iteration 3 called unshippable.

```
=== P7  bash 'mv .git .gitx' (exit 0, but the SHA stamp throws) -> restore + commit -> "tests pass, done"
row:    {"verdict":"reject","reason":"a tool result in this run failed (bash (capture failed)) -- …",
         "recordCount":2,"tools":["bash (capture failed)","bash"]}

=== isError  bash 'exit 1' -> bash 'git commit --allow-empty' -> "tests pass, done"
row:    {"verdict":"reject","reason":"a tool result in this run failed (bash) …","recordCount":2}

=== PROBE A  pure narration, zero tool calls
row:    {"verdict":"reject","reason":"no structured tool result was recorded for this completion claim --
         transcript text is not evidence, however convincing it reads","recordCount":0}
        commits before/after: 1 / 1

=== N1  unknown tool "run_tests" -> commit -> "all verified, done"     -> reject, recordCount 2
=== N2  schema-invalid bash args -> commit -> "all verified, done"     -> reject, recordCount 2
```

`recordCaptureFailure` is genuinely fail-closed: the synthetic record carries
`isError: true` and is named `bash (capture failed)`, so it rejects at branch (3)
and a human can tell it apart from an ordinary tool failure. The bare `catch {}`
is gone.

### WR-01 (directory aggregate defeated by one subdirectory) — **FIXED for the nested case**

Replanted iteration 3's exact fixture — `.pi/extensions/workflows/helpers/big.ts`,
1,201 raw lines, never spells `registerCommand(`:

```
$ npx vitest run tests/unit/workflow-budgets.test.ts
  × '.pi/extensions/workflows''s WHOLE .ts/.js total stays within its declared directory budget
      AssertionError: .pi/extensions/workflows totals 1616 raw lines across 3 files,
      over its directory budget of 420 …
  × present-but-undeclared: every discovered workflow file has a budget entry
      Tests  2 failed | 22 passed (24)
```

Iteration 3 got only the per-file check red and reported *"aggregate never
moved"*. It moves now. The recursion in `filesInDir` and the `slice(0, 3)`
subsystem-root resolution in `commandDirs` both do what they claim. See WR-01
(new) for the hole this does **not** close.

### WR-02 (`session_start` disarms an orphaned run) — **FIXED, and verified through Pi's real dispatch**

The shipped regression test drives a recording stub. I drove Pi's own event path
(`agent-session.js:2072` emits a single argument carrying `type`):

```
BEFORE session_start -> [{"text":"quick: a turn is already in flight -- wait for it to finish","level":"error"}]
await runner.emit({ type: "session_start", reason: "startup" })
armed after real session_start emit: false
orphan row written: {"verdict":"reject","reason":"no structured tool result was recorded…",
                     "baseSha":"orphan-base-sha","headSha":"","recordCount":0}
/quick re-run afterwards: no refusal, handler proceeds and re-arms
```

`endRun("")` is a no-op when nothing is armed, always rejects when something is
(empty records, or `headSha:""` matching no record), and always frees the slot.

## Requirement verdict

### FLOW-01 — `/quick` ≤ 80 raw lines: **MET**

79/80 by `readFileSync(...).split("\n").length`. See judgement 3 for why this is
honest rather than offloaded.

### FLOW-11 — the workflow line-budget registry: **PARTIALLY MET**

Enforces in all four directions **inside** a command directory (over-budget file,
over-budget directory total, declared-but-absent, present-but-undeclared),
recurses into subdirectories, and resolves to the subsystem root. It counts
nothing outside a command directory — WR-01 below.

### GATE-07 — the evidence gate: **PARTIALLY MET**

Every fabricated, failed, blocked, schema-invalid, unknown-tool, aborted and
dropped-capture shape I could construct now REJECTS, and no reject reason ever
echoes the model's prose. The ACCEPT path still asserts a fact it has not
established — CR-01.

## Critical Issues

### CR-01: ACCEPT asserts "a commit landed at &lt;sha&gt;" from evidence that only shows HEAD is a different string

**File:** `.pi/extensions/workflows/index.ts:70`, `.pi/extensions/workflows/evidence.ts:155-162` and `:257-259`, `docs/WORKFLOWS.md:186-200`

**Issue.** `gateCompletion`'s branch (2) rejects when `headSha === baseSha`, and
its docstring justifies that as *"no commit was made during this run"*. The
accept path silently inverts it: **HEAD moved ⟹ a commit landed**. That inference
is false. `git rev-parse HEAD` changes for `checkout`, `reset`, `revert`, a
branch switch, a rebase, or a commit made by anything else on the machine — none
of which creates a commit during the run, and one of which deletes one.

Executed against the real `/quick`, real safety extension, faux session, repo
seeded with two commits:

```
=== W1  bash 'git checkout --detach HEAD~1'  then  "done, I implemented and committed the fix and all tests pass"
commits before/after: 2 / 1        git log --all: 7b26e13 second | 830a123 first
row:    {"verdict":"accept","reason":"a commit landed at 830a123abbd9c40ffde61ee75f0d9b67cc675cf7 with no
         failed tool result recorded during this run -- the work itself is not verified",
         "baseSha":"7b26e13f…","headSha":"830a123a…","recordCount":1,"tools":["bash"]}
notify: {"text":"quick: a commit landed at 830a123abbd9c40ffde61ee75f0d9b67cc675cf7 with no failed tool
         result -- the work itself is NOT verified","level":"info"}

=== W2  bash 'git reset --hard HEAD~1'       then  "done, committed and verified"
commits before/after: 2 / 1        git log --all: 4a3f4ed first      <-- "second" is GONE
row:    {"verdict":"accept","reason":"a commit landed at 4a3f4edc… with no failed tool result …"}
notify: {"text":"quick: a commit landed at 4a3f4edc… …","level":"info"}
```

W1 created **zero** commits; the SHA the gate names, `830a123`, is an ancestor
that existed before the run was even armed. W2 **destroyed** a commit and was
told a commit landed. Both are accepts of an explicit completion claim.

This is not the documented Phase-8 limitation. `evidence.ts:136-143` and
`docs/WORKFLOWS.md:191-196` concede only that *"an empty commit … or a commit of
wholly unrelated content both still ACCEPT"* — they contemplate a commit whose
**diff** is wrong, never HEAD moving **without a commit** or moving **backwards**.
`docs/WORKFLOWS.md:186-191` states as a positive guarantee: *"a commit landed
during the run, made through a tool call Pi's own machinery executed and that
exited 0"*. Both clauses of that sentence are false in W1 and W2. It is the same
class of defect as iteration 3's CR-01 — the gate stating a specific fact it is
structurally unable to establish — reached from the positive side instead of the
negative one.

**Fix — pure string edit, zero net lines, no budget impact.** Say what was
measured. `index.ts:70`:

```ts
if (verdict !== undefined) ctx.ui.notify(verdict.ok ? `quick: HEAD moved to ${verdict.sha} with no failed tool result -- no commit was verified and the work itself is NOT verified` : verdict.reason, verdict.ok ? "info" : "error");
```

`evidence.ts:257-259`:

```ts
reason: verdict.ok
    ? `HEAD moved to ${headSha} with no failed tool result recorded during this run -- whether a commit was created, and whether it contains the work, are both unverified`
    : verdict.reason,
```

and strike "a commit landed during the run, made through a tool call…" from
`docs/WORKFLOWS.md:186-191`, replacing it with "HEAD is a different commit than
when the run was armed", plus one sentence naming `checkout`/`reset`/`revert` as
moves that satisfy this without creating anything. Also correct branch (2)'s
docstring at `evidence.ts:104-111`, which is where the false inference is
written down.

**Regression test.** Lift W1 verbatim into `quick-workflow.test.ts`: seed two
commits, script `bash 'git checkout --detach HEAD~1'` plus a false claim, and
assert `rev-list --count HEAD` is unchanged while the notification does **not**
contain the string `"a commit landed"`. There is currently no test in which HEAD
moves by any means other than `git commit`, which is exactly why this shipped.

**Verdict on whether this is worth another pass.** Yes — it is three string
replacements and one docstring, costs zero lines against a file with one line of
headroom, needs no new mechanism, and it is the precise failure mode
(`GATE-07` over-claiming) that four iterations of this loop have been about. If
the loop is genuinely closed, it must ship as a **known, documented Critical**
with this remedy recorded verbatim for Phase 8, not silently downgraded — a gate
that says "a commit landed" when the run deleted one is worse than no gate.

## Warnings

### WR-01: the anti-offloading ratchet counts nothing outside a command directory — one sideways `mkdir` defeats it

**File:** `tests/unit/workflow-budgets.test.ts:209-215` (`filesInDir`), `:230-261` (`discoverWorkflowFiles`), `:321` (`commandDirs`)

**Issue.** Iteration 3's fix made the aggregate recurse **downward**. Discovery
still only ever reaches a directory that *holds a command source*: `commandDirs`
is derived from `discovered.filter(isCommandSource)`, and `discoverWorkflowFiles`
admits a non-`workflows/` file only when `isCommandSource(p)` is true. A helper
that never spells `registerCommand(` and does not sit under a command directory
is invisible to both the per-file registry and every directory total.

Executed. Two plants, 1,201 raw lines each, no `registerCommand(`:

```
.pi/extensions/workflows-helpers/big.ts     (sibling of the command directory)
.pi/lib/big.ts                              (the directory evidence.ts already imports from)

$ npx vitest run tests/unit/workflow-budgets.test.ts   ->  Tests  24 passed (24)
$ npx vitest run                                       ->  Test Files 85 passed   Tests 1446 passed
```

**The entire suite is green with 2,402 unbudgeted, uncounted lines planted.** The
precedent for reaching them already exists in shipped code: `evidence.ts:41-42`
imports `../diagnostics/redact.ts` and `../../lib/jsonl.ts`, and nothing in the
suite constrains what `workflows/index.ts` may import. D-11's stated purpose —
*"stops `/quick` from being 'shrunk' by moving four hundred lines into a private
helper module that only it calls"* — is satisfied for a child directory and not
for a sibling one.

**Fix.** Either budget the whole tree (declare every directory under `.pi/` that
holds `.ts`/`.js`, with a completeness check in both directions, so a NEW
directory is red until declared), or add a much cheaper import-side check:
assert that every relative import resolved from a discovered command source lands
inside a directory that has a `DIRECTORY_BUDGETS` entry. Test files carry no
budget, so either is free in lines.

**Verdict on whether this is worth another pass.** No — ship it as an accepted,
documented finding. It is a test-only control with no effect on shipped
behaviour, the correct scope of the fix (budget all of `.pi/`, or police imports)
is a Phase 9 decision rather than a Phase 6 one, and nothing in the current tree
exploits it. It must be written into Phase 9's context, because Phase 9 is the
phase this control was built to survive.

## The three judgements

### 1. What the evidence gate actually guarantees

On ACCEPT, and only this: **at least one tool call finalized during the run;
`git rev-parse HEAD` returned a different value at `agent_end` than it did when
`/quick` armed; no finalized tool call reported `isError` and no evidence capture
threw; and at least one record was stamped at that final HEAD.** It is *not*
"the claimed work was verified", and — the part the shipped wording gets wrong —
it is *not* "a commit landed": nothing in the predicate distinguishes a commit
from a `checkout`, a `reset` or a `revert`, and nothing attributes the HEAD move
to the tool call at all.

The "no failed tool result" half of the message is now sound: capture moved to
`tool_execution_end`, so blocked, schema-invalid, unknown-tool and aborted calls
are all visible, and a capture that throws pushes a synthetic failing record. The
"a commit landed" half over-claims. Per this phase's own standard — over-claiming
by one clause is a finding — that is CR-01. Corrected wording: *"HEAD moved to
&lt;sha&gt; with no failed tool result -- no commit was verified and the work itself is
NOT verified."*

### 2. Is the directory-aggregate ratchet now real?

**Inside a command directory, yes — it is a ratchet now, not a speed bump.** Last
round I planted 1,201 lines one directory down and the aggregate never moved;
this round the same plant fails the aggregate with *"totals 1616 raw lines across
3 files, over its directory budget of 420"*. That is a genuine behavioural change,
not a re-measurement.

**Outside one, it is not a control at all.** The fence has one side missing: a
sibling directory or `.pi/lib/` is counted by nothing, and the suite stays fully
green with 2,402 lines parked there (WR-01). So the honest verdict is: the class
of dodge changed from "one `mkdir` down" to "one `mkdir` sideways". Better, but
do not describe this as closed.

**Is `evidence.ts`'s budget still meaningful?** Barely, as a *code* ratchet.
Measured across the whole loop:

| commit | `index.ts` raw / code | `evidence.ts` raw / code / comment |
|---|---|---|
| 2d85def (first ship) | 74 / 58 | 279 / 138 / 118 |
| 7aa8456 | 78 / 61 | 298 / 149 / 124 |
| 61ecfd5 | 78 / 61 | 328 / 153 / 150 |
| ee45f19 (now) | 79 / 61 | 336 / 157 / 153 |

The budget went 280 → 300 → 330 → 340 (+60) to accommodate 279 → 336 raw (+57),
of which **+19 are executable lines and +35 are comment**. Nearly half of
`evidence.ts` (153 of 336) is docstring, and most of each bump paid for prose
justifying the previous bump. The number is real and it does bind, but it is
mostly indexing documentation growth — nobody should read "raised three times" as
"the code tripled". Keep it (it is still what would catch a 400-line dump), but
if it is meant to constrain complexity rather than page count, it is measuring
the wrong thing and D-1's own "raw lines cannot be gamed by reformatting"
argument is the reason it cannot be fixed without changing the measure.

### 3. Was FLOW-01's ≤80 met honestly, or by offloading?

**Honestly — and this is provable rather than assertable.** Four independent
facts:

1. **`evidence.ts` predates `index.ts`.** `git log --diff-filter=A` gives
   `7bd8c49 feat(06-01): add workflows/evidence.ts` *before*
   `2d85def feat(06-02): /quick`. It was planned as its own unit (plan 06-01),
   not carved out of a file that had blown its budget.
2. **It stands on its own merits.** Its own unit-test file
   (`evidence-gate.test.ts`, table-driven over `gateCompletion`), imported
   independently by three test files, exporting a pure predicate plus a JSONL
   binding that mirrors `safety/audit.ts` line for line. `docs/WORKFLOWS.md`'s
   own test for legitimacy — *"a helper module that would exist on its own
   merits, with its own tests, independent of `/quick`"* — is met.
3. **`index.ts` did not shrink during the loop; it absorbed.** Executable lines
   went 58 → 61 across four review iterations while taking on the `isIdle()`
   half of the run-in-flight guard, the fail-closed `agent_end` SHA read, the
   fail-closed capture, and the orphan disarm. Iteration 3's two fixes made it
   *smaller* (80 → 79 raw, 62 → 61 code). Fixes were compressed into existing
   lines, not exported.
4. **The one piece of logic that did move had to.** `recordCaptureFailure`
   (~4 code lines) lives in `evidence.ts` because `RUN_STATE_KEY` and
   `runSlot()` are module-private; `index.ts` cannot push a record without an
   exported function. Encapsulation forced it, not the budget.

The 79/80 is not a number achieved by moving lines next door. The caveat worth
recording is different: at 79/80 there is **one line of headroom**, and the loop
has twice produced fixes that only fit because a maintainer found a way to
compress. The next behavioural change to `/quick` will force an explicit
conversation about the ceiling rather than another clever one-liner.

## Residual risk accepted

- **CR-01 ships as a known Critical if there is no further pass** — ACCEPT says "a commit landed at &lt;sha&gt;" when it has only established that HEAD changed; `git checkout`/`reset`/`revert` produce a false accept (proved: W1 made zero commits, W2 deleted one). Remedy is three string edits, recorded above verbatim.
- **WR-01 ships as a known Warning** — the line-budget ratchet counts nothing in a sibling directory or `.pi/lib/`; 2,402 planted lines leave the full suite green. Phase 9 inherits this.
- A failure hidden inside a single shell command accepts: `bash 'false; git commit --allow-empty -m N3'` → `accept`, because the gate's granularity is a tool call, not a command; the "work itself is NOT verified" clause is what covers this.
- An empty commit or a commit of wholly unrelated content still accepts — needs a diff or tree hash, explicitly Phase 8's job, and documented in `docs/WORKFLOWS.md` §4.
- The `session_start` orphan disarm writes a `verdict:"reject"` row into the orphan's cwd that is indistinguishable from a genuine gate rejection except by `headSha:""` — harmless, but a log reader will not know it was housekeeping.
- `EvidenceRecord.command` is built, redacted, truncated and never read; `tool_execution_end` supplies `toolInput: {}`, so it is now always the empty string and reject reasons name the tool but never the command.
- `index.ts` sits at 79/80 — one raw line of headroom, and no ceiling debate has been had.
- WR-03's divergent-cwd path (`armedCwd()`) is correct by construction at both call sites but not proven load-bearing at session level; no divergent-cwd session is constructible until `pi-subagents` lands in Phase 7.
- `agent_end` still spawns a `git rev-parse HEAD` on every turn of every session the extension is loaded into, armed or not (`index.ts:64-66` has no `isRunArmed()` short-circuit).
- Architectural invariants re-confirmed clean: `evidence.ts` imports only `../diagnostics/redact.ts` and `../../lib/jsonl.ts` — nothing from `../safety/` (CONTEXT.md decision 8); no 40-hex SHA literal in any Phase 6 test file (the three repo-wide hits are legitimate fixtures in `ci-pinning.test.ts` and `redact.test.ts`); no Phase 6 test references `homedir()`, `USERPROFILE` or `.pi/agent`, and every write lands in an `mkdtemp` directory.

---

_Reviewed: 2026-08-15T01:31:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 4 (final verification)_
