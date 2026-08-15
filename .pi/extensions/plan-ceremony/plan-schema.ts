/**
 * FLOW-06 — the `/plan` → `PLAN.md` task form and requirement-coverage
 * matrix, made machine-checkable.
 *
 * PURPOSE. `.planning/research/FEATURES.md` Part 2 (lines 181-202) names
 * `PLAN.md`'s task form verbatim: `T### [P] [R#,R#,...] verb <explicit
 * path> + verification command`, e.g. `- [ ] T003 [P] [R2,R5] Add
 * refresh-token rotation to src/auth/session.ts`. "Every task carries: ID,
 * optional `[P]`, requirement IDs, verb, an EXPLICIT FILE PATH, and a
 * VERIFICATION COMMAND." That is a parser requirement, not prompt wording —
 * a `/plan` that emits a beautifully-worded instruction to use this form,
 * and then accepts a plan that does not, has not met FLOW-06 however good
 * its system prompt reads. {@link validatePlan} is the mechanism: a pure
 * predicate over raw markdown text, with a binding branch order, that a
 * future `/plan` write path (plan 09-10) must consult before it may write
 * PLAN.md's content. This module builds the predicate only; wiring it to
 * `/plan`'s actual write path is plan 09-10's job, per this plan's own
 * frontmatter (`requirements: ["FLOW-06"]`, closed only when 09-10 lands).
 *
 * The files-touched union this module computes ({@link filesTouchedUnion})
 * is the SECOND input to `/review`'s drift baseline — the first is
 * `spec-schema.ts`'s `ScopePin.expectedFiles` (SPEC §5). The verification
 * command per task is what makes `/execute`'s pasted output meaningful: a
 * task with no declared command has nothing for `/execute` to run and paste
 * back.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE IS PURE
 * ---------------------------------------------------------------------------
 * It makes no model call, reads no file, and registers nothing with Pi. It
 * takes and returns plain data: a task-line parser, a whole-document
 * validator, and a Markdown renderer. The caller — `/plan`'s own command
 * file, built in plan 09-10 — owns reading a candidate `PLAN.md` off disk (or
 * a model's draft of one), calling {@link validatePlan} over its text
 * against the SPEC's own requirement id list, and refusing to let the model
 * write it on a reject verdict.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (BOOT-10)
 * ---------------------------------------------------------------------------
 * This module registers nothing. It does not spell the tool-registration
 * call, in code or in prose — `tests/unit/contributing-boundary.test.ts`
 * matches that call's name as a plain substring across every tracked source
 * under `.pi/extensions/`, comments included, and grants this directory no
 * exemption. Nothing in this file calls a registration API of any kind.
 *
 * ---------------------------------------------------------------------------
 * CHOKEPOINT HYGIENE (DIAG-03 / QUAL-02's structural claim)
 * ---------------------------------------------------------------------------
 * This file never reaches a model. It does not spell, even in a comment, the
 * documented direct-completion method on the model registry, its
 * simple-options or streaming siblings, the method that hands back a raw
 * provider object, the other route to a raw provider object, a deep import
 * under the pi-ai package's adapter path, or the model runtime class name —
 * the same six-plus-one bypass routes `tests/unit/chokepoint-lint.test.ts`
 * enumerates. Describing them here in the abstract, rather than naming them,
 * is deliberate: `chokepoint-lint.test.ts` matches raw source text, comments
 * included, and grants this module no exemption.
 *
 * ---------------------------------------------------------------------------
 * LAYOUT
 * ---------------------------------------------------------------------------
 *   TASK_LINE_PATTERN, VERIFICATION_SEPARATOR — the task-line shape and its
 *   path/command extraction convention.
 *   ParsedTask, parseTaskLine — one task line parsed, or a malformed
 *   diagnostic.
 *   parsePlanTasks — the whole-document task-line scanner; malformed lines
 *   are RETURNED, never dropped.
 *   filesTouchedUnion — the sorted, de-duplicated path union that feeds
 *   `/review`'s drift baseline.
 *   validatePlan — the whole-document, numbered, binding-order gate.
 *   renderPlanMarkdown — the on-disk PLAN.md rendering.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS VALIDATOR DOES NOT, AND CANNOT, PROVE
 * ---------------------------------------------------------------------------
 * {@link validatePlan} proves the plan has the required SHAPE: every task
 * carries an id, a requirement group, an explicit path and a verification
 * command, and every stated requirement is covered by at least one task in
 * both directions. It CANNOT prove the tasks would actually SATISFY the
 * requirement they cite, that the declared verification command is the
 * RIGHT one, or that running it will PASS. A plan whose T003 cites R2 and
 * touches the right file, but whose actual diff does nothing R2 asks for, is
 * shaped correctly and passes here. That is what `/execute`'s own run of the
 * declared command and `/review`'s reviewer (which receives the full
 * contents of every touched file, per `review-schema.ts`'s own analogous
 * disclosure) are for. `09-CONTEXT.md` decision 6 records that Phase 6's
 * evidence gate accepted a FABRICATED completion claim through three
 * consecutive rounds of green tests — overclaiming what a shape check proves
 * here would repeat exactly that failure.
 */
