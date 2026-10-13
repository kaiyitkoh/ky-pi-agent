/**
 * The /budget decomposition against inline fixtures: this proves the slicer, and tests/integration/budget.test.ts
 * proves Pi still emits the markers. No size threshold is asserted, since prompt size depends on the machine. The sum
 * is not an identity: `base` is what remains after physically removing the located regions, so overlaps fail it.
 */
import { describe, expect, it } from "vitest";

import {
	BUDGET_COMMAND_NAME,
	CONTEXT_FILES_CLOSE_MARKER,
	CONTEXT_FILES_OPEN_MARKER,
	DECOMPOSITION_DOES_NOT_SUM_WARNING,
	PROJECT_INSTRUCTIONS_WRAPPER_CHARS,
	PROVIDER_REPORTED_LABEL,
	ROWS_WRITTEN_LABEL,
	SKILLS_CLOSE_MARKER,
	SKILLS_OPEN_MARKER,
	TOKEN_ESTIMATE_MARKER,
	ZERO_ROWS_NOTE,
	computeBudget,
	estimateTokensFromChars,
	formatBudgetReport,
	sliceSystemPrompt,
	type BudgetInput,
} from "../../.pi/extensions/diagnostics/budget.ts";

/** A stand-in for Pi's preamble that says "project" and "skills" in prose, so a loose-substring slicer breaks the sum. */
const PREAMBLE =
	"You are an expert coding assistant.\n\nAvailable tools:\n- read\n\n" +
	"Guidelines:\n- Be concise\n- Mention the project and any skills you use\n";

/** The trailer Pi appends after both blocks [VERIFIED: system-prompt.ts:159]. */
const TRAILER = "\nCurrent working directory: /tmp/kypi";

/** A context-file block built from the exported markers, never a retyped literal. */
function contextBlock(path: string, content: string): string {
	return (
		CONTEXT_FILES_OPEN_MARKER +
		"Project-specific instructions and guidelines:\n\n" +
		`<project_instructions path="${path}">\n${content}\n</project_instructions>\n\n` +
		CONTEXT_FILES_CLOSE_MARKER
	);
}

/** A skills block built from the exported markers [VERIFIED: skills.ts:342-360]. */
function skillsBlock(name: string, description: string, location: string): string {
	return (
		`${SKILLS_OPEN_MARKER} for specific tasks.\n` +
		"Use the read tool to load a skill's file when the task matches its description.\n" +
		"\n<available_skills>\n" +
		`  <skill>\n    <name>${name}</name>\n` +
		`    <description>${description}</description>\n` +
		`    <location>${location}</location>\n  </skill>\n` +
		SKILLS_CLOSE_MARKER
	);
}

const CONTEXT_PATH = "/tmp/kypi/AGENTS.md";
const CONTEXT_BODY = "Always run the tests before committing.";
const CONTEXT_BLOCK = contextBlock(CONTEXT_PATH, CONTEXT_BODY);
const SKILLS_BLOCK = skillsBlock("commit", "How to commit", "/tmp/kypi/skills/commit/SKILL.md");

/** The complete fixture: preamble, context files, skills, trailer. */
const FULL_PROMPT = PREAMBLE + CONTEXT_BLOCK + SKILLS_BLOCK + TRAILER;

/** A `BudgetInput` with everything neutral, so each case varies one thing. */
function input(overrides: Partial<BudgetInput> = {}): BudgetInput {
	return {
		systemPrompt: FULL_PROMPT,
		contextFiles: [{ path: CONTEXT_PATH, content: CONTEXT_BODY }],
		skills: [{}],
		skillsBlock: SKILLS_BLOCK,
		tools: [],
		lastUsage: undefined,
		rowsWritten: 0,
		...overrides,
	};
}

