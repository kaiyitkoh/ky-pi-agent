/**
 * GATE-01 / QUAL-02 / QUAL-07 — the deterministic gate stage.
 *
 * PURPOSE. Four legs — typecheck, lint, LSP diagnostics, the QUAL-01
 * anti-pattern rules — run and feed errors back BEFORE any model review, so
 * the cheapest, most certain signals never cost a token. Each leg reports one
 * of THREE states: PASS (ran, clean), FAIL (ran, found things), UNAVAILABLE
 * (did not run at all). UNAVAILABLE IS NOT A PASS — an absent check reported
 * as clean is Phase 4's headless-guard failure (a control that silently does
 * not run, and nobody downstream can tell) in a new costume. This is why
 * {@link LegStatus} has three arms and not a boolean plus a nullable reason:
 * a two-state type cannot represent "did not run" as anything other than
 * "ran and passed" or "ran and failed", both of which are lies about a leg
 * that never executed.
 *
 * ---------------------------------------------------------------------------
 * THE LSP LEG READS RUNTIME STATE, NEVER `.pi/settings.json`
 * ---------------------------------------------------------------------------
 * `@narumitw/pi-lsp` is PINNED in `.pi/settings.json` `packages[]` AND NOT
 * INSTALLED (RB-07-02, OUTSTANDING) — reading that file to decide LSP
 * availability would report "available" for a gate that cannot possibly run,
 * because the file lists what is CONFIGURED, not what is LOADED. This module
 * never reads it. {@link probeLspAvailability} instead takes the live,
 * registered tool-name list as a plain parameter, supplied by a caller that
 * holds Pi's `ExtensionAPI` (`pi.getActiveTools()` / `pi.getAllTools()`,
 * `dist/core/extensions/types.d.ts:946-950`) in its own closure — this
 * module's `ctx` equivalent has no such accessor
 * (`ExtensionContext`/`ExtensionCommandContext`, same file, lines 209/254),
 * so the tool-name list cannot be derived here even if this module wanted to.
 * The live check that would actually install and probe the extension is
 * RB-08-02, appended OUTSTANDING alongside RB-07-02 rather than renumbering
 * anything — this plan proves the mechanism, not the extension's real
 * output.
 *
 * ---------------------------------------------------------------------------
 * QUAL-02 IS TWO SEPARATE CLAIMS, AND THIS MODULE MAKES BOTH CHECKABLE
 * ---------------------------------------------------------------------------
 * "No measurable wall-clock" bundles a STRUCTURAL claim (this stage never
 * crosses into the model tier at all) and a MEASURED claim (the anti-pattern
 * legs' wall clock stays under a stated, dated budget). This module makes the
 * structural claim true by construction — see the chokepoint-hygiene note
 * below — and `tests/unit/quality-gates.test.ts` makes it CHECKABLE by
 * resolving this module's own import graph transitively, the same technique
 * `tests/unit/chokepoint-lint.test.ts` uses for DIAG-03. The measured claim
 * is a real `process.hrtime.bigint()` figure against
 * `ANTI_PATTERN_BUDGET_MS`, recorded in that same test file.
 *
 * ---------------------------------------------------------------------------
 * PURITY: TWO CLEARLY SEPARATED IMPURE LEGS
 * ---------------------------------------------------------------------------
 * Following `workflows/evidence.ts`'s own stated discipline ("PURE EXCEPT FOR
 * TWO CLEARLY SEPARATED IMPURE FUNCTIONS"): {@link runTypecheckLeg} and
 * {@link runLintLeg} each shell a subprocess, but only through an INJECTED
 * runner function the caller supplies — production passes a real
 * `child_process.spawnSync`-backed runner (CR-01: this does NOT mirror
 * `safety/git.ts`'s `spawnSync(..., { shell: false })` discipline, because
 * `git.ts` spawns a real `.exe`; `quality/index.ts#productionExec` instead
 * resolves the LOCAL pinned binary under `<cwd>/node_modules/.bin` and
 * branches `shell` on platform, since a Windows `.cmd` shim cannot be
 * launched without one), tests pass a scripted one. Every other export
 * here — {@link probeLspAvailability},
 * {@link runAntiPatternLeg}, {@link runDeterministicGates},
 * {@link shouldRunDesignReview} — takes and returns plain data with no I/O
 * of its own.
 *
 * ---------------------------------------------------------------------------
 * CHOKEPOINT HYGIENE (DIAG-03 / QUAL-02's structural claim)
 * ---------------------------------------------------------------------------
 * This file never reaches a model. It does not spell, even in a comment, the
 * documented direct-completion method on the model registry, its
 * simple-options or streaming siblings, the method that hands back a raw
 * provider object, the other route to a raw provider object, a deep import
 * under the pi-ai package's adapter path, or the model runtime class name —
 * the same six-plus-one bypass routes `tests/unit/chokepoint-lint.test.ts`
 * enumerates for DIAG-03. Describing them here in the abstract, rather than
 * naming them, is deliberate: `chokepoint-lint.test.ts` matches raw source
 * text, comments included, and grants `quality/` no exemption.
 *
 * ---------------------------------------------------------------------------
 * QUAL-07: A PREDICATE HERE, NOT A CALL
 * ---------------------------------------------------------------------------
 * {@link shouldRunDesignReview} decides WHETHER a design-level review pass
 * should fire; it never makes the call itself, and this module never touches
 * the reviewer. It returns `true` only on named signals (a diff spanning many
 * files, a loop wrapping a query, a data-model change, a public-interface
 * change) or an explicit escalation request — and, just as importantly, it
 * returns `false` on an ordinary small task. A predicate that fires on every
 * task is not a predicate, it is the review pass itself wearing a
 * disguise — QUAL-07's own text says "conditionally … never on every task",
 * and the negative case (`tests/unit/quality-gates.test.ts`, all-false
 * signals) is exactly what proves this module keeps that promise. Phase 9
 * (QUAL-08) dials how deep the review that eventually fires goes; this plan
 * builds only the mechanism that decides IF it fires at all.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (BOOT-10)
 * ---------------------------------------------------------------------------
 * This module registers nothing. It does not spell the tool-registration
 * call, in code or in prose — `tests/unit/contributing-boundary.test.ts`
 * matches that call's name as a plain substring across every tracked source
 * under `.pi/extensions/`, comments included, and grants this directory no
 * exemption.
 */
