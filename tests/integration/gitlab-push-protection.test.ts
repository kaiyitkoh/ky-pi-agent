/**
 * SAFE-01's offline proxy -- a REAL server-side `pre-receive` hook, and the
 * harness's own classifier for what a push rejection means.
 *
 * WHAT THIS PROVES. That the harness reads and correctly classifies a
 * server-side push rejection: a real `git push`, against a real local bare
 * repository, refused by a real `pre-receive` hook running as a real
 * subprocess -- not a fixture string handed straight to the classifier. The
 * paired control (case 2) proves the hook is not simply rejecting everything,
 * and the ordinary-failure case (case 4) proves the classifier is not simply
 * answering "protected-branch-rejection" for every non-zero exit.
 *
 * WHAT THIS DOES NOT PROVE. Anything at all about whether GitLab is actually
 * configured with protected branches and push rules on the work laptop. That
 * is `RB-04-01` in `docs/RUNBOOK.md`, and it stays OUTSTANDING -- this file is
 * the offline proxy the runbook entry names, not the check itself.
 *
 * WHY THIS IS NEW COMPOSITION, NOT REUSE. No existing test in this repo drives
 * a real server-side git hook. This composes `tests/helpers/git.ts`'s spawn
 * discipline (`spawnSync(..., { shell: false, windowsHide: true })`) and
 * `tests/helpers/stub-bin.ts`'s disposable-directory-with-cleanup shape, the
 * same way `tests/integration/git-head-main.test.ts` composed them for a
 * disposable CHECKOUT rather than a disposable SERVER.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { classifyPushFailure } from "../../.pi/extensions/safety/git.ts";

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

function configureIdentity(dir: string): void {
	requireOk(git(["config", "user.email", "kypi-fixture@example.invalid"], dir), "git config user.email");
	requireOk(git(["config", "user.name", "kypi fixture"], dir), "git config user.name");
}

/**
 * A `pre-receive` hook, written POSIX `sh`, LF-only, with GitLab's own
 * protected-branch rejection wording REPRODUCED (not captured -- this
 * machine has no GitLab access) so the classifier under test is exercised
 * against realistic text rather than a string this repo invented for itself.
 *
 * No `[[`, no `local`, no `declare`, no arrays, no `function` keyword -- the
 * same bashism set `tests/unit/lf-and-shell.test.ts` scans tracked scripts
 * for. This one is written at runtime into a temp dir outside the repo, so it
 * is never scanned by that gate, but it is held to the same shape anyway
 * because a hook that only runs under bash-in-POSIX-mode is not the proxy the
 * plan asked for.
 */
const PRE_RECEIVE_HOOK = [
	"#!/bin/sh",
	"",
	"# REPRODUCTION of GitLab's real protected-branch rejection wording, not a",
	"# captured one -- RB-04-01 (docs/RUNBOOK.md) is what confirms the real text",
	"# on the work laptop. This hook exists only to give the classifier real",
	"# stderr bytes to read, produced by a real subprocess.",
	'protected_ref="refs/heads/main"',
	"rejected=0",
	"while read old new ref; do",
	'\tcase "$ref" in',
	'\t\t"$protected_ref")',
	"\t\t\techo 'GitLab: You are not allowed to push code to protected branches on this project.' 1>&2",
	"\t\t\trejected=1",
	"\t\t\t;;",
	"\tesac",
	"done",
	'if [ "$rejected" = "1" ]; then',
	"\texit 1",
	"fi",
	"exit 0",
	"",
].join("\n");

/** A bare "origin" repo, its default ref forced explicitly to `main`, carrying the fixture hook. */
function makeBareRepoWithHook(dir: string): void {
	mkdirSync(dir, { recursive: true });

	const initWithB = git(["init", "--bare", "-b", "main"], dir);
	if (initWithB.status !== 0) {
		// Older git without `-b` on `init`: init plainly, then force the default
		// ref before any push can create one, per the git-head-main.test.ts
		// precedent -- never rely on this machine's init.defaultBranch.
		requireOk(git(["init", "--bare"], dir), "git init --bare");
		requireOk(git(["symbolic-ref", "HEAD", "refs/heads/main"], dir), "git symbolic-ref HEAD refs/heads/main");
	}

	const hookPath = join(dir, "hooks", "pre-receive");
	writeFileSync(hookPath, PRE_RECEIVE_HOOK, "utf-8");
	chmodSync(hookPath, 0o755);
}

