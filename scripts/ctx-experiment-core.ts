/**
 * Pure core of a controlled minimal-vs-full harness experiment: run plan, scoring, interval and decision rule.
 * The constants are pre-registered, so changing the rule after seeing data must show up as a test edit.
 * No model call and no I/O; the CLI that spends tokens lives elsewhere.
 */

/** A drop in catch rate at least this large (absolute, 0..1) counts as degradation. */
export const DEGRADE_POINTS = 0.15;

/** Two-sided 90% normal quantile for the difference interval. */
export const Z_90 = 1.6449;

/** Prose-tool-call messages per assistant message at or above this make prose the leading explanation. */
export const PROSE_RATE_THRESHOLD = 0.1;

/** Share of an arm's misses that must fall in prose-tool-call trials to blame prose. */
export const PROSE_CONCENTRATION = 0.5;

/** Below this catch rate an arm is "low", so a null A-vs-F result points at neither arm differing. */
export const LOW_CATCH_RATE = 0.5;

export const FIRST_STAGE_REPEATS = 10;
export const SECOND_STAGE_REPEATS = 20;

export type ArmId = "A" | "B" | "F" | "C";

export interface ArmDefinition {
	readonly id: ArmId;
	readonly name: string;
	readonly purpose: string;
}

export const ARMS: readonly ArmDefinition[] = [
	{ id: "A", name: "minimal", purpose: "Bare Pi with no extensions, skills, context files or prompt templates." },
	{ id: "B", name: "harness-implement", purpose: "The harness as installed, default implement profile." },
	{ id: "F", name: "harness-full", purpose: "The harness with the full tool profile." },
	{ id: "C", name: "padded-minimal", purpose: "Minimal plus inert harness prose, separating token mass from harness behaviour." },
];

export interface PlannedTrial {
	readonly id: string;
	readonly arm: ArmId;
	readonly defect: string;
	readonly repeat: number;
}

/** mulberry32: tiny seeded PRNG so a plan is reproducible without a dependency. */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[out[i], out[j]] = [out[j] as T, out[i] as T];
	}
	return out;
}

/**
 * Every (defect, repeat) block holds all arms contiguously in a seeded order, and blocks are themselves shuffled,
 * so provider drift over the run lands on every arm alike.
 */
export function buildRunPlan(
	seed: number,
	defectIds: readonly string[],
	repeats: number,
	arms: readonly ArmId[],
): PlannedTrial[] {
	const random = mulberry32(seed);
	const blocks: { defect: string; repeat: number }[] = [];
	for (const defect of defectIds) {
		for (let repeat = 0; repeat < repeats; repeat++) {
			blocks.push({ defect, repeat });
		}
	}
	const plan: PlannedTrial[] = [];
	for (const block of shuffled(blocks, random)) {
		for (const arm of shuffled(arms, random)) {
			plan.push({ id: `${block.defect}:r${block.repeat}:${arm}`, arm, defect: block.defect, repeat: block.repeat });
		}
	}
	return plan;
}

export interface Proportion {
	readonly caught: number;
	readonly n: number;
}

/** Wilson score interval for one proportion. */
function wilson(count: number, n: number, z: number): { p: number; lower: number; upper: number } {
	const p = count / n;
	const z2 = z * z;
	const denominator = 1 + z2 / n;
	const centre = (p + z2 / (2 * n)) / denominator;
	const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
	return { p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

/** Newcombe hybrid-score interval for first minus second; closed form, no dependency. */
export function diffInterval(first: Proportion, second: Proportion, z: number): readonly [number, number] {
	const a = wilson(first.caught, first.n, z);
	const b = wilson(second.caught, second.n, z);
	const d = a.p - b.p;
	const lower = d - Math.sqrt((a.p - a.lower) ** 2 + (b.upper - b.p) ** 2);
	const upper = d + Math.sqrt((a.upper - a.p) ** 2 + (b.p - b.lower) ** 2);
	return [lower, upper];
}

export type Decision = "DEGRADES" | "NO_DETECTABLE_EFFECT" | "INCONCLUSIVE";

/** Float slack so a difference of exactly the threshold is not lost to rounding. */
const EPSILON = 1e-9;

/** `first` is the harness arm, `second` the baseline: d = catch(first) - catch(second). */
export function decide(first: Proportion, second: Proportion): Decision {
	if (first.n <= 0 || second.n <= 0) {
		return "INCONCLUSIVE";
	}
	const d = first.caught / first.n - second.caught / second.n;
	const [lower, upper] = diffInterval(first, second, Z_90);
	if (d <= -DEGRADE_POINTS + EPSILON && upper < 0) {
		return "DEGRADES";
	}
	if (lower > -DEGRADE_POINTS) {
		return "NO_DETECTABLE_EFFECT";
	}
	return "INCONCLUSIVE";
}

export interface ArmSummary {
	readonly arm: ArmId;
	readonly trials: number;
	readonly caught: number;
	readonly malformed: number;
	readonly assistantMessages: number;
	readonly proseMessages: number;
	/** Trials with at least one prose tool call. */
	readonly proseTrials: number;
	readonly misses: number;
	readonly missesInProseTrials: number;
	readonly unmatchedFindings: number;
	readonly inputTokens: number;
	readonly cacheReadTokens: number;
}

export type ExperimentSummary = Readonly<Partial<Record<ArmId, ArmSummary>>>;

export type RootCause =
	| "harness-behaviour"
	| "context-pollution"
	| "prose-tool-calls"
	| "provider-misconfiguration"
	| "neither"
	| "inconclusive";

function proportion(summary: ArmSummary): Proportion {
	return { caught: summary.caught, n: summary.trials };
}

function proseBlamed(summary: ArmSummary): boolean {
	const rate = summary.assistantMessages === 0 ? 0 : summary.proseMessages / summary.assistantMessages;
	return (
		rate >= PROSE_RATE_THRESHOLD &&
		summary.misses > 0 &&
		summary.missesInProseTrials / summary.misses >= PROSE_CONCENTRATION
	);
}

/**
 * Maps a summary to the most likely root cause. "Approximately equal" means the lower bound of the difference
 * against baseline stays above -DEGRADE_POINTS. A second-route run of the minimal arm separates provider faults.
 */
export function discriminate(summary: ExperimentSummary, secondRouteMinimal?: ArmSummary): RootCause {
	for (const arm of Object.values(summary)) {
		if (arm !== undefined && proseBlamed(arm)) {
			return "prose-tool-calls";
		}
	}
	const minimal = summary.A;
	const full = summary.F;
	if (minimal === undefined || full === undefined || minimal.trials === 0 || full.trials === 0) {
		return "inconclusive";
	}
	const primary = decide(proportion(full), proportion(minimal));
	if (primary === "DEGRADES") {
		const padded = summary.C;
		if (padded === undefined || padded.trials === 0) {
			return "inconclusive";
		}
		const paddedVsMinimal = decide(proportion(padded), proportion(minimal));
		if (paddedVsMinimal === "NO_DETECTABLE_EFFECT") {
			return "harness-behaviour";
		}
		if (paddedVsMinimal === "DEGRADES") {
			return "context-pollution";
		}
		return "inconclusive";
	}
	if (primary === "NO_DETECTABLE_EFFECT" && minimal.caught / minimal.trials < LOW_CATCH_RATE) {
		if (
			secondRouteMinimal !== undefined &&
			secondRouteMinimal.trials > 0 &&
			decide(proportion(minimal), proportion(secondRouteMinimal)) === "DEGRADES"
		) {
			return "provider-misconfiguration";
		}
		return "neither";
	}
	return "inconclusive";
}