import { EXPECTED_FILE_PATTERN } from "../grill/spec-schema.ts";

// ---------------------------------------------------------------------------
// TASK_LINE_PATTERN, VERIFICATION_SEPARATOR
// ---------------------------------------------------------------------------

/**
 * The task-line separator between the explicit path and its verification
 * command, e.g. `src/auth/session.ts | verify: npm test`. Named, not
 * inlined — {@link parseTaskLine} and {@link renderPlanMarkdown} both use
 * this literal, and a second, differently-spelled separator hard-coded at
 * either call site is how the two silently drift apart. The convention is
 * also mirrored in the `/plan` skill body (plan 09-10) — one convention, two
 * places, this constant authoritative.
 *
 * DELIBERATELY NO TRAILING SPACE. {@link extractPathAndCommand} always
 * `.trim()`s the text on both sides of this separator, so a trailing space
 * on the constant itself would be redundant at best and, at the boundary
 * case where nothing at all follows the separator, would force a fixture to
 * carry invisible trailing whitespace to exercise "a task with a path but no
 * verification command" — a test string a future editor's whitespace
 * trimming could silently corrupt. {@link renderPlanMarkdown} adds the one
 * rendering space explicitly, after this constant, not inside it.
 */
export const VERIFICATION_SEPARATOR = " | verify:";

