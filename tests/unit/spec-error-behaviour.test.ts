/**
 * FLOW-04 / FLOW-05 (declaration half) / QUAL-03 -- the fixture-table proof
 * for `validateSpec` and `renderSpecMarkdown`
 * (`.pi/extensions/grill/spec-schema.ts`).
 *
 * Follows `tests/unit/git-policy.test.ts:37-59`'s table-driven fixture
 * idiom: each row carries a full SPEC.md markdown string (assembled by
 * {@link buildSpec}, a plain string template independent of the production
 * renderer under test, so this file never becomes a tautology against its
 * own subject), an expected verdict, and a `why`. Every reject case asserts
 * on the REASON TEXT, never merely `ok === false` -- a check that only
 * inspects the boolean cannot tell "rejected for the right reason" from
 * "rejected for a coincidental one" (this project's own `09-VALIDATION.md`
 * warning: "a test that cannot fail is not a verification").
 *
 * FALSIFICATIONS (a)-(d) are performed by editing
 * `.pi/extensions/grill/spec-schema.ts` IN PLACE, running this file, and
 * recording the RED output VERBATIM in `09-06-SUMMARY.md` -- committing
 * this test file BEFORE any mutation, per the 03-11 lesson ("a falsification
 * restore via `git checkout --` silently deleted uncommitted edits").
 */
import { describe, expect, it } from "vitest";

import { EXPECTED_FILE_PATTERN, IF_THEN_PATTERN, renderSpecMarkdown, validateSpec } from "../../.pi/extensions/grill/spec-schema.ts";

// ---------------------------------------------------------------------------
// buildSpec -- a full SPEC.md markdown string, assembled from named parts
// ---------------------------------------------------------------------------

interface SpecParts {
	goal: string;
	factsRows: string;
	requirements: string;
	errorBehaviours: string;
	inScope: string;
	outOfScope: string;
	expectedFiles: string;
	clarifications: string;
	assumptions: string;
	scorecard: string;
	/** A full `## Root Cause` block (heading, both fields), or omitted entirely. */
	rootCause?: string;
}

const WELL_FORMED_ERROR_BEHAVIOURS = [
	"- IF two checkpoint writers race on the same store file THEN THE SYSTEM SHALL serialise the writes with a file lock",
	"- IF a writer crashes mid-write THEN THE SYSTEM SHALL leave the prior committed row intact",
	"- IF the lock cannot be acquired within the timeout THEN THE SYSTEM SHALL reject the write with a named reason",
].join("\n");

/** A goal sentence carrying no {@link FIX_FRAMING_MARKERS} token, so the conditional Root Cause gate stays off by default. */
const NON_FIX_FRAMED_GOAL = "Add a file-scoped lock so concurrent checkpoint writers serialise their writes cleanly.";

/** A goal sentence carrying the "fix" marker, so the conditional Root Cause gate fires. */
const FIX_FRAMED_GOAL = "Fix the intermittent WR-09 checkpoint-store concurrency failure so the store test suite passes reliably.";

const DEFAULT_PARTS: SpecParts = {
	goal: NON_FIX_FRAMED_GOAL,
	factsRows: "| the store test fails intermittently in-suite only | tests/unit/checkpoint-store.test.ts:1 | ran the suite 30 times locally |",
	requirements: "R1: the concurrency test passes 10 consecutive full-suite runs.",
	errorBehaviours: WELL_FORMED_ERROR_BEHAVIOURS,
	inScope: "- .pi/extensions/checkpoint/store.ts",
	outOfScope: "- rewriting the checkpoint format entirely — out of scope for a concurrency fix",
	expectedFiles: "- .pi/extensions/checkpoint/store.ts\n- tests/unit/checkpoint-store.test.ts",
	clarifications: "- Q: should the lock be process-wide or file-scoped? -> A: file-scoped, per store.ts's own design.",
	assumptions: "- Assumes the OS file lock primitive is available on both Windows and macOS.",
	scorecard: "Score: 0.10 (all four dimensions above floor).",
};

