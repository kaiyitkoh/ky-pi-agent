/**
 * GATE-08 — the seeded-defect corpus. Six real, observed failures from THIS
 * project's own history (Phases 3-7), each built into an ISOLATED temp repo
 * clone via {@link makeTempRepo} and never applied to this repository's own
 * working tree.
 *
 * ---------------------------------------------------------------------------
 * WHY SIX, AND WHY THESE SIX
 * ---------------------------------------------------------------------------
 * A corpus of invented off-by-ones would measure the wrong thing — it is not
 * what this harness actually gets wrong. The recurring class across Phases
 * 3-7 is "tests that cannot fail": a green run that verified nothing. Every
 * fixture below is drawn from a real, dated incident named in its own
 * `incident` field, not a synthetic bug:
 *
 *   1. fabricated-evidence   — Phase 6: an evidence gate accepted a
 *      fabricated completion claim through three rounds of green tests.
 *   2. tautological-test     — Phase 5: a wire-proof test that structurally
 *      could not distinguish a routing decision from a hardcoded chain head.
 *   3. escaped-side-effect   — Phase 5: a suite writing into the developer's
 *      real `~/.pi/agent/settings.json`.
 *   4. absent-guard          — Phase 4: a guard entirely absent from the real
 *      dispatch path while its unit tests passed; exact-string matching
 *      where parsing was required.
 *   5. symptomatic-fix       — Phase 3: a "fix" that suppressed a failing
 *      assertion instead of addressing its cause.
 *   6. false-label           — Phase 7: a test labelled "MUTATION-VERIFIED"
 *      that survived its own mutation.
 *
 * ---------------------------------------------------------------------------
 * EVERY FIXTURE PASSES A GREEN TEST RUN BY CONSTRUCTION -- THAT IS THE POINT
 * ---------------------------------------------------------------------------
 * A fixture the deterministic stage (`quality/rules.ts`'s six QUAL-01 rules)
 * catches belongs in `08-02`'s rule tests, not here. `tests/integration/
 * reviewer-calibration.test.ts`'s "corpus integrity" group builds every one
 * of these six into a temp repo and asserts ZERO error-tier findings from
 * `runAntiPatternRules` over its touched files — that assertion is the proof
 * this claim is true, not merely stated.
 *
 * ---------------------------------------------------------------------------
 * THE QUAL-01 EXEMPTION, RECORDED IN BOTH DIRECTIONS
 * ---------------------------------------------------------------------------
 * `.pi/extensions/quality/rules.ts`'s `SCAN_EXEMPT_PREFIXES` names
 * `tests/fixtures/` (this directory's own parent) so that when THIS
 * repository's own source is swept, the corpus — which is, by construction,
 * made of the exact anti-pattern shapes those six rules detect — is not
 * itself flagged. This file depends on that exemption existing; deleting or
 * narrowing `SCAN_EXEMPT_PREFIXES` away from `tests/fixtures/` is a breaking
 * change to THIS corpus, not a mysterious failure discovered later. The
 * fixtures' own defect content never sits at this module's own top level —
 * every offending shape is written into files INSIDE a temp repo by
 * {@link SeededDefect.build}, so the exemption is a belt on top of an
 * already-safe design, not the only thing keeping this file green.
 *
 * ---------------------------------------------------------------------------
 * INERT ON IMPORT
 * ---------------------------------------------------------------------------
 * Importing this module performs NO file-system write. Every `build`
 * function only runs when a caller explicitly invokes it with a `repo` it
 * already created via {@link makeTempRepo} — `SEEDED_DEFECTS` holds function
 * REFERENCES, never invocations. `tests/integration/reviewer-calibration.
 * test.ts` proves this with a mocked `node:fs` that must never observe a
 * `writeFileSync`/`mkdirSync` call at import time.
 *
 * ---------------------------------------------------------------------------
 * PURITY
 * ---------------------------------------------------------------------------
 * This module touches no `ctx`, registers nothing with Pi, and makes no
 * model call — the only I/O anywhere here is `git`, invoked synchronously
 * inside a `build` function against the `repo` path the caller supplies.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

import { makeTempRepo } from "../../helpers/git.ts";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** The six defect-class ids, in the order the objective table names them. */
export const DEFECT_CLASSES = [
	"fabricated-evidence",
	"tautological-test",
	"escaped-side-effect",
	"absent-guard",
	"symptomatic-fix",
	"false-label",
] as const;

