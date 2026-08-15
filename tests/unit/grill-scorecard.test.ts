/**
 * FLOW-02 — proving the ambiguity scorecard blocks for the RIGHT reason in
 * both directions, and that the hard question budget is hard at exactly its
 * stated number.
 *
 * Table-driven, per `tests/unit/git-policy.test.ts`'s `{ ..., why }` fixture
 * idiom. `09-CONTEXT.md` decision 6 ("be suspicious of green") and this
 * project's own standing lesson (a one-directional assertion passes on a
 * constant) are why every reject case below asserts on REASON TEXT naming
 * the offending dimension/value, never merely `ok === false`, and why a
 * positive control (case 1) exists at all -- without it this whole suite
 * would be satisfied by `gateAmbiguity` that always returns `{ ok: false }`.
 *
 * FALSIFICATIONS (a)-(e) are run manually against a mutated copy of
 * `scorecard.ts` and their verbatim RED output is recorded in this plan's
 * `09-07-SUMMARY.md`, per this repository's falsification protocol
 * (`08-05-SUMMARY.md`'s precedent) -- they are not encoded as vitest cases,
 * since a falsification exercises "does removing the mechanism turn this RED",
 * which by definition mutates production source outside this file's own
 * scope.
 */
import { describe, expect, it } from "vitest";
import {
	AMBIGUITY_DIMENSIONS,
	HARD_QUESTION_BUDGET,
	INTERVIEW_PERSPECTIVES,
	SCORE_GATE,
	assumptionsFromUnmetFloors,
	gateAmbiguity,
	nextQuestionSlot,
	type AmbiguityScorecard,
} from "../../.pi/extensions/grill/scorecard.ts";

/** Every dimension id, in AMBIGUITY_DIMENSIONS' own declared order. */
const ALL_IDS = AMBIGUITY_DIMENSIONS.map((d) => d.id);

/**
 * Builds a full scorecard: every declared dimension scored `1.0` by default,
 * `overrides` replacing specific dimensions, `overall` set explicitly. Test
 * helper only -- production code never constructs a scorecard this way.
 */
function scorecard(overrides: Partial<Record<string, number>>, overall: number, options?: { omit?: string[]; extra?: Record<string, number> }): AmbiguityScorecard {
	const omit = new Set(options?.omit ?? []);
	const dims: { id: string; score: number }[] = ALL_IDS.filter((id) => !omit.has(id)).map((id) => ({ id, score: overrides[id] ?? 1.0 }));
	for (const [id, score] of Object.entries(options?.extra ?? {})) {
		dims.push({ id, score });
	}
	return { dimensions: dims, overall };
}

describe("FLOW-02 -- gateAmbiguity, both directions", () => {
	interface Row {
		readonly name: string;
		readonly card: AmbiguityScorecard;
		readonly expected: "accept" | "reject";
		readonly reasonIncludes?: readonly string[];
		readonly why: string;
	}

	const ROWS: readonly Row[] = [
		{
			name: "all four floors met, overall well under the gate",
			card: scorecard({}, 0.1),
			expected: "accept",
			why: "the positive control -- without this case the suite is satisfied by a constant reject",
		},
		{
			name: "all four floors met, overall === SCORE_GATE exactly",
			card: scorecard({}, SCORE_GATE),
			expected: "accept",
			why: "boundary, inclusive per FEATURES.md's own '≤ 0.20' wording",
		},
		{
			name: "every floor scored EXACTLY at its own floor value",
			card: scorecard(Object.fromEntries(AMBIGUITY_DIMENSIONS.map((d) => [d.id, d.floor])), 0.1),
			expected: "accept",
			why: "score === floor is not a floor violation -- boundary, inclusive",
		},
		{
			name: "all four floors met, overall === SCORE_GATE + 0.01",
			card: scorecard({}, SCORE_GATE + 0.01),
			expected: "reject",
			reasonIncludes: [String(SCORE_GATE + 0.01), String(SCORE_GATE)],
			why: "an over-gate score blocks even though every individual floor is met",
		},
		{
			name: "one dimension one hundredth below its floor, overall well under the gate",
			card: scorecard({ "factual-grounding": 0.69 }, 0.05),
			expected: "reject",
			reasonIncludes: ["Factual Grounding"],
			why: "proves the floors are not decorative -- a good average cannot launder one failing dimension",
		},
		{
			name: "two dimensions below floor",
			card: scorecard({ "factual-grounding": 0.65, "failure-coverage": 0.6 }, 0.05),
			expected: "reject",
			reasonIncludes: ["Factual Grounding", "Failure Coverage"],
			why: "both offending dimensions must be named, not just the first",
		},
		{
			name: "a declared dimension omitted from the scorecard",
			card: scorecard({}, 0.05, { omit: ["scope-definiteness"] }),
			expected: "reject",
			reasonIncludes: ["scope-definiteness"],
			why: "malformed input -- missing direction",
		},
		{
			name: "a dimension present that is not in AMBIGUITY_DIMENSIONS",
			card: scorecard({}, 0.05, { extra: { novelty: 0.9 } }),
			expected: "reject",
			reasonIncludes: ["novelty"],
			why: "malformed input -- invented direction",
		},
		{
			name: "a dimension score of 1.5 (above range)",
			card: scorecard({ "requirement-precision": 1.5 }, 0.05),
			expected: "reject",
			reasonIncludes: ["requirement-precision", "1.5"],
			why: "range check must fire even though 1.5 would otherwise read as a very good score",
		},
		{
			name: "a dimension score of -0.1 (below range)",
			card: scorecard({ "requirement-precision": -0.1 }, 0.05),
			expected: "reject",
			reasonIncludes: ["requirement-precision", "-0.1"],
			why: "range check must fire in the negative direction too",
		},
	];

	it("declares at least 2 accept and 7 reject rows (guards against a vacuous pass)", () => {
		const accepts = ROWS.filter((r) => r.expected === "accept");
		const rejects = ROWS.filter((r) => r.expected === "reject");
		expect(accepts.length, "too few accept rows -- see this file's own header for why a positive control is required").toBeGreaterThanOrEqual(2);
		expect(rejects.length, "too few reject rows").toBeGreaterThanOrEqual(7);
	});

	it.each(ROWS)("$name", (row) => {
		const verdict = gateAmbiguity(row.card);
		if (row.expected === "accept") {
			expect(verdict.ok, `expected ACCEPT (${row.why}) but got: ${verdict.ok ? "" : (verdict as { reason: string }).reason}`).toBe(true);
			return;
		}
		expect(verdict.ok, `expected REJECT (${row.why}) but the scorecard was accepted`).toBe(false);
		const reason = (verdict as { ok: false; reason: string }).reason;
		for (const fragment of row.reasonIncludes ?? []) {
			expect(reason, `reject reason "${reason}" does not mention "${fragment}" (${row.why})`).toContain(fragment);
		}
	});
});

