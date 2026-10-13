/**
 * QUAL-01 — the six anti-pattern rules, proven live in both directions.
 *
 * Four groups, following `chokepoint-lint.test.ts`/`contributing-boundary.test.ts`'s
 * vacuity-guard discipline: a rule proven only against a clean corpus is a rule
 * that could be uniformly dead and nothing here would notice.
 *
 *   A — per-rule POSITIVE: an inline fixture (never a file under a scanned
 *       tree — see `SCAN_EXEMPT_PREFIXES`'s own docstring for why) each rule
 *       must fire against.
 *   B — per-rule NEGATIVE, drawn from this repository's own deliberate style:
 *       a documented NEVER-THROWS catch, a named byte constant, a
 *       not-in-the-callee-set loop call, a `TODO` sitting inside a string.
 *   C — the dead-rule guard: one combined fixture trips all six; a rule that
 *       matches nothing here is a rule that could be silently broken.
 *   D — the false-positive sweep: run every rule over this repository's own
 *       real `.pi/extensions/` sources and record the measured error-tier
 *       count, per `08-RESEARCH.md` Pitfall 2 ("record the real number, do
 *       not tune to zero by weakening the rule into uselessness").
 *
 * Plus: both directions of `SCAN_EXEMPT_PREFIXES` on the SAME text (differing
 * only in `path`), both directions of `SUPPRESSION_MARKER` (reasoned vs bare),
 * and a parse-safety case for T-08-04 (a syntactically broken source must not
 * throw `runAntiPatternRules`).
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
 * The measured error-tier finding count `runAntiPatternRules` produces
 * against this repository's own `.pi/extensions/` sources, as of the date
 * below. Per `08-RESEARCH.md` Pitfall 2: this is a RECORDED NUMBER, not a
 * target tuned to zero. If it rises, either the new source genuinely
 * introduced the anti-pattern (fix the source) or a rule needs narrowing
 * (narrow it and record what shape forced the narrowing) — it is not
 * lowered by silently widening an exemption. `toBe`, not merely
 * `toBeLessThanOrEqual` (see the second `it` below, WR-07): a DROP also
 * requires a deliberate edit here, the same discipline `workflow-budgets.
 * test.ts` uses for its own ratchets (WR2-03) — headroom accumulated by a
 * silent fix is exactly the slack a recorded-number budget exists to
 * prevent from hiding.
 *
 * why: originally measured 2026-08-15 against the Phase 1-7 `.pi/
 * extensions/` tree (this plan's own `quality/rules.ts` did not appear in
 * it yet — the first measurement run found 4 `shipped-todo`
 * self-references inside this module's own docstrings describing the very
 * tokens it detects, which was treated as a genuine finding on real source
 * and fixed by rewording the docstrings to reference `SHIPPED_TODO_TOKENS`
 * by name instead of spelling the four literal tokens in prose — not by
 * narrowing the rule or widening an exemption).
 *
 * WR-07 (code-review fix pass): the assertion scans the CURRENT tracked
 * tree (`trackedFiles(".pi/extensions")`), which by the end of this phase
 * includes eight `quality/*.ts` files (3,406+ lines) that landed AFTER the
 * measurement above — so the claim "this plan's own quality/rules.ts does
 * not appear in it" no longer described what the assertion actually scans.
 * RE-MEASURED 2026-08-15 against the current tree (51 tracked `.ts` files):
 * still exactly 22, UNCHANGED. All eight `quality/*.ts` files contribute
 * ZERO error-tier findings — the new source did not move this number
 * either direction. The 22 remain pre-existing Phase 1-7 code, same
 * per-rule breakdown as originally recorded: `swallowed-exception` (17:
 * checkpoint/git.ts x3, checkpoint/index.ts x1, diagnostics/budget.ts x2,
 * diagnostics/call-model.ts x1, diagnostics/index.ts x1, loop-police/
 * loop-police.ts x1, providers/index.ts x1, qoder/client.ts x1, qoder/
 * index.ts x1, routing/agent-overrides.ts x1, routing/index.ts x1, safety/
 * index.ts x1, workflows/index.ts x2) and `magic-number` (5: loop-police/
 * loop-police.ts x2, todo.ts x3, e.g. todo.ts's repeated `5`-item
 * truncation constant). Fixing them is out of this plan's scope
 * (`08-02-PLAN.md` builds and proves the rules; it does not remediate six
 * phases of pre-existing code) and is left for a future gate-integration
 * plan to triage.
 *
 * 08.1-07 RE-MEASURE (2026-10-13): 22 -> 67. Phase 08.1 vendored upstream
 * pi-background-tasks under `.pi/extensions/background-tasks/` (tracked), which
 * adds 45 findings: `magic-number` x42 (e.g. src/core/common.ts) and
 * `swallowed-exception` x3. They are third-party code kept byte-faithful to
 * upstream, so they are recorded here rather than remediated. The 22
 * pre-existing findings are unchanged (swallowed-exception 17, magic-number 5).
 *
 * 12.1 RE-MEASURE (2026-10-13): 67 -> 72 -> 65. Phase 12.1 added five error
 * findings, all real: deliberate best-effort catches with no documented
 * contract (routing/index.ts model_select, input and session_shutdown;
 * safety/index.ts sessionIdOf; safety/subagents.ts disposeChildGuard). The
 * review fixes then repeated a `/ 4` token estimate in routing/guard.ts (two more).
 * Each catch now carries the NEVER THROWS contract that says why swallowing is
 * correct there, and guard.ts names CHARS_PER_TOKEN. The older routing/index.ts
 * session_start catch got the same contract. Remaining: 45 vendored background-tasks
 * findings plus 20 authored ones (swallowed-exception 15: checkpoint/git.ts x3,
 * checkpoint/index.ts x1, diagnostics/budget.ts x2, diagnostics/call-model.ts
 * x1, diagnostics/index.ts x1, loop-police/loop-police.ts x1,
 * providers/index.ts x1, qoder/client.ts x1, qoder/index.ts x1,
 * routing/agent-overrides.ts x1, workflows/index.ts x1, workflows/settle.ts x1;
 * magic-number 5: loop-police/loop-police.ts x2, todo.ts x3).
 */
const ERROR_BUDGET_ON_OWN_SOURCE = 65;

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
		// Same discipline workflow-budgets.test.ts uses (WR2-03): `toBe`, not
		// `toBeLessThanOrEqual(actual + slack)`. Headroom accumulated by a real
		// fix (a `catch` block that stops swallowing, a magic number that gets
		// named) is exactly the slack a recorded-number budget exists to
		// prevent from hiding -- so a DROP in the real count must ALSO force a
		// deliberate edit to this constant, in the same commit as the fix that
		// earned it, not a silent widening of the margin between recorded and
		// actual.
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
// T-08-04 — a syntactically invalid source must not crash the aggregator
// ---------------------------------------------------------------------------

describe("QUAL-01 — parse safety (T-08-04)", () => {
	it("returns (possibly empty) findings rather than throwing on broken syntax", () => {
		const broken = "function broken( { const a = ; return\n";
		expect(() => runAntiPatternRules([{ path: "src/broken.ts", text: broken }])).not.toThrow();
	});
});
