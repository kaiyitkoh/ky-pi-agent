---
phase: 08-quality-gates-engineering-quality
reviewed: 2026-08-15T16:20:00Z
depth: deep
iteration: 2
files_reviewed: 23
files_reviewed_list:
  - .pi/extensions/diagnostics/quality-cost.ts
  - .pi/extensions/quality/calibration.ts
  - .pi/extensions/quality/gates.ts
  - .pi/extensions/quality/index.ts
  - .pi/extensions/quality/review-schema.ts
  - .pi/extensions/quality/reviewer.ts
  - .pi/extensions/workflows/index.ts
  - docs/QUALITY.md
  - docs/RUNBOOK.md
  - docs/WORKFLOWS.md
  - tests/fixtures/seeded-defects/index.ts
  - tests/helpers/qoder-loopback.ts
  - tests/helpers/win-quote.ts
  - tests/integration/qoder-delegate.test.ts
  - tests/integration/quality-gate-order.test.ts
  - tests/integration/quick-workflow.test.ts
  - tests/integration/reviewer-calibration.test.ts
  - tests/unit/quality-gates.test.ts
  - tests/unit/quality-production-exec.test.ts
  - tests/unit/quality-rules.test.ts
  - tests/unit/quality-schema.test.ts
  - tests/unit/reviewer-import-graph.test.ts
  - tests/unit/workflow-budgets.test.ts
findings:
  critical: 1
  warning: 6
  info: 5
  total: 12
status: issues_found
---

# Phase 8: Code Review Report — Iteration 2

**Reviewed:** 2026-08-15T16:20:00Z
**Depth:** deep (fix verification + fix-diff review)
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Iteration 1 raised 4 Critical and 7 Warning findings. **All 11 are genuinely
addressed** — I re-derived each one against the code rather than the fix
report, and did not find a single case of the fix report claiming more than
the code delivers. The two claims I pressed hardest both survived:

- **WR-03 (calibration integrity).** The recorded `3/6 = 0.50` is
  *reproducible by hand*: `KNOWN_SUBSET_ARGS`'s three findings each satisfy
  their expectation's tightened `mustMentionAny` needle
  (`"performs none"`, `"never calls isGuardedCommand"`,
  `"regardless of input"`) at BLOCKER severity with a matching
  `locationFile`, and the other three defect classes have no finding at all.
  The number agrees in every place it is stated — `calibration.test.ts:393`,
  `docs/QUALITY.md:217`, `docs/RUNBOOK.md:1436/1458/1466`,
  `08-10-SUMMARY.md`, `08-13-SUMMARY.md`. Iteration 1's exact exploit (a
  per-file symbol name-drop) now scores `0`, and it is pinned as a third
  control. Nothing was tuned toward a flattering number.
- **WR-06 (`refundQualityCost`).** Cannot go negative (`Math.max(0, …)` per
  field), cannot refund what was never charged (`readSlot() === undefined` →
  early return), and is not racy (no `await` between read and write in a
  single-threaded runtime).

**Fix-diff review found one new BLOCKER, and it is CR-01's own failure mode
wearing a new costume.** The CR-01 fix replaced `spawnSync("npx", args,
{shell:false})` with `spawnSync(localBin, args, {shell: process.platform ===
"win32"})`. On Windows, `shell:true` alongside an args array is *unescaped
concatenation into `cmd.exe`* — and `localBin` embeds `cwd`. I executed the
real `runTypecheckLeg(cwd, productionExec)` against a `cwd` whose path
contains a space and got `{status: "fail", findings: ["'…\\scratchpad\\space'
is not recognized as an internal or external command"]}`. This repository
already owns a solved-and-tested answer to exactly this hazard
(`tests/helpers/win-quote.ts#commandFor`, whose docstring names the DEP0190
concatenation problem verbatim); the fix did not use it, and Node's DEP0190
warning now prints on every run of this repository's own test suite.

