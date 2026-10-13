/**
 * Binds docs/EXTENSIONS.md's subagent capability evidence table to the `pi-subagents` version pinned in
 * `.pi/settings.json`, and asserts this repo's own composition. Nothing here executes `pi-subagents`; its runtime
 * behaviour is RB-07-01, OUTSTANDING. `agentScope` is a per-call tool parameter, not a settings key, so the settings
 * must carry none. The parser throws on a malformed row rather than dropping it, so an empty parse cannot pass.
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

/** The `## Subagent capability evidence` section, so nothing elsewhere in the doc can satisfy or break a binding. */
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
 * Every data row of the evidence table, skipping header and separator by content. A row that does not split into
 * exactly 7 cells throws, so a table that parses to zero rows cannot pass every binding.
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
	// The half this repo controls; what pi-subagents does with the agent file stays in the evidence table.

	it(".pi/agents/planner.md is tracked", () => {
		expect(trackedFiles(AGENT_FILE_PATH)).toEqual([AGENT_FILE_PATH]);
	});

	it(".pi/settings.json packages[] names pi-subagents at a pinned version", () => {
		expect(pinnedVersion("pi-subagents"), "no npm:pi-subagents@<version> entry in .pi/settings.json packages[]").toBeDefined();
	});

	// agentScope is not a settings key at any scope, so writing one would be dead configuration.
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
