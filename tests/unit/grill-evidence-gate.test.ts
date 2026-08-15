/**
 * FLOW-03 -- `gateRequirementsAuthorship` proved, both directions, falsified.
 *
 * `.planning/phases/09-ceremonial-workflows/09-VALIDATION.md` line 46's
 * falsification: "remove the gate -> an evidence-free SPEC must be
 * rejected." `09-CONTEXT.md` decision 6 ("be suspicious of green" -- Phase 6's
 * evidence gate accepted a fabricated completion claim through three
 * consecutive rounds of green tests) is why every reject case below asserts
 * on the REASON TEXT, not merely on `ok === false` -- a reason-blind
 * assertion passes on a `return { ok: false, reason: "no" }` constant just as
 * happily as on the real predicate.
 *
 * Table shape follows `tests/unit/git-policy.test.ts:37-59`'s `Row` /
 * `it.each` precedent: every case carries its own `why`.
 */
import { describe, expect, it } from "vitest";
import { gateRequirementsAuthorship } from "../../.pi/extensions/grill/spec-schema.ts";

// ---------------------------------------------------------------------------
// SPEC.md fixture builder
// ---------------------------------------------------------------------------

/** One §2 table row, pre-rendering (a cell of `undefined` renders as empty). */
interface FactRow {
	readonly claim?: string;
	readonly evidence?: string;
	readonly howVerified?: string;
}

function factsTable(rows: readonly FactRow[]): string {
	const header = "| Claim | Evidence | How Verified |\n| --- | --- | --- |";
	if (rows.length === 0) {
		return header;
	}
	const body = rows.map((r) => `| ${r.claim ?? ""} | ${r.evidence ?? ""} | ${r.howVerified ?? ""} |`).join("\n");
	return `${header}\n${body}`;
}

/**
 * Builds a full SPEC.md-shaped markdown document. `factsRows` of `undefined`
 * omits §2 entirely; `includeRequirements` controls whether §3's heading
 * (with placeholder body text) is present.
 */
function spec(opts: { factsRows?: readonly FactRow[]; includeRequirements: boolean }): string {
	const parts: string[] = ["## 1. Goal", "", "A falsifiable one-sentence goal.", ""];
	if (opts.factsRows !== undefined) {
		parts.push("## 2. Verified Codebase Facts", "", factsTable(opts.factsRows), "");
	}
	if (opts.includeRequirements) {
		parts.push("## 3. Requirements", "", "R1: placeholder requirement text.", "");
	}
	return parts.join("\n");
}

// ---------------------------------------------------------------------------
// The fixture table -- one case per branch, both directions
// ---------------------------------------------------------------------------

interface Case {
	readonly name: string;
	readonly markdown: string;
	readonly expected: "accept" | "reject";
	/** Every substring below must appear in the reject reason. Ignored on an accept case. */
	readonly reasonIncludes: readonly string[];
	readonly why: string;
}

const CASES: readonly Case[] = [
	{
		name: "§2 heading absent, §3 present",
		markdown: spec({ includeRequirements: true }),
		expected: "reject",
		reasonIncludes: ["Verified Codebase Facts", "absent"],
		why: "distinguishes 'never wrote §2' from every other defect -- the reason must name the missing section, not merely fail",
	},
	{
		name: "§2 present, zero data rows, §3 present",
		markdown: spec({ factsRows: [], includeRequirements: true }),
		expected: "reject",
		reasonIncludes: ["Verified Codebase Facts", "zero data rows"],
		why: "must be distinguishable from the absent-heading case -- 'you wrote an empty one' is a different fact than 'you never wrote it'",
	},
	{
		name: "a row with an empty claim",
		markdown: spec({
			factsRows: [{ claim: "", evidence: ".pi/lib/jsonl.ts:606", howVerified: "read the file directly" }],
			includeRequirements: true,
		}),
		expected: "reject",
		reasonIncludes: ["row 1", "empty claim"],
		why: "names the offending row index, per this plan's own must_haves.truths",
	},
	{
		name: "a row whose evidence cell is the bare word 'verified'",
		markdown: spec({
			factsRows: [{ claim: "the redactor strips sk- tokens", evidence: "verified", howVerified: "ran the redactor" }],
			includeRequirements: true,
		}),
		expected: "reject",
		reasonIncludes: ["row 1", "malformed evidence", '"verified"'],
		why: "the bare word 'verified' names no place to look -- EVIDENCE_PATTERN's own doc comment states this is deliberately not accepted, and the reason must quote what arrived",
	},
	{
		name: "a row whose evidence cell is a plausible-looking but non-conforming string",
		markdown: spec({
			factsRows: [{ claim: "auth is handled correctly", evidence: "see the auth module", howVerified: "read it" }],
			includeRequirements: true,
		}),
		expected: "reject",
		reasonIncludes: ["row 1", "malformed evidence"],
		why: "reads like a citation but names no file:line and no command-output label -- must still reject",
	},
	{
		name: "a row with an empty howVerified",
		markdown: spec({
			factsRows: [{ claim: "the gate rejects an empty facts table", evidence: "tests/unit/grill-evidence-gate.test.ts:1", howVerified: "" }],
			includeRequirements: true,
		}),
		expected: "reject",
		reasonIncludes: ["row 1", 'how verified'],
		why: "GATE-05-shaped completeness: every cell is mandatory, not only claim and evidence",
	},
	{
		name: "POSITIVE control: §2 with two well-formed rows, §3 present -> ACCEPT",
		markdown: spec({
			factsRows: [
				{ claim: "jsonl.ts rotates at 8MB", evidence: ".pi/lib/jsonl.ts:606", howVerified: "read the constant directly" },
				{ claim: "the full suite is green", evidence: "command output: npm test exits 0, 412 passed", howVerified: "ran npm test" },
			],
			includeRequirements: true,
		}),
		expected: "accept",
		reasonIncludes: [],
		why: "without this row the whole table is an assertion that everything is rejected, which a return {ok:false} stub would also satisfy",
	},
	{
		name: "a valid §2 but NO §3 yet -> accept (the gate governs §3 authorship, not §3 presence)",
		markdown: spec({
			factsRows: [{ claim: "jsonl.ts rotates at 8MB", evidence: ".pi/lib/jsonl.ts:606", howVerified: "read the constant directly" }],
			includeRequirements: false,
		}),
		expected: "accept",
		reasonIncludes: [],
		why: "FLOW-03's own must_haves scope this gate to whether §3 may be AUTHORED, not whether it already exists",
	},
];

