/**
 * Ambiguity scorecard as pure code: per-dimension floors, an overall gate, a hard question budget and rotating perspectives.
 * Two scales, stated to avoid a silent inversion: a dimension score is 0..1, higher is better, with `floor` as the minimum; the overall score is 0..1, lower is better, with SCORE_GATE as the maximum.
 * Floors are checked before the overall score so a scorecard that aces three dimensions and fails one is still rejected.
 * There is no override: a dimension below its floor keeps the SPEC refused, because a reader cannot tell a user's override from a model's.
 * Shape only: honest scoring cannot be proven here; the §2 evidence gate and /review cover the rest.
 * Registers nothing and reaches no model.
 */


/** The four scored dimensions, one per failure mode; a fifth would dilute them (tests assert the count). */
export type AmbiguityDimensionId = "factual-grounding" | "requirement-precision" | "failure-coverage" | "scope-definiteness";

export interface AmbiguityDimension {
	readonly id: AmbiguityDimensionId;
	readonly label: string;
	/** Minimum acceptable score, 0..1, higher is better. */
	readonly floor: number;
	readonly why: string;
}

/** Named so `quality/rules.ts` magic-number does not fire on four bare 0.7 literals. */
const DEFAULT_DIMENSION_FLOOR = 0.7;

/** The four dimensions, frozen row by row. The floor lives on each row, not in a parallel table. */
export const AMBIGUITY_DIMENSIONS: readonly AmbiguityDimension[] = Object.freeze([
	Object.freeze({
		id: "factual-grounding",
		label: "Factual Grounding",
		floor: DEFAULT_DIMENSION_FLOOR,
		why:
			"is every claim this SPEC makes about the codebase actually backed by evidence, rather than assumed? " +
			"A low score here means the agent is about to build on something false about the codebase -- " +
			"FEATURES.md Part 3 failure mode (a), 'agent assumes something false about the codebase and builds " +
			"on it'. This is the dimension gateRequirementsAuthorship's §2 evidence gate structurally backstops: " +
			"an empty or evidence-free §2 cannot honestly self-score high here.",
	}),
	Object.freeze({
		id: "requirement-precision",
		label: "Requirement Precision",
		floor: DEFAULT_DIMENSION_FLOOR,
		why:
			"does every requirement carry a runnable acceptance criterion, or does it read as a vague intention? " +
			"A low score here means §3's requirements are fuzzy enough that the user will only discover the " +
			"mismatch when they see wrong output -- FEATURES.md Part 3 failure mode (c), 'user's own spec is " +
			"fuzzy and they only find out when they see wrong output'.",
	}),
	Object.freeze({
		id: "failure-coverage",
		label: "Failure Coverage",
		floor: DEFAULT_DIMENSION_FLOOR,
		why:
			"does §4 name the REAL failure paths for this change, or a token minimum satisfied by filler entries? " +
			"A low score here means the happy path works but edge cases and error handling were invented or " +
			"missing -- FEATURES.md Part 3 failure mode (b), the one the mandatory IF/THEN forcing function in " +
			"spec-schema.ts's §4 parser exists to counter.",
	}),
	Object.freeze({
		id: "scope-definiteness",
		label: "Scope Definiteness",
		floor: DEFAULT_DIMENSION_FLOOR,
		why:
			"are §5's in-scope and out-of-scope lists CLOSED -- would a reasonable reader know exactly what is " +
			"and is not being built? A low score here means the change will build more or less than asked -- " +
			"FEATURES.md Part 3 failure mode (d), 'scope drift'.",
	}),
]);



/** Maximum acceptable overall score, 0..1, lower is better (FEATURES.md Part 2 line 176). */
export const SCORE_GATE = 0.2;


/** Hard question ceiling (spec-kit's five). At `askedCount >= HARD_QUESTION_BUDGET` nextQuestionSlot returns `exhausted`; a soft budget burns tokens without limit. */
export const HARD_QUESTION_BUDGET = 5;

export interface InterviewPerspective {
	readonly id: string;
	readonly label: string;
	readonly surfaces: string;
}

/** Rotation order, frozen. Five entries match HARD_QUESTION_BUDGET so a full budget visits each lens once. */
export const INTERVIEW_PERSPECTIVES: readonly InterviewPerspective[] = Object.freeze([
	Object.freeze({
		id: "researcher",
		label: "Researcher",
		surfaces: "what does the codebase already do here, and does this SPEC's claim about it actually hold?",
	}),
	Object.freeze({
		id: "simplifier",
		label: "Simplifier",
		surfaces: "is there a smaller version of this that still satisfies the goal, and did we default to the bigger one?",
	}),
	Object.freeze({
		id: "boundary-keeper",
		label: "Boundary Keeper",
		surfaces: "what is explicitly NOT part of this change, and would a reasonable reader agree from §5 alone?",
	}),
	Object.freeze({
		id: "failure-analyst",
		label: "Failure Analyst",
		surfaces:
			"what's the worst thing that could go wrong if we get the requirements wrong, and what does a broken " +
			"version of this look like?",
	}),
	Object.freeze({
		id: "seed-closer",
		label: "Seed Closer",
		surfaces: "of everything asked so far, what is the single highest-impact question still unanswered?",
	}),
]);

export type PerspectiveId = (typeof INTERVIEW_PERSPECTIVES)[number]["id"];

