/**
 * The /plan -> PLAN.md task form and requirement-coverage matrix, machine-checked.
 * Task form: `- [ ] T### [P] [R#,...] verb <explicit path> | verify: <command>`.
 * validatePlan proves shape only: not that tasks satisfy their requirements or that the command is right (/execute and /review cover that).
 * Pure: no model call, no file read, registers nothing.
 */
import { EXPECTED_FILE_PATTERN } from "../grill/spec-schema.ts";

/** Separator between the explicit path and its verification command. No trailing space: sides are trimmed, and the renderer adds it. */
export const VERIFICATION_SEPARATOR = " | verify:";

/**
 * The task-line form, full-match anchored: fixed three-digit id (`(?!\d)` rejects T0001), optional [P], required non-empty [R#,...] group, a verb, a remainder.
 * The path is the last token before VERIFICATION_SEPARATOR, not the first match, because EXPECTED_FILE_PATTERN also accepts a bare word.
 * Captures are bounded, with no nested unbounded quantifier, against backtracking.
 */
export const TASK_LINE_PATTERN =
	/^- \[[ xX]\] (T\d{3})(?!\d)(?: (\[P\]))? \[(R\d+(?:,R\d+)*)\] (\S{1,200}) (\S.{0,2000})$/;

/** A candidate task line (checkbox prefix), looser than TASK_LINE_PATTERN, so malformed task lines are reported and ordinary prose is not. */
const CHECKBOX_LINE_PATTERN = /^- \[[ xX]\] /;

/** Names the specific missing element of a candidate line that failed TASK_LINE_PATTERN: id first, then requirement group, else the full form. */
function diagnoseMalformedLine(line: string): string {
	const idToken = /^- \[[ xX]\] (T\d*)/.exec(line)?.[1] ?? "";
	if (!/^T\d{3}$/.test(idToken)) {
		return (
			`missing or malformed task id -- expected exactly three digits after "T" (e.g. T003), received ` +
			`${JSON.stringify(idToken.length > 0 ? idToken : "(none)")}: ${JSON.stringify(line)}`
		);
	}
	if (!/\[(R\d+(?:,R\d+)*)\]/.test(line)) {
		return (
			`missing or empty [R#] requirement id group -- an absent group and an empty "[]" group are both ` +
			`rejected, at least one "R<digits>" entry is required: ${JSON.stringify(line)}`
		);
	}
	return `does not match the required task-line form "- [ ] T### [P] [R#,R#,...] <verb> <path>${VERIFICATION_SEPARATOR}<command>": ${JSON.stringify(line)}`;
}

export interface ParsedTask {
	readonly id: string;
	readonly parallel: boolean;
	readonly requirementIds: readonly string[];
	readonly verb: string;
	readonly path?: string;
	readonly verificationCommand?: string;
	readonly rawLine: string;
}

/** Parses one line into a ParsedTask or a `{ malformed }` diagnostic; prose yields a diagnostic rather than throwing. */
export function parseTaskLine(line: string): ParsedTask | { readonly malformed: string } {
	const match = TASK_LINE_PATTERN.exec(line);
	if (match === null) return { malformed: diagnoseMalformedLine(line) };
	const [, id = "", parallelMarker, reqGroup = "", verb = "", remainder = ""] = match;
	const sepIndex = remainder.indexOf(VERIFICATION_SEPARATOR);
	const pathPart = sepIndex === -1 ? remainder : remainder.slice(0, sepIndex);
	// The last token must itself be a path, so prose ending in "correctly!" fails.
	const lastToken = pathPart.trim().split(/\s+/).at(-1);
	const path = lastToken !== undefined && EXPECTED_FILE_PATTERN.test(lastToken) ? lastToken : undefined;
	const command = sepIndex === -1 ? "" : remainder.slice(sepIndex + VERIFICATION_SEPARATOR.length).trim();
	return {
		id,
		parallel: parallelMarker !== undefined,
		requirementIds: reqGroup.split(","),
		verb,
		...(path !== undefined ? { path } : {}),
		...(command !== "" ? { verificationCommand: command } : {}),
		rawLine: line,
	};
}

/** Scans a document for task lines. Malformed candidates are returned, never dropped; non-candidate prose is skipped. */
export function parsePlanTasks(markdown: string): { readonly tasks: readonly ParsedTask[]; readonly malformed: readonly string[] } {
	const tasks: ParsedTask[] = [];
	const malformed: string[] = [];
	for (const line of markdown.split("\n").filter((l) => CHECKBOX_LINE_PATTERN.test(l))) {
		const result = parseTaskLine(line);
		if ("malformed" in result) malformed.push(result.malformed);
		else tasks.push(result);
	}
	return { tasks, malformed };
}

