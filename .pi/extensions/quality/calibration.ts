/**
 * Seeded-defect calibration scorer: pure, turns a reviewer's findings into a per-defect-class catch rate.
 * Scripted-reviewer results prove nothing about a live one; the live run is the runbook entry on live calibration in docs/RUNBOOK.md.
 * Registers nothing.
 */

/**
 * One seeded defect's grading data. Re-declared structurally from `tests/fixtures/seeded-defects/index.ts`
 * (the authority) because production code does not import from `tests/`.
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

/** The three `ReviewFinding` fields the scorer reads. */
export interface ScorableFinding {
	readonly severity: "BLOCKER" | "WARNING" | "NIT";
	readonly location: string;
	readonly concreteFailure: string;
}

/** `catchRate` is a raw ratio, never rounded and never paired with a verdict string. */
export interface CalibrationResult {
	/** Number of defect classes with at least one matching finding. */
	readonly caught: number;
	/** `expected.length`. */
	readonly total: number;
	/** `caught / total`, or `0` when `total` is `0`. */
	readonly catchRate: number;
	/** One entry per `expected` id, `true` iff at least one finding matched it. */
	readonly perDefectClass: Readonly<Record<string, boolean>>;
	/** Findings matching no expectation; reported, never subtracted, so a shotgun reviewer stays visible. */
	readonly unmatchedFindings: number;
}

/** NIT is deliberately the lowest rank — `minimumSeverity` is only ever "BLOCKER" or "WARNING", never "NIT". */
const SEVERITY_RANK: Readonly<Record<ScorableFinding["severity"], number>> = {
	NIT: 0,
	WARNING: 1,
	BLOCKER: 2,
};

/**
 * Minimum distinct `mustMentionAny` needles per finding. One generic needle per class, reused verbatim, scored a full
 * catch rate without analysis; `Math.min` keeps single-needle expectations working. Cross-contamination in
 * {@link findingCatches} closes the residual.
 */
const MIN_DISTINCT_NEEDLES = 2;

/** True when `haystack` holds MIN_DISTINCT_NEEDLES of the expectation's needles, or all of them when it has fewer. */
function clearsNeedleBar(haystack: string, expectation: SeededDefectExpectation): boolean {
	const matched = expectation.mustMentionAny.filter((needle) => haystack.includes(needle)).length;
	return matched >= Math.min(MIN_DISTINCT_NEEDLES, expectation.mustMentionAny.length);
}

/**
 * True iff the finding names `locationFile`, carries enough distinct needles, has at least the minimum severity,
 * and does NOT also clear a different expectation's needle bar (boilerplate reused across every file).
 */
function findingCatches(finding: ScorableFinding, expectation: SeededDefectExpectation, all: readonly SeededDefectExpectation[]): boolean {
	const haystack = `${finding.concreteFailure} ${finding.location}`;
	return (
		finding.location.includes(expectation.locationFile) &&
		clearsNeedleBar(haystack, expectation) &&
		!all.some((other) => other.id !== expectation.id && clearsNeedleBar(haystack, other)) &&
		SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[expectation.minimumSeverity]
	);
}

/** Marks each expectation caught by any finding; `caught` counts classes once, so quantity of findings cannot raise it. */
export function scoreCalibration(
	expected: readonly SeededDefectExpectation[],
	findings: readonly ScorableFinding[],
): CalibrationResult {
	const perDefectClass: Record<string, boolean> = Object.fromEntries(expected.map((e) => [e.id, false]));
	let unmatchedFindings = 0;
	for (const finding of findings) {
		const caughtBy = expected.filter((expectation) => findingCatches(finding, expectation, expected));
		for (const expectation of caughtBy) perDefectClass[expectation.id] = true;
		if (caughtBy.length === 0) unmatchedFindings += 1;
	}
	const total = expected.length;
	const caught = expected.filter((expectation) => perDefectClass[expectation.id]).length;
	return { caught, total, catchRate: total === 0 ? 0 : caught / total, perDefectClass, unmatchedFindings };
}