/**
 * The `PLAN.md` task-line form, `FEATURES.md` Part 2's own example:
 * `- [ ] T003 [P] [R2,R5] Add refresh-token rotation to src/auth/session.ts`.
 *
 * Captures, in order: (1) the `T###` id — EXACTLY three digits, no more, no
 * fewer, via `(?!\d)` after a fixed `\d{3}` so `T0001` fails as surely as
 * `T1` does (a fixed width is deliberate: it keeps every id the same visual
 * length in a task list a human skims, and "exactly three" is a single
 * unambiguous rule rather than "at least N" inviting a creeping id length);
 * (2) an OPTIONAL `[P]` parallel marker; (3) a REQUIRED `[R#]` or
 * `[R#,R#,...]` requirement-id group — the character class inside the
 * brackets requires at least one `R\d+`, so an EMPTY `[]` group fails to
 * match the SAME way an absent group does, both correctly rejected; (4) a
 * verb token (a single whitespace-free word); (5) the remainder of the line.
 *
 * DELIBERATELY NOT CAPTURED POSITIONALLY: the explicit path and the
 * verification command. A path can contain no spaces (repo-relative paths
 * never do) but a verification command routinely does (`npm test`, `npx
 * vitest run x.test.ts`), so widening this regex to capture both by position
 * would either forbid a multi-word command or swallow the path into it.
 * Per this module's own convention, the path is the LAST whitespace-delimited
 * token in the text preceding {@link VERIFICATION_SEPARATOR} (or the whole
 * remainder, when the separator is absent) — matching `FEATURES.md`'s own
 * example, where the path is written LAST in the sentence — checked against
 * {@link EXPECTED_FILE_PATTERN} (imported from `spec-schema.ts`, never
 * re-declared — see this module's header docstring). The LAST token, not
 * ANY matching token, is deliberate: `EXPECTED_FILE_PATTERN` legally accepts
 * a bare single-segment word with no `.`/`/` at all (a real repo-relative
 * path can be a bare filename), so scanning every token for the FIRST match
 * would misidentify an ordinary prose word ("to", "the") earlier in the
 * sentence as the path. The verification command is whatever follows
 * {@link VERIFICATION_SEPARATOR}, trimmed. {@link parseTaskLine} performs
 * that second-pass extraction; this pattern only proves the line has the
 * required outer SHAPE.
 *
 * REJECTS, stated here so the rule is visible beside the pattern: a missing
 * or malformed id (`T1`, `T0001`, no id at all), an absent `[R#]` group, an
 * empty `[]` group, a missing verb, and a missing remainder entirely.
 *
 * BOUNDED FOR BACKTRACKING SAFETY [threat T-09-09-04]. The verb capture is
 * `\S{1,200}` and the remainder capture is `\S.{0,2000}` — both bounded, no
 * nested quantifier over an unbounded group anywhere in this pattern,
 * matching `spec-schema.ts`'s own `IF_THEN_PATTERN` discipline. Anchored at
 * both ends (`^`/`$`, no `m`/`g` flag) so a caller applying this per-line
 * (never against a whole multi-line document) gets a FULL-match verdict —
 * {@link parsePlanTasks} is what walks a whole document line by line.
 */
export const TASK_LINE_PATTERN =
	/^- \[[ xX]\] (T\d{3})(?!\d)(?: (\[P\]))? \[(R\d+(?:,R\d+)*)\] (\S{1,200}) (\S.{0,2000})$/;

/**
 * Detects a candidate task line — anything opening with the checkbox
 * prefix — so {@link parsePlanTasks} can distinguish "a task line that
 * failed {@link TASK_LINE_PATTERN}" (malformed, must be reported) from
 * ordinary prose elsewhere in the document (not a task line at all, not
 * reported). Deliberately looser than {@link TASK_LINE_PATTERN}: this is a
 * classification prefix, not a shape proof.
 */
const CHECKBOX_LINE_PATTERN = /^- \[[ xX]\] /;

/**
 * A bare `[R#]`/`[R#,R#,...]` group found ANYWHERE in a line, used only by
 * {@link diagnoseMalformedLine} to distinguish "no requirement group at all"
 * from "some other element is malformed" when {@link TASK_LINE_PATTERN}
 * itself has already failed to match. Never used to accept a line — only
 * {@link TASK_LINE_PATTERN} does that.
 */
const REQUIREMENT_GROUP_PROBE_PATTERN = /\[(R\d+(?:,R\d+)*)\]/;

/**
 * The `T###` id token immediately following the checkbox prefix, greedy
 * over every digit that follows `T` — used only by
 * {@link diagnoseMalformedLine} to report what id-shaped text actually
 * arrived (`T1`, `T0001`, or nothing) when {@link TASK_LINE_PATTERN} has
 * already failed to match.
 */
const ID_TOKEN_PROBE_PATTERN = /^- \[[ xX]\] (T\d*)/;

/**
 * Builds a human-legible diagnosis for a line that opened with the checkbox
 * prefix but failed {@link TASK_LINE_PATTERN} — naming the SPECIFIC missing
 * or malformed element rather than only "no match", per this plan's own
 * acceptance criterion ("quoting the offending line verbatim and stating
 * which element is missing"). Ordered: the id is checked first (nothing
 * else is checkable without it), the requirement group second, and anything
 * else falls to a generic shape message quoting the full required form.
 */
