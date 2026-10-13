/**
 * EXT-03/EXT-04 -- binds `docs/EXTENSIONS.md`'s "Subagent capability
 * evidence" table to the exact `pi-subagents` version pinned in
 * `.pi/settings.json`, and separately asserts this repository's own
 * composition (the tracked agent file, the pinned package entry).
 *
 * WHAT THIS FILE DOES NOT PROVE. Nothing here executes `pi-subagents`, spawns
 * a real model turn, or observes a real background run or a real steer being
 * delivered into one. Every citation in the table is a file:line read from
 * the pinned package's own source at the moment the table was written; this
 * file only proves the citation table has not silently drifted from the pin
 * and has not silently shrunk. Third-party runtime behaviour is `RB-07-01`
 * material (written by plan 07-13), OUTSTANDING, and this file makes no claim
 * about it in either direction.
 *
 * A CORRECTION FROM THE PLAN THIS FILE WAS WRITTEN AGAINST. 07-12-PLAN.md's
 * own Task 2 text specifies Binding 4 as "`.pi/settings.json` sets
 * `agentScope` to a value that loads project agents". That is false for the
 * pinned `pi-subagents@0.76.1`: `agentScope` is not a `.pi/settings.json` key
 * at all -- it is a per-tool-call parameter on the `subagent` tool's own
 * schema, resolved to `"both"` whenever a caller omits it (07-09-SUMMARY.md's
 * Task 1 finding 3, re-confirmed while writing `docs/EXTENSIONS.md`'s
 * evidence table for this plan). Binding 4 below therefore asserts the true
 * shape -- `.pi/settings.json` carries NO `agentScope` key, because none is
 * needed -- rather than the plan's drafted, falsified assertion.
 * `tests/unit/extension-pins.test.ts` already carries an equivalent
 * assertion from plan 07-09; it is repeated here, independently, because this
 * file is EXT-03/EXT-04's own composition half and must not depend on
 * another test file to be true.
 *
 * THE MALFORMED-ROW RULE. `extractEvidenceRows` throws on any table row that
 * does not split into exactly 7 cells, rather than silently dropping it. A
 * parser that drops rows it cannot read is how a table with zero rows
 * parsed passes every binding below -- the exact failure mode Phase 6 and
 * this phase's own `07-VALIDATION.md` name repeatedly. Proven against an
 * inline fixture (a 6-cell row) in the "parser itself" describe block, before
 * any binding runs against the real file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";

const EXTENSIONS_DOC_PATH = join(repoRoot(), "docs", "EXTENSIONS.md");
const SETTINGS_PATH = join(repoRoot(), ".pi", "settings.json");
const AGENT_FILE_PATH = ".pi/agents/planner.md";

/** The requirement ids this evidence table exists to cover. Never a hardcoded literal elsewhere in this file. */
const SUBAGENT_REQUIREMENTS = ["EXT-01", "EXT-03", "EXT-04"] as const;

interface EvidenceRow {
	requirement: string;
	mechanism: string;
	pkg: string;
	version: string;
	evidence: string;
	proves: string;
	doesNotProve: string;
}

/**
 * Slice `## Subagent capability evidence` out of `docs/EXTENSIONS.md`, up to
 * the next `## ` heading or end of file. Mirrors
 * `tests/unit/routing-map.test.ts`'s `roleModelTableSection` extraction
 * discipline -- scoped to the section so nothing outside it (the "Installed
 * packages" table above, for instance) can accidentally satisfy or break a
 * binding below.
 */
function evidenceSection(doc: string): string {
	const heading = "\n## Subagent capability evidence";
	const start = doc.indexOf(heading);
	expect(
		start,
		"docs/EXTENSIONS.md has no `## Subagent capability evidence` heading -- every binding below scans " +
			"that section, so a missing or renamed heading would make this whole file vacuous",
	).toBeGreaterThan(-1);
	const rest = doc.slice(start + 1);
	const end = rest.indexOf("\n## ");
	return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Parse every `| ... |` data row of the evidence table within `section`.
 *
 * Skips the header row (`| Requirement | Mechanism | ... |`) and the
 * separator row (`|---|---|...|`) by content, not by position, so reordering
 * neither breaks parsing nor silently swallows a real row. Any row-shaped
 * line (starts with `|`, is not the header or separator) that does not split
 * into exactly 7 cells THROWS -- it does not skip the row and does not
 * return a partial result. This is the load-bearing rule this file's header
 * docstring names: a parser that drops malformed rows is how a table with
 * zero rows parsed passes every assertion below having checked nothing.
 */
function extractEvidenceRows(section: string): EvidenceRow[] {
	const rows: EvidenceRow[] = [];
	for (const line of section.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("|")) continue;
		if (trimmed.startsWith("| Requirement ")) continue;
		if (/^\|[-\s|]+\|$/.test(trimmed)) continue; // separator row, e.g. |---|---|---|
		const cells = trimmed.split("|").map((cell) => cell.trim());
		// A well-formed `| a | b | c | d | e | f | g |` splits into 9 tokens:
		// a leading empty string, 7 content cells, a trailing empty string.
		if (cells.length !== 9 || cells[0] !== "" || cells[8] !== "") {
			throw new Error(
				`malformed evidence table row (expected 7 pipe-delimited cells, got ${cells.length - 2}): ${trimmed.slice(0, 120)}`,
			);
		}
		const [, requirement, mechanism, pkg, version, evidence, proves, doesNotProve] = cells as [
			string,
			string,
			string,
			string,
			string,
			string,
			string,
			string,
			string,
		];
		rows.push({ requirement, mechanism, pkg, version, evidence, proves, doesNotProve });
	}
	return rows;
}

