/**
 * The tool-count baseline: every model-facing tool the pinned packages[] and the vendored extensions register into
 * the main session, one row per source including zero-tool rows (every tool's schema rides on every request,
 * pi-ai src/api/openai-completions.ts:1337-1372). Vendored rows are re-derived from tracked source every run; npm rows
 * are a recorded reading of each pinned tarball, re-read only when the pin moves. Child-only tools (e.g.
 * pi-subagents' contact_supervisor) are excluded; dynamic loaders (subagents_enable, web_enable) are counted.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { classifiedToolNames } from "../../.pi/extensions/routing/profiles.ts";
import { repoRoot, trackedFiles } from "../helpers/git.ts";
import { packageNameFromNpmSpec, readSettingsPackages } from "../helpers/settings.ts";

const EXT_DIR = ".pi/extensions";

const FLAT = /^\.pi\/extensions\/[^/]+\.ts$/;
const NESTED_INDEX = /^\.pi\/extensions\/[^/]+\/index\.ts$/;

/** The case-insensitive marker every vendored entry point's header carries. */
const VENDORED_MARKER = /vendored/i;

interface ToolCountRow {
	/** `packages[]`'s bare package name (npm rows) or a repo-relative path (vendored rows). */
	source: string;
	kind: "npm" | "vendored";
	/** Model-facing tool names this source registers into a MAIN/PARENT session. Empty is a real, asserted zero. */
	toolNames: readonly string[];
	/** True if ANY of this row's tools carries `promptSnippet` or `promptGuidelines`. */
	promptMetadata: boolean;
	why: string;
}

