/**
 * WR-13 -- prove `tests/global-teardown.ts`'s tracked-file tripwire actually
 * fails the process EXIT CODE, not only a stderr log line.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 * The BUG-01 fix (see `04-REVIEW-FIX.md`'s ad-hoc entry) proved the tripwire's
 * LOGIC was non-vacuous by hand: dirty a tracked file, run the suite, observe
 * an `error during close` line naming the file, restore. That proof stopped
 * one step short -- it never checked the process's own exit code. Confirmed
 * by direct execution, twice, on separate runs: vitest reports a `globalSetup`
 * teardown throw as `error during close` on stderr and does NOT translate it
 * into a non-zero exit status, so the tripwire fired and `npx vitest run`
 * still exited 0. In CI, and in any `npm test && ...` chain, that is a check
 * that cannot fail the build -- decorative, not a gate. This file drives a
 * REAL, SEPARATE `npx vitest run` subprocess and asserts on its actual exit
 * code in both directions, which is the only way to prove the fix (setting
 * `process.exitCode` inside the teardown) actually closes the gap.
 *
 * ---------------------------------------------------------------------------
 * Why a dedicated probe fixture, not `CLAUDE.md` (the BUG-01 precedent)
 * ---------------------------------------------------------------------------
 * `CLAUDE.md` and `docs/RUNBOOK.md` are both read and asserted on by other
 * test files (`tests/unit/pinning.test.ts`, `tests/unit/helpers.test.ts`,
 * `tests/integration/budget.test.ts`, `tests/unit/docs-policy.test.ts`,
 * among others) that may run CONCURRENTLY with this file in the same overall
 * `vitest run` invocation. Appending to either mid-suite risks a real
 * assertion elsewhere reading half-mutated content through a race this file
 * has no way to prevent. `tests/fixtures/global-teardown-probe.txt` exists
 * for exactly one purpose (see its own docstring): nothing else in this repo
 * reads its content, so this file can safely mutate and restore it with zero
 * interference, regardless of what else vitest schedules in parallel.
 *
 * ---------------------------------------------------------------------------
 * Why the dirtying test file is written INTO the child run, not done by
 * this (parent) file directly
 * ---------------------------------------------------------------------------
 * `tests/global-teardown.ts#setup()` snapshots "modified tracked files" once,
 * before any test file in that `vitest run` invocation executes. Dirtying the
 * probe fixture from THIS (parent) process, then spawning a child `vitest
 * run`, would have the CHILD's own `setup()` see the probe already dirty at
 * its own baseline -- not "newly dirtied" during the child's run, so its
 * teardown would never fire at all. [Confirmed by direct execution while
 * authoring this test: exactly that shape produced a false negative -- exit
 * 0 with no tripwire message, for the wrong reason.] The dirtying must happen
 * AFTER the child's own `setup()` baseline is taken, i.e. from inside a test
 * file the child itself runs. `writeDirtyingProbeTest()` below writes a
 * throwaway test file under `tests/unit/` (matching this project's
 * `include: ["tests/**\/*.test.ts"]` glob so the child discovers it), the
 * child run targets ONLY that one file, and the file is deleted again in this
 * (parent) test's own `finally` -- it is untracked for its entire existence,
 * so its own creation/deletion never trips any tripwire (`??` entries are
 * excluded on both sides of the diff, per that file's own docstring).
 *
 * ---------------------------------------------------------------------------
 * Timeout budget
 * ---------------------------------------------------------------------------
 * Each case spawns one cold `npx vitest run` targeting a single small file --
 * a fresh Vite/jiti transform pipeline, not warm-cached from this (parent)
 * process. Matches this suite's own convention for real-subprocess spawns
 * (`bootstrap-safety-stub.test.ts`, `bootstrap-check-only.test.ts`) rather
 * than the default 120s-shared budget.
 */
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { commandFor } from "../helpers/win-quote.ts";

const ROOT = repoRoot();
const PROBE = join(ROOT, "tests", "fixtures", "global-teardown-probe.txt");
const PROBE_RELATIVE = "tests/fixtures/global-teardown-probe.txt";

const IS_WINDOWS = process.platform === "win32";

const TIMEOUT_MS = 120_000;

/** Absolute path of the throwaway dirtying test file, cleaned up in `afterEach`. */
const DIRTYING_TEST_PATH = join(ROOT, "tests", "unit", "zzz-wr13-dirtying-probe.test.ts");

/**
 * Write a throwaway vitest test file that appends a line to the tracked
 * probe fixture from INSIDE whatever `vitest run` invocation discovers it.
 * See this module's own docstring for why the dirtying must happen from a
 * test the CHILD process runs, not from this (parent) process before
 * spawning the child.
 */
