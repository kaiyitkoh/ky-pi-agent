/**
 * FLOW-11 -- the workflow line-budget registry, and the mechanism that
 * protects Phase 9 from itself (ROADMAP.md). GSD's own no-ceremony
 * `quick.md` is 1,169 lines (~15k tokens); Phase 9 adds `/grill`, `/plan`,
 * `/execute` and `/review`. This test is the only thing standing between
 * Phase 9 and that outcome, and it is worthless unless it also fails on a
 * workflow file it was never told about -- see the completeness describe
 * block below.
 *
 * A LINE MEANS A RAW LINE -- `readFileSync(f, "utf-8").split("\n").length`.
 * No comment stripping, no blank-line stripping, no parsing (decision D-1,
 * `docs/WORKFLOWS.md` section 3). Two reasons, not one:
 *   (a) a comment-excluding count measures a different artifact than the one
 *       that ships -- a heavily commented file could pass a "non-comment
 *       lines" budget while staying exactly as long to actually read;
 *   (b) any comment-excluding counter is a heuristic (string literals
 *       containing `//`, block comments, JSX-like text) and every heuristic
 *       is more gameable by reformatting than a raw count.
 *
 * D-8 -- THIS FILE IS THE SINGLE AUTHORITATIVE REGISTRY. `docs/WORKFLOWS.md`
 * deliberately carries no budget numbers of its own -- one copy of the
 * numbers, in the artifact that enforces them, rather than a doc table and a
 * test that can silently drift apart (this repo has been bitten by exactly
 * that twice already).
 *
 * D-11 -- THE DIRECTORY AGGREGATE IS A RATCHET WITH NO HEADROOM.
 * `WORKFLOWS_DIR_TOTAL_BUDGET` is the measured total of
 * `.pi/extensions/workflows/**\/*.ts` at commit time (353 raw lines by this
 * file's own `countRawLines`, measured 2026-08-14: 74 + 279), rounded up to
 * the next multiple of ten.
 * Growing the directory requires a deliberate edit to this number in the
 * SAME commit as the growth -- the same discipline `docs/RUNBOOK.md`
 * statuses already use. This is what stops `/quick` from being "shrunk" by
 * moving four hundred lines into a private helper module that only it calls.
 *
 * A future phase raises a budget by editing the number below, in the same
 * commit as the growth that needs it, with a one-line reason in `why` -- it
 * does not delete the entry, and it does not touch the ceiling test.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot, trackedFiles } from "../helpers/git.ts";

const WORKFLOWS_DIR = ".pi/extensions/workflows";
const PROMPTS_DIR = ".pi/prompts";
const SKILLS_DIR = ".pi/skills";
/** WR-05: every command surface can hide outside `workflows/` too -- see {@link isCommandSource}. */
const EXTENSIONS_DIR = ".pi/extensions";
/** A file containing this text registers a `/command` directly -- WR-05's "what a file IS, not where it sits". */
const COMMAND_MARKER = "registerCommand(";

/**
 * The single authoritative registry (D-8). Raising a number here is a
 * visible, reviewable diff with a mandatory `why` -- it is never a silent
 * relaxation, and it never deletes a prior entry.
 */
const WORKFLOW_BUDGETS: readonly { file: string; budget: number; why: string }[] = [
	{ file: ".pi/extensions/workflows/index.ts", budget: 80, why: "FLOW-01 -- the ROADMAP's /quick raw-line ceiling" },
	{
		file: ".pi/extensions/workflows/evidence.ts",
		budget: 300,
		why: "CR-01 fix (baseSha param + no-commit branch) plus WR-03's armedCwd() export -- measured 298 " +
			"raw lines 2026-08-14 (up from 279), rounded up to the next ten",
	},
	// WR-05: these three are NOT under workflows/ -- discovered because they contain
	// COMMAND_MARKER (isCommandSource). Declared here so the completeness check
	// below stays green; each keeps its OWN prior phase's size as its budget, not
	// a number this phase re-reviewed for tightness.
	{
		file: ".pi/extensions/routing/index.ts",
		budget: 690,
		why: "Phase 5's mode-switch commands (/mode, /escalate, ...) -- WR-05 widened discovery to catch command surfaces outside workflows/; measured 681 raw lines 2026-08-14, rounded up to the next ten",
	},
	{
		file: ".pi/extensions/harness/index.ts",
		budget: 100,
		why: "boot-phase harness commands -- WR-05 widened discovery to catch command surfaces outside workflows/; measured 99 raw lines 2026-08-14, rounded up to the next ten",
	},
	{
		file: ".pi/extensions/diagnostics/budget.ts",
		budget: 710,
		why: "Phase 2's /budget command -- WR-05 widened discovery to catch command surfaces outside workflows/; measured 703 raw lines 2026-08-14, rounded up to the next ten",
	},
];

