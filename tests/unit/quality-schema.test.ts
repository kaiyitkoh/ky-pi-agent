/**
 * GATE-03 / GATE-04 / GATE-05 / QUAL-04 / QUAL-06 -- `validateReview` proven
 * live in both directions.
 *
 * Following `chokepoint-lint.test.ts`/`contributing-boundary.test.ts`'s
 * vacuity-guard discipline and this repo's own `quality-rules.test.ts`
 * mutation-baseline pattern: every rejection case below mutates EXACTLY ONE
 * field of a single valid baseline review object, so each rejection is
 * attributable to that field and nothing else. The vacuity-guard case (the
 * unmutated baseline validates OK) runs first and is named as such --
 * without it, every rejection case below could be passing for the wrong
 * reason (a validator that rejects everything would pass every "reject"
 * assertion here and nothing would catch it).
 *
 * Every rejection case also asserts its reason string CONTAINS the
 * offending value or the field name -- an opaque rejection is one the
 * executor cannot act on, and this project has already shipped that mistake
 * once (evidence.ts's pre-CR-01 fabricated-claim hole).
 */
import { describe, expect, it } from "vitest";

import { NIT_CAP, validateReview } from "../../.pi/extensions/quality/review-schema.ts";

const EXPECTED_IDS = ["GATE-03", "GATE-04"] as const;

/** Deep clone via JSON round-trip -- every fixture below is plain JSON-safe data. */
function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * The ONE valid baseline every rejection case mutates exactly one field of.
 * Covers both `EXPECTED_IDS`, carries one non-NIT finding, a non-empty
 * `checkedAndCleared`, and a `root-cause` classification (so the workaround
 * fields are legitimately absent here).
 */
function baseline(): Record<string, unknown> {
	return {
		verdicts: [
			{ requirementId: "GATE-03", status: "Implemented", evidence: "src/foo.ts:42" },
			{ requirementId: "GATE-04", status: "Partial", evidence: "src/bar.ts:7" },
		],
		findings: [
			{
				severity: "WARNING",
				location: "src/foo.ts:10",
				concreteFailure: "off-by-one in the loop bound",
				suggestedFix: "use < instead of <=",
			},
		],
		checkedAndCleared: "Checked the error paths in bar.ts and confirmed they return actionable messages.",
		classification: "root-cause",
		classificationJustification: "The fix addresses the actual bound calculation, not a downstream symptom.",
	};
}

function expectRejects(raw: unknown, expectedIds: readonly string[] = EXPECTED_IDS): string {
	const result = validateReview(raw, expectedIds);
	expect(result.ok, "expected validateReview to REJECT this fixture, but it accepted").toBe(false);
	return (result as { ok: false; reason: string }).reason;
}

function expectAccepts(raw: unknown, expectedIds: readonly string[] = EXPECTED_IDS) {
	const result = validateReview(raw, expectedIds);
	expect(
		result.ok,
		result.ok ? "" : `expected validateReview to ACCEPT this fixture, but it rejected: ${(result as { ok: false; reason: string }).reason}`,
	).toBe(true);
	return result as { ok: true; review: unknown };
}

// ---------------------------------------------------------------------------
// Vacuity guard -- runs first
// ---------------------------------------------------------------------------

describe("vacuity guard", () => {
	it("accepts the unmutated baseline -- every rejection case below mutates exactly one field of this same object", () => {
		expectAccepts(baseline());
	});
});

// ---------------------------------------------------------------------------
// "verdict" -- coverage and evidence shape
// ---------------------------------------------------------------------------

describe("verdict", () => {
	it("rejects a missing requirement id, naming it", () => {
		const review = baseline();
		(review.verdicts as unknown[]).splice(1, 1); // drop the GATE-04 verdict
		const reason = expectRejects(review);
		expect(reason).toContain("GATE-04");
	});

	it("rejects an extra invented requirement id, naming it", () => {
		const review = baseline();
		(review.verdicts as unknown[]).push({ requirementId: "GATE-99", status: "Implemented", evidence: "src/x.ts:1" });
		const reason = expectRejects(review);
		expect(reason).toContain("GATE-99");
	});

	it('rejects malformed evidence "src/x.ts" (no line number), naming the offending string', () => {
		const review = baseline();
		(review.verdicts as { evidence: string }[])[0].evidence = "src/x.ts";
		const reason = expectRejects(review);
		expect(reason).toContain("src/x.ts");
	});

	it('rejects malformed evidence "nowhere" (no path:line shape at all), naming the offending string', () => {
		const review = baseline();
		(review.verdicts as { evidence: string }[])[0].evidence = "nowhere";
		const reason = expectRejects(review);
		expect(reason).toContain("nowhere");
	});

	it('rejects malformed evidence "" (empty), naming the evidence field', () => {
		const review = baseline();
		(review.verdicts as { evidence: string }[])[0].evidence = "";
		const reason = expectRejects(review);
		expect(reason).toContain("evidence");
	});

	it("accepts a valid file:line evidence string", () => {
		const review = baseline();
		(review.verdicts as { evidence: string }[])[0].evidence = "src/deeply/nested/module.ts:1234";
		expectAccepts(review);
	});
});

// ---------------------------------------------------------------------------
// "malformed" -- GATE-05, an unclassified finding rejected by code
// ---------------------------------------------------------------------------

