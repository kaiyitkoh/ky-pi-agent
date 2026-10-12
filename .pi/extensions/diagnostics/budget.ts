/**
 * ky-pi-agent — `/budget`, the per-turn token report (DIAG-06).
 *
 * PURPOSE. This turns "the harness is probably expensive" into a number on
 * screen. RESEARCH §7.4 measured it live in this repository: `CLAUDE.md` is
 * 49,404 bytes, the faux run's system prompt was 50,881 characters, and a
 * one-word prompt reported 12,725 input tokens — roughly seven times the
 * 1,850-token floor ARCHITECTURE.md assumed, and 97% of it is one context file.
 * `/budget` does not need to be clever to be valuable; it needs to print that.
 * It also hands Phase 10's CTX-03 its target number on day one.
 *
 * LIFETIME. Permanent. Phase 10 reads the same decomposition when it
 * discriminates context pollution from the other root-cause candidates.
 *
 * BOUNDARY RULE (BOOT-10). This is a COMMAND, and it must never become the
 * other thing. A command costs exactly zero per-turn tokens; the other kind of
 * registration serialises a name, a description and a complete JSON Schema into
 * `tools[]` on every single provider request
 * [VERIFIED: pi-ai 0.84.1 src/api/openai-completions.ts:1337-1370] — so a
 * report about per-turn token cost would itself be a per-turn token cost, and
 * the instrument would become the thing it is measuring. This file therefore
 * does not spell that registration call even in prose, the same dodge
 * `harness/index.ts:36` and `index.ts` use, because
 * `tests/unit/contributing-boundary.test.ts` matches the name as a plain
 * substring across every tracked source under `.pi/extensions/`, comments
 * included.
 *
 * THERE IS A SECOND, INDEPENDENT REASON, and it is not a preference.
 * `getSystemPromptOptions()` — the only exact source of the context-file list
 * and the skill list — exists on `ExtensionCommandContext` and NOT on the
 * `ExtensionContext` an event handler or a tool receives
 * [VERIFIED: pi 0.84.1 dist/core/extensions/types.d.ts:256 (command context)
 * versus :219-249 (plain context)]. A tool could not compute this report at
 * all. RESEARCH §7.1.
 *
 * WHAT IS EXACT AND WHAT IS ESTIMATED (RESEARCH §7.1, §7.2). Every character
 * count here is exact: the system prompt comes from `ctx.getSystemPrompt()`,
 * the context files and skills from `ctx.getSystemPromptOptions()`, the tool
 * schemas from `pi.getAllTools()` filtered by `pi.getActiveTools()`. Every
 * TOKEN figure is an estimate — see {@link estimateTokensFromChars} — and the
 * provider-reported `usage.input` from the last assistant turn is printed
 * beside it as ground truth. [threat T-02-10-03]
 *
 * PURITY. {@link sliceSystemPrompt}, {@link computeBudget} and
 * {@link formatBudgetReport} touch no `ctx` member and no filesystem. They take
 * strings and numbers and return strings and numbers, which is what lets
 * `tests/unit/budget-sections.test.ts` drive them against inline fixtures in
 * milliseconds and `tests/integration/budget.test.ts` drive the same functions
 * against the real system prompt of the installed Pi version. Only
 * {@link registerBudgetCommand} reads the world.
 *
 * NOTHING IS WRITTEN TO DISK. The report contains file PATHS and character
 * counts, never file CONTENT: a user's global context file may hold things this
 * repository never should, and a `/budget` output persisted anywhere would be a
 * copy of it. The one exception is the failure path, which appends a
 * `diagnostics.error` row carrying a redacted exception message.
 * [threats T-02-10-01, T-02-10-06]
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatSkillsForPrompt, getLastAssistantUsage } from "@earendil-works/pi-coding-agent";

import { appendJsonl } from "./jsonl.ts";
import { redactString } from "./redact.ts";
import {
	DIAGNOSTICS_ERROR_EVENT,
	MAX_ROTATED_FILES,
	TURNS_LOG_BASE,
	TURNS_ROTATE_BYTES,
} from "./schema.ts";

// ---------------------------------------------------------------------------
// The literals. Exported so a test imports them rather than re-typing one --
// the house rule from `.pi/extensions/harness/index.ts:50-56`.
// ---------------------------------------------------------------------------

/** The slash command this module registers. `/budget`. */
export const BUDGET_COMMAND_NAME = "budget";

