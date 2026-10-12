/**
 * SPEC §3 requirement id extraction.
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

/** A line that opens an entry: list, quote, heading or bold markers, then the id (`- **R1** -`, `R1.`, `R1:`). */
const ENTRY_START_PATTERN = /^[\s>*#-]*(R\d{1,4})\b/;

/** §3 split into one entry per id, each running from its opening line to the next; line-based, so no length cap. */
export function parseRequirementEntries(requirementsBody: string): readonly { readonly id: string; readonly text: string }[] {
	const entries: { id: string; lines: string[] }[] = [];
	for (const line of requirementsBody.split("\n")) {
		const id = ENTRY_START_PATTERN.exec(line)?.[1];
		if (id !== undefined) entries.push({ id, lines: [line] });
		else entries.at(-1)?.lines.push(line);
	}
	return entries.map((e) => ({ id: e.id, text: e.lines.join("\n").trim() }));
}

/** Ids mentioned in §3 that never open an entry of their own; a SPEC with any is refused rather than handed off short. */
export function requirementIdsWithoutEntry(requirementsBody: string): readonly string[] {
	const opened = new Set(parseRequirementEntries(requirementsBody).map((e) => e.id));
	return extractSpecRequirementIds(requirementsBody).filter((id) => !opened.has(id));
}
