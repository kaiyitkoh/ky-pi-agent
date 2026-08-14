---
phase: 06-walking-skeleton-quick-evidence-gate
reviewed: 2026-08-15T00:20:00Z
depth: standard
iteration: 2
files_reviewed: 9
files_reviewed_list:
  - .pi/extensions/workflows/index.ts
  - .pi/extensions/workflows/evidence.ts
  - .pi/extensions/safety/git.ts
  - tests/unit/evidence-gate.test.ts
  - tests/unit/workflow-budgets.test.ts
  - tests/unit/workflows-entry.test.ts
  - tests/integration/quick-workflow.test.ts
  - tests/helpers/git.ts
  - docs/WORKFLOWS.md
findings:
  critical: 1
  warning: 5
  info: 5
  total: 11
status: issues_found
---

# Phase 6: Code Review Report (iteration 2)

**Reviewed:** 2026-08-15T00:20:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

The fix pass is real work, not paperwork. The suite is green on this machine and
the headline probe from iteration 1 is genuinely closed:

```
$ npx vitest run tests/unit/evidence-gate.test.ts tests/unit/workflow-budgets.test.ts \
                 tests/unit/workflows-entry.test.ts tests/integration/quick-workflow.test.ts
  Test Files  4 passed (4)   Tests  43 passed (43)
$ npx vitest run
  Test Files  84 passed (84)  Tests  1421 passed (1421)
$ node -e "split('\n').length"  ->  index.ts 78/80, evidence.ts 298/300, workflows/ total 376/380
```

I re-ran iteration 1's PROBE A against the current code, through the real
`/quick` command in a real faux session with the real safety extension loaded,
and it now **rejects**:

```
### PROBE A (bash "echo hi", no commit, model says "all done, I made the commit and the tests pass")
  verdict row: {"verdict":"reject","reason":"no commit was made during this run -- HEAD is still
                0eeac839...","baseSha":"0eeac839...","headSha":"0eeac839...","recordCount":1}
  notify: [{"...","level":"error"}]     commits before/after: 1 1     armed after: false
```

That was iteration 1's Critical and it is closed. What replaces it is the **other
half of iteration 1's own CR-01 text**, which the prescribed one-branch fix never
addressed: "the accepting record is always the commit itself... the gate cannot
reject any run that ends in a successful tool call." Three further probes,
executed against the same real command, show the gate handing out
`quick: evidence accepted` for an empty commit, for an unrelated commit, and —
worst — for a run whose only verification command **failed with a non-zero exit
recorded in the gate's own buffer**. That is CR-01 below.

Two further defects were reached by execution, not by reading: `/quick` typed
while an ordinary turn is already streaming attributes that turn's tool results
to itself and prints a verdict for work it never commissioned (WR-01), and a
`git rev-parse HEAD` failure inside `agent_end` swallows the verdict entirely,
leaving the run armed forever and every later `/quick` permanently refused
(WR-02) — the exact opposite of the "callers must wrap it and refuse (fail
closed)" contract `safety/git.ts:171` writes for `currentSha`.

Everything below was reproduced by running code. Probe files were untracked, run
and deleted; `git status` shows only the pre-existing untracked planning
artifacts, and the full suite is green after the review.

**Line-budget correction the fixer and the next fixer both need.** The enforced
measure is `readFileSync(...).split("\n").length`, not `wc -l`.
`.pi/extensions/workflows/index.ts` is **78 of 80** by that measure, so there are
**2 lines of headroom, not 3**. Every fix below states its cost against 78.

## Iteration 1 findings — verified