/** `.pi/settings.json`'s pinned version for `packageName`, e.g. `"pi-subagents"` -> `"0.49.0"`. */
function pinnedVersion(packageName: string): string | undefined {
	const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as { packages?: unknown };
	const packages = Array.isArray(settings.packages) ? (settings.packages as string[]) : [];
	const prefix = `npm:${packageName}@`;
	const spec = packages.find((entry) => entry.startsWith(prefix));
	return spec?.slice(prefix.length);
}

describe("subagent-capabilities parser -- fails loudly on a malformed row", () => {
	it("a 6-cell row throws rather than being silently skipped", () => {
		const malformedSection = [
			"## Subagent capability evidence",
			"",
			"| Requirement | Mechanism | Package | Version | Evidence | What this proves | What this does NOT prove |",
			"|---|---|---|---|---|---|---|",
			"| EXT-01 | missing one cell | pi-subagents | 0.49.0 | src/x.ts:1 | proves nothing |",
			"",
		].join("\n");
		expect(() => extractEvidenceRows(malformedSection)).toThrowError(/malformed evidence table row/);
	});

	it("a well-formed 7-cell row parses without throwing", () => {
		const wellFormedSection = [
			"## Subagent capability evidence",
			"",
			"| Requirement | Mechanism | Package | Version | Evidence | What this proves | What this does NOT prove |",
			"|---|---|---|---|---|---|---|",
			"| EXT-01 | a mechanism | pi-subagents | 0.49.0 | src/x.ts:1 | proves something | does not prove RB-07-01 runtime |",
			"",
		].join("\n");
		const rows = extractEvidenceRows(wellFormedSection);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.requirement).toBe("EXT-01");
		expect(rows[0]!.evidence).toBe("src/x.ts:1");
	});
});

describe("subagent-capabilities -- vacuity guard", () => {
	const doc = readFileSync(EXTENSIONS_DOC_PATH, "utf-8");
	const rows = extractEvidenceRows(evidenceSection(doc));

	it("parsed at least 3 rows, covering EXT-01, EXT-03 and EXT-04 (non-vacuity)", () => {
		expect(
			rows.length,
			"fewer than 3 rows parsed from docs/EXTENSIONS.md's evidence table -- every binding below " +
				"would iterate almost nothing and pass while checking almost nothing",
		).toBeGreaterThanOrEqual(3);
		const covered = new Set(rows.map((row) => row.requirement));
		for (const id of SUBAGENT_REQUIREMENTS) {
			expect(covered.has(id), `no parsed row names requirement ${id}`).toBe(true);
		}
	});
});

describe("subagent-capabilities Binding 1 -- evidence is bound to the pin", () => {
	const doc = readFileSync(EXTENSIONS_DOC_PATH, "utf-8");
	const rows = extractEvidenceRows(evidenceSection(doc));
	const pinnedPiSubagentsVersion = pinnedVersion("pi-subagents");

	it(".pi/settings.json actually pins a pi-subagents version (vacuity guard for this binding)", () => {
		expect(
			pinnedPiSubagentsVersion,
			"no npm:pi-subagents@<version> entry found in .pi/settings.json packages[] -- Binding 1 " +
				"would compare every row's Version cell against undefined and pass vacuously",
		).toBeDefined();
	});

	it("every row whose Package is pi-subagents names the exact pinned version", () => {
		const piSubagentsRows = rows.filter((row) => row.pkg === "pi-subagents");
		expect(piSubagentsRows.length, "no evidence row names Package pi-subagents").toBeGreaterThan(0);
		for (const row of piSubagentsRows) {
			expect(
				row.version,
				`row for ${row.requirement} (${row.evidence}) names Version "${row.version}", but .pi/settings.json ` +
					`pins pi-subagents@${pinnedPiSubagentsVersion} -- this row is stale, not evidence`,
			).toBe(pinnedPiSubagentsVersion);
		}
	});
});