/** One line, because it is rendered in the command list on every `/`. */
export const BUDGET_COMMAND_DESCRIPTION =
	"Per-turn token budget: system prompt, tool schemas, context files, skills, cache";

/** `where` on the row a failed `/budget` invocation leaves. */
export const BUDGET_COMMAND_WHERE = "command.budget";

/**
 * Opening delimiter of the context-file block.
 *
 * Pi 1.1.0 renders the prompt as named sections, each wrapped
 * `<name>\n${content}\n</name>`; the context-file section is named
 * `project_context` [VERIFIED: pi 1.1.0 dist/core/system-prompt.js:100 (section)
 * and :118 (wrapper)]. This replaced the 0.84.1 literal
 * `"\n\n<project_context>\n\n"`; the separator newlines are now part of `base`.
 */
export const CONTEXT_FILES_OPEN_MARKER = "<project_context>\n";

/** Closing delimiter [VERIFIED: pi 1.1.0 dist/core/system-prompt.js:118]. */
export const CONTEXT_FILES_CLOSE_MARKER = "</project_context>";

/**
 * Opening sentence of the skills index [VERIFIED: pi 1.1.0
 * dist/core/skills.js:284; system-prompt.js:106 `.trim()`s the formatter output,
 * so the 0.84.1 leading blank lines are no longer in the prompt].
 *
 * Truncated at "instructions" deliberately: the full line continues "for
 * specific tasks." and matching less of it is one fewer character that a
 * harmless copy-edit upstream could move past.
 */
export const SKILLS_OPEN_MARKER = "The following skills provide specialized instructions";

/** Closing tag of the skills index [VERIFIED: pi 1.1.0 dist/core/skills.js:301]. */
export const SKILLS_CLOSE_MARKER = "</available_skills>";

/**
 * Characters the per-file wrapper adds around each context file.
 *
 * Written as the literal template with an empty path and empty content rather
 * than as a bare number, so the expression IS the citation:
 * `<project_instructions path="${path}">\n${content}\n</project_instructions>`
 * [VERIFIED: pi 1.1.0 dist/core/system-prompt.js:28]. The blank line between
 * files is a join separator in 1.1.0, not part of the per-file wrapper.
 */
export const PROJECT_INSTRUCTIONS_WRAPPER_CHARS =
	'<project_instructions path="">\n\n</project_instructions>'.length;

/** Prefix marking a figure as an estimate rather than a measurement. */
export const TOKEN_ESTIMATE_MARKER = "~";

/** The sentence that keeps every `~` figure from being read as exact. */
export const ESTIMATE_NOTE =
	`Token figures marked ${TOKEN_ESTIMATE_MARKER} are ESTIMATES: Math.ceil(chars / 4), ` +
	"Pi's own heuristic, roughly +/-20% error. Characters are the measurement.";

/** Label on the line carrying numbers the provider itself reported. */
export const PROVIDER_REPORTED_LABEL = "provider-reported (ground truth)";

/** Shown instead of the provider figures when the session has no assistant turn yet. */
export const NO_PROVIDER_USAGE_NOTE = "no assistant turn in this session yet";

/** Label on the rows-written line. See {@link ZERO_ROWS_NOTE}. */
export const ROWS_WRITTEN_LABEL = "diagnostic rows written this session";

/**
 * Why the rows-written line exists at all (RESEARCH Pitfall 5).
 *
 * Pi swallows every exception an extension handler throws, so a dead
 * diagnostics subsystem looks exactly like a quiet session: the log simply
 * stops. Printing the count makes "0 rows" something an operator SEES rather
 * than something they would have to infer from a file they never opened.
 * [threat T-02-10-04]
 */