I also verified, at source: full suite green (108 files / 1994 tests, matching
the fix report); `safety/` still imports nothing from `routing/`; `tsc`,
`chokepoint-lint`, `pinning` (six devDependencies, no new dep),
`tool-count-baseline` (one new tool) and `contributing-boundary` all pass;
RB-08-01/02/03 are OUTSTANDING in both the summary table
(`docs/RUNBOOK.md:1314-1316`) and their detail sections; no `it.skip`,
`retry:`, `.only`, raised `testTimeout` or `fileParallelism:false` appears
anywhere in the fix diff; and nothing in the fix diff can issue a provider
inference request or touch credentials (the nested `vitest run` the new
production-exec test spawns runs only the 12 static structural files).

Per-finding verification of iteration 1:

| ID | Verdict | Note |
|----|---------|------|
| CR-01 | **partially fixed** | `npx` is gone and unreachable; the replacement introduces CR2-01 (Windows path with a space → false `fail`) and WR2-01 (no ancestor `node_modules` walk → silent `unavailable` from a subdirectory) |
| CR-02 | **fixed** | No source path names `npx`; missing `.test.ts` targets degrade before a spawn (`index.ts:221-226`) with a paired test |
| CR-03 | **fixed** | 9 install sites cover all 11 `command.handler(…)` calls that reach `workflows/index.ts:42`; the 4 uncovered calls (lines 389, 453, 522, 1344) each provably return at the routing / git-block / model-mismatch / `isIdle` guard *before* line 42. See IN2-04 for the honest caveat the fixer already recorded |
| CR-04 | **fixed** (scope overclaimed) | `commandDirs` now contains `.pi/extensions/quality` and `.pi/extensions/safety`, both budgeted, and the `toBe(ceil(total/10)*10)` ratchet leaves 2 and 5 lines of headroom respectively — a single offloaded line turns it red. No assertion was loosened. See WR2-04 for the residual |
| WR-01 | **fixed** | Branch (3b), `review-schema.ts:393-403` |
| WR-02 | **fixed** | Branch (2b), `review-schema.ts:352-362`; the `"Missing"` fallback is gone |
| WR-03 | **fixed** | See summary. Residual in WR2-05 |
| WR-04 | **fixed** (new timing risk) | Now genuinely distinguishes reset-on-progress from a fixed deadline. See WR2-03 |
| WR-05 | **fixed** | `IMPORT_FROM_RE` widened; I traced the lazy-quantifier interaction and it produces no duplicate or shifted edges |
| WR-06 | **fixed** | See summary. Test-level float hazard in WR2-02 |
| WR-07 | **fixed** | Re-measured 22; `toBe(measured)` added so a drop also requires an edit |

## Narrative Findings (AI reviewer)

## Critical Issues

### CR2-01: the CR-01 fix reintroduces CR-01's failure mode on Windows — a `cwd` containing a space makes both gate legs report `fail` with `cmd.exe` noise, blocking every `/quick` invocation

**File:** `.pi/extensions/quality/index.ts:227-237` (with `localBin` at
`:195-198`, and `tests/unit/quality-production-exec.test.ts` which cannot see
it)

**Issue:** The replacement runner is

```ts
const bin = localBin(cwd, cmd);            // join(cwd, "node_modules", ".bin", `${name}.cmd`)
const result = spawnSync(bin, args, {
	shell: process.platform === "win32",   // <-- args array + shell:true
	…
});
if (result.error) throw result.error;
return { code: result.status ?? 1, … };
```

`spawnSync` with `shell: true` on Windows builds `cmd.exe /d /s /c "<command>
<args…>"` by **unescaped concatenation** — Node does not quote the command
or the arguments. `bin` is derived from `cwd`, which is `ctx.cwd`, whatever
directory the user launched Pi in.

**Executed against the real module** (`node --experimental-strip-types`,
importing `runTypecheckLeg` from `gates.ts` and `productionExec` from
`quality/index.ts`, with a `node_modules/.bin/tsc.cmd` genuinely present in
the target dir):