/**
 * Assembles a full SPEC.md markdown string from named parts, overriding
 * only what a given fixture row needs to differ. A PLAIN string template --
 * never calls `renderSpecMarkdown` itself, so this fixture builder stays
 * independent of the production renderer the round-trip case (below)
 * separately exercises.
 */
function buildSpec(overrides: Partial<SpecParts> = {}): string {
	const p: SpecParts = { ...DEFAULT_PARTS, ...overrides };
	const rootCauseBlock = p.rootCause !== undefined ? `\n${p.rootCause}\n` : "";

	return `## 1. Goal

${p.goal}

## 2. Verified Codebase Facts

| Claim | Evidence | How Verified |
| --- | --- | --- |
${p.factsRows}

## 3. Requirements

${p.requirements}

## 4. Error and Edge Behaviour

${p.errorBehaviours}

## 5. Scope Pin

**In scope:**

${p.inScope}

**Out of scope:**

${p.outOfScope}

**Expected files:**

${p.expectedFiles}

## 6. Clarifications Log

${p.clarifications}

## 7. Assumptions

${p.assumptions}

## 8. Ambiguity Scorecard

${p.scorecard}
${rootCauseBlock}`;
}

function rootCauseBlock(cause: string, whyNotSymptom: string): string {
	return `## Root Cause\n\n**Cause:** ${cause}\n\n**Why not the symptom:** ${whyNotSymptom}\n`;
}

// ---------------------------------------------------------------------------
// The fixture table
// ---------------------------------------------------------------------------

interface Row {
	readonly name: string;
	readonly markdown: string;
	readonly expectOk: boolean;
	/** Present only for reject rows -- a substring the reason MUST contain. */
	readonly reasonIncludes?: string;
	readonly why: string;
}