export const ZERO_ROWS_NOTE = "0 means the instrument recorded nothing this session";

/** Heading above {@link BudgetReport.warnings}, when there are any. */
export const WARNINGS_HEADING = "WARNINGS";

/** Warning text when context files exist but the prompt carries no block. */
export const CONTEXT_MARKER_MISSING_WARNING =
	`context files are loaded but ${CONTEXT_FILES_OPEN_MARKER.trim()} was not found in the ` +
	"system prompt -- Pi changed its prompt format and this decomposition is now attributing " +
	"the whole block to the base prompt";

/** Warning text when a skills block was recomputed but is not in the prompt. */
export const SKILLS_MARKER_MISSING_WARNING =
	`a skills index was recomputed but its opening sentence was not found in the system ` +
	"prompt -- either Pi changed its prompt format, or the read tool is inactive and Pi " +
	"omitted the block (skills.ts:155 gates it on `hasRead`)";

/**
 * Warning text when `base + contextFiles + skills` does not equal the total.
 *
 * `sliceSystemPrompt` computes `base` by physically REMOVING the located regions
 * rather than by subtraction, precisely so this sum is a real invariant and not
 * an identity. The loop that removes them skips a region overlapping a previous
 * one, deliberately leaving the sum broken — "the loud failure we want". Nothing
 * at runtime was loud: `computeBudget` never evaluated the invariant, so a
 * mis-attributed table printed with an empty `warnings` array and the assertion
 * lived only in tests, against prompts the tests control.
 *
 * THE REACHABLE TRIGGER IS CONTENT, NOT A PI RELEASE. `findRegion` uses
 * `prompt.indexOf(open)` — first occurrence ANYWHERE — and context-file content
 * is interpolated verbatim into the prompt. So an `AGENTS.md` or `CLAUDE.md` that
 * merely QUOTES `<project_context>`, `</project_context>`, or the skills index's
 * opening sentence relocates or truncates a region, and a skills marker quoted
 * inside the context block yields two overlapping regions. This repository's own
 * planning documents quote those markers, so it is not hypothetical here.
 */
export const DECOMPOSITION_DOES_NOT_SUM_WARNING =
	"base + contextFiles + skills does not equal the system-prompt length -- the located regions " +
	"overlap or were located twice (a context file whose CONTENT quotes one of Pi's own prompt " +
	"delimiters does exactly this), so every proportion in this table is mis-attributed";

/** Warning text when the recomputed skills block and the sliced region differ in size. */
export const SKILLS_DIVERGENCE_WARNING =
	"the skills block recomputed with formatSkillsForPrompt does not match the region sliced " +
	"out of the system prompt -- RESEARCH §7.3 says a divergence means Pi changed the format, " +
	"and this report must say so loudly rather than silently mis-report";

// ---------------------------------------------------------------------------
// The estimator
// ---------------------------------------------------------------------------

/**
 * Characters to tokens, the only way this project has of making the conversion.
 *
 * **THIS IS AN ESTIMATE, WITH ROUGHLY ±20% ERROR.** It is `Math.ceil(chars / 4)`,
 * which is not a heuristic invented here: it is Pi's own, and the only counter
 * Pi ships [VERIFIED: pi 0.84.1 src/core/compaction/compaction.ts:266-291, the
 * formula at :274]. Pi's `estimateTokens` is exported but takes an
 * `AgentMessage`, not a string, so a report about prompt FRAGMENTS needs the
 * same arithmetic spelled here.
 *
 * **NO TOKENIZER EXISTS AND NONE MAY BE ADDED.** Neither
 * `@earendil-works/pi-coding-agent` nor `@earendil-works/pi-ai` depends on
 * `tiktoken`, `gpt-tokenizer` or anything like them [VERIFIED: both dependency
 * lists, RESEARCH §7.2], and `tests/unit/pinning.test.ts` fails the build if a
 * dependency appears. Adding one to make this number exact would trade a
 * labelled ±20% estimate for an unreviewed package in a public repo on a laptop
 * holding live AWS credentials. That is not a good trade. [threat T-02-10-SC]
 *
 * The honest figure is the character count, which is exact. The provider's own
 * `usage.input` from the last turn is printed beside these estimates as ground
 * truth — see {@link BudgetInput.lastUsage}.
 */
