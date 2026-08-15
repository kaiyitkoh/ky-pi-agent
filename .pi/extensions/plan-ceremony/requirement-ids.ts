/**
 * FLOW-06 -- SPEC §3 requirement id extraction, feeding validatePlan's
 * coverage-matrix argument.
 *
 * spec-schema.ts's SpecArtifact deliberately leaves `requirementsBody` as
 * free text -- FEATURES.md Part 2 prescribes the OVERALL "R1..Rn" convention
 * for §3 but no markdown structure for an individual requirement entry, the
 * same gap grill/scorecard-parse.ts closed for §8 (see 09-08-SUMMARY.md's own
 * deviation). This module's invention: every `R<digits>` token appearing
 * anywhere in §3's body IS a requirement id, deduplicated and sorted
 * numerically -- robust to whatever heading or bullet shape a model actually
 * writes, rather than betting on one unverified convention.
 *
 * PURE. No model call, no file read, registers nothing with Pi.
 */

/**
 * A requirement id token. Bounded (`\d{1,4}`) for the same
 * backtracking-safety discipline as spec-schema.ts's EVIDENCE_PATTERN -- no
 * nested quantifier over an unbounded group. Word-bounded on both sides so
 * "R2D2" is correctly rejected (no boundary between a digit and the letter
 * that follows it in the same word) while a bare "R2" is correctly accepted.
 */
export const REQUIREMENT_ID_PATTERN = /\bR\d{1,4}\b/g;

/**
 * Every distinct requirement id in `requirementsBody`, sorted numerically
 * ascending. `matchAll` is safe to call repeatedly against this shared,
 * `/g`-flagged constant -- per spec it operates on an internal clone and
 * never mutates the constant's own `lastIndex`.
 */
export function extractSpecRequirementIds(requirementsBody: string): readonly string[] {
	const ids = new Set<string>();
	for (const match of requirementsBody.matchAll(REQUIREMENT_ID_PATTERN)) {
		const token = match[0];
		if (token !== undefined) {
			ids.add(token);
		}
	}
	return Array.from(ids).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}
