/**
 * Real `git worktree` fixture helper — the untracked-file half of EXT-02.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT. This module exercises real `git
 * worktree add`/`remove` behaviour against a real temp repository: it proves
 * that untracked files (`.env`, `node_modules`) genuinely do not travel to a
 * fresh worktree, using git itself as the only oracle (never a hand-rolled
 * simulation). It says NOTHING about `pi-subagents`' own runtime — whether
 * that package's `createWorktrees()` invokes a configured
 * `worktreeSetupHook`, or how it wires `WorktreeSetupHookInput` on stdin, is
 * outside this file's scope entirely. Callers that need to prove the repo's
 * own `.pi/scripts/worktree-setup-hook.mjs` fixes the gap this file
 * demonstrates should feed its exports into their own build proxy (see
 * `tests/integration/worktree-build.test.ts`, a later plan).
 *
 * Sibling of `tests/helpers/git.ts` — reuses `makeTempRepo` and `commitFile`
 * from it rather than re-declaring a second git wrapper with different error
 * semantics. The local `run()` below is copied from `git.ts:45-56` exactly:
 * same `spawnSync` options, same throw-on-launch-failure shape. Every
 * exported function here follows `git.ts`'s own discipline — throw naming
 * the full failing argv and exit code on non-zero status, never return a
 * half-initialised path silently.
 *
 * Every temp directory this module creates goes through `makeTempRepo`,
 * which already uses `mkdtempSync(join(tmpdir(), prefix))` — never
 * `<repoRoot>/tmp`, because these fixtures import nothing from this repo's
 * own `node_modules` and have no reason to sit inside it. Removal (with
 * `{ recursive: true, force: true, maxRetries: 3 }`, the Windows
 * lingering-file-handle convention used throughout `tests/helpers/
 * session.ts`) is the caller's responsibility, exactly as it already is for
 * every `makeTempRepo` caller in this repo — this module writes nothing
 * outside a path it was itself handed or created via `makeTempRepo`.
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

/**
 * Throw if git's own index reports any of `paths` as tracked inside `repo`.
 *
 * This is the guard that keeps the fixture honest: a "untracked" `.env` or
 * `node_modules` that was actually `git add`-ed (a copy/paste mistake, an
 * accidental `git add -A` upstream) would make every downstream negative
 * proof (EXT-02's "untracked files do not travel to a worktree") vacuous --
 * of course a file travels if it is tracked. No `.gitignore` is written by
 * this fixture, so the ignored-vs-tracked distinction is checked the only
 * way that is still meaningful without one: ask `git ls-files` directly.
 */
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
 * Build a fresh temp git repo carrying a tracked `src/index.js` build proxy
 * plus genuinely UNTRACKED `node_modules/dep/index.js` and `.env`.
 *
 * `src/index.js` requires the bare specifier `"dep"` (resolved through
 * `node_modules/dep/index.js` -- there is no relative require here, Node's
 * own module resolution is the mechanism under test) and asserts
 * `fs.existsSync(".env")`, printing `WORKTREE_BUILD_OK` to stdout and
 * exiting non-zero if either dependency is missing. Run it with `node
 * src/index.js` (cwd = the repo or worktree root) to prove whether that
 * location can build: succeeds in the original repo (both untracked paths
 * are physically present there), fails inside a fresh `git worktree add`
 * checkout (untracked files never travel) -- exactly Pattern C's steps 4-7.
 *
 * `node_modules/dep` and `.env` are created directly with `writeFileSync`/
 * `mkdirSync`, WITHOUT ever being passed to `git add`. That omission is the
 * entire point of this fixture; {@link assertUntracked} enforces it before
 * returning, so a future edit that accidentally stages either path fails
 * loudly here rather than silently downstream.
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

/**
 * `git worktree add <worktreePath> -b <branch> HEAD`, run from `repo`.
 *
 * Mirrors `pi-subagents@0.49.0`'s own invocation exactly
 * (`src/runs/shared/worktree.ts:393`: `git -C <toplevel> worktree add <path>
 * -b <branch> HEAD`), so a proof built on this helper exercises the same
 * command shape the real package issues. Throws naming the full argv and
 * exit code on non-zero status. Returns `worktreePath` on success, mirroring
 * `makeTempRepo`'s own return-the-path convention.
 */
export function addWorktree(repo: string, worktreePath: string, branch: string): string {
	const args = ["worktree", "add", worktreePath, "-b", branch, "HEAD"];
	const { status } = run(args, repo);
	if (status !== 0) {
		throw new Error(`git ${args.join(" ")} failed (exit ${status}) in ${repo}`);
	}
	return worktreePath;
}

/**
 * Tear down a worktree created by {@link addWorktree}: `git worktree remove
 * --force <path>`, then `git branch -D <branch>`, then `git worktree prune`
 * -- matching `pi-subagents`' own teardown sequence
 * (`src/runs/shared/worktree.ts:428, :430, :640, :740`).
 *
 * The `remove` and `prune` steps throw naming the full argv and exit code on
 * non-zero status. The `branch -D` step is tolerated non-zero ONLY when the
 * branch is already gone (verified with `git rev-parse --verify
 * refs/heads/<branch>`) -- a caller that already deleted it, or a worktree
 * whose branch never got created, should not make cleanup itself fail. Any
 * other non-zero `branch -D` status throws.
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
