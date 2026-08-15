/**
 * FLOW-02 — the ambiguity scorecard: per-dimension floors, an overall gate, a
 * HARD question budget, one question at a time, and rotating perspectives —
 * all as pure code, none as prose in a prompt.
 *
 * PURPOSE. `.planning/research/FEATURES.md` Part 2 line 176 states the
 * ambiguity gate in prose: "score ≤ 0.20 with all dimension minimums met, or
 * the user explicitly overrides (unmet dimensions get stamped ⚠ ASSUMPTION
 * into §7)." Exhortation is not a mechanism. If the harness would accept
 * "I feel done grilling", the requirement is not met however good the
 * `/grill` system prompt reads. {@link gateAmbiguity} is that mechanism: a
 * pure predicate over a model-supplied scorecard, with a binding branch
 * order, that a future `/grill` interrogation loop (plan 09-08) must consult
 * before it may declare the interrogation finished. {@link nextQuestionSlot}
 * is the companion mechanism for "one question at a time, rotating
 * perspectives" — the caller asks for exactly one slot per turn, and the
 * rotation and the exhaustion point are computed, never chosen. This module
 * builds both mechanisms only; wiring them to `/grill`'s actual interrogation
 * loop is plan 09-08's job, per this plan's own frontmatter
 * (`requirements: ["FLOW-02"]`, closed only when 09-08 lands).
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE IS PURE
 * ---------------------------------------------------------------------------
 * It makes no model call, reads no file, and registers nothing with Pi. It
 * takes and returns plain data: a frozen dimension table, a frozen
 * perspective list, a rotation selector, and two gate predicates. The
 * caller — `/grill`'s own command file, built in plan 09-08 — owns holding
 * the running `askedCount`, collecting the model's self-scored
 * {@link AmbiguityScorecard}, calling {@link gateAmbiguity} over it, and
 * writing {@link assumptionsFromUnmetFloors}'s output into SPEC.md §7 on the
 * override path.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (BOOT-10)
 * ---------------------------------------------------------------------------
 * This module registers nothing. It does not spell the tool-registration
 * call, in code or in prose — `tests/unit/contributing-boundary.test.ts`
 * matches that call's name as a plain substring across every tracked source
 * under `.pi/extensions/`, comments included, and grants this directory no
 * exemption. Nothing in this file calls a registration API of any kind.
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
 * text, comments included, and grants this module no exemption.
 *
 * ---------------------------------------------------------------------------
 * THE TWO SCALES, STATED EXPLICITLY (the single likeliest silent-inversion bug)
 * ---------------------------------------------------------------------------
 * A DIMENSION score is `0..1`, HIGHER IS BETTER — it answers "how well does
 * this SPEC satisfy this one dimension", and {@link DIMENSION_FLOORS} (the
 * `floor` field on each {@link AMBIGUITY_DIMENSIONS} entry) is the MINIMUM
 * acceptable value.
 *
 * The OVERALL ambiguity score is a SEPARATE `0..1` scale, LOWER IS BETTER —
 * it answers "how much unresolved ambiguity remains", and {@link SCORE_GATE}
 * is the MAXIMUM acceptable value. A caller that reuses one scale's intuition
 * for the other inverts the gate silently; {@link gateAmbiguity}'s own branch
 * (2) rejects any value outside `0..1` on EITHER scale but cannot detect a
 * same-range value applied backwards, which is exactly why both directions
 * are stated here, in code comments, rather than left to be inferred.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FLOOR CHECK SITS BEFORE THE OVERALL-SCORE CHECK (T-09-07-01)
 * ---------------------------------------------------------------------------
 * A scorecard that aces three dimensions and fails one can still average
 * under {@link SCORE_GATE}. If the overall-score branch ran first, that
 * scorecard would ACCEPT, and the floors would be decorative — a maintainer
 * could delete them with no test noticing. Branch (3) below fires BEFORE
 * branch (4) for exactly this reason: an unmet floor is rejected for what it
 * actually is, never laundered into "the average was fine." See
 * `tests/unit/grill-scorecard.test.ts` falsification (b) for the proof that
 * this ordering is asserted, not merely written down.
 *
 * ---------------------------------------------------------------------------
 * WHY THE OVERRIDE IS NOT A BRANCH OF THIS PREDICATE (T-09-07-04)
 * ---------------------------------------------------------------------------
 * FEATURES.md line 176 permits a user override of an unmet floor. That
 * override is a CALLER decision, never a parameter this predicate accepts —
 * a gate that can be told to pass is not a gate. {@link
 * assumptionsFromUnmetFloors} is the separate, honest mechanism: it hands the
 * caller the `⚠ ASSUMPTION`-stamped lines FEATURES.md's own wording requires
 * for SPEC.md §7, so the override is visible in the artifact rather than
 * silently bypassed in this module.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PREDICATE DOES NOT, AND CANNOT, PROVE
 * ---------------------------------------------------------------------------
 * {@link gateAmbiguity} checks the arithmetic and the floors: that every
 * declared dimension is present and only declared dimensions are present,
 * that every score is in range, that every floor is met, and that the
 * overall score clears the gate. It cannot check that the scores are
 * HONEST — a model that self-reports `1.0` on every dimension without having
 * asked a single question passes here exactly as cleanly as one that
 * genuinely interrogated the user. T-09-07-02 in this plan's threat model
 * accepts that risk structurally: `gateRequirementsAuthorship` (09-05,
 * `spec-schema.ts`) independently requires evidence for every §2 row, so the
 * `factual-grounding` dimension in particular cannot be self-certified past
 * an empty §2, and `/review`'s reviewer (08-XX) is what catches the rest.
 *
 * ---------------------------------------------------------------------------
 * LAYOUT
 * ---------------------------------------------------------------------------
 *   AMBIGUITY_DIMENSIONS, DIMENSION_FLOORS -- the four scored dimensions.
 *   SCORE_GATE -- the overall-score ceiling.
 *   HARD_QUESTION_BUDGET, INTERVIEW_PERSPECTIVES, nextQuestionSlot -- the
 *   hard budget and the rotation.
 *   AmbiguityScorecard, AmbiguityVerdict, gateAmbiguity -- the numbered,
 *   binding-order gate.
 *   assumptionsFromUnmetFloors -- the caller-owned override helper.
 */

