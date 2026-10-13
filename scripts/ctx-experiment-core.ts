/**
 * Pure core of a controlled minimal-vs-full harness experiment: run plan, scoring, interval and decision rule.
 * The constants are pre-registered, so changing the rule after seeing data must show up as a test edit.
 * No model call and no I/O; the CLI that spends tokens lives elsewhere.
 */
import type { AssistantMessage } from "@earendil-works/pi-ai";

import { scoreCalibration, type SeededDefectExpectation } from "../.pi/extensions/quality/calibration.ts";
import { isProseToolCall } from "../.pi/extensions/diagnostics/prose.ts";
import { validateReview } from "../.pi/extensions/quality/review-schema.ts";
import { applyProfile } from "../.pi/extensions/routing/profiles.ts";
import {
	REVIEWER_SYSTEM_PROMPT,
	buildImportGraph,
	buildReviewerContext,
	type TouchedFile,
} from "../.pi/extensions/quality/reviewer.ts";

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

/**
 * Largest share of an arm's planned trials that may be excluded as infrastructure failures before any comparison using
 * that arm is refused; failures are not arm-neutral (the biggest prompt draws the most rejections).
 */
export const MAX_EXCLUDED_SHARE = 0.05;

/** One look at a fixed R: no second stage and no pooling, because a second look at the same z inflates both error rates. */
export const REPEATS = 10;

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
	/** Scored trials; excluded ones are not in this count. */
	readonly trials: number;
	/** Trials that never produced a usable answer for infrastructure reasons, so they are neither catches nor misses. */
	readonly excluded: number;
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

/** False when too many of the arm's planned trials were excluded for any comparison using it to be trusted. */
export function exclusionsAcceptable(summary: ArmSummary): boolean {
	const planned = summary.trials + summary.excluded;
	return planned > 0 && summary.excluded / planned <= MAX_EXCLUDED_SHARE + EPSILON;
}

/** `decide`, refusing with INCONCLUSIVE when either arm exceeds the exclusion ceiling. */
export function decideArms(first: ArmSummary, second: ArmSummary): Decision {
	if (!exclusionsAcceptable(first) || !exclusionsAcceptable(second)) {
		return "INCONCLUSIVE";
	}
	return decide(proportion(first), proportion(second));
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
	// The prose reading spans every arm, so one arm's self-selected survivors make all of it untrustworthy.
	if (Object.values(summary).some((arm) => arm !== undefined && !exclusionsAcceptable(arm))) {
		return "inconclusive";
	}
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
	const primary = decideArms(full, minimal);
	if (primary === "DEGRADES") {
		const padded = summary.C;
		if (padded === undefined || padded.trials === 0) {
			return "inconclusive";
		}
		const paddedVsMinimal = decideArms(padded, minimal);
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
			decideArms(minimal, secondRouteMinimal) === "DEGRADES"
		) {
			return "provider-misconfiguration";
		}
		return "neither";
	}
	return "inconclusive";
}

/** The one requirement every trial states; the reviewer must give it exactly one verdict. */
export const TRIAL_REQUIREMENT_IDS: readonly string[] = ["R1"];

const TRIAL_REQUIREMENT_TEXT = "The change does what its names and comments claim, with no defect a careful reviewer would block.";

/**
 * Identical in every arm: no tool is needed, so no arm can win by owning a tool another lacks, and the output
 * contract matches the reviewer's submit_review arguments.
 */
export const TRIAL_OUTPUT_INSTRUCTION = [
	"For this task the submit_review tool is not available and you must not call any tool.",
	"Instead, do not call a tool: output your review as exactly one JSON object in a ```json block, with the same",
	"fields as the submit_review arguments (verdicts, findings, checkedAndCleared, classification,",
	"classificationJustification, and properFix/deferralReason when classification is workaround).",
].join(" ");

export interface TrialInput {
	readonly diff: string;
	readonly touchedFiles: readonly TouchedFile[];
}

/** Reviewer prompt plus contract context as one user message; there is deliberately no arm parameter. */
export function buildTrialPrompt(built: TrialInput): string {
	const context = buildReviewerContext({
		diff: built.diff,
		touchedFiles: built.touchedFiles,
		gateReport: "(no deterministic gate output exists for this trial)",
		requirements: TRIAL_REQUIREMENT_IDS.map((id) => ({ id, text: TRIAL_REQUIREMENT_TEXT })),
		filesTouchedUnion: built.touchedFiles.map((f) => f.path),
		importGraph: buildImportGraph(built.touchedFiles.map((f) => ({ path: f.path, text: f.contents }))),
	});
	return `${REVIEWER_SYSTEM_PROMPT}\n\n${context}\n\n${TRIAL_OUTPUT_INSTRUCTION}\n`;
}

