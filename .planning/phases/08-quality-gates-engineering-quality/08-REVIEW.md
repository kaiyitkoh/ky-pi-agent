---
phase: 08-quality-gates-engineering-quality
reviewed: 2026-08-15T17:30:00Z
depth: deep
iteration: 3
files_reviewed: 15
files_reviewed_list:
  - .pi/lib/win-quote.ts
  - .pi/extensions/qoder/client.ts
  - .pi/extensions/quality/calibration.ts
  - .pi/extensions/quality/gates.ts
  - .pi/extensions/quality/index.ts
  - .pi/extensions/workflows/index.ts
  - docs/QUALITY.md
  - docs/WORKFLOWS.md
  - tests/fixtures/seeded-defects/index.ts
  - tests/helpers/win-quote.ts
  - tests/integration/qoder-delegate.test.ts
  - tests/integration/quality-gate-order.test.ts
  - tests/integration/reviewer-calibration.test.ts
  - tests/unit/quality-production-exec.test.ts
  - tests/unit/workflow-budgets.test.ts
findings:
  critical: 0
  warning: 6
  info: 6
  total: 12
status: issues_found
---

# Phase 8: Code Review Report — Iteration 3 (final)

**Reviewed:** 2026-08-15T17:30:00Z
**Depth:** deep (fix verification by execution + mutation, plus fix-diff review)
**Files Reviewed:** 15
**Status:** issues_found — **no BLOCKER. Recommend landing after two one-line
doc/comment corrections (WR3-01a, WR3-06); everything else is
accept-and-document.**

## Summary

**No Critical findings this iteration.** I could not construct a case where
the code shipped at `dc4cc16` produces incorrect behaviour on a realistic
input, leaks credentials, or issues a provider request. The full suite is
genuinely green (108 files / 2013 tests, run here, matching the fix report),
`tsc` is clean, `package.json`/`package-lock.json` are untouched across the
whole fix range (six devDependencies, one runtime dep `unbash@4.0.10`),
`.pi/extensions/safety/` still imports nothing from `routing/`,
RB-08-01/02/03 are OUTSTANDING in both the summary table
(`docs/RUNBOOK.md:1314-1316`) and their detail sections, and no `it.skip`,
`.only`, `retry:`, raised `testTimeout` or `fileParallelism:false` appears
anywhere in `ac0e427..dc4cc16`.

**I did not take the fix report's word for anything.** Every verdict below
came from executing the real module, or from mutating a throwaway `git
worktree` (created in the scratchpad, `node_modules` junctioned, removed
afterwards — the reviewed tree was never modified; `git status` is clean).

### Per-finding verification of iteration 2

| ID | Verdict | Evidence |
|----|---------|----------|
| CR2-01 | **fixed** | Executed the real `runTypecheckLeg(cwd, productionExec)` against seven fixture cwds with a genuine `tsc.cmd` stub installed: `plain`, `space test`, `amp&dir`, `paren(dir)`, `caret^dir` all `pass`; a spaced cwd with a stub exiting 2 gives an honest `fail` carrying the stub's own output. Mutation-verified for real: replacing `commandFor(bin, [...args], isWindows)` with the raw `[bin, args]` pair turns all three CR2-01 regression cases red. No stale duplicate — `tests/helpers/win-quote.ts` is a 14-line re-export, `quoteForWindows` exists in exactly one place, and all six prior importers still resolve. Zero `DEP0190` output. **One residual, WR3-04: a `%VAR%` pair in the cwd.** |
| WR2-01 | **fixed** | `localBin` (`quality/index.ts:206-216`) is a genuine ancestor walk terminating at `dirname(dir) === dir`, returning `undefined` (never a still-missing path). Proved live from `repoRoot()/docs`. |
| WR2-02 | **fixed** | `toEqual({qualityMs: 123, …})` is gone; `toBe(45)` on the integer field and `toBeCloseTo(123, 6)` on the float. `after?.qualityMs ?? 0` fails closed if the slot is missing, and `after?.qualityTokens` catches `undefined`. |
| WR2-03 | **partially fixed** | The mechanism is right and I confirmed it red under the stated mutation. But the *new production surface* it added is unpinned: see **WR3-03**, where two mutations together leave the test green and vacuous. |
| WR2-04 | **fixed** | `importedSubsystemDirs` (`workflow-budgets.test.ts:706-735`) is a genuine BFS fixed point with a `visitedFiles` cycle guard, and the `.pi/extensions/`-only filter is gone. The budget numbers are **measured, not padding** — `workflow-budgets.test.ts:802` asserts `budget === Math.ceil(total/10)*10` for *every* `DIRECTORY_BUDGETS` entry including the two new ones, so a padded number is a red test. Doc residual in **WR3-06**. |
| WR2-05 | **partially fixed** | It defeats the exact string it was built against and nothing more. See **WR3-01** — I scored a two-needle boilerplate at `catchRate: 1.0` against the real scorer — and **WR3-02**, the fixture edit that held 0.50 constant. |
| WR2-06 | **fixed** | `resolveExec(cwd, projectTrusted)` (`quality/index.ts:320-333`) uses `if (!projectTrusted)`, so **absent/undefined/falsy fails closed**. `isProjectTrusted(): boolean` is synchronous on `ExtensionContext` (`types.d.ts:234`, inherited by `ExtensionCommandContext:254`) — verified at source, because a `Promise` return here would have been truthy and failed *open*. Test-name overclaim in **WR3-05**. |

