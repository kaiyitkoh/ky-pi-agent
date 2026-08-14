/**
 * EXT-07 -- the hardened checkpoint extension (`.pi/extensions/checkpoint/`)
 * proven against real, disposable git repositories, in both directions.
 *
 * WHY REAL REPOSITORIES, NOT A MOCK. `git.ts#createCheckpoint`/`restoreCheckpoint`
 * are thin wrappers around real `git` subprocess calls; nothing about the
 * `-u`-flag trap this plan cites (`git stash create -u` accepts the flag and
 * silently ignores it) is visible to a mock. Every case below drives real git,
 * real files, and a real temp repository via `tests/helpers/git.ts`'s
 * `makeTempRepo`/`commitFile`, never this repository itself.
 *
 * WHY CASE 2 EXISTS (the negative control). `npmrc-policy.test.ts` Group B's
 * "the real attack, in both directions" idiom: a hardened case's pass could be
 * a fixture artifact rather than evidence the hardening does anything, unless
 * the SAME fixture shape is proven to fail under the UNHARDENED mechanism.
 * Case 2 reproduces upstream `git-checkpoint.ts:22`/`:44`'s own commands
 * (`git stash create -u` / `git stash apply <ref>`) on the same fixture Case 1
 * uses, and shows the untracked file is NOT restored there.
 *
 * NEVER `it.skip`. If `git` is missing from PATH every case below throws with
 * the git error text as its own remedy, per this suite's standing rule
 * (`tests/integration/git-head-main.test.ts`'s own docstring).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createCheckpoint, restoreCheckpoint } from "../../.pi/extensions/checkpoint/git.ts";
import { recordCheckpoint } from "../../.pi/extensions/checkpoint/store.ts";
import { commitFile, makeTempRepo, repoRoot } from "../helpers/git.ts";

/** Every temp directory this file creates; removed after each case. */
let tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	}
	tempDirs = [];
});

/**
 * A fresh disposable git repository via `tests/helpers/git.ts#makeTempRepo`,
 * tracked for cleanup. `core.autocrlf` is forced OFF for the fixture: this
 * machine's global git config line-ending policy (Windows default is `true`)
 * would otherwise rewrite every LF this file writes into CRLF on checkout,
 * which is a property of THIS MACHINE's git config, not of `createCheckpoint`/
 * `restoreCheckpoint` -- byte-exact assertions below would measure the wrong
 * thing without this.
 */
function trackedRepo(prefix: string): string {
	const repo = makeTempRepo(prefix);
	tempDirs.push(repo);
	const autocrlf = git(["config", "core.autocrlf", "false"], repo);
	if (autocrlf.status !== 0) {
		throw new Error(`git config core.autocrlf false failed (exit ${autocrlf.status}) in ${repo}: ${autocrlf.stderr}`);
	}
	return repo;
}

