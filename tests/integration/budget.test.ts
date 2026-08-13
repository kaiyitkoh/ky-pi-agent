/**
 * DIAG-06 — `/budget`'s decomposition, against the real system prompt of the
 * installed Pi version, and `cacheRead` versus `input` across two real turns.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE PROVES THAT THE UNIT TEST CANNOT
 * ---------------------------------------------------------------------------
 * `tests/unit/budget-sections.test.ts` proves the PARSER: given a string shaped
 * like a system prompt, the slicer accounts for every character of it. Every
 * fixture there is a string that file wrote itself, so a green run says nothing
 * about whether Pi still emits `<project_context>` — and Pi ships every 2-3
 * days.
 *
 * This file proves the MARKERS. It drives a live in-memory session, plants its
 * own small `AGENTS.md` so Pi's context-file discovery genuinely loads one, and
 * slices the string `ctx.getSystemPrompt()` really returned from the Pi version
 * installed in `node_modules`. If a future release renames a delimiter, this is
 * the file that goes red — instead of `/budget` silently attributing the whole
 * block to "base prompt" and reporting it with a straight face.
 * [threat T-02-10-02]
 *
 * ---------------------------------------------------------------------------
 * WHY A PROBE EXTENSION AND NOT A COMMAND
 * ---------------------------------------------------------------------------
 * `getSystemPromptOptions()` — the exact context-file and skill lists — exists
 * only on `ExtensionCommandContext`, not on the `ExtensionContext` a hook
 * receives [VERIFIED: pi 0.84.1 dist/core/extensions/types.d.ts:256 versus
 * :219-249; RESEARCH §7.1 cites the same as `types.ts:1352-1356`]. A headless
 * session has no way to invoke a slash command, so this file asserts the
 * SLICING against the real prompt and supplies the context-file list itself.
 * The command-context wiring — `getSystemPromptOptions()`,
 * `formatSkillsForPrompt`, `getLastAssistantUsage` — is covered by
 * `tests/unit/diagnostics-entry.test.ts` (the command is registered, exactly
 * once) and by manual use. That gap is stated rather than papered over.
 *
 * The probe captures `ctx.getSystemPrompt()` by writing it to a file in `cwd`.
 * Pi loads the extension through jiti, which keeps its own module registry, so
 * an in-process variable this file could read would never move (02-05's
 * finding, re-confirmed in 02-07, 02-08 and 02-09).
 *
 * ---------------------------------------------------------------------------
 * NO ABSOLUTE SIZE THRESHOLD IS ASSERTED ANYWHERE (RESEARCH Pitfall 9)
 * ---------------------------------------------------------------------------
 * "The system prompt must be under N characters" is an assertion about the
 * machine the suite runs on, not about the code: Pi walks up from `cwd`
 * collecting context files, so the number depends on the directory tree above
 * the temp dir. RESEARCH measured 50,881 characters from inside this repository
 * and 2,023 from a temp dir — both correct, neither a threshold. What is
 * asserted here is that the decomposition ACCOUNTS for whatever the number
 * turns out to be. There is deliberately no `toBeLessThan` in this file.
 *
 * ---------------------------------------------------------------------------
 * THE CACHE NUMBERS ARE FAUX NUMBERS
 * ---------------------------------------------------------------------------
 * `fauxProvider` runs a real prefix-cache SIMULATION keyed on
 * `options.sessionId` whenever `cacheRetention !== "none"`
 * [VERIFIED: pi-ai 0.84.1 src/providers/faux.ts:229-267, RESEARCH §8.5], which
 * is what makes `cacheRead` versus `input` exercisable with no credentials.
 * It is a simulation, not a provider measurement. What a real DeepSeek or
 * Bedrock turn reports is `RB-02-01`, which stays **OUTSTANDING**. Never read a
 * green run here as a live measurement.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";

import { beforeAll, describe, expect, it } from "vitest";

import {
	CONTEXT_FILES_OPEN_MARKER,
	PROVIDER_REPORTED_LABEL,
	ROWS_WRITTEN_LABEL,
	SKILLS_OPEN_MARKER,
	TOKEN_ESTIMATE_MARKER,
	computeBudget,
	formatBudgetReport,
	sliceSystemPrompt,
} from "../../.pi/extensions/diagnostics/budget.ts";
import { logPath } from "../../.pi/extensions/diagnostics/jsonl.ts";
import { TURNS_LOG_BASE } from "../../.pi/extensions/diagnostics/schema.ts";
import { repoRoot } from "../helpers/git.ts";
import { readTornSafe } from "../helpers/logs.ts";
import { withFauxSession } from "../helpers/session.ts";

/** Absolute path of the diagnostics extension this repository ships. */
const EXTENSION_ENTRY = `${repoRoot()}/.pi/extensions/diagnostics/index.ts`;