### Invariants re-verified

`callModel()` chokepoint (no new exemption), one new tool (`consult_advisor`),
six devDependency pins, nested-role budgets vs MAIN-LOOP gating, and all of
08-05's de-flake prohibitions: all hold. Nothing in the fix diff can issue a
provider inference request or touch credentials — the qoder tests are
`127.0.0.1` loopback only, and the nested `vitest run` the production-exec
tests spawn is restricted to the 12 static `LINT_GATE_FILES`.

## Narrative Findings (AI reviewer)

## Warnings

### WR3-01: `MIN_DISTINCT_NEEDLES = 2` does not close the boilerplate exploit — a two-needle sentence still scores `catchRate: 1.0` with zero defects identified, and `docs/QUALITY.md` now states a "measured CEILING" that this falsifies

**File:** `.pi/extensions/quality/calibration.ts:138, 151-162`;
`docs/QUALITY.md:250-252`; `tests/integration/reviewer-calibration.test.ts:324-341`

**Issue.** The fix reasons that "a second, INDEPENDENT needle is not free to
include without genuinely describing a second aspect of the defect"
(`calibration.ts:129-132`). That premise is false for this corpus: within
each class the needles are near-synonyms, not independent facts —
`"cannot fail"` / `"structurally cannot"`, `"performs none"` / `"no actual
verification"`, `"always returns true"` / `"unconditionally true"`,
`"writes into the real"` / `"escapes the test"`. Adding the second is a
clause, not an analysis.

Executed against the real `scoreCalibration` and the real `SEEDED_DEFECTS`
(one BLOCKER per touched file, correct `location`, one boilerplate
`concreteFailure` reused verbatim for all six):

```
"This code structurally cannot be trusted and cannot fail; it performs none of the verification it
 claims and offers no actual verification; it writes into the real home directory and escapes the
 test sandbox; it never calls isGuardedCommand and is simply not wired in; it always returns true,
 unconditionally true; and it does the same regardless of input, so the label survived its own
 mutation."

=> { caught: 6, total: 6, catchRate: 1, unmatchedFindings: 0 }
   (the shipped SHOTGUN_KITCHEN_SINK control, for comparison: catchRate 0)
```

The shipped fourth control is pinned to precisely the one construction the
fix defeats, which makes it a regression test for the fix rather than a
measurement of the exploit class. Like iteration 2's version this needs the
answer key, so it is a Warning and not a repeat Critical.

What must change regardless is the doc. `docs/QUALITY.md:250-252` now reads
*"the kitchen-sink control's own `catchRate: 0` is the measured CEILING of
what a substring proxy can be defeated by, not a claim that no cleverer
construction exists."* The first clause is a claim about a maximum and it is
false — the trailing hedge does not rescue the word CEILING. This is a
one-line, provably-wrong sentence in the document a reader will use to
interpret RB-08-03's live number.

