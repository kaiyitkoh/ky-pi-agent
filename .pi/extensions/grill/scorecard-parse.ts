/**
 * Plan 09-08 -- parses SPEC.md's §8 (Ambiguity Scorecard) body text into the
 * {@link AmbiguityScorecard} shape `gateAmbiguity` (scorecard.ts, plan 09-07)
 * expects: a markdown pipe table of `| <dimension-id> | <score> |` rows plus
 * a bare `Overall: <score>` line -- the shape §8 is free text to render
 * (spec-schema.ts's `renderSpecMarkdown` leaves `scorecardBody` as-authored
 * for exactly this reason).
 *
 * PURE, NO I/O: no file read, no model call, nothing registered (BOOT-10).
 * A malformed or absent row is returned AS-IS -- an empty `dimensions` array,
 * or `NaN` for a missing score -- rather than dropped or defaulted, mirroring
 * `spec-schema.ts#parseVerifiedFacts`'s "never silently drop a malformed
 * row" discipline: `gateAmbiguity`'s own branch (1)/(2) shape and range
 * checks are what report the defect to the caller, not this parser.
 */
import type { AmbiguityScorecard } from "./scorecard.ts";

/** A pipe-table data row: `| <dimension-id> | <score> |`. A header or separator row never matches -- neither cell shape (word/hyphen id, numeric score) fits "Dimension"/"Score"/"---". */
const SCORECARD_ROW_PATTERN = /^\|\s*([\w-]+)\s*\|\s*([\d.]+)\s*\|\s*$/gm;

/** A bare `Overall: <n>` or `**Overall:** <n>` line, case-insensitive. */
const OVERALL_PATTERN = /overall\s*:?\**\s*([\d.]+)/i;

/** Parse §8's body text. See this module's own docstring for the shape and the malformed-input discipline. */
export function parseAmbiguityScorecard(sectionBody: string): AmbiguityScorecard {
	const dimensions = Array.from(sectionBody.matchAll(SCORECARD_ROW_PATTERN)).map((m) => ({
		id: m[1] ?? "",
		score: Number(m[2] ?? "NaN"),
	}));
	const overallMatch = OVERALL_PATTERN.exec(sectionBody);
	return { dimensions, overall: overallMatch ? Number(overallMatch[1]) : Number.NaN };
}
