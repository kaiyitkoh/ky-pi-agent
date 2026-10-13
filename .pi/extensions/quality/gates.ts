/**
 * Deterministic gate legs (typecheck, lint, LSP, anti-pattern) and the gate-depth table.
 * Each leg is pass, fail or unavailable; unavailable is never a pass. No model access, no tool registration.
 * The design-review predicate and the LSP decision: docs/QUALITY.md.
 */
import { runAntiPatternRules, type QualitySource } from "./rules.ts";

/** Three arms, not a boolean: "did not run" must not collapse into pass or fail. */
export type LegStatus =
	| { readonly status: "pass" }
	| { readonly status: "fail"; readonly findings: readonly string[] }
	| { readonly status: "unavailable"; readonly reason: string };

/** The four legs, in binding evaluation order. */
export const GATE_LEGS = ["typecheck", "lint", "lsp", "anti-pattern"] as const;

export type LegId = (typeof GATE_LEGS)[number];

/** Tool names `@narumitw/pi-lsp` registers (`src/pi-lsp.ts`); both must be present. */
const LSP_TOOL_NAMES = ["lsp_diagnostics", "lsp_fix"] as const;

/**
 * Always unavailable: a command or event context has no `executeTool`, so the gate cannot run `lsp_diagnostics`.
 * Reads the live tool list, never `.pi/settings.json`, so the reason says whether the tools are loaded.
 */
export function probeLspAvailability(registeredToolNames: readonly string[]): Extract<LegStatus, { status: "unavailable" }> {
	const missing = LSP_TOOL_NAMES.filter((name) => !registeredToolNames.includes(name));
	if (missing.length > 0) {
		return {
			status: "unavailable",
			reason: `missing tool${missing.length > 1 ? "s" : ""} ${missing.join(", ")}: @narumitw/pi-lsp is not installed here (see docs/RUNBOOK.md)`,
		};
	}
	return {
		status: "unavailable",
		reason:
			"lsp_diagnostics is registered but not run by the gate: only a tool context has executeTool " +
			"(pi-coding-agent dist/core/extensions/types.d.ts:262-280)",
	};
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

/** Non-empty output lines, trimmed of trailing whitespace. */
export function outputLines(result: { stdout: string; stderr: string }): string[] {
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

/**
 * The quality mechanisms, named by the functions that implement each. `production: false` marks a mechanism
 * that scores fixtures offline and runs in no workflow.
 */
export const QUALITY_MECHANISMS = [
	{ id: "deterministic", implementedBy: "runChangeGateStage (quality/index.ts)", functions: ["runChangeGateStage"], production: true },
	{ id: "model-review", implementedBy: "runReview (reviewer.ts)", functions: ["runReview"], production: true },
	{ id: "refute-or-promote", implementedBy: "runRefuteOrPromote (verdict.ts)", functions: ["runRefuteOrPromote"], production: true },
	{ id: "calibration", implementedBy: "scoreCalibration (calibration.ts); offline only", functions: ["scoreCalibration"], production: false },
] as const;

export type MechanismId = (typeof QUALITY_MECHANISMS)[number]["id"];

/** Workflow names gate depth is dialled over; sole source of {@link WorkflowId}. */
export const WORKFLOW_IDS = ["quick", "grill", "plan", "execute", "review"] as const;

export type WorkflowId = (typeof WORKFLOW_IDS)[number];

/** One workflow's gate depth as a set of mechanisms, so "which mechanisms" is explicit and testable. */
export interface GateDepth {
	readonly mechanisms: readonly MechanismId[];
}

const NONE: readonly MechanismId[] = Object.freeze([]);
const DETERMINISTIC_ONLY: readonly MechanismId[] = Object.freeze(["deterministic"]);
const REVIEW_DEPTH: readonly MechanismId[] = Object.freeze(["deterministic", "model-review", "refute-or-promote"]);

/**
 * Mechanisms each workflow runs in production. `grill` and `plan` author documents and run no gate.
 * `Record`, not `Partial`: a missing key is a compile error.
 */
export const GATE_DEPTH_BY_WORKFLOW: Readonly<Record<WorkflowId, readonly MechanismId[]>> = Object.freeze({
	quick: DETERMINISTIC_ONLY,
	grill: NONE,
	plan: NONE,
	execute: DETERMINISTIC_ONLY,
	review: REVIEW_DEPTH,
});

/** Which mechanisms run for `workflow`: a table lookup, never a run. */
export function gateDepthFor(workflow: WorkflowId): GateDepth {
	return { mechanisms: GATE_DEPTH_BY_WORKFLOW[workflow] };
}