import { addQualityCost } from "../diagnostics/quality-cost.ts";
import { runAntiPatternRules, type QualitySource } from "./rules.ts";

// ---------------------------------------------------------------------------
// Three-state leg verdict
// ---------------------------------------------------------------------------

/**
 * One leg's verdict. Exactly three arms — never `{ok: boolean, reason?}` — so
 * "did not run" cannot collapse into either "ran and passed" or "ran and
 * failed". See the module docstring's opening paragraph for why a boolean
 * cannot carry this.
 */
export type LegStatus =
	| { readonly status: "pass" }
	| { readonly status: "fail"; readonly findings: readonly string[] }
	| { readonly status: "unavailable"; readonly reason: string };

/** The four legs, in BINDING evaluation order — see {@link runDeterministicGates}. */
export const GATE_LEGS = ["typecheck", "lint", "lsp", "anti-pattern"] as const;

export type LegId = (typeof GATE_LEGS)[number];

/**
 * The whole stage's result.
 *
 * `blocking` is true iff any leg is `fail` — and by construction (see
 * {@link runAntiPatternLeg}) the `anti-pattern` leg only ever reaches `fail`
 * when it holds at least one ERROR-tier finding, never on warnings alone. A
 * leg that is `unavailable` never sets `blocking` — it did not run, so it has
 * nothing to block on — but it MUST appear in `report`, so a caller and the
 * JSONL record both see that the check was skipped rather than silently
 * reading it as clean.
 */
export interface GateResult {
	readonly legs: Readonly<Record<LegId, LegStatus>>;
	readonly blocking: boolean;
	readonly elapsedMsByLeg: Readonly<Record<LegId, number>>;
	readonly totalMs: number;
	readonly report: string;
}

// ---------------------------------------------------------------------------
// LSP leg (GATE-01, RB-08-02)
// ---------------------------------------------------------------------------

/** Both tool names `@narumitw/pi-lsp@0.49.4` registers (`src/pi-lsp.ts:146-147`). Both must be present for the leg to be usable. */
const LSP_TOOL_NAMES = ["lsp_diagnostics", "lsp_fix"] as const;

/**
 * The LSP leg. Requires BOTH {@link LSP_TOOL_NAMES} to be present in
 * `registeredToolNames` — a partial registration (one tool present, the other
 * absent, e.g. mid-`/reload`) is exactly the shape a boolean check would get
 * wrong, so the missing-name set is always named explicitly rather than
 * collapsed to a generic "not available".
 *
 * NEVER reads `.pi/settings.json` — see the module docstring's LSP section
 * for why that file cannot answer this question honestly.
 */
