/**
 * The workflow line-budget registry: the single authoritative copy of every budget (docs/WORKFLOWS.md carries none).
 *
 * A line is a raw line (`split("\n").length`): it measures what ships, and any comment-stripping count is gameable.
 * WORKFLOW_BUDGETS and DIRECTORY_BUDGETS are ratchets with `budget === ceil(actual / 10) * 10`, so growth AND
 * shrinkage both require editing the number. The directory ratchet covers every subsystem a command file lives in or
 * imports, so a command cannot shrink by moving code into an unbudgeted helper. RESOURCE_EDGES budgets the
 * non-import resources (`.pi/agents/*.md`). WORKFLOW_TEXT_BUDGETS holds FEATURES.md's frozen per-workflow ceilings,
 * which the files must fit under rather than the other way round.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot, trackedFiles } from "../helpers/git.ts";

const WORKFLOWS_DIR = ".pi/extensions/workflows";
const PROMPTS_DIR = ".pi/prompts";
const SKILLS_DIR = ".pi/skills";
const EXTENSIONS_DIR = ".pi/extensions";
const AGENTS_DIR = ".pi/agents";
/** A file spelling this registers a `/command`: discovery is by content, not location. */
const COMMAND_MARKER = "registerCommand(";

const WORKFLOW_BUDGETS: readonly { file: string; budget: number; why: string }[] = [
	{
		file: ".pi/extensions/background-tasks/src/extension.ts",
		budget: 1000,
		why: "Vendored pi-background-tasks@2.6.9, process-only (/bg, /tasks, /jobs, /logs, /kill); see its PROVENANCE.md.",
	},
	{
		file: ".pi/extensions/workflows/index.ts",
		budget: 90,
		why: "/quick: git pre-flight, the quick gate stage and evidence arming, under the ROADMAP's 100-line ceiling.",
	},
	{
		file: ".pi/extensions/workflows/evidence.ts",
		budget: 250,
		why: "/quick's evidence gate: run state, tool-call capture and the ordered completion verdict.",
	},
	{
		file: ".pi/extensions/workflows/settle.ts",
		budget: 90,
		why: "/quick's change gate on base..HEAD at agent_settled, with the aborted-turn rule.",
	},
	{
		file: ".pi/extensions/routing/index.ts",
		budget: 340,
		why: "The mode-switch commands (/mode, /escalate, ...) and the routing profile wiring.",
	},
	{
		file: ".pi/extensions/harness/index.ts",
		budget: 70,
		why: "Boot-time harness commands and the load-path sentinel.",
	},
	{
		file: ".pi/extensions/diagnostics/budget.ts",
		budget: 420,
		why: "/budget: the per-session cost and per-turn floor report.",
	},
	{
		file: ".pi/extensions/checkpoint/index.ts",
		budget: 130,
		why: "/checkpoint-restore and the fork handler that pick and restore a checkpoint.",
	},
	{
		file: ".pi/extensions/loop-police/loop-police.ts",
		budget: 1310,
		why: "Vendored pi-loop-police@1.14.1, its hook keys pinned to the environment; see its PROVENANCE.md.",
	},
	{
		file: ".pi/extensions/plan-mode/index.ts",
		budget: 550,
		why: "Vendored Pi plan-mode example (/plan-mode, /plan-todos), its bash gate delegated to read-only.ts.",
	},
	{
		file: ".pi/extensions/todo.ts",
		budget: 360,
		why: "Vendored Pi todo example: the `todo` tool and /todos.",
	},
	{
		file: ".pi/extensions/grill/index.ts",
		budget: 110,
		why: "/grill: the two entry points, git pre-flight, slug resolution and the gated SPEC.md write.",
	},
	{
		file: ".pi/skills/grill/SKILL.md",
		budget: 60,
		why: "The /grill interrogation procedure, ambiguity dimensions and SPEC.md outline, as tables.",
	},
	{
		file: ".pi/extensions/plan-ceremony/index.ts",
		budget: 100,
		why: "/plan: slug resolution, the SPEC pre-flight and the gated PLAN.md write.",
	},
	{
		file: ".pi/extensions/execute/index.ts",
		budget: 210,
		why: "/execute: SPEC/PLAN revalidation, the write allowance, gate depth, the subagent probe and the PROGRESS.md settle.",
	},
	{
		file: ".pi/extensions/review/index.ts",
		budget: 160,
		why: "/review: SPEC/PLAN revalidation, the reviewer contract, refute-or-promote and the single REVIEW.md write.",
	},
	{
		file: ".pi/skills/plan-ceremony/SKILL.md",
		budget: 50,
		why: "The PLAN.md task-line grammar, coverage rule and refusal list, as tables.",
	},
];

