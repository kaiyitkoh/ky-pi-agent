/**
 * The /plan -> PLAN.md task form and requirement-coverage matrix, machine-checked.
 * Task form: `- [ ] T### [P] [R#,...] verb <explicit path> | verify: <command>`.
 * validatePlan is a pure predicate with a binding branch order. It proves shape only: not that tasks satisfy their requirements or that the command is right (/execute and /review cover that).
 * Pure: no model call, no file read, registers nothing.
 */
import { EXPECTED_FILE_PATTERN } from "../grill/spec-schema.ts";


/** Separator between the explicit path and its verification command (`src/a.ts | verify: npm test`). No trailing space on purpose: sides are trimmed, and renderPlanMarkdown adds the rendering space itself. */
export const VERIFICATION_SEPARATOR = " | verify:";

/**
 * The task-line form, full-match anchored (no m/g flag): fixed three-digit id (`(?!d)` rejects T0001), optional [P], required non-empty [R#,...] group, a verb, a remainder.
 * Path and command are not captured here: the path is the last token before VERIFICATION_SEPARATOR and must match EXPECTED_FILE_PATTERN (imported from spec-schema.ts). The last token, not the first match, because that pattern also accepts a bare word.
 * Verb and remainder captures are bounded, with no nested unbounded quantifier, against backtracking.
 */
export const TASK_LINE_PATTERN =
	/^- \[[ xX]\] (T\d{3})(?!\d)(?: (\[P\]))? \[(R\d+(?:,R\d+)*)\] (\S{1,200}) (\S.{0,2000})$/;

/** Detects a candidate task line (checkbox prefix), looser than TASK_LINE_PATTERN, so malformed task lines are reported and ordinary prose is not. */
const CHECKBOX_LINE_PATTERN = /^- \[[ xX]\] /;

/** A bare [R#] group anywhere in a line; used only by diagnoseMalformedLine, never to accept. */
const REQUIREMENT_GROUP_PROBE_PATTERN = /\[(R\d+(?:,R\d+)*)\]/;

/** The T### id token after the checkbox, greedy over digits; used only by diagnoseMalformedLine. */
const ID_TOKEN_PROBE_PATTERN = /^- \[[ xX]\] (T\d*)/;

/** Diagnoses a candidate line that failed TASK_LINE_PATTERN, naming the specific missing element: id first, then requirement group, else a generic message with the full form. */
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


export interface ParsedTask {
	readonly id: string;
	readonly parallel: boolean;
	readonly requirementIds: readonly string[];
	readonly verb: string;
	readonly path?: string;
	readonly verificationCommand?: string;
	readonly rawLine: string;
}

/** Splits a remainder into path and command: the path is the last token before the separator and must match EXPECTED_FILE_PATTERN, so prose ending in "correctly!" fails; the command is the trimmed text after it, absent if empty. */
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

/** Parses one line into a ParsedTask or a `{ malformed }` diagnostic. Does no candidate pre-filtering; prose yields a diagnostic rather than throwing. */
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


/** Scans a document for task lines. Malformed lines are returned, never dropped, so validatePlan sees them; non-candidate prose is skipped. */
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


/** Sorted, de-duplicated union of task paths: /review's drift baseline alongside SPEC §5 expectedFiles. A task with no path contributes nothing. */
export function filesTouchedUnion(tasks: readonly ParsedTask[]): readonly string[] {
	const paths = new Set<string>();
	for (const task of tasks) {
		if (task.path !== undefined) {
			paths.add(task.path);
		}
	}
	return Array.from(paths).sort();
}


/** The validated PLAN artifact; only validatePlan's accept arm (branch 8) constructs one. */
export interface PlanArtifact {
	readonly tasks: readonly ParsedTask[];
	readonly coverageMatrix: ReadonlyMap<string, readonly string[]>;
	readonly filesTouched: readonly string[];
}

/** Two arms, never three. */
export type PlanValidation = { readonly ok: true; readonly plan: PlanArtifact } | { readonly ok: false; readonly reason: string };

/**
 * Whole-document gate; first match wins, in this binding order; every reject reason is built from the received data.
 * (1) zero task lines, first so later checks cannot pass vacuously.
 * (2) a malformed candidate line, quoted verbatim with the missing element.
 * (3) duplicate T### ids.
 * (4) a task with no path, before (5) so a task missing both reports the more fundamental defect.
 * (5) a task with no verification command.
 * (6) coverage: a spec requirement cited by no task.
 * (7) coverage: a task citing a requirement not in the spec. Both directions are needed: one catches a plan mapping everything to one task, the other a plan inventing requirements.
 * (8) accept, constructing PlanArtifact, the only place that does.
 */
export function validatePlan(markdown: string, specRequirementIds: readonly string[]): PlanValidation {
	const { tasks, malformed } = parsePlanTasks(markdown);

	if (tasks.length === 0 && malformed.length === 0) {
		return {
			ok: false,
			reason:
				"no task lines found in this PLAN.md -- every stated requirement needs at least one task, and an " +
				"empty task list would satisfy every later check vacuously",
		};
	}

	if (malformed.length > 0) {
		return {
			ok: false,
			reason: `this PLAN.md carries ${malformed.length} malformed task line(s): ${malformed.join(" || ")}`,
		};
	}

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

	const pathlessTaskIds = tasks.filter((task) => task.path === undefined).map((task) => task.id);
	if (pathlessTaskIds.length > 0) {
		return {
			ok: false,
			reason:
				`task(s) ${pathlessTaskIds.join(", ")} carry no explicit file path -- no token in the task's text ` +
				"matched EXPECTED_FILE_PATTERN",
		};
	}

	const commandlessTaskIds = tasks.filter((task) => task.verificationCommand === undefined).map((task) => task.id);
	if (commandlessTaskIds.length > 0) {
		return {
			ok: false,
			reason:
				`task(s) ${commandlessTaskIds.join(", ")} carry no verification command -- expected text following ` +
				`the "${VERIFICATION_SEPARATOR.trim()}" separator`,
		};
	}

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


/** Renders a validated PlanArtifact as PLAN.md: task list, a literal `| Requirement | Tasks |` coverage table, the files-touched union, and a caveat paragraph. Only called with validatePlan's accept output. */
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