const ROWS: readonly Row[] = [
	{
		name: "§4 with only 2 well-formed entries",
		markdown: buildSpec({ errorBehaviours: WELL_FORMED_ERROR_BEHAVIOURS.split("\n").slice(0, 2).join("\n") }),
		expectOk: false,
		reasonIncludes: "fewer than the required minimum of 3",
		why: "FLOW-04's own text: 'Mandatory, minimum 3 entries' -- 2 conforming entries is still a count defect, not a shape one",
	},
	{
		name: "§4 with 3 entries, one written as ordinary prose",
		markdown: buildSpec({
			errorBehaviours: [
				"- IF two checkpoint writers race on the same store file THEN THE SYSTEM SHALL serialise the writes with a file lock",
				"- The system should probably handle crashes gracefully somehow",
				"- IF the lock cannot be acquired within the timeout THEN THE SYSTEM SHALL reject the write with a named reason",
			].join("\n"),
		}),
		expectOk: false,
		reasonIncludes: "entry 2",
		why: "a count of 3 is not enough on its own -- each entry must independently match the IF/THEN/SHALL form, and the reason must quote the offending one",
	},
	{
		name: "§4 with a lower-case if/then/shall entry",
		markdown: buildSpec({
			errorBehaviours: [
				"- if two checkpoint writers race on the same store file then the system shall serialise the writes with a file lock",
				"- IF a writer crashes mid-write THEN THE SYSTEM SHALL leave the prior committed row intact",
				"- IF the lock cannot be acquired within the timeout THEN THE SYSTEM SHALL reject the write with a named reason",
			].join("\n"),
		}),
		expectOk: false,
		reasonIncludes: "entry 1",
		why: "case discipline is the whole point of the forcing function -- lower case must not satisfy it",
	},
	{
		name: "§4 with THE SYSTEM SHOULD instead of SHALL",
		markdown: buildSpec({
			errorBehaviours: [
				"- IF two checkpoint writers race on the same store file THEN THE SYSTEM SHALL serialise the writes with a file lock",
				"- IF a writer crashes mid-write THEN THE SYSTEM SHOULD leave the prior committed row intact",
				"- IF the lock cannot be acquired within the timeout THEN THE SYSTEM SHALL reject the write with a named reason",
			].join("\n"),
		}),
		expectOk: false,
		reasonIncludes: "entry 2",
		why: "SHOULD is a weaker, different modal than SHALL -- FEATURES.md's own prescribed word is SHALL, not a synonym",
	},
	{
		name: "§4 with an empty response clause",
		markdown: buildSpec({
			errorBehaviours: [
				"- IF two checkpoint writers race on the same store file THEN THE SYSTEM SHALL serialise the writes with a file lock",
				"- IF a writer crashes mid-write THEN THE SYSTEM SHALL",
				"- IF the lock cannot be acquired within the timeout THEN THE SYSTEM SHALL reject the write with a named reason",
			].join("\n"),
		}),
		expectOk: false,
		reasonIncludes: "entry 2",
		why: "a THEN clause with nothing after SHALL names no response -- IF_THEN_PATTERN's response capture requires a non-empty, non-whitespace-only group",
	},
	{
		name: "§4 with 3 conforming entries (positive control)",
		markdown: buildSpec({ errorBehaviours: WELL_FORMED_ERROR_BEHAVIOURS }),
		expectOk: true,
		why: "the shape §4 itself demands, with every other section also well-formed -- contributes to the required accept count",
	},
	{
		name: "§5 with an empty out-of-scope list",
		markdown: buildSpec({ outOfScope: "" }),
		expectOk: false,
		reasonIncludes: "out-of-scope list is empty",
		why: "FEATURES.md Part 2: 'Out-of-scope must be non-empty'",
	},
	{
		name: "§5 out-of-scope item with no reason",
		markdown: buildSpec({ outOfScope: "- rewriting the checkpoint format entirely" }),
		expectOk: false,
		reasonIncludes: "carries no reason",
		why: "FEATURES.md Part 2: 'each with a one-line reason' -- an item with no separator parses to an empty reason, which is a reject",
	},
	{
		name: "§5 with an empty expected-files list",
		markdown: buildSpec({ expectedFiles: "" }),
		expectOk: false,
		reasonIncludes: "expected-files list is empty",
		why: "FLOW-05's declaration half: the list is the input to /review's future drift detector and must exist",
	},
	{
		name: "§5 expected-files entry that is a glob",
		markdown: buildSpec({ expectedFiles: "- .pi/extensions/checkpoint/*.ts" }),
		expectOk: false,
		reasonIncludes: ".pi/extensions/checkpoint/*.ts",
		why: "a glob makes 'is this diffed path inside the declared union' undecidable without a matcher nobody has written [T-09-06-01]",
	},
	{
		name: "§5 expected-files entry containing ..",
		markdown: buildSpec({ expectedFiles: "- ../outside/store.ts" }),
		expectOk: false,
		reasonIncludes: "../outside/store.ts",
		why: "a parent-directory escape widens the drift detector's allowance outside the repo [T-09-06-01]",
	},
	{
		name: "fix-framed goal with NO Root Cause section",
		markdown: buildSpec({ goal: FIX_FRAMED_GOAL }),
		expectOk: false,
		reasonIncludes: 'carries no "Root Cause" section',
		why: "QUAL-03: a fix-framed change must carry a Root Cause section naming the cause with file:line evidence",
	},
	{
		name: "fix-framed goal, Root Cause with no file:line citation",
		markdown: buildSpec({
			goal: FIX_FRAMED_GOAL,
			rootCause: rootCauseBlock(
				"the store's write path had no lock at all, so two writers interleaved",
				"retrying the write would only mask the race, not remove it",
			),
		}),
		expectOk: false,
		reasonIncludes: "carries no file:line citation",
		why: "QUAL-03 requires file:line evidence WITHIN the cause narrative, not merely a plausible-sounding cause",
	},
	{
		name: "fix-framed goal, Root Cause whose why-not-symptom equals the cause",
		markdown: buildSpec({
			goal: FIX_FRAMED_GOAL,
			rootCause: rootCauseBlock(
				".pi/extensions/checkpoint/store.ts:177 opens the store file with no lock, so two concurrent writers interleave their writes.",
				".pi/extensions/checkpoint/store.ts:177 opens the store file with no lock, so two concurrent writers interleave their writes.",
			),
		}),
		expectOk: false,
		reasonIncludes: "identical to its cause text",
		why: "restating the cause is not an explanation of why the change addresses the cause rather than the symptom -- the two fields must be distinct",
	},
	{
		name: "NON-fix-framed goal with no Root Cause section",
		markdown: buildSpec({ goal: NON_FIX_FRAMED_GOAL }),
		expectOk: true,
		why:
			"proves QUAL-03's gate is CONDITIONAL, not universal -- without this case, an implementation that made the " +
			"Root Cause gate unconditional would still pass every other test in this file",
	},
	{
		name: "a fully well-formed SPEC",
		markdown: buildSpec({}),
		expectOk: true,
		why: "the baseline positive control, also used by the round-trip case below",
	},
];