export type DefectClassId = (typeof DEFECT_CLASSES)[number];

/** What a caller needs to know to grade a reviewer's findings against this one defect. */
export interface SeededDefectExpectation {
	/** The touched file a catching finding's `location` must name. */
	readonly locationFile: string;
	/** Any one of these, appearing in a finding's `concreteFailure` or `location`, counts as a catch. Kept narrow: a generic "this looks risky" must not score. */
	readonly mustMentionAny: readonly string[];
	/** The minimum severity a catching finding must carry. */
	readonly minimumSeverity: "BLOCKER" | "WARNING";
}

/** One real, observed failure, seeded as a buildable temp-repo fixture. */
export interface SeededDefect {
	readonly id: DefectClassId;
	readonly title: string;
	/** Names the phase and the real incident this fixture is drawn from — never a synthetic description. */
	readonly incident: string;
	/** Writes and commits the defective shape into `repo` (already created via {@link makeTempRepo}), returning what was touched. */
	readonly build: (repo: string) => { readonly touchedFiles: readonly string[]; readonly diff: string };
	readonly expected: SeededDefectExpectation;
}

// ---------------------------------------------------------------------------
// git plumbing -- never hand-rolled, always asked of git (tests/helpers/git.ts's own rule)
// ---------------------------------------------------------------------------

function run(args: readonly string[], cwd: string): { stdout: string; status: number | null } {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	if (result.error) {
		throw new Error(`git ${args.join(" ")} failed to launch in "${cwd}": ${result.error.message}`);
	}
	return { stdout: result.stdout ?? "", status: result.status };
}

/**
 * Write every file in `files`, stage and commit them together in ONE commit,
 * and return the new HEAD SHA — read back via `git rev-parse HEAD`, never
 * trusted from `git commit`'s own stdout (`tests/helpers/git.ts`'s own rule).
 */
function commitFiles(repo: string, files: Readonly<Record<string, string>>, message: string): string {
	const names = Object.keys(files);
	for (const name of names) {
		const target = join(repo, name);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, files[name] ?? "", "utf-8");
	}
	for (const args of [["add", "--", ...names], ["commit", "-m", message]]) {
		const { status } = run(args, repo);
		if (status !== 0) {
			throw new Error(`git ${args.join(" ")} failed (exit ${status}) committing ${names.join(", ")} in ${repo}`);
		}
	}
	const head = run(["rev-parse", "HEAD"], repo);
	if (head.status !== 0 || head.stdout.trim() === "") {
		throw new Error(`git rev-parse HEAD failed (exit ${head.status}) in ${repo}`);
	}
	return head.stdout.trim();
}

/**
 * The well-known empty-tree object every git repository ships. Diffing
 * against it means a defect's first commit needs no separate baseline commit
 * to diff against.
 */
const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function diffAgainstEmptyTree(repo: string, headSha: string, paths: readonly string[]): string {
	const { stdout, status } = run(["diff", "--unified=0", EMPTY_TREE_SHA, headSha, "--", ...paths], repo);
	if (status !== 0) {
		throw new Error(`git diff failed (exit ${status}) for ${paths.join(", ")} in ${repo}`);
	}
	return stdout;
}

// ---------------------------------------------------------------------------
// 1. fabricated-evidence -- Phase 6
// ---------------------------------------------------------------------------

function buildFabricatedEvidence(repo: string): { touchedFiles: readonly string[]; diff: string } {
	const path = "src/evidence-claim.ts";
	const body = [
		"/**",
		" * Migration status: VERIFIED. Three consecutive full test-suite runs",
		" * confirmed this completed successfully against the production database.",
		" */",
		"export function markMigrationComplete(): { done: boolean; verifiedBy: string } {",
		'\treturn { done: true, verifiedBy: "automated test suite" };',
		"}",
		"",
	].join("\n");
	const head = commitFiles(repo, { [path]: body }, "seed: fabricated-evidence");
	return { touchedFiles: [path], diff: diffAgainstEmptyTree(repo, head, [path]) };
}

