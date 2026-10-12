/**
 * Parses SPEC.md §8 into the AmbiguityScorecard shape: a `| <dimension-id> | <score> |` pipe table plus an `Overall: <score>` line.
 * Pure. A malformed or absent row is returned as-is (empty dimensions, NaN score); gateAmbiguity reports the defect.
 */
import type { AmbiguityScorecard } from "./scorecard.ts";

/** A pipe-table data row; header and separator rows never match. */
const SCORECARD_ROW_PATTERN = /^\|\s*([\w-]+)\s*\|\s*([\d.]+)\s*\|\s*$/gm;

/** A bare `Overall: <n>` or `**Overall:** <n>` line, case-insensitive. */
const OVERALL_PATTERN = /overall\s*:?\**\s*([\d.]+)/i;

export function parseAmbiguityScorecard(sectionBody: string): AmbiguityScorecard {
	const dimensions = Array.from(sectionBody.matchAll(SCORECARD_ROW_PATTERN)).map((m) => ({
		id: m[1] ?? "",
		score: Number(m[2] ?? "NaN"),
	}));
	const overallMatch = OVERALL_PATTERN.exec(sectionBody);
	return { dimensions, overall: overallMatch ? Number(overallMatch[1]) : Number.NaN };
}