/** One row per pinned npm package and per vendored extension; a zero-tool row asserts no tool has been added. */
const TOOL_COUNT_BASELINE: readonly ToolCountRow[] = [
	{
		source: "pi-subagents",
		kind: "npm",
		toolNames: ["subagent", "bg_wait", "subagents_enable", "subagent_supervisor"],
		promptMetadata: true,
		why: "EXT-01..EXT-04 -- re-derived at 0.76.1 compiled JS (08.1-04): `subagent` registered at " +
			"src/extension/index.js:667,699; registerWaitTool -> `bg_wait` (src/extension/index.js:712, " +
			"src/runs/background/wait-tool.js:28,34; 0.49.0 named it `subagent_wait`); loader `subagents_enable` " +
			"(src/extension/tool-activation.js:78,114, carries promptSnippet at :82); session_start -> " +
			"supervisorChannel.start() (index.js:1056,1084) -> registerParentTools() -> `subagent_supervisor` " +
			"(NATIVE_SUPERVISOR_TOOL_NAME, native-supervisor-channel.js:13,655). `intercom` is no longer " +
			"registered. `contact_supervisor` and the child-runtime tools never appear in the parent session " +
			"-- see this file's own docstring, cited with file:line",
	},
	{
		source: ".pi/extensions/background-tasks/index.ts",
		kind: "vendored",
		toolNames: ["bg_run", "bg_status", "bg_logs", "bg_kill"],
		promptMetadata: true,
		why: "EXT-05 background bash -- vendored pi-background-tasks@2.6.9, process-only (D-02, 08.1-05). Four tools " +
			"registered in src/extension.ts (bg_run, bg_status, bg_logs, bg_kill; table in PROVENANCE.md). The delegate/fusion/" +
			"attested tools that made the npm package cost eleven tools are not vendored. Confirmed by grep: " +
			"registerTool( appears exactly four times in the vendored tree. All four carry promptSnippet and promptGuidelines.",
	},
	{
		source: "@narumitw/pi-lsp",
		kind: "npm",
		toolNames: ["lsp_diagnostics", "lsp_fix"],
		promptMetadata: true,
		why: "EXT-05 LSP diagnostics -- re-read at 0.49.9 (08.1-04): both registered unconditionally in lsp() " +
			"(src/pi-lsp.ts:149,158; the manifest's ./dist/index.ts entry is the built copy of src/). Names confirmed " +
			"at src/pi-lsp.ts:45,105. Both carry promptSnippet and promptGuidelines (src/pi-lsp.ts:48-49,108-109).",
	},
	{
		source: "pi-web-access",
		kind: "npm",
		toolNames: ["web_search", "source_check", "fetch_content", "get_search_content", "web_enable"],
		promptMetadata: true,
		why: "EXT-05 web lookup -- re-read at 0.38.0 (08.1-04). The four tools are CONDITIONAL in general (each " +
			"gated by its own isToolEnabled() check, index.ts:738-741, registered at :1405,:1950,:1972,:2160) but " +
			".pi/settings.json carries no pi-web-access-specific config, and the default resolves true for all four. " +
			"The loader `web_enable` (tool-activation.ts:11,73) is registered by index.ts:2259 whenever " +
			"toolActivation is not \"eager\" (default \"auto\", index.ts:724). All five carry promptSnippet " +
			"(index.ts:1411,1954,1976,2164; tool-activation.ts:77); none was found carrying promptGuidelines.",
	},
	{
		source: "pi-session-finder",
		kind: "npm",
		toolNames: [],
		promptMetadata: false,
		why: "EXT-05 session search -- zero registerTool( call sites anywhere in src/ (grepped this " +
			"session, confirmed empty, matching the existing docs/EXTENSIONS.md row). /find and " +
			"/find-back are commands (src/index.ts:264,430), zero schema cost per BOOT-10's own citation " +
			"that system-prompt.ts carries no reference to registered commands.",
	},
	{
		source: ".pi/extensions/todo.ts",
		kind: "vendored",
		toolNames: ["todo"],
		promptMetadata: false,
		why: "EXT-05/EXT-06 -- vendored Pi bundled example, plan 07-08. Registers `todo` " +
			"(.pi/extensions/todo.ts:195-196), 383 bytes / 96 tokens measured (07-08-SUMMARY.md). No " +
			"promptSnippet/promptGuidelines anywhere in the file (grepped, confirmed empty).",
	},
	{
		source: ".pi/extensions/questionnaire.ts",
		kind: "vendored",
		toolNames: ["questionnaire"],
		promptMetadata: false,
		why: "EXT-05/EXT-06 -- vendored Pi bundled example, plan 07-08. Registers `questionnaire` " +
			"(.pi/extensions/questionnaire.ts:147-148), 1258 bytes / 315 tokens measured " +
			"(07-08-SUMMARY.md). No promptSnippet/promptGuidelines anywhere in the file (grepped, " +
			"confirmed empty).",
	},
	{
		source: ".pi/extensions/plan-mode/index.ts",
		kind: "vendored",
		toolNames: [],
		promptMetadata: false,
		why: "EXT-05/EXT-06 -- vendored Pi bundled example, plan 07-07. Registers ZERO tools -- it gates " +
			"which of Pi's already-registered built-in tools are active via pi.setActiveTools, which is " +
			"not a registration and costs no schema tokens (this file's own vendoring header, verified by " +
			"grep across index.ts and utils.ts returning no registerTool( match).",
	},
	{
		source: ".pi/extensions/loop-police/index.ts",
		kind: "vendored",
		toolNames: [],
		promptMetadata: false,
		why: "EXT-05/EXT-10 -- vendored pi-loop-police@1.14.1 (no LICENSE file in tarball), plan 07-06. " +
			"Registers ZERO tools -- PROVENANCE.md's own review confirms zero registerTool matches across " +
			"index.ts and loop-police.ts; one command (/loop-police) and one message renderer, both zero " +
			"schema cost.",
	},
	{
		source: ".pi/extensions/checkpoint/index.ts",
		kind: "vendored",
		toolNames: [],
		promptMetadata: false,
		why: "EXT-07 -- vendored, hardened Pi bundled example (git-checkpoint.ts), plan 07-03. Registers " +
			"ZERO tools -- grepped index.ts, git.ts and store.ts, no registerTool( match; a single " +
			"/checkpoint-restore command, zero schema cost per BOOT-10's own citation.",
	},
	{
		source: ".pi/extensions/quality/index.ts",
		kind: "vendored",
		toolNames: ["consult_advisor"],
		promptMetadata: false,
		why: "GATE-09 -- plan 08-11's entry point registers `consult_advisor` (built as a plain module by " +
			"plan 08-08's advisor.ts, wired to pi.registerTool here), 584 bytes / 146 tokens measured " +
			"(08-08-SUMMARY.md, verbatim; see tests/unit/contributing-boundary.test.ts's own allowlist " +
			"entry for the full (a)/(b)/(c) answers). `kind: \"vendored\"` here means \"in-repo authored " +
			"source, grep-enforced against this repository's own tracked files\" -- not an upstream " +
			"vendored package -- and this row is checked by the SAME Direction 1 vendored-row grep as " +
			"every other in-repo entry above; there is no better member of this file's kind union for " +
			"authored-in-repo code. promptMetadata is false: `grep -rc \"promptSnippet\\|promptGuidelines\" " +
			".pi/extensions/quality/` returns 0 -- neither optional per-tool prompt-metadata field is set " +
			"anywhere in this subsystem, so activating this tool never rebuilds the system prompt or " +
			"invalidates the provider cache prefix.",
	},
];

