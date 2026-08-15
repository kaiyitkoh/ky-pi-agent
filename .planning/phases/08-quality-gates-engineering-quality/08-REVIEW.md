---
phase: 08-quality-gates-engineering-quality
reviewed: 2026-08-15T15:10:00Z
depth: standard
files_reviewed: 44
files_reviewed_list:
  - .pi/agents/reviewer.md
  - .pi/extensions/diagnostics/index.ts
  - .pi/extensions/diagnostics/quality-cost.ts
  - .pi/extensions/diagnostics/schema.ts
  - .pi/extensions/diagnostics/turns.ts
  - .pi/extensions/quality/advisor.ts
  - .pi/extensions/quality/calibration.ts
  - .pi/extensions/quality/gates.ts
  - .pi/extensions/quality/index.ts
  - .pi/extensions/quality/reviewer.ts
  - .pi/extensions/quality/review-schema.ts
  - .pi/extensions/quality/rules.ts
  - .pi/extensions/quality/verdict.ts
  - .pi/extensions/routing/modes.ts
  - .pi/extensions/safety/git.ts
  - .pi/extensions/workflows/evidence.ts
  - .pi/extensions/workflows/index.ts
  - docs/DIAGNOSTICS.md
  - docs/QUALITY.md
  - docs/RUNBOOK.md
  - docs/WORKFLOWS.md
  - tests/fixtures/seeded-defects/index.ts
  - tests/helpers/qoder-loopback.ts
  - tests/integration/advisor-consult.test.ts
  - tests/integration/gate10-nested-thinking.test.ts
  - tests/integration/qoder-delegate.test.ts
  - tests/integration/quality-gate-order.test.ts
  - tests/integration/quick-workflow.test.ts
  - tests/integration/refute-or-promote.test.ts
  - tests/integration/reviewer-calibration.test.ts
  - tests/integration/reviewer-contract.test.ts
  - tests/integration/turns-log.test.ts
  - tests/unit/contributing-boundary.test.ts
  - tests/unit/docs-policy.test.ts
  - tests/unit/evidence-gate.test.ts
  - tests/unit/quality-gates.test.ts
  - tests/unit/quality-rules.test.ts
  - tests/unit/quality-schema.test.ts
  - tests/unit/routing-dispatch.test.ts
  - tests/unit/subagent-agents-config.test.ts
  - tests/unit/tool-count-baseline.test.ts
  - tests/unit/turn-row.test.ts
  - tests/unit/workflow-budgets.test.ts
  - tests/unit/workflows-entry.test.ts
findings:
  critical: 4
  warning: 7
  info: 3
  total: 14
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-08-15T15:10:00Z
**Depth:** standard
**Files Reviewed:** 44
**Status:** issues_found

## Summary

Phase 8 builds the deterministic gate stage (GATE-01), the reviewer contract
(GATE-02..05), refute-or-promote (GATE-06), the advisor tool (GATE-09), the
QUAL-01 anti-pattern rules and the seeded-defect calibration harness. The
per-module purity discipline, the three-state `LegStatus`, the fail-safe
direction in `runRefuteOrPromote`, the GATE-10 nested-thinking wire proof, and
the evidence-gate branch (6) work are all genuinely well built and well
falsified — `tests/unit/evidence-gate.test.ts`, `tests/integration/gate10-
nested-thinking.test.ts` and `tests/unit/quality-schema.test.ts` each carry a
paired positive and a real mutation argument, and I could not find a way to
make them pass against a broken subject.

The concerns are concentrated in **how the gate stage actually executes in
production**, and in **two controls this phase weakened without saying so**.

1. `runQuickGateStage`'s production runner shells `npx` with `shell: false`.
   I executed this: on this machine (win32, Node v24.16.0) it fails with
   `ENOENT`. Both the `typecheck` and `lint` legs therefore degrade to
   `unavailable` — which by design never sets `blocking`. Two of GATE-01's
   four legs are structurally dead on the project's declared primary
   platform, and the three-state design is precisely what makes that
   invisible. On a platform where `npx` *is* spawnable, the same code
   downloads and executes unpinned packages from the npm registry into
   whatever `cwd` `/quick` was invoked from.
