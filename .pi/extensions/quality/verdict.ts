/**
 * GATE-06 / QUAL-05 — refute-or-promote before a BLOCKER can stop work, and
 * the pure predicate that decides whether a validated review stops the
 * workflow at all.
 *
 * ---------------------------------------------------------------------------
 * PURPOSE
 * ---------------------------------------------------------------------------
 * The anti-review-theatre protocol is two-sided (08-CONTEXT.md decision 6).
 * `review-schema.ts`'s `NIT_CAP` is the countermeasure to a reviewer told to
 * find gaps inventing them. This module is the countermeasure to the OTHER
 * failure mode the same instruction can produce one severity tier up: a
 * BLOCKER invented, or genuinely wrong, that stops real work on a reviewer's
 * say-so alone. Every BLOCKER gets exactly ONE chance to be refuted by the
 * SAME reviewing model, with the SAME context, before it is allowed to stop
 * anything. A WARNING or a NIT never enters this pass at all — widening the
 * scope would cost a nested call per finding and would defeat the NIT cap's
 * own anti-padding purpose from a different direction.
 *
 * QUAL-05 is a SEPARATE, PURE predicate: {@link decideWorkflowStop} decides
 * whether a *classification* (symptomatic, workaround) stops the workflow,
 * independent of whether any BLOCKER survived refutation at all. Where the
 * resulting approval is *collected* is Phase 9's ceremonial-workflow problem;
 * this module produces the stop signal and its record, nothing more.
 *
 * ---------------------------------------------------------------------------
 * ORDER OF OPERATIONS — decideWorkflowStop RUNS AFTER REFUTATION, NOT BEFORE
 * ---------------------------------------------------------------------------
 * {@link decideWorkflowStop}'s branch (3) reads "any finding with severity
 * BLOCKER SURVIVES to here" — survives refutation, not merely survives the
 * classification branches. Every caller of this module is expected to run
 * {@link runRefuteOrPromote} FIRST, replace a review's `findings` with its
 * non-BLOCKER findings plus only the `promoted` (upheld) BLOCKERs, and only
 * then hand that post-refutation review to `decideWorkflowStop`. Handing it
 * the RAW reviewer output would let a since-withdrawn BLOCKER still stop the
 * workflow, defeating the whole point of this module. {@link
 * runBoundedReviewLoop} is the reference caller that gets this order right;
 * read it before writing a second one.
 *
 * ---------------------------------------------------------------------------
 * THE BOUNDED LOOP
 * ---------------------------------------------------------------------------
 * BLOCKER → fix → re-review, at most {@link MAX_REVIEW_ITERATIONS} times, with
 * stall detection: an iteration whose promoted BLOCKER set is IDENTICAL to
 * the previous iteration's is not converging and terminates the loop with its
 * own distinct `outcome: "stalled"`, never as just another iteration. This
 * module does not know how to FIX anything — applying a fix between
 * iterations is entirely the caller's business (a future workflow); {@link
 * runBoundedReviewLoop} only knows how to ask for another review and compare
 * what came back.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE IS PURE, EXCEPT FOR TWO CLEARLY SEPARATED IMPURE FUNCTIONS
 * ---------------------------------------------------------------------------
 * {@link decideWorkflowStop} and {@link detectStall} are plain data in, plain
 * data out — no `ctx`, no I/O, nothing awaited. {@link runRefuteOrPromote} and
 * {@link runBoundedReviewLoop} are impure: both need `ctx` to reach the Phase
 * 2 chokepoint via `runSingleShotRole`, matching `reviewer.ts` and
 * `advisor.ts`'s identical PURITY discipline in this same subsystem.
 *
 * ---------------------------------------------------------------------------
 * DISPATCH
 * ---------------------------------------------------------------------------
 * The ONLY route this module takes to a model is `runSingleShotRole(ctx,
 * {role:"reviewer", ...})`, imported from `../routing/modes.ts` — the SAME
 * role a normal review runs under, because a refutation pass is the same
 * reviewer being asked a follow-up question about its own finding, not a
 * distinct role. This file never spells, even in prose, any of the
 * direct-model-access forms `tests/unit/chokepoint-lint.test.ts` bans across
 * `.pi/extensions/`.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (BOOT-10)
 * ---------------------------------------------------------------------------
 * This module registers nothing with Pi. It does not spell the
 * tool-registration call, in code or in prose — `tests/unit/
 * contributing-boundary.test.ts` matches that call's name as a plain
 * substring across every tracked source under `.pi/extensions/`, comments
 * included, and grants this directory no exemption. The `refute_finding`
 * schema below reaches the model through `runSingleShotRole`'s existing
 * `tools?: Tool[]` field, exactly like `review-schema.ts`'s `submit_review`
 * schema does through `reviewer.ts` — a reviewer-scoped forced tool call,
 * never a main-loop tool registration.
 *
 * ---------------------------------------------------------------------------
 * FAIL-SAFE DIRECTION — THE OPPOSITE OF THE USUAL INSTINCT, STATED PLAINLY
 * ---------------------------------------------------------------------------
 * An unparseable refutation result — no tool call at all, or an `outcome`
 * value outside the two-member enum — counts as UPHELD, never WITHDRAWN. The
 * usual "fail closed" instinct for a SECURITY control is to fail toward the
 * SAFER state, and here the safer state is the one where the BLOCKER still
 * stands: an unparseable refutation must never be able to silently delete a
 * BLOCKER by accident. This is deliberately the opposite of "absence of a
 * clear answer defaults to permissive" — see {@link runRefuteOrPromote}'s own
 * docstring for where this is enforced.
 */
