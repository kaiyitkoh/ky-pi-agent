/**
 * Real `git worktree` fixtures: prove with git itself that untracked files (.env, node_modules) do not travel to a fresh
 * worktree. Says nothing about pi-subagents' runtime. Callers remove what makeTempRepo creates.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { commitFile, makeTempRepo } from "./git.ts";

/** Copied verbatim from `git.ts:45-56` -- same spawn options, same throw shape. */
function run(args: string[], cwd?: string): { stdout: string; status: number | null } {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf-8",
		shell: false,
		windowsHide: true,
	});
	if (result.error) {
		throw new Error(`git ${args.join(" ")} failed to launch: ${result.error.message}`);
	}
	return { stdout: result.stdout ?? "", status: result.status };
}

/** Throws if git tracks any of `paths`: a tracked "untracked" file would make every travel proof vacuous. */
function assertUntracked(repo: string, paths: string[]): void {
	const args = ["ls-files", "--", ...paths];
	const { stdout, status } = run(args, repo);
	if (status !== 0) {
		throw new Error(`git ${args.join(" ")} failed (exit ${status}) in ${repo}`);
	}
	const tracked = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	if (tracked.length > 0) {
		throw new Error(
			`makeTempRepoWithNodeModulesAndEnv: expected ${paths.join(", ")} to be untracked in ${repo}, ` +
				`but git ls-files reports these as tracked: ${tracked.join(", ")}. A fixture whose ` +
				"\"untracked\" files are actually tracked would make the worktree negative proof vacuous.",
		);
	}
}

/**
 * A temp repo with a tracked `src/index.js` build proxy that needs the untracked `node_modules/dep` and `.env`: it
 * prints WORKTREE_BUILD_OK in the repo and fails in a fresh worktree. Both are never staged, checked before returning.
 */
export function makeTempRepoWithNodeModulesAndEnv(prefix: string): string {
	const repo = makeTempRepo(prefix);

	mkdirSync(join(repo, "src"), { recursive: true });
	const indexBody = [
		'const dep = require("dep");',
		'const fs = require("node:fs");',
		"",
		'if (!fs.existsSync(".env")) {',
		'\tconsole.error("MISSING_ENV");',
		"\tprocess.exit(1);",
		"}",
		"",
		'if (dep !== "dep-loaded") {',
		'\tconsole.error("UNEXPECTED_DEP_VALUE: " + String(dep));',
		"\tprocess.exit(1);",
		"}",
		"",
		'console.log("WORKTREE_BUILD_OK");',
		"",
	].join("\n");
	commitFile(repo, "src/index.js", indexBody, "add src/index.js (worktree build fixture)");

	// Untracked on purpose. Never `git add`-ed.
	const depDir = join(repo, "node_modules", "dep");
	mkdirSync(depDir, { recursive: true });
	writeFileSync(join(depDir, "index.js"), 'module.exports = "dep-loaded";\n', "utf-8");
	writeFileSync(join(repo, ".env"), "KEY=value\n", "utf-8");

	assertUntracked(repo, ["node_modules", ".env"]);

	return repo;
}

/** `git worktree add <path> -b <branch> <HEAD sha>`, pi-subagents' own invocation shape (src/runs/shared/worktree.js:784). */
export function addWorktree(repo: string, worktreePath: string, branch: string): string {
	const resolved = run(["rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"], repo);
	if (resolved.status !== 0) {
		throw new Error(`git rev-parse HEAD^{commit} failed (exit ${resolved.status}) in ${repo}`);
	}
	const args = ["worktree", "add", worktreePath, "-b", branch, resolved.stdout.trim()];
	const { status } = run(args, repo);
	if (status !== 0) {
		throw new Error(`git ${args.join(" ")} failed (exit ${status}) in ${repo}`);
	}
	return worktreePath;
}

/**
 * Removes a worktree, deletes its branch and prunes, as pi-subagents tears down. `branch -D` may fail only when the
 * branch is already gone.
 */
export function removeWorktree(repo: string, worktreePath: string, branch: string): void {
	const removeArgs = ["worktree", "remove", "--force", worktreePath];
	const removeResult = run(removeArgs, repo);
	if (removeResult.status !== 0) {
		throw new Error(`git ${removeArgs.join(" ")} failed (exit ${removeResult.status}) in ${repo}`);
	}

	const branchArgs = ["branch", "-D", branch];
	const branchResult = run(branchArgs, repo);
	if (branchResult.status !== 0) {
		const { status: existsStatus } = run(["rev-parse", "--verify", `refs/heads/${branch}`], repo);
		if (existsStatus === 0) {
			throw new Error(`git ${branchArgs.join(" ")} failed (exit ${branchResult.status}) in ${repo}`);
		}
		// Branch already gone -- tolerated, matching pi-subagents' own teardown
		// discipline of not failing cleanup over a ref that no longer exists.
	}

	const pruneArgs = ["worktree", "prune"];
	const pruneResult = run(pruneArgs, repo);
	if (pruneResult.status !== 0) {
		throw new Error(`git ${pruneArgs.join(" ")} failed (exit ${pruneResult.status}) in ${repo}`);
	}
}