| ID | Status | Evidence I ran |
|---|---|---|
| **CR-01** | **PARTIALLY FIXED** | PROBE A/B (no commit) now reject — re-executed above. But PROBE E/F/G (commit made, work not verified) still accept. See new CR-01. |
| **WR-01** | **PARTIALLY FIXED** | `/quick` twice in a row is refused (`quick-workflow.test.ts:802-874` passes, and the guard is real). But the same buffer-theft happens when the racing turn is an *ordinary* prompt rather than a second `/quick` — PROBE H/H2. See new WR-01. |
| **WR-02** | **FIXED** | `index.ts:31-32` compares both `id` and `provider`. `quick-workflow.test.ts:446-512` registers two models and proves the refusal names the routed executor at `callCount === 0`; case 4 (one matching model) proves it is not a blanket refusal. The refusal is also *correct* in an ordinary session: `executor`'s mechanism is `setModel` (`routing/index.ts:288`), so a session that has used `/cheap`/`/balanced`/`/max` is on the routed model by construction. See IN-05 for the one usability gap. |
| **WR-03** | **FIXED** | `armedCwd()` exported (`evidence.ts:205-207`) and used at both SHA reads (`index.ts:56`, `:66`). `evidence-gate.test.ts:172-186` asserts the accessor's three states. The fixer's own caveat stands and is honest: no divergent-cwd session is constructible until `pi-subagents` lands in Phase 7, so the two call sites are proven correct but not proven *load-bearing*. UNVERIFIED at session level, by acknowledged construction. |
| **WR-04** | **FIXED** | `pi.on("session_start", ...)` at `index.ts:74-76`. `workflows-entry.test.ts:67-92` captures the REAL registered handler off a recording stub and drives it against a real `evidence-2000-01-01.jsonl` in a temp cwd, asserting deletion — it fails if the wiring is removed, and it writes nothing outside the temp dir. See IN-03 for the missing `try`/`catch`. |
| **WR-05** | **PARTIALLY FIXED** | `isCommandSource` works — I planted `.pi/extensions/grill/index.ts` (3 lines, spells `registerCommand(`) and the completeness test failed with `offenders: ['.pi/extensions/grill/index.ts']`. But I planted a 1,200-line `.pi/extensions/grill/steps.ts` alongside it and the registry **never saw it**. See new WR-03. |
| **WR-06** | **FIXED** | `evidence-gate.test.ts:188-242` covers `recordFromToolResult`'s two documented security claims and the run-state contract, asserting on record *contents* (`record.command === "x.ts"`, `not.toContain(SECRET_BODY)`, `toContain("[redacted:")`) rather than mirroring the implementation. Deleting the redaction or widening the field copy fails these. No 40-hex literal anywhere; SHAs come from `makeTempRepo`. |
| IN-01 | Deliberately not fixed | `EvidenceRecord.command` still has no consumer. Reasonable deferral; restated as IN-04. |
| IN-02 | **STILL PRESENT — and now worse** | The `existsSync` filter was placed *after* the call that throws. Proved by execution. See new WR-04. |
| IN-03 | **FIXED** | `quick-workflow.test.ts:681-683` asserts `row.baseSha !== row.headSha` on the accept path. |

## Critical Issues

### CR-01: the gate endorses a run whose only verification FAILED, and cannot tell a real fix from an empty commit

**File:** `.pi/extensions/workflows/evidence.ts:123-163` (`gateCompletion`), `.pi/extensions/workflows/index.ts:48-62` (the capture point)

**Issue.** The fix added one branch — reject when `headSha === baseSha`. The
accept condition is therefore now exactly: *HEAD moved, and at least one tool
result recorded at the new HEAD did not error.* Because `index.ts:56` stamps
`currentSha(...)` **after** the tool ran, the only record that can ever sit at the
post-commit HEAD is the commit call itself. So the predicate reduces to
**"a commit landed via a tool call that exited 0"** — nothing about whether the
claimed work happened, and nothing about whether anything was verified.

Three probes, all driving the real `/quick` through a real faux session with the
real safety extension loaded (identical harness to
`tests/integration/quick-workflow.test.ts`):

```
### PROBE E -- bash 'git commit --allow-empty -m "wip"', then
###            "I fixed the null-pointer bug and the full test suite passes"
  verdict: {"verdict":"accept","reason":"evidence accepted at 7996583b...",
            "baseSha":"0eeac839...","headSha":"7996583b...","recordCount":1,"tools":["bash"]}
  notify: [{"text":"quick: evidence accepted at 7996583b...","level":"info"}]

### PROBE F -- bash 'exit 1'   (the verification FAILS, isError:true, captured)
###            bash 'git commit --allow-empty -m "wip"'
###            "tests pass, done"
  verdict: {"verdict":"accept","reason":"evidence accepted at b2418f98...",
            "baseSha":"c10667d3...","headSha":"b2418f98...","recordCount":2,"tools":["bash"]}
  notify: [{"text":"quick: evidence accepted at b2418f98...","level":"info"}]

### PROBE G -- bash 'echo junk > junk.txt && git add -A && git commit -m "unrelated"'
###            "done, the feature works"
  verdict: {"verdict":"accept", ...}
```