2. `tests/integration/quick-workflow.test.ts` drives `/quick`'s handler nine
   times and never installs `setQuickGateExecOverrideForTests` — the seam
   `tests/integration/quality-gate-order.test.ts`'s own docstring calls
   mandatory and its absence "catastrophic". On Windows this is masked by
   (1); on the macOS CI leg it is not.
3. The FLOW-11 anti-offloading directory ratchet does not cover
   `.pi/extensions/quality/` (3,406 lines) even though `/quick` calls
   straight into it, because the ratchet only discovers directories holding
   a `registerCommand(` source. `docs/WORKFLOWS.md` and
   `tests/unit/workflow-budgets.test.ts` both explicitly claim this cannot
   happen.
4. The calibration number (3/6 = 0.50) is reproducible, but its matcher can
   be satisfied by a reviewer that names the file's only function at BLOCKER
   severity without identifying any defect — I give the exact mutation to the
   shotgun control that turns 0.0 into 1.0.

Checked and cleared: the RB-08-01/02/03 statuses agree in both the summary
table and the detail sections of `docs/RUNBOOK.md`; `safety/` imports nothing
from `routing/`; exactly one new tool (`consult_advisor`) is registered and it
carries the (a)/(b)/(c) toll in both `contributing-boundary.test.ts` and
`tool-count-baseline.test.ts`; no new npm dependency; no `it.skip`, `retry`,
`fileParallelism:false` or raised `testTimeout` appears anywhere in the phase's
files; every model call still routes through `runSingleShotRole` →
`callModel()`; no code path in the reviewed files can issue a real provider
request during a test run (every provider is a `fauxProvider`, and the Qoder
loopback refuses any non-`127.0.0.1` host before handing out a `baseUrl`).

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: GATE-01's typecheck and lint legs are permanently `unavailable` on Windows — two of four legs are dead in production and the design hides it

**File:** `.pi/extensions/quality/index.ts:173-177` (with `.pi/extensions/quality/gates.ts:228-288`)

**Issue:** `productionExec` is

```ts
const productionExec: ExecRunner = (cmd, args, cwd) => {
	const result = spawnSync(cmd, args, { cwd, shell: false, windowsHide: true, encoding: "utf-8" });
	if (result.error) throw result.error;
	...
};
```

and is called as `exec("npx", ["tsc", "--noEmit"], cwd)` and
`exec("npx", ["vitest", "run", ...LINT_GATE_FILES], cwd)`.

On Windows `npx` is `npx.cmd`, and Node refuses to spawn a `.cmd` without a
shell. **Executed on this machine:**

```
$ node -e "const {spawnSync}=require('child_process'); const r=spawnSync('npx',['tsc','--noEmit'],{shell:false,...}); console.log(r.error && r.error.code)"
error: ENOENT spawnSync npx ENOENT
status: null
platform: win32 node: v24.16.0
```

`productionExec` therefore throws, `runTypecheckLeg`/`runLintLeg` catch and
return `{status:"unavailable"}`, and `runDeterministicGates` computes
`blocking = legs.some(status === "fail")` — so an unavailable leg never
blocks. Concrete failure scenario: on the developer's own machine, `/quick`
runs against a repository with a hard TypeScript error and a broken structural
lint suite and reports `typecheck: UNAVAILABLE`, `lint: UNAVAILABLE`,
`blocking: false`, arms the run, and hands the task to the model. This is
exactly the "control that silently does not run, and nobody downstream can
tell" failure `gates.ts`'s own module docstring says the three-state type
exists to prevent — the three-state type reports it honestly, and nothing
acts on the report.

`gates.ts`'s docstring justifies the spawn shape as "mirroring `safety/git.ts`'s
`spawnSync(..., { shell: false })` discipline". That reasoning does not
transfer: `safety/git.ts` spawns `git`, a real `.exe`. Nothing tests this leg
against a real binary — `quality-gates.test.ts` only ever passes a scripted
`ExecRunner`, and `quality-gate-order.test.ts` explicitly overrides it.