// ---------------------------------------------------------------------------
// 2. tautological-test -- Phase 5
// ---------------------------------------------------------------------------

function buildTautologicalTest(repo: string): { touchedFiles: readonly string[]; diff: string } {
	const path = "src/router-wire-proof.test.ts";
	const body = [
		'import { describe, expect, it } from "vitest";',
		"",
		"// Stands in for calling the real routing decision function.",
		"function currentChainHead(): string {",
		'\treturn "primary-provider";',
		"}",
		"",
		'describe("routing decision", () => {',
		'\tit("proves the chosen provider matches the configured chain head", () => {',
		"\t\tconst configuredHead = currentChainHead();",
		"\t\tconst decision = configuredHead;",
		"\t\texpect(decision).toBe(configuredHead);",
		"\t});",
		"});",
		"",
	].join("\n");
	const head = commitFiles(repo, { [path]: body }, "seed: tautological-test");
	return { touchedFiles: [path], diff: diffAgainstEmptyTree(repo, head, [path]) };
}

// ---------------------------------------------------------------------------
// 3. escaped-side-effect -- Phase 5
// ---------------------------------------------------------------------------

function buildEscapedSideEffect(repo: string): { touchedFiles: readonly string[]; diff: string } {
	const path = "tests/settings-persistence.test.ts";
	const body = [
		'import { writeFileSync } from "node:fs";',
		'import { homedir } from "node:os";',
		'import { join } from "node:path";',
		'import { describe, expect, it } from "vitest";',
		"",
		'describe("settings persistence", () => {',
		'\tit("writes the updated mode into the user\'s global settings file", () => {',
		'\t\tconst target = join(homedir(), ".pi", "agent", "settings.json");',
		'\t\twriteFileSync(target, JSON.stringify({ mode: "balanced" }));',
		"\t\texpect(true).toBe(true);",
		"\t});",
		"});",
		"",
	].join("\n");
	const head = commitFiles(repo, { [path]: body }, "seed: escaped-side-effect");
	return { touchedFiles: [path], diff: diffAgainstEmptyTree(repo, head, [path]) };
}

// ---------------------------------------------------------------------------
// 4. absent-guard -- Phase 4
// ---------------------------------------------------------------------------

function buildAbsentGuard(repo: string): { touchedFiles: readonly string[]; diff: string } {
	const guardPath = "src/guard-tested.ts";
	const guardBody = [
		"/** Unit-tested in isolation -- never wired into the real dispatch path below. */",
		"export function isGuardedCommand(command: string): boolean {",
		'\treturn command.startsWith("git push");',
		"}",
		"",
	].join("\n");
	const dispatchPath = "src/dispatch-real.ts";
	const dispatchBody = [
		'import { execSync } from "node:child_process";',
		"",
		"export function dispatchCommand(command: string): void {",
		"\texecSync(command);",
		"}",
		"",
	].join("\n");
	const paths = [guardPath, dispatchPath];
	const head = commitFiles(repo, { [guardPath]: guardBody, [dispatchPath]: dispatchBody }, "seed: absent-guard");
	return { touchedFiles: paths, diff: diffAgainstEmptyTree(repo, head, paths) };
}

// ---------------------------------------------------------------------------
// 5. symptomatic-fix -- Phase 3
// ---------------------------------------------------------------------------

function buildSymptomaticFix(repo: string): { touchedFiles: readonly string[]; diff: string } {
	const path = "src/rate-limiter.ts";
	const body = [
		"// Loosened the window check after the assertion started failing under load,",
		"// rather than fixing the counter overflow that was causing it.",
		"export function isWithinRateLimit(count: number, windowStart: number, now: number): boolean {",
		"\treturn true;",
		"}",
		"",
	].join("\n");
	const head = commitFiles(repo, { [path]: body }, "seed: symptomatic-fix");
	return { touchedFiles: [path], diff: diffAgainstEmptyTree(repo, head, [path]) };
}

