/**
 * SAFE-04 — the `currentBranch` HEAD oracle proven against a REAL, MUTABLE
 * disposable git checkout, in both directions.
 *
 * WHY THIS IS AN INTEGRATION TEST AND NOT A UNIT ONE. `tests/unit/git-policy.test.ts`
 * proves the pure classifier half against fixture facts; nothing there proves
 * that `currentBranch(cwd)` actually reads a real repository correctly. No
 * existing helper in this repo drives a real, MUTABLE git checkout as its
 * subject -- `tests/helpers/git.ts`'s `repoRoot()`/`isIgnored()`/`trackedFiles()`
 * only ask git ABOUT this repository -- so this file is new composition of
 * `tests/helpers/git.ts`'s `spawnSync({shell:false})` pattern against a
 * disposable fixture repo, never against `repoRoot()`.
 *
 * THE FIXTURE. `mkdtempSync` OUTSIDE this repository, `git init`, a local
 * `user.email`/`user.name` (so a commit succeeds on a machine with no global
 * git identity configured), one committed file, and the initial branch name
 * forced to `main` EXPLICITLY (`git init -b main`, falling back to
 * `git symbolic-ref HEAD refs/heads/main` before the first commit on an older
 * git that lacks `-b`) -- never relying on this machine's `init.defaultBranch`,
 * per the plan's explicit warning: relying on it would make this test assert a
 * local git config rather than the oracle it claims to prove.
 *
 * THE PAIRED FLIP (cases 1+2). `currentBranch` returning `"main"` on a fixture
 * that has never been anything else would be a restatement of the fixture, not
 * a measurement of the oracle. The SAME repository is checked out onto
 * `feature/x` and re-queried, so the assertion is genuinely "this function
 * tracks a REAL change in HEAD", not "this function returns a hardcoded string".
 *
 * NEVER `it.skip`. If `git` is missing from PATH every case below throws with
 * the git error text as its own remedy -- consistent with the "real subprocess,
 * never skip" rule restated across `tests/helpers/{pi,session,models}.ts`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { classifyGitInvocation, currentBranch, DETACHED_HEAD, type GitPolicyFacts } from "../../.pi/extensions/safety/git.ts";

function facts(currentBranch: string): GitPolicyFacts {
	return { currentBranch, protectedBranches: ["main", "master"] };
}

/** One git invocation against `cwd`, real subprocess, never a mock. */
function git(args: string[], cwd: string): { stdout: string; stderr: string; status: number | null } {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	if (result.error) {
		throw new Error(`git ${args.join(" ")} failed to launch in "${cwd}": ${result.error.message}`);
	}
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

function requireOk(result: { status: number | null; stderr: string }, description: string): void {
	if (result.status !== 0) {
		throw new Error(`${description} failed (exit ${result.status}): ${result.stderr}`);
	}
}

/**
 * A disposable, committed repository whose initial branch is EXPLICITLY
 * `main` -- never `init.defaultBranch`. Local identity is set so the commit
 * succeeds regardless of this machine's global git config.
 */
function makeCommittedRepo(dir: string): void {
	const initWithB = git(["init", "-b", "main"], dir);
	if (initWithB.status !== 0) {
		// Older git without `-b` on `init`: init plainly, then force the branch
		// name before the first commit exists, per the plan's explicit warning
		// against trusting init.defaultBranch.
		requireOk(git(["init"], dir), "git init");
		requireOk(git(["symbolic-ref", "HEAD", "refs/heads/main"], dir), "git symbolic-ref HEAD refs/heads/main");
	}

	requireOk(git(["config", "user.email", "kypi-fixture@example.invalid"], dir), "git config user.email");
	requireOk(git(["config", "user.name", "kypi fixture"], dir), "git config user.name");

	writeFileSync(join(dir, "README.md"), "kypi-fixture\n", "utf-8");
	requireOk(git(["add", "README.md"], dir), "git add README.md");
	requireOk(git(["commit", "-m", "initial"], dir), "git commit -m initial");
}

describe("SAFE-04 — currentBranch, proven against real disposable checkouts", () => {
	let base: string;
	let repoA: string;
	let repoB: string;
	let worktreeParent: string;

	beforeAll(() => {
		base = mkdtempSync(join(tmpdir(), "kypi-git-head-"));
		repoA = join(base, "repo-a");
		repoB = join(base, "repo-b");
		worktreeParent = join(base, "worktree-parent");

		// mkdtempSync creates `base`; the three subdirectories below it must
		// exist before git/worktree commands target them.
		mkdirSync(repoA, { recursive: true });
		mkdirSync(repoB, { recursive: true });
		mkdirSync(worktreeParent, { recursive: true });
	});

	afterAll(() => {
		// Windows-handle convention (tests/integration/jsonl-concurrency.test.ts):
		// force + retry, since a worktree/git-daemon file handle can linger
		// briefly after the process that held it exits.
		rmSync(base, { recursive: true, force: true, maxRetries: 3 });
	});

	it("case 1 — on main, currentBranch(repoA) returns \"main\", and git push is BLOCKED", () => {
		makeCommittedRepo(repoA);

		const branch = currentBranch(repoA);
		expect(branch, "a freshly initialised fixture forced onto main must report main, not init.defaultBranch's answer").toBe(
			"main",
		);

		const verdict = classifyGitInvocation({ subcommand: "push", args: ["origin", "HEAD:feature/x"] }, facts(branch));
		expect(verdict.kind, "HEAD is main (protected) and push is a write -- must block").toBe("block");
	});

	it("case 2 — the SAME fixture, checked out onto feature/x, flips currentBranch AND the push verdict", () => {
		requireOk(git(["checkout", "-b", "feature/x"], repoA), "git checkout -b feature/x");

		const branch = currentBranch(repoA);
		expect(
			branch,
			"case 1 already proved this same fixture reports \"main\" -- a different answer here means the " +
				"oracle tracks a REAL change in HEAD, not a hardcoded string",
		).toBe("feature/x");

		const verdict = classifyGitInvocation({ subcommand: "push", args: ["origin", "HEAD:feature/x"] }, facts(branch));
		expect(
			verdict.kind,
			"the SAME push invocation that blocked on main must now allow -- the rule is about the checked-out " +
				"branch, not about the word \"main\" appearing anywhere",
		).toBe("allow");
	});

	it("case 3 — detached HEAD reports the distinct DETACHED_HEAD sentinel, and the classifier treats it as not-protected", () => {
		const rev = git(["rev-parse", "HEAD"], repoA);
		requireOk(rev, "git rev-parse HEAD");
		const sha = rev.stdout.trim();
		expect(sha.length, "git rev-parse HEAD returned no sha to detach onto").toBeGreaterThan(0);

		requireOk(git(["checkout", sha], repoA), `git checkout ${sha}`);

		const branch = currentBranch(repoA);
		expect(
			branch,
			"detached HEAD must report the distinct DETACHED_HEAD sentinel, never \"main\", never \"\", never a value " +
				"a caller could mistake for a real branch name",
		).toBe(DETACHED_HEAD);
		expect(branch).not.toBe("main");
		expect(branch.length, "must not be the empty-string failure mode this module's docstring warns against").toBeGreaterThan(0);

		const verdict = classifyGitInvocation({ subcommand: "push", args: ["origin", "HEAD:feature/x"] }, facts(branch));
		expect(verdict.kind, "DETACHED_HEAD can never equal a configured protected branch name -- must allow").toBe(
			"allow",
		);
	});

	it("case 4 — cwdOverride: currentBranch(repoB) reflects repoB, not the harness's ambient process cwd", () => {
		makeCommittedRepo(repoB);

		const originalCwd = process.cwd();
		try {
			// Simulate the harness's own ambient cwd being repoA (currently
			// detached from case 3) -- if currentBranch ever regressed to reading
			// process.cwd() instead of its own `cwd` parameter, this is the case
			// that would catch it, because the two answers are provably different.
			process.chdir(repoA);

			const branchViaResolvedCwd = currentBranch(repoB);
			expect(
				branchViaResolvedCwd,
				"currentBranch(repoB) must report repoB's own branch (\"main\") -- this is the `git -C /other/repo push` " +
					"bypass row made a test: the invocation's resolved cwdOverride selects the repository interrogated, " +
					"not the harness's ambient cwd",
			).toBe("main");
			expect(branchViaResolvedCwd).not.toBe(currentBranch(repoA));
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("case 5 — git worktree add -b feat main EXECUTES for real on the main fixture, and the classifier allows it", () => {
		requireOk(git(["checkout", "main"], repoA), "git checkout main");
		expect(currentBranch(repoA), "must genuinely be back on main before this case proves anything").toBe("main");

		const worktreePath = join(worktreeParent, "feat");
		const worktreeArgs = ["worktree", "add", "-b", "feat", worktreePath, "main"];
		const result = git(worktreeArgs, repoA);

		expect(
			result.status,
			`git worktree add must succeed for real -- this is the escape hatch executed, not merely classified: ${result.stderr}`,
		).toBe(0);

		const verdict = classifyGitInvocation({ subcommand: "worktree", args: worktreeArgs.slice(1) }, facts("main"));
		expect(
			verdict.kind,
			"the exact invocation that just succeeded for real must classify as allow -- proving the allow-case is " +
				"genuinely the useful escape hatch and not a string that happens to be in a table",
		).toBe("allow");
	});
});