/** pi-subagents serves the subagent requirements, not one of the eight capabilities; named, not silently allowed. */
const PI_SUBAGENTS_EXCEPTION = "pi-subagents";

/** Every `name:` of a `registerTool(` call site, grep-shaped; throws on a call site with no readable name. */
function extractRegisteredToolNames(text: string): string[] {
	const names: string[] = [];
	const callSite = /registerTool\s*(?:<[^>]*>)?\s*\(/g;
	let match: RegExpExecArray | null = callSite.exec(text);
	while (match !== null) {
		const window = text.slice(match.index, match.index + 400);
		const nameMatch = /name:\s*["']([^"']+)["']/.exec(window);
		if (!nameMatch) {
			throw new Error(
				`registerTool( call at index ${match.index} has no name: "..." within a 400-char window -- ` +
					"extend the window or read the call site directly rather than silently skipping it",
			);
		}
		names.push(nameMatch[1] as string);
		match = callSite.exec(text);
	}
	return names;
}

/** The `.ts` files a vendored row covers: the whole directory for a nested index, else the file itself. */
function filesForVendoredRow(source: string): string[] {
	if (NESTED_INDEX.test(source)) {
		const dir = source.slice(0, source.lastIndexOf("/"));
		return trackedFiles(dir).filter((p) => p.endsWith(".ts"));
	}
	return [source];
}

/**
 * Tracked entry-point-shaped `.ts` files under `.pi/extensions/` carrying the vendored marker. Not filtered through
 * `isEntryPoint`: loop-police/index.ts re-exports its default, which that regex does not count, yet Pi loads it.
 */
function discoverVendoredEntryPoints(): string[] {
	return trackedFiles(EXT_DIR)
		.filter((p) => p.endsWith(".ts"))
		.filter((p) => FLAT.test(p) || NESTED_INDEX.test(p))
		.filter((p) => VENDORED_MARKER.test(readFileSync(join(repoRoot(), p), "utf-8")))
		.sort();
}

describe("tool-count-baseline -- vacuity guard", () => {
	it("TOOL_COUNT_BASELINE has at least one row, and at least one row with a non-empty toolNames", () => {
		expect(TOOL_COUNT_BASELINE.length, "an empty registry proves nothing").toBeGreaterThanOrEqual(1);
		expect(
			TOOL_COUNT_BASELINE.some((row) => row.toolNames.length > 0),
			"every row has zero tools -- without at least one non-empty row, the whole registry could be " +
				"vacuously all-zero and every assertion below would still pass",
		).toBe(true);
	});
});

describe("tool-count-baseline Direction 1 -- the vendored side is mechanically checkable from tracked source", () => {
	const vendoredRows = TOOL_COUNT_BASELINE.filter((row) => row.kind === "vendored");

	it("collected at least one vendored row (non-vacuity)", () => {
		expect(vendoredRows.length).toBeGreaterThanOrEqual(1);
	});

	it.each(vendoredRows)("$source registers exactly its declared toolNames, no more, no fewer", (row) => {
		const files = filesForVendoredRow(row.source);
		expect(files.length, `no tracked .ts file(s) found for ${row.source}`).toBeGreaterThanOrEqual(1);
		const found = files.flatMap((file) => extractRegisteredToolNames(readFileSync(join(repoRoot(), file), "utf-8")));
		expect(
			[...found].sort(),
			`${row.source} registers ${JSON.stringify([...found].sort())} but TOOL_COUNT_BASELINE declares ` +
				`${JSON.stringify([...row.toolNames].sort())} -- this is drift in this repository's OWN tree, ` +
				"which this half of the registry exists specifically to catch",
		).toEqual([...row.toolNames].sort());
	});
});

describe("tool-count-baseline Direction 2 -- the npm side, recorded not re-derived, pin presence only", () => {
	const npmRows = TOOL_COUNT_BASELINE.filter((row) => row.kind === "npm");

	it("collected at least one npm row (non-vacuity)", () => {
		expect(npmRows.length).toBeGreaterThanOrEqual(1);
	});

	it.each(npmRows)("$source is still pinned in packages[] at a version (toolNames are RECORDED, not re-checked here)", (row) => {
		const packages = readSettingsPackages();
		const offenders = packages.filter((spec) => spec.startsWith(`npm:${row.source}@`));
		expect(
			offenders.length,
			`no packages[] entry starts with "npm:${row.source}@" -- this row's RECORDED toolNames ` +
				`(${row.toolNames.join(", ") || "none"}) no longer correspond to a pinned package at all`,
		).toBeGreaterThanOrEqual(1);
	});
});

describe("tool-count-baseline Direction 3 -- completeness, both ways, both sides", () => {
	describe("npm side", () => {
		const npmRowSources = new Set(TOOL_COUNT_BASELINE.filter((row) => row.kind === "npm").map((row) => row.source));

		it("present-but-undeclared: every npm: entry in packages[] has a baseline row (or is the named pi-subagents... wait, pi-subagents IS in the registry here)", () => {
			const packages = readSettingsPackages();
			const offenders = packages
				.map((spec) => packageNameFromNpmSpec(spec))
				.filter((name): name is string => name !== undefined)
				.filter((name) => !npmRowSources.has(name));
			expect(
				offenders,
				`packages[] names a package with no TOOL_COUNT_BASELINE row (${offenders.join(", ")}) -- ` +
					"Phase 10 cannot budget against a package this registry does not know about",
			).toEqual([]);
		});

		it("declared-but-absent: every npm row's source is still named in packages[]", () => {
			const packages = readSettingsPackages();
			const pinnedNames = new Set(packages.map((spec) => packageNameFromNpmSpec(spec)).filter((n): n is string => n !== undefined));
			const offenders = [...npmRowSources].filter((name) => !pinnedNames.has(name));
			expect(offenders, `these TOOL_COUNT_BASELINE rows name a package no longer in packages[] (${offenders.join(", ")})`).toEqual([]);
		});
	});

	describe("vendored side", () => {
		const discovered = discoverVendoredEntryPoints();
		const declaredSources = new Set(TOOL_COUNT_BASELINE.filter((row) => row.kind === "vendored").map((row) => row.source));

		it("discovers at least one vendored entry point (non-vacuity for this half)", () => {
			expect(discovered.length).toBeGreaterThanOrEqual(1);
		});

		it("present-but-undeclared: every tracked vendored entry point has a baseline row", () => {
			const offenders = discovered.filter((p) => !declaredSources.has(p));
			expect(
				offenders,
				`these tracked, "vendored"-marked entry points have no TOOL_COUNT_BASELINE row (${offenders.join(", ")})`,
			).toEqual([]);
		});

		it("declared-but-absent: every vendored row's source is still a tracked, vendored-marked entry point", () => {
			const offenders = [...declaredSources].filter((source) => !discovered.includes(source));
			expect(offenders, `these TOOL_COUNT_BASELINE vendored rows no longer resolve on disk (${offenders.join(", ")})`).toEqual([]);
		});
	});
});

describe("tool-count-baseline -- profile completeness", () => {
	it("every baseline tool is classified in the routing profile table", () => {
		const classified = new Set(classifiedToolNames());
		for (const row of TOOL_COUNT_BASELINE) {
			for (const name of row.toolNames) {
				expect(classified.has(name), `${name} (${row.source}) is unclassified: classify it in routing/profiles.ts`).toBe(true);
			}
		}
	});
});

describe("tool-count-baseline Direction 4 -- vendored background tasks stay process-only", () => {
	const bgTasksRow = TOOL_COUNT_BASELINE.find((row) => row.source === ".pi/extensions/background-tasks/index.ts");

	it("a vendored background-tasks row exists (vacuity guard for this direction)", () => {
		expect(bgTasksRow, "no .pi/extensions/background-tasks row in TOOL_COUNT_BASELINE").toBeDefined();
	});

	it("lists exactly the four process tools and none of the dropped delegate/fusion/attested tools", () => {
		expect([...(bgTasksRow?.toolNames ?? [])].sort()).toEqual(["bg_kill", "bg_logs", "bg_run", "bg_status"]);
	});
});

/** pi-subagents has a normal npm row here; only extension-composition.test.ts excludes it. */
describe("tool-count-baseline -- pi-subagents needs no exception here, unlike extension-composition.test.ts", () => {
	it("pi-subagents has a normal TOOL_COUNT_BASELINE row (this file counts ALL installed packages' tools, not just EXT-05's eight)", () => {
		expect(TOOL_COUNT_BASELINE.some((row) => row.source === PI_SUBAGENTS_EXCEPTION)).toBe(true);
	});
});