export function estimateTokensFromChars(chars: number): number {
	return Math.ceil(chars / 4);
}

// ---------------------------------------------------------------------------
// The slicer
// ---------------------------------------------------------------------------

/** What {@link sliceSystemPrompt} found, in characters. */
export interface SystemPromptSlices {
	/** `prompt.length`. */
	total: number;
	/** Everything that is not one of the located sections. */
	base: number;
	/** Size of the `<project_context>` block, including its delimiters. */
	contextFiles: number;
	/** Size of the skills index, from its opening sentence to `</available_skills>`. */
	skills: number;
	/** Whether the context-file block was located. A `false` here with a 0 size is NOT the same as a genuinely absent block. */
	contextFilesFound: boolean;
	/** Whether the skills index was located. Same distinction as {@link contextFilesFound}. */
	skillsFound: boolean;
}

/** A half-open `[start, end)` character range inside the system prompt. */
interface Region {
	start: number;
	end: number;
}

/**
 * Locate one delimited region, or report that it is not there.
 *
 * Returns `undefined` when either delimiter is missing. A half-open block — an
 * opening marker with no close — counts as missing, because a size measured
 * from an unterminated marker is a number with no meaning.
 */
function findRegion(prompt: string, open: string, close: string): Region | undefined {
	const start = prompt.indexOf(open);
	if (start === -1) {
		return undefined;
	}
	const closeAt = prompt.indexOf(close, start + open.length);
	if (closeAt === -1) {
		return undefined;
	}
	return { start, end: closeAt + close.length };
}

/**
 * Decompose the real system prompt into base / context files / skills.
 *
 * WHY SLICE RATHER THAN REBUILD. `buildSystemPrompt` is declared in Pi's
 * `.d.ts` but is not reachable: the package `exports` map has only `.`,
 * `./rpc-entry` and `./client`, and the symbol is absent from `src/index.ts`
 * [VERIFIED: pi 0.84.1 `dist/index.d.ts` has no system-prompt re-export,
 * RESEARCH §7.3]. So the prompt cannot be differenced by rebuilding it; the
 * only exact route is to locate the literal markers inside the string Pi
 * actually produced.
 *
 * A MISSING MARKER IS REPORTED, NEVER GUESSED. When a delimiter is absent the
 * corresponding size is 0 AND the corresponding `*Found` flag is `false`, so a
 * section that is genuinely empty and a section whose marker moved are
 * distinguishable. Pi ships every 2-3 days; a marker change in a future release
 * is exactly the failure this decomposition would otherwise hide, silently
 * attributing 97% of the prompt to "base" and reporting it with a straight
 * face. [threat T-02-10-02]
 *
 * BASE IS NOT `total - contextFiles - skills`. It is the length of the prompt
 * with the located regions physically removed. The two are equal only when the
 * regions are in bounds and do not overlap — which is the whole content of the
 * `base + contextFiles + skills === total` assertion in the tests. Computing
 * base by subtraction would make that assertion an identity that holds no
 * matter how wrong the region arithmetic is.
 */
export function sliceSystemPrompt(prompt: string): SystemPromptSlices {
	const contextRegion = findRegion(prompt, CONTEXT_FILES_OPEN_MARKER, CONTEXT_FILES_CLOSE_MARKER);
	const skillsRegion = findRegion(prompt, SKILLS_OPEN_MARKER, SKILLS_CLOSE_MARKER);

	const regions = [contextRegion, skillsRegion]
		.filter((region): region is Region => region !== undefined)
		.sort((a, b) => a.start - b.start);

	// Rebuild the prompt with the regions cut out. An overlap makes the pieces
	// fail to add up, which is the loud failure we want rather than a plausible
	// number nobody can check.
	let remainder = "";
	let cursor = 0;
	for (const region of regions) {
		if (region.start >= cursor) {
			remainder += prompt.slice(cursor, region.start);
			cursor = region.end;
		}
	}
	remainder += prompt.slice(cursor);

	return {
		total: prompt.length,
		base: remainder.length,
		contextFiles: contextRegion === undefined ? 0 : contextRegion.end - contextRegion.start,
		skills: skillsRegion === undefined ? 0 : skillsRegion.end - skillsRegion.start,
		contextFilesFound: contextRegion !== undefined,
		skillsFound: skillsRegion !== undefined,
	};
}

