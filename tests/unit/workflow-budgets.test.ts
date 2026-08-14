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
 * `DIRECTORY_BUDGETS`'s `workflows` entry is the measured total of
 * `.pi/extensions/workflows/**\/*.ts` at commit time (415 raw lines by this
 * file's own `countRawLines`, measured 2026-08-15: index.ts 79 + evidence.ts
 * 336, after iteration 3's CR-01/WR-02), rounded up to the next multiple of
 * ten. Growing the directory requires a deliberate edit to this number in the
 * SAME commit as the growth -- the same discipline `docs/RUNBOOK.md`
 * statuses already use. This is what stops `/quick` from being "shrunk" by
 * moving four hundred lines into a private helper module that only it calls.
 *
 * A future phase raises a budget by editing the number below, in the same
 * commit as the growth that needs it, with a one-line reason in `why` -- it
 * does not delete the entry, and it does not touch the ceiling test.
 *
 * WR-03 -- THE RATCHET APPLIES TO EVERY COMMAND DIRECTORY, NOT ONLY
 * `workflows/`. A per-file budget alone lets a command file stay small while
 * an unbudgeted sibling in the SAME directory grows without limit -- proved
 * by planting a 3-line `.pi/extensions/grill/index.ts` (spells
 * `registerCommand(`) beside a 1,200-line `.pi/extensions/grill/steps.ts`:
 * the file-level completeness check named only `index.ts`, and `steps.ts`
 * would have shipped unbudgeted. `DIRECTORY_BUDGETS` and
 * {@link filesInDir} close this: every directory holding a discovered
 * command source is ratcheted over its WHOLE `.ts`/`.js` total, including
 * files that do not themselves spell `registerCommand(`. `routing/`,
 * `harness/` and `diagnostics/` are grandfathered in at their CURRENT
 * measured totals -- this pass did not re-review their tightness, exactly
 * per WR-05's own precedent for their per-file entries.
 *
 * WR-01 (ITERATION 3) -- THE AGGREGATE WAS DEFEATED BY ONE SUBDIRECTORY.
 * The prior `filesInDir` excluded any path with an extra `/` segment past
 * `dir`, and `commandDirs` used the command file's IMMEDIATE PARENT rather
 * than the subsystem root -- so `.pi/extensions/workflows/helpers/big.ts`
 * (planted, 1,201 lines, no `registerCommand(`) was never summed by anything
 * at all, and a nested command file (`.pi/extensions/grill/sub/index.ts`)
 * would have ratcheted only `grill/sub`, leaving `grill/steps.ts` beside it
 * uncounted. `filesInDir` now recurses (dropping the depth filter --
 * `walkOnDisk` and `git ls-files` both already recurse); `commandDirs` now
 * maps to `p.split("/").slice(0, 3).join("/")`, the subsystem root, not the
 * immediate parent.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
		budget: 340,
		why: "CR-01 iteration 3 fix: recordCaptureFailure() so a tool_execution_end capture that throws " +
			"rejects instead of vanishing, plus the tool_execution_end docstring rewrite -- measured 336 " +
			"raw lines 2026-08-15 (up from 328), rounded up to the next ten",
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
	{
		file: ".pi/extensions/checkpoint/index.ts",
		budget: 240,
		why: "Phase 7 plan 03 (EXT-07)'s /checkpoint-restore command -- WR-05 widened discovery to catch " +
			"command surfaces outside workflows/; measured 161 raw lines 2026-08-15, rounded up to the next ten. " +
			"RAISED 170 -> 240 by the Phase 7 code-review fix pass, for four findings that all land in this " +
			"one file: WR-12 (the fork handler took the NEWEST checkpoint sharing an entry id, which for " +
			"consecutive tool-less turns is a LATER snapshot than the fork point), WR-13 (every call site " +
			"passed ctx.cwd where the callee documented a repository root), WR-14 (the stored label was a " +
			"duplicate of entryId), and WR-16 (the headless branch called ctx.ui.notify, which is Pi's " +
			"noOpUIContext `notify: () => { }` at dist/core/extensions/runner.js:92 -- it emitted nothing, " +
			"so the branch was identical to the upstream return it was presented as fixing). Each carries " +
			"the citation or the worked example that makes it checkable, which is the point. " +
			"Re-measured 229 raw lines 2026-08-15, rounded up to the next ten",
	},
	{
		file: ".pi/extensions/loop-police/loop-police.ts",
		budget: 1240,
		why: "Phase 7 plan 06 (EXT-05/EXT-10)'s vendored pi-loop-police@1.14.1, registers /loop-police -- " +
			"WR-05 widened discovery to catch command surfaces outside workflows/; this is upstream's own " +
			"size plus a short vendoring-fix comment (see .pi/extensions/loop-police/PROVENANCE.md), " +
			"measured 1237 raw lines 2026-08-15, rounded up to the next ten",
	},
	{
		file: ".pi/extensions/plan-mode/index.ts",
		budget: 500,
		why: "Phase 7 plan 07 (EXT-05/EXT-06)'s vendored Pi bundled example examples/extensions/plan-mode/index.ts, " +
			"registers /plan and /plan-todos -- WR-05 widened discovery to catch command surfaces outside " +
			"workflows/; upstream's own 390 lines plus this plan's vendoring header (the only permitted " +
			"addition -- code body otherwise unchanged apart from the /todos -> /plan-todos rename), measured " +
			"460 raw lines 2026-08-15, rounded up to the next ten. RAISED 470 -> 500 by the Phase 7 " +
			"code-review fix pass: CR-03 found the bash gate here called a first-word regex predicate that " +
			"the review defeated six ways, including an exfiltration of ~/.aws/credentials. The gate now " +
			"calls ./read-only.ts and the file carries DEVIATION 4, the vendoring record for the only " +
			"BEHAVIOURAL change ever made to this copy -- a deviation a future Pi bump must see. " +
			"Re-measured 492 raw lines 2026-08-15, rounded up to the next ten",
	},
	{
		file: ".pi/extensions/todo.ts",
		budget: 360,
		why: "Phase 7 plan 08 (EXT-05/EXT-06)'s vendored Pi bundled example examples/extensions/todo.ts, " +
			"registers the `todo` tool and /todos -- WR-05 widened discovery to catch command surfaces outside " +
			"workflows/; upstream's own 297 lines plus this plan's vendoring header (the only permitted " +
			"addition -- code body otherwise unchanged), measured 352 raw lines 2026-08-15, rounded up to the " +
			"next ten",
	},
];

