/**
 * GATE-02 — the reviewer's fixed context contract, assembled and delivered
 * through the Phase 2 chokepoint.
 *
 * ---------------------------------------------------------------------------
 * PURPOSE
 * ---------------------------------------------------------------------------
 * The contract is FIXED and COMPLETE, not a preference:
 *
 *   1. the diff
 *   2. FULL CONTENTS of every touched file
 *   3. the test/typecheck output (the deterministic gate stage's own report)
 *   4. the SPEC requirements under review
 *   5. the files-touched union
 *   6. the (declared, syntax-level) import graph
 *
 * A reviewer that sees only the diff misses bugs of omission and cross-file
 * breakage — a caller that genuinely needed changing and was not touched is
 * invisible in a diff and visible only in the full file it lives in. The
 * test/typecheck output is PASSED IN from `quality/gates.ts`'s deterministic
 * stage; this module never re-runs it, and {@link runReview} never spawns
 * anything.
 *
 * ---------------------------------------------------------------------------
 * THE ANTI-REVIEW-THEATRE PROTOCOL'S STRUCTURAL HALF
 * ---------------------------------------------------------------------------
 * The protocol is two-sided by design (08-CONTEXT.md decision 6). The
 * mandatory verdict / mandatory "checked and cleared" / classification
 * enforcement is CODE and already lives in plan 08-03's
 * {@link validateReview} — this module wires the PROMPT and the PAYLOAD, and
 * the prompt is explicitly NOT the mechanism: {@link REVIEWER_SYSTEM_PROMPT}
 * asks nicely; `validateReview` is what actually rejects silence, an
 * unclassified finding, or an uncovered requirement. See that module's own
 * nine-branch docstring for the enforcement half.
 *
 * ---------------------------------------------------------------------------
 * DISPATCH
 * ---------------------------------------------------------------------------
 * The ONLY route this module takes to a model is
 * `runSingleShotRole(ctx, {role:"reviewer", tools:[submit_review]})`, imported
 * from `../routing/modes.ts`. The `reviewer` role already exists in
 * `ROLE_MAP` with `reasoningEffort:"high"` in every mode (05-01); this module
 * invents no parallel role system and opens no second route to a model. This
 * file never spells, even in prose, any of the direct-model-access forms
 * `tests/unit/chokepoint-lint.test.ts` bans across `.pi/extensions/` — the
 * documented direct completion, its streaming siblings, the raw-provider
 * routes, a deep adapter import, or the model runtime class name.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (BOOT-10)
 * ---------------------------------------------------------------------------
 * This module registers nothing with Pi. It does not spell the
 * tool-registration call, in code or in prose —
 * `tests/unit/contributing-boundary.test.ts` matches that call's name as a
 * plain substring across every tracked source under `.pi/extensions/`,
 * comments included, and grants this directory no exemption.
 * `submitReviewParameters` (from `./review-schema.ts`) reaches the model
 * through `runSingleShotRole`'s existing `tools?: Tool[]` field
 * (`CallModelOptions.tools`, threaded by plan 08-01) — a reviewer-scoped
 * forced tool-call schema, never a main-loop tool registration.
 *
 * ---------------------------------------------------------------------------
 * PURITY: ONE IMPURE FUNCTION
 * ---------------------------------------------------------------------------
 * {@link buildReviewerContext} and {@link buildImportGraph} are PURE: plain
 * data in, plain data out, no `ctx`, no I/O, nothing awaited.
 * {@link runReview} is the ONE impure export — it dispatches through
 * `runSingleShotRole`, which needs `ctx` to reach the Phase 2 chokepoint.
 *
 * ---------------------------------------------------------------------------
 * REDACTION (T-08-22)
 * ---------------------------------------------------------------------------
 * The diff and the full contents of every touched file are exactly where a
 * `.env` or a `*.tfstate` the model read earlier this session would surface —
 * `diagnostics/redact.ts`'s own docstring names this precise hazard.
 * {@link buildReviewerContext} passes its WHOLE rendered string through
 * `redactString` before returning. This module never re-implements
 * redaction; `redactString` is the only masking primitive it calls, imported
 * from `../diagnostics/redact.ts` — the same module `workflows/evidence.ts`
 * already imports it from.
 */
import type { AssistantMessage, Message, Tool } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { addQualityCost } from "../diagnostics/quality-cost.ts";
import { redactString } from "../diagnostics/redact.ts";
import { runSingleShotRole } from "../routing/modes.ts";
import {
	NIT_CAP,
	SUBMIT_REVIEW_DESCRIPTION,
	SUBMIT_REVIEW_TOOL_NAME,
	submitReviewParameters,
	validateReview,
	type ReviewValidation,
} from "./review-schema.ts";

// ---------------------------------------------------------------------------
// The six-element contract
// ---------------------------------------------------------------------------