/**
 * D-11's ratchet: measured total of `.pi/extensions/workflows/**\/*.ts` was
 * 375 raw lines on 2026-08-14 (77 + 298, by `countRawLines`) after CR-01/
 * WR-01/WR-02/WR-03, rounded up to the next multiple of ten.
 */
const WORKFLOWS_DIR_TOTAL_BUDGET = 380;

/** Raw line count, no stripping of any kind -- decision D-1 above. */
function countRawLines(relPath: string): number {
	return readFileSync(join(repoRoot(), relPath), "utf-8").split("\n").length;
}

/** Every file beneath `rel` on disk, as repo-relative forward-slash paths. */
function walkOnDisk(rel: string): string[] {
	const abs = join(repoRoot(), rel);
	if (!existsSync(abs)) {
		return [];
	}
	const out: string[] = [];
	for (const entry of readdirSync(abs, { withFileTypes: true })) {
		const child = `${rel}/${entry.name}`;
		if (entry.isDirectory()) {
			out.push(...walkOnDisk(child));
		} else {
			out.push(child);
		}
	}
	return out;
}

/** WR-05: a `.ts`/`.js` file that spells `registerCommand(` is a command surface, wherever it sits. */
function isCommandSource(p: string): boolean {
	return /\.(ts|js)$/.test(p) && readFileSync(join(repoRoot(), p), "utf-8").includes(COMMAND_MARKER);
}

/**
 * Union of the git index and the working tree (decision D-9): a 1,169-line
 * workflow file that is on disk but not yet committed must fail NOW, not at
 * the moment someone runs `git commit`. Filtered to `.ts`/`.js` under
 * `workflows/`, exactly `.md` under `prompts/`/`skills/` (decision D-10 --
 * Pi has exactly three ways a workflow can be authored: extension, prompt
 * template, skill), and -- WR-05 -- any OTHER `.ts`/`.js` under
 * `.pi/extensions/` that spells `registerCommand(` directly: discovery by
 * WHAT a file is, not by WHERE it sits, so a command surface added as a
 * sibling subsystem directory (Phase 9's `/grill`, `/plan`, `/execute`,
 * `/review` as `.pi/extensions/grill/index.ts` and friends) cannot land
 * unbudgeted just because it never touched `workflows/`.
 */
function discoverWorkflowFiles(): string[] {
	const tracked = [
		...trackedFiles(WORKFLOWS_DIR),
		...trackedFiles(PROMPTS_DIR),
		...trackedFiles(SKILLS_DIR),
		...trackedFiles(EXTENSIONS_DIR),
	];
	const onDisk = [
		...walkOnDisk(WORKFLOWS_DIR),
		...walkOnDisk(PROMPTS_DIR),
		...walkOnDisk(SKILLS_DIR),
		...walkOnDisk(EXTENSIONS_DIR),
	];
	const union = new Set([...tracked, ...onDisk]);
	return Array.from(union)
		.filter(
			(p) =>
				(p.startsWith(`${WORKFLOWS_DIR}/`) && /\.(ts|js)$/.test(p)) ||
				(p.startsWith(`${PROMPTS_DIR}/`) && p.endsWith(".md")) ||
				(p.startsWith(`${SKILLS_DIR}/`) && p.endsWith(".md")) ||
				(!p.startsWith(`${WORKFLOWS_DIR}/`) && p.startsWith(`${EXTENSIONS_DIR}/`) && isCommandSource(p)),
		)
		// IN-02: a file still in the git index but deleted on disk (`git rm
		// --cached`, or a delete not yet staged) must not crash the aggregate
		// below with a raw ENOENT -- drop it here instead.
		.filter((p) => existsSync(join(repoRoot(), p)))
		.sort();
}

