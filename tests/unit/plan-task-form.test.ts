/**
 * FLOW-06 -- the fixture-table proof for `validatePlan`/`renderPlanMarkdown`
 * (`.pi/extensions/plan-ceremony/plan-schema.ts`).
 *
 * Follows `tests/unit/git-policy.test.ts:37-59`'s table-driven fixture idiom
 * and `tests/unit/spec-error-behaviour.test.ts`'s `buildSpec`-style fixture
 * builder: each row assembles a full `PLAN.md` markdown string via
 * {@link buildPlan}, a plain string join independent of the production
 * renderer under test, so this file never becomes a tautology against its
 * own subject. Every reject case asserts on the REASON TEXT, never merely
 * `ok === false` -- a check that only inspects the boolean cannot tell
 * "rejected for the right reason" from "rejected for a coincidental one"
 * (`09-VALIDATION.md`'s own warning: "a test that cannot fail is not a
 * verification").
 *
 * FALSIFICATIONS (a)-(d) are performed by editing
 * `.pi/extensions/plan-ceremony/plan-schema.ts` IN PLACE, running this file,
 * and recording the RED output VERBATIM in `09-09-SUMMARY.md` -- committing
 * this test file BEFORE any mutation, per the 03-11 lesson ("a falsification
 * restore via `git checkout --` silently deleted uncommitted edits").
 */
import { describe, expect, it } from "vitest";

import { filesTouchedUnion, renderPlanMarkdown, validatePlan } from "../../.pi/extensions/plan-ceremony/plan-schema.ts";

// ---------------------------------------------------------------------------
// buildPlan -- a full PLAN.md markdown string, assembled from task lines
// ---------------------------------------------------------------------------

/** Assembles a full PLAN.md markdown string from a list of already-formed task lines (or none, for the empty-plan case). */
function buildPlan(taskLines: readonly string[]): string {
	return ["# PLAN", "", "## Tasks", "", ...taskLines, ""].join("\n");
}

const WELL_FORMED_TASK_1 =
	"- [ ] T001 [R1] Add refresh-token rotation to src/auth/session.ts | verify: npx vitest run tests/unit/auth-session.test.ts";
const WELL_FORMED_TASK_2 =
	"- [ ] T002 [P] [R2] Wire the session store to src/auth/store.ts | verify: npx vitest run tests/unit/auth-store.test.ts";
const WELL_FORMED_TASK_3 = "- [ ] T003 [R3] Document the refresh flow in docs/AUTH.md | verify: npx tsc --noEmit";

// ---------------------------------------------------------------------------
// The fixture table
// ---------------------------------------------------------------------------

interface Row {
	readonly name: string;
	readonly markdown: string;
	readonly specRequirementIds: readonly string[];
	readonly expectOk: boolean;
	/** Present only for reject rows -- a substring the reason MUST contain. */
	readonly reasonIncludes?: string;
	readonly why: string;
}