describe("subagent-capabilities Binding 2 -- every Evidence cell is well-formed path:line or UNVERIFIED", () => {
	const doc = readFileSync(EXTENSIONS_DOC_PATH, "utf-8");
	const rows = extractEvidenceRows(evidenceSection(doc));
	const PATH_LINE_RE = /^[\w./-]+:\d+(-\d+)?$/;

	it("collected more than one row to check (non-vacuity)", () => {
		expect(rows.length).toBeGreaterThan(1);
	});

	it("every Evidence cell is a path:line[-line] citation or the literal UNVERIFIED", () => {
		const offenders = rows.filter((row) => row.evidence !== "UNVERIFIED" && !PATH_LINE_RE.test(row.evidence));
		expect(
			offenders.map((row) => `${row.requirement}: "${row.evidence}"`),
			"a prose citation with no line number is a claim, not evidence -- every Evidence cell must be " +
				"a bare path:line[-line] token or the literal string UNVERIFIED",
		).toEqual([]);
	});
});

describe("subagent-capabilities Binding 3 -- the converse: no requirement's row can be silently deleted", () => {
	const doc = readFileSync(EXTENSIONS_DOC_PATH, "utf-8");
	const rows = extractEvidenceRows(evidenceSection(doc));

	for (const id of SUBAGENT_REQUIREMENTS) {
		it(`${id} appears in at least one parsed row`, () => {
			expect(
				rows.some((row) => row.requirement === id),
				`no row in docs/EXTENSIONS.md's evidence table names ${id} -- deleting its row must fail this test`,
			).toBe(true);
		});
	}
});

describe("subagent-capabilities Binding 4 -- this repo's own composition, asserted separately from the third-party mechanism", () => {
	// This half is enforced (this repo controls it): the agent file exists and
	// is tracked, and .pi/settings.json's packages[] names pi-subagents at a
	// pinned version. The OTHER half -- what pi-subagents@0.76.1 itself does
	// with that agent file -- is recorded above in the evidence table, never
	// asserted here, per this file's own separation-of-concerns rule.

	it(".pi/agents/planner.md is tracked", () => {
		expect(trackedFiles(AGENT_FILE_PATH)).toEqual([AGENT_FILE_PATH]);
	});

	it(".pi/settings.json packages[] names pi-subagents at a pinned version", () => {
		expect(pinnedVersion("pi-subagents"), "no npm:pi-subagents@<version> entry in .pi/settings.json packages[]").toBeDefined();
	});

	// CORRECTED per this file's header docstring: the plan this file was
	// written against drafted this binding as ".pi/settings.json sets
	// agentScope to a value that loads project agents", which is false for
	// pi-subagents@0.76.1 -- agentScope is not a settings key at any scope
	// (07-09-SUMMARY.md Task 1 finding 3). The true, machine-checkable fact is
	// its absence: writing one would be dead configuration nothing reads.
	it(".pi/settings.json deliberately carries no agentScope key -- pi-subagents@0.76.1 reads none from there", () => {
		const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as Record<string, unknown>;
		expect(
			Object.prototype.hasOwnProperty.call(settings, "agentScope"),
			"agentScope must not appear as a top-level .pi/settings.json key -- nothing in pi-subagents@0.76.1 " +
				"reads it from there; its real default (per-call, resolves to \"both\") already discovers " +
				".pi/agents/planner.md with no write required",
		).toBe(false);
	});
});

describe("subagent-capabilities Binding 5 -- the honesty guard: every row admits what it does not prove", () => {
	const doc = readFileSync(EXTENSIONS_DOC_PATH, "utf-8");
	const rows = extractEvidenceRows(evidenceSection(doc));

	it("collected more than one row to check (non-vacuity)", () => {
		expect(rows.length).toBeGreaterThan(1);
	});

	it("every row's \"What this does NOT prove\" cell is non-empty and names RB-07-01", () => {
		const offenders = rows.filter((row) => row.doesNotProve.trim() === "" || !row.doesNotProve.includes("RB-07-01"));
		expect(
			offenders.map((row) => row.requirement),
			"a table that grows a row without an admitted limit naming RB-07-01 is the failure mode this " +
				"whole plan exists to avoid",
		).toEqual([]);
	});
});