function writeDirtyingProbeTest(): void {
	const source = [
		'import { appendFileSync } from "node:fs";',
		'import { it } from "vitest";',
		"",
		"// Generated by tests/integration/global-teardown-exit-code.test.ts.",
		"// Untracked for its entire lifetime -- created and deleted by the parent",
		"// test's own case, never committed. Its purpose is solely to dirty",
		"// tests/fixtures/global-teardown-probe.txt AFTER the child vitest run's",
		"// own global-teardown baseline has already been captured.",
		'it("WR-13 proof: dirty the tracked probe fixture mid-run", () => {',
		`\tappendFileSync(${JSON.stringify(PROBE)}, "\\n# WR-13 proof append\\n", "utf-8");`,
		"});",
		"",
	].join("\n");
	writeFileSync(DIRTYING_TEST_PATH, source, "utf-8");
}

interface ChildRun {
	status: number | null;
	stdout: string;
	stderr: string;
}

/**
 * Spawn a real, separate `npx vitest run <relativeTarget>` with `cwd` at the
 * repo root. `npx` ships as `npx.cmd` on Windows, and since the CVE-2024-27980
 * fix Node refuses to execute a `.cmd` without a shell -- `tests/helpers/pi.ts`
 * and `tests/helpers/stub-bin.ts` document and hit the exact same hazard.
 * `commandFor` (shared with those two files via `win-quote.ts`) folds argv
 * into one quoted command string on Windows and passes it through unchanged
 * on POSIX, which is the only shape `shell: true` is safe in.
 */
function runChildSuite(relativeTarget: string): ChildRun {
	const [file, argv] = commandFor("npx", ["vitest", "run", relativeTarget], IS_WINDOWS);
	const result = spawnSync(file, argv, {
		cwd: ROOT,
		encoding: "utf-8",
		shell: IS_WINDOWS,
		timeout: TIMEOUT_MS,
		windowsHide: true,
	});
	if (result.error) {
		throw new Error(`failed to spawn child \`npx vitest run ${relativeTarget}\`: ${result.error.message}`);
	}
	return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Restore the probe fixture to its committed content via `git checkout --`, exactly like this suite's other revert-after-mutate helpers. */
function restoreProbe(): void {
	const result = spawnSync("git", ["checkout", "--", PROBE_RELATIVE], {
		cwd: ROOT,
		encoding: "utf-8",
		windowsHide: true,
	});
	if (result.status !== 0) {
		throw new Error(`failed to restore ${PROBE_RELATIVE} via \`git checkout --\`: ${result.stderr}`);
	}
}

describe("WR-13 -- the global-teardown tripwire fails the real process exit code, not only the log", () => {
	afterEach(() => {
		if (existsSync(DIRTYING_TEST_PATH)) {
			rmSync(DIRTYING_TEST_PATH, { force: true });
		}
		restoreProbe();
	});

	it(
		"case 1 -- a real `npx vitest run` subprocess exits NON-ZERO when the tripwire fires",
		() => {
			writeDirtyingProbeTest();

			const run = runChildSuite("tests/unit/zzz-wr13-dirtying-probe.test.ts");

			expect(
				run.status,
				"expected a non-zero exit code once the probe fixture was dirtied mid-run, but got " +
					`${run.status}. This is exactly the WR-13 bug: the tripwire fired (see stderr) but the ` +
					`process exit code did not reflect it.\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
			).not.toBe(0);

			expect(
				run.stderr,
				"the human-readable tripwire message must still be present on stderr -- the exit-code " +
					"fix is additive, not a replacement for the diagnostic",
			).toMatch(/tests\/global-teardown\.ts: the test suite left tracked file\(s\) modified/);
			expect(run.stderr, "the specific dirtied path must be named").toContain(PROBE_RELATIVE);
		},
		TIMEOUT_MS,
	);

	it(
		"case 2 -- PAIRED NEGATIVE: a real `npx vitest run` subprocess exits ZERO on a clean tree",
		() => {
			// No dirtying test written this time -- proves the fix does not
			// degenerate into "always non-zero" / a permanently red child suite.
			const run = runChildSuite("tests/unit/shell-parse.test.ts");

			expect(
				run.status,
				`expected exit code 0 on a clean tree, got ${run.status}.\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
			).toBe(0);
			expect(
				run.stderr,
				"a clean run must carry no tripwire message at all",
			).not.toMatch(/the test suite left tracked file\(s\) modified/);
		},
		TIMEOUT_MS,
	);
});