function diagnoseMalformedLine(line: string): string {
	const idToken = ID_TOKEN_PROBE_PATTERN.exec(line)?.[1] ?? "";
	if (!/^T\d{3}$/.test(idToken)) {
		return (
			`missing or malformed task id -- expected exactly three digits after "T" (e.g. T003), received ` +
			`${JSON.stringify(idToken.length > 0 ? idToken : "(none)")}: ${JSON.stringify(line)}`
		);
	}
	if (!REQUIREMENT_GROUP_PROBE_PATTERN.test(line)) {
		return (
			`missing or empty [R#] requirement id group -- an absent group and an empty "[]" group are both ` +
			`rejected, at least one "R<digits>" entry is required: ${JSON.stringify(line)}`
		);
	}
	return (
		`does not match the required task-line form ` +
		`"- [ ] T### [P] [R#,R#,...] <verb> <path>${VERIFICATION_SEPARATOR}<command>": ${JSON.stringify(line)}`
	);
}

// ---------------------------------------------------------------------------
// ParsedTask, parseTaskLine
// ---------------------------------------------------------------------------

/** One well-formed task line, per {@link TASK_LINE_PATTERN} and this module's path/command convention. */
export interface ParsedTask {
	readonly id: string;
	readonly parallel: boolean;
	readonly requirementIds: readonly string[];
	readonly verb: string;
	/** The token in the remainder matching {@link EXPECTED_FILE_PATTERN}. Absent when no such token was found. */
	readonly path?: string;
	/** The text following {@link VERIFICATION_SEPARATOR}. Absent when the separator is absent, or nothing non-empty follows it. */
	readonly verificationCommand?: string;
	readonly rawLine: string;
}

/**
 * Splits a matched {@link TASK_LINE_PATTERN} remainder into its path and
 * verification-command halves, per this module's declared convention (see
 * {@link TASK_LINE_PATTERN}'s own doc comment): the path is the LAST
 * whitespace-delimited token in the text before {@link VERIFICATION_SEPARATOR}
 * (or in the whole remainder, when the separator is absent), checked
 * against {@link EXPECTED_FILE_PATTERN} — not simply taken on faith, since
 * the last word of an ordinary sentence with no real path at all ("...works
 * correctly!") must still fail; the command is the text after the
 * separator, trimmed, and treated as absent if empty.
 */
function extractPathAndCommand(remainder: string): { readonly path?: string; readonly verificationCommand?: string } {
	const sepIndex = remainder.indexOf(VERIFICATION_SEPARATOR);
	const pathPart = sepIndex === -1 ? remainder : remainder.slice(0, sepIndex);
	const commandPart = sepIndex === -1 ? undefined : remainder.slice(sepIndex + VERIFICATION_SEPARATOR.length).trim();

	const pathTokens = pathPart.trim().split(/\s+/).filter((token) => token.length > 0);
	const lastToken = pathTokens[pathTokens.length - 1];
	const path = lastToken !== undefined && EXPECTED_FILE_PATTERN.test(lastToken) ? lastToken : undefined;
	const verificationCommand = commandPart !== undefined && commandPart.length > 0 ? commandPart : undefined;

	return {
		...(path !== undefined ? { path } : {}),
		...(verificationCommand !== undefined ? { verificationCommand } : {}),
	};
}

/**
 * Parses one line into a {@link ParsedTask}, or a `{ malformed }` diagnostic
 * when the line fails {@link TASK_LINE_PATTERN}. Callers that already know a
 * line is a task-line CANDIDATE (opens with the checkbox prefix) — i.e.
 * {@link parsePlanTasks} — are the intended caller; this function itself
 * performs no such pre-filtering, so calling it on ordinary prose returns a
 * malformed diagnostic rather than throwing.
 */
export function parseTaskLine(line: string): ParsedTask | { readonly malformed: string } {
	const match = TASK_LINE_PATTERN.exec(line);
	if (match === null) {
		return { malformed: diagnoseMalformedLine(line) };
	}

	const [, id, parallelMarker, reqGroup, verb, remainder] = match;
	const requirementIds = (reqGroup ?? "").split(",");
	const { path, verificationCommand } = extractPathAndCommand(remainder ?? "");

	return {
		id: id ?? "",
		parallel: parallelMarker !== undefined,
		requirementIds,
		verb: verb ?? "",
		...(path !== undefined ? { path } : {}),
		...(verificationCommand !== undefined ? { verificationCommand } : {}),
		rawLine: line,
	};
}