```
cwd = ...\scratchpad\space test
=> { "status": "fail",
     "findings": [
       "'C:\\...\\scratchpad\\space' is not recognized as an internal or external command,",
       "operable program or batch file." ] }
```

and with a `&` in the directory name, `cmd.exe` splits the command line and
attempts a **second, path-derived command**:

```
cwd = ...\scratchpad\amp&dir
=> findings: [ "'C:\\...\\scratchpad\\amp' is not recognized ...",
               "The system cannot find the path specified." ]
```

Note what happens inside `productionExec`: `result.error` is **`undefined`**
in this case (the spawn of `cmd.exe` itself succeeded), so the `throw` at
`:238` never fires, the runner returns `code: 1`, and `runTypecheckLeg`/
`runLintLeg` take the **`fail`** branch, not the `unavailable` branch.

Concrete failure scenario, Windows (the project's declared primary platform):
a user whose repository lives under `C:\Users\First Last\…`, `C:\Program
Files\…`, or any OneDrive-synced path (`C:\Users\x\OneDrive - Company\…`)
runs `/quick <anything>`. `gate.blocking` is `true`, `workflows/index.ts:54`
notifies `gate.report` as an error, and **no run is ever armed** — `/quick` is
permanently unusable for that user, and the "findings" it reports are
`cmd.exe` chatter about a path fragment, not anything about their code. The
secondary case (`&`, `^`, `|`, `(`, `)` in a directory name — all legal on
NTFS) is genuine shell-metacharacter interpretation of an attacker- or
user-influenced path, on a laptop CLAUDE.md states holds live static IAM admin
credentials.

This repository already contains the correct, tested answer and the fix did
not use it. `tests/helpers/win-quote.ts:6-14` states the rule verbatim:
*"`shell: true` alongside an args array is unescaped concatenation, which is
exactly what Node's DEP0190 deprecation warns about… The safe shape is to
quote every argument here, fold them into a single command string, and pass
an empty args array."* `commandFor(cmd, args, isWindows)` at `:71-80` already
implements it, and `tests/unit/helpers.test.ts` already tests it. Confirming
the violation is live: `DeprecationWarning: Passing args to a child process
with shell option true can lead to security vulnerabilities` now prints on
every `vitest run` of this repository.

`tests/unit/quality-production-exec.test.ts` cannot catch this: it only ever
uses `repoRoot()` (no space on this machine) and `makeTempRepo()` (an
`os.tmpdir()` path, no space on this machine). Both are
environment-dependent, so the file is green here and would be red on a
developer machine with a space in either path.

**Fix:** apply the repository's own convention. Move the quoter out of
`tests/helpers/` (production code must not import from `tests/`) — e.g. to
`.pi/lib/win-quote.ts` — and use it, and add the missing regression case:

```ts
// .pi/extensions/quality/index.ts
import { commandFor } from "../../lib/win-quote.ts";

const isWindows = process.platform === "win32";
const [file, spawnArgs] = commandFor(bin, [...args], isWindows);
const result = spawnSync(file, spawnArgs, {
	cwd,
	shell: isWindows,          // only ever with an EMPTY args array, per commandFor
	windowsHide: true,
	encoding: "utf-8",
});
```

```ts
// tests/unit/quality-production-exec.test.ts -- the case that is missing
it("CR2-01: a cwd whose path contains a space still runs the real binary -- never a cmd.exe-noise FAIL", () => {
	const repo = makeTempRepo("kypi cr2-01 spaced ");   // space in the fixture name
	mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
	writeFileSync(join(repo, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc"),
		process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	expect(runTypecheckLeg(repo, productionExec)).toEqual({ status: "pass" });
});
```

Also consider hardening `productionExec` so a `cmd.exe`-level failure cannot
masquerade as a compiler verdict: when `stderr` matches `is not recognized as
an internal or external command`, that is a spawn failure and must be an
honest `unavailable`, never a `fail`.

## Warnings

### WR2-01: `localBin` does not walk up to an ancestor `node_modules`, so running `/quick` from any subdirectory silently makes two of four legs `unavailable` — CR-01's original invisibility, in a narrower case

**File:** `.pi/extensions/quality/index.ts:195-198, 209-214`

**Issue:** `localBin` is exactly `join(cwd, "node_modules", ".bin", name)` —
one level, no ancestor search. `npx`, which it replaced, *did* walk ancestors
(`cwd/node_modules/.bin`, then each parent). `ctx.cwd` is wherever the user
launched Pi, which for a large multi-stack repository is frequently not the
package root.

Concrete failure scenario: a user opens Pi in `ky-pi-agent/docs` (or any
workspace package that has no `node_modules` of its own but whose parent
does) and runs `/quick`. `existsSync` fails, `productionExec` throws, both
legs report `unavailable`, `blocking` stays `false` by GATE-01's own
three-state contract, and the run is armed against a repository whose
typecheck and structural lint were never executed. That is precisely the
"control that silently does not run, and nobody downstream can tell" shape
CR-01 was raised about; the fix narrowed the blast radius from "always on
Windows" to "whenever `cwd` is not the package root" without closing it.

Nothing tests this: `quality-production-exec.test.ts` only ever passes
`repoRoot()` or a bare temp dir.

**Fix:** walk up, and record which root was resolved so the `unavailable`
reason is actionable:

```ts
function localBin(cwd: string, name: string): string | undefined {
	const suffix = process.platform === "win32" ? ".cmd" : "";
	let dir = resolve(cwd);
	for (;;) {
		const candidate = join(dir, "node_modules", ".bin", `${name}${suffix}`);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return undefined;   // reached the filesystem root
		dir = parent;
	}
}
```

and add a test that resolves from a subdirectory of `repoRoot()` and asserts
the leg is `pass`/`fail`, never `unavailable`.

---

### WR2-02: WR-06's session-level regression test asserts an exact float equality that only holds while `gate.totalMs < 5` — a slow gate stage turns it red with `122.99999999999999 !== 123`

**File:** `tests/integration/quality-gate-order.test.ts:640-643`

**Issue:** The test does `addQualityCost({ms: 123, tokens: 45})`, drives a
blocked `/quick` (which adds `gate.totalMs` and then refunds it), and asserts

```ts
expect(peekQualityCost()).toEqual({ qualityMs: 123, qualityTokens: 45 });
```

The ledger value is `(123 + t) - t` where `t = Number(hrtime.bigint() delta)
/ 1_000_000` — a full-precision double. That expression is **not** an
identity in IEEE-754. Measured on this machine:

```
t uniform in [0, 0.5] : mismatch  0.0%
t uniform in [0, 5]   : mismatch  0.0%
t uniform in [0, 20]  : mismatch 30.7%
t uniform in [0, 80]  : mismatch 33.4%
example: (123 + 33.123456789) - 33.123456789 === 122.99999999999999
```

The 0% band is an accident of magnitude: while `123 + t < 128` the sum keeps
the same binade as `123` and the round-trip cancels exactly. The moment
`gate.totalMs` exceeds `5`, roughly 40% of values break the assertion. With
`INSTANT_PASS_EXEC` installed the four legs are fast, so this is normally
sub-millisecond — but `totalMs` is measured with `hrtime` across the whole
leg loop and therefore includes any scheduler preemption or GC pause. One
5 ms hiccup on a loaded CI runner produces a bewildering
`122.99999999999999 !== 123` failure in a test about ledger accounting.

I ran this file 3× idle and 3× under 48 concurrent CPU hogs on a 24-core
machine without reproducing it, so this is a latent hazard rather than a
current failure — but it is a fixed-magnitude bet of exactly the kind 08-05's
de-flake work removed.

**Fix:** assert the property, not the bit pattern:

```ts
const after = peekQualityCost();
expect(after?.qualityTokens, "the prior contributor's tokens must survive untouched").toBe(45);
expect(after?.qualityMs ?? 0, "the prior contributor's 123ms must survive a blocked gate's refund").toBeCloseTo(123, 6);
```

The same reasoning applies to the production ledger: consider rounding
`totalMs` to a whole millisecond at `addQualityCost`/`refundQualityCost`, so a
refunded turn cannot report `qualityMs: 122.99999999999999` on disk.

---

### WR2-03: WR-04's rewrite cut the timing margin from 40× to 2× — it now genuinely proves reset-on-progress, but it does so with a fixed 300 ms budget against 150 ms sleeps, in the file 08-05 de-flaked

**File:** `tests/integration/qoder-delegate.test.ts:601-663` (with
`tests/helpers/qoder-loopback.ts:350-386`)

**Issue:** The mechanism change is right — four event-gated chunks whose gap
*sum* (450 ms) exceeds the budget while each individual gap stays under it is
the only shape that distinguishes reset-on-progress from a single fixed
deadline, and I agree the old 50 ms/2000 ms case proved nothing. But the new
case replaces a 40× safety margin with a 2× one: `injectedTimeoutMs = 300`,
`interChunkDelayMs = 150`. Any single gap where the loopback server's write,
the client's socket read, and the test's own `setTimeout(150)` together drift
past 300 ms rejects the whole `delegateTask` with *"the event stream produced
no bytes for 300ms"*.

`tests/helpers/qoder-loopback.ts`'s own docstring is the counter-authority:
*"No WIDER duration fixes this: any fixed number is a race against however
loaded the machine happens to be at that moment."* The fix commit's own
justification — *"150ms of headroom per gap against scheduler jitter"* — is
the reasoning that docstring rejects.

I could not break it: 3× clean and 1× under 32 concurrent CPU hogs on 24
cores all passed. The exposure is CI, where `macos-latest` runners have 3–4
cores and now share them with `tests/unit/quality-production-exec.test.ts`,
a new 13.6 s file that spawns two full `tsc --noEmit` runs and two nested
`vitest run` invocations in parallel with everything else.

**Fix:** take the review's own second suggestion and assert the property from
the transcript instead of from the clock — the client already knows how many
times it re-armed its deadline. Expose that count (or the `lastProgressAt`
update count) on the fold result and assert `deadlineRearmCount === 3`; it is
exact, instant, and cannot race. Failing that, inject the clock rather than
sleeping.

---

### WR2-04: `importedSubsystemDirs` closes the offloading hole at depth 1 only, while its own docstring and the untouched `docs/WORKFLOWS.md` claim it closes it generally — `.pi/lib/jsonl.ts` (605 lines) is a live, unbudgeted import target today

**File:** `tests/unit/workflow-budgets.test.ts:611-644, 673-675`; with
`docs/WORKFLOWS.md:146-157`

**Issue:** Three separate residuals, all in the same claim.

1. **Depth 1 only.** `importedSubsystemDirs(commandFiles)` scans only files
   that themselves spell `registerCommand(` — i.e. `workflows/index.ts`. A
   directory imported by `quality/` or `safety/` rather than by the command
   file is still invisible. The docstring at `:625-628` nevertheless claims
   *"A future subsystem reached only by import (Phase 9's `/grill`, `/plan`,
   `/execute`, `/review` delegating into sibling directories) is caught by
   this the same way `quality/` now is"*. It is caught only if the command
   file imports it directly. Concrete: Phase 9 adds
   `.pi/extensions/reviewers/`, imported by `quality/reviewer.ts` and never
   by a command source — unbudgeted, and FLOW-11 reports green.