import { StringEnum } from "@earendil-works/pi-ai";
import type { AssistantMessage, Message, Tool } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { addQualityCost } from "../diagnostics/quality-cost.ts";
import { runSingleShotRole } from "../routing/modes.ts";
import type { ReviewArtifact, ReviewFinding } from "./review-schema.ts";
import { buildReviewerContext, type ReviewerContractInput } from "./reviewer.ts";

// ---------------------------------------------------------------------------
// decideWorkflowStop — QUAL-05's pure predicate
// ---------------------------------------------------------------------------

/**
 * The whole decision. Deliberately two arms, never three — mirrors
 * `routing/guard.ts`'s `GuardVerdict` and `workflows/evidence.ts`'s
 * `EvidenceVerdict`. `needsApproval` distinguishes a classification-driven
 * stop (QUAL-05: someone must explicitly approve shipping a symptomatic patch
 * or an approved workaround) from a BLOCKER-driven stop (GATE-06: the finding
 * itself is the reason to stop, not a request for sign-off on shipping it
 * anyway).
 */
export type WorkflowStop =
	| { readonly stop: false }
	| { readonly stop: true; readonly reason: string; readonly needsApproval: boolean };

/**
 * The whole QUAL-05 / GATE-06 stop predicate. First-match-wins, in
 * `gateCompletion`'s (`workflows/evidence.ts:101-191`) exact numbered,
 * BINDING-ORDER docstring style. Called on a review whose `findings` have
 * ALREADY been through {@link runRefuteOrPromote} — see this module's own
 * ORDER OF OPERATIONS section above.
 *
 *   (1) `review.classification === "symptomatic"` -> stop, `needsApproval:
 *       true`, reason naming the classification and quoting
 *       `classificationJustification` verbatim. QUAL-05. This branch fires
 *       regardless of whether any BLOCKER exists — a symptomatic fix with
 *       ZERO findings still stops, because it is the CHANGE's own nature that
 *       is the problem, not something a finding would have caught.
 *   (2) `review.classification === "workaround"` -> stop, `needsApproval:
 *       true`, reason naming the classification and quoting BOTH `properFix`
 *       and `deferralReason` (the validator already guaranteed both exist for
 *       a "workaround" classification, per `review-schema.ts`'s branch (7))
 *       so the debt is visible in the STOP MESSAGE ITSELF, not only buried in
 *       the artifact a reader might not open. QUAL-05 + QUAL-06.
 *   (3) any finding with `severity === "BLOCKER"` SURVIVES to here -> stop,
 *       `needsApproval: false`, reason naming each surviving BLOCKER's
 *       `location` and `concreteFailure`. This branch sits AFTER the
 *       classification branches on purpose: a symptomatic fix with no
 *       BLOCKER still stops at (1), and conflating the two would make the
 *       approval requirement disappear whenever the reviewer happened to
 *       find nothing wrong with a change that is, by its own classification,
 *       exactly the kind of change QUAL-05 exists to gate.
 *   (4) otherwise -> `{stop: false}`.
 *
 * A WARNING or a NIT finding never reaches branch (3) at all — that branch's
 * own filter is `severity === "BLOCKER"`, so a review with only WARNINGs and
 * NITs, classified `root-cause`, reaches (4) and does not stop the workflow,
 * however many WARNINGs it carries.
 */