// ---------------------------------------------------------------------------
// AMBIGUITY_DIMENSIONS, DIMENSION_FLOORS -- the four scored dimensions
// ---------------------------------------------------------------------------

/**
 * The four dimension identifiers. Exactly four, one per named failure mode in
 * `FEATURES.md` Part 3 §3.1 -- a fifth would dilute what each existing
 * dimension is actually answerable for, and this module's own tests assert
 * the count.
 */
export type AmbiguityDimensionId = "factual-grounding" | "requirement-precision" | "failure-coverage" | "scope-definiteness";

/**
 * One row of {@link AMBIGUITY_DIMENSIONS}. `floor` is that dimension's
 * {@link DIMENSION_FLOORS} value, carried on the row rather than a parallel
 * table, so a caller reading one dimension never needs two lookups to learn
 * both its identity and its minimum.
 */
export interface AmbiguityDimension {
	readonly id: AmbiguityDimensionId;
	readonly label: string;
	/** MINIMUM acceptable score for this dimension, `0..1`, higher is better -- see the module docstring's "THE TWO SCALES" section. */
	readonly floor: number;
	readonly why: string;
}

/**
 * The four dimensions, frozen, and each entry frozen individually so a
 * caller cannot mutate one row's `floor` out from under every other consumer
 * of this table -- mirroring `spec-schema.ts`'s `SPEC_SECTIONS` discipline.
 *
 * Each maps to exactly one of `FEATURES.md` Part 3 §3.1's four named failure
 * modes (a)-(d), cited per row below.
 */
export const AMBIGUITY_DIMENSIONS: readonly AmbiguityDimension[] = Object.freeze([
	Object.freeze({
		id: "factual-grounding",
		label: "Factual Grounding",
		floor: 0.7,
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
		floor: 0.7,
		why:
			"does every requirement carry a runnable acceptance criterion, or does it read as a vague intention? " +
			"A low score here means §3's requirements are fuzzy enough that the user will only discover the " +
			"mismatch when they see wrong output -- FEATURES.md Part 3 failure mode (c), 'user's own spec is " +
			"fuzzy and they only find out when they see wrong output'.",
	}),
	Object.freeze({
		id: "failure-coverage",
		label: "Failure Coverage",
		floor: 0.7,
		why:
			"does §4 name the REAL failure paths for this change, or a token minimum satisfied by filler entries? " +
			"A low score here means the happy path works but edge cases and error handling were invented or " +
			"missing -- FEATURES.md Part 3 failure mode (b), the one the mandatory IF/THEN forcing function in " +
			"spec-schema.ts's §4 parser exists to counter.",
	}),
	Object.freeze({
		id: "scope-definiteness",
		label: "Scope Definiteness",
		floor: 0.7,
		why:
			"are §5's in-scope and out-of-scope lists CLOSED -- would a reasonable reader know exactly what is " +
			"and is not being built? A low score here means the change will build more or less than asked -- " +
			"FEATURES.md Part 3 failure mode (d), 'scope drift'.",
	}),
]);