// ---------------------------------------------------------------------------
// parsePlanTasks
// ---------------------------------------------------------------------------

/**
 * Scans a whole `PLAN.md` markdown document for task lines (any line opening
 * with the checkbox prefix, per {@link CHECKBOX_LINE_PATTERN}), parsing each
 * with {@link parseTaskLine}.
 *
 * Malformed lines are RETURNED in `malformed`, NEVER dropped — dropping a
 * malformed line here is exactly how a pathless or commandless task becomes
 * invisible to {@link validatePlan}'s own reject branches, the same
 * discipline `spec-schema.ts`'s `parseErrorBehaviours` and `parseVerifiedFacts`
 * document for their own malformed rows. A line that does not open with the
 * checkbox prefix at all is not a task-line candidate and is silently
 * skipped — it is ordinary prose (a heading, a note), not a defective task.
 */
export function parsePlanTasks(markdown: string): { readonly tasks: readonly ParsedTask[]; readonly malformed: readonly string[] } {
	const candidateLines = markdown.split("\n").filter((line) => CHECKBOX_LINE_PATTERN.test(line));

	const tasks: ParsedTask[] = [];
	const malformed: string[] = [];

	for (const line of candidateLines) {
		const result = parseTaskLine(line);
		if ("malformed" in result) {
			malformed.push(result.malformed);
		} else {
			tasks.push(result);
		}
	}

	return { tasks, malformed };
}

// ---------------------------------------------------------------------------
// filesTouchedUnion
// ---------------------------------------------------------------------------

/**
 * The sorted, de-duplicated union of every task's `path` — `/review`'s
 * drift baseline, alongside SPEC §5's `expectedFiles` list
 * (`spec-schema.ts`'s `ScopePin`). A task with no `path` (should never
 * survive {@link validatePlan}'s branch (4), but this function accepts any
 * `ParsedTask[]`, including a pre-validation one) contributes nothing rather
 * than an `undefined` entry.
 */
export function filesTouchedUnion(tasks: readonly ParsedTask[]): readonly string[] {
	const paths = new Set<string>();
	for (const task of tasks) {
		if (task.path !== undefined) {
			paths.add(task.path);
		}
	}
	return Array.from(paths).sort();
}

// ---------------------------------------------------------------------------
// validatePlan
// ---------------------------------------------------------------------------

/**
 * The whole validated PLAN artifact. Only ever produced by
 * {@link validatePlan}'s accept arm (branch 8) — there is no other
 * constructor.
 */
export interface PlanArtifact {
	readonly tasks: readonly ParsedTask[];
	/** Requirement id -> the ids of every task citing it, in document order. Keyed by every id in the caller's `specRequirementIds`. */
	readonly coverageMatrix: ReadonlyMap<string, readonly string[]>;
	readonly filesTouched: readonly string[];
}

/** Mirrors `review-schema.ts`'s `ReviewValidation` and `spec-schema.ts`'s `SpecValidation`: deliberately two arms, never three. */
export type PlanValidation = { readonly ok: true; readonly plan: PlanArtifact } | { readonly ok: false; readonly reason: string };