2. **`.pi/extensions/` only.** The filter at `:637` is
   `rel.startsWith(".pi/extensions/")`, which *discards* every non-extension
   local import by construction. `.pi/lib/jsonl.ts` is **605 lines**, is
   imported by five subsystems including `workflows/evidence.ts:42`, and has
   no `DIRECTORY_BUDGETS` entry. It is a legitimate shared library today, and
   it is also a perfectly good place to hide 1,200 lines of `/quick` logic
   tomorrow, invisibly.
3. **`docs/WORKFLOWS.md` was never touched.** `git log a4f57c4..HEAD --
   docs/WORKFLOWS.md` is empty. The prose iteration 1 cited by line number is
   verbatim unchanged, including *"which is why the aggregate is the
   mechanism that actually holds the line, not a promise"* (`:155-157`) and
   the singular *"the directory aggregate"* (`:146`, `:159-160`) — there are
   now nine directory entries, not one. The fix report is honest here (it
   only claims the `why` in the test registry was corrected), but the
   iteration-1 finding named this file and it is still stating the old
   mechanism. `docs/QUALITY.md` declares the code authoritative on
   disagreement, which makes a stale doc a known-tolerated overclaim rather
   than a lie — but it is still an overclaim.

**Fix:** (a) make the scan transitive over local specifiers, seeded from the
command sources and iterated to a fixed point; (b) drop the
`.pi/extensions/` prefix filter in favour of "any repo-relative local
specifier", mapping a non-extension hit to its own directory
(`.pi/lib`) and adding a `DIRECTORY_BUDGETS` entry for it, grandfathered at
its measured total exactly as `safety/` was; (c) update
`docs/WORKFLOWS.md:146-160` to say "per file, and as a per-directory ratchet
over every directory a command source reaches by import", and to state the
residual (transitive depth, or lack of it) plainly.