/**
 * DIMENSION_FLOORS, AS A CONCEPT, NOT A SEPARATE EXPORT. The minimum
 * acceptable per-dimension score, `0..1`, HIGHER IS BETTER, is expressed as
 * the `floor` field on each {@link AMBIGUITY_DIMENSIONS} entry, never as a
 * second, parallel table -- a second table is a second place the two could
 * silently drift apart. See the module docstring's "THE TWO SCALES" section
 * for why this direction is stated explicitly rather than assumed.
 */

// ---------------------------------------------------------------------------
// SCORE_GATE -- the overall-score ceiling
// ---------------------------------------------------------------------------

/**
 * The overall ambiguity score's MAXIMUM acceptable value, `0..1`, LOWER IS
 * BETTER -- `.planning/research/FEATURES.md` Part 2 line 176: "score ≤ 0.20
 * with all dimension minimums met." Named, not inlined -- no bare `0.2`
 * appears at any use site in this module, mirroring `gates.ts`'s
 * `DESIGN_REVIEW_FILE_SPAN` / `review-schema.ts`'s `NIT_CAP` precedent for a
 * named threshold constant plus a pure selector.
 */
export const SCORE_GATE = 0.2;

// ---------------------------------------------------------------------------
// HARD_QUESTION_BUDGET, INTERVIEW_PERSPECTIVES, nextQuestionSlot
// ---------------------------------------------------------------------------

/**
 * The maximum number of interrogation questions `/grill` may ask before the
 * interrogation ENDS, whatever the scorecard says. `FEATURES.md` Part 3
 * §3.1(c), line 275: "One question at a time, ≤5 questions (spec-kit hard
 * rule ...)." spec-kit's number is adopted verbatim, over GSD's own softer
 * "2-3 per round × 6 rounds" (up to 18), because a HARD budget needs a single
 * number a caller can compare `askedCount` against, not a per-round
 * allowance.
 *
 * THIS IS HARD, NOT A SUGGESTION. Exceeding it does not warn -- it ENDS the
 * interrogation. {@link nextQuestionSlot} returns its `exhausted` arm the
 * instant `askedCount >= HARD_QUESTION_BUDGET`, and the caller's own
 * obligation on that arm (enforced by `/grill`'s write path, plan 09-08, not
 * by this module) is to force every dimension that has not cleared its floor
 * into SPEC.md §7 with the `⚠ ASSUMPTION` stamp `FEATURES.md` line 176 names
 * -- see {@link assumptionsFromUnmetFloors}. An interrogation that can run
 * past this number is exactly T-09-07-03's denial-of-service: a soft budget
 * burns the user's tokens without limit.
 */
export const HARD_QUESTION_BUDGET = 5;

/** One entry of {@link INTERVIEW_PERSPECTIVES}. */
export interface InterviewPerspective {
	readonly id: string;
	readonly label: string;
	/** The class of question this perspective exists to surface. */
	readonly surfaces: string;
}

/**
 * The rotation order, frozen, and each entry frozen individually. `FEATURES.md`
 * Part 3 §3.1(c), line 273: "Rotating perspectives (GSD): Researcher →
 * Simplifier → Boundary Keeper → Failure Analyst → Seed Closer. Different
 * lenses surface different blindspots; a single persona asks the same shape
 * of question repeatedly." Adopted verbatim, in this stated order --
 * {@link nextQuestionSlot} rotates over exactly this array, so the order
 * declared here IS the interrogation's actual question order, not merely a
 * description of it.
 *
 * Deliberately five entries, matching {@link HARD_QUESTION_BUDGET} exactly --
 * a five-question hard budget rotating over five perspectives visits every
 * perspective exactly once when the budget is fully used, rather than
 * repeating one lens while another goes unheard.
 */
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

/** One perspective identifier, narrowed from {@link INTERVIEW_PERSPECTIVES}'s own `id` field. */
export type PerspectiveId = (typeof INTERVIEW_PERSPECTIVES)[number]["id"];

/** The result of {@link nextQuestionSlot}: mirrors `SpecGateVerdict`'s two-arm discipline, never a nullable field on one shape. */
export type QuestionSlot = { readonly perspective: PerspectiveId; readonly index: number } | { readonly exhausted: true; readonly reason: string };