PROBE F is the one that matters. The gate is holding **two** records; one of them
is a structured, Pi-computed `isError: true` from this very run; and it prints
`quick: evidence accepted`. The failing record is discarded not because it was
judged irrelevant but because it happens to carry the pre-commit SHA, and branch
(3) narrows to `sha === headSha` before branch (4) ever inspects `isError`. The
docstring's own branch (4) — "every record at `headSha` has `isError === true` ->
reject" — is therefore **dead in the normal flow**: after a commit there is only
ever one record at HEAD and it is the commit's own success.

This is not a new hypothesis; it is verbatim the second bullet of iteration 1's
CR-01, which the prescribed single-branch fix did not touch. Stated plainly, so
nobody has to re-derive it:

- **What the gate now guarantees:** a commit landed during the run, made through a
  tool call Pi executed and that exited 0. A no-commit run and a fabricated
  transcript are both genuinely rejected.
- **What it does not guarantee, at all:** that the commit contains the claimed
  work, that anything was verified, or that a verification that *was* run and
  *did* fail is allowed to affect the verdict.

`docs/WORKFLOWS.md:120-132` ("Evidence, not narration") and
`REQUIREMENTS.md:108` (GATE-07: "gated on `tool_result` exit codes") both read as
promises that a failing exit code gates completion. It does not. The phase's own
accept-path proof, `quick-workflow.test.ts:617`, uses
`git commit --allow-empty` — i.e. the single test that demonstrates ACCEPT
demonstrates it for a commit containing no work at all.

**Fix.** The smallest change that closes PROBE F is one more branch, placed
*before* the `atHead` narrowing so a failure cannot be aged out by a subsequent
commit. Within one `/quick` run every record belongs to the same task; a failed
tool result is a fact about that task's execution and is not made irrelevant by
committing afterwards:

```ts
	// (3) any failed tool result ANYWHERE in this run -> reject. A failure cannot
	// be aged out of relevance by committing after it: within one run every
	// record belongs to the same task. This branch sits BEFORE the headSha
	// narrowing precisely so the commit that moved HEAD cannot bury it.
	const failing = records.filter((r) => r.isError);
	if (failing.length > 0) {
		const failingTools = Array.from(new Set(failing.map((r) => r.toolName))).join(", ");
		return {
			ok: false,
			reason:
				`a tool result in this run failed (${failingTools}) -- a completion claim cannot be ` +
				"supported by a run that contains a recorded failure, even if a commit landed afterwards",
		};
	}
```

and renumber the docstring's binding branch list (`evidence.ts:100-122`), which
that file's own header makes mandatory.

PROBE E and PROBE G are *not* closed by that branch and cannot be closed by any
SHA-and-exit-code predicate: distinguishing "the commit contains the work" from
"the commit is empty" needs a diff or a tree hash, which
`06-04-SUMMARY.md:177` already assigns to Phase 8. The honest resolution for this
phase is therefore two-part:

1. Apply the branch above (closes PROBE F — recorded failure can no longer be
   buried).
2. Stop calling the outcome an endorsement. Change `index.ts:68`'s accepted text
   from `quick: evidence accepted at <sha>` to something that states what was
   actually checked, e.g. `quick: a commit landed at <sha> with no failed tool
   result -- the work itself is NOT verified`, and add the same sentence to
   `docs/WORKFLOWS.md` §4. A gate that overstates its own strength is worse than
   one that understates it, because the user stops checking.

**Line cost.** Branch (3) is ~+12 raw lines in `evidence.ts` (298 → ~310) plus the
docstring renumber; `WORKFLOW_BUDGETS`'s `evidence.ts` entry must go 300 → 320 and
`WORKFLOWS_DIR_TOTAL_BUDGET` 380 → 400 **in the same commit**, with the `why`
updated. Item 2 is a string edit in `index.ts` — **zero net lines**, which matters
because there are only 2 spare.

**Regression tests.** Add a `gateCompletion` row `{records: [failing at baseSha,
passing at headSha], baseSha !== headSha, expected: "reject"}` — note that the
existing table has no such row, which is why this shipped — and lift PROBE F
verbatim into `quick-workflow.test.ts` as a case asserting `verdict === "reject"`
with `recordCount === 2`.

## Warnings

### WR-01: `/quick` typed while an ordinary turn is streaming gates that turn instead, and leaves its own task ungated

**File:** `.pi/extensions/workflows/index.ts:39-41`

**Issue.** WR-01's fix guards `/quick` against a second `/quick`
(`isRunArmed()` at `:39`). It does not guard `/quick` against a turn that is
*already* in flight for any other reason — which in a TUI is the ordinary case,
because Pi queues a message typed mid-stream rather than rejecting it, and
`pi.sendUserMessage` is fire-and-forget with its own internal `.catch`
(`agent-session.js:1855-1862`), so the handler cannot tell that no turn of its own
started.