---

### WR2-05: the tightened calibration needles resist iteration 1's exploit but not a boilerplate one — a single sentence containing every needle still scores 6/6, and `docs/QUALITY.md` now overstates what `findingCatches` enforces

**File:** `tests/fixtures/seeded-defects/index.ts:331, 345, 358, 372, 385,
401`; `.pi/extensions/quality/calibration.ts:125-135`;
`docs/QUALITY.md:236-239`

**Issue:** The fix is real: the needles now describe behaviour, iteration 1's
name-drop scores `0`, and it is pinned as `SHOTGUN_NAME_DROP_ARGS`. But
`mustMentionAny` is still an **OR over plain substrings**, and the OR set is
only as strong as its weakest member. Several members are generic enough to
be asserted about any file of that kind without analysis — `"cannot fail"`
(any test file), `"not wired in"`, `"performs none"`.

**The shape that still scores, with no defect identified:** one BLOCKER per
touched file, correct `location`, and this one boilerplate `concreteFailure`
reused verbatim for all six:

> `"This code cannot fail; it performs none of the verification it claims, writes into the real home directory, never calls isGuardedCommand, and always returns true regardless of input."`

Tracing `findingCatches` by hand: `fabricated-evidence` ← `"performs none"`;
`tautological-test` ← `"cannot fail"`; `escaped-side-effect` ←
`"writes into the real"`; `absent-guard` ←
`"never calls isGuardedCommand"`; `symptomatic-fix` ←
`"always returns true"`; `false-label` ← `"regardless of input"`. Six of six,
`catchRate === 1.0`, zero defects identified. Unlike iteration 1's exploit
this one is not derivable from the *input* (it requires the answer key), so
it is strictly weaker — which is why this is a Warning, not a repeat
Critical.