/** Directory ratchets: every subsystem a command source lives in or imports, over its whole .ts/.js total. */
const DIRECTORY_BUDGETS: readonly { dir: string; budget: number; why: string }[] = [
	{
		dir: ".pi/extensions/background-tasks",
		budget: 10350,
		why: "Vendored pi-background-tasks@2.6.9 trimmed to the process feature; PROVENANCE.md lists every file.",
	},
	{
		dir: WORKFLOWS_DIR,
		budget: 430,
		why: "/quick's own directory: the original anti-offloading ratchet.",
	},
	{
		dir: ".pi/extensions/routing",
		budget: 1390,
		why: "Modes, profiles, agent overrides and the model guard.",
	},
	{
		dir: ".pi/extensions/harness",
		budget: 90,
		why: "The load-path sentinel and comment-rules delivery.",
	},
	{
		dir: ".pi/extensions/diagnostics",
		budget: 1820,
		why: "Turn, wire and cost logging, redaction and /budget.",
	},
	{
		dir: ".pi/extensions/checkpoint",
		budget: 550,
		why: "Checkpoint capture, the locked index, and restore with its machine-state exclusions and undo checkpoint.",
	},
	{
		dir: ".pi/extensions/loop-police",
		budget: 1330,
		why: "Vendored pi-loop-police@1.14.1 and its re-export entry.",
	},
	{
		dir: ".pi/extensions/plan-mode",
		budget: 870,
		why: "Vendored plan-mode example plus read-only.ts, the AST allowlist (a table, kept auditable) that gates bash.",
	},
	{
		dir: ".pi/extensions/safety",
		budget: 3930,
		why: "The safety guard: shell parsing, git/glab/infra policy, paths, approvals and audit; imported by /quick.",
	},
	{
		dir: ".pi/extensions/quality",
		budget: 1990,
		why: "The quality gate stage, reviewer, calibration and refute pass, called directly by /quick.",
	},
	{
		dir: ".pi/extensions/providers",
		budget: 390,
		why: "Provider registration, fallback and SSO, reached transitively from routing/.",
	},
	{
		dir: ".pi/lib",
		budget: 600,
		why: "The shared library every subsystem imports.",
	},
	{
		dir: ".pi/extensions/grill",
		budget: 730,
		why: "/grill: the SPEC schema, the ambiguity scorecard and the command.",
	},
	{
		dir: ".pi/extensions/plan-ceremony",
		budget: 300,
		why: "/plan: the PLAN schema, requirement ids and the command.",
	},
	{
		dir: ".pi/extensions/execute",
		budget: 880,
		why: "/execute: the subagent handoff, run ledger, git helpers, progress log and the command.",
	},
	{
		dir: ".pi/extensions/review",
		budget: 450,
		why: "/review: scope drift, the merge-request target and the command.",
	},
	{
		dir: ".pi/extensions/todo.ts",
		budget: 0,
		why: "A flat file resolves to itself as its 'directory', so its sibling total is structurally 0.",
	},
];

/** Raw line count, no stripping. */
function countRawLines(relPath: string): number {
	return readFileSync(join(repoRoot(), relPath), "utf-8").split("\n").length;
}

/** Every file beneath `rel` on disk; none when `rel` is a flat file standing in for a directory. */
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

/** True for a .ts/.js file that registers a command. Never throws: discovery runs at collection time. */
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