Executed. An ordinary `session.prompt()` was started and not awaited, then
`/quick`'s handler was called:

```
### PROBE H  (ordinary turn runs `bash echo ordinary`, makes no commit)
  armed right after /quick: true          ordinary prompt error: undefined
  evidence rows: [{"verdict":"reject","reason":"no commit was made during this run -- ...",
                   "recordCount":1,"tools":["bash"]}]
  notify: [{"text":"no commit was made ...","level":"error"}]
  still armed at end: false

### PROBE H2 (identical, except the ordinary turn runs `git commit --allow-empty -m "ordinary work"`)
  evidence rows: [{"verdict":"accept","reason":"evidence accepted at 63a92af8...",
                   "baseSha":"7159a579...","headSha":"63a92af8...","recordCount":1,"tools":["bash"]}]
  notify: [{"text":"quick: evidence accepted at 63a92af8...","level":"info"}]
```

In H2, `/quick` printed **`quick: evidence accepted`** for a commit made by a turn
the user never gated, computed over that turn's tool results — and `/quick`'s own
task then ran with the run already disarmed, i.e. entirely ungated. This is the
same failure shape WR-01 named ("a `/quick` that is silently never gated is the
failure this phase exists to prevent"), reached through a different door, and it
now produces a *false accept* rather than merely a missing verdict.

**Fix.** Guard on session idleness as well as on the run slot, in the same
condition so it costs one line:

```ts
			if (isRunArmed() || !ctx.isIdle()) return void ctx.ui.notify("quick: a turn is already in flight -- wait for it to finish", "error");
```

`ctx.isIdle()` is on `ExtensionContext` (CLAUDE.md's `ctx` surface table).
**Zero net lines** in `index.ts` (78/80 — it replaces the existing line 39).
Regression test: reproduce PROBE H2 — start an unawaited `session.prompt` whose
turn makes a commit, call `/quick`'s handler, assert the refusal fires and that
**no** evidence row is written.

### WR-02: a `git rev-parse HEAD` failure inside `agent_end` swallows the verdict and arms `/quick` forever

**File:** `.pi/extensions/workflows/index.ts:64-72`

**Issue.** `endRun(currentSha(armedCwd() ?? ctx.cwd))` evaluates the argument
first. `currentSha` throws by design on any non-zero exit
(`safety/git.ts:183-188`), and its own docstring states the contract:
`safety/git.ts:171` — *"callers must wrap it and refuse (fail closed)"*. This
caller wraps it and does **nothing**: the `catch` at `:69` swallows, `endRun` is
never reached, the run is never disarmed, and no verdict is ever produced.

Executed. The model committed and then made the repository unreadable (a
plausible real command — `rm -rf .git`, a `git checkout --orphan`, or a transient
`index.lock`), then claimed success:

```
### PROBE I  -- bash 'git commit --allow-empty -m "done" && rm -rf .git', then "done, committed and tests pass"
  evidence rows: []
  still armed after agent_end: true
  notify during run: []                     <-- the user is told NOTHING
  second /quick notify: [{"text":"quick: a run is already in flight -- wait for its verdict","level":"error"}]
```

Two consequences, both bad: a `/quick` run that completes with a completion claim
and **no verdict at all** (silent, ungated — worse than a reject), and a
permanently armed slot that refuses every later `/quick` for the life of the
process. WR-01's own fix is what converts the second into a hard denial of
service; iteration 1 flagged the risk and probed only the `stopReason: "error"`
path, which does disarm.

**Fix.** Read the SHA defensively and always disarm:

```ts
	pi.on("agent_end", (_event, ctx) => {
		if (!isRunArmed()) return;
		let sha = "";
		try { sha = currentSha(armedCwd() ?? ctx.cwd); } catch { /* unknown SHA -> gate rejects below */ }
		try {
			const verdict = endRun(sha);
			...
```

`gateCompletion("", baseSha)` falls through to the stale-SHA branch and rejects,
which is the fail-closed behaviour `currentSha`'s docstring asks for. **Cost: +3
raw lines** in `index.ts`, taking it to 81/80 — **over the FLOW-01 ceiling**. Two
ways out, both acceptable: (a) fold the whole thing into a new
`endRunAtHead(cwd): EvidenceVerdict | undefined` exported from `evidence.ts` and
call it in one line here (`index.ts` net **-1**; `evidence.ts` +8, ride the CR-01
budget bump), or (b) combine with WR-01's zero-net-line rewrite and write the
try/catch as a single-line IIFE. Do **not** raise the 80-line ceiling — it is the
one number in this phase that is explicitly not a knob
(`workflow-budgets.test.ts:193-201`).

Regression test: reproduce PROBE I and assert one reject row landed and
`isRunArmed()` is `false`.

### WR-03: the widened discovery finds the command file and misses the 1,200 lines next to it

**File:** `tests/unit/workflow-budgets.test.ts:135-162`, `:203-213`

**Issue.** WR-05's fix discovers any `.ts`/`.js` under `.pi/extensions/` that
spells `registerCommand(`. The *anti-offloading* control — the directory
aggregate at `:203-213` — is still scoped to `WORKFLOWS_DIR` only. So a Phase 9
command that lives outside `workflows/` gets a per-file budget and **no aggregate
at all**, which is precisely the "shrink the file a reviewer checks by moving the
lines next door" move D-11 exists to stop.

Executed. I planted a 3-line `.pi/extensions/grill/index.ts` spelling
`registerCommand(` and a 1,200-line `.pi/extensions/grill/steps.ts` beside it:

```
$ npx vitest run tests/unit/workflow-budgets.test.ts
  × present-but-undeclared: ... expected [ '.pi/extensions/grill/index.ts' ] to deeply equal []
      Tests  1 failed | 12 passed (13)
```

`offenders` names only `index.ts`. A Phase 9 author reads that message, adds
`{file: ".pi/extensions/grill/index.ts", budget: 10, why: "..."}` to the registry,
and ships 1,200 unbudgeted lines of workflow prose. The registry goes green.
(Files removed; `git status` clean.)

**Fix.** Make the aggregate follow the command, not the directory: for every
discovered command source outside `workflows/`, aggregate its whole containing
directory the same way `workflows/` is aggregated, with a per-directory declared
total. Test files carry no budget, so the cost is free:

```ts
const commandDirs = new Set(discovered.filter(isCommandSource).map((p) => p.slice(0, p.lastIndexOf("/"))));
// then, per dir: sum countRawLines over every .ts/.js beneath it, against a declared entry.
```

### WR-04: IN-02's ENOENT guard is placed after the call that throws, and now kills the whole registry file

**File:** `tests/unit/workflow-budgets.test.ts:149-161`

**Issue.** The `existsSync` filter added for IN-02 runs at `:160`, but
`isCommandSource(p)` at `:155` already did `readFileSync(join(repoRoot(), p))`.
A path that is in the git index but absent from disk therefore throws **before**
the guard. Worse than iteration 1: `discoverWorkflowFiles()` is called in the
`describe` body (`:165`, `:251`), so the throw happens at collection time and the
entire file reports **no tests** — the FLOW-11 registry, the `/quick` 80-line
ceiling and the completeness check all stop enforcing anything at once.

Executed (`git add -f` a file under `.pi/extensions/`, delete it from disk, run;
index restored afterwards, `git status` clean):

```
$ npx vitest run tests/unit/workflow-budgets.test.ts
Error: ENOENT: no such file or directory, open 'C:\...\.pi\extensions\zzprobe.ts'
      Tests  no tests
```

**Fix.** Filter for existence *before* any read, and make the predicate
non-throwing regardless:

```ts
	return Array.from(union)
		.filter((p) => existsSync(join(repoRoot(), p)))   // <-- FIRST
		.filter((p) => ... isCommandSource(p) ...)
		.sort();
```

plus a `try { ... } catch { return false; }` inside `isCommandSource`. Add a unit
case that calls `isCommandSource(".pi/extensions/does-not-exist.ts")` and asserts
`false` rather than a throw.

### WR-05: `docs/WORKFLOWS.md` now describes a `/quick` that no longer exists

**File:** `docs/WORKFLOWS.md:35-72`, `:120-132`

**Issue.** None of the seven fix commits (`4181be6..7aa8456`) touched `docs/`
(`git log 5f7c0ca..HEAD -- docs/` is empty), yet three of them changed the
command's observable behaviour. The document is now wrong in two load-bearing
places, and its own contract at `:8-11` says a disagreement with the code is a bug
in the document:

- `:37-38` — *"`/quick`'s handler runs five steps, in this exact order, and the
  order is the whole claim being tested"*, then lists five. The handler now runs
  **seven** checks: route → **session-model match (`index.ts:31`)** → branch policy
  → **run-in-flight (`index.ts:39`)** → arm → hand off → gate. The two new
  refusals — the ones a user will actually hit — are undocumented, so a user who
  sees `quick: session model is not the routed executor` has nowhere to look.
- `:129-132` — *"the completion verdict at `agent_end` is computed from those
  records and the SHA that is `HEAD` right now"*. Since `4181be6` it is computed
  from those records, the SHA that is HEAD, **and the SHA that was HEAD when the
  run was armed**. The single most important rule the gate now applies — HEAD must
  have moved — is absent, as is the fact (CR-01) that a pre-commit failure is
  discarded.

Section 4's title, "Evidence, not narration", currently reads as a stronger claim
than the code makes; see CR-01 item 2.

**Fix.** Update §2's step list to seven and name the two new refusal texts; add a
paragraph to §4 stating the `baseSha`/`headSha` rule and, explicitly, what the
gate does *not* prove. No line budget applies to `docs/`.

## Info

### IN-01: `agent_end` spawns a `git rev-parse HEAD` on every turn of every session

**File:** `.pi/extensions/workflows/index.ts:64-66`

The `tool_result` handler correctly checks `isRunArmed()` first (`:50`). The
`agent_end` handler does not: it evaluates `currentSha(armedCwd() ?? ctx.cwd)` —
a `spawnSync` — before `endRun` has a chance to return `undefined`, on every turn
of every session this extension is loaded into, armed or not. In a non-git cwd
that is a spawn plus a thrown-and-swallowed `Error` per turn. The one-line
`if (!isRunArmed()) return;` from WR-02's fix removes it; the two changes should
land together.

### IN-02: the budget registry's own header numbers no longer match the file

**File:** `tests/unit/workflow-budgets.test.ts:26-34`, `:87-92`

`:28-30` still says *"353 raw lines by this file's own `countRawLines`, measured
2026-08-14: 74 + 279"* — three revisions stale. `:88-91` says *"375 raw lines
(77 + 298, by `countRawLines`)"*, but `countRawLines` returns **78** for
`index.ts` (77 is `wc -l`; the two measures differ by the trailing newline), so
the real figure is **376**. The registry is the single authoritative source of
these numbers by D-8, which makes a wrong number in its own header worse here than
elsewhere. Fix both, and state the measure explicitly so the next reader does not
reach for `wc -l` and mis-budget a fix by one line.

### IN-03: the new `session_start` handler is the only one of the three with no `try`/`catch`

**File:** `.pi/extensions/workflows/index.ts:74-76`

Its two siblings in the same file both carry an explicit `try`/`catch` with a
comment saying a failure "must never break" the path
(`:59-61`, `:69-71`), and both other subsystems guard theirs — `safety/index.ts:832-838`
wraps `pruneAuditLogs` in `try`/`catch` with "Swallowed deliberately", and
diagnostics routes its handler through `safeHandler` (`diagnostics/index.ts:438`).
`pruneLogs` is documented never-throw (`jsonl.ts:495-512`, every unlink swallowed,
`readdirSync` guarded), so this is a consistency defect rather than a live bug —
but it is 2 lines and it removes the question. Budget: `index.ts` 78 → 80, which
conflicts with WR-02; land it only if WR-02's logic moves into `evidence.ts`.

### IN-04: `EvidenceRecord.command` is still built, redacted, truncated and never read

**File:** `.pi/extensions/workflows/evidence.ts:58-64`, `:88-89`

Unchanged from iteration 1's IN-01 and consciously deferred by the fixer. Noted
again only because CR-01's new branch gives it an obvious consumer at last: a
reject reason that says *"a tool result in this run failed: `bash npm test`"* is
materially more useful than one that says *"from bash"*, and the field is already
redacted for exactly that use.

### IN-05: WR-02's refusal names the problem but not the remedy

**File:** `.pi/extensions/workflows/index.ts:32`

`quick: session model is not the routed executor (deepseek/deepseek-chat)` tells a
user what is wrong and nothing about what to do. The remedy is a mode command
(`/cheap`, `/balanced`, `/max`), which is what makes the routed executor the
session model in the first place (`routing/index.ts:288`). Appending
`-- run /cheap, /balanced or /max first` is a string edit, zero net lines. Unlike
`/quick`'s other two refusals this text is a hand-written literal rather than a
reason returned by the real function, so nothing pins it; that is acceptable here
(no routing function produces this sentence) but worth knowing.

---

_Reviewed: 2026-08-15T00:20:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 2_