/** Live output is untrusted and can be huge; everything past these caps is ignored. */
const MAX_OUTPUT_CHARS = 20_000_000;
const MAX_SCAN_CHARS = 400_000;

export interface ParsedOutput {
	readonly finalText: string;
	readonly assistantMessages: readonly AssistantMessage[];
	readonly usage: { readonly input: number; readonly cacheRead: number } | undefined;
	readonly stopReason: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(message: AssistantMessage): string {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

/** Collects finalized assistant messages from the JSONL stream; blank, non-JSON and truncated lines are skipped. */
export function parseJsonModeOutput(text: string): ParsedOutput {
	const capped = text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) : text;
	const assistantMessages: AssistantMessage[] = [];
	for (const rawLine of capped.split("\n")) {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		if (!line.startsWith("{")) {
			continue;
		}
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(event) || event.type !== "message_end" || !isRecord(event.message)) {
			continue;
		}
		const message = event.message;
		if (message.role === "assistant" && Array.isArray(message.content)) {
			assistantMessages.push(message as unknown as AssistantMessage);
		}
	}
	const last = assistantMessages[assistantMessages.length - 1];
	if (last === undefined) {
		return { finalText: "", assistantMessages, usage: undefined, stopReason: undefined };
	}
	const usage = isRecord(last.usage)
		? { input: Number(last.usage.input) || 0, cacheRead: Number(last.usage.cacheRead) || 0 }
		: undefined;
	return { finalText: textOf(last), assistantMessages, usage, stopReason: last.stopReason };
}

export interface TrialScore {
	readonly caught: boolean;
	readonly malformed: boolean;
	readonly unmatchedFindings: number;
}

const FENCE_OPEN = "```json";
const FENCE_CLOSE = "```";

/** Grades the last json block against `defectId` using the existing grader; unusable output is counted, never thrown. */
export function scoreTrial(
	finalText: string,
	defectId: string,
	expected: readonly SeededDefectExpectation[],
): TrialScore {
	const malformed: TrialScore = { caught: false, malformed: true, unmatchedFindings: 0 };
	const tail = finalText.length > MAX_SCAN_CHARS ? finalText.slice(-MAX_SCAN_CHARS) : finalText;
	const open = tail.lastIndexOf(FENCE_OPEN);
	if (open === -1) {
		return malformed;
	}
	const bodyStart = open + FENCE_OPEN.length;
	const close = tail.indexOf(FENCE_CLOSE, bodyStart);
	if (close === -1) {
		return malformed;
	}
	let raw: unknown;
	try {
		raw = JSON.parse(tail.slice(bodyStart, close));
	} catch {
		return malformed;
	}
	const validation = validateReview(raw, TRIAL_REQUIREMENT_IDS);
	if (!validation.ok) {
		return malformed;
	}
	const result = scoreCalibration(expected, validation.review.findings);
	return {
		caught: result.perDefectClass[defectId] === true,
		malformed: false,
		unmatchedFindings: result.unmatchedFindings,
	};
}

export interface ScoredTrial {
	readonly arm: ArmId;
	readonly defect: string;
	readonly repeat: number;
	readonly score: TrialScore;
	readonly output: ParsedOutput;
	/** Set by `isInfrastructureFailure`; an excluded trial counts only toward `excluded`. */
	readonly excluded?: boolean;
}

/** A trial whose process failed, or whose run ended with no answer from the model, measures the infrastructure. */
export function isInfrastructureFailure(output: ParsedOutput, exitStatus: number | undefined): boolean {
	if (exitStatus !== undefined && exitStatus !== 0) {
		return true;
	}
	if (output.assistantMessages.length === 0) {
		return true;
	}
	return output.stopReason === "error" || output.stopReason === "aborted";
}

type MutableArmSummary = { -readonly [K in keyof ArmSummary]: ArmSummary[K] };