describe("validateSpec -- FLOW-04 / FLOW-05 (declaration half) / QUAL-03", () => {
	it("the fixture table is non-vacuous: >= 14 rows, >= 2 accepts, >= 12 rejects", () => {
		expect(ROWS.length, "ROWS is too small for the loop below to be a meaningful proof").toBeGreaterThanOrEqual(14);
		expect(ROWS.filter((r) => r.expectOk).length).toBeGreaterThanOrEqual(2);
		expect(ROWS.filter((r) => !r.expectOk).length).toBeGreaterThanOrEqual(12);
	});

	it.each(ROWS)("$name -> $expectOk ($why)", (row) => {
		const result = validateSpec(row.markdown);
		expect(result.ok, `expected ok=${row.expectOk}, got ${JSON.stringify(result)}`).toBe(row.expectOk);
		if (!row.expectOk) {
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(
					result.reason.includes(row.reasonIncludes ?? ""),
					`reason "${result.reason}" must include "${row.reasonIncludes}"`,
				).toBe(true);
			}
		}
	});

	it("round-trips: renderSpecMarkdown(validateSpec(wellFormed).spec) is itself accepted by validateSpec", () => {
		const first = validateSpec(buildSpec({}));
		expect(first.ok).toBe(true);
		if (!first.ok) {
			return;
		}
		const rendered = renderSpecMarkdown(first.spec);
		const second = validateSpec(rendered);
		// This proves the renderer emits the shape the validator demands, nothing
		// more -- it does NOT prove the renderer reproduces every byte of the
		// original markdown, only that its OUTPUT independently passes the same gate.
		expect(second.ok, `re-validating the rendered markdown failed: ${JSON.stringify(second)}`).toBe(true);
	});

	it("[T-09-06-04] IF_THEN_PATTERN returns quickly against a 10 KB adversarial single entry", () => {
		const adversarial = `IF ${"a".repeat(9990)}`; // no "THEN THE SYSTEM SHALL" anywhere
		const start = Date.now();
		const matched = IF_THEN_PATTERN.test(adversarial);
		const elapsedMs = Date.now() - start;
		expect(matched).toBe(false);
		expect(elapsedMs, `IF_THEN_PATTERN took ${elapsedMs}ms against a 10 KB adversarial entry -- bounded quantifiers should keep this well under 1000ms`).toBeLessThan(
			1000,
		);
	});

	it("[T-09-06-01] EXPECTED_FILE_PATTERN rejects a leading slash directly (not only via validateSpec)", () => {
		expect(EXPECTED_FILE_PATTERN.test("/etc/passwd")).toBe(false);
	});
});