export function probeLspAvailability(registeredToolNames: readonly string[]): LegStatus {
	const missing = LSP_TOOL_NAMES.filter((name) => !registeredToolNames.includes(name));
	if (missing.length > 0) {
		return {
			status: "unavailable",
			reason:
				`missing tool${missing.length > 1 ? "s" : ""} ${missing.join(", ")} — @narumitw/pi-lsp is pinned in ` +
				"settings but not installed (RB-07-02); the live check that would exercise it once installed is " +
				"RB-08-02",
		};
	}
	return { status: "pass" };
}

// ---------------------------------------------------------------------------
// Anti-pattern leg (QUAL-01, QUAL-02's measured half)
// ---------------------------------------------------------------------------

/**
 * The anti-pattern leg. Runs all six QUAL-01 rules over `sources` via
 * {@link runAntiPatternRules}.
 *
 * ERROR-tier findings make this leg `fail`. WARNING-tier findings (from the
 * two honestly undecidable rules, `literal-special-case` and `n-plus-one`)
 * can NEVER fail this leg on their own — if the run produces warnings only,
 * the leg is `pass`, matching `rules.ts`'s own tier contract for those two
 * rules. When the leg DOES fail (because at least one ERROR-tier finding
 * exists), every finding — error AND warning — is carried in `findings`, each
 * tagged with its own tier, so a caller reading a failing leg can see plainly
 * that any warnings present did not, by themselves, cause the failure.
 */
export function runAntiPatternLeg(sources: readonly QualitySource[]): LegStatus {
	const findings = runAntiPatternRules(sources);
	const hasError = findings.some((f) => f.tier === "error");
	if (!hasError) {
		return { status: "pass" };
	}
	return {
		status: "fail",
		findings: findings.map((f) => `[${f.tier}] ${f.path}:${f.line} ${f.ruleId}: ${f.message}`),
	};
}

// ---------------------------------------------------------------------------
// Injected subprocess runner (typecheck + lint legs)
// ---------------------------------------------------------------------------

/**
 * The injected-runner shape both impure legs take. Production supplies a
 * real subprocess call; tests supply a scripted one, so neither leg ever
 * needs to spawn anything to be exercised. A runner that THROWS (binary
 * missing, spawn failure) degrades the leg to `unavailable`, never `pass` —
 * see {@link runTypecheckLeg} and {@link runLintLeg}.
 */
export type ExecRunner = (cmd: string, args: readonly string[], cwd: string) => { code: number; stdout: string; stderr: string };

function outputLines(result: { stdout: string; stderr: string }): string[] {
	return `${result.stdout}\n${result.stderr}`
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);
}

/**
 * The typecheck leg. Runs `tsc --noEmit` through the injected `exec`.
 * Non-zero exit -> `fail`, carrying the compiler's own output lines.
 * `exec` throwing (the `tsc` binary missing) -> `unavailable`, NEVER `pass`
 * — a leg that could not run must never be reported as clean.
 *
 * CR-01/CR-02: `exec` is called with the bare command name `"tsc"`, never
 * `"npx"` — the production `ExecRunner` (`quality/index.ts#productionExec`)
 * resolves this to the LOCAL, pinned `<cwd>/node_modules/.bin/tsc`, never the
 * `npx` shim. `npx` is `npx.cmd` on Windows, which Node cannot spawn without
 * a shell (ENOENT, verified on this machine); and on any platform where
 * `npx` IS spawnable, an `npx <pkg>` with no local install downloads and
 * runs an UNPINNED package from the registry. Neither failure mode is
 * reachable once the runner never names `npx` at all.
 */
