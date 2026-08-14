/**
 * The Phase 10 tool-count baseline: every model-facing tool this repository's
 * `.pi/settings.json` `packages[]` lockfile and vendored `.pi/extensions/`
 * tree admit, one row per source, including the zero-tool rows.
 *
 * WHY THIS FILE EXISTS. Every registered tool's full JSON Schema rides in
 * `tools[]` on EVERY provider request [VERIFIED: pi-ai
 * src/api/openai-completions.ts:1337-1372, called at :731 -- the same
 * citation `tests/unit/contributing-boundary.test.ts` (BOOT-10) already
 * carries]. Phase 2 measured a ~1,850 tok/turn floor for a 7-tool session;
 * Phase 10 owns deciding what to cut from that bill. A count that lives only
 * in `docs/EXTENSIONS.md`'s prose or `07-RESEARCH.md`'s Addendum A4 is not a
 * baseline Phase 10 can trust -- this file is that baseline, checked in both
 * directions on the half this repository can mechanically enforce (the
 * vendored side) and honestly labelled as a recorded, re-read observation on
 * the half it cannot (the npm side -- nothing was installed by this plan or
 * any prior Phase 7 plan; `07-10-SUMMARY.md`'s install gate was NOT
 * SATISFIED).
 *
 * THIS SESSION'S RE-VERIFICATION, NOT A COPY OF ADDENDUM A4. Every npm row's
 * `toolNames` below was obtained by `npm pack <pkg>@<pinned-version>
 * --ignore-scripts` + `tar -xf` into a scratch directory under this session's
 * own temp scratchpad (never this repo, never `~/.pi`), grepping the
 * extracted `.ts` source for `registerTool(` call sites and their `name:`
 * fields, then deleting the scratch directory -- the same read-only technique
 * `07-01-SUMMARY.md`, `07-10-SUMMARY.md` and `07-12-SUMMARY.md` already used.
 * No `npm install`, `pi install`, or `pi update` was run by this file's
 * authoring. The exact `file:line` citations are recorded in
 * `07-11-SUMMARY.md`, not repeated in full here (this file asserts against
 * the citations' CONCLUSIONS -- the tool-name sets -- not the citations
 * themselves, which would require re-fetching the tarball on every test run).
 *
 * THE BOUNDARY, STATED PLAINLY (this is what distinguishes the two `kind`s):
 *
 *   - `"vendored"` rows are MECHANICALLY ENFORCED, every run, against this
 *     repository's own tracked source (Direction 1): grep the tracked
 *     file(s) for `registerTool(`, extract every `name:` field, and assert
 *     the set equals the row's `toolNames` exactly. This half is real
 *     drift-detection in this repository's own tree.
 *
 *   - `"npm"` rows are a RECORDED BASELINE, not something this file can
 *     re-derive on a fresh clone: `.pi/npm/` and `.pi/git/` are gitignored
 *     (`.gitignore:154-157`), CI never runs `pi install`, and this plan's own
 *     critical constraints forbid running one. Direction 2 asserts only that
 *     the package is still pinned in `packages[]` at a version -- the
 *     `toolNames` themselves are read from source, ONCE, in this session, and
 *     go stale silently the moment the pin moves without a re-read. This is
 *     the identical boundary discipline `tests/unit/docs-policy.test.ts` and
 *     `tests/unit/agent-dir-setup.test.ts` already use for their own
 *     conditional [RUNBOOK]/machine-state checks, and the identical boundary
 *     `tests/unit/subagent-capabilities.test.ts` (07-12) already states for
 *     its own third-party evidence table.
 *
 * CHILD-PROCESS-ONLY EXCLUSIONS, NAMED RATHER THAN SILENTLY DROPPED.
 * `pi-subagents@0.49.0` registers two further tool NAMES that never appear in
 * this baseline because neither is ever active in the PARENT (main) session:
 *
 *   - `contact_supervisor` is registered only by
 *     `registerNativeSupervisorClient()`, gated by
 *     `if (!readChildMetadata()) return;`
 *     [VERIFIED: src/intercom/native-supervisor-channel.ts:299,303] -- this
 *     function runs inside a spawned CHILD subagent's own process, never the
 *     parent. The PARENT session instead registers `subagent_supervisor`
 *     (constant `NATIVE_SUPERVISOR_TOOL_NAME`
 *     [VERIFIED: native-supervisor-channel.ts:21,650]) and `intercom`
 *     [VERIFIED: native-supervisor-channel.ts:651], both via
 *     `registerParentTools()`, called unconditionally from
 *     `supervisorChannel.start()` inside `pi.on("session_start", ...)`
 *     [VERIFIED: src/extension/index.ts:827-835]. This is a correction to
 *     `07-12-SUMMARY.md`'s own finding 9, which named the parent-session pair
 *     as "contact_supervisor and intercom" -- re-reading the pinned source
 *     directly in this session shows the parent tool is `subagent_supervisor`
 *     (`buildParentIntercomTool(pending, state, NATIVE_SUPERVISOR_TOOL_NAME)`
 *     at native-supervisor-channel.ts:650), not `contact_supervisor`, which
 *     the child-only guard above proves cannot appear in the parent session
 *     at all. This file's own `pi-subagents` row uses the corrected name; the
 *     plan's own `<baseline_starting_point>` table already had it right.
 *   - `structured_output` is registered only when BOTH
 *     `process.env[STRUCTURED_OUTPUT_CAPTURE_ENV]` and
 *     `process.env[STRUCTURED_OUTPUT_SCHEMA_ENV]` are set
 *     [VERIFIED: src/runs/shared/subagent-prompt-runtime.ts:609-622] --
 *     env vars this package sets only when spawning a child subagent process
 *     for a step that declared an `outputSchema`. It is conditional AND
 *     child-process-scoped; it never appears in the parent session's active
 *     tool list either.
 *
 * `pi-web-access@0.22.0`'s four tools are each gated by their own
 * `isToolEnabled()` check [VERIFIED: index.ts:244-248, call sites at
 * :1635,:2207,:2301,:2619] -- CONDITIONAL in general, but this repository's
 * `.pi/settings.json` carries no `pi-web-access`-specific configuration at
 * all, and `isToolEnabled()`'s own default (no override present) resolves to
 * `true` for all four keys. Recorded as "conditional, default-enabled with
 * this repo's actual config" rather than flatly "always active" or flatly
 * "conditional" -- neither alone is the honest answer.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";

const SETTINGS_PATH = join(".pi", "settings.json");
const EXT_DIR = ".pi/extensions";

const FLAT = /^\.pi\/extensions\/[^/]+\.ts$/;
const NESTED_INDEX = /^\.pi\/extensions\/[^/]+\/index\.ts$/;

/** The same case-insensitive marker every vendored entry point's header carries -- see Direction 3. */
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