describe("malformed", () => {
	it('rejects severity "blocker" (wrong case), naming the offending value', () => {
		const review = baseline();
		(review.findings as { severity: string }[])[0].severity = "blocker";
		const reason = expectRejects(review);
		expect(reason).toContain("blocker");
	});

	it('rejects severity "CRITICAL" (unknown token), naming the offending value', () => {
		const review = baseline();
		(review.findings as { severity: string }[])[0].severity = "CRITICAL";
		const reason = expectRejects(review);
		expect(reason).toContain("CRITICAL");
	});

	it('rejects severity "" (empty), naming the severity field', () => {
		const review = baseline();
		(review.findings as { severity: string }[])[0].severity = "";
		const reason = expectRejects(review);
		expect(reason).toContain("severity");
	});

	it("rejects an absent severity field, naming the severity field", () => {
		const review = baseline();
		delete (review.findings as Record<string, unknown>[])[0].severity;
		const reason = expectRejects(review);
		expect(reason).toContain("severity");
	});

	it('rejects the literal string "LGTM" as the whole submit_review payload', () => {
		const reason = expectRejects("LGTM");
		expect(reason).toContain("object");
	});

	it("accepts a review with zero findings and a non-empty checkedAndCleared (a genuinely clean review stays expressible)", () => {
		const review = baseline();
		review.findings = [];
		expectAccepts(review);
	});
});

// ---------------------------------------------------------------------------
// "checked and cleared" -- GATE-04, silence must be structurally impossible
// ---------------------------------------------------------------------------

describe("checked and cleared", () => {
	it("rejects an absent checkedAndCleared, naming the field", () => {
		const review = baseline();
		delete review.checkedAndCleared;
		const reason = expectRejects(review);
		expect(reason).toContain("checkedAndCleared");
	});

	it('rejects checkedAndCleared === "" (empty), naming the field', () => {
		const review = baseline();
		review.checkedAndCleared = "";
		const reason = expectRejects(review);
		expect(reason).toContain("checkedAndCleared");
	});

	it('rejects checkedAndCleared === "   " (whitespace-only), naming the field', () => {
		const review = baseline();
		review.checkedAndCleared = "   ";
		const reason = expectRejects(review);
		expect(reason).toContain("checkedAndCleared");
	});

	it("accepts a one-sentence checkedAndCleared", () => {
		const review = baseline();
		review.checkedAndCleared = "Read every error path in the module and confirmed each one returns an actionable message.";
		expectAccepts(review);
	});
});

// ---------------------------------------------------------------------------
// "classification" -- QUAL-04
// ---------------------------------------------------------------------------

describe("classification", () => {
	it("rejects an absent classification, naming the field", () => {
		const review = baseline();
		delete review.classification;
		const reason = expectRejects(review);
		expect(reason).toContain("classification");
	});

	it('rejects an unknown classification token ("refactor"), naming the offending value', () => {
		const review = baseline();
		review.classification = "refactor";
		const reason = expectRejects(review);
		expect(reason).toContain("refactor");
	});

	it("rejects an empty classificationJustification, naming the field", () => {
		const review = baseline();
		review.classificationJustification = "";
		const reason = expectRejects(review);
		expect(reason).toContain("classificationJustification");
	});
});

// ---------------------------------------------------------------------------
// "workaround" -- QUAL-06, a workaround must be recorded with its debt
// ---------------------------------------------------------------------------

describe("workaround", () => {
	it("rejects classification=workaround with no properFix, naming properFix", () => {
		const review = baseline();
		review.classification = "workaround";
		review.deferralReason = "Deadline pressure; proper fix needs a schema migration.";
		const reason = expectRejects(review);
		expect(reason).toContain("properFix");
	});

	it("rejects classification=workaround with no deferralReason, naming deferralReason", () => {
		const review = baseline();
		review.classification = "workaround";
		review.properFix = "Add a proper index instead of the linear scan.";
		const reason = expectRejects(review);
		expect(reason).toContain("deferralReason");
	});

	it("accepts classification=workaround with both properFix and deferralReason present", () => {
		const review = baseline();
		review.classification = "workaround";
		review.properFix = "Add a proper index instead of the linear scan.";
		review.deferralReason = "Deadline pressure; proper fix needs a schema migration.";
		expectAccepts(review);
	});
});

// ---------------------------------------------------------------------------
// NIT cap
// ---------------------------------------------------------------------------

function nitFindings(count: number): unknown[] {
	return Array.from({ length: count }, (_, i) => ({
		severity: "NIT",
		location: `src/nit-${i}.ts:${i + 1}`,
		concreteFailure: `trivial style nit #${i}`,
		suggestedFix: "rename for clarity",
	}));
}

describe("NIT cap", () => {
	it(`rejects ${NIT_CAP + 1} NIT findings, naming the count and the cap`, () => {
		const review = baseline();
		review.findings = nitFindings(NIT_CAP + 1);
		const reason = expectRejects(review);
		expect(reason).toContain(String(NIT_CAP + 1));
		expect(reason).toContain(String(NIT_CAP));
	});

	it(`accepts exactly ${NIT_CAP} NIT findings`, () => {
		const review = baseline();
		review.findings = nitFindings(NIT_CAP);
		expectAccepts(review);
	});
});

// ---------------------------------------------------------------------------
// clone() sanity -- guards against a shared-reference bug silently coupling
// two "independent" mutation cases above through one shared baseline object.
// ---------------------------------------------------------------------------

describe("clone() sanity", () => {
	it("two separate baseline() calls do not share array/object references", () => {
		const a = baseline();
		const b = baseline();
		expect(a.verdicts).not.toBe(b.verdicts);
		expect((a.verdicts as unknown[])[0]).not.toBe((b.verdicts as unknown[])[0]);
	});

	it("clone() produces a value equal to, but not referentially identical to, its input", () => {
		const original = { nested: { value: 1 } };
		const cloned = clone(original);
		expect(cloned).toEqual(original);
		expect(cloned).not.toBe(original);
		expect(cloned.nested).not.toBe(original.nested);
	});
});