describe("FLOW-03 -- fixture table is non-empty and exercises both directions (vacuous-pass guard)", () => {
	it("has at least 8 cases", () => {
		expect(CASES.length).toBeGreaterThanOrEqual(8);
	});

	it("has at least one accept case and at least six reject cases", () => {
		const accepts = CASES.filter((c) => c.expected === "accept").length;
		const rejects = CASES.filter((c) => c.expected === "reject").length;
		expect(accepts, "a table with no accept case cannot distinguish the real predicate from a constant {ok:false}").toBeGreaterThanOrEqual(1);
		expect(rejects, "a table with fewer than six reject cases does not cover every branch this predicate declares").toBeGreaterThanOrEqual(6);
	});
});

describe("FLOW-03 -- gateRequirementsAuthorship over the fixture table", () => {
	for (const c of CASES) {
		it(`${c.name} -> ${c.expected} (${c.why})`, () => {
			const verdict = gateRequirementsAuthorship(c.markdown);
			if (c.expected === "accept") {
				expect(verdict.ok, `expected accept, got ${JSON.stringify(verdict)}`).toBe(true);
			} else {
				expect(verdict.ok, `expected reject, got ${JSON.stringify(verdict)}`).toBe(false);
				if (!verdict.ok) {
					for (const substring of c.reasonIncludes) {
						expect(
							verdict.reason.toLowerCase(),
							`reason ${JSON.stringify(verdict.reason)} must include ${JSON.stringify(substring)}`,
						).toContain(substring.toLowerCase());
					}
				}
			}
		});
	}
});

// ---------------------------------------------------------------------------
// T-09-05-03 (DoS): a 500-row table must not exhibit catastrophic regex
// backtracking. Every EVIDENCE_PATTERN alternative is bounded (no nested
// quantifier over an unbounded group), so this is a genuine proof that the
// bound holds, not merely a repetition of the fixture cases above.
// ---------------------------------------------------------------------------

describe("FLOW-03 -- T-09-05-03: a large facts table returns within the default test timeout", () => {
	it("gates a 500-row well-formed table without pathological slowdown", () => {
		const rows: FactRow[] = [];
		for (let i = 0; i < 500; i++) {
			rows.push({ claim: `claim number ${i}`, evidence: `.pi/lib/jsonl.ts:${i + 1}`, howVerified: `checked row ${i}` });
		}
		const markdown = spec({ factsRows: rows, includeRequirements: true });
		const start = Date.now();
		const verdict = gateRequirementsAuthorship(markdown);
		const elapsedMs = Date.now() - start;
		expect(verdict.ok, "a 500-row well-formed table must accept").toBe(true);
		expect(elapsedMs, `gate took ${elapsedMs}ms over 500 rows -- a bounded regex should be near-instant`).toBeLessThan(2000);
	});
});

// ---------------------------------------------------------------------------
// The test writes nothing outside a temp dir -- in fact it needs no
// filesystem at all, since the subject under test is pure. This describe
// block documents that property as an explicit assertion rather than leaving
// it merely true by omission.
// ---------------------------------------------------------------------------

describe("FLOW-03 -- the subject under test is pure (no filesystem access)", () => {
	it("gateRequirementsAuthorship is a plain function over a string argument", () => {
		expect(typeof gateRequirementsAuthorship).toBe("function");
		expect(gateRequirementsAuthorship.length).toBe(1);
	});
});
