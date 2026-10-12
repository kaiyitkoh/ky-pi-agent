/**
 * SPEC §3 requirement id extraction for validatePlan's coverage matrix.
 * Spec §3 is free text, so every `R<digits>` token in its body is an id, deduplicated and sorted numerically. Pure.
 */

/** A requirement id token. Bounded to 1-4 digits against backtracking; word-bounded so "R2D2" is rejected. */
export const REQUIREMENT_ID_PATTERN = /\bR\d{1,4}\b/g;

/** Distinct requirement ids, sorted ascending. `matchAll` on this /g constant is safe: it works on a clone. */
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