describe("FLOW-11 -- workflow line budgets enforce, both directions", () => {
	const discovered = discoverWorkflowFiles();

	it("finds at least one workflow file (guards against a vacuous pass)", () => {
		expect(
			discovered.length,
			"discoverWorkflowFiles() found nothing under .pi/extensions/workflows, .pi/prompts or " +
				".pi/skills -- without this guard every assertion below would pass having checked nothing",
		).toBeGreaterThanOrEqual(1);
	});

	it("declares at least one budget entry (guards against a vacuous pass)", () => {
		expect(
			WORKFLOW_BUDGETS.length,
			"WORKFLOW_BUDGETS is empty -- without this guard the per-file loop below would iterate " +
				"nothing and pass having asserted nothing",
		).toBeGreaterThanOrEqual(1);
	});

	it.each(WORKFLOW_BUDGETS)("$file stays within its declared budget", (entry) => {
		const actual = countRawLines(entry.file);
		expect(
			actual,
			`${entry.file} is ${actual} raw lines, over its budget of ${entry.budget} (${entry.why}) -- ` +
				"shorten the file, or raise the budget here with a reason -- do not move lines into a " +
				"private helper, the directory aggregate below is what catches that",
		).toBeLessThanOrEqual(entry.budget);
	});

	it("/quick (index.ts) never exceeds the explicit 80-line ceiling", () => {
		const actual = countRawLines(".pi/extensions/workflows/index.ts");
		expect(
			actual,
			`.pi/extensions/workflows/index.ts is ${actual} raw lines -- the ROADMAP states that ` +
				'"above 100 it has FAILED"; this explicit, greppable assertion holds it to 80, well ' +
				"under that failure line, and a registry edit alone cannot quietly relax it",
		).toBeLessThanOrEqual(80);
	});

	it("the workflows/ directory total never exceeds its ratchet aggregate", () => {
		const workflowTsFiles = discovered.filter((p) => p.startsWith(`${WORKFLOWS_DIR}/`) && /\.(ts|js)$/.test(p));
		const total = workflowTsFiles.reduce((sum, f) => sum + countRawLines(f), 0);
		expect(
			total,
			`decision D-11: .pi/extensions/workflows/**/*.ts totals ${total} raw lines against a ` +
				`ratchet of ${WORKFLOWS_DIR_TOTAL_BUDGET} -- this is the anti-offloading control; ` +
				"shrinking one file by moving its lines into a private helper under the same directory " +
				"does not pass here",
		).toBeLessThanOrEqual(WORKFLOWS_DIR_TOTAL_BUDGET);
	});
});

/**
 * WR-05 -- `isCommandSource` is the predicate that lets discovery see a
 * command surface OUTSIDE `workflows/`. Tested directly against two real
 * files already in this repository, rather than only indirectly through
 * `discoverWorkflowFiles()`'s completeness check -- which cannot itself
 * distinguish "the predicate works" from "every file it would have caught is
 * already declared", since this commit declares all three it finds.
 */
describe("WR-05 -- isCommandSource discovers a command surface by content, not by location", () => {
	it("is true for a real file outside workflows/ that spells registerCommand( (routing/index.ts)", () => {
		expect(
			isCommandSource(".pi/extensions/routing/index.ts"),
			"routing/index.ts registers /mode and /escalate -- WR-05's whole point is that this must be " +
				"discoverable even though it is not under workflows/",
		).toBe(true);
	});

	it("is false for a real .ts file that does NOT spell registerCommand( (evidence.ts, by its own boundary rule)", () => {
		expect(
			isCommandSource(".pi/extensions/workflows/evidence.ts"),
			"evidence.ts's own module docstring says it registers nothing and does not spell the " +
				"registration call even in prose -- isCommandSource must not false-positive on it",
		).toBe(false);
	});
});

/**
 * Registry completeness, both directions -- neither folded into the per-file
 * loop above, which iterates the registry and therefore cannot see a file
 * the registry omits. That omission is exactly the Phase 9 failure this
 * requirement exists to prevent: GSD's own `quick.md` is 1,169 lines, and a
 * registry that only checks what it already knows about would let a file
 * that size land unbudgeted.
 */
describe("FLOW-11 -- registry completeness, both directions", () => {
	const discovered = discoverWorkflowFiles();
	const declaredFiles = WORKFLOW_BUDGETS.map((e) => e.file);

	it("present-but-undeclared: every discovered workflow file has a budget entry", () => {
		const offenders = discovered.filter((p) => !declaredFiles.includes(p));
		expect(
			offenders,
			"a workflow file with no budget is a workflow with no budget -- add each of these to " +
				"WORKFLOW_BUDGETS with a number and a reason. This is the direction that stops a future " +
				"phase from shipping a workflow the size of GSD's own quick.md (1,169 raw lines) without " +
				"this registry ever noticing",
		).toEqual([]);
	});

	it("declared-but-absent: every WORKFLOW_BUDGETS entry names a file that still exists", () => {
		const offenders = WORKFLOW_BUDGETS.filter((e) => !existsSync(join(repoRoot(), e.file))).map((e) => e.file);
		expect(
			offenders,
			"each of these registry entries names a file that no longer exists on disk -- the entry is " +
				"stale; delete it in the same commit that deleted the file",
		).toEqual([]);
	});
});