The doc, however, has been strengthened past what the code does.
`docs/QUALITY.md:236-239` now reads *"`findingCatches` therefore requires the
right file **and** a mention of the specific malformed *behaviour*, not
merely a high finding count and not merely the right identifier."* What it
requires is a substring match against one of three-to-four phrases. That
distinction matters for RB-08-03: the live number will be produced by this
same matcher, and the doc is the thing a reader will use to interpret it.

**Fix:** add the fourth control so the residual is measured rather than
argued, and soften the doc to what the code enforces:

```ts
/** WR2-05: the kitchen-sink shotgun -- one boilerplate sentence per file containing every needle. */
const SHOTGUN_KITCHEN_SINK_ARGS = { …, findings: SHOTGUN_LOCATION_FILES.map((file, i) => ({
	severity: "BLOCKER" as const, location: `${file}:${i + 1}`,
	concreteFailure: "This code cannot fail; it performs none of the verification it claims, writes into " +
		"the real home directory, never calls isGuardedCommand, and always returns true regardless of input.",
	suggestedFix: "Fix it." })), … };
// Record the number honestly, whatever it is -- if it is 1.0 today, that IS the residual,
// and it belongs in docs/QUALITY.md next to the 0.50, not in a comment.
```

Then either require *two* independent needles (`mustMentionAll` of a
two-element set), or require the needle to appear within N characters of the
`locationFile`'s own symbol, or state plainly in `docs/QUALITY.md` that the
matcher is a substring proxy for defect identification and that its ceiling
is what the kitchen-sink control measures.