/** One git invocation against `cwd`, real subprocess, matching `tests/helpers/git.ts`'s own discipline. */
function git(args: string[], cwd: string): { stdout: string; stderr: string; status: number | null } {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	if (result.error) {
		throw new Error(`git ${args.join(" ")} failed to launch in "${cwd}": ${result.error.message}`);
	}
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

describe("EXT-07 -- checkpoint capture and restore, proven against real temp git repositories", () => {
	it("case 1 -- captures BOTH a tracked modification and an untracked non-ignored file, byte-exact", () => {
		const repo = trackedRepo("kypi-checkpoint-");
		commitFile(repo, "tracked.txt", "line1\n", "init");

		writeFileSync(join(repo, "tracked.txt"), "line1\nline2\n", "utf-8");
		writeFileSync(join(repo, "untracked.txt"), "secretish\n", "utf-8");

		// Vacuity guard, per this repo's standing idiom: prove the fixture's
		// untracked file is genuinely untracked before any restore assertion.
		const lsFiles = git(["ls-files", "--", "untracked.txt"], repo);
		expect(
			lsFiles.stdout.trim(),
			"fixture sanity: untracked.txt must not already be tracked, or capturing it proves nothing about defect 2",
		).toBe("");

		const sha = createCheckpoint(repo, "case1");

		// Revert the tracked modification and delete the untracked file -- as if
		// the model's turn that produced them had never happened.
		expect(git(["checkout", "--", "tracked.txt"], repo).status).toBe(0);
		rmSync(join(repo, "untracked.txt"));
		expect(
			existsSync(join(repo, "untracked.txt")),
			"fixture sanity: untracked.txt must genuinely be gone before restore is asked to bring it back",
		).toBe(false);

		restoreCheckpoint(repo, sha);

		expect(
			readFileSync(join(repo, "tracked.txt"), "utf-8"),
			"the tracked modification must come back byte-exact",
		).toBe("line1\nline2\n");
		expect(existsSync(join(repo, "untracked.txt")), "DEFECT 2 FIX: the untracked file must be restored").toBe(true);
		expect(
			readFileSync(join(repo, "untracked.txt"), "utf-8"),
			"the restored untracked file's content must come back byte-exact",
		).toBe("secretish\n");
	});

	it("case 2 -- negative control: the bundled example's own mechanism does NOT restore the untracked file, on the SAME fixture shape", () => {
		const repo = trackedRepo("kypi-checkpoint-");
		commitFile(repo, "tracked.txt", "line1\n", "init");
		writeFileSync(join(repo, "tracked.txt"), "line1\nline2\n", "utf-8");
		writeFileSync(join(repo, "untracked.txt"), "secretish\n", "utf-8");

		// Reproduces upstream git-checkpoint.ts:22's exact call, WITH the flag
		// someone reaching for "obviously I should capture untracked work too"
		// would add.
		const created = git(["stash", "create", "-u"], repo);
		expect(created.status, `the control command itself must succeed: ${created.stderr}`).toBe(0);
		const ref = created.stdout.trim();
		expect(ref.length, "the control produced no ref -- the control itself is broken, not just the mechanism").toBeGreaterThan(0);

		// Pin the "accepted and ignored" finding as a live regression check: the
		// resulting commit's tree must NOT contain the untracked path. If a
		// future git version changes this, THIS assertion turns red rather than
		// silently invalidating createCheckpoint's own justification for existing.
		const lsTree = git(["ls-tree", "-r", ref, "--name-only"], repo);
		expect(
			lsTree.stdout,
			"the -u flag was measured to be accepted and silently ignored on this git version -- if this now " +
				"contains untracked.txt, re-examine createCheckpoint's own justification before touching anything else",
		).not.toContain("untracked.txt");

		// Reproduces upstream git-checkpoint.ts:44's own restore.
		expect(git(["checkout", "--", "tracked.txt"], repo).status).toBe(0);
		rmSync(join(repo, "untracked.txt"));
		const applied = git(["stash", "apply", ref], repo);
		expect(applied.status, `the control's own restore must succeed: ${applied.stderr}`).toBe(0);

		expect(
			readFileSync(join(repo, "tracked.txt"), "utf-8"),
			"the tracked half restores fine even under the unhardened mechanism -- only the untracked half is the defect",
		).toBe("line1\nline2\n");
		expect(
			existsSync(join(repo, "untracked.txt")),
			"the SAME fixture that Case 1 restored successfully must FAIL to restore the untracked file here -- " +
				"otherwise Case 1's pass could be a fixture artifact rather than evidence the hardening does anything",
		).toBe(false);
	});

	it("case 3 -- a gitignored path is never captured or restored (the stated scope boundary, T-07-10/T-07-11)", () => {
		const repo = trackedRepo("kypi-checkpoint-");
		commitFile(repo, ".gitignore", "ignoredir/\n", "add gitignore");
		commitFile(repo, "tracked.txt", "line1\n", "init");

		mkdirSync(join(repo, "ignoredir"), { recursive: true });
		writeFileSync(join(repo, "ignoredir", "secret.txt"), "should-never-be-checkpointed\n", "utf-8");

		// Vacuity guard: prove git genuinely classifies this path ignored before
		// claiming createCheckpoint respects that classification.
		const checkIgnore = git(["check-ignore", "-q", "--", "ignoredir/secret.txt"], repo);
		expect(
			checkIgnore.status,
			"fixture sanity: ignoredir/secret.txt must actually be classified ignored, or this case proves nothing",
		).toBe(0);

		const sha = createCheckpoint(repo, "case3");
		rmSync(join(repo, "ignoredir"), { recursive: true, force: true });
		expect(existsSync(join(repo, "ignoredir")), "fixture sanity: ignoredir must genuinely be gone before restore").toBe(
			false,
		);

		restoreCheckpoint(repo, sha);

		expect(
			existsSync(join(repo, "ignoredir")),
			"a gitignored path must never be restored -- it was never captured, per git add -A's own .gitignore respect",
		).toBe(false);
	});

	it("case 4 -- checkpoints persist across a fresh OS process, not just an in-process variable (defect 3)", () => {
		const stateRoot = mkdtempSync(join(tmpdir(), "kypi-checkpoint-state-"));
		tempDirs.push(stateRoot);

		const shaA = "a".repeat(40);
		const shaB = "b".repeat(40);
		const pathA = recordCheckpoint(stateRoot, { sha: shaA, label: "first", cwd: stateRoot });
		const pathB = recordCheckpoint(stateRoot, { sha: shaB, label: "second", cwd: stateRoot });
		expect(pathA, "recordCheckpoint must return the path written, not undefined, on a healthy temp directory").toBeDefined();
		expect(pathB, "recordCheckpoint must return the path written, not undefined, on a healthy temp directory").toBeDefined();

		// A FRESH OS PROCESS reads the store back -- an in-process re-read of a
		// module-level variable would prove nothing about surviving a restart.
		const storeUrl = pathToFileURL(join(repoRoot(), ".pi", "extensions", "checkpoint", "store.ts")).href;
		const script = [
			`const mod = await import(${JSON.stringify(storeUrl)});`,
			`const entries = mod.readCheckpoints(${JSON.stringify(stateRoot)});`,
			"process.stdout.write(JSON.stringify(entries));",
		].join("\n");
		const scriptPath = join(stateRoot, "read-back.mjs");
		writeFileSync(scriptPath, script, "utf-8");

		const result = spawnSync(process.execPath, [scriptPath], { encoding: "utf-8", windowsHide: true });
		expect(result.status, `spawned node read-back must exit 0: ${result.stderr}`).toBe(0);

		const entries = JSON.parse(result.stdout) as { sha: string; label: string }[];
		expect(
			entries.length,
			"both entries recorded by THIS process must be visible to a DIFFERENT process reading the same directory",
		).toBe(2);
		expect(entries.map((e) => e.sha).sort()).toEqual([shaA, shaB].sort());
		expect(entries.map((e) => e.label).sort()).toEqual(["first", "second"]);
	});

	it("case 5 -- restoreCheckpoint needs no ExtensionContext and no UI, and the shipped command reaches it (defect 1)", () => {
		const repo = trackedRepo("kypi-checkpoint-");
		commitFile(repo, "tracked.txt", "line1\n", "init");
		writeFileSync(join(repo, "tracked.txt"), "line1\nline2\n", "utf-8");
		const sha = createCheckpoint(repo, "case5");
		expect(git(["checkout", "--", "tracked.txt"], repo).status).toBe(0);

		// The library function's own signature: two plain strings, no ctx of any
		// kind -- callable and effective with nothing UI-shaped in scope at all.
		expect(
			restoreCheckpoint.length,
			"restoreCheckpoint must take no ExtensionContext -- callable as (repoRoot, sha) alone",
		).toBe(2);
		restoreCheckpoint(repo, sha);
		expect(readFileSync(join(repo, "tracked.txt"), "utf-8")).toBe("line1\nline2\n");

		// Source-level: the shipped command handler actually reaches
		// restoreCheckpoint -- the reachability claim must cover the shipped
		// wiring, not just the library function in isolation.
		const indexSource = readFileSync(join(repoRoot(), ".pi", "extensions", "checkpoint", "index.ts"), "utf-8");
		expect(indexSource, "index.ts must register the headless-reachable command").toContain(
			'registerCommand("checkpoint-restore"',
		);
		expect(
			indexSource,
			"the checkpoint-restore command's own handler must call restoreCheckpoint -- otherwise the " +
				"headless-reachability claim covers only the library function, not the wiring a real session uses",
		).toMatch(/registerCommand\("checkpoint-restore"[\s\S]*restoreCheckpoint\(/);
	});
});
