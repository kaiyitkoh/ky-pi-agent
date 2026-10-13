/**
 * Refute-or-promote over BLOCKERs, then the pure stop predicate; an unparseable refutation counts as UPHELD, never a deletion.
 * Models are reached only via runSingleShotRole, and the raw-source lints hold this file to that.
 */
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { ReviewArtifact, ReviewFinding } from "./review-schema.ts";
import { buildReviewerContext, type ReviewerContractInput } from "./reviewer.ts";
import { callRole, toolCallNamed } from "./role-call.ts";

/** Two arms; `needsApproval` separates a classification stop (someone must sign off) from a BLOCKER stop. */
export type WorkflowStop =
	| { readonly stop: false }
	| { readonly stop: true; readonly reason: string; readonly needsApproval: boolean };

/**
 * First match wins; expects a review already through runRefuteOrPromote.
 *   (1) any surviving BLOCKER -> stop without approval, first, so no classification can make a BLOCKER approvable.
 *   (2) symptomatic -> stop with needsApproval, even with zero findings (the change's nature is the problem).
 *   (3) workaround -> stop with needsApproval, quoting properFix and deferralReason so the debt is in the message.
 *   (4) any Partial or Missing requirement verdict -> stop with needsApproval, naming each requirement.
 *   (5) otherwise no stop; WARNING and NIT never stop.
 */
export function decideWorkflowStop(review: ReviewArtifact): WorkflowStop {
	const survivingBlockers = review.findings.filter((finding) => finding.severity === "BLOCKER");
	if (survivingBlockers.length > 0) {
		const names = survivingBlockers.map((b) => `${b.location}: ${b.concreteFailure}`).join("; ");
		const label = review.classification === "root-cause" ? "" : ` (the change is also classified "${review.classification}")`;
		return {
			stop: true,
			needsApproval: false,
			reason: `${survivingBlockers.length} BLOCKER finding(s) survived refutation -- ${names}${label}`,
		};
	}

	if (review.classification === "symptomatic") {
		return {
			stop: true,
			needsApproval: true,
			reason: `this change is classified "symptomatic" -- ${review.classificationJustification}`,
		};
	}

	if (review.classification === "workaround") {
		return {
			stop: true,
			needsApproval: true,
			reason:
				`this change is classified "workaround" -- ${review.classificationJustification}. ` +
				`Proper fix: ${review.properFix ?? ""}. Deferred because: ${review.deferralReason ?? ""}.`,
		};
	}

	const unmet = review.verdicts.filter((verdict) => verdict.status !== "Implemented");
	if (unmet.length > 0) {
		return {
			stop: true,
			needsApproval: true,
			reason: `requirement(s) not fully implemented -- ${unmet.map((v) => `${v.requirementId}: ${v.status} (${v.evidence})`).join("; ")}`,
		};
	}

	return { stop: false };
}

function normaliseFinding(finding: ReviewFinding): string {
	return `${finding.severity}|${finding.location}|${finding.concreteFailure}`;
}

/** Order-independent comparison of severity|location|concreteFailure; a stall means a fix-then-re-review cycle changed nothing. */
export function detectStall(previous: readonly ReviewFinding[], current: readonly ReviewFinding[]): boolean {
	const previousKeys = new Set(previous.map(normaliseFinding));
	const currentKeys = new Set(current.map(normaliseFinding));
	return previous.length === current.length && previousKeys.size === currentKeys.size && [...previousKeys].every((k) => currentKeys.has(k));
}

/** Two is the smallest bound where both "fixed on the first try" and "genuinely stuck" can be observed. */
export const MAX_REVIEW_ITERATIONS = 2;

const REFUTE_FINDING_TOOL_NAME = "refute_finding";

const REFUTE_FINDING_DESCRIPTION =
	"Report the outcome of your attempt to refute your own prior BLOCKER finding. This is the ONLY way to " +
	'report your outcome; any prose you write outside this call is discarded. "outcome":"withdrawn" only if ' +
	'you genuinely no longer believe the finding holds, after a real attempt to disprove it. "outcome":"upheld" ' +
	"otherwise, including when you are unsure -- an unsure refutation must uphold, never withdraw, so a genuine " +
	"BLOCKER is never silently deleted by a shrug. Always state your rationale, whichever outcome you report.";

const refuteFindingParameters = Type.Object({
	outcome: StringEnum(["upheld", "withdrawn"], {
		description: 'Your honest outcome: "upheld" if the finding still stands, "withdrawn" if it does not.',
	}),
	rationale: Type.String({
		description: "Why you reached this outcome, stated plainly.",
	}),
});

/** One BLOCKER whose refutation pass genuinely withdrew it, and why. */
export interface WithdrawnFinding {
	readonly finding: ReviewFinding;
	readonly rationale: string;
}

/** What {@link runRefuteOrPromote} hands back — never a boolean, never a mutated `findings` array in place. */
export interface RefuteOrPromoteResult {
	/** BLOCKERs that survived their refutation pass. */
	readonly promoted: readonly ReviewFinding[];
	readonly withdrawn: readonly WithdrawnFinding[];
}

const REFUTATION_SYSTEM_PROMPT =
	"You are the SAME adversarial code reviewer, now asked to attempt to refute one specific BLOCKER finding " +
	"you reported. Try genuinely: read the finding and the context again and decide honestly whether it still " +
	"holds. Do not withdraw a finding merely to be agreeable, and do not uphold one merely to look thorough -- " +
	"both are the same soft-failure your own reviewing instructions already name, applied one level deeper. " +
	`Call ${REFUTE_FINDING_TOOL_NAME} exactly once with your honest outcome and rationale.`;