/**
 * The whole "one question at a time, rotating perspectives" mechanism.
 * PURE — `askedCount` is the caller's own running count of questions already
 * asked this interrogation; this function computes, never stores, the next
 * slot.
 *
 * `askedCount >= HARD_QUESTION_BUDGET` returns the `exhausted` arm, with a
 * `reason` built from both numbers -- NO WRAPAROUND past the budget, ever;
 * `askedCount = HARD_QUESTION_BUDGET + 10` returns exactly the same
 * `exhausted` arm as `askedCount = HARD_QUESTION_BUDGET`, proving the budget
 * is a hard ceiling and not a modulus.
 *
 * Otherwise returns `{ perspective, index }` where `perspective` is
 * `INTERVIEW_PERSPECTIVES[askedCount % INTERVIEW_PERSPECTIVES.length].id` --
 * the rotation is arithmetic over the caller's own count, never a stored
 * pointer this module owns, so calling this function twice with the same
 * `askedCount` is idempotent (a caller may re-derive "what would question N
 * be" without side effects).
 */
export function nextQuestionSlot(askedCount: number): QuestionSlot {
	if (askedCount >= HARD_QUESTION_BUDGET) {
		return {
			exhausted: true,
			reason:
				`${askedCount} question(s) already asked, meeting or exceeding the hard budget of ` +
				`${HARD_QUESTION_BUDGET} -- the interrogation ends here, whatever the scorecard says. Every ` +
				"dimension that has not cleared its floor must be stamped into SPEC.md §7 via assumptionsFromUnmetFloors",
		};
	}
	const index = askedCount % INTERVIEW_PERSPECTIVES.length;
	const perspective = INTERVIEW_PERSPECTIVES[index];
	if (perspective === undefined) {
		// NEVER REACHED IN PRACTICE: index is askedCount % a fixed, non-empty
		// frozen array's length, so it is always a valid array index. Guarded
		// anyway so this function's return type stays definite rather than
		// throwing on an array TypeScript cannot prove non-empty at this call site.
		throw new Error("scorecard.ts: INTERVIEW_PERSPECTIVES is unexpectedly empty");
	}
	return { perspective: perspective.id, index };
}

// ---------------------------------------------------------------------------
// AmbiguityScorecard, AmbiguityVerdict, gateAmbiguity
// ---------------------------------------------------------------------------

/** One dimension's self-reported score, `0..1`, higher is better -- see the module docstring's "THE TWO SCALES" section. */
export interface DimensionScore {
	readonly id: string;
	readonly score: number;
}

/**
 * The whole model-supplied scorecard {@link gateAmbiguity} judges.
 * `dimensions` should carry exactly one {@link DimensionScore} per
 * {@link AMBIGUITY_DIMENSIONS} entry -- branch (1) below is what actually
 * enforces that, not this type.
 */
export interface AmbiguityScorecard {
	readonly dimensions: readonly DimensionScore[];
	/** `0..1`, LOWER IS BETTER -- see the module docstring's "THE TWO SCALES" section. */
	readonly overall: number;
}

/** Mirrors `spec-schema.ts`'s `SpecGateVerdict` / `workflows/evidence.ts`'s `EvidenceVerdict`: deliberately two arms, never three. */
export type AmbiguityVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const DIMENSION_IDS: ReadonlySet<string> = new Set(AMBIGUITY_DIMENSIONS.map((d) => d.id));

/**
 * The whole FLOW-02 predicate: is this interrogation done? First-match-wins,
 * in `gateRequirementsAuthorship`'s (`spec-schema.ts:369-414`) exact
 * numbered, BINDING-ORDER docstring style. Every reject `reason` is built
 * FROM THE RECEIVED DATA, never from a caller-supplied string.
 *
 *   (1) `scorecard.dimensions` omits a declared {@link AMBIGUITY_DIMENSIONS}
 *       id, OR carries an id not in {@link AMBIGUITY_DIMENSIONS}, OR carries
 *       the SAME id more than once -> reject as malformed, naming every
 *       offending id in each direction. Sits FIRST because a malformed
 *       scorecard's arithmetic is meaningless -- there is nothing to check a
 *       floor or an average against until the shape itself is right.
 *   (2) ANY dimension score, or the overall score, outside `0..1` -> reject,
 *       naming the dimension (or "overall") and the value received. Sits
 *       after (1): an out-of-range score on an INVENTED dimension id would
 *       report the wrong defect first.
 *   (3) ANY dimension below its {@link AMBIGUITY_DIMENSIONS} floor -> reject,
 *       naming EVERY unmet dimension, its floor and its actual score. Sits
 *       BEFORE (4) so a scorecard that games the average by acing three
 *       dimensions and failing one is rejected for the RIGHT reason -- see
 *       the module docstring's "WHY THE FLOOR CHECK SITS BEFORE" section
 *       (T-09-07-01).
 *   (4) `overall > SCORE_GATE` -> reject, naming the score and the gate.
 *       Reached only once every individual floor is already known met.
 *   (5) otherwise -> accept.
 *
 * See the module docstring's "WHAT THIS PREDICATE DOES NOT, AND CANNOT,
 * PROVE" section: this checks the arithmetic and the floors; it cannot check
 * that the scores are honest.
 */