export function decideWorkflowStop(review: ReviewArtifact): WorkflowStop {
	// (1) QUAL-05: a symptomatic classification stops regardless of findings.
	if (review.classification === "symptomatic") {
		return {
			stop: true,
			needsApproval: true,
			reason:
				`this change is classified "symptomatic" (QUAL-05) -- ${review.classificationJustification}`,
		};
	}

	// (2) QUAL-05 + QUAL-06: a workaround stops with its debt stated inline.
	if (review.classification === "workaround") {
		return {
			stop: true,
			needsApproval: true,
			reason:
				`this change is classified "workaround" (QUAL-05) -- ${review.classificationJustification}. ` +
				`Proper fix: ${review.properFix ?? ""}. Deferred because: ${review.deferralReason ?? ""}.`,
		};
	}

	// (3) GATE-06: any BLOCKER that survived refutation stops the workflow.
	const survivingBlockers = review.findings.filter((finding) => finding.severity === "BLOCKER");
	if (survivingBlockers.length > 0) {
		const names = survivingBlockers.map((b) => `${b.location}: ${b.concreteFailure}`).join("; ");
		return {
			stop: true,
			needsApproval: false,
			reason:
				`${survivingBlockers.length} BLOCKER finding(s) survived refutation (GATE-06) -- ${names}`,
		};
	}

	// (4) a clean, non-symptomatic, non-workaround review does not stop.
	return { stop: false };
}

// ---------------------------------------------------------------------------
// detectStall — pure, order-independent finding-set comparison
// ---------------------------------------------------------------------------

/** A normalised, order-independent key for one finding — severity, location, and the concrete failure text. */
function normaliseFinding(finding: ReviewFinding): string {
	return `${finding.severity}|${finding.location}|${finding.concreteFailure}`;
}

/**
 * True when `previous` and `current` carry the exact same finding set under a
 * normalised, ORDER-INDEPENDENT comparison (`severity|location|
 * concreteFailure`). A stall means the review loop is not converging: the
 * same BLOCKER(s), in the same place, describing the same failure, survived
 * an entire fix-then-re-review cycle unchanged. {@link runBoundedReviewLoop}
 * treats a stall as a distinct terminal outcome rather than iterating again,
 * since another identical cycle would not buy more information.
 */
export function detectStall(previous: readonly ReviewFinding[], current: readonly ReviewFinding[]): boolean {
	if (previous.length !== current.length) {
		return false;
	}
	const previousKeys = new Set(previous.map(normaliseFinding));
	const currentKeys = new Set(current.map(normaliseFinding));
	if (previousKeys.size !== currentKeys.size) {
		return false;
	}
	for (const key of previousKeys) {
		if (!currentKeys.has(key)) {
			return false;
		}
	}
	return true;
}

/**
 * The bounded loop's hard stop.
 *
 * WHY 2, NAMED RATHER THAN INLINED: one refutation pass gives the reviewer a
 * genuine chance to reconsider its own finding; a second full review-then-
 * refute cycle gives a FIX one chance to actually resolve what survived the
 * first. A third cycle would not buy more confidence — it would spend more
 * nested calls against a finding that has already twice failed to be
 * refuted or fixed, which is exactly what {@link detectStall} exists to
 * catch sooner. Two is the smallest bound under which both "fixed on the
 * first try" and "genuinely stuck" can each be observed at least once before
 * the loop gives up, per this plan's own stated requirement (GATE-06: "at
 * most 2 iterations").
 */
export const MAX_REVIEW_ITERATIONS = 2;