/** The context file this test plants. Small, known, and its own. */
const CONTEXT_FILE_NAME = "AGENTS.md";

/**
 * Its content. Short on purpose: the assertion is that the located block is at
 * least this long, never that it is under some ceiling.
 */
const CONTEXT_FILE_BODY = "# Project notes\n\nAlways run the tests before committing.\n";

/** Where the probe writes the system prompt it saw. Relative to `cwd`. */
const PROMPT_DUMP = "system-prompt.txt";

/** The one tool every session here activates, so the tool-schema column is real. */
const TOOL = "read";

/** The turn-row fields this file reads. */
interface TurnRowShape {
	kind?: string;
	input?: number;
	cacheRead?: number;
	cacheReadRatio?: number;
}

/** Everything one live session hands back for the cases below. */
interface Capture {
	/** `ctx.getSystemPrompt()`, exactly as the real extension's hook saw it. */
	prompt: string;
	/** `context.systemPrompt` as the provider adapter saw it, for cross-check. */
	providerPrompt: string | undefined;
	/** The tool list the provider was really sent. Real names, real schemas. */
	tools: readonly { name: string; description: string; parameters: unknown }[];
	/** Every row in the turns log, deserialised. */
	rows: TurnRowShape[];
	/** Raw text of every line that failed to parse. */
	unparseable: string[];
	/** Absolute path of the planted context file, as Pi renders it in the prompt. */
	contextPath: string;
}

/**
 * An extension that IS the real diagnostics extension, plus a prompt dump.
 *
 * Written inline rather than composed from two extension paths because
 * `createFauxSession` accepts one user-scope entry point and refuses both
 * options at once. `turn_start` is the hook because it fires on every turn and
 * its `ExtensionContext` carries `getSystemPrompt()`; the file is overwritten
 * each turn, so the last write is the prompt of the last turn.
 */
function probeSource(): string {
	return [
		'import { writeFileSync } from "node:fs";',
		'import { join } from "node:path";',
		`import diagnostics from ${JSON.stringify(EXTENSION_ENTRY.replace(/\\/g, "/"))};`,
		"export default function (pi) {",
		"\tdiagnostics(pi);",
		'\tpi.on("turn_start", (_event, ctx) => {',
		`\t\twriteFileSync(join(ctx.cwd, ${JSON.stringify(PROMPT_DUMP)}), ctx.getSystemPrompt(), "utf-8");`,
		"\t});",
		"}",
		"",
	].join("\n");
}

let live: Capture;