describe("sliceSystemPrompt — every character is accounted for", () => {
	it("case 1: base + contextFiles + skills equals the whole prompt", () => {
		const slices = sliceSystemPrompt(FULL_PROMPT);

		expect(
			slices.total,
			"the slicer must measure the string it was given. A `total` that is not " +
				"`prompt.length` means every proportion below it is computed against the wrong " +
				"denominator",
		).toBe(FULL_PROMPT.length);

		expect(
			slices.base + slices.contextFiles + slices.skills,
			"the three sections must account for the whole prompt. `base` is built by physically " +
				"removing the located regions and measuring the remainder, NOT by subtraction, so " +
				"this fails when the regions overlap or are located twice. A decomposition that " +
				"does not sum is a decomposition quietly attributing characters to nothing",
		).toBe(slices.total);

		expect(
			slices.contextFiles,
			"the context-file section must be exactly the block including both delimiters. The two " +
				"leading newlines exist only because the block does, so attributing them to `base` " +
				"would understate what having context files costs",
		).toBe(CONTEXT_BLOCK.length);

		expect(
			slices.skills,
			"the skills section runs from its opening sentence to `</available_skills>` and no " +
				"further -- the trailer after it belongs to the base prompt",
		).toBe(SKILLS_BLOCK.length);

		expect(
			slices.base,
			"whatever is left is the base prompt: Pi's own preamble plus the trailer",
		).toBe(PREAMBLE.length + TRAILER.length);

		expect(
			[slices.contextFilesFound, slices.skillsFound],
			"both markers are present in this fixture, so both flags must say so. The flags are " +
				"what make a genuinely empty section distinguishable from one whose marker moved",
		).toEqual([true, true]);
	});

	it("case 2: no context-file block -- 0 with the flag false, and base absorbs the rest", () => {
		const prompt = PREAMBLE + SKILLS_BLOCK + TRAILER;
		const slices = sliceSystemPrompt(prompt);

		expect(
			slices.contextFiles,
			"an absent block measures zero characters, which is arithmetically right and, on its " +
				"own, indistinguishable from a marker Pi renamed",
		).toBe(0);

		expect(
			slices.contextFilesFound,
			"THIS is the flag that makes the zero above readable. Pi ships every 2-3 days; a " +
				"marker change would otherwise attribute the whole block to `base` and report it " +
				"with a straight face [threat T-02-10-02]",
		).toBe(false);

		expect(
			slices.base,
			"the remainder must absorb everything the slicer did not locate -- the preamble and " +
				"the trailer here -- rather than vanishing from the total",
		).toBe(PREAMBLE.length + TRAILER.length);

		expect(
			slices.base + slices.contextFiles + slices.skills,
			"the sum invariant holds whether or not a section was found; a missing section must " +
				"not make characters disappear",
		).toBe(prompt.length);

		// The warning belongs to computeBudget: it fires only when Pi reported a context file the prompt does not carry.
		const report = computeBudget(input({ systemPrompt: prompt }));

		expect(
			report.warnings.length,
			"context files were supplied and the marker was not found. That combination is the " +
				"tripwire for Pi having changed its prompt format, and the report must say so " +
				"loudly rather than silently mis-attribute 97% of the prompt",
		).toBeGreaterThanOrEqual(1);

		expect(
			report.warnings.join("\n"),
			"the warning must name the marker it looked for, so a reader can grep Pi's source for " +
				"it instead of guessing what broke",
		).toContain(CONTEXT_FILES_OPEN_MARKER.trim());
	});

	it("case 3: no skills block -- the mirror of case 2", () => {
		const prompt = PREAMBLE + CONTEXT_BLOCK + TRAILER;
		const slices = sliceSystemPrompt(prompt);

		expect(slices.skills, "an absent skills index measures zero characters").toBe(0);

		expect(
			slices.skillsFound,
			"the flag is what distinguishes `no skills configured` from `the opening sentence " +
				"moved`. Without it both read as a silent 0",
		).toBe(false);

		expect(
			slices.base,
			"the preamble and trailer must still be attributed to the base prompt",
		).toBe(PREAMBLE.length + TRAILER.length);

		expect(
			slices.base + slices.contextFiles + slices.skills,
			"the sum invariant holds with the skills section missing too",
		).toBe(prompt.length);

		const report = computeBudget(input({ systemPrompt: prompt }));

		expect(
			report.warnings.length,
			"a skills block was recomputed with Pi's own formatter and is not in the prompt. " +
				"Either the format changed or the read tool is inactive -- both are things the " +
				"report must state rather than absorb",
		).toBeGreaterThanOrEqual(1);

		// A session with no skills must stay silent, or the warnings array is noise.
		const quiet = computeBudget(
			input({ systemPrompt: prompt, skills: [], skillsBlock: "" }),
		);
		expect(
			quiet.warnings,
			"no skills configured means no block is expected, so there is nothing to warn about. " +
				"A warnings array that cries on every healthy session is a warnings array nobody " +
				"reads on the one session that mattered",
		).toEqual([]);
	});
});