/** Per-arm aggregates; an arm with no trials is absent. Prose is judged against that arm's own active tools. */
export function summarise(
	trials: readonly ScoredTrial[],
	activeToolsByArm: Readonly<Record<ArmId, readonly string[]>>,
): ExperimentSummary {
	const totals = new Map<ArmId, MutableArmSummary>();
	for (const trial of trials) {
		const tools = activeToolsByArm[trial.arm];
		const proseCount = trial.output.assistantMessages.filter((m) => isProseToolCall(m, tools)).length;
		const row: MutableArmSummary = totals.get(trial.arm) ?? {
			arm: trial.arm,
			trials: 0,
			excluded: 0,
			caught: 0,
			malformed: 0,
			assistantMessages: 0,
			proseMessages: 0,
			proseTrials: 0,
			misses: 0,
			missesInProseTrials: 0,
			unmatchedFindings: 0,
			inputTokens: 0,
			cacheReadTokens: 0,
		};
		if (trial.excluded === true) {
			row.excluded += 1;
			totals.set(trial.arm, row);
			continue;
		}
		row.trials += 1;
		row.caught += trial.score.caught ? 1 : 0;
		row.malformed += trial.score.malformed ? 1 : 0;
		row.assistantMessages += trial.output.assistantMessages.length;
		row.proseMessages += proseCount;
		row.proseTrials += proseCount > 0 ? 1 : 0;
		if (!trial.score.caught) {
			row.misses += 1;
			row.missesInProseTrials += proseCount > 0 ? 1 : 0;
		}
		row.unmatchedFindings += trial.score.unmatchedFindings;
		row.inputTokens += trial.output.usage?.input ?? 0;
		row.cacheReadTokens += trial.output.usage?.cacheRead ?? 0;
		totals.set(trial.arm, row);
	}
	return Object.fromEntries(totals) as ExperimentSummary;
}

/** The full harness's declared tools; a test re-measures them against the composed harness. */
export const FULL_ARM_TOOLS: readonly string[] = [
	"read",
	"bash",
	"edit",
	"write",
	"approve_ky_command",
	"consult_advisor",
	"todo",
	"questionnaire",
	"bg_run",
	"bg_status",
	"bg_logs",
	"bg_kill",
];

/** The tools an arm declares, so a prose tool call is judged against what that arm actually offers. */
export function armActiveTools(arm: ArmId): readonly string[] {
	switch (arm) {
		case "A":
		case "C":
			return MINIMAL_TOOLS;
		case "B":
			return applyProfile(FULL_ARM_TOOLS, "implement") ?? FULL_ARM_TOOLS;
		case "F":
			return FULL_ARM_TOOLS;
	}
}

/** Flags common to every arm: one-shot JSON events on stdout. */
const COMMON_FLAGS = ["--mode", "json", "-p"] as const;

const MINIMAL_TOOLS: readonly string[] = ["read", "bash", "edit", "write"];

const MINIMAL_FLAGS = ["-ne", "-ns", "-nc", "-np", "--tools", MINIMAL_TOOLS.join(",")] as const;

/** CLI flags (before the prompt) for one arm. The padded arm needs the path of its filler file. */
export function armArgs(arm: ArmId, options: { readonly padFile?: string }): string[] {
	switch (arm) {
		case "A":
			return [...COMMON_FLAGS, ...MINIMAL_FLAGS];
		case "C":
			if (options.padFile === undefined) {
				throw new Error("armArgs: the padded-minimal arm needs a padFile");
			}
			return [...COMMON_FLAGS, ...MINIMAL_FLAGS, "--append-system-prompt", options.padFile];
		case "B":
			return [...COMMON_FLAGS, "--ky-profile", "implement"];
		case "F":
			return [...COMMON_FLAGS, "--ky-profile", "full"];
	}
}

/** Exactly `targetChars` characters cycled from the caller's own repo prose, so the filler is real and deterministic. */
export function padFileText(targetChars: number, sources: readonly string[]): string {
	const usable = sources.filter((s) => s.length > 0);
	if (usable.length === 0) {
		throw new Error("padFileText: at least one non-empty source is required");
	}
	const cycle = `${usable.join("\n\n")}\n\n`;
	let out = "";
	while (out.length < targetChars) {
		out += cycle;
	}
	return out.slice(0, targetChars);
}

/**
 * Measured full-harness floor minus bare floor in estimated tokens, without AGENTS.md because arm F runs in a fresh repo
 * that has none; a test re-measures it against the composed harness.
 */
export const PAD_TOKENS = 2465;
