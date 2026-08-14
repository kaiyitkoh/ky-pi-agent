/**
 * Git ignore/tracking oracle.
 *
 * Rule: never parse `.gitignore`. Git is the only correct authority on ignore
 * precedence, negation, nested ignore files, `.git/info/exclude` and
 * `core.excludesFile`. Ask git; do not reimplement it.
 * (RESEARCH.md "Don't Hand-Roll", row 1.)
 *
 * Two verified traps are encoded here:
 *
 * 1. `check-ignore -q` is the primitive; the verbose form is NOT.
 *    The verbose form exits 0 whenever it finds a matching line -- INCLUDING a
 *    negation line -- so its exit code reports "a rule matched", not "the path
 *    is ignored". Using it would invert the verdict for every negated path
 *    (`!/.npmrc`, `!/.pi/npm/.npmrc`, `!.env.example`), i.e. every path this
 *    repo most needs to be committable. Quiet mode exits 0 = ignored,
 *    1 = not ignored. [RESEARCH.md 6.4]
 *
 * 2. `--no-index` is mandatory, and its absence is a silent vacuous pass.
 *    By default `check-ignore` consults the index and reports any TRACKED path
 *    as not-ignored regardless of the rules. Most of `MUST_BE_COMMITTABLE` is
 *    already tracked, so without `--no-index` the committable direction of the
 *    BOOT-09 test would assert nothing at all.
 *
 *    [VERIFIED: executed 2026-08-13, scratch repo, git 2.x]
 *      .npmrc tracked, .gitignore = `.npmrc` + `!/.npmrc`
 *        check-ignore -q            -> 1     check-ignore -q --no-index -> 1
 *      negation REMOVED, .npmrc still tracked
 *        check-ignore -q            -> 1  <-- WRONG, index masks the rule
 *        check-ignore -q --no-index -> 0  <-- correct
 *
 * Scope caveat, stated rather than overclaimed: `git add -f` bypasses ignore
 * rules entirely. This module proves POLICY -- that the declared rules classify
 * each path correctly -- not omnipotence over what a human can force into the
 * index. A `git add -f .pi/auth.json` is out of reach of any ignore rule and is
 * a different control's problem.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cachedRoot: string | undefined;

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
 * Absolute path to the repository root, resolved once per process.
 *
 * On Windows git prints a forward-slash path (`C:/Users/...`); that form is a
 * valid `cwd` for `spawnSync`, so it is used verbatim rather than normalised.
 */
export function repoRoot(): string {
	if (cachedRoot === undefined) {
		const { stdout, status } = run(["rev-parse", "--show-toplevel"]);
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

/**
 * True when git's ignore rules classify `path` as ignored.
 *
 * `path` is interpreted relative to the repository root and does NOT need to
 * exist -- `check-ignore` evaluates rules against the string, which is why the
 * BOOT-09 table needs no fixture files on disk.
 */
export function isIgnored(path: string): boolean {
	const { status } = run(["check-ignore", "-q", "--no-index", "--", path], repoRoot());
	if (status !== 0 && status !== 1) {
		throw new Error(`git check-ignore returned unexpected exit code ${status} for ${path}`);
	}
	return status === 0;
}

/**
 * Paths currently tracked in the index, filtered by a git pathspec.
 *
 * Returns repo-root-relative, forward-slash paths. Unlike {@link isIgnored},
 * this reports what git actually holds, so it is the right oracle for "was this
 * accidentally committed" questions.
 */
export function trackedFiles(pattern = "."): string[] {
	const { stdout, status } = run(["ls-files", "--", pattern], repoRoot());
	if (status !== 0) {
		throw new Error(`git ls-files failed for pathspec ${pattern}`);
	}
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

/**
 * Create a fresh, empty git repository in a new temp directory (under
 * `os.tmpdir()`, never inside this repository), checked out on a branch
 * named `work` — never `main`/`master` — so no fixture built on top of it
 * depends on this machine's `init.defaultBranch` setting.
 *
 * Every one of the four setup calls (`init`, two `config` calls,
 * `checkout -b`) is asserted to succeed; a failure throws naming the exact
 * argv that failed rather than returning a half-initialised path silently.
 */
export function makeTempRepo(prefix: string): string {
	const repo = mkdtempSync(join(tmpdir(), prefix));
	const setup: string[][] = [
		["init"],
		["config", "user.email", "quick@test.invalid"],
		["config", "user.name", "quick test"],
		["checkout", "-b", "work"],
	];
	for (const args of setup) {
		const { status } = run(args, repo);
		if (status !== 0) {
			throw new Error(`git ${args.join(" ")} failed (exit ${status}) while making temp repo ${repo}`);
		}
	}
	return repo;
}

/**
 * Write `body` to `<repo>/<name>`, stage it and commit it with `message`,
 * returning the new HEAD SHA read back via {@link headSha} — never trusted
 * from `git commit`'s own stdout, which this module's header rule says is
 * never parsed.
 */
export function commitFile(repo: string, name: string, body: string, message: string): string {
	writeFileSync(join(repo, name), body, "utf-8");
	const steps: string[][] = [
		["add", "--", name],
		["commit", "-m", message],
	];
	for (const args of steps) {
		const { status } = run(args, repo);
		if (status !== 0) {
			throw new Error(`git ${args.join(" ")} failed (exit ${status}) committing ${name} in ${repo}`);
		}
	}
	return headSha(repo);
}

/**
 * The current HEAD SHA of `repo`, read directly via `git rev-parse HEAD`.
 * Throws naming the failing argv on a non-zero status or an empty result —
 * never returns an empty string silently.
 */
export function headSha(repo: string): string {
	const { stdout, status } = run(["rev-parse", "HEAD"], repo);
	if (status !== 0) {
		throw new Error(`git rev-parse HEAD failed (exit ${status}) in ${repo}`);
	}
	const sha = stdout.trim();
	if (sha === "") {
		throw new Error(`git rev-parse HEAD returned an empty SHA in ${repo}`);
	}
	return sha;
}