/** Two arms, never a nullable field on one shape. */
export type QuestionSlot = { readonly perspective: PerspectiveId; readonly index: number } | { readonly exhausted: true; readonly reason: string };

/** One question slot per call. Pure over the caller's `askedCount`: exhausted at the budget with no wraparound, otherwise `INTERVIEW_PERSPECTIVES[askedCount % length]`, so repeat calls are idempotent. */
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
	const perspective = INTERVIEW_PERSPECTIVES[index];
	if (perspective === undefined) {
		// Unreachable: the index is a modulo of a non-empty frozen array; guarded to keep the return type definite.
		throw new Error("scorecard.ts: INTERVIEW_PERSPECTIVES is unexpectedly empty");
	}
	return { perspective: perspective.id, index };
}


export interface DimensionScore {
	readonly id: string;
	readonly score: number;
}

/** The model-supplied scorecard gateAmbiguity judges; branch (1) enforces one score per dimension. */
export interface AmbiguityScorecard {
	readonly dimensions: readonly DimensionScore[];
	readonly overall: number;
}

/** Two arms, never three. */
export type AmbiguityVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const DIMENSION_IDS: ReadonlySet<string> = new Set(AMBIGUITY_DIMENSIONS.map((d) => d.id));

/**
 * Is the interrogation done? First match wins, in this binding order; every reject reason is built from the received data.
 * (1) a declared dimension is missing, unknown or duplicated: malformed, so nothing else is meaningful.
 * (2) a dimension or overall score outside 0..1.
 * (3) a dimension below its floor, naming every unmet one; before (4) so averaging cannot launder an unmet floor.
 * (4) overall > SCORE_GATE.
 * (5) accept.
 */
export function gateAmbiguity(scorecard: AmbiguityScorecard): AmbiguityVerdict {
	const scoredIds = scorecard.dimensions.map((d) => d.id);

	const missingIds = AMBIGUITY_DIMENSIONS.map((d) => d.id).filter((id) => !scoredIds.includes(id));
	if (missingIds.length > 0) {
		return {
			ok: false,
			reason: `the scorecard is missing a score for declared dimension(s): ${missingIds.join(", ")} -- every declared dimension must be scored`,
		};
	}

	const inventedIds = scoredIds.filter((id, i, all) => !DIMENSION_IDS.has(id) && all.indexOf(id) === i);
	if (inventedIds.length > 0) {
		return {
			ok: false,
			reason: `the scorecard scores dimension(s) not among AMBIGUITY_DIMENSIONS: ${inventedIds.join(", ")} -- inventing a dimension id is the same failure as omitting a declared one`,
		};
	}

	const duplicateIds = scoredIds.filter((id, i, all) => all.indexOf(id) !== i);
	if (duplicateIds.length > 0) {
		return {
			ok: false,
			reason: `the scorecard scores dimension(s) more than once: ${[...new Set(duplicateIds)].join(", ")} -- each declared dimension needs exactly one score`,
		};
	}

	for (const entry of scorecard.dimensions) {
		if (!(entry.score >= 0 && entry.score <= 1)) {
			return {
				ok: false,
				reason: `dimension "${entry.id}" has a score of ${entry.score}, outside the required 0..1 range`,
			};
		}
	}
	if (!(scorecard.overall >= 0 && scorecard.overall <= 1)) {
		return {
			ok: false,
			reason: `the overall score is ${scorecard.overall}, outside the required 0..1 range`,
		};
	}

	const unmet = unmetFloors(scorecard);
	if (unmet.length > 0) {
		const named = unmet.map((u) => `${u.dimension.label} (floor ${u.dimension.floor}, scored ${u.score})`).join("; ");
		return {
			ok: false,
			reason: `dimension floor(s) not met: ${named} -- an unmet floor blocks regardless of the overall average`,
		};
	}

	// The model's own overall is never trusted downward: the stricter of it and 1 - mean(dimensions) is gated.
	const derived = derivedOverall(scorecard);
	const effective = Math.max(scorecard.overall, derived);
	if (effective > SCORE_GATE) {
		return {
			ok: false,
			reason:
				`the overall ambiguity score is ${Number(effective.toFixed(SCORE_DIGITS))} (self-reported ${scorecard.overall}, ` +
				`derived from the dimensions ${Number(derived.toFixed(SCORE_DIGITS))}), above the gate of ${SCORE_GATE} -- an ` +
				"over-gate score blocks regardless of the individual floors",
		};
	}

	return { ok: true };
}

const SCORE_DIGITS = 2;

/** Overall ambiguity implied by the dimension scores: 1 - their mean, on the same lower-is-better scale as SCORE_GATE. */
export function derivedOverall(scorecard: AmbiguityScorecard): number {
	const scores = scorecard.dimensions.map((d) => d.score);
	return scores.length === 0 ? 1 : 1 - scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** Dimensions scored below their own `floor` (equal passes, inclusive), with the score received. Assumes one score per declared dimension; missing ones are skipped. */
function unmetFloors(scorecard: AmbiguityScorecard): readonly { dimension: AmbiguityDimension; score: number }[] {
	const byId = new Map(scorecard.dimensions.map((d) => [d.id, d.score]));
	const out: { dimension: AmbiguityDimension; score: number }[] = [];
	for (const dimension of AMBIGUITY_DIMENSIONS) {
		const score = byId.get(dimension.id);
		if (score !== undefined && score < dimension.floor) {
			out.push({ dimension, score });
		}
	}
	return out;
}