**Fix:** resolve the local binary rather than the `npx` shim, and add a test
that runs the real production runner against this repository's own root and
asserts the leg is `pass` or `fail`, never `unavailable`:

```ts
import { join } from "node:path";

/** The locally-installed binary, resolved per platform — never the `npx` shim. */
function localBin(cwd: string, name: string): string {
	const suffix = process.platform === "win32" ? ".cmd" : "";
	return join(cwd, "node_modules", ".bin", `${name}${suffix}`);
}

const productionExec: ExecRunner = (cmd, args, cwd) => {
	const bin = localBin(cwd, cmd);
	if (!existsSync(bin)) {
		// Honest UNAVAILABLE, with a reason naming the missing binary.
		throw new Error(`${cmd} is not installed under ${cwd}/node_modules/.bin`);
	}
	const result = spawnSync(bin, args, {
		cwd,
		// A .cmd shim cannot be launched without a shell on Windows; a real
		// executable can. Branch explicitly rather than relying on ENOENT.
		shell: process.platform === "win32",
		windowsHide: true,
		encoding: "utf-8",
	});
	if (result.error) throw result.error;
	return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};
```

and change the call sites to `exec("tsc", ["--noEmit"], cwd)` /
`exec("vitest", ["run", ...LINT_GATE_FILES], cwd)`.

---

### CR-02: the same runner downloads and executes unpinned npm packages on any platform where `npx` *is* spawnable

**File:** `.pi/extensions/quality/index.ts:173-177`, `.pi/extensions/quality/gates.ts:231, 277`

**Issue:** On macOS/Linux (the CI matrix includes `macos-latest`, and CLAUDE.md
names macOS as the next target platform) `npx` resolves and runs. `npx tsc`
searches `cwd/node_modules/.bin` and ancestors; when it finds nothing it
**installs the npm package literally named `tsc` from the registry and runs
it** — a different, unmaintained package from `typescript`. Same for
`npx vitest`. Neither carries `--ignore-scripts`, and npm skips its
confirmation prompt when stdin is not a TTY.