// ---------------------------------------------------------------------------
// The computation
// ---------------------------------------------------------------------------

/** A measured section: characters exact, tokens estimated. */
export interface SectionSize {
	chars: number;
	/** {@link estimateTokensFromChars} of {@link chars}. ±20%. */
	estimatedTokens: number;
}

/** A named line in a breakdown — one context file, or one tool. */
export interface NamedSectionSize extends SectionSize {
	name: string;
}

/** Everything {@link computeBudget} needs, and nothing it could read itself. */
export interface BudgetInput {
	/** `ctx.getSystemPrompt()`. Exact. */
	systemPrompt: string;
	/** `ctx.getSystemPromptOptions().contextFiles`. Exact. */
	contextFiles: readonly { path: string; content: string }[];
	/** `ctx.getSystemPromptOptions().skills`. Only the count is used here. */
	skills: readonly unknown[];
	/**
	 * `formatSkillsForPrompt(opts.skills)` — the block Pi itself would append.
	 *
	 * Supplied by the caller rather than recomputed here so this module stays
	 * pure and importable by a unit test with no Pi session. `undefined` means
	 * the caller could not recompute it, and is compared as an empty block: a
	 * non-empty sliced region with no recomputation to corroborate it is a
	 * divergence, and saying so is the correct verdict.
	 */
	skillsBlock: string | undefined;
	/** `pi.getAllTools()` filtered by `pi.getActiveTools()`. */
	tools: readonly { name: string; description: string; parameters: unknown }[];
	/** `getLastAssistantUsage(...)`. The only exact token numbers in the report. */
	lastUsage: { input: number; cacheRead: number } | undefined;
	/** `rowsWrittenThisSession()`. See {@link ZERO_ROWS_NOTE}. */
	rowsWritten: number;
}

/** The structured report. {@link formatBudgetReport} renders it. */
export interface BudgetReport {
	systemPrompt: SectionSize;
	basePrompt: SectionSize;
	contextFiles: SectionSize;
	/** Per file, largest first, so the expensive one is nameable. */
	contextFilesByPath: NamedSectionSize[];
	skillsIndex: SectionSize;
	/** `name + description + JSON.stringify(parameters)` summed over active tools. */
	toolSchemas: SectionSize;
	/** Per tool, largest first. */
	toolSchemasByName: NamedSectionSize[];
	/** Number of skills Pi would render, before the `disableModelInvocation` filter. */
	skillCount: number;
	contextFilesFound: boolean;
	skillsFound: boolean;
	/** Whether the recomputed skills block and the sliced region are the same size. */
	skillsBlockMatchesSlice: boolean;
	/** Provider-reported, exact, from the last assistant turn. */
	lastUsage?: { input: number; cacheRead: number };
	/** `cacheRead / (input + cacheRead)`; omitted when the denominator is 0. */
	cacheReadRatio?: number;
	rowsWritten: number;
	/** Non-empty means this report is telling you it may be wrong. */
	warnings: string[];
}

/** Pair a character count with its estimate, once, in one place. */
function size(chars: number): SectionSize {
	return { chars, estimatedTokens: estimateTokensFromChars(chars) };
}

/** Largest first; ties broken by name so the output is deterministic. */
function byCharsDescending(a: NamedSectionSize, b: NamedSectionSize): number {
	return b.chars - a.chars || a.name.localeCompare(b.name);
}