/**
 * The whole FLOW-06 predicate: a `PLAN.md` whose task lines lack an id, a
 * requirement group, an explicit path or a verification command is rejected
 * by code, and coverage against the SPEC's own requirement id list is
 * enforced in BOTH directions. First-match-wins, in `gateRequirementsAuthorship`'s
 * (`spec-schema.ts:415-513`) exact numbered, BINDING-ORDER docstring style.
 * Every reject `reason` is built FROM THE RECEIVED DATA — never from a
 * caller-supplied string.
 *
 *   (1) zero task lines found (no candidate line, malformed or otherwise) ->
 *       reject. Sits FIRST because every later check would pass VACUOUSLY on
 *       an empty plan — an empty task list trivially "covers" nothing to
 *       reject and has no duplicate, pathless or commandless task to find.
 *   (2) any malformed line (a candidate line failing {@link TASK_LINE_PATTERN})
 *       -> reject, quoting the offending line verbatim and stating which
 *       element is missing (via {@link diagnoseMalformedLine}). Sits before
 *       every content check below: a malformed line has no reliable id,
 *       path or requirement group to check further checks against.
 *   (3) duplicate `T###` ids -> reject, naming the duplicates. Sits before
 *       the path/command checks (4)/(5): a duplicate id makes "which task
 *       is missing X" ambiguous to report until uniqueness is restored.
 *   (4) a task with no `path` (no token in its remainder matched
 *       {@link EXPECTED_FILE_PATTERN}) -> reject, naming the task id(s).
 *   (5) a task with no `verificationCommand` (the separator absent, or
 *       nothing non-empty followed it) -> reject, naming the task id(s).
 *       Sits after (4) so a task missing BOTH reports the more fundamental
 *       defect (no path at all — `/review`'s drift baseline cannot even
 *       name the file) first, per this plan's own instruction.
 *   (6) COVERAGE, direction one: a requirement id in `specRequirementIds`
 *       cited by zero tasks -> reject naming every uncovered id. A plan
 *       that maps nothing to a stated requirement has not planned for it.
 *   (7) COVERAGE, direction two: a task citing a requirement id NOT in
 *       `specRequirementIds` -> reject naming the invented id(s) and the
 *       task(s) that cite them. Both directions are required —
 *       `review-schema.ts:368-402`'s precedent for `ReviewVerdict` coverage
 *       — because a one-directional check is satisfied by a plan that maps
 *       everything to one giant task (direction one alone) and also by a
 *       plan that invents requirements nobody asked for (direction two
 *       alone).
 *   (8) otherwise -> accept, constructing {@link PlanArtifact} — the ONLY
 *       place in this file that does so.
 *
 * See this module's own header docstring, "WHAT THIS VALIDATOR DOES NOT,
 * AND CANNOT, PROVE", for what a passing verdict here does and does not mean.
 */
export function validatePlan(markdown: string, specRequirementIds: readonly string[]): PlanValidation {
	const { tasks, malformed } = parsePlanTasks(markdown);

	// (1)
	if (tasks.length === 0 && malformed.length === 0) {
		return {
			ok: false,
			reason:
				"no task lines found in this PLAN.md -- every stated requirement needs at least one task, and an " +
				"empty task list would satisfy every later check vacuously",
		};
	}

	// (2)
	if (malformed.length > 0) {
		return {
			ok: false,
			reason: `this PLAN.md carries ${malformed.length} malformed task line(s): ${malformed.join(" || ")}`,
		};
	}

	// (3)
	const idCounts = new Map<string, number>();
	for (const task of tasks) {
		idCounts.set(task.id, (idCounts.get(task.id) ?? 0) + 1);
	}
	const duplicateIds = Array.from(idCounts.entries())
		.filter(([, count]) => count > 1)
		.map(([id]) => id);
	if (duplicateIds.length > 0) {
		return {
			ok: false,
			reason: `this PLAN.md declares duplicate task id(s): ${duplicateIds.join(", ")} -- every T### id must be unique`,
		};
	}

	// (4)
	const pathlessTaskIds = tasks.filter((task) => task.path === undefined).map((task) => task.id);
	if (pathlessTaskIds.length > 0) {
		return {
			ok: false,
			reason:
				`task(s) ${pathlessTaskIds.join(", ")} carry no explicit file path -- no token in the task's text ` +
				"matched EXPECTED_FILE_PATTERN",
		};
	}

	// (5)
	const commandlessTaskIds = tasks.filter((task) => task.verificationCommand === undefined).map((task) => task.id);
	if (commandlessTaskIds.length > 0) {
		return {
			ok: false,
			reason:
				`task(s) ${commandlessTaskIds.join(", ")} carry no verification command -- expected text following ` +
				`the "${VERIFICATION_SEPARATOR.trim()}" separator`,
		};
	}

	// (6)
	const citedIds = new Set(tasks.flatMap((task) => task.requirementIds));
	const uncoveredRequirementIds = specRequirementIds.filter((id) => !citedIds.has(id));
	if (uncoveredRequirementIds.length > 0) {
		return {
			ok: false,
			reason:
				`requirement id(s) with zero citing tasks: ${uncoveredRequirementIds.join(", ")} -- every requirement ` +
				"the SPEC states needs at least one task",
		};
	}

	// (7)
	const expectedIds = new Set(specRequirementIds);
	const inventedCitations = tasks.flatMap((task) =>
		task.requirementIds.filter((id) => !expectedIds.has(id)).map((id) => `${task.id} cites ${id}`),
	);
	if (inventedCitations.length > 0) {
		return {
			ok: false,
			reason: `task(s) cite requirement id(s) the SPEC does not declare: ${inventedCitations.join(", ")}`,
		};
	}

	// (8) accept -- the only construction site for PlanArtifact.
	const coverageMatrix = new Map<string, readonly string[]>();
	for (const id of specRequirementIds) {
		coverageMatrix.set(
			id,
			tasks.filter((task) => task.requirementIds.includes(id)).map((task) => task.id),
		);
	}

	return {
		ok: true,
		plan: { tasks, coverageMatrix, filesTouched: filesTouchedUnion(tasks) },
	};
}