// ---------------------------------------------------------------------------
// runRefuteOrPromote — the impure refutation pass, BLOCKER-scoped
// ---------------------------------------------------------------------------

/** The forced refutation tool-call name. */
const REFUTE_FINDING_TOOL_NAME = "refute_finding";

const REFUTE_FINDING_DESCRIPTION =
	"Report the outcome of your attempt to refute your own prior BLOCKER finding. This is the ONLY way to " +
	'report your outcome; any prose you write outside this call is discarded. "outcome":"withdrawn" only if ' +
	'you genuinely no longer believe the finding holds, after a real attempt to disprove it. "outcome":"upheld" ' +
	"otherwise, including when you are unsure -- an unsure refutation must uphold, never withdraw, so a genuine " +
	"BLOCKER is never silently deleted by a shrug. Always state your rationale, whichever outcome you report.";

/**
 * `Type.Object` schema construction, matching `review-schema.ts`'s own style
 * — `StringEnum` (not `Type.Union`/`Type.Literal`) for the closed
 * `outcome` enum, per CLAUDE.md's "What NOT to Use" table.
 */
const refuteFindingParameters = Type.Object({
	outcome: StringEnum(["upheld", "withdrawn"], {
		description: 'Your honest outcome: "upheld" if the finding still stands, "withdrawn" if it does not.',
	}),
	rationale: Type.String({
		description: "Why you reached this outcome, stated plainly.",
	}),
});

/** One BLOCKER that survived its refutation pass, or was never given one. */
export type PromotedFinding = ReviewFinding;

/** One BLOCKER whose refutation pass genuinely withdrew it, and why. */
export interface WithdrawnFinding {
	readonly finding: ReviewFinding;
	readonly rationale: string;
}

/** What {@link runRefuteOrPromote} hands back — never a boolean, never a mutated `findings` array in place. */
export interface RefuteOrPromoteResult {
	readonly promoted: readonly PromotedFinding[];
	readonly withdrawn: readonly WithdrawnFinding[];
}

const REFUTATION_SYSTEM_PROMPT =
	"You are the SAME adversarial code reviewer, now asked to attempt to refute one specific BLOCKER finding " +
	"you reported. Try genuinely: read the finding and the context again and decide honestly whether it still " +
	"holds. Do not withdraw a finding merely to be agreeable, and do not uphold one merely to look thorough -- " +
	"both are the same soft-failure your own reviewing instructions already name, applied one level deeper. " +
	`Call ${REFUTE_FINDING_TOOL_NAME} exactly once with your honest outcome and rationale.`;