export function gateAmbiguity(scorecard: AmbiguityScorecard): AmbiguityVerdict {
	const scoredIds = scorecard.dimensions.map((d) => d.id);

	// (1) missing declared dimensions.
	const missingIds = AMBIGUITY_DIMENSIONS.map((d) => d.id).filter((id) => !scoredIds.includes(id));
	if (missingIds.length > 0) {
		return {
			ok: false,
			reason: `the scorecard is missing a score for declared dimension(s): ${missingIds.join(", ")} -- every declared dimension must be scored`,
		};
	}

	// (1) invented dimension ids -- not in AMBIGUITY_DIMENSIONS at all.
	const inventedIds = scoredIds.filter((id, i, all) => !DIMENSION_IDS.has(id) && all.indexOf(id) === i);
	if (inventedIds.length > 0) {
		return {
			ok: false,
			reason: `the scorecard scores dimension(s) not among AMBIGUITY_DIMENSIONS: ${inventedIds.join(", ")} -- inventing a dimension id is the same failure as omitting a declared one`,
		};
	}

	// (1) a declared dimension scored more than once.
	const duplicateIds = scoredIds.filter((id, i, all) => all.indexOf(id) !== i);
	if (duplicateIds.length > 0) {
		return {
			ok: false,
			reason: `the scorecard scores dimension(s) more than once: ${[...new Set(duplicateIds)].join(", ")} -- each declared dimension needs exactly one score`,
		};
	}

	// (2) range check, dimensions then overall.
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

	// (3) floor check -- sits BEFORE the overall-score check. See this
	// function's own docstring branch (3) for why the position is binding.
	const unmet = unmetFloors(scorecard);
	if (unmet.length > 0) {
		const named = unmet.map((u) => `${u.dimension.label} (floor ${u.dimension.floor}, scored ${u.score})`).join("; ");
		return {
			ok: false,
			reason: `dimension floor(s) not met: ${named} -- an unmet floor blocks regardless of the overall average`,
		};
	}

	// (4) overall-score gate.
	if (scorecard.overall > SCORE_GATE) {
		return {
			ok: false,
			reason: `the overall ambiguity score is ${scorecard.overall}, above the gate of ${SCORE_GATE} -- an over-gate score blocks regardless of the individual floors`,
		};
	}

	// (5) accept.
	return { ok: true };
}

/**
 * Shared by {@link gateAmbiguity} branch (3) and {@link
 * assumptionsFromUnmetFloors}: every {@link AMBIGUITY_DIMENSIONS} entry whose
 * scored value is below its own `floor`, paired with the score received.
 * `score === floor` is NOT a violation -- inclusive boundary, matching this
 * plan's own `must_haves` wording and `spec-schema.ts`'s `EVIDENCE_PATTERN`
 * discipline of stating inclusivity explicitly rather than leaving it to a
 * reader's guess.
 *
 * Assumes `scorecard` already has exactly one score per declared dimension
 * (branch (1) of {@link gateAmbiguity} enforces that on the gate's own input;
 * a caller invoking this helper directly on a still-malformed scorecard gets
 * only the dimensions that ARE present, silently skipping any that are
 * missing -- {@link assumptionsFromUnmetFloors}'s own callers are expected to
 * hand it a scorecard whose shape is already known, per this module's
 * "THIS MODULE IS PURE" ownership note).
 */
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

// ---------------------------------------------------------------------------
// assumptionsFromUnmetFloors -- the caller-owned override helper
// ---------------------------------------------------------------------------

/**
 * The user-override path FEATURES.md line 176 permits, built here as data,
 * never as a branch {@link gateAmbiguity} could be told to take -- see the
 * module docstring's "WHY THE OVERRIDE IS NOT A BRANCH" section
 * (T-09-07-04). Returns one `⚠ ASSUMPTION`-stamped line per dimension below
 * its floor, and an EMPTY array when every floor is met -- the caller
 * (`/grill`'s write path) writes each returned line into SPEC.md §7.
 */
export function assumptionsFromUnmetFloors(scorecard: AmbiguityScorecard): readonly string[] {
	return unmetFloors(scorecard).map(
		(u) => `⚠ ASSUMPTION: "${u.dimension.label}" scored ${u.score}, below its floor of ${u.dimension.floor} -- ${u.dimension.why}`,
	);
}