/**
 * One touched file, in full. `contents` is the WHOLE file at the SHA under
 * review, never a diff hunk — see the module docstring for why "full
 * contents" is the element that catches a bug of omission a diff cannot.
 */
export interface TouchedFile {
	readonly path: string;
	readonly contents: string;
}

/** One stated requirement the reviewer must produce exactly one verdict for. */
export interface ReviewRequirement {
	readonly id: string;
	readonly text: string;
}

/** One file's declared, syntax-level import edges — see {@link buildImportGraph}. */
export interface ImportGraphEntry {
	readonly from: string;
	readonly to: readonly string[];
}

/**
 * The whole fixed contract. Every field is REQUIRED — see
 * {@link buildReviewerContext}'s own docstring for what "required" means per
 * field, and why a caller cannot half-satisfy this contract silently.
 */
export interface ReviewerContractInput {
	readonly diff: string;
	readonly touchedFiles: readonly TouchedFile[];
	readonly gateReport: string;
	readonly requirements: readonly ReviewRequirement[];
	readonly filesTouchedUnion: readonly string[];
	readonly importGraph: readonly ImportGraphEntry[];
}

/**
 * Render one contract element's absence into a thrown `Error`, naming which
 * of the six it is. `buildReviewerContext` calls one of these per element,
 * in the FIXED order the contract itself is rendered in, so a caller reading
 * the six checks top-to-bottom sees exactly the six sections that follow.
 */
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

/**
 * Render one {@link ImportGraphEntry} as one line per declared target, or a
 * single "(no declared imports)" line for a file that legitimately imports
 * nothing — an empty `to` array on an entry that itself exists is a real
 * measurement, not a missing contract element (see {@link buildImportGraph}'s
 * own docstring for why the ARRAY of entries, not any one entry's `to`
 * length, is what {@link buildReviewerContext} treats as "present").
 */
function renderImportGraph(entries: readonly ImportGraphEntry[]): string {
	return entries
		.map((entry) =>
			entry.to.length === 0
				? `- ${entry.from}: (no declared imports)`
				: entry.to.map((target) => `- ${entry.from} imports ${target}`).join("\n"),
		)
		.join("\n");
}

/**
 * Assemble the reviewer's fixed context contract as one rendered string, six
 * clearly-labelled sections in the FIXED order the module docstring states.
 * PURE — no `ctx`, no I/O.
 *
 * THROWS, per element, when that element is absent — never silently renders
 * an empty section:
 *   - `diff`: an empty or whitespace-only string.
 *   - `touchedFiles`: an empty array.
 *   - `gateReport`: an empty or whitespace-only string.
 *   - `requirements`: an empty array.
 *   - `filesTouchedUnion`: an empty array.
 *   - `importGraph`: an empty array — NOTE this is the array of PER-FILE
 *     entries, not any individual entry's `to` list; a file that genuinely
 *     imports nothing still produces an entry (see {@link buildImportGraph}),
 *     so a non-empty `touchedFiles` fed through that function always yields
 *     a non-empty `importGraph`, and only a caller that skipped building the
 *     graph entirely trips this check.
 *
 * The whole rendered string is passed through `redactString` before
 * returning (T-08-22) — the diff and the full file contents are exactly
 * where a credential the model read earlier this session would surface.
 */
export function buildReviewerContext(input: ReviewerContractInput): string {
	requireNonEmptyString("diff", input.diff);
	requireNonEmptyArray("touchedFiles", input.touchedFiles);
	requireNonEmptyString("gateReport", input.gateReport);
	requireNonEmptyArray("requirements", input.requirements);
	requireNonEmptyArray("filesTouchedUnion", input.filesTouchedUnion);
	requireNonEmptyArray("importGraph", input.importGraph);

	const sections = [
		`# Diff\n\n${fenced(input.diff, "diff")}`,
		`# Full Contents of Every Touched File\n\n${renderTouchedFiles(input.touchedFiles)}`,
		`# Test/Typecheck Output (Deterministic Gate Stage Report)\n\n${fenced(input.gateReport)}`,
		`# Stated Requirements\n\n${renderRequirements(input.requirements)}`,
		`# Files-Touched Union\n\n${renderFilesTouchedUnion(input.filesTouchedUnion)}`,
		`# Import Graph (declared \`import ... from\` and \`export ... from\`, syntax-level only -- see buildImportGraph)\n\n${renderImportGraph(input.importGraph)}`,
	];

	return redactString(sections.join("\n\n"));
}

// ---------------------------------------------------------------------------
// buildImportGraph -- pure, syntax-level
// ---------------------------------------------------------------------------