const ROWS: readonly Row[] = [
	{
		name: "a well-formed plan with 3 tasks covering 3 requirements (positive control)",
		markdown: buildPlan([WELL_FORMED_TASK_1, WELL_FORMED_TASK_2, WELL_FORMED_TASK_3]),
		specRequirementIds: ["R1", "R2", "R3"],
		expectOk: true,
		why: "the shape FEATURES.md itself demands, every task carrying an id, a requirement group, an explicit path and a verification command",
	},
	{
		name: "a plan with zero task lines",
		markdown: buildPlan([]),
		specRequirementIds: ["R1"],
		expectOk: false,
		reasonIncludes: "no task lines found",
		why: "branch (1) sits first because every later check would pass vacuously on an empty plan",
	},
	{
		name: "a two-digit-short task id (T1)",
		markdown: buildPlan(["- [ ] T1 [R1] Fix the bug in src/a.ts | verify: npm test"]),
		specRequirementIds: ["R1"],
		expectOk: false,
		reasonIncludes: "missing or malformed task id",
		why: "T### requires EXACTLY three digits -- T1 is malformed, not merely a different id",
	},
	{
		name: "a task line with no [R#] group at all",
		markdown: buildPlan(["- [ ] T001 Fix the bug in src/a.ts | verify: npm test"]),
		specRequirementIds: ["R1"],
		expectOk: false,
		reasonIncludes: "requirement id group",
		why: "the requirement group is REQUIRED, not optional like [P] -- an absent group is malformed",
	},
	{
		name: "a task line with an empty [] requirement group",
		markdown: buildPlan(["- [ ] T001 [] Fix the bug in src/a.ts | verify: npm test"]),
		specRequirementIds: ["R1"],
		expectOk: false,
		reasonIncludes: "requirement id group",
		why: "an empty [] group must fail the SAME way an absent group does -- both are malformed, not two different defects",
	},
	{
		name: "duplicate T003 ids on two otherwise well-formed tasks",
		markdown: buildPlan([
			"- [ ] T003 [R1] Add feature a in src/a.ts | verify: npm test",
			"- [ ] T003 [R2] Add feature b in src/b.ts | verify: npm test",
		]),
		specRequirementIds: ["R1", "R2"],
		expectOk: false,
		reasonIncludes: "duplicate task id(s): T003",
		why: "every T### id must be unique -- the reason must name the duplicated id",
	},
	{
		name: "a task with no path token (the sentence names no file at all)",
		markdown: buildPlan(["- [ ] T001 [R1] Ensure everything works correctly! | verify: npm test"]),
		specRequirementIds: ["R1"],
		expectOk: false,
		reasonIncludes: "T001",
		why: "the last word of the sentence ('correctly!') carries a character EXPECTED_FILE_PATTERN forbids, so no path is found",
	},
	{
		name: "a task whose only path-like token is a glob",
		markdown: buildPlan(["- [ ] T001 [R1] Update every handler in src/extensions/checkpoint/*.ts | verify: npm test"]),
		specRequirementIds: ["R1"],
		expectOk: false,
		reasonIncludes: "T001",
		why: "proves EXPECTED_FILE_PATTERN is genuinely REUSED, not re-declared more loosely -- a glob is rejected exactly as it is in SPEC §5",
	},
	{
		name: "a task with a path but nothing after the verification separator",
		markdown: buildPlan(["- [ ] T001 [R1] Update src/a.ts | verify:"]),
		specRequirementIds: ["R1"],
		expectOk: false,
		reasonIncludes: "no verification command",
		why: "a path with an empty command is still incomplete -- the reason must name the task and the missing element, not merely 'malformed'",
	},
	{
		name: "a requirement in the SPEC list with zero citing tasks (coverage direction one)",
		markdown: buildPlan([WELL_FORMED_TASK_1, WELL_FORMED_TASK_2]),
		specRequirementIds: ["R1", "R2", "R3"],
		expectOk: false,
		reasonIncludes: "R3",
		why: "R3 is declared by the SPEC but no task cites it -- a plan that never plans for a stated requirement must be rejected",
	},
	{
		name: "a task citing R9 when the SPEC declares only R1..R3 (coverage direction two)",
		markdown: buildPlan([
			WELL_FORMED_TASK_1,
			WELL_FORMED_TASK_2,
			// R3 is still covered here (so direction one's check does not also
			// fire) -- this row isolates direction two on its own, exactly as
			// falsification (a)/(b) below require the two to be independently
			// provable.
			"- [ ] T003 [R3,R9] Document the refresh flow in docs/AUTH.md | verify: npx tsc --noEmit",
		]),
		specRequirementIds: ["R1", "R2", "R3"],
		expectOk: false,
		reasonIncludes: "R9",
		why: "a task inventing a requirement id nobody declared is the same failure as omitting a real one -- both directions must be independently enforced",
	},
	{
		name: "a task with [P] present and a task with it absent, in the same plan",
		markdown: buildPlan([WELL_FORMED_TASK_2, WELL_FORMED_TASK_1]),
		specRequirementIds: ["R1", "R2"],
		expectOk: true,
		why:
			"[P] is OPTIONAL -- without this case, an implementation that silently made [P] REQUIRED would still pass " +
			"every other test in this file (every other well-formed fixture either always or never carries it)",
	},
	{
		name: "a completed task (checkbox marked [x]) still parses and is accepted",
		markdown: buildPlan(["- [x] T001 [R1] Add refresh-token rotation to src/auth/session.ts | verify: npm test"]),
		specRequirementIds: ["R1"],
		expectOk: true,
		why: "the checkbox's checked/unchecked state is orthogonal to the task's structural validity",
	},
];

describe("validatePlan -- FLOW-06 task-line form and coverage matrix", () => {
	it("the fixture table is non-vacuous: >= 13 rows, >= 2 accepts, >= 9 rejects", () => {
		expect(ROWS.length, "ROWS is too small for the loop below to be a meaningful proof").toBeGreaterThanOrEqual(13);
		expect(ROWS.filter((r) => r.expectOk).length).toBeGreaterThanOrEqual(2);
		expect(ROWS.filter((r) => !r.expectOk).length).toBeGreaterThanOrEqual(9);
	});

	it.each(ROWS)("$name -> $expectOk ($why)", (row) => {
		const result = validatePlan(row.markdown, row.specRequirementIds);
		expect(result.ok, `expected ok=${row.expectOk}, got ${JSON.stringify(result)}`).toBe(row.expectOk);
		if (!row.expectOk) {
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(
					result.reason.includes(row.reasonIncludes ?? ""),
					`reason "${result.reason}" must include "${row.reasonIncludes}"`,
				).toBe(true);
			}
		}
	});

	it("filesTouchedUnion de-duplicates and sorts: two tasks touching the same path yield one entry", () => {
		const markdown = buildPlan([
			"- [ ] T001 [R1] Add the lock in src/store.ts | verify: npm test",
			"- [ ] T002 [R2] Add the retry in src/store.ts | verify: npm test",
		]);
		const result = validatePlan(markdown, ["R1", "R2"]);
		expect(result.ok, `expected an accept, got ${JSON.stringify(result)}`).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.plan.filesTouched).toEqual(["src/store.ts"]);
		expect(filesTouchedUnion(result.plan.tasks)).toEqual(["src/store.ts"]);
	});

	it("round-trips: validatePlan(renderPlanMarkdown(plan), ids) accepts", () => {
		const first = validatePlan(buildPlan([WELL_FORMED_TASK_1, WELL_FORMED_TASK_2, WELL_FORMED_TASK_3]), ["R1", "R2", "R3"]);
		expect(first.ok).toBe(true);
		if (!first.ok) {
			return;
		}
		const rendered = renderPlanMarkdown(first.plan);
		const second = validatePlan(rendered, ["R1", "R2", "R3"]);
		// Proves the renderer emits the shape the validator demands, nothing more --
		// it does NOT prove the renderer reproduces every byte of the original
		// markdown, only that its OUTPUT independently passes the same gate.
		expect(second.ok, `re-validating the rendered markdown failed: ${JSON.stringify(second)}`).toBe(true);
	});
});
