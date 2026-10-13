/**
 * Git oracles for tests. Ignore questions go to `git check-ignore -q --no-index`, never a `.gitignore` parser: the
 * verbose form exits 0 on a negation line, and without `--no-index` any tracked path reads as not-ignored.
 * `git add -f` bypasses ignore rules entirely, so this proves the declared policy, not what a human can force.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cachedRoot: string | undefined;

/** Runs `git args` in `cwd`, returning its output and status; throws only when git cannot launch. */
export function gitResult(args: string[], cwd?: string): { stdout: string; stderr: string; status: number | null } {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf-8",
		shell: false,
		windowsHide: true,
	});
	if (result.error) {
		throw new Error(`git ${args.join(" ")} failed to launch: ${result.error.message}`);
	}
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

/** Absolute repository root, resolved once; git's forward-slash Windows form is a valid `cwd` as is. */
export function repoRoot(): string {
	if (cachedRoot === undefined) {
		const { stdout, status } = gitResult(["rev-parse", "--show-toplevel"]);
		if (status !== 0) {
			throw new Error("not inside a git repository -- `git rev-parse --show-toplevel` failed");
		}
		cachedRoot = stdout.trim();
		if (cachedRoot === "") {
			throw new Error("`git rev-parse --show-toplevel` returned an empty path");
		}
	}
	return cachedRoot;
}

/** True when git's ignore rules classify `path` (repo-relative, need not exist) as ignored. */
export function isIgnored(path: string): boolean {
	const { status } = gitResult(["check-ignore", "-q", "--no-index", "--", path], repoRoot());
	if (status !== 0 && status !== 1) {
		throw new Error(`git check-ignore returned unexpected exit code ${status} for ${path}`);
	}
	return status === 0;
}

/** Repo-relative paths git actually tracks under a pathspec. */
export function trackedFiles(pattern = "."): string[] {
	const { stdout, status } = gitResult(["ls-files", "--", pattern], repoRoot());
	if (status !== 0) {
		throw new Error(`git ls-files failed for pathspec ${pattern}`);
	}
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

/** Runs `git args` in `cwd` and returns stdout, throwing with the argv and stderr on a non-zero exit. */
export function runGit(args: string[], cwd: string): string {
	const { stdout, stderr, status } = gitResult(args, cwd);
	if (status !== 0) throw new Error(`git ${args.join(" ")} failed (exit ${status}) in ${cwd}: ${stderr}`);
	return stdout;
}

/** Inits a repository in `cwd` on `branch` (never the machine's `init.defaultBranch`), by default with one seed commit. */
export function gitInit(cwd: string, branch: string, seed = true): void {
	runGit(["init"], cwd);
	runGit(["config", "user.email", "test@test.invalid"], cwd);
	runGit(["config", "user.name", "test"], cwd);
	runGit(["config", "commit.gpgsign", "false"], cwd);
	runGit(["checkout", "-b", branch], cwd);
	if (seed) commitFile(cwd, "seed.txt", "seed\n", "seed");
}

/** A fresh repository in a new temp directory, on branch `work`, with no commits. */
export function makeTempRepo(prefix: string): string {
	const repo = mkdtempSync(join(tmpdir(), prefix));
	gitInit(repo, "work", false);
	return repo;
}

/** Writes and commits `<repo>/<name>`, returning the new HEAD sha. */
export function commitFile(repo: string, name: string, body: string, message: string): string {
	writeFileSync(join(repo, name), body, "utf-8");
	runGit(["add", "--", name], repo);
	runGit(["commit", "-m", message], repo);
	return headSha(repo);
}

/** HEAD's sha, throwing rather than returning an empty string. */
export function headSha(repo: string): string {
	const sha = runGit(["rev-parse", "HEAD"], repo).trim();
	if (sha === "") throw new Error(`git rev-parse HEAD returned an empty SHA in ${repo}`);
	return sha;
}