Concrete failure scenario: the user runs `/quick` in any project that does not
have `typescript`/`vitest` in a local `node_modules` — which is the normal case
for the multi-stack repositories this harness is built for. The harness
silently fetches and executes two unpinned, unaudited packages with full user
permissions, with lifecycle scripts enabled, on a laptop CLAUDE.md states holds
live static IAM admin credentials. This is a direct violation of the project's
stated supply-chain posture ("Never write a bare `npm:pkg`… into
`settings.json`"; "Every install carries `--ignore-scripts`").

Secondary correctness bug at the same site: `LINT_GATE_FILES` is a hardcoded
list of *this repository's* twelve test paths. Run in any other `cwd` those
paths do not exist, so the lint leg reports `fail` on a repository it knows
nothing about.

**Fix:** apply CR-01's `localBin` resolution (never `npx`), and make the leg
report `unavailable` with a reason naming the missing binary rather than
reaching the network. If `npx` must be retained for some path, it must carry
`--no-install` (npm ≥7: `--no`) so a missing package is a refusal, never a
download. Separately, gate the lint leg on `cwd === repoRoot` or derive its
file list from the target repository rather than hardcoding this one's.

---

### CR-03: `quick-workflow.test.ts` invokes `/quick` nine times without the exec seam — the suite itself shells `npx` into throwaway temp dirs

**File:** `tests/integration/quick-workflow.test.ts:514, 615, 733, 806, 889, 993, 1082, 1182, 1330` (every `await command.handler(...)` that reaches `.pi/extensions/workflows/index.ts:42`)

**Issue:** `/quick` gained `runQuickGateStage(ctx.cwd)` at
`workflows/index.ts:42`, between the arm-check and `startRun`. Every case in
`quick-workflow.test.ts` from case 3 onward reaches that line, against a
`gitInit`-only temp `cwd` with no `node_modules` and no `package.json`. The
file never imports or calls `setQuickGateExecOverrideForTests`.

`tests/integration/quality-gate-order.test.ts`'s own module docstring
(lines 28-39) states the rule this file breaks, verbatim: *"Run against a
throwaway `gitInit`-only fixture with no `node_modules` at all, a real `npx`
would attempt to fetch a package over the network — exactly the 'install
nothing' rule this project's autonomous-run constraints forbid, and a hang or
a flaky CI run besides."* That file sets and restores the override in every
single `it`; `quick-workflow.test.ts` sets it in none.

Concrete failure scenario, macOS CI leg: `npx vitest run tests/unit/
chokepoint-lint.test.ts …` runs in the temp dir, either fetching vitest from
the registry or exiting non-zero on "No test files found". Either way the lint
leg is `fail`, `gate.blocking` is `true`, `/quick` notifies `gate.report` and
returns **without arming a run**, and cases 3-9 then hang for 5 s each in
`waitFor(... "case N's evidence row")` before failing. On Windows this is
entirely masked by CR-01, which is why it has not been noticed. So either the
macOS CI leg is currently red, or the suite has not been run on macOS since
this landed — and the Windows-only green run proves nothing about the leg.

**Fix:** mirror `quality-gate-order.test.ts` exactly — install
`INSTANT_PASS_EXEC` at the top of each `it` (or in a `beforeEach`) and restore
it in a `finally`/`afterEach`:

```ts
import { setQuickGateExecOverrideForTests } from "../../.pi/extensions/quality/index.ts";
import type { ExecRunner } from "../../.pi/extensions/quality/gates.ts";

const INSTANT_PASS_EXEC: ExecRunner = () => ({ code: 0, stdout: "", stderr: "" });

beforeEach(() => setQuickGateExecOverrideForTests(INSTANT_PASS_EXEC));
afterEach(() => setQuickGateExecOverrideForTests(undefined));
```

Better still, make the seam fail loudly rather than silently reaching the
network: have `resolveExec()` throw when `process.env.VITEST` is set and no
override has been installed, so a future test that forgets is red instead of
platform-dependent.

---

### CR-04: the FLOW-11 anti-offloading directory ratchet does not cover `.pi/extensions/quality/` — 3,406 lines of `/quick`'s own logic are unbudgeted, and two artifacts state that this cannot happen

**File:** `tests/unit/workflow-budgets.test.ts:223-366, 578-606` (with `docs/WORKFLOWS.md:146-156` and `.pi/extensions/workflows/index.ts:12,42`)

**Issue:** `commandDirs` is derived from `discovered.filter(isCommandSource)`,
and `isCommandSource` is `text.includes("registerCommand(")`. No file under
`.pi/extensions/quality/` spells `registerCommand(` (verified by grep — the
nine matches are `workflows`, `loop-police`, `plan-mode`, `checkpoint`,
`todo.ts`, `routing`, `harness`, `diagnostics/budget.ts`, and one `.md`). So
`.pi/extensions/quality` is not in `commandDirs`, has no `DIRECTORY_BUDGETS`
entry, and neither the "present-but-undeclared" completeness check nor the
per-directory ratchet ever looks at it.

Measured: `.pi/extensions/quality/` is **3,406 lines across 8 files**
(`advisor.ts` 197, `calibration.ts` 178, `gates.ts` 407, `index.ts` 237,
`reviewer.ts` 409, `review-schema.ts` 541, `rules.ts` 889, `verdict.ts` 548).
`/quick` calls straight into it (`workflows/index.ts:12` imports
`runQuickGateStage`, line 42 calls it).

This is precisely the move both artifacts say is impossible:

- `tests/unit/workflow-budgets.test.ts:105-115` raises `workflows/index.ts`
  80 → 100 with the justification *"all of it lives in this file per the
  plan's own instruction not to inline gate/leg logic elsewhere, **so the
  growth is real and visible here rather than offloaded**"*. Nearly all of the
  gate/leg logic was in fact placed elsewhere, in a directory the ratchet does
  not reach.
- `docs/WORKFLOWS.md:146-156`: *"A file close to its own limit could be 'fixed'
  by moving logic into a private helper that only `/quick` ever calls… The
  aggregate exists so that move does not shrink anything that matters… which
  is why the aggregate is the mechanism that actually holds the line, **not a
  promise**."* `docs/QUALITY.md` declares the code authoritative on
  disagreement; the code disagrees with both statements.

Concrete failure scenario: Phase 9 adds `/grill`, `/plan`, `/execute`,
`/review` as thin command files that delegate into new unbudgeted sibling
subsystems, and FLOW-11 reports green while the harness grows without bound —
the exact outcome the requirement exists to prevent.

**Fix:** either add the entry, or (better) close the discovery hole so a future
subsystem cannot repeat it:

```ts
// DIRECTORY_BUDGETS — add:
{
	dir: ".pi/extensions/quality",
	budget: 3410, // measured 3,406 raw lines across 8 files 2026-08-15, rounded up to the next ten
	why: "GATE-01's gate stage, called directly by /quick (workflows/index.ts:42). " +
		"Discovered by IMPORT, not by registerCommand( — see commandDirs below.",
},
```

and widen discovery so a directory a command source imports is ratcheted too:

```ts
/** Subsystem roots a discovered command source imports directly — the offloading target registerCommand(-based discovery cannot see. */
function importedSubsystemDirs(commandFiles: string[]): string[] {
	const dirs = new Set<string>();
	for (const file of commandFiles) {
		const text = readFileSync(join(repoRoot(), file), "utf-8");
		for (const m of text.matchAll(/from\s+"(\.\.?\/[^"]+)"/g)) {
			const abs = resolve(dirname(join(repoRoot(), file)), m[1]);
			const rel = relative(repoRoot(), abs).split("\\").join("/");
			if (rel.startsWith(`${EXTENSIONS_DIR}/`)) dirs.add(rel.split("/").slice(0, 3).join("/"));
		}
	}
	return [...dirs];
}
```

## Warnings

### WR-01: `validateReview` accepts duplicate, contradictory verdicts for the same requirement id, while its own reject message and two docs say "exactly one"

**File:** `.pi/extensions/quality/review-schema.ts:342-365`

**Issue:** Branch (3) checks coverage (`missingIds`) and invention
(`inventedIds`) but never duplication. `validateReview` accepts:

```js
verdicts: [
  { requirementId: "GATE-03", status: "Implemented", evidence: "src/a.ts:1" },
  { requirementId: "GATE-03", status: "Missing",     evidence: "src/a.ts:2" },
]
```

against `expectedRequirementIds = ["GATE-03"]`. The module's own reject string
at line 353 reads *"every stated requirement needs exactly one verdict"*, the
branch-(3) docstring at line 277 says the same, and `docs/QUALITY.md:118-120`
says *"A per-requirement verdict … in both directions"*. Concrete failure
scenario: `renderReviewMarkdown` emits two contradictory table rows, and a
Phase 9 consumer doing `verdicts.find(v => v.requirementId === id)` silently
reads `Implemented` and never sees the `Missing`.

**Fix:** add the duplicate check alongside the invented check:

```ts
const duplicateIds = verdictRequirementIds.filter((id, i, all) => id.length > 0 && all.indexOf(id) !== i);
if (duplicateIds.length > 0) {
	return {
		ok: false,
		reason:
			`submit_review carries more than one verdict for requirement id(s): ${[...new Set(duplicateIds)].join(", ")} -- ` +
			"every stated requirement needs exactly ONE verdict; two verdicts for one id is not a review, it is two",
	};
}
```

---

### WR-02: an unrecognised verdict `status` is silently coerced to `"Missing"`, while an unrecognised `severity` is an explicit reject

**File:** `.pi/extensions/quality/review-schema.ts:439-447`

**Issue:** Branch (9)'s normaliser does

```ts
const status = typeof obj.status === "string" && VALID_STATUSES.has(obj.status) ? (obj.status as ...) : "Missing";
```

so `status: "implemented"` (wrong case), `status: "Done"`, or an absent
`status` all become `"Missing"` in the accepted `ReviewArtifact`. None of the
nine numbered branches mentions `status` at all, and the asymmetry with branch
(2) — where a malformed `severity` is a hard reject naming the offending value
— is undocumented. Concrete failure scenario: a reviewer that genuinely
answered `Implemented` in the wrong case has that verdict silently rewritten to
`Missing`, a verdict it never gave, and the review is accepted so nothing
surfaces the rewrite. That is the same class of "fabricate a value rather than
report absence" this phase's own omission rule forbids elsewhere
(`quality-cost.ts`, `turns.ts`).

**Fix:** add a numbered reject branch mirroring branch (2), and drop the
fallback:

```ts
// (2b) an unrecognised verdict status is malformed, exactly like an unclassified finding.
for (let i = 0; i < verdicts.length; i++) {
	const status = isPlainObject(verdicts[i]) ? (verdicts[i] as Record<string, unknown>).status : undefined;
	if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
		return { ok: false, reason: `verdicts[${i}].status must be exactly one of Implemented, Partial, or Missing -- received ${describeValue(status)}` };
	}
}
```

---

### WR-03: the calibration matcher can be satisfied without detecting any defect — the shotgun control proves only that one particular wording does not score

**File:** `.pi/extensions/quality/calibration.ts:125-135`, `tests/fixtures/seeded-defects/index.ts:316-386`, `tests/integration/reviewer-calibration.test.ts:237-257`

**Issue:** `findingCatches` requires (a) the right file, (b) any one of
`mustMentionAny` appearing in `concreteFailure` **or** `location`, and (c) a
minimum severity. Every needle is a bare identifier that is present verbatim in
the file contents the reviewer is handed: `markMigrationComplete`,
`configuredHead`, `homedir()`, `isGuardedCommand`, `isWithinRateLimit`,
`MUTATION-VERIFIED`. Five of the six fixture files contain exactly one function,
so "name the file's only function" is trivially derivable from the input.

**The mutation that proves it:** change one line of
`SHOTGUN_REVIEWER_ARGS` in `reviewer-calibration.test.ts:251` from

```ts
concreteFailure: "General code quality concern -- this area could probably be improved somehow.",
```

to a per-file name-drop of equal vagueness, e.g.

```ts
concreteFailure: `${SHOTGUN_NEEDLES[index % 6]} in this file could probably be improved somehow.`,
// SHOTGUN_NEEDLES = ["markMigrationComplete","configuredHead","homedir()","isGuardedCommand","isWithinRateLimit","MUTATION-VERIFIED"]
```

and the shotgun reviewer's `catchRate` goes from `0` to `1.0` — 6/6 — having
identified nothing. So the recorded 3/6 = 0.50 measures "did the reviewer name
the right identifier in the right file at BLOCKER severity", not "did the
reviewer catch the defect", and `docs/QUALITY.md:222-226`'s claim that
`findingCatches` requires *"a specific, named mention, not merely a high
finding count"* overstates what the number means. This matters most for
`RB-08-03`: a live model asked to review six files will name each file's only
function as a matter of course.

**Fix:** make each needle name the *defect*, not the *symbol*, and add the
name-dropping shotgun as a third control:

```ts
// tests/fixtures/seeded-defects/index.ts — e.g. for symptomatic-fix:
mustMentionAny: ["always returns true", "unconditionally true", "ignores its arguments"],
// for absent-guard:
mustMentionAny: ["never calls isGuardedCommand", "guard is not wired", "execSync without"],
```

Alternatively keep the identifier but require it *and* a behaviour phrase, by
splitting the expectation into `mustMentionSymbol` + `mustMentionBehaviourAny`
and requiring both in `findingCatches`.

---

### WR-04: the WR-07 "paired positive" in `qoder-delegate.test.ts` does not prove the deadline resets on progress, and reintroduces a wall-clock race into the file 08-05 de-flaked

**File:** `tests/integration/qoder-delegate.test.ts:600-636`

**Issue:** The case sets `injectedTimeoutMs = 2000` and `interChunkDelayMs = 50`,
awaits `firstChunkWritten`, sleeps 50 ms, releases the second chunk, and asserts
`folded.done === true`. Total elapsed is ~50-150 ms against a 2,000 ms budget.
Its comment claims it proves *"the deadline resets on progress rather than being
a fixed budget from the stream's own start"*.

**The mutation that leaves it green:** change `client.ts` to arm ONE
`setTimeout(reject, inactivityTimeoutMs)` at stream open and never reset it on a
read. Total elapsed (~150 ms) is far under 2,000 ms, so this test still passes.
The claim in the comment is therefore untested.

It is also the one remaining wall-clock-dependent assertion in this file:
`setTimeout(50)` racing a fixed 2,000 ms budget under vitest fork-parallel
scheduling on a loaded runner is the same shape (a wider bound of the same
guess) that the 08-05 de-flake removed. `tests/helpers/qoder-loopback.ts`'s own
docstring says *"No WIDER duration fixes this: any fixed number is a race
against however loaded the machine happens to be at that moment."*

**Fix:** make the elapsed time exceed the budget while every gap stays under it,
which is the only shape that distinguishes reset-on-progress from a fixed
budget — for example three chunks each released only after the previous
chunk's own `chunkWritten` event, with `injectedTimeoutMs` small (60 ms) and
the *sum* of the gaps provably larger. Or assert the property directly from the
transcript the client already writes (the number of times the deadline was
re-armed), the way the negative case reads `afterMs`.

---

### WR-05: `buildImportGraph` silently drops `export … from "…"` re-export edges, and nothing in the rendered contract says so

**File:** `.pi/extensions/quality/reviewer.ts:262, 281-294`

**Issue:** `IMPORT_FROM_RE = /\bimport\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g` only
matches statements led by `import`. A re-export — `export { loopPolice as
default } from "./loop-police.ts";`, which this repository really ships at
`.pi/extensions/loop-police/index.ts` — is a genuine module edge and produces no
entry. The import graph is one of the six contract elements handed to the
reviewer *specifically* so it can see cross-file breakage
(`reviewer.ts:15-22`), and the rendered section header only says "declared,
syntax-level only". Concrete failure scenario: a change touching
`loop-police.ts` and its re-exporting `index.ts` is presented to the reviewer
with an import graph showing `index.ts: (no declared imports)` — a positive
statement that the file depends on nothing, which is false, and which is
exactly the bug-of-omission signal the graph exists to carry.

**Fix:**

```ts
const IMPORT_FROM_RE = /\b(?:import|export)\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g;
```

and update the docstring plus the rendered heading to say the graph covers
`import … from` **and** `export … from`, and still excludes bare
`import "./x"` side-effect imports and dynamic `import()`.

---

### WR-06: `/quick`'s blocking branch drains the WHOLE quality ledger, not just the gate stage's contribution

**File:** `.pi/extensions/workflows/index.ts:43-54`

**Issue:** The four-part comment justifies `takeQualityCost()` on the blocking
branch with *"(iii) the SAME cost IS measured on the clean-run path below"*.
`takeQualityCost()` clears the entire process-wide slot
(`quality-cost.ts:155-166`), not the amount `runDeterministicGates` just added.
The claim is only true while the gate stage is the sole contributor in a turn.
Concrete failure scenario: Phase 9 (QUAL-08) wires the reviewer and the refute
pass into a ceremonial workflow that also invokes `/quick`; a `/quick` that
blocks then silently deletes the reviewer's already-recorded `qualityMs`/
`qualityTokens` from that turn, and the turn row under-reports quality spend
with nothing on disk saying so. QUAL-09's whole point is that a cost that
vanishes must not look like a cost that was never spent.

**Fix:** subtract only what the gate stage added, e.g. have
`runDeterministicGates` return its own `totalMs` (it already does) and expose a
`refundQualityCost({ ms })` in `quality-cost.ts`, or have `runQuickGateStage`
take an `chargeLedger: boolean` and skip `addQualityCost` until after the caller
has decided whether the run proceeds.

---

### WR-07: `ERROR_BUDGET_ON_OWN_SOURCE`'s recorded provenance no longer describes what the assertion measures

**File:** `tests/unit/quality-rules.test.ts:288-312`

**Issue:** The `why` block states the 22 was *"measured 2026-08-15 against the
Phase 1-7 `.pi/extensions/` tree (this plan's own `quality/rules.ts` does not
appear in it)"*. The assertion at line 329 scans `trackedFiles(".pi/extensions")`
— the *current* tree, which now includes eight `quality/*.ts` files (3,406
lines) that landed after that measurement. The suite is green
(`npx vitest run tests/unit/quality-rules.test.ts` passes here), so those files
contribute at most whatever headroom exists — but nobody knows how much,
because the number was never re-measured. A recorded budget whose recorded
provenance describes a different input set is no longer the "RECORDED NUMBER,
not a target tuned to zero" it claims to be, and `<=` means it can absorb
silent regressions in the new files up to the unknown headroom.

**Fix:** re-measure against the current tracked tree, update both the constant
and the `why` (stating the new per-rule breakdown), and consider the same
`toBe(measured)` discipline `workflow-budgets.test.ts` adopted for WR2-03 so a
*drop* also requires an edit.

## Info

### IN-01: `evidence-gate.test.ts`'s M1 rationale describes behaviour the code no longer has

**File:** `tests/unit/evidence-gate.test.ts:140`

**Issue:** The `why` reads *"only records already at headSha are considered for
the isError check"*. Since CR-01's branch (3)
(`workflows/evidence.ts:204-217`) the failure check runs over **every** record
in the run, before the `headSha` narrowing — that is the whole point of the
branch's placement. The row still passes, and for the right reason, but the
recorded rationale is now the pre-fix behaviour. In a repository whose review
value is largely carried by these `why` strings, a stale one is a small
overclaim.

**Fix:** reword to "a passing record from a different SHA cannot rescue a run
that contains any failing record — branch (3) inspects every record, at any
SHA, before headSha is consulted."

---

### IN-02: `refute-or-promote.test.ts`'s bounded-loop assertion conflates provider calls with iterations

**File:** `tests/integration/refute-or-promote.test.ts:412-416`

**Issue:** `expect(run.boundedCallDelta).toBeLessThanOrEqual(MAX_REVIEW_ITERATIONS)`
compares a *provider-call count* against an *iteration bound*. The real bound is
`iterations × (1 + survivingBlockersPerIteration)`; the two coincide only because
this fixture has exactly one BLOCKER per iteration. A fixture with two BLOCKERs
would make a correctly-bounded loop fail this assertion.

**Fix:** assert `run.boundedResult.iterations <= MAX_REVIEW_ITERATIONS`
(already done on the next line) and separately assert
`boundedCallDelta === iterations * blockersPerIteration`, so the call count is
checked against what it actually is.

---

### IN-03: `quality/index.ts`'s drift guard cannot fire under TypeScript's own narrowing in the common case

**File:** `.pi/extensions/quality/index.ts:217-222`

**Issue:** `if (CONSULT_ADVISOR_TOOL_NAME !== "consult_advisor")` compares a
`const` whose type is the literal `"consult_advisor"` against the same literal.
It does guard a real future edit to `advisor.ts`'s constant, so it is not dead —
but the comment claims it "throws at extension-load time, not merely at test
time, if they ever disagree", and a reader may reasonably expect the compiler to
have caught the drift first. `tool-count-baseline.test.ts`'s Direction 1 grep
already enforces the same invariant from the outside.

**Fix:** either drop the runtime check and rely on the grep-based test, or
replace it with an assignment that the compiler enforces:
`const _nameMatchesRegistration: "consult_advisor" = CONSULT_ADVISOR_TOOL_NAME;`

---

_Reviewed: 2026-08-15T15:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