/** Every .ts/.js file anywhere beneath `dir`, tracked or on disk, whether or not it registers a command itself. */
function filesInDir(dir: string): string[] {
	const union = new Set([...trackedFiles(dir), ...walkOnDisk(dir)]);
	return Array.from(union)
		.filter((p) => p.startsWith(`${dir}/`) && /\.(ts|js)$/.test(p))
		.filter((p) => existsSync(join(repoRoot(), p)))
		.sort();
}

/**
 * Every workflow source, tracked or on disk (an uncommitted file must fail now): .ts/.js under workflows/, .md under
 * prompts/ and skills/, and any other extensions/ file that registers a command.
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
			// Existence first: isCommandSource must never read a tracked-but-deleted path.
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
				"private helper, the per-directory ratchets below are what catches that",
		).toBeLessThanOrEqual(entry.budget);
	});

	it.each(WORKFLOW_BUDGETS)("$file's budget IS the measured figure rounded up to the next ten", (entry) => {
		// toBe, not <=: a file that shrinks must lower its budget too, or the slack accumulates silently.
		const actual = countRawLines(entry.file);
		const expected = Math.ceil(actual / 10) * 10;
		expect(
			entry.budget,
			`${entry.file} is ${actual} raw lines, so its budget must be ${expected} -- the next multiple of ` +
				`ten, which is the rule every 'why' in this registry states. It is declared as ${entry.budget}. ` +
				"Update the number AND the measured figure in its `why`, in the same commit as the change that " +
				"moved it",
		).toBe(expected);
	});

	it("/quick (index.ts) never exceeds the explicit 100-line ceiling", () => {
		const actual = countRawLines(".pi/extensions/workflows/index.ts");
		expect(
			actual,
			`.pi/extensions/workflows/index.ts is ${actual} raw lines -- the ROADMAP states that ` +
				'"above 100 it has FAILED"; this explicit, greppable assertion holds it to 100, and ' +
				"a registry edit alone cannot quietly relax it",
		).toBeLessThanOrEqual(100);
	});
});

/** Resolves a relative import to a repo-relative .ts/.js file (or its index), or undefined. */
function resolveLocalImport(fromFile: string, specifier: string): string | undefined {
	const raw = resolve(dirname(join(repoRoot(), fromFile)), specifier);
	const candidates = [raw, `${raw}.ts`, `${raw}.js`, join(raw, "index.ts"), join(raw, "index.js")];
	for (const candidate of candidates) {
		if (existsSync(candidate) && statSync(candidate).isFile()) {
			return relative(repoRoot(), candidate).split("\\").join("/");
		}
	}
	return undefined;
}

/**
 * Every local `.pi/` directory reachable transitively from `commandFiles` through relative imports. An extensions/
 * hit maps to its subsystem root, any other `.pi/` hit to its own directory.
 */
function importedSubsystemDirs(commandFiles: readonly string[]): string[] {
	const dirs = new Set<string>();
	const visitedFiles = new Set<string>();
	const queue: string[] = [...commandFiles];
	while (queue.length > 0) {
		const file = queue.shift();
		if (file === undefined || visitedFiles.has(file)) continue;
		visitedFiles.add(file);
		let text: string;
		try {
			text = readFileSync(join(repoRoot(), file), "utf-8");
		} catch {
			continue;
		}
		for (const m of text.matchAll(/\bfrom\s+["'](\.\.?\/[^"']+)["']/g)) {
			const specifier = m[1];
			if (specifier === undefined) continue;
			const resolved = resolveLocalImport(file, specifier);
			if (resolved === undefined) continue;
			if (resolved.startsWith(`${EXTENSIONS_DIR}/`)) {
				dirs.add(resolved.split("/").slice(0, 3).join("/"));
			} else if (resolved.startsWith(".pi/")) {
				dirs.add(dirname(resolved));
			}
			if (!visitedFiles.has(resolved)) {
				queue.push(resolved);
			}
		}
	}
	return [...dirs];
}

/**
 * Every subsystem a command source lives in or imports is ratcheted over its whole .ts/.js total, so a large helper
 * cannot hide beside a small command file.
 */
