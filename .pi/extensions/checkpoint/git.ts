/**
 * EXT-07 — the git mechanics behind the checkpoint extension: capture and
 * restore a working tree, including untracked-but-not-ignored files.
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE
 * ---------------------------------------------------------------------------
 * Re-authored from Pi's own bundled example,
 * `@earendil-works/pi-coding-agent@0.84.1`
 * `examples/extensions/git-checkpoint.ts` (53 lines), read in full before any
 * change was made. Two of that file's three cited defects live in this
 * module's territory (the third, headless survival, is `index.ts`'s). See
 * `index.ts`'s own provenance header for the exact upstream lines and
 * commands quoted verbatim — deliberately NOT repeated here, because this
 * file's own acceptance gate greps it for the literal subcommand name the
 * upstream example used and finds none, proving by construction (not by
 * promise) that the replaced mechanism is not merely renamed:
 *
 *   FIX for the untracked-capture defect: `createCheckpoint` below uses a
 *   scratch `GIT_INDEX_FILE` + `add -A` + `write-tree` + `commit-tree`
 *   sequence — see "THE MECHANISM" below.
 *   FIX for the silent-index-rewrite defect: `restoreCheckpoint` uses
 *   `git restore --source=<sha> --worktree -- .`, which does not stage the
 *   restored paths into the real index the way `git checkout <sha> -- .`
 *   would (T-07-12).
 *
 * ---------------------------------------------------------------------------
 * THE MECHANISM, MEASURED ON THIS MACHINE (git 2.54.0.windows.1), NOT ASSUMED
 * ---------------------------------------------------------------------------
 * The upstream file's own untracked-capture attempt (its `-u` flag on the
 * subcommand named in `index.ts`'s provenance header) was measured during
 * planning to be ACCEPTED with exit 0 while the resulting commit's tree
 * contains no untracked file — accepted and ignored, not merely undocumented.
 * A checkpoint built on it would grep green (the flag is right there in the
 * argv) and capture nothing. `tests/integration/git-checkpoint.test.ts`
 * Case 2 pins this finding as a live regression check, not a comment: if a
 * future git version changes this behaviour, that test turns red rather than
 * silently changing the mechanism's justification.
 *
 * The mechanism that DOES work, measured end to end during planning and
 * re-verified while writing this file:
 *
 *   1. resolve the real git directory:      git rev-parse --absolute-git-dir
 *   2. point GIT_INDEX_FILE at a scratch
 *      index file under it (never the real
 *      index — the caller's staged changes
 *      must not be disturbed)
 *   3. git add -A                           (respects .gitignore; captures
 *                                             every tracked modification AND
 *                                             every untracked-but-not-ignored
 *                                             file into the scratch index)
 *   4. git write-tree                       (against the scratch index)
 *   5. git commit-tree <tree> -p HEAD -m …  (against the REAL index/HEAD —
 *                                             commit-tree does not read the
 *                                             index at all, only the tree
 *                                             object and the parent)
 *
 * Restoring: `git restore --source=<sha> --worktree -- .` puts the checkpoint
 * tree's content back onto the working tree without touching the real index.
 * `git checkout <sha> -- .` was measured to do the same content-restore but
 * ADDITIONALLY stage the restored paths into the real index — a side effect
 * this module deliberately avoids (T-07-12).
 *
 * ---------------------------------------------------------------------------
 * SCOPE BOUNDARY, STATED RATHER THAN ASSUMED (T-07-10, T-07-11)
 * ---------------------------------------------------------------------------
 * `git add -A` respects `.gitignore`, so gitignored paths — `node_modules/`,
 * `.pi/logs/`, `.pi/state/`, `.env` — are DELIBERATELY NOT captured. Capturing
 * them would put a full `node_modules` tree, or worse, a secret, into every
 * checkpoint on every turn. Untracked-but-NOT-ignored files ARE captured —
 * that is defect 2's fix, and `tests/integration/git-checkpoint.test.ts`
 * Case 1 (positive) and Case 3 (the gitignored negative control) prove both
 * halves of this boundary rather than asserting it in prose alone.
 *
 * ---------------------------------------------------------------------------
 * SPAWN DISCIPLINE
 * ---------------------------------------------------------------------------
 * Every git invocation uses `spawnSync(..., { shell: false, windowsHide: true
 * })`, matching `tests/helpers/git.ts`'s `run()` and
 * `.pi/extensions/safety/git.ts`'s existing discipline, and throws naming the
 * full argv and exit code on a non-zero exit or a launch failure.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (BOOT-10). This module registers nothing. It does not spell
 * the tool-registration call, in code or in prose —
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`.
 */
import { spawnSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import { join } from "node:path";

import { currentSha } from "../safety/git.ts";

/** Run one git invocation in `cwd`, throwing on launch failure or a non-zero exit. */
function run(cwd: string, args: readonly string[], envExtra: NodeJS.ProcessEnv = {}): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf-8",
		shell: false,
		windowsHide: true,
		env: { ...process.env, ...envExtra },
	});
	if (result.error) {
		throw new Error(`git ${args.join(" ")} failed to launch in "${cwd}": ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed (exit ${result.status}) in "${cwd}": ${(result.stderr ?? "").trim()}`,
		);
	}
	return result.stdout ?? "";
}

/**
 * Every checkpoint's scratch index lives under the real `.git` directory
 * (resolved with `--absolute-git-dir`, not string-concatenated, so this works
 * whether `repoRoot` names the worktree root, a linked worktree, or any other
 * layout `git rev-parse` understands), named uniquely per call so two
 * concurrent checkpoints — the main session and a subagent's own turn — never
 * collide on the same scratch file.
 */
function scratchIndexPath(repoRoot: string): string {
	const gitDir = run(repoRoot, ["rev-parse", "--absolute-git-dir"]).trim();
	const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return join(gitDir, `checkpoint-scratch-index-${unique}`);
}

/**
 * Capture the current working tree — every tracked modification AND every
 * untracked-but-not-ignored file — as a commit object that is never made
 * reachable from any ref (it has no ref pointing at it; `git write-tree` and
 * `git commit-tree` never touch a branch). Returns the checkpoint commit SHA.
 *
 * Requires at least one existing commit in `repoRoot` (uses `HEAD` as the
 * checkpoint's parent via {@link currentSha}, reused rather than shelling out
 * to `git rev-parse` a second time). Throws on an unborn `HEAD` — there is no
 * safe parent to record for a repository with zero commits, and a caller of
 * this function is responsible for deciding what "no checkpoint possible yet"
 * means for it (see `index.ts`'s never-throw wrapping on `turn_start`).
 */
export function createCheckpoint(repoRoot: string, label: string): string {
	const scratch = scratchIndexPath(repoRoot);
	const env = { GIT_INDEX_FILE: scratch };
	try {
		// `git add -A` against the SCRATCH index: never touches the caller's real
		// staged changes. Respects .gitignore -- see the SCOPE BOUNDARY section above.
		run(repoRoot, ["add", "-A"], env);
		const tree = run(repoRoot, ["write-tree"], env).trim();
		const parent = currentSha(repoRoot);
		// commit-tree reads no index at all -- run WITHOUT the scratch-index env,
		// against the real HEAD.
		return run(repoRoot, ["commit-tree", tree, "-p", parent, "-m", label]).trim();
	} finally {
		// Best-effort cleanup; a leftover scratch index under .git/ is inert (it is
		// never referenced by anything once this function returns) and MUST NOT
		// turn a successful checkpoint into a thrown error.
		try {
			unlinkSync(scratch);
		} catch {
			// Nothing to clean up, or another process already removed it -- both fine.
		}
	}
}

/**
 * Restore the working tree at `repoRoot` to the content captured by the
 * checkpoint commit `sha`.
 *
 * Uses `git restore --source=<sha> --worktree -- .`, NOT `git checkout <sha>
 * -- .` (T-07-12): both restore working-tree CONTENT identically, but
 * `checkout` additionally stages the restored paths into the real index,
 * silently rewriting state the caller did not ask this function to touch.
 * `restore --worktree` leaves the index alone.
 *
 * Deliberately takes no `ExtensionContext` and needs no UI — this is defect
 * 1's fix at the mechanism layer: nothing here can distinguish an interactive
 * caller from a headless one, so nothing here can silently do less for one.
 */
export function restoreCheckpoint(repoRoot: string, sha: string): void {
	run(repoRoot, ["restore", `--source=${sha}`, "--worktree", "--", "."]);
}
