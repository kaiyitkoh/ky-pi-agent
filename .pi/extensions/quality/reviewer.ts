/**
 * Reviewer context contract (diff, full touched files, gate report, requirements, files-touched union,
 * import graph) and dispatch through `runSingleShotRole`, the only route to a model. Registers nothing.
 * The prompt only asks; `validateReview` (review-schema.ts) is the enforcement.
 */
import type { AssistantMessage, Message, Tool } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { addQualityCost } from "../diagnostics/quality-cost.ts";
import { redactForModel } from "../diagnostics/redact.ts";
import { isProseToolCall } from "../diagnostics/prose.ts";
import { runSingleShotRole } from "../routing/modes.ts";
import {
	NIT_CAP,
	SUBMIT_REVIEW_DESCRIPTION,
	SUBMIT_REVIEW_TOOL_NAME,
	submitReviewParameters,
	validateReview,
	type ReviewValidation,
} from "./review-schema.ts";

/** One touched file in full; whole contents catch the bug of omission a diff hides. */
export interface TouchedFile {
	readonly path: string;
	readonly contents: string;
}

/** One requirement the reviewer must give exactly one verdict. */
export interface ReviewRequirement {
	readonly id: string;
	readonly text: string;
}

/** One file's declared, syntax-level import edges. */
export interface ImportGraphEntry {
	readonly from: string;
	readonly to: readonly string[];
}

/** The fixed contract; every field is required. */
export interface ReviewerContractInput {
	readonly diff: string;
	readonly touchedFiles: readonly TouchedFile[];
	readonly gateReport: string;
	readonly requirements: readonly ReviewRequirement[];
	readonly filesTouchedUnion: readonly string[];
	readonly importGraph: readonly ImportGraphEntry[];
}

/** Throws naming the absent contract element; a missing element is an error, never an empty section. */
function requireNonEmptyString(name: string, value: string): void {
	if (value.trim().length === 0) {
		throw new Error(
			`buildReviewerContext: the "${name}" contract element is absent (empty or whitespace-only string) -- ` +
				"a missing element is an error, not an empty section; the reviewer's fixed context contract " +
				"(diff, full file contents, gate report, requirements, files-touched union, import graph) is " +
				"all six or none",
		);
	}
}

function requireNonEmptyArray<T>(name: string, value: readonly T[]): void {
	if (value.length === 0) {
		throw new Error(
			`buildReviewerContext: the "${name}" contract element is absent (empty array) -- a missing element ` +
				"is an error, not an empty section; the reviewer's fixed context contract (diff, full file " +
				"contents, gate report, requirements, files-touched union, import graph) is all six or none",
		);
	}
}

/** A Markdown fenced code block, backtick-count bumped when the body itself contains a run of backticks. */
function fenced(body: string, lang = ""): string {
	let fence = "```";
	while (body.includes(fence)) {
		fence += "`";
	}
	return `${fence}${lang}\n${body}\n${fence}`;
}

function renderTouchedFiles(files: readonly TouchedFile[]): string {
	return files
		.map((file) => `### ${file.path}\n\n${fenced(file.contents)}`)
		.join("\n\n");
}

function renderRequirements(requirements: readonly ReviewRequirement[]): string {
	return requirements.map((r) => `- ${r.id}: ${r.text}`).join("\n");
}

function renderFilesTouchedUnion(paths: readonly string[]): string {
	return paths.map((p) => `- ${p}`).join("\n");
}

/** One line per declared target, or "(no declared imports)"; an entry with empty `to` is a real measurement. */
function renderImportGraph(entries: readonly ImportGraphEntry[]): string {
	if (entries.length === 0) return "none: no JavaScript or TypeScript file changed";
	return entries
		.map((entry) =>
			entry.to.length === 0
				? `- ${entry.from}: (no declared imports)`
				: entry.to.map((target) => `- ${entry.from} imports ${target}`).join("\n"),
		)
		.join("\n");
}