/**
 * THE REGISTRY. One row per installed (pinned, though never actually
 * installed on this machine -- see the file docstring) npm package, one row
 * per vendored extension, including the zero-tool rows -- a zero-tool row is
 * the assertion that the extension has not grown a tool since this session.
 */
const TOOL_COUNT_BASELINE: readonly ToolCountRow[] = [
	{
		source: "pi-subagents",
		kind: "npm",
		toolNames: ["subagent", "subagent_wait", "subagent_supervisor", "intercom"],
		promptMetadata: false,
		why: "EXT-01..EXT-04 -- all four registered unconditionally (src/extension/index.ts:578 `subagent`, :621 registerTool, " +
			":623 registerWaitTool -> `subagent_wait` at src/runs/background/wait-tool.ts:9, :827-835 " +
			"session_start -> supervisorChannel.start() -> registerParentTools() -> `subagent_supervisor` " +
			"(NATIVE_SUPERVISOR_TOOL_NAME, native-supervisor-channel.ts:21,650) and `intercom` (:651)); " +
			"`contact_supervisor` and `structured_output` are real tool names in this package but never appear " +
			"in the parent session -- see this file's own docstring for both guards, cited with file:line",
	},
	{
		source: "pi-background-tasks",
		kind: "npm",
		toolNames: [
			"bg_run",
			"bg_run_pi_attested",
			"bg_status",
			"bg_logs",
			"bg_kill",
			"bg_delegate",
			"bg_result",
			"fusion_reason",
			"fusion_investigate",
			"fusion_research",
			"fusion_validate",
		],
		promptMetadata: true,
		why: "EXT-05 background bash -- all eleven registered unconditionally inside " +
			"backgroundTasksExtension() (src/extension.ts:206, the manifest's " +
			"./extensions/background-tasks.ts entry): 5 bg_* at src/extension.ts:682,767,832,863,908; " +
			"registerFusionExtension(pi,...) called at src/extension.ts:232 registers the 4 fusion_* tools " +
			"(fusion-extension.ts:1179,1197,1216,1236); registerDelegateExtension(pi,...) called at " +
			"src/extension.ts:241 registers bg_delegate/bg_result (delegate-extension.ts:340,516). " +
			"Decision D-07-B: bg_delegate, bg_result, fusion_reason, fusion_investigate, fusion_research and " +
			"fusion_validate -- six tools -- duplicate pi-subagents' own delegation/multi-model-reasoning " +
			"surface and cannot be filtered by any file-path glob, because both calls sit inside the same " +
			"unconditional extension-init function as the four wanted bg_* tools. Accepted as unavoidable " +
			"overhead if this package were ever installed; the single strongest Phase 10 cut target named by " +
			"this phase. All 11 tools carry both promptSnippet and promptGuidelines.",
	},
	{
		source: "@narumitw/pi-lsp",
		kind: "npm",
		toolNames: ["lsp_diagnostics", "lsp_fix"],
		promptMetadata: true,
		why: "EXT-05 LSP diagnostics -- both registered unconditionally in lsp() (src/pi-lsp.ts:145-147, " +
			"the manifest's ./src/index.ts entry re-exporting this default). Names confirmed at " +
			"src/pi-lsp.ts:50,112. Both carry promptSnippet and promptGuidelines (src/pi-lsp.ts:53-54,115-116).",
	},
	{
		source: "pi-web-access",
		kind: "npm",
		toolNames: ["web_search", "source_check", "fetch_content", "get_search_content"],
		promptMetadata: true,
		why: "EXT-05 web lookup -- CONDITIONAL in general (each gated by its own isToolEnabled() check, " +
			"index.ts:244-248, call sites at :1635,:2207,:2301,:2619), but this repository's " +
			".pi/settings.json carries no pi-web-access-specific config at all, and isToolEnabled()'s own " +
			"default (no override) resolves true for all four keys -- so if this package were ever " +
			"installed with this repo's current settings, all four would register. Default names " +
			"web_search/source_check/fetch_content/get_search_content (index.ts:225-228). All four carry " +
			"promptSnippet; none was found carrying promptGuidelines.",
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
];

/** Exception: `pi-subagents` serves EXT-01..EXT-04, not one of EXT-05's eight capabilities -- named, not silently allowed. */
const PI_SUBAGENTS_EXCEPTION = "pi-subagents";

function readSettings(): Record<string, unknown> {
	return JSON.parse(readFileSync(join(repoRoot(), SETTINGS_PATH), "utf-8")) as Record<string, unknown>;
}

function readSettingsPackages(): string[] {
	const packages = readSettings().packages;
	if (packages === undefined) {
		return [];
	}
	if (!Array.isArray(packages)) {
		throw new Error(`${SETTINGS_PATH} "packages" is present but not an array`);
	}
	return packages as string[];
}

function packageNameFromNpmSpec(spec: string): string | undefined {
	if (!spec.startsWith("npm:")) {
		return undefined;
	}
	const withoutPrefix = spec.slice("npm:".length);
	const atIndex = withoutPrefix.indexOf("@", withoutPrefix.startsWith("@") ? 1 : 0);
	return atIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, atIndex);
}