---

### WR2-06: `productionExec` executes an arbitrary binary out of whatever directory `/quick` was invoked in, with no trust check

**File:** `.pi/extensions/quality/index.ts:208-240` (called from
`runQuickGateStage`, `workflows/index.ts:42`)

**Issue:** The gate stage now resolves and runs
`<ctx.cwd>/node_modules/.bin/tsc` (and `…/vitest`) unconditionally, at the
top of every `/quick`, before the user has agreed to anything. `ctx.cwd` is
whatever directory Pi was started in — which for this harness's stated
purpose includes freshly cloned third-party repositories. A repository that
ships a `node_modules/.bin/tsc.cmd` (committed, or installed from a
compromised package) gets arbitrary code execution with full user
permissions, on a machine CLAUDE.md states holds live static IAM admin
credentials for an account whose `main` auto-deploys.

This is not a *regression* — `npx tsc` preferred the same local binary — but
CR-01's fix made local-binary resolution the deliberate design, and the
project's own security posture ("review or vendor anything in the
tool-execution or credential path") argues for a gate here. Pi exposes
`ctx.isProjectTrusted()` (including temporary and CLI trust overrides) for
exactly this decision, and `runQuickGateStage` takes only a `cwd`, so the
trust answer never reaches it.

**Fix:** thread the trust decision through, and refuse honestly rather than
executing:

```ts
export function runQuickGateStage(cwd: string, projectTrusted: boolean): GateResult {
	return runDeterministicGates({
		…,
		exec: projectTrusted ? resolveExec() : () => {
			throw new Error("the project is not trusted -- the typecheck/lint legs will not execute a binary from this cwd");
		},
	});
}
// workflows/index.ts:42
const gate = runQuickGateStage(ctx.cwd, ctx.isProjectTrusted());
```

An untrusted project then reports `unavailable` with a reason that names
trust — honest, and unlike WR2-01 it is a state the user can act on.

## Info

### IN2-01: `evidence-gate.test.ts`'s M1 rationale describes behaviour the code no longer has *(carried forward from iteration 1, deliberately out of fix scope)*

**File:** `tests/unit/evidence-gate.test.ts:140`

**Issue:** Unchanged. The `why` still reads *"only records already at
headSha are considered for the isError check"*, while
`workflows/evidence.ts`'s branch (3) inspects every record at any SHA before
`headSha` is consulted. Row still passes, for the right reason; the recorded
rationale is the pre-fix behaviour.

**Fix:** reword to "a passing record from a different SHA cannot rescue a run
that contains any failing record — branch (3) inspects every record, at any
SHA, before headSha is consulted."

---

### IN2-02: `refute-or-promote.test.ts`'s bounded-loop assertion conflates provider calls with iterations *(carried forward from iteration 1, deliberately out of fix scope)*

**File:** `tests/integration/refute-or-promote.test.ts:406-416`

