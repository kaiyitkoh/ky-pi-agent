/**
 * Drives the evasion corpus through the real guard: every BLOCKED row through the real evaluate() with HEAD on a
 * feature branch and on main, every OUT-OF-SCOPE row genuinely allowed and matched both ways against docs/SAFETY.md's
 * table (derived, never hand-counted), and the corpus kept live (>=30 unique rows covering all 14 classes).
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
// Shared fixture facts: a fixed "main" branch, project root and home, as policy-compose.test.ts uses
// ---------------------------------------------------------------------------

const HEADS = ["feat", "main"] as const;

/** Facts with HEAD on `head`, an `origin` remote and branch lookups, so a push row reaches the destination check instead of blocking on an unknown remote. */
function factsFor(head: (typeof HEADS)[number]): PolicyFacts {
	return {
		cwd: "C:/repo",
		projectRoot: "C:/repo",
		home: "C:/Users/tester",
		currentBranchFor: () => head,
		protectedBranches: ["main"],
		gitConfigFor: (_cwd, key) => (key === "remote.origin.url" ? ["git@example.invalid:o/r.git"] : []),
		gitBranchFor: (_cwd, rev) => (rev === "HEAD" ? head : /^[\w./-]+$/.test(rev) ? rev : undefined),
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
				const expected = (head === "feat" ? row.verdictOnFeature : undefined) ?? row.verdict ?? "block";
				it(`${row.id} (${row.class}): ${JSON.stringify(row.input)} -> ${expected}`, () => {
					const verdict = evaluate(row.tool, row.input, factsFor(head));
					expect(
						verdict.kind,
						`${row.id} (${row.class}) expected "${expected}" from evaluate("${row.tool}", ` +
							`${JSON.stringify(row.input)}, ...) with HEAD on ${head} but got "${verdict.kind}". ${row.why}`,
					).toBe(expected);
					if (verdict.kind === "block") {
						expect(verdict.reason, `${row.id} must block for its own reason, not because origin is unconfigured`).not.toContain(
							"is not a remote configured",
						);
						if (row.reason !== undefined) expect(verdict.reason, `${row.id} blocked for the wrong reason`).toContain(row.reason);
					}
				});
			}
		});
	}
});

// ---------------------------------------------------------------------------
// Group A' — every OUT-OF-SCOPE row really returns allow, so a regressed BLOCKED row cannot be re-bucketed
// silently, and a limit that a later fix closes is caught rather than left stale
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

/** The "Known bypasses this guard does not catch" section of docs/SAFETY.md, sliced by heading. */
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

/** Ids that are a table row's own first cell, not ids mentioned in another row's prose (EV-27 cites EV-28 and EV-30). */
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
