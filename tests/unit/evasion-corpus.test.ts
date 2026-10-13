/**
 * SAFE-15 / SAFE-17 — drive `tests/fixtures/evasion-corpus.ts` through the
 * real guard and cross-check it against `docs/SAFETY.md`.
 *
 * THREE GROUPS.
 *   A. Every `BLOCKED` row goes through the REAL `evaluate()` from
 *      `.pi/extensions/safety/policy.ts` — never a re-derived mini-parser —
 *      and its exact verdict kind is asserted with HEAD on a feature branch and on main.
 *   B. Every `OUT-OF-SCOPE` row is cross-checked against the published table
 *      in `docs/SAFETY.md`: the doc's row count and row identities are
 *      DERIVED from the corpus (never a hand-typed number, following
 *      `docs-policy.test.ts`'s `truncationCauseCount()` discipline), and the
 *      converse is asserted too — the doc holds no row id the corpus does
 *      not know about.
 *   C. Corpus liveness: >=30 rows, both buckets non-empty, every id unique,
 *      every one of the 14 PITFALLS.md classes represented. A corpus that
 *      silently lost half its rows would otherwise pass A and B trivially.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { evaluate, type PolicyFacts } from "../../.pi/extensions/safety/policy.ts";
import { repoRoot } from "../helpers/git.ts";
import { EVASION_CORPUS, type EvasionCase } from "../fixtures/evasion-corpus.ts";

const ROOT = repoRoot();
const SAFETY_DOC_PATH = join(ROOT, "docs", "SAFETY.md");

// ---------------------------------------------------------------------------
// Shared fixture facts — a fixed "main" current branch, a fixture project
// root and a fixture home, exactly the shape `evaluate()`'s own
// `policy-compose.test.ts` table uses.
// ---------------------------------------------------------------------------

const HEADS = ["feat", "main"] as const;

/** Facts with HEAD on `head` and config/branch lookups supplied, so config-driven push planning has something to read. */
function factsFor(head: (typeof HEADS)[number]): PolicyFacts {
	return {
		cwd: "C:/repo",
		projectRoot: "C:/repo",
		home: "C:/Users/tester",
		currentBranchFor: () => head,
		protectedBranches: ["main"],
		gitConfigFor: () => [],
		gitBranchFor: (_cwd, rev) => (rev === "HEAD" ? head : undefined),
	};
}

const FACTS: PolicyFacts = factsFor("main");

// ---------------------------------------------------------------------------
// The 14 PITFALLS.md classes this corpus must cover, by name, not by count.
// ---------------------------------------------------------------------------

const PITFALLS_14_CLASSES: readonly string[] = [
	"variable-indirection",
	"command-substitution",
	"nested-shell",
	"heredoc-to-script",
	"different-repo",
	"env-wrapper",
	"task-runner-indirection",
	"encoding",
	"backgrounding",
	"quoting-whitespace",
	"shell-function-alias",
	"path-shadowing",
	"different-client",
	"not-bash-at-all",
];

const BLOCKED_ROWS = EVASION_CORPUS.filter((c) => c.expect === "BLOCKED");
const OUT_OF_SCOPE_ROWS = EVASION_CORPUS.filter((c) => c.expect === "OUT-OF-SCOPE");

// ---------------------------------------------------------------------------
// Group A — every BLOCKED row through the real evaluate()
// ---------------------------------------------------------------------------

describe("Group A -- every BLOCKED row returns its exact verdict through the real evaluate()", () => {
	it("the BLOCKED bucket is non-empty (vacuous-pass guard)", () => {
		expect(BLOCKED_ROWS.length, "no BLOCKED rows found -- Group A would otherwise pass vacuously").toBeGreaterThan(0);
	});

	for (const head of HEADS) {
		describe(`with HEAD on ${head}`, () => {
			for (const row of BLOCKED_ROWS) {
				const expected = row.verdict ?? "block";
				it(`${row.id} (${row.class}): ${JSON.stringify(row.input)} -> ${expected}`, () => {
					const verdict = evaluate(row.tool, row.input, factsFor(head));
					expect(
						verdict.kind,
						`${row.id} (${row.class}) expected "${expected}" from evaluate("${row.tool}", ` +
							`${JSON.stringify(row.input)}, ...) with HEAD on ${head} but got "${verdict.kind}". ${row.why}`,
					).toBe(expected);
				});
			}
		});
	}
});

// ---------------------------------------------------------------------------
// Group A' — WR-03: every OUT-OF-SCOPE row genuinely returns `allow` through
// the real evaluate(), not merely "we published this limit in a table". Group
// B (below) only checks the DOC agrees with the corpus -- a documentation
// consistency check, not a behavioural one. Without Group A', the disarm path
// is mechanical: a BLOCKED row that regresses to `allow` can be silently
// re-bucketed to OUT-OF-SCOPE plus one pasted markdown row, and the suite
// stays green while the guard is strictly weaker. Group A' makes the bucket
// falsifiable in BOTH directions: a row that is actually STILL blocked (the
// limit no longer exists, e.g. a future fix closes it) must be caught here,
// not silently left stale in the "OUT-OF-SCOPE" bucket forever.
// ---------------------------------------------------------------------------