/**
 * Turn exact inputs into a structured report. Pure: no `ctx`, no filesystem.
 *
 * The per-file context breakdown adds {@link PROJECT_INSTRUCTIONS_WRAPPER_CHARS}
 * to each `path.length + content.length`, which is the exact wrapper Pi emits
 * per file. It still sums to slightly LESS than the sliced block, because the
 * block also carries its own delimiters and the
 * "Project-specific instructions and guidelines:" header. That residual is
 * deliberately not hidden by fudging the per-file numbers: the block total is
 * the sliced, exact figure, and the breakdown is a breakdown.
 */
export function computeBudget(input: BudgetInput): BudgetReport {
	const slices = sliceSystemPrompt(input.systemPrompt);

	const contextFilesByPath: NamedSectionSize[] = input.contextFiles
		.map((file) => ({
			name: file.path,
			...size(file.path.length + file.content.length + PROJECT_INSTRUCTIONS_WRAPPER_CHARS),
		}))
		.sort(byCharsDescending);

	const toolSchemasByName: NamedSectionSize[] = input.tools
		.map((tool) => ({
			name: tool.name,
			...size(
				tool.name.length + tool.description.length + JSON.stringify(tool.parameters ?? null).length,
			),
		}))
		.sort(byCharsDescending);

	const toolSchemaChars = toolSchemasByName.reduce((total, tool) => total + tool.chars, 0);

	const recomputedSkills = input.skillsBlock ?? "";
	const skillsBlockMatchesSlice = recomputedSkills.length === slices.skills;

	const warnings: string[] = [];

	// THE INVARIANT, EVALUATED AT RUNTIME AND NOT ONLY IN A TEST. This is the one
	// check that can tell the reader the table in front of them is wrong: `base` is
	// the remainder after physically removing the located regions, so a sum that
	// misses `total` means the regions overlapped or were located twice. The
	// reachable cause is a context FILE whose content quotes one of Pi's delimiters
	// — see {@link DECOMPOSITION_DOES_NOT_SUM_WARNING}. It is checked first because
	// when it fires every other number below it is unreliable.
	const accounted = slices.base + slices.contextFiles + slices.skills;
	if (accounted !== slices.total) {
		warnings.push(
			`${DECOMPOSITION_DOES_NOT_SUM_WARNING} (accounted ${accounted}, total ${slices.total})`,
		);
	}

	// Only a marker that was EXPECTED and is missing is a warning. A session with
	// no context files and no skills legitimately has neither block, and warning
	// about that would make the warnings array noise that nobody reads.
	if (input.contextFiles.length > 0 && !slices.contextFilesFound) {
		warnings.push(CONTEXT_MARKER_MISSING_WARNING);
	}
	if (recomputedSkills.length > 0 && !slices.skillsFound) {
		warnings.push(SKILLS_MARKER_MISSING_WARNING);
	}
	if (!skillsBlockMatchesSlice) {
		warnings.push(
			`${SKILLS_DIVERGENCE_WARNING} (recomputed ${recomputedSkills.length} chars, sliced ${slices.skills})`,
		);
	}

	const report: BudgetReport = {
		systemPrompt: size(slices.total),
		basePrompt: size(slices.base),
		contextFiles: size(slices.contextFiles),
		contextFilesByPath,
		skillsIndex: size(slices.skills),
		toolSchemas: size(toolSchemaChars),
		toolSchemasByName,
		skillCount: input.skills.length,
		contextFilesFound: slices.contextFilesFound,
		skillsFound: slices.skillsFound,
		skillsBlockMatchesSlice,
		rowsWritten: input.rowsWritten,
		warnings,
	};

	if (input.lastUsage !== undefined) {
		report.lastUsage = { input: input.lastUsage.input, cacheRead: input.lastUsage.cacheRead };
		const denominator = input.lastUsage.input + input.lastUsage.cacheRead;
		if (denominator > 0) {
			// Same definition as `TurnRow.cacheReadRatio` in `schema.ts`, so the
			// number `/budget` prints and the number in the log mean one thing.
			report.cacheReadRatio = input.lastUsage.cacheRead / denominator;
		}
	}

	return report;
}