describe("computeBudget — the decomposition invariant is checked at RUNTIME, not only here", () => {
	/**
	 * A context file whose content quotes Pi's skills markers: findRegion takes the first occurrence, so the skills region
	 * lands inside the context region. Real here: this repo's planning docs quote the markers.
	 */
	const QUOTING_BODY =
		"Notes on Pi's prompt format, for a future reader:\n" +
		`${SKILLS_OPEN_MARKER} for specific tasks.\n<available_skills>\n${SKILLS_CLOSE_MARKER}\n` +
		"...which is what the skills index looks like.";

	const QUOTING_PROMPT = PREAMBLE + contextBlock(CONTEXT_PATH, QUOTING_BODY) + TRAILER;

	it("case 3b: an overlapping region breaks the sum, and the report SAYS SO", () => {
		const slices = sliceSystemPrompt(QUOTING_PROMPT);

		// The precondition, asserted rather than assumed: if the fixture stopped
		// producing an overlap the warning assertion below would be vacuous.
		expect(
			slices.base + slices.contextFiles + slices.skills,
			"the fixture must actually break the invariant. Both markers have to be located and the " +
				"skills one has to sit INSIDE the context block; if this equals `total` the fixture no " +
				"longer overlaps and the guard below is being asserted against a healthy prompt",
		).not.toBe(slices.total);

		expect(
			[slices.contextFilesFound, slices.skillsFound],
			"both regions must have been located — that is what makes them overlap. A false here " +
				"means the fixture is exercising a MISSING marker, which is cases 2 and 3, not this one",
		).toEqual([true, true]);

		const report = computeBudget(
			input({ systemPrompt: QUOTING_PROMPT, contextFiles: [{ path: CONTEXT_PATH, content: QUOTING_BODY }] }),
		);

		expect(
			report.warnings.join("\n"),
			"THIS IS THE WHOLE POINT. `sliceSystemPrompt` computes `base` by physically removing the " +
				"located regions so the sum is a real invariant, and its own comment calls a broken sum " +
				"`the loud failure we want` — but nothing at runtime evaluated it, so `/budget` printed " +
				"a mis-attributed table with an EMPTY warnings array and the invariant lived only in " +
				"this file, against prompts this file wrote. A report that cannot tell the reader it is " +
				"wrong is worse than no report",
		).toContain(DECOMPOSITION_DOES_NOT_SUM_WARNING);

		expect(
			report.warnings.join("\n"),
			"the warning must carry both numbers, so a reader can see HOW far off the attribution is " +
				"rather than only that it is",
		).toContain(`accounted ${slices.base + slices.contextFiles + slices.skills}, total ${slices.total}`);

		expect(
			formatBudgetReport(report),
			"and it must reach the rendered output. A warning nobody prints is a boolean nobody sees",
		).toContain(DECOMPOSITION_DOES_NOT_SUM_WARNING);
	});

	it("case 3c: the paired positive — a healthy prompt raises no sum warning", () => {
		// Without this, an unconditional warning would pass every assertion above.
		expect(
			computeBudget(input()).warnings.join("\n"),
			"the ordinary fixture's regions do not overlap and its sum holds exactly (case 1), so " +
				"this warning must be absent. A warnings array that fires on every healthy session is " +
				"one nobody reads on the one session that mattered",
		).not.toContain(DECOMPOSITION_DOES_NOT_SUM_WARNING);
	});
});

describe("estimateTokensFromChars — Pi's own heuristic, pinned to a real observation", () => {
	it("case 4: the boundary cases and the number RESEARCH measured in this repository", () => {
		expect(
			estimateTokensFromChars(0),
			"nothing costs nothing. A ceil() implemented as `chars/4 + 1` would report 1 here",
		).toBe(0);

		expect(
			estimateTokensFromChars(1),
			"one character is one token under a ceiling, not zero -- a floor would under-report " +
				"every fragment in the report",
		).toBe(1);

		expect(estimateTokensFromChars(4), "four characters is exactly one token").toBe(1);

		expect(
			estimateTokensFromChars(5),
			"the ceiling must round up. This is the pair that tells `Math.ceil` from `Math.round` " +
				"and from `Math.floor`",
		).toBe(2);

		expect(
			estimateTokensFromChars(49_404),
			"49,404 bytes is this repository's own CLAUDE.md, measured live [RESEARCH §7.4], and " +
				"12,351 is what Pi's formula makes of it. Pinning the estimator to an observation " +
				"rather than an invented round number is what stops a later `chars / 3.5` tweak " +
				"passing unnoticed",
		).toBe(12_351);
	});
});

