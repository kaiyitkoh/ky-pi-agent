/**
 * Offline proxy for protected-branch push rejection: a real `git push` to a real local bare repository, refused by a
 * real `pre-receive` hook, then classified by the harness. Paired controls show the hook does not reject everything
 * and the classifier does not call every failure a protected-branch rejection. Whether GitLab is actually configured
 * that way is RB-04-01 in docs/RUNBOOK.md, still OUTSTANDING.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { gitResult, runGit } from "../helpers/git.ts";

const classifyPushFailure = (stderr: string): "protected-branch-rejection" | "other" =>
	/not allowed to push code to protected branches/i.test(stderr) ? "protected-branch-rejection" : "other";

function configureIdentity(dir: string): void {
	runGit(["config", "user.email", "kypi-fixture@example.invalid"], dir);
	runGit(["config", "user.name", "kypi fixture"], dir);
}

/**
 * A POSIX-sh, LF-only `pre-receive` hook reproducing GitLab's protected-branch wording (this machine has no GitLab),
 * free of bashisms like every tracked script.
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

	const initWithB = gitResult(["init", "--bare", "-b", "main"], dir);
	if (initWithB.status !== 0) {
		// Older git has no `init -b`: force the default ref, never relying on init.defaultBranch.
		runGit(["init", "--bare"], dir);
		runGit(["symbolic-ref", "HEAD", "refs/heads/main"], dir);
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

		runGit(["clone", bareDir, workA], base);
		configureIdentity(workA);
		// Force the branch name; never trust init.defaultBranch or clone inference.
		runGit(["symbolic-ref", "HEAD", "refs/heads/main"], workA);
	});

	afterAll(() => {
		// Force and retry: a git process's file handle can linger briefly on Windows.
		rmSync(base, { recursive: true, force: true, maxRetries: 3 });
	});

	it("case 1 -- a push to the protected branch is rejected SERVER-SIDE, with the rejection text on stderr", () => {
		writeFileSync(join(workA, "README.md"), "kypi-fixture\n", "utf-8");
		runGit(["add", "README.md"], workA);
		runGit(["commit", "-m", "initial"], workA);

		const push = gitResult(["push", "origin", "main"], workA);
		expect(push.status, "a push to a protected ref must exit non-zero").not.toBe(0);
		expect(
			push.stderr,
			"the hook's rejection text must reach the client's stderr -- without it, this proves nothing about a " +
				"server-side rejection at all",
		).toContain("You are not allowed to push code to protected branches");

		mainPushStderr = push.stderr;
	});

	it("case 2 (paired control) -- a push to a NON-protected branch, against the SAME repo and hook, SUCCEEDS", () => {
		// Same repo and hook, different ref: without this, case 1 is consistent with a hook that rejects everything.
		runGit(["checkout", "-b", "feature/allowed"], workA);
		writeFileSync(join(workA, "feature.txt"), "feature commit A\n", "utf-8");
		runGit(["add", "feature.txt"], workA);
		runGit(["commit", "-m", "feature commit A"], workA);

		const push = gitResult(["push", "origin", "feature/allowed"], workA);
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
		// A real non-fast-forward rejection with no hook, so a classifier that always says protected-branch fails.
		runGit(["clone", bareDir, workB], base);
		configureIdentity(workB);
		runGit(["checkout", "feature/allowed"], workB);

		// work-a advances feature/allowed with a second commit and pushes it.
		writeFileSync(join(workA, "feature.txt"), "feature commit B\n", "utf-8");
		runGit(["add", "feature.txt"], workA);
		runGit(["commit", "-m", "feature commit B"], workA);
		runGit(["push", "origin", "feature/allowed"], workA);

		// work-b, still sitting on the earlier commit, makes a DIVERGENT commit
		// and pushes without fetching first -- a genuine non-fast-forward.
		writeFileSync(join(workB, "other.txt"), "feature commit C (diverged)\n", "utf-8");
		runGit(["add", "other.txt"], workB);
		runGit(["commit", "-m", "feature commit C (diverged)"], workB);

		const push = gitResult(["push", "origin", "feature/allowed"], workB);
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