/**
 * D-11 / WR-03: the directory-level anti-offloading registry. Every
 * directory that holds at least one discovered command source (per
 * {@link isCommandSource}) must appear here, ratcheted over the WHOLE
 * `.ts`/`.js` total of that directory -- see {@link filesInDir}. See the
 * module docstring's WR-03 section for the planted-`grill/` proof of why a
 * per-file budget alone is insufficient.
 */
const DIRECTORY_BUDGETS: readonly { dir: string; budget: number; why: string }[] = [
	{
		dir: WORKFLOWS_DIR,
		budget: 420,
		why: "D-11's original ratchet -- /quick's own directory; measured 415 raw lines 2026-08-15 " +
			"(index.ts 79 + evidence.ts 336) after iteration 3's CR-01/WR-02, rounded up to the next ten",
	},
	{
		dir: ".pi/extensions/routing",
		budget: 2230,
		why: "WR-03 widened the ratchet to every command directory, not only workflows/ -- measured 2224 " +
			"raw lines across 5 files 2026-08-15 (not re-reviewed for tightness, same precedent as WR-05's " +
			"per-file entries), rounded up to the next ten",
	},
	{
		dir: ".pi/extensions/harness",
		budget: 100,
		why: "WR-03; measured 99 raw lines across 1 file 2026-08-15, rounded up to the next ten",
	},
	{
		dir: ".pi/extensions/diagnostics",
		budget: 3670,
		why: "WR-03; measured 3662 raw lines across 9 files 2026-08-15 (not re-reviewed for tightness), " +
			"rounded up to the next ten",
	},
	{
		dir: ".pi/extensions/checkpoint",
		budget: 940,
		why: "Phase 7 plan 03 (EXT-07)'s vendored checkpoint extension -- git.ts and store.ts never spell " +
			"registerCommand( themselves but count toward this total per WR-03; measured 521 raw lines across " +
			"3 files 2026-08-15 (index.ts 161 + git.ts 183 + store.ts 177), rounded up to the next ten. " +
			"RAISED 530 -> 630 by the Phase 7 code-review fix pass: CR-02 found restoreCheckpoint never " +
			"deleted anything, so a restore produced the union of the checkpoint and everything made after " +
			"it. The fix adds a set-difference removal half (pathsAddedSince + an empty-directory prune) and " +
			"a topLevel() resolution closing WR-13, plus the argument for why a set difference is used " +
			"instead of git clean -- which is the part a future reader most needs and the part a budget " +
			"would otherwise pressure out. Then RAISED 630 -> 940 in the same pass for the remaining " +
			"checkpoint findings: WR-09 (recordCheckpoint was an unlocked read-modify-write over one shared " +
			"file, and git.ts explicitly designs for two concurrent checkpointers -- measured, four " +
			"overlapping processes recording 600 entries kept 55), WR-10 (an unbounded index naming commit " +
			"objects that `git gc` prunes, because commit-tree leaves them unreachable), WR-11 (readCheckpoints " +
			"cast blind, so [1,2,3] reached an `e.sha.slice()` in an event handler), WR-19 (a secret-name " +
			"exclusion pathspec applied symmetrically to both add -A call sites), and the four index.ts " +
			"findings itemised above. Re-measured 933 raw lines across 3 files 2026-08-15 (index.ts 229 + " +
			"git.ts 374 + store.ts 330), rounded up to the next ten. Two ratchet raises, both recorded with " +
			"the previous figure and the reason rather than quietly widened",
	},
	{
		dir: ".pi/extensions/loop-police",
		budget: 1270,
		why: "Phase 7 plan 06 (EXT-05/EXT-10)'s vendored pi-loop-police@1.14.1 -- index.ts never spells " +
			"registerCommand( itself (a named re-export) but counts toward this total per WR-03; measured " +
			"1260 raw lines across 2 files 2026-08-15 (index.ts 23 + loop-police.ts 1237, both including " +
			"short vendoring-fix comments), upstream's own size, not a number this phase reviewed for " +
			"tightness, rounded up to the next ten",
	},
	{
		dir: ".pi/extensions/plan-mode",
		budget: 970,
		why: "Phase 7 plan 07 (EXT-05/EXT-06)'s vendored Pi bundled example examples/extensions/plan-mode/ -- " +
			"utils.ts never spells registerCommand( itself (pure helper functions) but counts toward this " +
			"total per WR-03; measured 634 raw lines across 2 files 2026-08-15 (index.ts 460 + utils.ts 174, " +
			"upstream's own 390+168=558 lines plus this plan's vendoring headers, not a number this phase " +
			"reviewed for tightness), rounded up to the next ten. RAISED 640 -> 970 by the Phase 7 " +
			"code-review fix pass (CR-03). This is the largest single raise in this registry and it is " +
			"deliberate: the third file, read-only.ts, is the AST-based replacement for utils.ts's regex " +
			"predicate, and it is mostly TABLE -- an allowlist of read-only verbs plus per-verb argument " +
			"rules for the ones with an exec-or-write escape (find -exec, git subcommands, node -e, " +
			"curl -T, wget's default write). A table is what makes the boundary auditable; compressing it " +
			"into cleverness to satisfy a line budget is the wrong trade for a file in the tool-execution " +
			"path. This raise is the anti-offloading control working AS DESIGNED -- utils.ts shrank 174 -> " +
			"102 and the lines did not vanish, they moved, and the directory total is what says so. " +
			"Re-measured 960 raw lines across 3 files 2026-08-15 (index.ts 492 + read-only.ts 366 + " +
			"utils.ts 102), rounded up to the next ten",
	},
	{
		dir: ".pi/extensions/todo.ts",
		budget: 10,
		why: "Phase 7 plan 08's vendored todo.ts is a FLAT top-level file (`.pi/extensions/todo.ts`, not a " +
			"nested `<subsystem>/index.ts`), so its own 3-segment path already IS what " +
			"`p.split('/').slice(0,3).join('/')` resolves to -- commandDirs names the file itself as its own " +
			"'directory'. filesInDir(this literal string) looks for paths starting with " +
			"'.pi/extensions/todo.ts/', which cannot exist for a file, so the total is structurally always 0; " +
			"this entry exists only to satisfy the completeness check for that edge case, not because any " +
			"sibling file could ever be hidden beside it -- todo.ts has no siblings by construction (it is a " +
			"flat file, not a directory)",
	},
];