/**
 * Every `name:` field belonging to a `registerTool(` (optionally generic,
 * `registerTool<Foo, Bar>(`) call site in `text`, matched within a bounded
 * lookahead window so this stays a simple grep-shaped extraction rather than
 * a parser, mirroring `tests/unit/contributing-boundary.test.ts`'s own
 * deliberately-a-substring-not-a-parser `registerTool` matching rule. Throws
 * on a `registerTool(` call with no `name:` found in the window -- a parser
 * that silently skips an unreadable call site is how a registry with a real
 * gap passes every assertion below.
 */
function extractRegisteredToolNames(text: string): string[] {
	const names: string[] = [];
	const callSite = /registerTool\s*(?:<[^>]*>)?\s*\(/g;
	let match: RegExpExecArray | null = callSite.exec(text);
	while (match !== null) {
		const window = text.slice(match.index, match.index + 400);
		const nameMatch = /name:\s*"([^"]+)"/.exec(window);
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

/** The `.ts` file(s) a vendored row's `source` should be scanned across -- the whole directory for a nested-index row, just the file itself for a flat row. */
function filesForVendoredRow(source: string): string[] {
	if (NESTED_INDEX.test(source)) {
		const dir = source.slice(0, source.lastIndexOf("/"));
		return trackedFiles(dir).filter((p) => p.endsWith(".ts"));
	}
	return [source];
}

/**
 * Tracked `.ts` files under `.pi/extensions/` sitting at an auto-discovered
 * entry-point SHAPE (FLAT or NESTED_INDEX) whose source carries the
 * case-insensitive "vendored" marker.
 *
 * Deliberately NOT filtered through `extension-layout.test.ts`'s exported
 * `isEntryPoint` discriminator: `.pi/extensions/loop-police/index.ts`
 * re-exports its default
 * (`export { loopPolice as default } from "./loop-police.ts";`) rather than
 * declaring `export default ...` directly, so `isEntryPoint`'s
 * `DEFAULT_EXPORT` regex -- correctly scoped to `extension-layout.test.ts`'s
 * own narrower question of "does THIS file's own text declare a default
 * export" -- returns `false` for it, even though Pi auto-discovers and loads
 * this exact path. `extension-layout.test.ts`'s own BOOT-05 suite never
 * noticed because loop-police/index.ts's path ALSO satisfies its
 * `NESTED_MODULE` fallback shape, so its own completeness check passes
 * either way; this file's narrower "is this a vendored entry point" question
 * has no such fallback and needs the correct classification. Found and fixed
 * during this task's own falsification pass (Direction 3, mutation ii).
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

describe("tool-count-baseline Direction 4 -- the Phase 10 handoff, made explicit and greppable", () => {
	const bgTasksRow = TOOL_COUNT_BASELINE.find((row) => row.source === "pi-background-tasks");

	it("a pi-background-tasks row exists (vacuity guard for this direction)", () => {
		expect(bgTasksRow, "no pi-background-tasks row in TOOL_COUNT_BASELINE").toBeDefined();
	});

	it("lists all eleven tools", () => {
		expect(bgTasksRow?.toolNames.length).toBe(11);
	});

	it("its why names the six delegate/fusion tools as redundant with pi-subagents and unfilterable, citing src/extension.ts:232 and :241", () => {
		const why = bgTasksRow?.why ?? "";
		expect(why.includes("bg_delegate")).toBe(true);
		expect(why.includes("bg_result")).toBe(true);
		expect(why.includes("fusion_reason")).toBe(true);
		expect(why.includes("fusion_investigate")).toBe(true);
		expect(why.includes("fusion_research")).toBe(true);
		expect(why.includes("fusion_validate")).toBe(true);
		expect(why.includes("pi-subagents")).toBe(true);
		expect(why.includes("src/extension.ts:232")).toBe(true);
		expect(why.includes("src/extension.ts:241")).toBe(true);
		expect(why.toLowerCase().includes("cannot be filtered")).toBe(true);
	});
});

/**
 * Named so `PI_SUBAGENTS_EXCEPTION` (declared above for symmetry with
 * `tests/unit/extension-composition.test.ts`'s own named exception, per this
 * file's shared discipline with that one) is not flagged as dead code by a
 * future lint pass: it documents, at the point of declaration, WHY
 * `pi-subagents` needs no special-casing in this file's own Direction 3 (it
 * already has a normal `"npm"` row here, unlike `extension-composition.test.ts`
 * where it is deliberately excluded from `CAPABILITY_SOURCES` because it is
 * not one of the eight EXT-05 capabilities).
 */
describe("tool-count-baseline -- pi-subagents needs no exception here, unlike extension-composition.test.ts", () => {
	it("pi-subagents has a normal TOOL_COUNT_BASELINE row (this file counts ALL installed packages' tools, not just EXT-05's eight)", () => {
		expect(TOOL_COUNT_BASELINE.some((row) => row.source === PI_SUBAGENTS_EXCEPTION)).toBe(true);
	});
});