// ---------------------------------------------------------------------------
// The rendering
// ---------------------------------------------------------------------------

/** Column width of the label column in the aligned table. */
const LABEL_WIDTH = 30;
/** Column width of the (right-aligned) character column. */
const CHARS_WIDTH = 10;

/** One aligned `label  chars  ~tokens` line. Every token figure carries the marker. */
function row(label: string, section: SectionSize, indent = ""): string {
	const name = `${indent}${label}`.padEnd(LABEL_WIDTH);
	const chars = String(section.chars).padStart(CHARS_WIDTH);
	const tokens = `${TOKEN_ESTIMATE_MARKER}${section.estimatedTokens}`.padStart(CHARS_WIDTH);
	return `  ${name}${chars}${tokens}`;
}

/**
 * Render the report as plain aligned text for a terminal.
 *
 * THREE PROPERTIES THIS FUNCTION OWES THE READER, each asserted in
 * `tests/unit/budget-sections.test.ts`:
 *
 *   1. every token figure carries {@link TOKEN_ESTIMATE_MARKER} and the note
 *      that it is a ±20% estimate — a bare number here would be read as a
 *      measurement, and a wrong measurement is worse than an honest estimate
 *      [threat T-02-10-03];
 *   2. the provider-reported figures are on their own line, labelled as ground
 *      truth, so the exact numbers are never mistaken for the estimated ones;
 *   3. the rows-written count is printed, with {@link ZERO_ROWS_NOTE}, so a
 *      dead instrument is visible rather than inferred [threat T-02-10-04].
 *
 * No file CONTENT appears anywhere in the output — paths and counts only.
 * [threat T-02-10-01]
 */