function buildRefutationMessage(finding: ReviewFinding, context: string): string {
	return [
		"You previously reported the following BLOCKER finding in a code review:",
		"",
		`- Location: ${finding.location}`,
		`- Concrete failure: ${finding.concreteFailure}`,
		`- Suggested fix: ${finding.suggestedFix}`,
		"",
		`Attempt to REFUTE this finding using the SAME context you were given originally, reproduced below. ` +
			`Then call ${REFUTE_FINDING_TOOL_NAME} exactly once with your honest outcome.`,
		"",
		"# Context (unchanged from the original review)",
		"",
		context,
	].join("\n");
}

/**
 * One nested reviewer pass per BLOCKER (never WARNING or NIT, never a second pass on one finding).
 * Fail-safe: no refute_finding call, or an outcome other than upheld/withdrawn, counts as UPHELD.
 * Each pass is reported via addQualityCost.
 */
export async function runRefuteOrPromote(
	ctx: ExtensionContext,
	review: ReviewArtifact,
	contract: ReviewerContractInput,
): Promise<RefuteOrPromoteResult> {
	const blockers = review.findings.filter((finding) => finding.severity === "BLOCKER");
	const promoted: ReviewFinding[] = [];
	const withdrawn: WithdrawnFinding[] = [];
	if (blockers.length === 0) return { promoted, withdrawn };

	const context = buildReviewerContext(contract);
	const tools = [{ name: REFUTE_FINDING_TOOL_NAME, description: REFUTE_FINDING_DESCRIPTION, parameters: refuteFindingParameters }];
	for (const finding of blockers) {
		const message = await callRole(ctx, {
			role: "reviewer",
			systemPrompt: REFUTATION_SYSTEM_PROMPT,
			messages: [{ role: "user", content: buildRefutationMessage(finding, context), timestamp: Date.now() }],
			tools,
		});
		const args = toolCallNamed(message, REFUTE_FINDING_TOOL_NAME)?.arguments as Record<string, unknown> | undefined;
		// Fail-safe: anything but an explicit "withdrawn" stays upheld.
		if (args?.outcome === "withdrawn") withdrawn.push({ finding, rationale: typeof args.rationale === "string" ? args.rationale : "" });
		else promoted.push(finding);
	}
	return { promoted, withdrawn };
}

/** `review` is caller-supplied so this module never needs to know how a review is produced. */
export interface RunBoundedReviewLoopOptions {
	readonly review: () => Promise<ReviewArtifact>;
	readonly contract: ReviewerContractInput;
}

/** One withdrawn BLOCKER, tagged with the iteration it was withdrawn on. */
export interface IterationWithdrawal extends WithdrawnFinding {
	readonly iteration: number;
}

/**
 * Every arm carries the iteration count, the final post-refutation review and all withdrawals.
 *   - "clean": no stop.
 *   - "approval-required": a classification stop; can occur on the first iteration.
 *   - "blocked": MAX_REVIEW_ITERATIONS reached with BLOCKERs still surviving and changing.
 *   - "stalled": two consecutive iterations kept an identical surviving BLOCKER set (detectStall).
 */
export type BoundedReviewLoopResult = {
	readonly iterations: number;
	readonly review: ReviewArtifact;
	readonly withdrawn: readonly IterationWithdrawal[];
} & ({ readonly outcome: "clean" } | { readonly outcome: "approval-required" | "blocked" | "stalled"; readonly stop: WorkflowStop });

/** Build the post-refutation review: non-BLOCKER findings unchanged, BLOCKER findings replaced with only what survived. */
function reviewAfterRefutation(review: ReviewArtifact, promoted: readonly ReviewFinding[]): ReviewArtifact {
	const nonBlockers = review.findings.filter((finding) => finding.severity !== "BLOCKER");
	return { ...review, findings: [...nonBlockers, ...promoted] };
}

/**
 * Review, refute-or-promote, then decide the stop on the post-refutation review, never the raw output.
 * A classification stop returns immediately; a BLOCKER stop is a stall if identical to the previous iteration's, else re-reviews until MAX_REVIEW_ITERATIONS.
 * opts.review() runs at most MAX_REVIEW_ITERATIONS times, bounding total nested calls.
 */
export async function runBoundedReviewLoop(
	ctx: ExtensionContext,
	opts: RunBoundedReviewLoopOptions,
): Promise<BoundedReviewLoopResult> {
	let previousPromoted: readonly ReviewFinding[] | undefined;
	const allWithdrawn: IterationWithdrawal[] = [];
	for (let iteration = 1; ; iteration++) {
		const raw = await opts.review();
		const { promoted, withdrawn } = await runRefuteOrPromote(ctx, raw, opts.contract);
		allWithdrawn.push(...withdrawn.map((w) => ({ ...w, iteration })));
		const review = reviewAfterRefutation(raw, promoted);
		const stop = decideWorkflowStop(review);
		const result = { iterations: iteration, review, withdrawn: allWithdrawn };
		if (!stop.stop) return { outcome: "clean", ...result };
		if (stop.needsApproval) return { outcome: "approval-required", ...result, stop };
		// BLOCKER-driven stop: identical to the previous iteration means stalled.
		if (previousPromoted !== undefined && detectStall(previousPromoted, promoted)) return { outcome: "stalled", ...result, stop };
		if (iteration >= MAX_REVIEW_ITERATIONS) return { outcome: "blocked", ...result, stop };
		previousPromoted = promoted;
	}
}