describe("FLOW-02 -- nextQuestionSlot: one question at a time, rotating perspectives, hard budget", () => {
	it("askedCount 0..HARD_QUESTION_BUDGET-1 each return a slot, and the visited perspective SET covers every entry", () => {
		const visited = new Set<string>();
		for (let asked = 0; asked < HARD_QUESTION_BUDGET; asked++) {
			const slot = nextQuestionSlot(asked);
			expect("exhausted" in slot, `askedCount=${asked} returned exhausted before the budget was reached`).toBe(false);
			if (!("exhausted" in slot)) {
				visited.add(slot.perspective);
			}
		}
		const allPerspectiveIds = INTERVIEW_PERSPECTIVES.map((p) => p.id);
		expect(
			[...visited].sort(),
			"the visited perspective SET must cover every declared perspective when the budget allows -- asserting only the first two calls would miss a rotation that repeats early",
		).toEqual([...allPerspectiveIds].sort());
	});

	it("askedCount === HARD_QUESTION_BUDGET returns the exhausted arm, reason naming both numbers", () => {
		const slot = nextQuestionSlot(HARD_QUESTION_BUDGET);
		expect("exhausted" in slot).toBe(true);
		if ("exhausted" in slot) {
			expect(slot.reason).toContain(String(HARD_QUESTION_BUDGET));
		}
	});

	it("askedCount === HARD_QUESTION_BUDGET + 10 is ALSO exhausted -- no wraparound past the budget", () => {
		const slot = nextQuestionSlot(HARD_QUESTION_BUDGET + 10);
		expect("exhausted" in slot, "a budget that wraps around is a soft budget, not a hard one").toBe(true);
	});

	it("consecutive calls never return the same perspective twice in a row (the rotation property)", () => {
		expect(
			INTERVIEW_PERSPECTIVES.length,
			"this property is only meaningful with more than one perspective",
		).toBeGreaterThan(1);
		for (let asked = 0; asked < HARD_QUESTION_BUDGET - 1; asked++) {
			const current = nextQuestionSlot(asked);
			const next = nextQuestionSlot(asked + 1);
			if (!("exhausted" in current) && !("exhausted" in next)) {
				expect(next.perspective, `askedCount=${asked} and ${asked + 1} returned the same perspective`).not.toBe(current.perspective);
			}
		}
	});
});

describe("FLOW-02 -- assumptionsFromUnmetFloors", () => {
	it("returns one ⚠ ASSUMPTION-stamped line per unmet dimension", () => {
		const card = scorecard({ "factual-grounding": 0.65, "failure-coverage": 0.6 }, 0.05);
		const lines = assumptionsFromUnmetFloors(card);
		expect(lines.length).toBe(2);
		for (const line of lines) {
			expect(line.startsWith("⚠ ASSUMPTION")).toBe(true);
		}
		expect(lines.some((l) => l.includes("Factual Grounding"))).toBe(true);
		expect(lines.some((l) => l.includes("Failure Coverage"))).toBe(true);
	});

	it("returns an empty array when every floor is met", () => {
		const card = scorecard({}, 0.05);
		expect(assumptionsFromUnmetFloors(card)).toEqual([]);
	});
});