describe("Group A' -- every OUT-OF-SCOPE row genuinely returns allow (WR-03)", () => {
	it("the OUT-OF-SCOPE bucket is non-empty (vacuous-pass guard)", () => {
		expect(
			OUT_OF_SCOPE_ROWS.length,
			"no OUT-OF-SCOPE rows found -- Group A' would otherwise pass vacuously",
		).toBeGreaterThan(0);
	});

	for (const row of OUT_OF_SCOPE_ROWS) {
		it(`${row.id} (${row.class}): ${JSON.stringify(row.input)} -> allow (the published limit still exists)`, () => {
			const verdict = evaluate(row.tool, row.input, FACTS);
			expect(
				verdict.kind,
				`${row.id} (${row.class}) is published in docs/SAFETY.md as a limit this guard does not catch, ` +
					`but evaluate("${row.tool}", ${JSON.stringify(row.input)}, ...) returned "${verdict.kind}" -- ` +
					"the limit no longer exists. Either the corpus row is stale (move it to BLOCKED, in the " +
					"same commit as removing its docs/SAFETY.md row) or a real regression re-opened this gap.",
			).toBe("allow");
		});
	}
});

// ---------------------------------------------------------------------------
// Group B — the OUT-OF-SCOPE bucket, cross-checked against docs/SAFETY.md
// ---------------------------------------------------------------------------

/**
 * Slice the "Known bypasses this guard does not catch" section out of
 * `docs/SAFETY.md` by heading markers -- the same pattern
 * `docs-policy.test.ts`'s `redactionSection()` uses.
 */
function knownBypassesSection(): string {
	const doc = readFileSync(SAFETY_DOC_PATH, "utf-8");
	const marker = "\n## Known bypasses this guard does not catch";
	const start = doc.indexOf(marker);
	expect(
		start,
		"docs/SAFETY.md has no '## Known bypasses this guard does not catch' heading -- every assertion " +
			"below scans that section, so an absent or renamed heading would make this whole group vacuous",
	).toBeGreaterThan(-1);
	const rest = doc.slice(start + 1);
	const end = rest.indexOf("\n## ");
	return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Every `EV-\d+` id that appears as a TABLE ROW'S OWN identifier -- i.e. as
 * the first cell of a `| EV-xx | ... |` line -- not merely mentioned in
 * prose inside another row's cell (EV-27's own explanation cross-references
 * EV-28 and EV-30 by id; that mention must not be mistaken for EV-28/EV-30
 * having their own row in this table).
 */
function tableRowIds(section: string): string[] {
	const ids: string[] = [];
	const rowStart = /^\|\s*(EV-\d+)\s*\|/gm;
	let match: RegExpExecArray | null;
	while ((match = rowStart.exec(section)) !== null) {
		ids.push(match[1]);
	}
	return ids;
}