/**
 * Renders the six sections in contract order; throws when any other element is absent. An empty `importGraph`
 * is valid: a change with no JavaScript or TypeScript file has no edges. The whole string passes through `redactForModel`, since
 * diffs and file contents can surface credentials read earlier in the session.
 */
export function buildReviewerContext(input: ReviewerContractInput): string {
	requireNonEmptyString("diff", input.diff);
	requireNonEmptyArray("touchedFiles", input.touchedFiles);
	requireNonEmptyString("gateReport", input.gateReport);
	requireNonEmptyArray("requirements", input.requirements);
	requireNonEmptyArray("filesTouchedUnion", input.filesTouchedUnion);

	const sections = [
		`# Diff\n\n${fenced(input.diff, "diff")}`,
		`# Full Contents of Every Touched File\n\n${renderTouchedFiles(input.touchedFiles)}`,
		`# Test/Typecheck Output (Deterministic Gate Stage Report)\n\n${fenced(input.gateReport)}`,
		`# Stated Requirements\n\n${renderRequirements(input.requirements)}`,
		`# Files-Touched Union\n\n${renderFilesTouchedUnion(input.filesTouchedUnion)}`,
		`# Import Graph (declared \`import ... from\` and \`export ... from\`, syntax-level only -- see buildImportGraph)\n\n${renderImportGraph(input.importGraph)}`,
	];

	return redactForModel(sections.join("\n\n"));
}

/**
 * `import ... from` and `export ... from` targets. Not line-anchored so multi-line destructured imports
 * match; re-exports count as edges (`loop-police/index.ts`). Bare side-effect and dynamic imports are out of scope.
 */
const IMPORT_FROM_RE = /\b(?:import|export)\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g;

/** Declared graph: one entry per source, specifiers as written and unresolved, in file order; `to` may be empty. */
export function buildImportGraph(sources: readonly { path: string; text: string }[]): ImportGraphEntry[] {
	return sources.map((source) => {
		const to: string[] = [];
		IMPORT_FROM_RE.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = IMPORT_FROM_RE.exec(source.text)) !== null) {
			const specifier = match[1];
			if (specifier !== undefined) {
				to.push(specifier);
			}
		}
		return { from: source.path, to };
	});
}

/**
 * Delivers the anti-review-theatre rules; enforcement is `validateReview`, whatever this says.
 */
export const REVIEWER_SYSTEM_PROMPT = `You are the adversarial code reviewer for ky-pi-agent. You review with FRESH CONTEXT: you did not write this change and you were not given the implementer's own reasoning about it. That is deliberate -- an implementer's rationale, read before the code, primes a reviewer to agree with it rather than check it.

You are held to a NAMED SOFT-FAILURE LIST. Reviewers fail four specific ways, and each one below is a failure mode you must actively guard against, not merely avoid by accident:

1. Stopping at surface issues: reading only the diff and calling the review done, instead of reading the full contents of every touched file for a bug of omission -- a caller that genuinely needed changing and was left untouched is invisible in a diff and visible only in the file it lives in.
2. Treating tests-pass as correctness: the test/typecheck output you were given was produced by the deterministic gate stage BEFORE you were ever called. A green run proves the tests you were handed pass, nothing more. Do not re-run it, and do not treat it as a substitute for reading the code yourself.
3. Downgrading BLOCKER to WARNING to avoid seeming harsh: a finding's severity is decided by what is actually wrong, never by a wish to be agreeable. If it stops the workflow, it is BLOCKER, whatever that costs the mood of the review.
4. Approving when unsure: "I could not fully verify this, so I will assume it is fine" is not a verdict. An honest "Partial" or "Missing" status, or a BLOCKER finding naming exactly what you could not confirm, is always the correct answer to genuine uncertainty -- never silent approval.

The counter-instruction, because the fix for the four failures above has its own failure mode: a reviewer told explicitly to find problems INVENTS them. Do not pad your findings with trivia to look thorough. A genuinely clean area you actually examined belongs in "checked and cleared", never manufactured into a NIT. Findings are scoped to correctness and the requirements actually stated to you -- style preferences and hypothetical future refactors are out of scope entirely -- and NIT-severity findings are capped at ${NIT_CAP} for exactly this reason: five padded NITs are as dishonest a signal as zero real ones.

Every requirement id you are given needs exactly one verdict -- Implemented, Partial, or Missing -- with file:line evidence for where you checked. Do not invent a requirement id and do not skip one you were given.

"checkedAndCleared" is mandatory and must never be empty: describe, in your own words, what you actually examined and found fine. A silent reviewer who reports nothing wrong and nothing checked is indistinguishable from a reviewer who never looked, and that is the exact failure this field exists to close off.

submit_review is the ONLY accepted output. Call it exactly once, with every field filled honestly. Any prose you write outside that call -- in your ordinary assistant message, a summary paragraph, a bare "LGTM" -- is discarded entirely and carries no weight with any downstream consumer. If you do not call submit_review, you have reviewed nothing, however thorough your prose reads.`;