**Fix (a) — do before landing, one line.** Replace "the measured CEILING of
what a substring proxy can be defeated by" with the honest statement: *"one
measured data point, not a ceiling: extending the same boilerplate to two
phrases per class scores `catchRate: 1.0` against the current matcher."*

**Fix (b) — accept and document, or do in Phase 9.** Either add the
two-needle sentence above as a fifth permanent control and record its `1.0`
next to the `0.50`, or stop trying to out-run the exploit with substrings
and require proximity (the needle within N characters of the
`locationFile`'s own symbol) — the OR/AND-of-substrings axis is exhausted.

---

### WR3-02: the "UNCHANGED, still 3/6 = 0.50" claim is unchanged *by construction* — the positive control's text was edited in the same commit that raised the bar, and nothing in the code or docs records it

**File:** `tests/integration/reviewer-calibration.test.ts:205-215` (commit
`bb2a67c`); `docs/QUALITY.md:217`

**Issue.** I re-derived 3/6 by hand and it is correct *today*. But it is
correct because `bb2a67c` changed `KNOWN_SUBSET_ARGS`'s `false-label`
finding from

```
"Comment claims MUTATION-VERIFIED but parseCommand always returns true regardless of input."
```

to that plus `", meaning the label survived its own mutation."` — a phrase
lifted from the corpus's own `mustMentionAny` answer key
(`seeded-defects/index.ts:401`), in the same commit that made two needles
mandatory.

Scored the pre-edit text against **today's** matcher:

```
KNOWN_SUBSET as of ac0e427, scored by today's calibration.ts:
  2/6 = 0.333…   { fabricated-evidence: true, absent-guard: true, false-label: FALSE }
```

So the honest statement is "the bar was raised and the positive fixture was
moved with it, holding the reported number at 0.50", not "the number is
UNCHANGED … not tuned toward a flattering figure" (`08-REVIEW-FIX.md:61`).
Both edits may be individually defensible — a fixture defined as "catches
exactly 3 of 6" must keep clearing whatever bar the matcher sets — but the
*combination*, undisclosed, is exactly how a calibration number stops being
a measurement. `docs/QUALITY.md:217` still presents 0.5 as an end-to-end
pipeline measurement with no note that the input was adjusted to preserve it.

I would **not block landing on this** — the number is disclosed everywhere
as scripted, and RB-08-03 is OUTSTANDING. But it must be recorded, not
dropped.

**Fix.** One sentence in `docs/QUALITY.md` beside the 0.5, and one in the
`KNOWN_SUBSET_ARGS` docstring: *"When `MIN_DISTINCT_NEEDLES` rose from 1 to 2
(WR2-05), this fixture's `false-label` finding was extended in the same
commit so the scripted reviewer still clears its own definition; the pre-edit
text scores 2/6 under the current matcher. 0.50 is therefore a property of
this fixture, not a stable measurement across matcher changes."*

---

### WR3-03: `DelegateTaskOptions.now` is production surface added for one test, with **zero** assertions pinning it — deleting its only use leaves all 20 tests green, and together with a non-resetting deadline makes WR-04 pass vacuously

**File:** `.pi/extensions/qoder/client.ts:556-563, 743, 748`;
`tests/integration/qoder-delegate.test.ts:600-696`

**Issue.** Two mutations, both run in a throwaway worktree against the real
suite:

| Mutation | WR-04 case | Whole file |
|---|---|---|
| remove `lastProgressAt = now()` (the reset) | **RED** — real "no bytes for 300ms" error at the third gap | 1 failed |
| `const now = Date.now;` (injected clock ignored, reset intact) | green | **20 passed** |
| **both together** | **GREEN** | **20 passed** |

The first row is the fixer's claim and it holds — good. The second row is
the problem: `opts.now` has no test that notices its removal. The third row
is the consequence — with the seam gone, real elapsed time across four
loopback chunks is a few milliseconds against a 300 ms budget, so a client
that never resets its deadline passes too. The test's only guard,
`progressCount === 4`, pins `onProgress` and says nothing about `now`.

This matters more than usual here. `now`/`onProgress` are the phase's one
clear instance of production surface added to satisfy a test, and the
obvious future cleanup ("delete the unused test-only clock from the
production client") is precisely the edit that silently converts this test
from a real proof into a tautology — with the test name still claiming
*"proved with an INJECTED CLOCK"*. That is the Phase 7 `MUTATION-VERIFIED`
shape, one edit away.

I confirmed the seam is not reachable from production or model input:
`qoder/index.ts:241` constructs `DelegateTaskOptions` field-by-field with no
spread of tool parameters, so neither `now` nor `onProgress` can be supplied
by a model or a config file. No security exposure.

**Fix.** One line in the test, which makes the seam self-defending:

```ts
let nowCalls = 0;
const now = (): number => { nowCalls += 1; return fakeElapsedMs; };
…
expect(nowCalls, "delegateTask never consulted the injected clock -- this case's whole proof " +
    "rests on the deadline arithmetic reading opts.now, so a green run without it proves nothing")
    .toBeGreaterThan(0);
```

**Secondary, lower confidence, not reproduced:** `progressCount === 4`
assumes a 1:1 mapping between server `res.write()` calls and client
`reader.read()` returns. Chunks 1-3 cannot coalesce (each is released from
inside the previous read), but a transport-level split of chunk 0 would give
5 and turn the case red. I ran the file 5× green and could not provoke it;
recording it only because this is the file 08-05 de-flaked.

---

### WR3-04: a `%VAR%` pair in the cwd still corrupts the `cmd.exe` command line — CR2-01's failure mode via a different message — and the belt-and-braces guard built for exactly this both misses it and is itself entirely untested

**File:** `.pi/extensions/quality/index.ts:232, 286-292`; `.pi/lib/win-quote.ts:57-62`

**Issue.** `quoteForWindows` wraps in double quotes, but `cmd.exe` expands
`%VAR%` **before** quote processing — double quotes do not suppress it.
Executed against the real `runTypecheckLeg(cwd, productionExec)` with a
genuine stub installed:

```
cwd = ...\scratchpad\it3\pct%PATH%dir
  status 1, stderr "The filename, directory name, or volume label syntax is incorrect."
  => runTypecheckLeg returns { status: "fail", findings: ["The filename, directory name, ..."] }

cwd = ...\scratchpad\it3\pct%OS%dir
  status 1, stderr "The system cannot find the path specified."
  => same: FAIL, carrying cmd.exe chatter as a compiler finding
```

That is CR2-01's exact shape: `gate.blocking === true`, `/quick` refuses,
and the "findings" are `cmd.exe` noise about a path fragment. It needs a
`%`-delimited pair naming a *defined* environment variable in the project
path (`D:\work\%CLIENT%\app`), so it is rare — `50% off` is harmless — which
is why this is a Warning, not a repeat Critical. WR2-06's trust gate also
now sits in front of the malicious-clone variant, so I do **not** treat this
as a security finding.

The sharper half is the guard. `CMD_EXE_SPAWN_FAILURE`
(`quality/index.ts:232`) is a single-message allowlist matching only
`/is not recognized as an internal or external command/i`; neither message
above matches, so the hardening the fix report presents as closing the
residual **provably does not fire on a live instance of the thing it was
built for**. And it has no test at all: I deleted the entire
`if (result.status !== 0 && CMD_EXE_SPAWN_FAILURE.test(...))` block in a
worktree and `quality-production-exec.test.ts`,
`quality-gate-order.test.ts` and `quality-gates.test.ts` stayed green —
46/46. It is dead code with a docstring.

**Fix — pick one, both are small.**

*Preferred (removes the shell entirely, matching `safety/git.ts`'s
discipline):* stop launching the `.cmd` shim. Resolve the JS entry point and
spawn `process.execPath` with `shell: false`, at which point no `cmd.exe`
parsing — quoting, metacharacters or `%` expansion — can touch the command
line at all.

*Minimal:* refuse honestly rather than mis-reporting, and give the guard a test:

```ts
if (isWindows && bin.includes("%")) {
    throw new Error(`${cmd} resolved to ${bin}, whose path contains '%' -- cmd.exe expands %VAR% ` +
        "inside quotes, so this command line cannot be built safely; the leg is unavailable, not failed");
}
```

plus a `%OS%`-named fixture asserting `status: "unavailable"` (never `fail`),
which would also be the first test that exercises the `CMD_EXE_SPAWN_FAILURE`
path at all.

---

### WR3-05: WR2-06's "paired positive" test says "with the SAME repo" and uses a different repo — the trust flip is never demonstrated on the fixture the negative control used

**File:** `tests/unit/quality-production-exec.test.ts:215-247`

**Issue.** The negative control (`:215`) uses
`makeTempRepo("kypi-wr2-06-untrusted-")` with a stub `tsc` installed and
`projectTrusted: false`. The test named *"runQuickGateStage(repoRoot(), true)
**with the SAME repo**"* (`:242`) uses `repoRoot()` — a different fixture,
with a different binary, in a different trust situation. The label states a
pairing the code does not implement, in the phase whose subject is labels
that state properties the code does not have.

It is also redundant: `:87-91` already asserts exactly the same two
expectations against `repoRoot()` with `projectTrusted: true`, so `:242-247`
adds a third full `tsc --noEmit` and a third nested `vitest run` over 12
files for no new information. And because the two halves use different
fixtures, the pair does not isolate trust as the *only* varying input —
which is what a paired positive is for.

**Fix.** Make it genuinely paired, on the same fixture, and drop the
duplicate:

```ts
it("the SAME untrusted temp repo, trusted -- the typecheck leg genuinely runs the stub (the gate flips on trust alone)", () => {
    setQuickGateExecOverrideForTests(undefined);
    const repo = makeTempRepo("kypi-wr2-06-trusted-");
    stubTsc(repo, { exitCode: 0 });
    expect(runQuickGateStage(repo, true).legs.typecheck).toEqual({ status: "pass" });
});
```

Not a blocker — the negative control's `stringContaining("is not trusted")`
assertion already makes it impossible for the `unavailable` to come from
anywhere else.

---

### WR3-06: `docs/WORKFLOWS.md`'s rewritten paragraph says "nine" ratchets, lists eleven, and the registry holds twelve — inside the paragraph that then forbids restating numbers

**File:** `docs/WORKFLOWS.md:148-158` (introduced by `e52bd3c`);
`tests/unit/workflow-budgets.test.ts:232-449`

**Issue.** The WR2-04 doc fix wrote *"There is now ONE ratchet per directory
reached this way (nine as of this writing — `workflows`, `routing`,
`harness`, `diagnostics`, `checkpoint`, `loop-police`, `plan-mode`,
`safety`, `quality`, `providers` and `.pi/lib`, …)"*. That list has **eleven**
names, not nine, and `DIRECTORY_BUDGETS` has **twelve** entries (the twelfth
is `.pi/extensions/todo.ts`, deliberate and honestly documented at
`:435-448`). The very next paragraph then says *"The numbers themselves are
not restated here … would create a second copy that could silently drift
from the one the build actually enforces."* The copy drifted in the same
commit that wrote the rule.

`docs/QUALITY.md` declares the code authoritative on disagreement, so this is
a documentation defect, not a behaviour one — but a wrong count in the
paragraph correcting a previous overclaim is worth the ten seconds.

**Fix.** Delete the parenthetical count and the enumeration entirely; the
next paragraph already says to read the registry. If a count is wanted, say
"one per directory (see `DIRECTORY_BUDGETS`)".

## Info

### IN3-01: `evidence-gate.test.ts`'s M1 rationale describes behaviour the code no longer has *(carried forward, iterations 1-2, still open)*

**File:** `tests/unit/evidence-gate.test.ts:140` — verified unchanged. The
`why` still reads *"only records already at headSha are considered for the
isError check"*, while `workflows/evidence.ts`'s branch (3) inspects every
record at any SHA first. Row passes for the right reason; the recorded
rationale is pre-fix behaviour.

**Fix:** reword to "a passing record from a different SHA cannot rescue a run
that contains any failing record — branch (3) inspects every record, at any
SHA, before headSha is consulted."

---

### IN3-02: `refute-or-promote.test.ts`'s bounded-loop assertion conflates provider calls with iterations *(carried forward, iterations 1-2, still open)*

**File:** `tests/integration/refute-or-promote.test.ts:406-416` — verified
unchanged. `boundedCallDelta <= MAX_REVIEW_ITERATIONS` compares a
provider-call count against an iteration bound; they coincide only because
this fixture has exactly one BLOCKER per iteration.

**Fix:** keep the iteration bound and separately assert
`boundedCallDelta === iterations * blockersPerIteration`.

---

### IN3-03: `quality/index.ts`'s drift guard cannot fire under TypeScript's own narrowing *(carried forward, iterations 1-2, still open)*

**File:** `.pi/extensions/quality/index.ts:366` — verified unchanged.
`if (CONSULT_ADVISOR_TOOL_NAME !== "consult_advisor")` compares a
literal-typed `const` against the same literal.

**Fix:** `const _nameMatchesRegistration: "consult_advisor" =
CONSULT_ADVISOR_TOOL_NAME;`, or drop it and rely on
`tool-count-baseline.test.ts`'s grep.

---

### IN3-04: CR-03's exec-seam has no failing signature *(carried forward, iterations 1-2, still open)*

**File:** `tests/integration/quick-workflow.test.ts` (nine
`setQuickGateExecOverrideForTests` install sites). Stripping all nine still
leaves the suite green, because `productionExec` degrades fast in a
`node_modules`-less temp dir. The enforcing seam iteration 1 suggested
(throw when `process.env.VITEST` is set and no override is installed) was
not adopted, so Phase 9's new tests are unprotected. Note WR2-06 *narrows*
this slightly — an untrusted cwd now also refuses — but the seam itself is
still unenforced.

**Fix:** adopt the enforcing `resolveExec()` guard from iteration 2's IN2-04.

---

### IN3-05: `firstChunkWritten` never resolves in `splitStreamAtMultiple` mode *(carried forward from iteration 2, still open)*

**File:** `tests/helpers/qoder-loopback.ts:132-140, 539` — verified
unchanged: `firstChunkWrittenGate.resolve` appears only on the two-chunk
`writeStreamBody` path. A future test that sets `splitStreamAtMultiple` and
awaits `loop.firstChunkWritten` hangs to the 120 s `testTimeout`, contrary to
that field's own *"may always await it without hanging"* contract. WR2-03's
new test does not hit this (it awaits `onProgress`, not
`firstChunkWritten`), which is luck, not design.

**Fix:** resolve it from the multi-split path too and document that in
multi-split mode it aliases `chunkWritten[0]`.

---

### IN3-06: `importedSubsystemDirs` finds imports by regex, so a dynamic or side-effect import is invisible to the ratchet *(new, not currently exploitable)*

**File:** `tests/unit/workflow-budgets.test.ts:721`

The scan is `/\bfrom\s+["'](\.\.?\/[^"']+)["']/g`, which matches static
`import … from` and `export … from` only. `import("./x.ts")`,
`import "./x.ts"` (side-effect) and `require()` are not seen. I grepped
`.pi/` and there are **none** today — the only `require(` is inside a comment
at `routing/schema.ts:188` — so the fixed point is complete for the current
tree and WR2-04's claim stands. Recording it because the docstring
(`:687-694`) and `docs/WORKFLOWS.md` both state the walk generally, and a
Phase 9 lazy-loaded subsystem reached by `await import()` would be
unbudgeted with FLOW-11 green.

**Fix:** widen to `/(?:\bfrom\s*|\bimport\s*\(?\s*|^\s*import\s+)["'](\.\.?\/[^"']+)["']/gm`,
or state the static-only limitation in the docstring.

---

_Reviewed: 2026-08-15T17:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
_Iteration: 3 (final)_