describe("computeBudget — divergence, tool accounting and the rows-written passthrough", () => {
	it("case 5: a recomputed skills block that does not match the slice is reported", () => {
		const report = computeBudget(
			input({ skillsBlock: `${SKILLS_BLOCK}\n<skill>an extra one</skill>` }),
		);

		expect(
			report.skillsBlockMatchesSlice,
			"THE TRIPWIRE. `formatSkillsForPrompt` is Pi's own exported formatter, so the block it " +
				"produces and the region sliced out of Pi's own prompt must be the same size. When " +
				"they are not, Pi changed its format and this report has been wrong ever since " +
				"[RESEARCH §7.3, threat T-02-10-02]",
		).toBe(false);

		expect(
			report.warnings.length,
			"a divergence that sets a boolean nobody prints is a divergence nobody sees. The " +
				"report must carry it in `warnings`, which `formatBudgetReport` renders",
		).toBeGreaterThanOrEqual(1);

		expect(
			formatBudgetReport(report),
			"and it must reach the rendered output, not merely the structure",
		).toContain("WARNINGS");

		const matching = computeBudget(input());
		expect(
			[matching.skillsBlockMatchesSlice, matching.warnings.length],
			"the paired positive. Without it, a cross-check that returned `false` unconditionally " +
				"would pass the assertion above while telling the operator nothing",
		).toEqual([true, 0]);
	});

	it("case 6: tool schemas sum to name + description + serialised parameters", () => {
		const tools = [
			{ name: "read", description: "Read a file", parameters: { path: "string" } },
			{
				name: "bash",
				description: "Run a command with a much longer description than the others",
				parameters: { command: "string", timeout: "number", cwd: "string" },
			},
			{ name: "ls", description: "List", parameters: {} },
		];

		const expected = tools.map(
			(tool) =>
				tool.name.length + tool.description.length + JSON.stringify(tool.parameters).length,
		);
		const expectedTotal = expected.reduce((sum, n) => sum + n, 0);

		const report = computeBudget(input({ tools }));

		expect(
			report.toolSchemas.chars,
			"the arithmetic is stated in RESEARCH §7.1's skeleton: name + description + the " +
				"serialised parameter schema, summed over the ACTIVE tools. This is the figure that " +
				"makes BOOT-10's boundary rule quantitative instead of stylistic",
		).toBe(expectedTotal);

		expect(
			report.toolSchemas.estimatedTokens,
			"the token column is the same estimator applied to the same characters, not a second " +
				"formula that could drift from it",
		).toBe(estimateTokensFromChars(expectedTotal));

		expect(
			report.toolSchemasByName.length,
			"every supplied tool must appear in the breakdown. A total with no breakdown tells an " +
				"operator that tools are expensive and not which one to cut",
		).toBe(tools.length);

		expect(
			report.toolSchemasByName[0]?.name,
			"the breakdown is largest-first, so the most expensive tool is the first thing read. " +
				"`bash` has the longest description and the biggest schema here",
		).toBe("bash");

		expect(
			report.toolSchemasByName.reduce((sum, tool) => sum + tool.chars, 0),
			"the breakdown must sum to the total it breaks down; two numbers that disagree are " +
				"worse than one number",
		).toBe(expectedTotal);

		// The per-file breakdown carries Pi's wrapper, so the residual against the block total is the delimiters.
		expect(
			report.contextFilesByPath[0]?.chars,
			"each context file costs its path, its content and the " +
				"`<project_instructions path=…>` wrapper Pi emits around it " +
				"[VERIFIED: system-prompt.ts:149]",
		).toBe(CONTEXT_PATH.length + CONTEXT_BODY.length + PROJECT_INSTRUCTIONS_WRAPPER_CHARS);
	});

	it("case 7: the rows-written figure reaches the rendered report, zero included", () => {
		const dead = formatBudgetReport(computeBudget(input({ rowsWritten: 0 })));

		expect(
			dead,
			`the report must carry "${ROWS_WRITTEN_LABEL}". RESEARCH Pitfall 5: Pi swallows every ` +
				"exception an extension handler throws, so a dead diagnostics subsystem looks " +
				"exactly like a quiet session -- the log simply stops [threat T-02-10-04]",
		).toContain(`${ROWS_WRITTEN_LABEL}: 0`);

		expect(
			dead,
			"and the zero must be explained where it is printed. A bare `0` is a number an " +
				"operator glances past; the note is what makes it a finding",
		).toContain(ZERO_ROWS_NOTE);

		const alive = formatBudgetReport(computeBudget(input({ rowsWritten: 42 })));
		expect(
			alive,
			"the paired positive: a non-zero count must be reported as itself. Without it, a " +
				"formatter that hardcoded `0` would pass the assertions above",
		).toContain(`${ROWS_WRITTEN_LABEL}: 42`);
	});
});