export function runTypecheckLeg(cwd: string, exec: ExecRunner): LegStatus {
	let result: { code: number; stdout: string; stderr: string };
	try {
		result = exec("tsc", ["--noEmit"], cwd);
	} catch (err) {
		return {
			status: "unavailable",
			reason: `tsc could not be run: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
	if (result.code !== 0) {
		return { status: "fail", findings: outputLines(result) };
	}
	return { status: "pass" };
}

/**
 * The set of "lint" gates in this repository — its own authored structural
 * vitest suites, per `08-CONTEXT.md`'s stated equivalence: there is no
 * ESLint here by design, and none is to be added
 * (`tests/unit/pinning.test.ts:253` fixes `devDependencies` at exactly six
 * audited pins; a linter package is a build failure, not a code-review
 * note). Named as an exported constant so the set this leg actually runs is
 * visible and reviewable, not buried inside a shelled-out vitest invocation.
 */
export const LINT_GATE_FILES = [
	"tests/unit/chokepoint-lint.test.ts",
	"tests/unit/contributing-boundary.test.ts",
	"tests/unit/jsonl-append-only.test.ts",
	"tests/unit/extension-layout.test.ts",
	"tests/unit/pinning.test.ts",
	"tests/unit/gitignore-policy.test.ts",
	"tests/unit/docs-policy.test.ts",
	"tests/unit/npmrc-policy.test.ts",
	"tests/unit/secret-scan.test.ts",
	"tests/unit/ci-pinning.test.ts",
	"tests/unit/lf-and-shell.test.ts",
	"tests/unit/evasion-corpus.test.ts",
] as const;

/**
 * The lint leg. Runs `vitest run` over {@link LINT_GATE_FILES} through the
 * same injected-runner shape {@link runTypecheckLeg} uses -- see that
 * function's own docstring for why `exec` is called with the bare command
 * name `"vitest"`, never `"npx"`. Non-zero exit -> `fail`, carrying vitest's
 * own output lines. `exec` throwing -> `unavailable`, never `pass` -- this
 * is also how CR-02's secondary bug degrades: {@link LINT_GATE_FILES} names
 * THIS repository's own structural test paths, so `productionExec` throws
 * (rather than letting vitest report a false FAIL against paths it cannot
 * find) when `cwd` is not this repository.
 */
export function runLintLeg(cwd: string, exec: ExecRunner): LegStatus {
	let result: { code: number; stdout: string; stderr: string };
	try {
		result = exec("vitest", ["run", ...LINT_GATE_FILES], cwd);
	} catch (err) {
		return {
			status: "unavailable",
			reason: `the structural lint suite could not be run: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
	if (result.code !== 0) {
		return { status: "fail", findings: outputLines(result) };
	}
	return { status: "pass" };
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

function renderLeg(legId: LegId, leg: LegStatus): string {
	if (leg.status === "pass") {
		return `${legId}: PASS`;
	}
	if (leg.status === "unavailable") {
		return `${legId}: UNAVAILABLE (${leg.reason})`;
	}
	return `${legId}: FAIL (${leg.findings.length} finding${leg.findings.length === 1 ? "" : "s"})\n` +
		leg.findings.map((f) => `  - ${f}`).join("\n");
}

/**
 * Run all four legs and produce the stage verdict.
 *
 * BINDING ORDER: `typecheck -> lint -> lsp -> anti-pattern`, matching
 * {@link GATE_LEGS}. The order is binding, not incidental — the cheapest,
 * most certain signals (a type error, a broken structural invariant) are
 * reported first, ahead of the newer and comparatively more expensive
 * anti-pattern sweep, and the WHOLE stage runs and reports before any model
 * review ever starts. Each leg's wall-clock is measured independently via
 * `process.hrtime.bigint()`; {@link addQualityCost} is called exactly ONCE,
 * at the end, with the summed total — never per leg, which would let a
 * caller that retries one leg silently double-count it.
 */
export function runDeterministicGates(input: {
	readonly sources: readonly QualitySource[];
	readonly registeredToolNames: readonly string[];
	readonly cwd: string;
	readonly exec: ExecRunner;
}): GateResult {
	const elapsedMsByLeg = {} as Record<LegId, number>;
	const legs = {} as Record<LegId, LegStatus>;

	for (const legId of GATE_LEGS) {
		const start = process.hrtime.bigint();
		let result: LegStatus;
		switch (legId) {
			case "typecheck":
				result = runTypecheckLeg(input.cwd, input.exec);
				break;
			case "lint":
				result = runLintLeg(input.cwd, input.exec);
				break;
			case "lsp":
				result = probeLspAvailability(input.registeredToolNames);
				break;
			case "anti-pattern":
				result = runAntiPatternLeg(input.sources);
				break;
		}
		const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
		elapsedMsByLeg[legId] = elapsedMs;
		legs[legId] = result;
	}

	const blocking = GATE_LEGS.some((legId) => legs[legId].status === "fail");
	const totalMs = GATE_LEGS.reduce((sum, legId) => sum + elapsedMsByLeg[legId], 0);
	const report = GATE_LEGS.map((legId) => renderLeg(legId, legs[legId])).join("\n");

	addQualityCost({ ms: totalMs });

	return { legs, blocking, elapsedMsByLeg, totalMs, report };
}

// ---------------------------------------------------------------------------
// QUAL-07: the design-review predicate
// ---------------------------------------------------------------------------

/**
 * The file-span threshold past which a diff is treated as wide enough, on
 * its own, to warrant a design-level pass. A deliberately chosen but
 * currently untuned threshold — Phase 9 (QUAL-08) owns dialing gate depth
 * against real usage; this plan only needs a NAMED constant, not a bare
 * literal, so that future tuning is a one-line, reviewable change rather than
 * a hunt through this module's body.
 */
export const DESIGN_REVIEW_FILE_SPAN = 8;

/**
 * What a caller declares about the current task, before deciding whether to
 * run the design-level review pass. Every field is a plain fact the caller
 * already has to hand — this module computes nothing about the diff itself.
 */
export interface DesignReviewSignals {
	readonly filesTouched: number;
	readonly loopWrapsQuery: boolean;
	readonly dataModelChanged: boolean;
	readonly publicInterfaceChanged: boolean;
	readonly escalateRequested: boolean;
}

/**
 * QUAL-07's predicate: whether the design-level review pass should fire for
 * this task.
 *
 * `true` iff `escalateRequested`, or `filesTouched >= DESIGN_REVIEW_FILE_SPAN`,
 * or any of the three structural signals (`loopWrapsQuery`,
 * `dataModelChanged`, `publicInterfaceChanged`). `false` for an ordinary task
 * that trips none of these — QUAL-07's own text is explicit that this pass
 * must NOT fire on every task, and an all-false `DesignReviewSignals` is
 * exactly the case that proves this predicate keeps that promise.
 *
 * This function decides IF the pass runs. It never runs it — no model call,
 * no I/O, nothing but a boolean expression over its argument.
 */
export function shouldRunDesignReview(signals: DesignReviewSignals): boolean {
	return (
		signals.escalateRequested ||
		signals.filesTouched >= DESIGN_REVIEW_FILE_SPAN ||
		signals.loopWrapsQuery ||
		signals.dataModelChanged ||
		signals.publicInterfaceChanged
	);
}

// ---------------------------------------------------------------------------
// QUAL-08: gate depth scales with the workflow -- a pure selector, the same
// family as shouldRunDesignReview above.
// ---------------------------------------------------------------------------

/**
 * The four quality mechanisms Phase 8 built, named by the function that
 * implements each one so a reader can follow an id straight to the code.
 * Exactly four entries -- see `tests/unit/gate-depth-selector.test.ts`.
 */
export const QUALITY_MECHANISMS = [
	{ id: "deterministic", implementedBy: "runDeterministicGates (gates.ts)" },
	{ id: "model-review", implementedBy: "runReview + validateReview (reviewer.ts, review-schema.ts)" },
	{ id: "refute-or-promote", implementedBy: "runBoundedReviewLoop (verdict.ts)" },
	{ id: "calibration", implementedBy: "scoreCalibration (calibration.ts)" },
] as const;

export type MechanismId = (typeof QUALITY_MECHANISMS)[number]["id"];

/** The five workflow names gate depth is dialled over -- the sole source of {@link WorkflowId}. */
export const WORKFLOW_IDS = ["quick", "grill", "plan", "execute", "review"] as const;

export type WorkflowId = (typeof WORKFLOW_IDS)[number];

/** One workflow's gate depth: the SET of mechanisms it runs -- not a numeric level, which would make "which mechanisms" implicit and untestable. */
export interface GateDepth {
	readonly mechanisms: readonly MechanismId[];
}

const DETERMINISTIC_ONLY: readonly MechanismId[] = Object.freeze(["deterministic"]);
const ALL_MECHANISMS: readonly MechanismId[] = Object.freeze(QUALITY_MECHANISMS.map((m) => m.id));

/**
 * QUAL-08's dial. `quick` runs the deterministic leg only -- exactly what
 * `runQuickGateStage` (quality/index.ts) already calls, and this table must
 * AGREE with that reality or one of them is wrong. Every ceremonial workflow
 * (`grill`, `plan`, `execute`, `review`) runs all four mechanisms.
 *
 * Typed `Record<WorkflowId, ...>`, never `Partial<...>` -- a missing key is
 * a COMPILE error, not a silent runtime default. Frozen, like {@link
 * GATE_LEGS} and {@link QUALITY_MECHANISMS} above.
 */
export const GATE_DEPTH_BY_WORKFLOW: Readonly<Record<WorkflowId, readonly MechanismId[]>> = Object.freeze({
	quick: DETERMINISTIC_ONLY,
	grill: ALL_MECHANISMS,
	plan: ALL_MECHANISMS,
	execute: ALL_MECHANISMS,
	review: ALL_MECHANISMS,
});

/**
 * QUAL-08's predicate: which mechanisms should run for `workflow`. Mirrors
 * {@link shouldRunDesignReview}'s own closing discipline: this function
 * decides WHICH mechanisms run; it never runs one -- no model call, no I/O,
 * nothing but a table lookup.
 */
export function gateDepthFor(workflow: WorkflowId): GateDepth {
	return { mechanisms: GATE_DEPTH_BY_WORKFLOW[workflow] };
}