**Issue:** Unchanged. `expect(run.boundedCallDelta).toBeLessThanOrEqual(
MAX_REVIEW_ITERATIONS)` compares a provider-call count against an iteration
bound; the two coincide only because this fixture has exactly one BLOCKER per
iteration.

**Fix:** keep the `iterations <= MAX_REVIEW_ITERATIONS` assertion and
separately assert `boundedCallDelta === iterations * blockersPerIteration`.

---

### IN2-03: `quality/index.ts`'s drift guard cannot fire under TypeScript's own narrowing in the common case *(carried forward from iteration 1, deliberately out of fix scope)*

**File:** `.pi/extensions/quality/index.ts:280-285`

**Issue:** Unchanged. `if (CONSULT_ADVISOR_TOOL_NAME !== "consult_advisor")`
compares a literal-typed `const` against the same literal.

**Fix:** `const _nameMatchesRegistration: "consult_advisor" =
CONSULT_ADVISOR_TOOL_NAME;`, or drop it and rely on
`tool-count-baseline.test.ts`'s grep.

---

### IN2-04: CR-03's exec-seam fix has no failing signature — removing all nine installs leaves the suite green, and the review's stronger suggestion was not adopted

**File:** `tests/integration/quick-workflow.test.ts:105-113` (and the nine
install sites)

**Issue:** The fix report records this honestly: with CR-01/CR-02 landed,
stripping every override still leaves the suite green, because
`productionExec` now degrades fast in a `node_modules`-less temp dir. So the
nine installs are defense-in-depth with no test that would notice their
removal — exactly the "tautological fix" shape this phase exists to catch,
albeit a benign one. Iteration 1's stronger suggestion — have `resolveExec()`
throw when `process.env.VITEST` is set and no override has been installed, so
a *future* test that forgets is red rather than platform-dependent — was not
taken up, and the seam therefore remains unenforced for Phase 9's new tests.

**Fix:** adopt the enforcing seam:

```ts
function resolveExec(): ExecRunner {
	const override = (globalThis as Record<string, unknown>)[EXEC_OVERRIDE_KEY];
	if (typeof override === "function") return override as ExecRunner;
	if (process.env.VITEST !== undefined && process.env.KYPI_ALLOW_REAL_GATE_EXEC === undefined) {
		throw new Error("runQuickGateStage reached the production exec runner inside vitest without " +
			"setQuickGateExecOverrideForTests -- install the seam, or set KYPI_ALLOW_REAL_GATE_EXEC=1 " +
			"(quality-production-exec.test.ts is the only file that may)");
	}
	return productionExec;
}
```

---

### IN2-05: `firstChunkWritten` never resolves in `splitStreamAtMultiple` mode, contradicting its own "may always await it without hanging" contract

**File:** `tests/helpers/qoder-loopback.ts:132-140, 187, 415-419, 512-530`

**Issue:** `writeStreamBodyMultiSplit` resolves `chunkWrittenGates[i]`, but
`firstChunkWrittenGate` is only resolved on the two-chunk
`writeStreamBody` path (`:539`). `splitStreamAt`'s docstring gained *"Ignored
when `splitStreamAtMultiple` is also set"*, but `firstChunkWritten`'s own
docstring at `:132-140` still promises *"a caller may always await it without
hanging"*, and `:321` records that the design intent is for callers to await
it unconditionally rather than branching. A future test that sets
`splitStreamAtMultiple` and awaits `loop.firstChunkWritten` will hang until
the 120 s `testTimeout` with no useful message.

**Fix:** resolve it from the multi-split path too —
`onChunkWritten: (index) => { chunkWrittenGates[index]?.resolve(); if (index
=== 0) firstChunkWrittenGate.resolve(); }` — and note in the docstring that
in multi-split mode it is an alias for `chunkWritten[0]`.

---

_Reviewed: 2026-08-15T16:20:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
_Iteration: 2_