/**
 * `import ... from "<specifier>"` AND `export ... from "<specifier>"`
 * targets, one match per occurrence in `source.text`. Deliberately NOT
 * anchored to a line (`[\s\S]*?` crosses newlines) because a real
 * multi-line destructured import (`import {\n  a,\n  b,\n} from "./x.ts";`)
 * is ordinary TypeScript, and a line-anchored pattern would silently miss
 * every one of those. The lazy quantifier stops at the FIRST `from` after
 * `import`/`export`, which is correct for every import/re-export statement
 * this codebase writes: nothing legitimate places a second `from` between
 * an `import`/`export` keyword and its own clause.
 *
 * WR-05: `export` is matched alongside `import` because a re-export
 * (`export { loopPolice as default } from "./loop-police.ts";` -- this
 * repository really ships that shape at
 * `.pi/extensions/loop-police/index.ts`) is a genuine module edge that the
 * import graph exists to surface, and the prior `import`-only pattern
 * produced NO entry for it -- a positive, false statement that the
 * re-exporting file depends on nothing. Still deliberately excludes a bare
 * side-effect `import "./x"` (no `from` clause) and a dynamic `import()`
 * call, per this function's own "declared, syntax-level only" scope.
 */
const IMPORT_FROM_RE = /\b(?:import|export)\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g;

/**
 * The declared import graph for a set of sources: one {@link ImportGraphEntry}
 * per source, `to` holding every specifier that source's own `import ... from
 * "..."` AND `export ... from "..."` (WR-05: re-exports) statements name, in
 * file order. PURE, syntax-level only.
 *
 * This is the DECLARED graph, not a RESOLVED module graph — a specifier is
 * recorded exactly as written (`"../diagnostics/redact.ts"`,
 * `"@earendil-works/pi-ai"`), never resolved against the filesystem or
 * `node_modules`, and a dynamic `import(...)` call is out of scope entirely
 * (deliberately: resolving one would need to evaluate an arbitrary
 * expression, which this function does not and must not do). A bare
 * side-effect `import "./x"` (no `from` clause) is also out of scope, for
 * the same reason it always was: there is no specifier-bearing `from` to
 * capture.
 *
 * Always returns one entry per source, even when a source's own `to` array
 * is empty (a file that imports nothing) — see {@link buildReviewerContext}'s
 * own docstring for why that is what makes a non-empty `touchedFiles` always
 * produce a non-empty `importGraph`.
 */
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

// ---------------------------------------------------------------------------
// The adversarial system prompt
// ---------------------------------------------------------------------------

/**
 * The reviewer's system prompt -- a DELIVERY MECHANISM for the
 * anti-review-theatre protocol, NOT the enforcement. The enforcement is code:
 * `review-schema.ts`'s {@link validateReview} structurally rejects an
 * unclassified finding, an uncovered requirement, an empty "checked and
 * cleared" section, and an unrecorded workaround, REGARDLESS of what this
 * prompt says. This prompt exists so the model is TOLD the rules it will be
 * held to before it is held to them, not so the rules depend on it reading
 * carefully.
 *
 * Kept identical, in substance, to `.pi/agents/reviewer.md`'s own prompt body
 * -- `tests/integration/reviewer-contract.test.ts` asserts the two agree, so
 * this string and that file cannot drift into two different reviewers.
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

// ---------------------------------------------------------------------------
// runReview -- the one impure export
// ---------------------------------------------------------------------------

/** What {@link runReview} needs beyond the contract: the requirement ids under review, passed straight to `validateReview`. */
export interface RunReviewInput {
	readonly contract: ReviewerContractInput;
	readonly requirementIds: readonly string[];
}

/**
 * Build the context, dispatch it through the Phase 2 chokepoint via
 * `runSingleShotRole({role:"reviewer", tools:[submit_review]})`, and validate
 * whatever the model called back with.
 *
 * An assistant message that never calls `submit_review` -- the "LGTM" path --
 * fails HERE, not only inside `validateReview`: this function looks for the
 * tool call itself before ever handing anything to the validator, and
 * returns `{ok:false}` naming that prose was returned instead of a
 * structured review.
 *
 * Wall-clock and token cost are timed around the nested call and reported via
 * `addQualityCost({ms, tokens})` -- QUAL-09's ledger: this is the quality
 * layer's own share of a turn's cost, summed alongside the deterministic
 * gate stage's (`quality/gates.ts`) and the refute pass's (plan 08-09)
 * contributions by `diagnostics/index.ts`'s `turn_end` handler.
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

	// Timed around the call, per QUAL-09. A thrown guard refusal (no configured
	// candidate, a capability mismatch) never reaches a model at all -- see
	// `runSingleShotRole`'s own zero-request refusal contract -- and is left
	// to propagate uncaught rather than charged against the ledger, since
	// nothing was actually spent.
	const start = process.hrtime.bigint();
	const message: AssistantMessage = await runSingleShotRole(ctx, {
		role: "reviewer",
		systemPrompt: REVIEWER_SYSTEM_PROMPT,
		messages,
		need: {},
		tools,
	});
	const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
	addQualityCost({ ms: elapsedMs, tokens: message.usage.totalTokens });

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
