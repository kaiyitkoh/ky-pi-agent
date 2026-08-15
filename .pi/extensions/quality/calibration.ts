/**
 * GATE-08 — the seeded-defect calibration scorer.
 *
 * PURPOSE. `tests/fixtures/seeded-defects/index.ts` seeds six real, observed
 * failures; `quality/reviewer.ts`'s `runReview` dispatches a reviewer against
 * them; this module is the THIRD, wholly independent piece — it turns a
 * reviewer's raw findings into a per-defect-class catch rate, a NUMBER, never
 * a verdict string. Keeping the corpus, the injection (dispatch), and the
 * scoring as three separable artifacts is what stops a calibration harness
 * from grading itself: nothing in this file knows how a finding was
 * produced, and nothing that produces a finding knows how it will be scored.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE IS PURE
 * ---------------------------------------------------------------------------
 * No `ctx`, no I/O, no fauxProvider dependency, no model call — plain data
 * in, plain data out. It is separately testable from the corpus (which only
 * writes to a temp repo) and from the injection (which only dispatches
 * through `runSingleShotRole`).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT PROVE
 * ---------------------------------------------------------------------------
 * A scorer that has only ever run against SCRIPTED reviewers is not evidence
 * that a real reviewer is honest — it is only evidence that the scorer can
 * tell a good scripted transcript from a bad one. Whatever catch rate this
 * module reports against a scripted faux reviewer says nothing about what a
 * real DeepSeek/DashScope/Bedrock call would catch. The live-reviewer
 * calibration run is `RB-08-03` in `docs/RUNBOOK.md`, and it stays
 * OUTSTANDING until run by hand, with real credentials, on the work laptop —
 * never inferred from this module's own offline results.
 *
 * ---------------------------------------------------------------------------
 * `SeededDefectExpectation` IS RE-DECLARED HERE, STRUCTURALLY, NOT IMPORTED
 * ---------------------------------------------------------------------------
 * `tests/fixtures/seeded-defects/index.ts` exports the authoritative shape
 * this type mirrors. Production code under `.pi/extensions/` does not import
 * from `tests/` — this module stays importable with zero test-tree
 * dependencies, and a future non-test caller (a real calibration command)
 * never drags a fixture module into its own dependency graph. If the two
 * shapes drift, the corpus module is authoritative; this declaration is the
 * one that must be updated to match it.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (BOOT-10)
 * ---------------------------------------------------------------------------
 * This module registers nothing with Pi and makes no tool-registration call,
 * in code or in prose — `tests/unit/contributing-boundary.test.ts` matches
 * that call's name as a plain substring across every tracked source under
 * `.pi/extensions/`, comments included, and grants this directory no
 * exemption.
 */

/**
 * What a caller needs to know to grade a reviewer's findings against one
 * seeded defect. Structurally mirrors
 * `SeededDefect["expected"]` plus that defect's own `id`, from
 * `tests/fixtures/seeded-defects/index.ts` — see this module's own header
 * for why the type is re-declared here rather than imported.
 */
export interface SeededDefectExpectation {
	/** The defect-class id this expectation belongs to — the key {@link CalibrationResult.perDefectClass} is reported under. */
	readonly id: string;
	/** The touched file a catching finding's `location` must name. */
	readonly locationFile: string;
	/** Any one of these, appearing in a finding's `concreteFailure` or `location`, counts as a catch. */
	readonly mustMentionAny: readonly string[];
	/** The minimum severity a catching finding must carry. */
	readonly minimumSeverity: "BLOCKER" | "WARNING";
}

/**
 * The minimal shape this module reads off a `ReviewFinding`
 * (`quality/review-schema.ts`) — declared locally rather than imported, so
 * this module never needs to know the full `ReviewFinding` shape, only the
 * three fields it actually reads.
 */
export interface ScorableFinding {
	readonly severity: "BLOCKER" | "WARNING" | "NIT";
	readonly location: string;
	readonly concreteFailure: string;
}

/**
 * The whole calibration result. `catchRate` is a RAW RATIO, never rounded to
 * a flattering figure, and this module never returns a verdict string
 * alongside it — a caller that wants to describe the number in words owns
 * that decision, and owns stating plainly that scripted calibration is not
 * live calibration.
 */
export interface CalibrationResult {
	/** Number of defect classes with at least one matching finding. */
	readonly caught: number;
	/** `expected.length`. */
	readonly total: number;
	/** `caught / total`, or `0` when `total` is `0`. */
	readonly catchRate: number;
	/** One entry per `expected` id, `true` iff at least one finding matched it. */
	readonly perDefectClass: Readonly<Record<string, boolean>>;
	/**
	 * Findings that matched NO expectation at all — reported, never
	 * subtracted from anything, so a reviewer that shotgunned twenty findings
	 * and hit two by accident is visible as such rather than silently
	 * absorbed into a flattering `caught` count.
	 */
	readonly unmatchedFindings: number;
}

