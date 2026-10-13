/**
 * Ambiguity scorecard as pure code: per-dimension floors, an overall gate, a hard question budget and rotating perspectives.
 * Two scales, stated to avoid a silent inversion: a dimension score is 0..1, higher is better, with `floor` as the minimum; the overall score is 0..1, lower is better, with SCORE_GATE as the maximum.
 * There is no override: a dimension below its floor keeps the SPEC refused, because a reader cannot tell a user's override from a model's.
 * Shape only: honest scoring cannot be proven here; the §2 evidence gate and /review cover the rest.
 */

/** The four scored dimensions, one per failure mode in .planning/research/FEATURES.md Part 3; a fifth would dilute them. */
export type AmbiguityDimensionId = "factual-grounding" | "requirement-precision" | "failure-coverage" | "scope-definiteness";

export interface AmbiguityDimension {
	readonly id: AmbiguityDimensionId;
	readonly label: string;
	/** Minimum acceptable score, 0..1, higher is better. */
	readonly floor: number;
}

/** Named so `quality/rules.ts` magic-number does not fire on four bare 0.7 literals. */
const DEFAULT_DIMENSION_FLOOR = 0.7;

export const AMBIGUITY_DIMENSIONS: readonly AmbiguityDimension[] = Object.freeze(
	([
		["factual-grounding", "Factual Grounding"],
		["requirement-precision", "Requirement Precision"],
		["failure-coverage", "Failure Coverage"],
		["scope-definiteness", "Scope Definiteness"],
	] as const).map(([id, label]) => Object.freeze({ id, label, floor: DEFAULT_DIMENSION_FLOOR })),
);

/** Maximum acceptable overall score, 0..1, lower is better (FEATURES.md Part 2 line 176). */
export const SCORE_GATE = 0.2;

/** Hard question ceiling (spec-kit's five); a soft budget burns tokens without limit. */
export const HARD_QUESTION_BUDGET = 5;

export interface InterviewPerspective {
	readonly id: string;
	readonly label: string;
	readonly surfaces: string;
}

/** Rotation order. Five entries match HARD_QUESTION_BUDGET so a full budget visits each lens once. */
export const INTERVIEW_PERSPECTIVES: readonly InterviewPerspective[] = Object.freeze(
	([
		["researcher", "Researcher", "what does the codebase already do here, and does this SPEC's claim about it actually hold?"],
		["simplifier", "Simplifier", "is there a smaller version of this that still satisfies the goal, and did we default to the bigger one?"],
		["boundary-keeper", "Boundary Keeper", "what is explicitly NOT part of this change, and would a reasonable reader agree from §5 alone?"],
		["failure-analyst", "Failure Analyst", "what's the worst thing that could go wrong if we get the requirements wrong, and what does a broken version of this look like?"],
		["seed-closer", "Seed Closer", "of everything asked so far, what is the single highest-impact question still unanswered?"],
	] as const).map(([id, label, surfaces]) => Object.freeze({ id, label, surfaces })),
);

export type PerspectiveId = (typeof INTERVIEW_PERSPECTIVES)[number]["id"];

export type QuestionSlot = { readonly perspective: PerspectiveId; readonly index: number } | { readonly exhausted: true; readonly reason: string };

/** One question slot per call, pure over `askedCount`: exhausted at the budget with no wraparound, otherwise the next perspective in rotation. */
export function nextQuestionSlot(askedCount: number): QuestionSlot {
	if (askedCount >= HARD_QUESTION_BUDGET) {
		return {
			exhausted: true,
			reason:
				`${askedCount} question(s) already asked, meeting or exceeding the hard budget of ` +
				`${HARD_QUESTION_BUDGET} -- the interrogation ends here, whatever the scorecard says. Score honestly: ` +
				"a dimension below its floor keeps SPEC.md refused, and only the user can continue with /grill --resume",
		};
	}
	const index = askedCount % INTERVIEW_PERSPECTIVES.length;
	return { perspective: (INTERVIEW_PERSPECTIVES[index] as InterviewPerspective).id, index };
}

