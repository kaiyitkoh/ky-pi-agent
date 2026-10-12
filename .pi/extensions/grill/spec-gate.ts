/**
 * The one SPEC gate, applied when SPEC.md is written and again wherever it is read: a SPEC.md the model wrote with
 * the ordinary write tool must never be trusted for passing a shape check alone. Pure.
 */
import { extractSpecRequirementIds, requirementIdsWithoutEntry } from "../plan-ceremony/requirement-ids.ts";
import { gateAmbiguity } from "./scorecard.ts";
import { parseAmbiguityScorecard } from "./scorecard-parse.ts";
import { validateSpec, type SpecValidation } from "./spec-schema.ts";

/** validateSpec plus: §3 declares at least one R<n> id and every id opens its own entry, §6 and §7 are non-empty, and §8 clears gateAmbiguity. */
export function validateGatedSpec(markdown: string): SpecValidation {
	const validated = validateSpec(markdown);
	if (!validated.ok) return validated;
	const { spec } = validated;
	if (extractSpecRequirementIds(spec.requirementsBody).length === 0) {
		return { ok: false, reason: "the Requirements section (§3) declares no R<n> requirement id" };
	}
	const orphans = requirementIdsWithoutEntry(spec.requirementsBody);
	if (orphans.length > 0) {
		return { ok: false, reason: `the Requirements section (§3) mentions ${orphans.join(", ")} but no line starts that requirement's own entry` };
	}
	if (spec.clarificationsBody === "") return { ok: false, reason: "the Clarifications Log section (§6) is absent or empty" };
	if (spec.assumptionsBody === "") return { ok: false, reason: "the Assumptions section (§7) is absent or empty" };
	const ambiguity = gateAmbiguity(parseAmbiguityScorecard(spec.scorecardBody));
	if (!ambiguity.ok) return { ok: false, reason: `the Ambiguity Scorecard section (§8) fails its gate: ${ambiguity.reason}` };
	return validated;
}