export function formatBudgetReport(report: BudgetReport): string {
	const lines: string[] = [];

	lines.push(`/${BUDGET_COMMAND_NAME} -- per-turn token budget`);
	lines.push("");
	lines.push(ESTIMATE_NOTE);
	lines.push("");
	lines.push(`  ${"section".padEnd(LABEL_WIDTH)}${"chars".padStart(CHARS_WIDTH)}${"tokens".padStart(CHARS_WIDTH)}`);
	lines.push(`  ${"-".repeat(LABEL_WIDTH + CHARS_WIDTH * 2)}`);
	lines.push(row("system prompt (total)", report.systemPrompt));
	lines.push(row("base prompt", report.basePrompt, "  "));
	lines.push(
		row(
			`context files${report.contextFilesFound ? "" : " (marker NOT found)"}`,
			report.contextFiles,
			"  ",
		),
	);
	lines.push(
		row(
			`skills index${report.skillsFound ? "" : " (marker NOT found)"}`,
			report.skillsIndex,
			"  ",
		),
	);
	lines.push(row(`tool schemas (${report.toolSchemasByName.length} active)`, report.toolSchemas));

	if (report.contextFilesByPath.length > 0) {
		lines.push("");
		lines.push("  context files, largest first:");
		for (const file of report.contextFilesByPath) {
			lines.push(row(file.name, file, "  "));
		}
	}

	if (report.toolSchemasByName.length > 0) {
		lines.push("");
		lines.push("  tool schemas, largest first:");
		for (const tool of report.toolSchemasByName) {
			lines.push(row(tool.name, tool, "  "));
		}
	}

	lines.push("");
	if (report.lastUsage === undefined) {
		lines.push(`${PROVIDER_REPORTED_LABEL}: ${NO_PROVIDER_USAGE_NOTE}`);
	} else {
		const ratio =
			report.cacheReadRatio === undefined ? "n/a" : report.cacheReadRatio.toFixed(3);
		lines.push(
			`${PROVIDER_REPORTED_LABEL}: input ${report.lastUsage.input} tokens, ` +
				`cacheRead ${report.lastUsage.cacheRead} tokens, cache-read ratio ${ratio}`,
		);
	}
	lines.push(`${ROWS_WRITTEN_LABEL}: ${report.rowsWritten}  (${ZERO_ROWS_NOTE})`);

	if (report.warnings.length > 0) {
		lines.push("");
		lines.push(`${WARNINGS_HEADING}:`);
		for (const warning of report.warnings) {
			lines.push(`  - ${warning}`);
		}
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The registration
// ---------------------------------------------------------------------------

/**
 * Register `/budget`.
 *
 * `rowsWritten` and `noteRowWritten` are passed IN rather than imported from
 * `index.ts`, for the same reason `registerWireHooks` takes them: `index.ts`
 * imports this module, and an import back the other way would make the pair a
 * cycle. Passing the counter explicitly is also what keeps there being exactly
 * ONE counter incremented by every append path — a counter only some paths
 * increment reports a number that looks like a measurement and is not.
 *
 * THE HANDLER BODY IS WRAPPED, AND IT REPORTS TWICE. Pi routes an exception
 * thrown by a command handler to `emitError`, which produces no visible output
 * [VERIFIED: pi 0.84.1 src/core/extensions/runner.ts:861-870, observed live in
 * Phase 2 research]. A `/budget` that silently did nothing would be the exact
 * ambiguity this whole subsystem exists to remove, so the catch path surfaces
 * the failure to the UI *and* appends a `diagnostics.error` row: the operator
 * sees it now, and it is still there tomorrow. [threat T-02-10-06]
 */
export function registerBudgetCommand(
	pi: ExtensionAPI,
	rowsWritten: () => number,
	noteRowWritten: () => void,
): void {
	pi.registerCommand(BUDGET_COMMAND_NAME, {
		description: BUDGET_COMMAND_DESCRIPTION,
		handler: async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
			try {
				// Exact. Reflects `before_agent_start` chaining, and deliberately NOT
				// the `context` hook's message edits or a `before_provider_request`
				// rewrite [CITED: pi 0.84.1 docs/extensions.md:1066-1073].
				const prompt = ctx.getSystemPrompt();
				// Command context only -- see the module docstring.
				const opts = ctx.getSystemPromptOptions();
				const skills = opts.skills ?? [];
				// Reproduces the literal block Pi appends, including the
				// `disableModelInvocation` filter, so the cross-check is against Pi's
				// own formatter rather than a re-implementation of it.
				// Pi 1.1.0 trims the formatter output before embedding it (system-prompt.js:106).
				const skillsBlock = formatSkillsForPrompt(skills).trim();

				const active = new Set(pi.getActiveTools());
				const tools = pi
					.getAllTools()
					.filter((tool) => active.has(tool.name))
					.map((tool) => ({
						name: tool.name,
						description: tool.description,
						parameters: tool.parameters as unknown,
					}));

				const usage = getLastAssistantUsage(ctx.sessionManager.getBranch());

				const report = computeBudget({
					systemPrompt: prompt,
					contextFiles: opts.contextFiles ?? [],
					skills,
					skillsBlock,
					tools,
					lastUsage:
						usage === undefined
							? undefined
							: { input: usage.input, cacheRead: usage.cacheRead },
					rowsWritten: rowsWritten(),
				});

				ctx.ui.notify(formatBudgetReport(report), "info");
			} catch (err) {
				// `String(err)` can quote the input that caused it, and that input may
				// be a `.env` the model just read. [threat T-02-03-06]
				const message = redactString(String(err));
				try {
					ctx.ui.notify(`/${BUDGET_COMMAND_NAME} failed: ${message}`, "error");
				} catch {
					// A UI that cannot render must not stop the row below being written.
				}
				try {
					appendJsonl(
						ctx.cwd,
						TURNS_LOG_BASE,
						{
							ts: Date.now(),
							event: DIAGNOSTICS_ERROR_EVENT,
							where: BUDGET_COMMAND_WHERE,
							error: message,
						},
						{ rotateBytes: TURNS_ROTATE_BYTES, maxRotated: MAX_ROTATED_FILES },
					);
					noteRowWritten();
				} catch {
					// The instrument cannot instrument its own inability to write.
				}
			}
		},
	});
}