/** NIT is deliberately the lowest rank — `minimumSeverity` is only ever "BLOCKER" or "WARNING", never "NIT". */
const SEVERITY_RANK: Readonly<Record<ScorableFinding["severity"], number>> = {
	NIT: 0,
	WARNING: 1,
	BLOCKER: 2,
};

/**
 * WR2-05 (`08-REVIEW.md` iteration 2): the minimum COUNT of distinct
 * `mustMentionAny` needles a finding must contain, not merely `>= 1`.
 *
 * `mustMentionAny` is an OR set, and an OR set is only as strong as its
 * weakest member: several individual needles ("cannot fail", "not wired
 * in", "performs none") are generic enough to be asserted about any file of
 * that KIND without having analysed it. A single boilerplate sentence
 * reusing one needle per defect class (verbatim, no analysis) scored
 * `catchRate === 1.0` against all six real corpus entries before this fix —
 * see `tests/fixtures/seeded-defects/index.ts`'s corpus and this module's
 * own `SHOTGUN_KITCHEN_SINK` control in `reviewer-calibration.test.ts`.
 * Requiring TWO independent needles closes it: the kitchen-sink sentence
 * carries exactly one matching phrase per class by construction (that is
 * what made it a minimal, deniable exploit), so a second, INDEPENDENT
 * needle is not free to include without genuinely describing a second
 * aspect of the defect. `Math.min(2, ...)` keeps a deliberately
 * single-needle expectation (used by this module's own direct unit tests,
 * and legitimate for a defect with only one describable symptom) working
 * exactly as before — the ceiling only bites once a corpus entry HAS a
 * second independent needle to demand.
 */
const MIN_DISTINCT_NEEDLES = 2;

/**
 * True iff `finding` catches `expectation`: its `location` names
 * `expectation.locationFile`, its `concreteFailure` (or its own `location`)
 * contains at least `Math.min(MIN_DISTINCT_NEEDLES, expectation.mustMentionAny.length)`
 * DISTINCT entries from `expectation.mustMentionAny` (see
 * {@link MIN_DISTINCT_NEEDLES}'s own docstring for why this is a count, not
 * merely `>= 1`), and its `severity` is at least `expectation.minimumSeverity`.
 * All three conditions are required — a finding naming the right file with a
 * vague concern does not count, and a finding using the right words about
 * the wrong file does not count either.
 */
function findingCatches(finding: ScorableFinding, expectation: SeededDefectExpectation): boolean {
	if (!finding.location.includes(expectation.locationFile)) {
		return false;
	}
	const haystack = `${finding.concreteFailure} ${finding.location}`;
	const matchedNeedleCount = expectation.mustMentionAny.reduce((count, needle) => (haystack.includes(needle) ? count + 1 : count), 0);
	const requiredNeedleCount = Math.min(MIN_DISTINCT_NEEDLES, expectation.mustMentionAny.length);
	if (matchedNeedleCount < requiredNeedleCount) {
		return false;
	}
	return SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[expectation.minimumSeverity];
}

/**
 * Score a set of findings against the seeded-defect corpus's expectations.
 *
 * For every finding, every expectation it catches (per {@link findingCatches})
 * is marked caught in {@link CalibrationResult.perDefectClass}; a finding that
 * catches nothing counts toward {@link CalibrationResult.unmatchedFindings}.
 * `caught` is the count of expectations with at least one catching finding —
 * a defect class caught by five separate findings still counts once, and a
 * defect class caught by zero counts zero, however many findings exist
 * overall. This is what keeps a "shotgun" reviewer (many findings, none
 * specific) from scoring well: quantity of findings never substitutes for
 * matching the stated expectation.
 */
export function scoreCalibration(
	expected: readonly SeededDefectExpectation[],
	findings: readonly ScorableFinding[],
): CalibrationResult {
	const perDefectClass: Record<string, boolean> = {};
	for (const expectation of expected) {
		perDefectClass[expectation.id] = false;
	}

	let unmatchedFindings = 0;
	for (const finding of findings) {
		let matchedAnyExpectation = false;
		for (const expectation of expected) {
			if (findingCatches(finding, expectation)) {
				perDefectClass[expectation.id] = true;
				matchedAnyExpectation = true;
			}
		}
		if (!matchedAnyExpectation) {
			unmatchedFindings += 1;
		}
	}

	const total = expected.length;
	const caught = expected.reduce((count, expectation) => count + (perDefectClass[expectation.id] ? 1 : 0), 0);
	const catchRate = total === 0 ? 0 : caught / total;

	return { caught, total, catchRate, perDefectClass, unmatchedFindings };
}
