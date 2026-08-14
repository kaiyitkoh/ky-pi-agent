---
phase: 06-walking-skeleton-quick-evidence-gate
reviewed: 2026-08-14T15:34:25Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - .pi/extensions/workflows/index.ts
  - .pi/extensions/workflows/evidence.ts
  - .pi/extensions/safety/git.ts
  - tests/unit/evidence-gate.test.ts
  - tests/unit/workflow-budgets.test.ts
  - tests/integration/quick-workflow.test.ts
  - tests/helpers/git.ts
  - docs/WORKFLOWS.md
findings:
  critical: 1
  warning: 6
  info: 3
  total: 10
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-08-14T15:34:25Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

The submitted suite is green on this machine, and several of the things this
phase was most likely to get wrong, it got right:

```
npx vitest run tests/unit/evidence-gate.test.ts tests/unit/workflow-budgets.test.ts
  Test Files  2 passed (2)   Tests  18 passed (18)
npx vitest run tests/integration/quick-workflow.test.ts
  Test Files  1 passed (1)   Tests  5 passed (5)
node -e "...split('\n').length"  ->  index.ts 74, evidence.ts 279   (budgets 80 / 280, aggregate 353/360)
```

Verified good, not merely asserted: no 40-hex literal appears in
`evidence-gate.test.ts` (SHAs come from a real `makeTempRepo`); cases 1 and 2
of `quick-workflow.test.ts` compute their expected refusal text by calling the
real `planRoleCall` / `classifyGitInvocation`, so the Phase 5 "retyped literal"
failure does not repeat; both refusal cases assert
`faux.state.callCount === 0`; nothing writes outside a temp dir; `currentSha`
uses fixed argv with `shell: false` and throws on both launch failure and
non-zero exit; `git checkout -b main` on an unborn `main` HEAD was executed
here and exits 0, so `gitInit(cwd, "main")` is not machine-dependent; and
`agent_end` was empirically confirmed to fire (and disarm the run) even when
the provider turn ends in `stopReason: "error"`.

The problem is what the gate accepts. I ran the real `/quick` command through
a real faux session with the real safety extension loaded, scripted the model
to make **no commit at all** and to claim in prose that it had, and the gate
returned **accept**:

```
PROBE A responses: bash "echo hi" (exit 0), then "all done, I made the commit and the tests pass"
PROBE A verdict: {"verdict":"accept","reason":"evidence accepted at 1772d27d...",
                  "baseSha":"1772d27d...","headSha":"1772d27d...","recordCount":1,"tools":["bash"]}
PROBE A commits before/after: 1 1

PROBE B responses: read "seed.txt", then "done"       (no bash at all, no commit)
PROBE B verdict: {"verdict":"accept","reason":"evidence accepted at df2d9b82...",
                  "baseSha":"df2d9b82...","headSha":"df2d9b82...","recordCount":1,"tools":["read"]}
```

`/quick` notified the user `quick: evidence accepted at <sha>` in both cases.
That is CR-01, and it is the finding that matters: the gate does not
distinguish "a command ran" from "the work happened", so it converts a false
completion claim into an affirmative endorsement. A second probe
(two `/quick` invocations back to back) showed the second run silently
ungated — WR-01.

Everything below was reproduced by execution, not inferred from the source
alone. The probe files were untracked, run, and deleted; `git status` is clean
and nothing in the repository was modified by this review.

## Critical Issues

### CR-01: the evidence gate accepts a run in which nothing was committed and nothing was verified

**File:** `.pi/extensions/workflows/evidence.ts:118-149` (`gateCompletion`), `.pi/extensions/workflows/evidence.ts:194-210` (`endRun`)

**Issue.** `gateCompletion` accepts as soon as **any** record satisfies
`sha === headSha && !isError`. Nothing constrains which tool produced it,
what it did, or whether HEAD moved during the run. Two consequences, both
executed against the real command in a real session (output above):