export interface DimensionScore {
	readonly id: string;
	readonly score: number;
}

/** The model-supplied scorecard gateAmbiguity judges. */
export interface AmbiguityScorecard {
	readonly dimensions: readonly DimensionScore[];
	readonly overall: number;
}

export type AmbiguityVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const DIMENSION_IDS: ReadonlySet<string> = new Set(AMBIGUITY_DIMENSIONS.map((d) => d.id));
const SCORE_DIGITS = 2;
const inRange = (score: number): boolean => score >= 0 && score <= 1;

/**
 * Is the interrogation done? First match wins:
 * (1) a declared dimension is missing, unknown or duplicated: malformed, so nothing else is meaningful.
 * (2) a dimension or overall score outside 0..1.
 * (3) a dimension below its floor, naming every unmet one; before (4) so averaging cannot launder an unmet floor.
 * (4) overall > SCORE_GATE, gated as the stricter of the model's own overall and 1 - mean(dimensions).
 */
export function gateAmbiguity(scorecard: AmbiguityScorecard): AmbiguityVerdict {
	const reject = (reason: string): AmbiguityVerdict => ({ ok: false, reason });
	const scoredIds = scorecard.dimensions.map((d) => d.id);
	const missingIds = AMBIGUITY_DIMENSIONS.map((d) => d.id).filter((id) => !scoredIds.includes(id));
	if (missingIds.length > 0) {
		return reject(`the scorecard is missing a score for declared dimension(s): ${missingIds.join(", ")} -- every declared dimension must be scored`);
	}
	const inventedIds = [...new Set(scoredIds.filter((id) => !DIMENSION_IDS.has(id)))];
	if (inventedIds.length > 0) {
		return reject(`the scorecard scores dimension(s) not among AMBIGUITY_DIMENSIONS: ${inventedIds.join(", ")} -- inventing a dimension id is the same failure as omitting a declared one`);
	}
	const duplicateIds = [...new Set(scoredIds.filter((id, i, all) => all.indexOf(id) !== i))];
	if (duplicateIds.length > 0) {
		return reject(`the scorecard scores dimension(s) more than once: ${duplicateIds.join(", ")} -- each declared dimension needs exactly one score`);
	}
	const outOfRange = scorecard.dimensions.find((d) => !inRange(d.score));
	if (outOfRange !== undefined) return reject(`dimension "${outOfRange.id}" has a score of ${outOfRange.score}, outside the required 0..1 range`);
	if (!inRange(scorecard.overall)) return reject(`the overall score is ${scorecard.overall}, outside the required 0..1 range`);

	const byId = new Map(scorecard.dimensions.map((d) => [d.id, d.score]));
	const unmet = AMBIGUITY_DIMENSIONS.filter((d) => (byId.get(d.id) as number) < d.floor);
	if (unmet.length > 0) {
		const named = unmet.map((d) => `${d.label} (floor ${d.floor}, scored ${byId.get(d.id)})`).join("; ");
		return reject(`dimension floor(s) not met: ${named} -- an unmet floor blocks regardless of the overall average`);
	}

	const derived = derivedOverall(scorecard);
	const effective = Math.max(scorecard.overall, derived);
	if (effective > SCORE_GATE) {
		return reject(
			`the overall ambiguity score is ${Number(effective.toFixed(SCORE_DIGITS))} (self-reported ${scorecard.overall}, ` +
				`derived from the dimensions ${Number(derived.toFixed(SCORE_DIGITS))}), above the gate of ${SCORE_GATE} -- an ` +
				"over-gate score blocks regardless of the individual floors",
		);
	}
	return { ok: true };
}

/** Overall ambiguity implied by the dimension scores: 1 - their mean, on the same lower-is-better scale as SCORE_GATE. */
function derivedOverall(scorecard: AmbiguityScorecard): number {
	const scores = scorecard.dimensions.map((d) => d.score);
	return scores.length === 0 ? 1 : 1 - scores.reduce((a, b) => a + b, 0) / scores.length;
}