describe("Group B -- the OUT-OF-SCOPE bucket matches docs/SAFETY.md, in both directions", () => {
	const section = knownBypassesSection();

	it("is not vacuous: the section really is the published limits table", () => {
		expect(
			section.length,
			"the extracted section is too short to be the limits table, so every assertion below would be " +
				"asserting against nearly nothing",
		).toBeGreaterThan(500);
	});

	it("the OUT-OF-SCOPE bucket is non-empty (vacuous-pass guard)", () => {
		expect(OUT_OF_SCOPE_ROWS.length, "no OUT-OF-SCOPE rows found -- Group B would otherwise pass vacuously").toBeGreaterThan(0);
	});

	it("the table's row count is DERIVED from the corpus, never a hand-typed number", () => {
		const expectedCount = EVASION_CORPUS.filter((c) => c.expect === "OUT-OF-SCOPE").length;
		const rowIds = tableRowIds(section);
		expect(
			rowIds.length,
			"docs/SAFETY.md's 'Known bypasses' table must carry exactly one row per OUT-OF-SCOPE corpus " +
				`entry (${expectedCount}, computed from EVASION_CORPUS.filter(...).length at test time -- ` +
				"never transcribed), following the truncationCauseCount() discipline in docs-policy.test.ts",
		).toBe(expectedCount);
	});

	it("every OUT-OF-SCOPE row's id and class appear in the table", () => {
		for (const row of OUT_OF_SCOPE_ROWS) {
			expect(section, `${row.id} is tagged OUT-OF-SCOPE in the corpus but its id is missing from docs/SAFETY.md's table`).toContain(
				row.id,
			);
			expect(
				section,
				`${row.id} is tagged OUT-OF-SCOPE in the corpus but its class "${row.class}" is missing from docs/SAFETY.md's table`,
			).toContain(row.class);
		}
	});

	it("the table holds no row id the corpus does not know about (the converse)", () => {
		const rowIds = new Set(tableRowIds(section));
		const outOfScopeIds = new Set(OUT_OF_SCOPE_ROWS.map((r) => r.id));
		for (const id of rowIds) {
			expect(
				outOfScopeIds.has(id),
				`docs/SAFETY.md's table has a row for "${id}", but no corpus entry with that id is tagged ` +
					"OUT-OF-SCOPE -- the doc has grown a limit the corpus does not know about",
			).toBe(true);
		}
	});

	it("states the honest ceiling: mistake-catcher, no Windows sandbox, GitLab as the only non-theatre control", () => {
		const doc = readFileSync(SAFETY_DOC_PATH, "utf-8");
		expect(doc, "must call the guard a mistake-catcher, not a security boundary").toContain("mistake-catcher");
		expect(doc, "must state there is no OS-level sandbox on Windows").toContain("no OS-level sandbox on Windows");
		expect(doc, "must name GitLab server-side protected branches as the only non-theatre control").toContain(
			"is not theatre",
		);
		expect(doc, "must name GitLab server-side protected branches specifically").toContain("GitLab server-side protected branches");
	});

	it("names the tool-name-collision and event.input-mutation residual risks with source citations", () => {
		const doc = readFileSync(SAFETY_DOC_PATH, "utf-8");
		expect(doc, "must contain the 'Load order is part of this' heading").toContain("## Load order is part of this");
		expect(doc, "must cite types.d.ts for the mutable event.input / no-re-validation risk").toContain(
			"dist/core/extensions/types.d.ts:687-688",
		);
		expect(doc, "must cite runner.js for the first-registration-wins tool-name collision risk").toContain(
			"dist/core/extensions/runner.js:280-291",
		);
		expect(doc, "must name the tool-name collision residual risk by its tracked id").toContain("T-04-08");
	});

	it("states the code-is-authoritative stance, copying docs/DIAGNOSTICS.md's own wording in spirit", () => {
		const doc = readFileSync(SAFETY_DOC_PATH, "utf-8");
		expect(doc, "must contain the '## Authority' heading").toContain("## Authority");
		expect(doc, "must state the code is authoritative and the document is a bug on disagreement").toContain(
			"the code is authoritative and this document is a bug",
		);
	});
});

// ---------------------------------------------------------------------------
// Group C — corpus liveness
// ---------------------------------------------------------------------------

describe("Group C -- corpus liveness (a corpus that silently lost rows would pass A/B trivially)", () => {
	it("has at least 30 entries", () => {
		expect(EVASION_CORPUS.length).toBeGreaterThanOrEqual(30);
	});

	it("both buckets are non-empty", () => {
		expect(BLOCKED_ROWS.length).toBeGreaterThan(0);
		expect(OUT_OF_SCOPE_ROWS.length).toBeGreaterThan(0);
	});

	it("every expect value is exactly BLOCKED or OUT-OF-SCOPE -- no third bucket", () => {
		for (const row of EVASION_CORPUS) {
			expect(["BLOCKED", "OUT-OF-SCOPE"], `${row.id} has an invalid expect value: "${row.expect}"`).toContain(row.expect);
		}
		expect(BLOCKED_ROWS.length + OUT_OF_SCOPE_ROWS.length, "every row must land in exactly one of the two buckets").toBe(
			EVASION_CORPUS.length,
		);
	});

	it("every id is unique", () => {
		const ids = EVASION_CORPUS.map((c) => c.id);
		expect(new Set(ids).size, "duplicate id found in EVASION_CORPUS").toBe(ids.length);
	});

	it("every entry has a non-empty why and a non-empty reference", () => {
		for (const row of EVASION_CORPUS) {
			expect(row.why.length, `${row.id} has an empty "why"`).toBeGreaterThan(0);
			expect(row.reference.length, `${row.id} has an empty "reference"`).toBeGreaterThan(0);
		}
	});

	it("every one of the 14 PITFALLS.md classes is represented", () => {
		const classesPresent = new Set(EVASION_CORPUS.map((c) => c.class));
		for (const cls of PITFALLS_14_CLASSES) {
			expect(classesPresent.has(cls), `PITFALLS.md class "${cls}" has no corpus row -- coverage regressed`).toBe(true);
		}
	});

	it("EV-08/EV-09 record the real bucket change found during authoring (eval fixed, variable-indirection-through-eval published)", () => {
		const ev08 = EVASION_CORPUS.find((c) => c.id === "EV-08") as EvasionCase;
		const ev09 = EVASION_CORPUS.find((c) => c.id === "EV-09") as EvasionCase;
		expect(ev08.expect, "EV-08 (eval with a literal guarded verb) must be BLOCKED after the shell.ts fix").toBe("BLOCKED");
		expect(ev09.expect, "EV-09 (eval via a variable) must remain the published OUT-OF-SCOPE limit").toBe("OUT-OF-SCOPE");
	});
});