/** Render one BLOCKER finding, verbatim, as the message the refutation pass is asked to reconsider. */
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
 * For EACH BLOCKER in `review.findings`, and ONLY BLOCKERs — this function's
 * own first line filters on `severity === "BLOCKER"` before any call is
 * made, so a review carrying WARNINGs and NITs alongside its BLOCKERs never
 * spends a nested call on the lesser findings — run exactly ONE nested
 * `runSingleShotRole({role:"reviewer", ...})` refutation pass with the
 * `refute_finding` tool forced.
 *
 * FAIL-SAFE DIRECTION (see this module's own docstring): a response carrying
 * no `refute_finding` tool call at all, or one whose `outcome` is not exactly
 * `"upheld"` or `"withdrawn"`, is treated as UPHELD. This is the opposite of
 * the usual fail-closed instinct — the SAFER outcome here is the one where
 * the BLOCKER still stands, so an unparseable or missing answer must never be
 * able to silently delete one.
 *
 * Never runs a second pass on the same finding — one refutation pass each is
 * the requirement's own wording, and this function has no retry loop of its
 * own for that reason.
 *
 * Times each pass and reports it via `addQualityCost({ms, tokens})` — QUAL-09's
 * ledger, the same recipe `runReview` and `executeConsultAdvisor` already use
 * in this subsystem.
 */
export async function runRefuteOrPromote(
	ctx: ExtensionContext,
	review: ReviewArtifact,
	contract: ReviewerContractInput,
): Promise<RefuteOrPromoteResult> {
	const blockers = review.findings.filter((finding) => finding.severity === "BLOCKER");

	const promoted: PromotedFinding[] = [];
	const withdrawn: WithdrawnFinding[] = [];

	if (blockers.length === 0) {
		return { promoted, withdrawn };
	}

	const context = buildReviewerContext(contract);

	const tools: Tool[] = [
		{
			name: REFUTE_FINDING_TOOL_NAME,
			description: REFUTE_FINDING_DESCRIPTION,
			parameters: refuteFindingParameters,
		},
	];

	for (const finding of blockers) {
		const messages: Message[] = [
			{ role: "user", content: buildRefutationMessage(finding, context), timestamp: Date.now() },
		];

		const start = process.hrtime.bigint();
		const message: AssistantMessage = await runSingleShotRole(ctx, {
			role: "reviewer",
			systemPrompt: REFUTATION_SYSTEM_PROMPT,
			messages,
			need: {},
			tools,
		});
		const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
		addQualityCost({ ms: elapsedMs, tokens: message.usage.totalTokens });

		const toolCall = message.content.find(
			(block): block is Extract<AssistantMessage["content"][number], { type: "toolCall" }> =>
				block.type === "toolCall" && block.name === REFUTE_FINDING_TOOL_NAME,
		);

		const rawArgs = toolCall?.arguments as Record<string, unknown> | undefined;
		const rawOutcome = rawArgs?.outcome;
		const rawRationale = typeof rawArgs?.rationale === "string" ? rawArgs.rationale : "";

		// FAIL-SAFE: no tool call, or an outcome outside the two-member enum,
		// stays UPHELD -- never falls through to the withdrawn branch below.
		if (rawOutcome === "withdrawn") {
			withdrawn.push({ finding, rationale: rawRationale });
		} else {
			promoted.push(finding);
		}
	}

	return { promoted, withdrawn };
}

// ---------------------------------------------------------------------------
// runBoundedReviewLoop — orchestration: review -> refute-or-promote -> stop
// or re-review, bounded, with stall detection
// ---------------------------------------------------------------------------

/**
 * What one iteration of {@link runBoundedReviewLoop} needs to obtain a
 * review. Caller-supplied so this module never has to know how a review is
 * produced (a fresh `runReview` call, a re-review after an out-of-band fix,
 * or — in a test — a scripted fixture) — it only knows how to bound and
 * compare what comes back.
 */
export interface RunBoundedReviewLoopOptions {
	readonly review: () => Promise<ReviewArtifact>;
	readonly contract: ReviewerContractInput;
}

/** One withdrawn BLOCKER, tagged with the iteration it was withdrawn on. */
export interface IterationWithdrawal extends WithdrawnFinding {
	readonly iteration: number;
}

/**
 * The whole bounded-loop result — a discriminated union, never a boolean.
 * Every arm carries `iterations` (how many review/refute cycles actually
 * ran), the FINAL review (post-refutation: `findings` holds only surviving
 * BLOCKERs plus the original non-BLOCKER findings), and the full withdrawal
 * record across every iteration.
 *
 *   - `"clean"`: the final review neither carries a surviving BLOCKER nor a
 *     stop-worthy classification. `decideWorkflowStop` on `review` is
 *     `{stop:false}`.
 *   - `"approval-required"`: `decideWorkflowStop` returned `needsApproval:
 *     true` (QUAL-05: symptomatic or workaround) — this arm can be reached on
 *     the FIRST iteration, since a classification stop does not depend on any
 *     BLOCKER surviving refutation.
 *   - `"blocked"`: `MAX_REVIEW_ITERATIONS` was reached with at least one
 *     BLOCKER still surviving refutation, and the two iterations' surviving
 *     sets were NOT identical (so this is exhaustion, not a stall).
 *   - `"stalled"`: two consecutive iterations' surviving BLOCKER sets were
 *     identical under {@link detectStall} — the loop is not converging and
 *     stops here rather than spending a third, identical cycle.
 */
export type BoundedReviewLoopResult =
	| {
			readonly outcome: "clean";
			readonly iterations: number;
			readonly review: ReviewArtifact;
			readonly withdrawn: readonly IterationWithdrawal[];
	  }
	| {
			readonly outcome: "approval-required" | "blocked" | "stalled";
			readonly iterations: number;
			readonly review: ReviewArtifact;
			readonly withdrawn: readonly IterationWithdrawal[];
			readonly stop: WorkflowStop;
	  };

/** Build the post-refutation review: non-BLOCKER findings unchanged, BLOCKER findings replaced with only what survived. */
function reviewAfterRefutation(review: ReviewArtifact, promoted: readonly ReviewFinding[]): ReviewArtifact {
	const nonBlockers = review.findings.filter((finding) => finding.severity !== "BLOCKER");
	return { ...review, findings: [...nonBlockers, ...promoted] };
}

/**
 * Orchestrates the whole GATE-06 bounded loop: obtain a review, run
 * {@link runRefuteOrPromote} over its BLOCKERs, build the post-refutation
 * review, and hand THAT to {@link decideWorkflowStop} — never the raw
 * reviewer output, per this module's own ORDER OF OPERATIONS section.
 *
 *   - A classification-driven stop (`needsApproval: true`) returns
 *     immediately as `"approval-required"`, on whichever iteration it is
 *     first seen — QUAL-05 does not wait for a stall or for
 *     `MAX_REVIEW_ITERATIONS`; it is not part of the BLOCKER-convergence
 *     loop at all.
 *   - A BLOCKER-driven stop (`needsApproval: false`) is compared against the
 *     PREVIOUS iteration's surviving BLOCKER set via {@link detectStall}. An
 *     identical set terminates as `"stalled"`. A different (but still
 *     non-empty) set continues to the next iteration — a re-review — unless
 *     `MAX_REVIEW_ITERATIONS` has already been reached, in which case the
 *     loop hard-stops as `"blocked"`.
 *   - No stop at all — the post-refutation review is clean — terminates as
 *     `"clean"`.
 *
 * `opts.review()` is called once per iteration, up to `MAX_REVIEW_ITERATIONS`
 * times; this function never calls it more than that, which is what keeps
 * the total nested-call count (one `runReview`-shaped call per iteration,
 * plus one refutation call per surviving BLOCKER per iteration) bounded.
 */
export async function runBoundedReviewLoop(
	ctx: ExtensionContext,
	opts: RunBoundedReviewLoopOptions,
): Promise<BoundedReviewLoopResult> {
	let previousPromoted: readonly ReviewFinding[] | undefined;
	const allWithdrawn: IterationWithdrawal[] = [];

	for (let iteration = 1; iteration <= MAX_REVIEW_ITERATIONS; iteration++) {
		const review = await opts.review();
		const { promoted, withdrawn } = await runRefuteOrPromote(ctx, review, opts.contract);
		for (const w of withdrawn) {
			allWithdrawn.push({ ...w, iteration });
		}

		const postRefutation = reviewAfterRefutation(review, promoted);
		const stopDecision = decideWorkflowStop(postRefutation);

		if (!stopDecision.stop) {
			return { outcome: "clean", iterations: iteration, review: postRefutation, withdrawn: allWithdrawn };
		}

		if (stopDecision.needsApproval) {
			return {
				outcome: "approval-required",
				iterations: iteration,
				review: postRefutation,
				withdrawn: allWithdrawn,
				stop: stopDecision,
			};
		}

		// BLOCKER-driven stop: compare against the previous iteration before
		// deciding whether this is a stall or just another cycle to try.
		if (previousPromoted !== undefined && detectStall(previousPromoted, promoted)) {
			return {
				outcome: "stalled",
				iterations: iteration,
				review: postRefutation,
				withdrawn: allWithdrawn,
				stop: stopDecision,
			};
		}

		if (iteration === MAX_REVIEW_ITERATIONS) {
			return {
				outcome: "blocked",
				iterations: iteration,
				review: postRefutation,
				withdrawn: allWithdrawn,
				stop: stopDecision,
			};
		}

		previousPromoted = promoted;
		// Loop continues: the next iteration calls opts.review() again — a
		// re-review, per this function's own docstring.
	}

	// Unreachable: the loop above always returns by MAX_REVIEW_ITERATIONS.
	throw new Error("runBoundedReviewLoop: fell through the bounded loop without returning -- this is a bug");
}