// ---------------------------------------------------------------------------
// renderPlanMarkdown
// ---------------------------------------------------------------------------

/**
 * Renders a validated {@link PlanArtifact} as the on-disk `PLAN.md` shape,
 * copying `renderReviewMarkdown`'s (`review-schema.ts:526-579`) accumulator
 * style exactly: a `string[]` pushed to per section, joined with `"\n"`.
 * FEATURES.md Part 2's three-part order: the task list, the coverage matrix
 * (a literal `| Requirement | Tasks |` pipe table), the files-touched union,
 * plus a trailing caveat paragraph.
 *
 * Only ever called with a {@link PlanArtifact} that already came out of
 * {@link validatePlan}'s accept arm — there is no independent shape
 * validation here, because there is no other legitimate constructor for a
 * `PlanArtifact` in this codebase.
 */
export function renderPlanMarkdown(plan: PlanArtifact): string {
	const lines: string[] = [];

	lines.push("# PLAN");
	lines.push("");

	lines.push("## Task List");
	lines.push("");
	for (const task of plan.tasks) {
		const parallelToken = task.parallel ? "[P] " : "";
		lines.push(
			`- [ ] ${task.id} ${parallelToken}[${task.requirementIds.join(",")}] ${task.verb} ` +
				`${task.path ?? ""}${VERIFICATION_SEPARATOR} ${task.verificationCommand ?? ""}`,
		);
	}
	lines.push("");

	lines.push("## Coverage Matrix");
	lines.push("");
	lines.push("| Requirement | Tasks |");
	lines.push("| --- | --- |");
	for (const [requirementId, taskIds] of plan.coverageMatrix) {
		lines.push(`| ${requirementId} | ${taskIds.join(", ")} |`);
	}
	lines.push("");

	lines.push("## Files Touched");
	lines.push("");
	for (const path of plan.filesTouched) {
		lines.push(`- ${path}`);
	}
	lines.push("");

	lines.push("---");
	lines.push("");
	lines.push(
		"*The coverage matrix above proves every stated requirement has at least one citing task. It proves " +
			"nothing about whether those tasks are SUFFICIENT to satisfy the requirement, whether the declared " +
			"verification command is the RIGHT one, or whether running it will PASS -- see this module's own " +
			'"WHAT THIS VALIDATOR DOES NOT, AND CANNOT, PROVE" section.*',
	);
	lines.push("");

	return lines.join("\n");
}