describe("FLOW-11 / WR-03 -- directory-level anti-offloading ratchets", () => {
	const discovered = discoverWorkflowFiles();
	const commandFiles = discovered.filter(isCommandSource);
	// The subsystem root (first three segments), unioned with every directory a command source imports.
	const commandDirs = Array.from(
		new Set([...commandFiles.map((p) => p.split("/").slice(0, 3).join("/")), ...importedSubsystemDirs(commandFiles)]),
	).sort();

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

	it.each(DIRECTORY_BUDGETS)("$dir's budget IS the measured total rounded up to the next ten", (entry) => {
		const files = filesInDir(entry.dir);
		const total = files.reduce((sum, f) => sum + countRawLines(f), 0);
		const expected = Math.ceil(total / 10) * 10;
		expect(
			entry.budget,
			`${entry.dir} totals ${total} raw lines across ${files.length} files ` +
				`(${files.map((f) => `${f.split("/").pop()} ${countRawLines(f)}`).join(", ") || "none"}), so its ` +
				`budget must be ${expected}. It is declared as ${entry.budget}. Update the number AND the ` +
				"measured figure in its `why`, in the same commit as the change that moved it",
		).toBe(expected);
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
		// Planted for this test only; the describe-level discovery snapshots were taken at collection time.
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

	it(
		"CR-04 proof: commandDirs includes .pi/extensions/quality via IMPORT, even though quality/ spells " +
			"registerCommand( nowhere -- the exact discovery hole the review demonstrated",
		() => {
			expect(
				isCommandSource(".pi/extensions/quality/index.ts"),
				"quality/index.ts must NOT itself spell registerCommand( -- if it ever does, this proof is " +
					"testing the wrong mechanism (isCommandSource, not importedSubsystemDirs)",
			).toBe(false);
			expect(
				commandDirs,
				"workflows/index.ts imports runQuickGateStage from ../quality/index.ts and calls it -- " +
					"commandDirs must include .pi/extensions/quality via importedSubsystemDirs, not only via " +
					"isCommandSource, or 3,400+ lines of gate/leg logic stay invisible to every ratchet below",
			).toContain(".pi/extensions/quality");
		},
	);

	it("CR-04 proof: importedSubsystemDirs resolves a relative import to its SUBSYSTEM ROOT, not the imported file's own path", () => {
		const dirs = importedSubsystemDirs([".pi/extensions/workflows/index.ts"]);
		expect(dirs).toContain(".pi/extensions/quality");
		expect(
			dirs.some((d) => d.endsWith("index.ts")),
			"importedSubsystemDirs must resolve to the subsystem ROOT, never the imported file's own path",
		).toBe(false);
	});

	it("CR-04 proof: a package import (no leading ./ or ../) is never mistaken for a local subsystem", () => {
		const dirs = importedSubsystemDirs([".pi/extensions/workflows/index.ts"]);
		expect(dirs.some((d) => d.includes("@earendil-works") || d.includes("node_modules"))).toBe(false);
	});

	it(
		"WR2-04 proof: commandDirs includes .pi/extensions/providers via a TRANSITIVE, depth-2 import -- " +
			"routing/index.ts imports ./modes.ts directly, and modes.ts (never itself scanned by CR-04's " +
			"depth-1-only version) imports callWithFallback from ../providers/fallback.ts and CHAIN from " +
			"../providers/schema.ts",
		() => {
			expect(
				isCommandSource(".pi/extensions/providers/index.ts"),
				"providers/index.ts must NOT itself spell registerCommand( -- if it ever does, this proof is " +
					"testing the wrong mechanism (isCommandSource, not the transitive walk)",
			).toBe(false);
			expect(
				commandDirs,
				"routing/index.ts -> ./modes.ts -> ../providers/{fallback,schema}.ts is a depth-2 chain; " +
					"commandDirs must include .pi/extensions/providers via that chain, or the transitive walk " +
					"is still depth-1-only in substance even if its code LOOKS like a fixed point",
			).toContain(".pi/extensions/providers");
		},
	);

	it(
		"WR2-04 proof: commandDirs includes .pi/lib, a LOCAL directory outside .pi/extensions/ entirely -- " +
			".pi/lib/jsonl.ts is imported by (at least) routing/index.ts and safety/audit.ts",
		() => {
			expect(
				commandDirs,
				".pi/lib/jsonl.ts is a live, shared, unbudgeted import target reached from multiple command " +
					"subsystems -- commandDirs must include .pi/lib, or the `.pi/extensions/`-only filter is " +
					"still in effect even after this fix",
			).toContain(".pi/lib");
		},
	);

	it("WR2-04 proof: a hit under .pi/extensions/ still resolves to its SUBSYSTEM ROOT (slice(0,3)), never dirname, even via the transitive walk", () => {
		const dirs = importedSubsystemDirs([".pi/extensions/routing/index.ts"]);
		expect(dirs).toContain(".pi/extensions/providers");
		expect(
			dirs.some((d) => d.includes("providers/fallback") || d.includes("providers/schema")),
			"a .pi/extensions/ hit must resolve to the subsystem root, never the imported file's own path",
		).toBe(false);
	});

	it("WR2-04 proof: a hit OUTSIDE .pi/extensions/ (but still under .pi/) resolves to its own immediate directory, not a subsystem-root slice", () => {
		const dirs = importedSubsystemDirs([".pi/extensions/routing/index.ts"]);
		expect(dirs).toContain(".pi/lib");
		expect(dirs.some((d) => d === ".pi" || d === "."), "must not over-generalise to an ancestor of .pi/lib").toBe(false);
	});
});

/** Command discovery by content, checked directly against two real files. */
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

/** A tracked-but-deleted path must not throw: discovery runs at collection time, where a throw reports no tests. */
describe("WR-04 -- a path that does not exist on disk classifies as false, never throws", () => {
	it("isCommandSource returns false, does not throw, for a path with no file on disk", () => {
		expect(() => isCommandSource(".pi/extensions/does-not-exist.ts")).not.toThrow();
		expect(isCommandSource(".pi/extensions/does-not-exist.ts")).toBe(false);
	});

	it("discoverWorkflowFiles() does not throw when the union includes a nonexistent path", () => {
		expect(() => discoverWorkflowFiles()).not.toThrow();
	});
});

/** Completeness both ways: the per-file loop iterates the registry, so it cannot see a file the registry omits. */
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

/** `.pi/agents/*.md` sits under no discovered root, so each file is declared to the code that owns it. */
const RESOURCE_EDGES: readonly { workflow: string; paths: readonly string[]; budget: number; why: string }[] = [
	{
		workflow: ".pi/extensions/quality/reviewer.ts (owner)",
		paths: [".pi/agents/planner.md"],
		budget: 40,
		why: "Loaded by nothing at runtime; declared so an unreachable file still carries a budget.",
	},
	{
		workflow: ".pi/extensions/execute/handoff.ts (owner)",
		paths: [".pi/agents/executor-handoff.md"],
		budget: 20,
		why: "Loaded by nothing at runtime (exercised only by handoff-packet.test.ts); declared so it still carries a budget.",
	},
];

/** A quoted `.pi/` path literal. */
const PI_PATH_LITERAL = /["'`](\.?\/?\.pi\/[A-Za-z0-9._/-]+)["'`]/g;

/** Every file under `rel`, tracked or on disk, of any extension. */
function filesUnion(rel: string): string[] {
	const union = new Set([...trackedFiles(rel), ...walkOnDisk(rel)]);
	return Array.from(union)
		.filter((p) => p.startsWith(`${rel}/`))
		.filter((p) => existsSync(join(repoRoot(), p)))
		// .gitkeep carries no content a workflow could load.
		.filter((p) => !p.endsWith("/.gitkeep"))
		.sort();
}

/** Drops comments so a JSDoc citation of a path is not read as a resource load; regex-only, like the import walk. */
function stripComments(text: string): string {
	const BLOCK_COMMENT = new RegExp(String.raw`/\*[\s\S]*?\*/`, "g");
	const LINE_COMMENT = new RegExp(String.raw`//.*$`, "gm");
	return text.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");
}

/**
 * Non-import resource edges: every file under .pi/agents/, every non-.md file under skills/ or prompts/, and every
 * existing `.pi/` path literal in a workflow source. `.md` skill and prompt bodies are already discovered above.
 */
function resourceEdgeCandidates(): string[] {
	const out = new Set<string>();

	for (const p of filesUnion(AGENTS_DIR)) {
		out.add(p);
	}

	for (const dir of [SKILLS_DIR, PROMPTS_DIR]) {
		for (const p of filesUnion(dir)) {
			if (!p.endsWith(".md")) {
				out.add(p);
			}
		}
	}

	for (const file of discoverWorkflowFiles()) {
		let rawText: string;
		try {
			rawText = readFileSync(join(repoRoot(), file), "utf-8");
		} catch {
			continue;
		}
		const text = stripComments(rawText);
		for (const m of text.matchAll(PI_PATH_LITERAL)) {
			const literal = m[1];
			if (literal === undefined) {
				continue;
			}
			// A relative import specifier is importedSubsystemDirs' job.
			if (literal.startsWith(".") && resolveLocalImport(file, literal) !== undefined) {
				continue;
			}
			const normalized = literal.replace(/^\.\//, "");
			if (!existsSync(join(repoRoot(), normalized))) {
				continue;
			}
			out.add(normalized);
		}
	}

	return Array.from(out).sort();
}

describe("Item 1 (D-12) -- RESOURCE_EDGES: the non-import resource-edge closure", () => {
	const candidates = resourceEdgeCandidates();

	it("finds at least one resource-edge candidate (guards against a vacuous pass)", () => {
		expect(
			candidates.length,
			"resourceEdgeCandidates() found nothing -- without this guard the completeness assertion below " +
				"would pass having checked nothing. .pi/agents/planner.md and executor-handoff.md guarantee " +
				"this is >= 2 today",
		).toBeGreaterThanOrEqual(1);
	});

	it("declares at least one RESOURCE_EDGES entry (guards against a vacuous pass)", () => {
		expect(RESOURCE_EDGES.length, "RESOURCE_EDGES is empty -- the loops below would assert nothing").toBeGreaterThanOrEqual(1);
	});

	it("present-but-undeclared: every resource-edge candidate is named in some RESOURCE_EDGES row", () => {
		const declared = new Set(RESOURCE_EDGES.flatMap((e) => e.paths));
		const offenders = candidates.filter((p) => !declared.has(p));
		expect(
			offenders,
			"a .pi/ path reachable only by name (not a static import, not a discovered .md skill/prompt body) " +
				"and not declared in RESOURCE_EDGES is invisible to every budget in this repository -- declare " +
				"each of these in a RESOURCE_EDGES row with a budget and a reason",
		).toEqual([]);
	});

	it("declared-but-absent: every RESOURCE_EDGES path exists on disk", () => {
		const offenders = RESOURCE_EDGES.flatMap((e) => e.paths).filter((p) => !existsSync(join(repoRoot(), p)));
		expect(
			offenders,
			"each of these RESOURCE_EDGES paths names a file that no longer exists -- delete the stale entry " +
				"in the same commit that deleted the file",
		).toEqual([]);
	});

	it("does not re-flag a .md skill/prompt body -- Pitfall 3: that half is ALREADY closed by discoverWorkflowFiles()", () => {
		const offenders = candidates.filter((p) => p.endsWith(".md") && !p.startsWith(`${AGENTS_DIR}/`));
		expect(
			offenders,
			"a .md file under .pi/skills/ or .pi/prompts/ is already discovered and budgeted by " +
				"discoverWorkflowFiles() + WORKFLOW_BUDGETS' completeness check -- re-flagging it here would " +
				"be a second mechanism for an already-closed hole",
		).toEqual([]);
	});

	it.each(RESOURCE_EDGES)("$workflow's declared paths stay within their declared budget", (entry) => {
		const total = entry.paths.reduce((sum, p) => sum + countRawLines(p), 0);
		expect(
			total,
			`${entry.workflow}'s declared paths total ${total} raw lines, over its budget of ${entry.budget} (${entry.why})`,
		).toBeLessThanOrEqual(entry.budget);
	});

	it.each(RESOURCE_EDGES)("$workflow's budget IS the measured total rounded up to the next ten", (entry) => {
		const total = entry.paths.reduce((sum, p) => sum + countRawLines(p), 0);
		const expected = Math.ceil(total / 10) * 10;
		expect(
			entry.budget,
			`${entry.workflow}'s declared paths total ${total} raw lines, so its budget must be ${expected} -- ` +
				`the next multiple of ten. It is declared as ${entry.budget}. Update the number AND the measured ` +
				"figure in its `why`, in the same commit as the change that moved it",
		).toBe(expected);
	});
});

/** FEATURES.md Part 2's per-workflow ceilings. FROZEN: the files must fit, the numbers may not move to absorb growth. */
const FEATURES_CEILINGS: Readonly<Record<string, number>> = {
	grill: 250,
	plan: 200,
	execute: 250,
	review: 250,
	quick: 100,
};

/**
 * A workflow's command file plus its skill/prompt bodies, kept apart from DIRECTORY_BUDGETS (a closure budget would
 * charge /quick with quality, safety and diagnostics). No rounding rule: the ceiling is a spec number.
 */
const WORKFLOW_TEXT_BUDGETS: readonly {
	name: string;
	commandFile: string;
	bodies: readonly string[];
	budget: number;
	why: string;
}[] = [
	{
		name: "quick",
		commandFile: ".pi/extensions/workflows/index.ts",
		bodies: [],
		budget: 100,
		why: "FEATURES.md Part 2's harder 100-line /quick ceiling; no skill body.",
	},
	{
		name: "grill",
		commandFile: ".pi/extensions/grill/index.ts",
		bodies: [".pi/skills/grill/SKILL.md"],
		budget: 250,
		why: "FEATURES.md Part 2's /grill ceiling; supporting modules are bound by the grill directory ratchet.",
	},
	{
		name: "plan",
		commandFile: ".pi/extensions/plan-ceremony/index.ts",
		bodies: [".pi/skills/plan-ceremony/SKILL.md"],
		budget: 200,
		why: "FEATURES.md Part 2's /plan ceiling, the tightest; supporting modules are bound by the plan-ceremony directory ratchet.",
	},
	{
		name: "execute",
		commandFile: ".pi/extensions/execute/index.ts",
		bodies: [],
		budget: 250,
		why: "FEATURES.md Part 2's /execute ceiling; handoff.ts and progress.ts are bound by the execute directory ratchet.",
	},
	{
		name: "review",
		commandFile: ".pi/extensions/review/index.ts",
		bodies: [],
		budget: 250,
		why: "FEATURES.md Part 2's /review ceiling; mr.ts and scope-drift.ts are bound by the review directory ratchet.",
	},
];

describe("Item 1(d) (D-13) -- WORKFLOW_TEXT_BUDGETS: the per-workflow readable-text ceiling", () => {
	it("declares at least one entry (guards against a vacuous pass)", () => {
		expect(
			WORKFLOW_TEXT_BUDGETS.length,
			"WORKFLOW_TEXT_BUDGETS is empty -- the loops below would assert nothing",
		).toBeGreaterThanOrEqual(1);
	});

	it("FEATURES_CEILINGS has exactly the five names FEATURES.md Part 2 specifies, at their stated values", () => {
		expect(Object.keys(FEATURES_CEILINGS).sort()).toEqual(["execute", "grill", "plan", "quick", "review"]);
		expect(FEATURES_CEILINGS).toEqual({ grill: 250, plan: 200, execute: 250, review: 250, quick: 100 });
	});

	it("every FEATURES_CEILINGS name has exactly one WORKFLOW_TEXT_BUDGETS row", () => {
		for (const name of Object.keys(FEATURES_CEILINGS)) {
			const rows = WORKFLOW_TEXT_BUDGETS.filter((e) => e.name === name);
			expect(
				rows.length,
				`FEATURES_CEILINGS declares '${name}' but WORKFLOW_TEXT_BUDGETS has ${rows.length} rows for it -- add its row (exactly one)`,
			).toBe(1);
		}
	});

	it("every WORKFLOW_TEXT_BUDGETS row names a FEATURES_CEILINGS workflow", () => {
		for (const entry of WORKFLOW_TEXT_BUDGETS) {
			expect(
				Object.hasOwn(FEATURES_CEILINGS, entry.name),
				`WORKFLOW_TEXT_BUDGETS row '${entry.name}' is not in FEATURES_CEILINGS -- delete the row, or add the ceiling from FEATURES.md Part 2`,
			).toBe(true);
		}
	});

	it("quick keeps its independent 100-line ceiling", () => {
		expect(countRawLines(".pi/extensions/workflows/index.ts")).toBeLessThanOrEqual(100);
	});

	it.each(WORKFLOW_TEXT_BUDGETS)("$name's command file + declared bodies stay within its budget", (entry) => {
		const parts = [entry.commandFile, ...entry.bodies];
		const total = parts.reduce((sum, f) => sum + countRawLines(f), 0);
		expect(
			total,
			`${entry.name}'s readable text is ${total} raw lines (` +
				`${parts.map((f) => `${f} ${countRawLines(f)}`).join(", ")}), over its budget of ${entry.budget} ` +
				`(${entry.why})`,
		).toBeLessThanOrEqual(entry.budget);
	});

	it.each(WORKFLOW_TEXT_BUDGETS)("$name's budget IS the FEATURES.md ceiling -- it may not move to absorb growth", (entry) => {
		const ceiling = FEATURES_CEILINGS[entry.name];
		expect(
			entry.budget,
			`${entry.name}'s WORKFLOW_TEXT_BUDGETS budget is ${entry.budget} but FEATURES_CEILINGS['${entry.name}'] ` +
				`is ${ceiling} -- unlike WORKFLOW_BUDGETS/DIRECTORY_BUDGETS, this ceiling is not a rounded ` +
				"measurement; it is the spec number from FEATURES.md Part 2, and it MAY NOT MOVE. Over budget " +
				"means cut text, not raise the number",
		).toBe(ceiling);
	});

	it.each(WORKFLOW_TEXT_BUDGETS)("$name's commandFile exists and registers the command by name", (entry) => {
		expect(existsSync(join(repoRoot(), entry.commandFile)), `${entry.commandFile} does not exist`).toBe(true);
		const text = readFileSync(join(repoRoot(), entry.commandFile), "utf-8");
		expect(
			text.includes(`registerCommand("${entry.name}"`),
			`${entry.commandFile} does not spell registerCommand("${entry.name}" -- WORKFLOW_TEXT_BUDGETS' ` +
				"commandFile must actually register the command it claims to budget",
		).toBe(true);
	});

	it.each(WORKFLOW_TEXT_BUDGETS)("$name's declared bodies all exist on disk", (entry) => {
		const offenders = entry.bodies.filter((b) => !existsSync(join(repoRoot(), b)));
		expect(offenders, `${entry.name} declares a body that does not exist on disk`).toEqual([]);
	});

	it("claimed-bodies completeness: every discovered skill/prompt .md file is claimed by exactly one WORKFLOW_TEXT_BUDGETS row", () => {
		const skillsAndPrompts = discoverWorkflowFiles().filter(
			(p) => (p.startsWith(`${SKILLS_DIR}/`) || p.startsWith(`${PROMPTS_DIR}/`)) && p.endsWith(".md"),
		);
		for (const file of skillsAndPrompts) {
			const claimants = WORKFLOW_TEXT_BUDGETS.filter((e) => e.bodies.includes(file));
			expect(
				claimants.length,
				`${file} is a discovered skill/prompt body claimed by ${claimants.length} WORKFLOW_TEXT_BUDGETS ` +
					"rows (must be exactly 1) -- a skill body no workflow claims is text the model reads that " +
					"nothing bounds",
			).toBe(1);
		}
	});
});