describe("DIAG-06 — /budget against a real system prompt and a real cache", () => {
	beforeAll(async () => {
		const outgoing: Context[] = [];

		live = await withFauxSession(
			{
				extensionSource: probeSource(),
				tools: [TOOL],
				// Pi discovers context files by walking up from `cwd` with candidates
				// ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md",
				// "CLAUDE.MD"] [VERIFIED: pi src/core/resource-loader.ts:71, 125-155].
				// `cwd` is a temp dir outside this repository, so this planted file is
				// the context file — from inside the repo Pi would load a 49 KB
				// CLAUDE.md instead and the test would be measuring the harness
				// (RESEARCH §8.4, threat T-02-01-02).
				cwdFiles: { [CONTEXT_FILE_NAME]: CONTEXT_FILE_BODY },
				responses: [
					(context) => {
						outgoing.push(context);
						return fauxAssistantMessage([fauxText("first answer")]);
					},
					(context) => {
						outgoing.push(context);
						return fauxAssistantMessage([fauxText("second answer")]);
					},
				],
			},
			async ({ session, cwd }) => {
				// TWO prompts in ONE session, so faux's prefix-cache simulation — keyed
				// on `options.sessionId` — has something to hit on the second.
				await session.prompt("hello");
				await session.prompt("hello again");

				const dump = join(cwd, PROMPT_DUMP);
				if (!existsSync(dump)) {
					throw new Error(
						`the probe wrote no ${PROMPT_DUMP} in ${cwd}. The extension must load at USER ` +
							"scope (<agentDir>/extensions/<name>/index.ts): project-scoped .pi/extensions " +
							"is gated behind project trust, which resolves false headless with no UI to " +
							"answer it, and a silently absent extension is a green run over nothing",
					);
				}

				const turnsFile = logPath(cwd, TURNS_LOG_BASE);
				if (!existsSync(turnsFile)) {
					throw new Error(
						`no turns log at ${turnsFile}. The diagnostics extension did not run, so every ` +
							"assertion about cacheRead below would be reading an empty set",
					);
				}
				const turns = readTornSafe(turnsFile);

				return {
					prompt: readFileSync(dump, "utf-8"),
					providerPrompt: outgoing[0]?.systemPrompt,
					tools: (outgoing[0]?.tools ?? []).map((tool) => ({
						name: tool.name,
						description: tool.description,
						parameters: tool.parameters as unknown,
					})),
					rows: turns.records as TurnRowShape[],
					unparseable: turns.unparseable,
					contextPath: join(cwd, CONTEXT_FILE_NAME),
				};
			},
		);
	});

	it("case 1: the sections sum against the prompt the installed Pi actually built", () => {
		expect(
			live.prompt.length,
			"the probe captured an empty system prompt, so every assertion below would be about " +
				"nothing. `ctx.getSystemPrompt()` returning empty means the hook ran before the " +
				"prompt was built",
		).toBeGreaterThan(0);

		// A cross-check the plan does not require, and worth having: the string
		// `/budget` reads must be the string the provider is sent. If they ever
		// diverge, the report would be decomposing a prompt nobody was charged for.
		expect(
			live.providerPrompt,
			"`ctx.getSystemPrompt()` and the `context.systemPrompt` the provider adapter received " +
				"must be the same string. `/budget` reports the former and the user pays for the " +
				"latter, so a divergence would make the whole report a description of something else",
		).toBe(live.prompt);

		const slices = sliceSystemPrompt(live.prompt);

		expect(
			slices.base + slices.contextFiles + slices.skills,
			"the decomposition must account for every character of the REAL prompt. The unit test " +
				"proves the parser against a fixture it wrote itself; this proves the markers still " +
				"exist in the Pi version actually installed in node_modules, which is the half that " +
				"a release two days from now can break",
		).toBe(slices.total);

		expect(
			slices.contextFilesFound,
			`a small ${CONTEXT_FILE_NAME} was planted in cwd and Pi's context-file discovery loads ` +
				`it, so ${CONTEXT_FILES_OPEN_MARKER.trim()} must be present. A false here means the ` +
				"delimiter moved and the report has been attributing the whole block to `base`",
		).toBe(true);

		expect(
			slices.contextFiles,
			"the located block must be at least as long as the file that produced it. This is a " +
				"floor, never a ceiling: the block also carries Pi's own delimiters, header and " +
				"per-file wrapper, and asserting an upper bound would fail on any machine whose " +
				"paths are longer (RESEARCH Pitfall 9)",
		).toBeGreaterThanOrEqual(CONTEXT_FILE_BODY.length);

		expect(
			live.prompt,
			"the planted file's content must really be in the prompt -- otherwise the block was " +
				"found but belongs to some other context file and the floor above proves nothing",
		).toContain(CONTEXT_FILE_BODY.trim());
	});

	it("case 2: marker liveness -- an absent section is reported, not guessed", () => {
		const slices = sliceSystemPrompt(live.prompt);

		expect(
			slices.skillsFound,
			`no skill is configured for this session, so Pi appends no skills index and ` +
				`"${SKILLS_OPEN_MARKER.trim()}" must be absent. The flag is how a reader tells that ` +
				"from a marker Pi renamed -- a silent 0 would mean the format changed and the report " +
				"has been wrong ever since",
		).toBe(false);

		expect(
			slices.skills,
			"consistently with the flag: no block, no characters. A non-zero size with the flag " +
				"false would mean the two are computed independently and can disagree",
		).toBe(0);

		// The warnings array must be SILENT for the situation this fixture set up:
		// context files present and located, no skills configured and none rendered.
		// A warnings array that fires on every healthy session is one nobody reads
		// on the session that mattered.
		const report = computeBudget({
			systemPrompt: live.prompt,
			contextFiles: [{ path: live.contextPath, content: CONTEXT_FILE_BODY }],
			skills: [],
			// `formatSkillsForPrompt([])` returns "" [VERIFIED: pi src/core/skills.ts:338-340].
			// Spelled as the empty string here because this file cannot call the
			// command-context path that would produce it -- see the module docstring.
			skillsBlock: "",
			tools: live.tools,
			lastUsage: undefined,
			rowsWritten: 0,
		});

		expect(
			report.warnings,
			"nothing diverged: the context marker was found where context files exist, and no " +
				"skills block was expected or rendered. Every warning this array can carry means " +
				"`this report may be wrong`, so an empty one here is what makes a non-empty one " +
				"later worth acting on",
		).toEqual([]);

		expect(
			report.skillsBlockMatchesSlice,
			"an empty recomputed block and an empty sliced region agree. The cross-check against " +
				"`formatSkillsForPrompt` is RESEARCH §7.3's tripwire for Pi changing its format",
		).toBe(true);

		expect(
			live.tools.length,
			"the session activates one tool, so the tool-schema column is computed over a real " +
				"schema rather than an empty list. Without this, case 4's report would have no tool " +
				"rows and the column would be untested here",
		).toBeGreaterThanOrEqual(1);
	});

	it("case 3: cacheRead versus input across two turns of one session", () => {
		expect(
			live.unparseable,
			"a torn line in the turns log makes every count below unreliable",
		).toEqual([]);

		const turnRows = live.rows.filter((row) => row.kind === "turn");
		expect(
			turnRows.length,
			"two prompts must have produced two `kind: \"turn\"` rows. Filtering on `kind` first is " +
				"mandatory: the log also carries kind-less event records (02-09's handover), and " +
				"counting those as turns would pick the wrong two",
		).toBe(2);

		const [firstTurn, secondTurn] = turnRows;

		expect(
			firstTurn?.cacheRead,
			"THE PAIRED NEGATIVE. The first turn of a session has no prefix to hit, so it must read " +
				"nothing from cache. Without this half, a column that reported a non-zero number " +
				"unconditionally would pass the assertion below",
		).toBe(0);

		expect(
			secondTurn?.cacheRead,
			"the second turn of the SAME session must read from cache. This exercises faux's " +
				"prefix-cache simulation keyed on `options.sessionId` (faux.ts:229-267), NOT a " +
				"provider measurement -- RB-02-01 is the live figure and stays OUTSTANDING",
		).toBeGreaterThan(0);

		const input = secondTurn?.input ?? 0;
		const cacheRead = secondTurn?.cacheRead ?? 0;
		expect(
			input,
			"a ratio computed against a zero denominator would be meaningless, so the fresh half " +
				"of the second turn must be non-zero too",
		).toBeGreaterThan(0);

		const report = computeBudget({
			systemPrompt: live.prompt,
			contextFiles: [{ path: live.contextPath, content: CONTEXT_FILE_BODY }],
			skills: [],
			skillsBlock: "",
			tools: live.tools,
			lastUsage: { input, cacheRead },
			rowsWritten: live.rows.length,
		});

		expect(
			report.lastUsage,
			"both provider-reported numbers must survive into the report. They are the only exact " +
				"token figures it carries, and printing one without the other leaves a reader unable " +
				"to see how much of the prompt was paid for twice",
		).toEqual({ input, cacheRead });

		expect(
			report.cacheReadRatio,
			"cacheRead / (input + cacheRead) -- the same definition as `TurnRow.cacheReadRatio` in " +
				"schema.ts, so the number on screen and the number in the log mean one thing",
		).toBeCloseTo(cacheRead / (input + cacheRead), 10);

		expect(
			report.cacheReadRatio ?? -1,
			"strictly between 0 and 1. Exactly 0 would mean nothing was cached and exactly 1 that " +
				"nothing was fresh; either endpoint here means the ratio is not being computed from " +
				"these two turns at all",
		).toBeGreaterThan(0);
		expect(report.cacheReadRatio ?? 2, "see above -- the upper endpoint").toBeLessThan(1);
	});

	it("case 4: the report renders, names the context file, and separates estimate from truth", () => {
		const turnRows = live.rows.filter((row) => row.kind === "turn");
		const last = turnRows[turnRows.length - 1];
		expect(
			last,
			"no turn row to read the provider-reported figures from; the assertion below would be " +
				"about an undefined",
		).toBeDefined();

		const report = computeBudget({
			systemPrompt: live.prompt,
			contextFiles: [{ path: live.contextPath, content: CONTEXT_FILE_BODY }],
			skills: [],
			skillsBlock: "",
			tools: live.tools,
			lastUsage: { input: last?.input ?? 0, cacheRead: last?.cacheRead ?? 0 },
			rowsWritten: live.rows.length,
		});
		const text = formatBudgetReport(report);

		expect(text.length, "an empty report is a command that does nothing").toBeGreaterThan(0);

		expect(
			text,
			"the report must NAME the context file. A size with no name tells an operator that " +
				"context is expensive and not which file to cut -- and naming the path is also the " +
				"boundary: paths and counts only, never content [threat T-02-10-01]",
		).toContain(live.contextPath);

		expect(
			text.includes(CONTEXT_FILE_BODY.trim()),
			"NO FILE CONTENT MAY APPEAR. A user's global context file may hold things this public " +
				"repository never should, and `/budget` writes nothing to disk either",
		).toBe(false);

		expect(
			text,
			`every token figure carries "${TOKEN_ESTIMATE_MARKER}" because there is no tokenizer in ` +
				"either Pi package and none may be added (RESEARCH §7.2). An unmarked number would " +
				"be read as a measurement [threat T-02-10-03]",
		).toContain(TOKEN_ESTIMATE_MARKER);

		expect(
			text,
			"the provider-reported figures get their own labelled line, so the exact numbers are " +
				"never confused with the estimates above them",
		).toContain(PROVIDER_REPORTED_LABEL);

		expect(
			text,
			"and the last turn's real `input` count must be the number on it",
		).toContain(String(last?.input ?? -1));

		expect(
			text,
			`"${ROWS_WRITTEN_LABEL}" is how a dead instrument becomes visible rather than inferred ` +
				"(RESEARCH Pitfall 5) [threat T-02-10-04]",
		).toContain(`${ROWS_WRITTEN_LABEL}: ${live.rows.length}`);

		expect(
			live.rows.length,
			"the count printed must be a real one. Asserting the line contains `0` on a session " +
				"that wrote rows would be asserting the formatter, not the instrument",
		).toBeGreaterThan(0);
	});

	it("case 5: this suite deliberately asserts no upper bound on prompt size", () => {
		// RESEARCH Pitfall 9, stated as an executable reminder rather than a
		// comment nobody greps. `sliceSystemPrompt` is a decomposition, and the
		// honest assertion about a decomposition is that it accounts for the whole,
		// never that the whole is small. A `toBeLessThan(5000)` here would fail on
		// any machine whose repository layout differs -- RESEARCH measured 50,881
		// characters from inside this repository and 2,023 from a temp dir, and both
		// numbers are right.
		const source = readFileSync(new URL(import.meta.url), "utf-8");

		// The pattern is BUILT rather than spelled, the same dodge `jsonl.ts` uses
		// for its own grep gate: a literal here would appear in the file it scans
		// and the check would match itself. The `\.` prefix is what keeps this
		// regex, and the prose above it, out of its own result set.
		const upperBound = new RegExp(`\\.toBeLessThan${"(?:OrEqual)?"}\\(\\s*([\\d_]+)`, "g");
		const bounds = [...source.matchAll(upperBound)].map((match) => match[1]);

		expect(
			bounds.length,
			"the scan found no upper-bound assertion at all, not even case 3's ratio -- which means " +
				"the regex stopped matching and this guard is now a pass over nothing. That is the " +
				"vacuous-pass shape this repository has tripped over three times",
		).toBeGreaterThanOrEqual(1);

		expect(
			bounds.filter((bound) => bound !== "1"),
			"an upper bound other than 1 appeared in this file. Pitfall 9: a size threshold here " +
				"measures the machine, not the code -- Pi walks up from `cwd` collecting context " +
				"files, so the number depends on the directory tree above the temp dir. The real " +
				"number belongs in the decomposition, which case 1 asserts sums exactly. The only " +
				"sanctioned bound is case 3's `ratio < 1`, which bounds a proportion, not a size",
		).toEqual([]);
	});
});