/** Raw line count, no stripping of any kind -- decision D-1 above. */
function countRawLines(relPath: string): number {
	return readFileSync(join(repoRoot(), relPath), "utf-8").split("\n").length;
}

/**
 * Every file beneath `rel` on disk, as repo-relative forward-slash paths.
 *
 * `rel` is not always a directory: `commandDirs`' `slice(0, 3)` resolves a
 * FLAT top-level command file (`.pi/extensions/todo.ts`, a 3-segment path)
 * to itself, so `filesInDir` can be called with a literal file path standing
 * in for a "directory" that has no children by construction. `existsSync`
 * alone does not distinguish a file from a directory -- `readdirSync` on a
 * file throws `ENOTDIR` -- so this checks `isDirectory()` explicitly and
 * returns no children for a non-directory path, which is exactly the correct
 * answer: a flat file cannot have a sibling hidden "beneath" it.
 */
function walkOnDisk(rel: string): string[] {
	const abs = join(repoRoot(), rel);
	if (!existsSync(abs) || !statSync(abs).isDirectory()) {
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

/**
 * WR-05: a `.ts`/`.js` file that spells `registerCommand(` is a command
 * surface, wherever it sits.
 *
 * WR-04: non-throwing by construction. The prior version read the file
 * BEFORE any existence check, so a path still in the git index but deleted
 * on disk threw a raw ENOENT here -- and because `discoverWorkflowFiles()`
 * runs in this file's `describe` body (collection time, not inside an `it`),
 * that throw stopped the ENTIRE file from reporting any tests at all,
 * silently disabling FLOW-11's registry, the 80-line ceiling and the
 * completeness check together. A file that cannot be read now classifies as
 * `false` rather than throwing.
 */
function isCommandSource(p: string): boolean {
	if (!/\.(ts|js)$/.test(p)) {
		return false;
	}
	try {
		return readFileSync(join(repoRoot(), p), "utf-8").includes(COMMAND_MARKER);
	} catch {
		return false;
	}
}

/**
 * WR-03/WR-01 (iteration 3): every `.ts`/`.js` file ANYWHERE beneath
 * repo-relative `dir` -- RECURSIVE, existsSync-filtered, from the SAME
 * tracked+on-disk union {@link discoverWorkflowFiles} uses -- deliberately
 * NOT limited to files that individually pass {@link isCommandSource}, so a
 * sibling helper (the planted `grill/steps.ts` shape) is counted in the
 * directory total even though it never spells `registerCommand(` itself.
 * WR-01 (iteration 3): the prior version excluded any path with an extra `/`
 * segment past `dir`, so `.pi/extensions/workflows/helpers/big.ts` was never
 * summed at all -- one `mkdir` defeated the whole ratchet. `walkOnDisk`
 * already recurses; `trackedFiles(dir)` recurses too (`git ls-files` on a
 * directory pathspec), so dropping the depth filter is the entire fix.
 */
function filesInDir(dir: string): string[] {
	const union = new Set([...trackedFiles(dir), ...walkOnDisk(dir)]);
	return Array.from(union)
		.filter((p) => p.startsWith(`${dir}/`) && /\.(ts|js)$/.test(p))
		.filter((p) => existsSync(join(repoRoot(), p)))
		.sort();
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
	return (
		Array.from(union)
			// WR-04: existence FIRST, before isCommandSource() ever reads a byte --
			// a file still in the git index but deleted on disk (`git rm --cached`,
			// or a delete not yet staged) must be dropped before any read is
			// attempted, not after. See {@link isCommandSource}'s own docstring for
			// what the prior ordering broke.
			.filter((p) => existsSync(join(repoRoot(), p)))
			.filter(
				(p) =>
					(p.startsWith(`${WORKFLOWS_DIR}/`) && /\.(ts|js)$/.test(p)) ||
					(p.startsWith(`${PROMPTS_DIR}/`) && p.endsWith(".md")) ||
					(p.startsWith(`${SKILLS_DIR}/`) && p.endsWith(".md")) ||
					(!p.startsWith(`${WORKFLOWS_DIR}/`) && p.startsWith(`${EXTENSIONS_DIR}/`) && isCommandSource(p)),
			)
			.sort()
	);
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
});

/**
 * D-11 / WR-03 -- the directory-level anti-offloading ratchets. Every
 * directory that HOLDS a discovered command source gets its own ratchet
 * over the directory's WHOLE `.ts`/`.js` total (via {@link filesInDir}) --
 * not merely the files WORKFLOW_BUDGETS happens to name individually. This
 * is what stops a large sibling helper from hiding beside a small command
 * file: the exact hole `.pi/extensions/grill/steps.ts` (planted, 1,200
 * lines, no `registerCommand(`) demonstrated beside `grill/index.ts`
 * (planted, 3 lines, spells `registerCommand(`) -- the OLD single-directory
 * (`workflows/`-only) aggregate never looked at `grill/` at all, and the
 * per-file completeness check named only `index.ts`.
 */
describe("FLOW-11 / WR-03 -- directory-level anti-offloading ratchets", () => {
	const discovered = discoverWorkflowFiles();
	// WR-01 (iteration 3): the SUBSYSTEM ROOT (`.pi/extensions/<name>`), not the
	// command file's immediate parent -- `.pi/extensions/grill/sub/index.ts`
	// must ratchet `.pi/extensions/grill`, not `.pi/extensions/grill/sub`, or a
	// command file nested one level deeper leaves its own parent uncounted.
	const commandDirs = Array.from(new Set(discovered.filter(isCommandSource).map((p) => p.split("/").slice(0, 3).join("/")))).sort();

	it("finds at least one command directory (guards against a vacuous pass)", () => {
		expect(
			commandDirs.length,
			"no directory in this repository holds a discovered command source -- without this guard every " +
				"assertion below would pass having checked nothing",
		).toBeGreaterThanOrEqual(1);
	});

	it("declares at least one directory budget entry (guards against a vacuous pass)", () => {
		expect(DIRECTORY_BUDGETS.length, "DIRECTORY_BUDGETS is empty -- the per-directory loop below would assert nothing").toBeGreaterThanOrEqual(1);
	});

	it("present-but-undeclared: every directory holding a command source has a DIRECTORY_BUDGETS entry", () => {
		const declaredDirs = DIRECTORY_BUDGETS.map((e) => e.dir);
		const offenders = commandDirs.filter((d) => !declaredDirs.includes(d));
		expect(
			offenders,
			"WR-03: a command directory with no directory-level budget can hide an unbounded sibling file " +
				"beside its command file -- add each of these to DIRECTORY_BUDGETS with a number and a reason",
		).toEqual([]);
	});

	it.each(DIRECTORY_BUDGETS)("$dir's WHOLE .ts/.js total stays within its declared directory budget", (entry) => {
		const files = filesInDir(entry.dir);
		const total = files.reduce((sum, f) => sum + countRawLines(f), 0);
		expect(
			total,
			`${entry.dir} totals ${total} raw lines across ${files.length} files, over its directory ` +
				`budget of ${entry.budget} (${entry.why}) -- this is the anti-offloading control; a file that ` +
				"does not itself spell registerCommand( still counts toward this total",
		).toBeLessThanOrEqual(entry.budget);
	});

	it("WR-03 proof: filesInDir counts a sibling file that does NOT itself spell registerCommand( (routing/modes.ts)", () => {
		const files = filesInDir(".pi/extensions/routing");
		expect(files, "routing/modes.ts must be counted in the directory total").toContain(".pi/extensions/routing/modes.ts");
		expect(
			isCommandSource(".pi/extensions/routing/modes.ts"),
			"modes.ts does not itself register a command -- this is exactly the grill/steps.ts shape: " +
				"present in the directory total, absent from isCommandSource",
		).toBe(false);
	});

	it("WR-01 (iteration 3) proof: filesInDir counts a file nested one directory DEEPER than the command file, not merely a flat sibling", () => {
		// The exact hole the reviewer demonstrated: a helper one path segment
		// deeper than any command file, which the OLD depth filter
		// (`!p.slice(dir.length + 1).includes("/")`) silently excluded from
		// every directory total. Planted for the duration of this one `it`
		// only -- discoverWorkflowFiles()'s own describe-body snapshots were
		// already taken at collection time, so this fixture cannot leak into
		// the completeness/registry checks above.
		const nestedDir = join(repoRoot(), WORKFLOWS_DIR, "wr01-probe", "nested");
		const nestedFile = join(nestedDir, "probe.ts");
		mkdirSync(nestedDir, { recursive: true });
		writeFileSync(nestedFile, "// WR-01 iteration 3 regression fixture -- never spells registerCommand(\n", "utf-8");
		try {
			const files = filesInDir(WORKFLOWS_DIR);
			expect(
				files,
				"a .ts file nested beneath a subdirectory of WORKFLOWS_DIR must be counted in the directory " +
					"total -- the OLD filter excluded anything with an extra path segment past dir",
			).toContain(`${WORKFLOWS_DIR}/wr01-probe/nested/probe.ts`);
		} finally {
			rmSync(join(repoRoot(), WORKFLOWS_DIR, "wr01-probe"), { recursive: true, force: true });
		}
	});

	it("WR-01 (iteration 3) proof: commandDirs resolves to the subsystem root, not a command file's immediate (possibly nested) parent", () => {
		// .pi/extensions/<subsystem>/index.ts -- every real command source in
		// this repository sits exactly one level below its subsystem root, so
		// slice(0, 3) already coincides with the immediate parent for every
		// EXISTING file; this assertion pins that the mechanism is the
		// subsystem root by construction, not an accident of today's flat
		// layout (a nested `.pi/extensions/grill/sub/index.ts` would resolve
		// to `.pi/extensions/grill`, per the module docstring's WR-01 section).
		expect(WORKFLOWS_DIR.split("/").slice(0, 3).join("/")).toBe(WORKFLOWS_DIR);
		expect(`${WORKFLOWS_DIR}/index.ts`.split("/").slice(0, 3).join("/")).toBe(WORKFLOWS_DIR);
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
 * WR-04 -- `isCommandSource` and `discoverWorkflowFiles()` must never throw
 * on a path that is tracked in the git index but absent on disk (a
 * `git rm --cached`, or a delete staged/unstaged). Proved directly here
 * rather than only by planting a real tracked-but-deleted file (which the
 * mutation test below does, and reverts): a raw ENOENT thrown from
 * `discoverWorkflowFiles()` -- called in every `describe` body above, i.e.
 * at collection time -- silently reports "no tests" for this entire file,
 * disabling FLOW-11's registry, the 80-line ceiling and the completeness
 * check all at once with no red test to notice.
 */
describe("WR-04 -- a path that does not exist on disk classifies as false, never throws", () => {
	it("isCommandSource returns false, does not throw, for a path with no file on disk", () => {
		expect(() => isCommandSource(".pi/extensions/does-not-exist.ts")).not.toThrow();
		expect(isCommandSource(".pi/extensions/does-not-exist.ts")).toBe(false);
	});

	it("discoverWorkflowFiles() does not throw when the union includes a nonexistent path", () => {
		expect(() => discoverWorkflowFiles()).not.toThrow();
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