describe("SAFE-01 offline proxy -- a real server-side pre-receive hook, parsed correctly", () => {
	let base: string;
	let bareDir: string;
	let workA: string;
	let workB: string;
	let mainPushStderr: string;

	beforeAll(() => {
		base = mkdtempSync(join(tmpdir(), "kypi-gitlab-push-"));
		bareDir = join(base, "origin.git");
		workA = join(base, "work-a");
		workB = join(base, "work-b");

		makeBareRepoWithHook(bareDir);

		requireOk(git(["clone", bareDir, workA], base), "git clone (work-a)");
		configureIdentity(workA);
		// Force the branch name explicitly, never trust init.defaultBranch/clone
		// inference, per the plan's explicit instruction (mirrors
		// git-head-main.test.ts's makeCommittedRepo).
		requireOk(git(["symbolic-ref", "HEAD", "refs/heads/main"], workA), "git symbolic-ref HEAD refs/heads/main (work-a)");
	});

	afterAll(() => {
		// Windows-handle convention (tests/integration/jsonl-concurrency.test.ts,
		// tests/integration/git-head-main.test.ts): force + retry, since a git
		// process's file handle can linger briefly after it exits.
		rmSync(base, { recursive: true, force: true, maxRetries: 3 });
	});

	it("case 1 -- a push to the protected branch is rejected SERVER-SIDE, with the rejection text on stderr", () => {
		writeFileSync(join(workA, "README.md"), "kypi-fixture\n", "utf-8");
		requireOk(git(["add", "README.md"], workA), "git add README.md");
		requireOk(git(["commit", "-m", "initial"], workA), "git commit -m initial");

		const push = git(["push", "origin", "main"], workA);
		expect(push.status, "a push to a protected ref must exit non-zero").not.toBe(0);
		expect(
			push.stderr,
			"the hook's rejection text must reach the client's stderr -- without it, this proves nothing about a " +
				"server-side rejection at all",
		).toContain("You are not allowed to push code to protected branches");

		mainPushStderr = push.stderr;
	});

	it("case 2 (paired control) -- a push to a NON-protected branch, against the SAME repo and hook, SUCCEEDS", () => {
		// Without this case, case 1's rejection is equally consistent with a hook
		// that rejects EVERYTHING, or with a broken clone. Same bare repo, same
		// hook, only the target ref differs.
		requireOk(git(["checkout", "-b", "feature/allowed"], workA), "git checkout -b feature/allowed");
		writeFileSync(join(workA, "feature.txt"), "feature commit A\n", "utf-8");
		requireOk(git(["add", "feature.txt"], workA), "git add feature.txt");
		requireOk(git(["commit", "-m", "feature commit A"], workA), "git commit -m feature commit A");

		const push = git(["push", "origin", "feature/allowed"], workA);
		expect(
			push.status,
			`a push to a non-protected ref against the identical hook must succeed: ${push.stderr}`,
		).toBe(0);
	});

	it("case 3 -- the harness's classifier recognises the real rejection as protected-branch-rejection", () => {
		expect(mainPushStderr, "case 1 must have run first and captured real stderr").toBeTruthy();
		expect(classifyPushFailure(mainPushStderr)).toBe("protected-branch-rejection");
	});

	it("case 4 -- an ORDINARY failure (non-fast-forward) classifies differently -- the classifier is not one-directional", () => {
		// A one-directional assertion here would pass on a classifier that
		// returns "protected-branch-rejection" for everything. This produces a
		// REAL non-fast-forward rejection -- no hook involved, git's own
		// receive-pack refuses a non-ff update -- by diverging two clones of the
		// same non-protected branch.
		requireOk(git(["clone", bareDir, workB], base), "git clone (work-b)");
		configureIdentity(workB);
		requireOk(git(["checkout", "feature/allowed"], workB), "git checkout feature/allowed (work-b)");

		// work-a advances feature/allowed with a second commit and pushes it.
		writeFileSync(join(workA, "feature.txt"), "feature commit B\n", "utf-8");
		requireOk(git(["add", "feature.txt"], workA), "git add feature.txt (commit B)");
		requireOk(git(["commit", "-m", "feature commit B"], workA), "git commit -m feature commit B");
		requireOk(git(["push", "origin", "feature/allowed"], workA), "git push feature/allowed (commit B)");

		// work-b, still sitting on the earlier commit, makes a DIVERGENT commit
		// and pushes without fetching first -- a genuine non-fast-forward.
		writeFileSync(join(workB, "other.txt"), "feature commit C (diverged)\n", "utf-8");
		requireOk(git(["add", "other.txt"], workB), "git add other.txt (commit C)");
		requireOk(git(["commit", "-m", "feature commit C (diverged)"], workB), "git commit -m feature commit C");

		const push = git(["push", "origin", "feature/allowed"], workB);
		expect(push.status, "a diverged, non-fast-forward push must be rejected").not.toBe(0);
		expect(
			push.stderr,
			"this must be an ORDINARY git rejection, not the hook's protected-branch text -- otherwise this case " +
				"proves nothing about the classifier's negative direction",
		).not.toContain("You are not allowed to push code to protected branches");

		expect(classifyPushFailure(push.stderr)).not.toBe("protected-branch-rejection");
		expect(classifyPushFailure(push.stderr)).toBe("other");
	});
});
