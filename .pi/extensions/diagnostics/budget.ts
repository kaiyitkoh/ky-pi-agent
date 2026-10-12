/**
 * `/budget`: per-turn token report. A command, never a tool (a tool's schema costs tokens on every
 * request), and `getSystemPromptOptions()` exists only on the command context.
 * Character counts are exact, token figures are estimates, and nothing is written to disk.
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


export const BUDGET_COMMAND_NAME = "budget";

export const BUDGET_COMMAND_DESCRIPTION =
	"Per-turn token budget: system prompt, tool schemas, context files, skills, cache";

export const BUDGET_COMMAND_WHERE = "command.budget";

/** Context-file block opener: section `project_context` (pi 1.1.0 dist/core/system-prompt.js:100, wrapper :118). */
export const CONTEXT_FILES_OPEN_MARKER = "<project_context>\n";

export const CONTEXT_FILES_CLOSE_MARKER = "</project_context>";

/** Skills index opener (pi 1.1.0 dist/core/skills.js:284); truncated so a harmless upstream copy-edit cannot move past it. */
export const SKILLS_OPEN_MARKER = "The following skills provide specialized instructions";

export const SKILLS_CLOSE_MARKER = "</available_skills>";

/** Per-file wrapper overhead; the template expression is the citation (pi 1.1.0 dist/core/system-prompt.js:28). */
export const PROJECT_INSTRUCTIONS_WRAPPER_CHARS =
	'<project_instructions path="">\n\n</project_instructions>'.length;

export const TOKEN_ESTIMATE_MARKER = "~";

export const ESTIMATE_NOTE =
	`Token figures marked ${TOKEN_ESTIMATE_MARKER} are ESTIMATES: Math.ceil(chars / 4), ` +
	"Pi's own heuristic, roughly +/-20% error. Characters are the measurement.";

export const PROVIDER_REPORTED_LABEL = "provider-reported (ground truth)";

export const NO_PROVIDER_USAGE_NOTE = "no assistant turn in this session yet";

export const ROWS_WRITTEN_LABEL = "diagnostic rows written this session";

/** Printed so "0 rows" is visible: Pi swallows handler exceptions, so a dead instrument looks quiet. */
export const ZERO_ROWS_NOTE = "0 means the instrument recorded nothing this session";

export const WARNINGS_HEADING = "WARNINGS";

export const CONTEXT_MARKER_MISSING_WARNING =
	`context files are loaded but ${CONTEXT_FILES_OPEN_MARKER.trim()} was not found in the ` +
	"system prompt -- Pi changed its prompt format and this decomposition is now attributing " +
	"the whole block to the base prompt";

export const SKILLS_MARKER_MISSING_WARNING =
	`a skills index was recomputed but its opening sentence was not found in the system ` +
	"prompt -- either Pi changed its prompt format, or the read tool is inactive and Pi " +
	"omitted the block (skills.ts:155 gates it on `hasRead`)";

/**
 * `base` is computed by removing located regions, so this sum is a real invariant. Delimiters quoted
 * in context-file content (an AGENTS.md mentioning `<project_context>`) can break it.
 */
export const DECOMPOSITION_DOES_NOT_SUM_WARNING =
	"base + contextFiles + skills does not equal the system-prompt length -- the located regions " +
	"overlap or were located twice (a context file whose CONTENT quotes one of Pi's own prompt " +
	"delimiters does exactly this), so every proportion in this table is mis-attributed";

export const SKILLS_DIVERGENCE_WARNING =
	"the skills block recomputed with formatSkillsForPrompt does not match the region sliced " +
	"out of the system prompt -- RESEARCH §7.3 says a divergence means Pi changed the format, " +
	"and this report must say so loudly rather than silently mis-report";


/**
 * Characters to tokens: `Math.ceil(chars / 4)`, roughly +/-20%, the same formula as Pi's own
 * (src/core/compaction/compaction.ts#estimateTokens). No tokenizer dependency may be added; pinning.test.ts enforces it.
 */
export function estimateTokensFromChars(chars: number): number {
	return Math.ceil(chars / 4);
}


export interface SystemPromptSlices {
	total: number;
	base: number;
	contextFiles: number;
	skills: number;
	/** `false` with size 0 differs from a genuinely absent block: the marker may have moved. */
	contextFilesFound: boolean;
	skillsFound: boolean;
}

interface Region {
	start: number;
	end: number;
}