describe("formatBudgetReport — estimates are marked, ground truth is separate", () => {
	it("marks every token figure and prints the provider-reported numbers on their own line", () => {
		const report = computeBudget(
			input({
				tools: [{ name: "read", description: "Read a file", parameters: { path: "string" } }],
				lastUsage: { input: 12_725, cacheRead: 3_000 },
			}),
		);
		const text = formatBudgetReport(report);
		const lines = text.split("\n");

		expect(
			lines[0],
			"the report names the command that produced it, so a pasted excerpt is attributable",
		).toContain(`/${BUDGET_COMMAND_NAME}`);

		// Rows are selected by their character column, never by the marker, so a dropped marker fails rather than selecting nothing.
		const tableLines = lines.filter(
			(line) => /^ {2,}\S/.test(line) && /\d/.test(line) && !line.startsWith("  - "),
		);
		expect(
			tableLines.length,
			"no table rows were found, which would make the assertion below vacuous -- the exact " +
				"failure shape this repository has tripped over three times",
		).toBeGreaterThanOrEqual(5);

		const unmarked = tableLines.filter((line) => !line.includes(TOKEN_ESTIMATE_MARKER));
		expect(
			unmarked,
			`every token figure must carry "${TOKEN_ESTIMATE_MARKER}". There is no tokenizer in ` +
				"either Pi package and none may be added (RESEARCH §7.2), so every token number " +
				"here is Math.ceil(chars/4) with roughly +/-20% error. An unmarked number is read " +
				"as a measurement [threat T-02-10-03]",
		).toEqual([]);

		expect(
			text,
			"the +/-20% caveat must be in the output itself, not only in a docstring nobody " +
				"reading a terminal will open",
		).toContain(TOKEN_ESTIMATE_MARKER);

		const groundTruth = lines.filter((line) => line.startsWith(PROVIDER_REPORTED_LABEL));
		expect(
			groundTruth.length,
			"the provider-reported figures get their own line, labelled as ground truth. They are " +
				"the only exact token numbers in the report and must never be confused with the " +
				"estimates above them",
		).toBe(1);

		expect(
			groundTruth[0],
			"the exact `usage.input` from the last assistant turn is the whole point of the line",
		).toContain("12725");

		expect(
			report.cacheReadRatio,
			"cacheRead / (input + cacheRead) -- the same definition as `TurnRow.cacheReadRatio`, " +
				"so the number on screen and the number in the log mean one thing",
		).toBeCloseTo(3_000 / 15_725, 10);

		const noUsage = formatBudgetReport(computeBudget(input()));
		expect(
			noUsage,
			"with no assistant turn yet the line must still appear and say so. Omitting it would " +
				"leave a reader unable to tell `no data` from `zero tokens`",
		).toContain(PROVIDER_REPORTED_LABEL);

		expect(
			noUsage.includes(CONTEXT_BODY),
			"NO FILE CONTENT MAY APPEAR IN THE REPORT. It prints paths and character counts only: " +
				"a user's global context file may hold things this public repository never should, " +
				"and nothing here is written to disk either [threat T-02-10-01]",
		).toBe(false);

		expect(
			noUsage,
			"the path, by contrast, must be named -- a size with no name is not actionable",
		).toContain(CONTEXT_PATH);
	});
});
