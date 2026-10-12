/**
 * Deterministic gate stage: typecheck, lint, LSP and anti-pattern legs run before any model review.
 * Each leg is pass, fail or unavailable; unavailable is never a pass. No model access, no tool registration.
 * Why the LSP leg reads live tool names and not settings, and the design-review predicate: docs/QUALITY.md.
 */
import { addQualityCost } from "../diagnostics/quality-cost.ts";
import { runAntiPatternRules, type QualitySource } from "./rules.ts";

/** Three arms, not a boolean: "did not run" must not collapse into pass or fail. */
export type LegStatus =
	| { readonly status: "pass" }
	| { readonly status: "fail"; readonly findings: readonly string[] }
	| { readonly status: "unavailable"; readonly reason: string };

/** The four legs, in binding evaluation order. */
export const GATE_LEGS = ["typecheck", "lint", "lsp", "anti-pattern"] as const;

export type LegId = (typeof GATE_LEGS)[number];

/**
 * Blocking iff any leg is `fail`. An `unavailable` leg never blocks but must appear in `report`.
 */
export interface GateResult {
	readonly legs: Readonly<Record<LegId, LegStatus>>;
	readonly blocking: boolean;
	readonly elapsedMsByLeg: Readonly<Record<LegId, number>>;
	readonly totalMs: number;
	readonly report: string;
}

/** Tool names `@narumitw/pi-lsp` registers (`src/pi-lsp.ts`); both must be present. */
const LSP_TOOL_NAMES = ["lsp_diagnostics", "lsp_fix"] as const;

/**
 * Requires both {@link LSP_TOOL_NAMES} in the live tool list and names the missing ones.
 * Never reads `.pi/settings.json`: it lists what is configured, not what is loaded.
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

/**
 * Fails only on an error-tier finding; warnings alone pass. A failing leg carries all findings, each tier-tagged.
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

/** Injected subprocess runner; a runner that throws degrades its leg to `unavailable`. */
export type ExecRunner = (cmd: string, args: readonly string[], cwd: string) => { code: number; stdout: string; stderr: string };

function outputLines(result: { stdout: string; stderr: string }): string[] {
	return `${result.stdout}\n${result.stderr}`
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);
}

/**
 * Runs `tsc --noEmit` through `exec` with the bare name "tsc", never `npx`: `npx` is `npx.cmd` on
 * Windows (unspawnable without a shell) and an unpinned `npx <pkg>` downloads from the registry.
 * `exec` throwing -> `unavailable`, never `pass`.
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
 * The repository's structural vitest suites (the lint equivalent; no ESLint by design,
 * pinning.test.ts "declares no dev dependency beyond the audited pins").
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
 * Runs vitest over {@link LINT_GATE_FILES}; same bare-command rule as {@link runTypecheckLeg}.
 * `exec` throwing -> `unavailable`, which is how a foreign `cwd` degrades (the paths name this repo's tests).
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
 * Runs all four legs in {@link GATE_LEGS} order (cheapest, most certain signals first).
 * {@link addQualityCost} is called once with the summed total, so a retried leg cannot double-count.
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

/** File-span threshold at which a diff alone warrants a design-level pass; untuned. */
export const DESIGN_REVIEW_FILE_SPAN = 8;

/** Plain facts the caller already has; nothing here is computed from the diff. */
export interface DesignReviewSignals {
	readonly filesTouched: number;
	readonly loopWrapsQuery: boolean;
	readonly dataModelChanged: boolean;
	readonly publicInterfaceChanged: boolean;
	readonly escalateRequested: boolean;
}

/**
 * Whether the design-level review pass should fire. Pure boolean over the signals; false for an
 * ordinary task, because the pass must not run on every task.
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

/** The quality mechanisms, named by the function that implements each. */
export const QUALITY_MECHANISMS = [
	{ id: "deterministic", implementedBy: "runDeterministicGates (gates.ts)" },
	{ id: "model-review", implementedBy: "runReview + validateReview (reviewer.ts, review-schema.ts)" },
	{ id: "refute-or-promote", implementedBy: "runBoundedReviewLoop (verdict.ts)" },
	{ id: "calibration", implementedBy: "scoreCalibration (calibration.ts)" },
] as const;

export type MechanismId = (typeof QUALITY_MECHANISMS)[number]["id"];

/** Workflow names gate depth is dialled over; sole source of {@link WorkflowId}. */
export const WORKFLOW_IDS = ["quick", "grill", "plan", "execute", "review"] as const;

export type WorkflowId = (typeof WORKFLOW_IDS)[number];

/** One workflow's gate depth as a set of mechanisms, so "which mechanisms" is explicit and testable. */
export interface GateDepth {
	readonly mechanisms: readonly MechanismId[];
}

const DETERMINISTIC_ONLY: readonly MechanismId[] = Object.freeze(["deterministic"]);
const ALL_MECHANISMS: readonly MechanismId[] = Object.freeze(QUALITY_MECHANISMS.map((m) => m.id));

/**
 * Mechanisms by workflow. `quick` runs the deterministic leg only, matching `runQuickGateStage`
 * (quality/index.ts). `Record`, not `Partial`: a missing key is a compile error.
 */
export const GATE_DEPTH_BY_WORKFLOW: Readonly<Record<WorkflowId, readonly MechanismId[]>> = Object.freeze({
	quick: DETERMINISTIC_ONLY,
	grill: ALL_MECHANISMS,
	plan: ALL_MECHANISMS,
	execute: ALL_MECHANISMS,
	review: ALL_MECHANISMS,
});

/** Which mechanisms run for `workflow`: a table lookup, never a run. */
export function gateDepthFor(workflow: WorkflowId): GateDepth {
	return { mechanisms: GATE_DEPTH_BY_WORKFLOW[workflow] };
}