/** The requirement ids under review go straight to `validateReview`. */
export interface RunReviewInput {
	readonly contract: ReviewerContractInput;
	readonly requirementIds: readonly string[];
}

/**
 * Builds the context, dispatches through `runSingleShotRole({role:"reviewer", tools:[submit_review]})` and validates.
 * A reply without a `submit_review` call returns `{ok:false}` here. Cost goes to `addQualityCost`.
 */
export async function runReview(ctx: ExtensionContext, input: RunReviewInput): Promise<ReviewValidation> {
	const context = buildReviewerContext(input.contract);

	const tools: Tool[] = [
		{
			name: SUBMIT_REVIEW_TOOL_NAME,
			description: SUBMIT_REVIEW_DESCRIPTION,
			parameters: submitReviewParameters,
		},
	];

	const messages: Message[] = [{ role: "user", content: context, timestamp: Date.now() }];

	const callOnce = async (): Promise<AssistantMessage> => {
		// A thrown guard refusal never reaches a model, so nothing is charged and it propagates.
		const start = process.hrtime.bigint();
		const reply = await runSingleShotRole(ctx, { role: "reviewer", systemPrompt: REVIEWER_SYSTEM_PROMPT, messages, tools });
		addQualityCost({ ms: Number(process.hrtime.bigint() - start) / 1_000_000, tokens: reply.usage.totalTokens });
		return reply;
	};

	let message = await callOnce();
	// A cheap model that writes the call out as text gets one corrective turn; a second miss fails closed below.
	if (isProseToolCall(message, [SUBMIT_REVIEW_TOOL_NAME])) {
		messages.push(message, {
			role: "user",
			content: `You wrote the ${SUBMIT_REVIEW_TOOL_NAME} call as text, which is discarded. Make the real ${SUBMIT_REVIEW_TOOL_NAME} tool call now.`,
			timestamp: Date.now(),
		});
		message = await callOnce();
	}

	const toolCall = message.content.find(
		(block): block is Extract<AssistantMessage["content"][number], { type: "toolCall" }> =>
			block.type === "toolCall" && block.name === SUBMIT_REVIEW_TOOL_NAME,
	);

	if (toolCall === undefined) {
		const proseText = message.content
			.filter((block): block is Extract<AssistantMessage["content"][number], { type: "text" }> => block.type === "text")
			.map((block) => block.text)
			.join(" ")
			.trim();
		return {
			ok: false,
			reason:
				`runReview: the reviewer returned no "${SUBMIT_REVIEW_TOOL_NAME}" tool call -- prose was ` +
				`returned instead of a structured review (stopReason: ${message.stopReason}${
					proseText.length > 0 ? `, prose: ${JSON.stringify(proseText.slice(0, 200))}` : ""
				}). submit_review is the only accepted output; nothing outside it is a review.`,
		};
	}

	return validateReview(toolCall.arguments, input.requirementIds);
}
