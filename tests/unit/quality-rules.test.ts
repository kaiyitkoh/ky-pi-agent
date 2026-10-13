/**
 * The six anti-pattern rules, live in both directions: each fires on an inline fixture, stays quiet on this repo's
 * deliberate style, all six trip one combined fixture, and the real-source error count is a recorded number. Also
 * covers both directions of SCAN_EXEMPT_PREFIXES and SUPPRESSION_MARKER, and that a broken source does not throw.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";
import {
	N_PLUS_ONE_CALLEES,
	RULE_IDS,
	type QualityFinding,
	type QualitySource,
	type RuleId,
	ruleCopyPaste,
	ruleLiteralSpecialCase,
	ruleMagicNumber,
	ruleNPlusOne,
	ruleShippedTodo,
	ruleSwallowedException,
	runAntiPatternRules,
} from "../../.pi/extensions/quality/rules.ts";

const RULE_FNS: Record<RuleId, (source: QualitySource) => QualityFinding[]> = {
	"magic-number": ruleMagicNumber,
	"literal-special-case": ruleLiteralSpecialCase,
	"copy-paste": ruleCopyPaste,
	"swallowed-exception": ruleSwallowedException,
	"shipped-todo": ruleShippedTodo,
	"n-plus-one": ruleNPlusOne,
};

// ---------------------------------------------------------------------------
// Group A — per-rule POSITIVE, inline fixtures only
// ---------------------------------------------------------------------------

const POSITIVE_FIXTURES: { readonly ruleId: RuleId; readonly text: string }[] = [
	{
		ruleId: "magic-number",
		text: [
			"function checkQuota(): boolean {",
			"\tif (getRemaining() > 37) {",
			"\t\treturn true;",
			"\t}",
			"\treturn false;",
			"}",
			"",
		].join("\n"),
	},
	{
		ruleId: "literal-special-case",
		text: [
			"function classify(kind: string): number {",
			'\tif (kind === "urgent") {',
			"\t\treturn 1;",
			"\t}",
			"\treturn 0;",
			"}",
			"",
		].join("\n"),
	},
	{
		ruleId: "copy-paste",
		text: [
			"function runFirst(): void {",
			"\tconst a = 1;",
			"\tconst b = 2;",
			"\tconst c = 3;",
			"\tconst d = 4;",
			"\tconst e = 5;",
			"\tconst f = 6;",
			"\tconst g = 7;",
			"\tconst h = 8;",
			"\tconst i = 9;",
			"\tconst j = 10;",
			"\tconst k = 11;",
			"\tconst l = 12;",
			"\tconsole.log(a, b, c, d, e, f, g, h, i, j, k, l);",
			"}",
			"",
			"function runSecond(): void {",
			"\tconst a = 1;",
			"\tconst b = 2;",
			"\tconst c = 3;",
			"\tconst d = 4;",
			"\tconst e = 5;",
			"\tconst f = 6;",
			"\tconst g = 7;",
			"\tconst h = 8;",
			"\tconst i = 9;",
			"\tconst j = 10;",
			"\tconst k = 11;",
			"\tconst l = 12;",
			"\tconsole.log(a, b, c, d, e, f, g, h, i, j, k, l);",
			"}",
			"",
		].join("\n"),
	},
	{
		ruleId: "swallowed-exception",
		text: ["function risky(): void {", "\ttry {", "\t\tdoSomething();", "\t} catch {", "\t}", "}", ""].join("\n"),
	},
	{
		ruleId: "shipped-todo",
		text: ["// TODO: revisit this before shipping", "function loadConfig(): void {}", ""].join("\n"),
	},
	{
		ruleId: "n-plus-one",
		text: [
			"async function loadAll(items: string[]): Promise<void> {",
			"\tfor (const item of items) {",
			"\t\tawait query(item);",
			"\t}",
			"}",
			"",
		].join("\n"),
	},
];

describe("QUAL-01 Group A — per-rule positive (inline fixtures)", () => {
	it.each(POSITIVE_FIXTURES)("$ruleId fires against its own offending inline fixture", ({ ruleId, text }) => {
		const source: QualitySource = { path: `src/${ruleId}-positive.ts`, text };
		const findings = RULE_FNS[ruleId](source);
		expect(findings.length, `${ruleId} matched nothing in its own positive fixture`).toBeGreaterThanOrEqual(1);
		expect(findings.every((f) => f.ruleId === ruleId)).toBe(true);
		expect(findings.every((f) => f.line >= 1)).toBe(true);
	});

	it("covers every declared rule id — a rule missing from this table is unproven by construction", () => {
		const covered = new Set(POSITIVE_FIXTURES.map((f) => f.ruleId));
		const missing = RULE_IDS.filter((id) => !covered.has(id));
		expect(missing, "these rule ids have no Group A positive fixture at all").toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Group B — per-rule NEGATIVE, drawn from this repository's own style
// ---------------------------------------------------------------------------

describe("QUAL-01 Group B — negative fixtures drawn from this repo's own deliberate style", () => {
	it("does not flag a documented NEVER-THROWS catch (evidence.ts / safety/audit.ts's own shape)", () => {
		const text = [
			"/**",
			" * NEVER THROWS: this must not propagate past this boundary.",
			" */",
			"function safeWrite(): string | undefined {",
			"\ttry {",
			"\t\treturn doWrite();",
			"\t} catch {",
			"\t\treturn undefined;",
			"\t}",
			"}",
			"",
		].join("\n");
		const findings = ruleSwallowedException({ path: "src/safe-write.ts", text });
		expect(findings, "a documented NEVER-THROWS catch must not be flagged").toEqual([]);
	});

	it("does not flag a named const initialiser (diagnostics/schema.ts's WIRE_ROTATE_BYTES shape)", () => {
		const text = "const WIRE_ROTATE_BYTES = 32_000_000;\n";
		const findings = ruleMagicNumber({ path: "src/named-constant.ts", text });
		expect(findings, "a const declaration's own initialiser must not be flagged").toEqual([]);
	});

	it("does not flag a loop call whose callee is outside N_PLUS_ONE_CALLEES", () => {
		expect(N_PLUS_ONE_CALLEES.includes("log" as (typeof N_PLUS_ONE_CALLEES)[number])).toBe(false);
		const text = [
			"function logAll(items: string[]): void {",
			"\tfor (const item of items) {",
			"\t\tconsole.log(item);",
			"\t}",
			"}",
			"",
		].join("\n");
		const findings = ruleNPlusOne({ path: "src/log-all.ts", text });
		expect(findings, "console.log is not in N_PLUS_ONE_CALLEES and carries no await").toEqual([]);
	});

	it('does not flag "TODO" sitting inside a string literal rather than a comment', () => {
		const text = 'const message = "TODO: this is data, not a task";\n';
		const findings = ruleShippedTodo({ path: "src/string-todo.ts", text });
		expect(findings, "a TODO inside quoted string data is not a shipped-todo comment").toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Group C — the dead-rule guard
// ---------------------------------------------------------------------------

const COMBINED_ALL_RULES_FIXTURE = [
	"function classify(kind: string): number {",
	'\tif (kind === "urgent") {',
	"\t\treturn 1;",
	"\t}",
	"\treturn 0;",
	"}",
	"",
	"function checkQuota(): boolean {",
	"\tif (getRemaining() > 37) {",
	"\t\treturn true;",
	"\t}",
	"\treturn false;",
	"}",
	"",
	"function runFirst(): void {",
	"\tconst a = 1;",
	"\tconst b = 2;",
	"\tconst c = 3;",
	"\tconst d = 4;",
	"\tconst e = 5;",
	"\tconst f = 6;",
	"\tconst g = 7;",
	"\tconst h = 8;",
	"\tconst i = 9;",
	"\tconst j = 10;",
	"\tconst k = 11;",
	"\tconst l = 12;",
	"\tconsole.log(a, b, c, d, e, f, g, h, i, j, k, l);",
	"}",
	"",
	"function runSecond(): void {",
	"\tconst a = 1;",
	"\tconst b = 2;",
	"\tconst c = 3;",
	"\tconst d = 4;",
	"\tconst e = 5;",
	"\tconst f = 6;",
	"\tconst g = 7;",
	"\tconst h = 8;",
	"\tconst i = 9;",
	"\tconst j = 10;",
	"\tconst k = 11;",
	"\tconst l = 12;",
	"\tconsole.log(a, b, c, d, e, f, g, h, i, j, k, l);",
	"}",
	"",
	"function risky(): void {",
	"\ttry {",
	"\t\tdoSomething();",
	"\t} catch {",
	"\t}",
	"}",
	"",
	"// TODO: revisit this before shipping",
	"async function loadAll(items: string[]): Promise<void> {",
	"\tfor (const item of items) {",
	"\t\tawait query(item);",
	"\t}",
	"}",
	"",
].join("\n");

describe("QUAL-01 Group C — dead-rule guard", () => {
	it("trips all six rules against one combined inline fixture (a dead rule is named, not silently absent)", () => {
		const findings = runAntiPatternRules([{ path: "src/combined.ts", text: COMBINED_ALL_RULES_FIXTURE }]);
		const dead = RULE_IDS.filter((id) => !findings.some((f) => f.ruleId === id));
		expect(dead, `these rule ids matched NOTHING in the combined offending fixture: ${dead.join(", ")}`).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Group D — false-positive sweep over reality
// ---------------------------------------------------------------------------

/**
 * The recorded error-tier count over this repo's own `.pi/extensions/` sources: a measurement, not a target. A rise
 * means fix the source or narrow a rule (never widen an exemption); a drop must lower this too. Current breakdown: 45
 * vendored background-tasks findings, plus swallowed-exception 7 (checkpoint/git.ts x3, checkpoint/index.ts x1,
 * loop-police/loop-police.ts x1, workflows/index.ts x1, workflows/settle.ts x1) and magic-number 5 (loop-police x2,
 * todo.ts x3).
 */
const ERROR_BUDGET_ON_OWN_SOURCE = 57;

function realExtensionSources(): QualitySource[] {
	return trackedFiles(".pi/extensions")
		.filter((p) => p.endsWith(".ts"))
		.sort()
		.map((path) => ({ path, text: readFileSync(join(repoRoot(), path), "utf-8") }));
}

describe("QUAL-01 Group D — false-positive sweep over this repo's real sources", () => {
	const sources = realExtensionSources();

	it("finds at least one real tracked source under .pi/extensions/ (guards against a vacuous sweep)", () => {
		expect(sources.length).toBeGreaterThanOrEqual(1);
	});

	it("keeps the error-tier finding count on real source at or under the recorded budget", () => {
		const findings = runAntiPatternRules(sources);
		const errorFindings = findings.filter((f) => f.tier === "error");
		expect(
			errorFindings.length,
			`error-tier findings on real .pi/extensions/ source rose to ${errorFindings.length}, above the recorded ` +
				`budget of ${ERROR_BUDGET_ON_OWN_SOURCE}. Sample: ` +
				errorFindings
					.slice(0, 10)
					.map((f) => `${f.path}:${f.line} (${f.ruleId})`)
					.join("; "),
		).toBeLessThanOrEqual(ERROR_BUDGET_ON_OWN_SOURCE);
	});

	it("WR-07: the recorded budget IS the measured count, exactly -- a DROP requires an edit here too", () => {
		// toBe, not <=: a real fix must lower the recorded number in the same commit, or the slack hides.
		const findings = runAntiPatternRules(sources);
		const errorFindings = findings.filter((f) => f.tier === "error");
		expect(
			ERROR_BUDGET_ON_OWN_SOURCE,
			`real .pi/extensions/ source now has ${errorFindings.length} error-tier findings, but ` +
				`ERROR_BUDGET_ON_OWN_SOURCE is declared as ${ERROR_BUDGET_ON_OWN_SOURCE} -- update the constant AND ` +
				"its `why` (with the new per-rule breakdown) in the same commit as whatever moved the real count",
		).toBe(errorFindings.length);
	});
});

// ---------------------------------------------------------------------------
// SCAN_EXEMPT_PREFIXES — both directions, same text, differing only in path
// ---------------------------------------------------------------------------

const EXEMPTION_ROUND_TRIP_TEXT = ["// TODO: seeded defect for corpus", "function f(): void {}", ""].join("\n");

describe("QUAL-01 — tests/fixtures/ exemption, both directions on identical text", () => {
	it("scans nothing under tests/fixtures/", () => {
		const findings = runAntiPatternRules([{ path: "tests/fixtures/x.ts", text: EXEMPTION_ROUND_TRIP_TEXT }]);
		expect(findings).toEqual([]);
	});

	it("scans the identical text when it sits outside tests/fixtures/", () => {
		const findings = runAntiPatternRules([{ path: "src/x.ts", text: EXEMPTION_ROUND_TRIP_TEXT }]);
		expect(findings.length, "the same offending text must be findable once it is not under the exempt prefix").toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// SUPPRESSION_MARKER — both directions
// ---------------------------------------------------------------------------

describe("QUAL-01 — quality-allow suppression, both directions", () => {
	it("suppresses when a reason follows the em dash", () => {
		const text = ["// quality-allow:shipped-todo — corpus fixture, intentional", "// TODO: seeded defect for corpus", ""].join(
			"\n",
		);
		const findings = runAntiPatternRules([{ path: "src/suppressed.ts", text }]);
		expect(findings.filter((f) => f.ruleId === "shipped-todo")).toEqual([]);
	});

	it("does NOT suppress a bare marker with no reason", () => {
		const text = ["// quality-allow:shipped-todo", "// TODO: seeded defect for corpus", ""].join("\n");
		const findings = runAntiPatternRules([{ path: "src/bare-marker.ts", text }]);
		expect(findings.some((f) => f.ruleId === "shipped-todo"), "a bare marker with no reason must not suppress").toBe(true);
	});
});

// ---------------------------------------------------------------------------
// A syntactically invalid source must not crash the aggregator
// ---------------------------------------------------------------------------

describe("QUAL-01 — parse safety (T-08-04)", () => {
	it("returns (possibly empty) findings rather than throwing on broken syntax", () => {
		const broken = "function broken( { const a = ; return\n";
		expect(() => runAntiPatternRules([{ path: "src/broken.ts", text: broken }])).not.toThrow();
	});
});