- **No commit at all → accept.** When the model makes no commit,
  `baseSha === headSha`, so *every* record captured during the run is "at
  HEAD" by construction. One `bash echo hi` — or one `read` of a file, which
  is not even a command — satisfies the gate. `/quick` then reports
  `quick: evidence accepted at <sha>` while `git rev-list --count HEAD` is
  unchanged (1 → 1) and the model's own message says "I made the commit and
  the tests pass".
- **After a commit, the accepting record is always the commit itself.** The
  `tool_result` handler stamps `currentSha(ctx.cwd)` *after* the tool ran, so
  any verification run before the commit is stale by construction (D-16 states
  this) and the only record left at HEAD is the `git commit` call's own
  success. The gate therefore cannot reject any run that ends in a successful
  tool call, which is the entire population of runs it is supposed to
  discriminate.

This is worse than an absent gate: an absent gate leaves the user sceptical,
whereas this one prints an endorsement. It directly contradicts GATE-07 as
stated in the task ("REJECTED unless a structured `tool_result` outcome ...
**supports it**"), FLOW-01's "prompt to atomic commit", and
`docs/WORKFLOWS.md:120-132`'s "Evidence, not narration".

Stated fairly, so the fixer can weigh it: the four-row predicate as
implemented does match `06-CONTEXT.md:103-110`'s own acceptance shape
("structured result, exit 0, SHA matches HEAD → accepted"). The defect is that
that shape does not satisfy the requirement it was written for, and the
walking skeleton demonstrably ships a user-visible false accept today.

**Fix.** The smallest change that closes both probes is a fifth branch keyed
on the base SHA the run already stores. `endRun` has `state.baseSha` in hand,
so no new plumbing and no change to `/quick` is needed:

```ts
export function gateCompletion(
	records: readonly EvidenceRecord[],
	headSha: string,
	baseSha: string,
): EvidenceVerdict {
	// ... branch (1) unchanged ...

	// (1b) HEAD never moved: no commit landed, so every record is trivially
	// "at HEAD" and no evidence in this run can support a completion claim.
	if (headSha === baseSha) {
		return {
			ok: false,
			reason:
				`no commit was made during this run -- HEAD is still ${headSha}, so the recorded tool ` +
				"results predate any work landing and cannot support a completion claim",
		};
	}
	// ... branches (2)-(4) unchanged ...
}
```

and in `endRun`: `gateCompletion(state.records, headSha, state.baseSha)`.

**Line cost, stated because both budgets are tight.** This is roughly +10 raw
lines in `evidence.ts` (279 → ~289) including the docstring branch-order
update that file's own header mandates. `WORKFLOW_BUDGETS`'s `evidence.ts`
entry must go 280 → 290 and `WORKFLOWS_DIR_TOTAL_BUDGET` 360 → 370 **in the
same commit**, with the `why` updated — which is exactly the ratchet procedure
`tests/unit/workflow-budgets.test.ts:26-38` documents. **Do not put this fix
in `.pi/extensions/workflows/index.ts`**: it is at 74 of 80 raw lines and
WR-01/WR-02 below already want three or four of those six.

Add the paired regression tests: a `gateCompletion` row where
`headSha === baseSha` with one passing record rejects, plus an integration
case scripting `bash echo hi` with no commit and asserting
`verdict === "reject"` and `commitCount` unchanged (that case is PROBE A
above; it can be lifted almost verbatim).

## Warnings

### WR-01: a second `/quick` while a turn is in flight silently steals the buffer and leaves its own run entirely ungated

**File:** `.pi/extensions/workflows/index.ts:40-41`, `.pi/extensions/workflows/evidence.ts:157-183`

**Issue.** The run state is a single `globalThis` slot with no run identity —
no session id, no turn id, no generation counter. `startRun` unconditionally
overwrites it. `pi.sendUserMessage` is fire-and-forget, so the command handler
returns while its turn is still running (confirmed: calling
`session.prompt()` immediately after the handler throws *"Agent is already
processing"*), and Pi queues a second `/quick` rather than rejecting it.

Executed: two `/quick` invocations back to back, first turn commits.

```
PROBE D second handler error: undefined      (no error -- the second /quick armed fine)
PROBE D rows: [ {"verdict":"accept","baseSha":"7548d0a6...","headSha":"f081548f...","recordCount":1,"tools":["bash"]} ]
PROBE D commits: 2
```

**One** evidence row for **two** runs. Run 1's verdict was computed over a
buffer that run 2's `startRun` had already reset, and run 2's own `agent_end`
found no armed run, so it returned `undefined` — no row, no notification, no
gate. A `/quick` that is silently never gated is the failure this phase exists
to prevent.

The same single-slot design means an in-process child session (`pi-subagents`
is on the Phase 7 install list and runs in this process) records its tool
results into whatever `/quick` run the parent happens to have armed.

**Fix.** Refuse a second arming in the command handler, before `startRun`:

```ts
if (isRunArmed()) {
	ctx.ui.notify("quick: a run is already in flight -- wait for its verdict", "error");
	return;
}
```

3 raw lines; `index.ts` goes 74 → 77, still inside the 80 ceiling. `isRunArmed`
is already imported. Caveat worth knowing: this makes a leaked armed run brick
`/quick` until the process restarts — I probed the obvious leak path (a turn
ending in `stopReason: "error"`) and `agent_end` **does** fire and disarm, so
the risk is small, but a `/quick` that also disarms on `session_shutdown`
would be strictly safer if the budget can afford it.

### WR-02: the routing pre-flight validates a model `/quick` never applies

**File:** `.pi/extensions/workflows/index.ts:26-30`

**Issue.** `planRoleCall(...)` returns `{model, reasoningEffort, mechanism}`
and `/quick` reads only `plan.ok`/`plan.reason`; `plan.model` is discarded.
The task then runs on `ctx.model` — whatever model the session currently has.
Nothing anywhere ties the two together: Pi's own `/model` picker sets the
session model without going through `.pi/extensions/routing/`, so a user who
switches models by hand gets a `/quick` that cheerfully approves the executor
route for model A and then executes the whole task on model B, which the
Phase 5 capability guard (`guardRoute`, `modes.ts:348`) never saw.
`docs/WORKFLOWS.md:40-42` describes step 1 as a pre-flight, so the code matches
the doc — but "routed by Phase 5" (FLOW-01) is then only true by convention.

`quick-workflow.test.ts` cannot detect this: the fixture registers exactly one
model, which is the candidate, so `ctx.model === plan.model` always.

**Fix.** Make the assumption enforced rather than assumed, in the handler:

```ts
if (ctx.model?.id !== plan.model.id || ctx.model?.provider !== plan.model.provider) {
	ctx.ui.notify(`quick: session model is not the routed executor (${plan.model.provider}/${plan.model.id})`, "error");
	return;
}
```

4 raw lines; combined with WR-01 that is `index.ts` 74 → 81, i.e. **one line
over budget** — so one of the two must be written more tersely (both
conditions can share a single `if`/notify pair) or the 80-line ceiling
consciously revisited. Add an integration case registering two models, with
the session on the non-routed one, asserting the refusal.

### WR-03: the SHA is read from `ctx.cwd`, not from the repository the run was armed against

**File:** `.pi/extensions/workflows/index.ts:56` and `:66`, `.pi/extensions/workflows/evidence.ts:159-163`

**Issue.** `startRun` stores `state.cwd` and it is used for exactly one thing —
choosing the log file in `endRun` (`evidence.ts:200`). Both SHA reads use
`ctx.cwd` from the *event* context instead. When those differ (a worktree-
isolated subagent, a session whose cwd is re-resolved), the gate compares a
SHA from repository B against a base SHA from repository A and writes the
verdict into A's log — a comparison across two repositories that can both
accept a claim it should reject and reject one it should accept. Stored state
that is deliberately not used at the two places it exists for is also a
maintenance trap.

**Fix.** Export the armed cwd from `evidence.ts` and use it at both call
sites, so the run is evaluated against the repository it was armed against:

```ts
/** The cwd the armed run was armed against, or undefined when no run is armed. */
export function armedCwd(): string | undefined {
	return runSlot()?.cwd;
}
```

`+4` raw lines in `evidence.ts` (fold into the CR-01 budget bump), and **zero
net lines** in `index.ts` — `currentSha(ctx.cwd)` becomes
`currentSha(armedCwd() ?? ctx.cwd)` on both lines 56 and 66.

### WR-04: `pruneEvidenceLogs` is dead code, and the evidence stream is the only log stream with no retention

**File:** `.pi/extensions/workflows/evidence.ts:271-278`

**Issue.** Verified by grep across the whole repo: `pruneEvidenceLogs` has no
caller and no test. Every other JSONL stream in this repository prunes at
`session_start` — `safety/index.ts:834` (`pruneAuditLogs`),
`diagnostics/index.ts:439` (`pruneLogs`) — and `.pi/lib/jsonl.ts:503` names
`session_start` as the intended call site. `/quick` registers no
`session_start` handler, so `.pi/logs/evidence-YYYY-MM-DD.jsonl` accumulates
one file per day forever; only same-day rotation is capped. The module
docstring at `evidence.ts:21-25` describes the function's ownership scoping as
if it were live, which reads as working retention to anyone auditing the log
directory.

**Fix.** Either wire it (`pi.on("session_start", (_e, ctx) => { pruneEvidenceLogs(ctx.cwd); })`,
3 lines in `index.ts` — but see the budget arithmetic in WR-02; this is the
weakest of the three claimants on those six lines), or delete the function and
its options interface and say plainly in the docstring that the evidence
stream is unpruned and why. Do not leave it exported-but-dead: the next reader
will assume it runs.

### WR-05: the line-budget registry can be dodged by a file extension or a directory name

**File:** `tests/unit/workflow-budgets.test.ts:101-113`

**Issue.** Two concrete escapes from the mechanism whose entire job is to
protect Phase 9 from `/grill`, `/plan`, `/execute` and `/review`:

1. **`.js` is not discovered.** The filter is `p.endsWith(".ts")`. Pi
   auto-discovers `extensions/` entries as **`.ts` *and* `.js`**
   (CLAUDE.md packaging section; `docs/extensions.md:115-120` as quoted in
   `tests/unit/extension-layout.test.ts:19-24`). A 1,200-line
   `.pi/extensions/workflows/grill.js` ships, loads, and is invisible to both
   the completeness check and the aggregate.
2. **Anything outside `.pi/extensions/workflows/` is out of scope entirely.**
   Nothing requires a workflow command to live under `workflows/`.
   `.pi/extensions/grill/index.ts` is an auto-discovered shape that
   `extension-layout.test.ts` is perfectly happy with and this registry never
   looks at. Phase 9 adding four commands as four sibling subsystem
   directories passes this file with the registry untouched — which is the
   exact outcome the file's own header (lines 1-8) says it exists to prevent.

The aggregate ratchet itself is sound and I found no false-failure risk in it:
`WORKFLOWS_DIR_TOTAL_BUDGET` (360) is exactly `80 + 280`, so any new file's
lines push the total over unless the existing two shrink, which is the
anti-offloading property as advertised.

**Fix.** Discover by *what a file is*, not by where it sits. Test files carry
no budget, so the cost is free:

```ts
const COMMAND_MARKER = "registerCommand(";
// ...in discoverWorkflowFiles(), add:
const extensionSources = [...trackedFiles(".pi/extensions"), ...walkOnDisk(".pi/extensions")]
	.filter((p) => /\.(ts|js)$/.test(p))
	.filter((p) => readFileSync(join(repoRoot(), p), "utf-8").includes(COMMAND_MARKER));
```

union that into the discovered set, and widen the `workflows/` filter to
`/\.(ts|js)$/`. Note that this will pull `.pi/extensions/routing/index.ts` and
any other command-registering entry point into the registry — that is the
correct outcome (they are command surfaces with no budget today), but it means
adding their current counts as declared entries in the same commit.

### WR-06: the run-state machinery, the record builder and the row writer have no tests at all

**File:** `tests/unit/evidence-gate.test.ts` (whole file), `.pi/extensions/workflows/evidence.ts:81-97`, `:171-210`, `:239-255`

**Issue.** The unit file covers `gateCompletion` and `currentSha` and nothing
else. `recordFromToolResult`, `startRun`, `recordToolResult`, `isRunArmed`,
`endRun`, `writeEvidenceRow` and `pruneEvidenceLogs` are exercised only
incidentally through `quick-workflow.test.ts`, which asserts on the JSONL row
and never on these functions' contracts. In particular two documented
*security* claims are entirely unasserted, in a public repository:

- `evidence.ts:76-79` — "Nothing else from `toolInput` is copied, so a file
  body read by the `write` tool can never reach the record." A future edit to
  `{...input.toolInput}` would pass every test in this phase.
- `evidence.ts:89` — the `redactString(...).slice(0, 200)` redaction. No test
  feeds a secret-shaped command through it.

Related, and the same class: `tests/unit/logs-gitignored.test.ts` was extended
in Phase 4 for the then-new `audit-*` stream, with a comment
(lines 55-58) explaining that a literal table "does not notice a stream nobody
typed in". Phase 6 added the `evidence-*` stream and did not extend either
half of that file. The blanket `.pi/logs/` rule covers it today, so this is
belt-and-braces, not an exposure.

**Fix.** Add to `tests/unit/evidence-gate.test.ts` (no budget applies):
a `recordFromToolResult` case with
`{path: "x.ts", content: "AKIA...secret body..."}` asserting `command === "x.ts"`
and that no substring of `content` appears anywhere in the record; a
redaction case; a run-state case asserting `isRunArmed()` is false before
`startRun`, that `recordToolResult` before `startRun` is a no-op, that
`endRun` returns `undefined` when unarmed, and that a second `startRun`
discards the first buffer (the WR-01 behaviour, pinned either way). Add
`.pi/logs/evidence-2026-08-14.jsonl` and a `writeEvidenceRow` call to
`logs-gitignored.test.ts`'s two halves.

## Info

### IN-01: `EvidenceRecord.command` is built, redacted, truncated — and never read

**File:** `.pi/extensions/workflows/evidence.ts:58-64`, `:88-89`

`gateCompletion` reads `sha`, `isError` and `toolName`; `writeEvidenceRow`
builds its row field by field and never touches `command`. Nothing else
consumes an `EvidenceRecord`. So every `/quick` tool result pays a
`redactString` pass to populate a field that is only ever held in a
`globalThis` slot until `endRun`. Either give it a consumer (it would make the
reject reasons materially more useful — "the failing tool was `bash npm test`"
beats "the failing tool was `bash`") or drop the field and its docstring.

### IN-02: a tracked-but-deleted workflow file makes the budget test throw ENOENT instead of reporting

**File:** `tests/unit/workflow-budgets.test.ts:71-73`, `:154-164`

`discoverWorkflowFiles()` unions the git index with the working tree, so a
file that is still in the index but deleted on disk (`git rm --cached`, or a
delete not yet staged) is discovered, and `countRawLines` then throws a raw
`ENOENT` from inside the aggregate test — a stack trace instead of the
carefully written registry message. Filter the discovered list through
`existsSync(join(repoRoot(), p))` before summing, or catch and re-throw with
the path and the remedy.

### IN-03: no test asserts that HEAD actually moved during an accepted run

**File:** `tests/integration/quick-workflow.test.ts:594-618`

Case 4 asserts `row.headSha` equals a `git rev-parse HEAD` the test reads
itself, and separately that the commit count went up by one — but never that
`row.baseSha !== row.headSha`. That one line is the cheapest possible
statement of "the SHA compared at claim time is not the one captured at arm
time", and asserting it in case 4 plus its negation in a no-commit case is
precisely what would have surfaced CR-01 during authoring. Add it alongside
the CR-01 regression test.

---

_Reviewed: 2026-08-14T15:34:25Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