/** Returns `undefined` when either delimiter is missing; an unterminated block has no meaningful size. */
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
 * Decompose the system prompt into base / context files / skills by locating Pi's literal markers
 * (`buildSystemPrompt` is not exported). Missing markers show up in `*Found`, never guessed; `base`
 * is the prompt with regions removed, not `total - ...`, so the sum check is meaningful.
 */
export function sliceSystemPrompt(prompt: string): SystemPromptSlices {
	const contextRegion = findRegion(prompt, CONTEXT_FILES_OPEN_MARKER, CONTEXT_FILES_CLOSE_MARKER);
	const skillsRegion = findRegion(prompt, SKILLS_OPEN_MARKER, SKILLS_CLOSE_MARKER);

	const regions = [contextRegion, skillsRegion]
		.filter((region): region is Region => region !== undefined)
		.sort((a, b) => a.start - b.start);

	// Overlapping regions make the pieces fail to sum, which is the loud failure wanted.
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


export interface SectionSize {
	chars: number;
	estimatedTokens: number;
}

export interface NamedSectionSize extends SectionSize {
	name: string;
}

export interface BudgetInput {
	systemPrompt: string;
	contextFiles: readonly { path: string; content: string }[];
	skills: readonly unknown[];
	/** Recomputed skills block from Pi's formatter; `undefined` is compared as empty. */
	skillsBlock: string | undefined;
	tools: readonly { name: string; description: string; parameters: unknown }[];
	lastUsage: { input: number; cacheRead: number } | undefined;
	rowsWritten: number;
}

export interface BudgetReport {
	systemPrompt: SectionSize;
	basePrompt: SectionSize;
	contextFiles: SectionSize;
	contextFilesByPath: NamedSectionSize[];
	skillsIndex: SectionSize;
	toolSchemas: SectionSize;
	toolSchemasByName: NamedSectionSize[];
	skillCount: number;
	contextFilesFound: boolean;
	skillsFound: boolean;
	skillsBlockMatchesSlice: boolean;
	lastUsage?: { input: number; cacheRead: number };
	cacheReadRatio?: number;
	rowsWritten: number;
	warnings: string[];
}

function size(chars: number): SectionSize {
	return { chars, estimatedTokens: estimateTokensFromChars(chars) };
}

function byCharsDescending(a: NamedSectionSize, b: NamedSectionSize): number {
	return b.chars - a.chars || a.name.localeCompare(b.name);
}

/**
 * Turn exact inputs into a structured report. Pure. Per-file rows sum to slightly less than the
 * block total (delimiters and header); the residual is not fudged.
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

	// Evaluated at runtime and first: when it fires every number below is unreliable.
	const accounted = slices.base + slices.contextFiles + slices.skills;
	if (accounted !== slices.total) {
		warnings.push(
			`${DECOMPOSITION_DOES_NOT_SUM_WARNING} (accounted ${accounted}, total ${slices.total})`,
		);
	}

	// Warn only on a marker that was expected and is missing.
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
			// Same definition as `TurnRow.cacheReadRatio` in schema.ts.
			report.cacheReadRatio = input.lastUsage.cacheRead / denominator;
		}
	}

	return report;
}


const LABEL_WIDTH = 30;
const CHARS_WIDTH = 10;

function row(label: string, section: SectionSize, indent = ""): string {
	const name = `${indent}${label}`.padEnd(LABEL_WIDTH);
	const chars = String(section.chars).padStart(CHARS_WIDTH);
	const tokens = `${TOKEN_ESTIMATE_MARKER}${section.estimatedTokens}`.padStart(CHARS_WIDTH);
	return `  ${name}${chars}${tokens}`;
}

/**
 * Render the report as aligned text. Every token figure carries the estimate marker, provider
 * figures sit on their own line, the rows-written count is printed, and no file content appears.
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


/**
 * Register `/budget`. Counters are passed in to avoid an import cycle with index.ts. The handler
 * is wrapped because Pi swallows command exceptions (core/extensions/runner.ts); failures go to the UI and a row.
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
				// Built from the run's prompt options, so payload rewrites are not reflected (pi 1.1.0 agent-session.js:1057-1058).
				const prompt = ctx.getSystemPrompt();
				const opts = ctx.getSystemPromptOptions();
				const skills = opts.skills ?? [];
				// Pi trims the formatter output before embedding it (pi 1.1.0 system-prompt.js:106).
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
				// `String(err)` can quote a `.env` the model just read.
				const message = redactString(String(err));
				try {
					ctx.ui.notify(`/${BUDGET_COMMAND_NAME} failed: ${message}`, "error");
				} catch {
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