/** Sorted, de-duplicated union of task paths: /review's drift baseline alongside SPEC §5 expectedFiles. */
export function filesTouchedUnion(tasks: readonly ParsedTask[]): readonly string[] {
	return [...new Set(tasks.flatMap((t) => (t.path === undefined ? [] : [t.path])))].sort();
}

/** The validated PLAN artifact; only validatePlan's accept arm constructs one. */
export interface PlanArtifact {
	readonly tasks: readonly ParsedTask[];
	readonly coverageMatrix: ReadonlyMap<string, readonly string[]>;
	readonly filesTouched: readonly string[];
}

export type PlanValidation = { readonly ok: true; readonly plan: PlanArtifact } | { readonly ok: false; readonly reason: string };

/**
 * Whole-document gate; first match wins:
 * (1) zero task lines, first so later checks cannot pass vacuously.
 * (2) a malformed candidate line, quoted verbatim with the missing element.
 * (3) duplicate T### ids.
 * (4) a task with no path, before (5) so a task missing both reports the more fundamental defect.
 * (5) a task with no verification command.
 * (6) a spec requirement cited by no task, and (7) a task citing a requirement the spec does not declare: one direction
 * catches a plan mapping everything to one task, the other a plan inventing requirements.
 */
export function validatePlan(markdown: string, specRequirementIds: readonly string[]): PlanValidation {
	const reject = (reason: string): PlanValidation => ({ ok: false, reason });
	const { tasks, malformed } = parsePlanTasks(markdown);
	if (tasks.length === 0 && malformed.length === 0) {
		return reject("no task lines found in this PLAN.md -- every stated requirement needs at least one task, and an empty task list would satisfy every later check vacuously");
	}
	if (malformed.length > 0) return reject(`this PLAN.md carries ${malformed.length} malformed task line(s): ${malformed.join(" || ")}`);

	const ids = tasks.map((t) => t.id);
	const duplicateIds = [...new Set(ids)].filter((id) => ids.indexOf(id) !== ids.lastIndexOf(id));
	if (duplicateIds.length > 0) return reject(`this PLAN.md declares duplicate task id(s): ${duplicateIds.join(", ")} -- every T### id must be unique`);

	const pathless = tasks.filter((t) => t.path === undefined).map((t) => t.id);
	if (pathless.length > 0) return reject(`task(s) ${pathless.join(", ")} carry no explicit file path -- no token in the task's text matched EXPECTED_FILE_PATTERN`);

	const commandless = tasks.filter((t) => t.verificationCommand === undefined).map((t) => t.id);
	if (commandless.length > 0) {
		return reject(`task(s) ${commandless.join(", ")} carry no verification command -- expected text following the "${VERIFICATION_SEPARATOR.trim()}" separator`);
	}

	const citedIds = new Set(tasks.flatMap((t) => t.requirementIds));
	const uncovered = specRequirementIds.filter((id) => !citedIds.has(id));
	if (uncovered.length > 0) {
		return reject(`requirement id(s) with zero citing tasks: ${uncovered.join(", ")} -- every requirement the SPEC states needs at least one task`);
	}

	const expectedIds = new Set(specRequirementIds);
	const invented = tasks.flatMap((t) => t.requirementIds.filter((id) => !expectedIds.has(id)).map((id) => `${t.id} cites ${id}`));
	if (invented.length > 0) return reject(`task(s) cite requirement id(s) the SPEC does not declare: ${invented.join(", ")}`);

	const coverageMatrix = new Map(specRequirementIds.map((id) => [id, tasks.filter((t) => t.requirementIds.includes(id)).map((t) => t.id)] as const));
	return { ok: true, plan: { tasks, coverageMatrix, filesTouched: filesTouchedUnion(tasks) } };
}

/** Renders a validated PlanArtifact as PLAN.md: task list, a literal `| Requirement | Tasks |` coverage table, the files-touched union, and a caveat. */
export function renderPlanMarkdown(plan: PlanArtifact): string {
	const taskLines = plan.tasks.map(
		(t) => `- [ ] ${t.id} ${t.parallel ? "[P] " : ""}[${t.requirementIds.join(",")}] ${t.verb} ${t.path ?? ""}${VERIFICATION_SEPARATOR} ${t.verificationCommand ?? ""}`,
	);
	const coverage = [...plan.coverageMatrix].map(([id, taskIds]) => `| ${id} | ${taskIds.join(", ")} |`);
	return [
		"# PLAN", "",
		"## Task List", "", ...taskLines, "",
		"## Coverage Matrix", "", "| Requirement | Tasks |", "| --- | --- |", ...coverage, "",
		"## Files Touched", "", ...plan.filesTouched.map((p) => `- ${p}`), "",
		"---", "",
		"*The coverage matrix above proves every stated requirement has at least one citing task. It proves nothing about " +
			"whether those tasks are SUFFICIENT to satisfy the requirement, whether the declared verification command is the " +
			"RIGHT one, or whether running it will PASS.*",
		"",
	].join("\n");
}