// ---------------------------------------------------------------------------
// 6. false-label -- Phase 7
// ---------------------------------------------------------------------------

function buildFalseLabel(repo: string): { touchedFiles: readonly string[]; diff: string } {
	const sourcePath = "src/parser-mutation-claim.ts";
	const sourceBody = ["export function parseCommand(command: string): boolean {", "\treturn true;", "}", ""].join(
		"\n",
	);
	const testPath = "src/parser-mutation-claim.test.ts";
	const testBody = [
		'import { describe, expect, it } from "vitest";',
		'import { parseCommand } from "./parser-mutation-claim.ts";',
		"",
		"// MUTATION-VERIFIED: this test was confirmed to fail when parseCommand's",
		"// guarded-verb check is removed.",
		'describe("parseCommand", () => {',
		'\tit("rejects a disguised git push", () => {',
		'\t\texpect(parseCommand("git push")).toBe(true);',
		"\t});",
		"});",
		"",
	].join("\n");
	const paths = [sourcePath, testPath];
	const head = commitFiles(repo, { [sourcePath]: sourceBody, [testPath]: testBody }, "seed: false-label");
	return { touchedFiles: paths, diff: diffAgainstEmptyTree(repo, head, paths) };
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

export const SEEDED_DEFECTS: readonly SeededDefect[] = [
	{
		id: "fabricated-evidence",
		title: "A completion claim with no matching structured result",
		incident:
			"Phase 6: an evidence gate accepted a fabricated completion claim through three rounds of green tests.",
		build: buildFabricatedEvidence,
		expected: {
			locationFile: "src/evidence-claim.ts",
			mustMentionAny: ["markMigrationComplete"],
			minimumSeverity: "BLOCKER",
		},
	},
	{
		id: "tautological-test",
		title: "A test that passes identically whether the subject exists or not",
		incident:
			"Phase 5: a wire-proof test structurally could not distinguish a routing decision from a hardcoded chain head.",
		build: buildTautologicalTest,
		expected: {
			locationFile: "src/router-wire-proof.test.ts",
			mustMentionAny: ["configuredHead"],
			minimumSeverity: "BLOCKER",
		},
	},
	{
		id: "escaped-side-effect",
		title: "A test writing outside the repo/temp dir",
		incident: "Phase 5: a suite wrote into the developer's real ~/.pi/agent/settings.json.",
		build: buildEscapedSideEffect,
		expected: {
			locationFile: "tests/settings-persistence.test.ts",
			mustMentionAny: ["homedir()"],
			minimumSeverity: "BLOCKER",
		},
	},
	{
		id: "absent-guard",
		title: "A guard unit-tested in isolation, never wired into the real dispatch path",
		incident:
			"Phase 4: a guard was entirely absent from the real dispatch path headless while its own unit tests passed; exact-string matching stood in for parsing.",
		build: buildAbsentGuard,
		expected: {
			locationFile: "src/dispatch-real.ts",
			mustMentionAny: ["isGuardedCommand"],
			minimumSeverity: "BLOCKER",
		},
	},
	{
		id: "symptomatic-fix",
		title: "A change that suppresses a failing assertion instead of addressing its cause",
		incident: "Phase 3: three \"fixes\" to tautological tests were themselves tautological.",
		build: buildSymptomaticFix,
		expected: {
			locationFile: "src/rate-limiter.ts",
			mustMentionAny: ["isWithinRateLimit"],
			minimumSeverity: "BLOCKER",
		},
	},
	{
		id: "false-label",
		title: "A label asserting a property the code does not have",
		incident: 'Phase 7: a test labelled "MUTATION-VERIFIED" survived its own mutation.',
		build: buildFalseLabel,
		expected: {
			locationFile: "src/parser-mutation-claim.test.ts",
			mustMentionAny: ["MUTATION-VERIFIED"],
			minimumSeverity: "BLOCKER",
		},
	},
];
