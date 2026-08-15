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
 * Restoring is TWO steps, not one — see {@link restoreCheckpoint}'s own
 * docstring for why (CR-02). `git checkout <sha> -- .` was measured to do the
 * same content-restore as `git restore` but ADDITIONALLY stage the restored
 * paths into the real index — a side effect this module avoids (T-07-12).
 *
 * ---------------------------------------------------------------------------
 * SCOPE BOUNDARY, STATED RATHER THAN ASSUMED (T-07-10, T-07-11)
 * ---------------------------------------------------------------------------
 * `git add -A` respects `.gitignore`, so gitignored paths are DELIBERATELY NOT
 * captured. `node_modules/`, `.pi/logs/`, `.pi/state/`, `.env` and
 * `.terraform/` do not depend on that any more — CR2-03 found that "gitignored"
 * is a property of the repository the SESSION is in, not of this one, and
 * {@link MACHINE_STATE_EXCLUDE_PATHSPECS} now excludes them by name from both
 * `add -A` sites so they are neither captured nor deleted. Capturing
 * them would put a full `node_modules` tree, or worse, a secret, into every
 * checkpoint on every turn. Untracked-but-NOT-ignored files ARE captured —
 * that is defect 2's fix, and `tests/integration/git-checkpoint.test.ts`
 * Case 1 (positive) and Case 3 (the gitignored negative control) prove both
 * halves of this boundary rather than asserting it in prose alone.
 *
 * THE RESIDUAL THAT FOLLOWS FROM THAT, STATED (WR-19). `index.ts`'s own
 * provenance header frames the OPPOSITE as the defect being fixed —
 * "`.env`-class untracked work is silently never captured" — and both cannot
 * be right. What is true: capturing untracked non-ignored files means every
 * turn writes their CONTENT into `.git/objects`, where it survives deleting
 * the file, survives `git checkout`, and is recoverable by anyone holding the
 * repository directory. In a repository where a secrets file is untracked and
 * NOT matched by `.gitignore`, that is a secret persisted on every turn. This
 * repository's `.gitignore` is thorough, which is why the review called it a
 * warning; this module is written to be repo-agnostic and cannot rely on the
 * next repository's being. {@link CHECKPOINT_EXCLUDE_PATHSPECS} fails safe on the
 * obvious high-risk names that `.gitignore` may have missed. It is a
 * mitigation, not a guarantee: a secret under an unremarkable name
 * (`config.local.yaml`) is still captured. Also recorded in
 * `docs/EXTENSIONS.md`'s residuals list.
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
import { rmSync, rmdirSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

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
 * The repository's real top level, resolved by git rather than assumed.
 *
 * Every exported function here names its first parameter `repoRoot`, but the
 * only caller (`index.ts`) has `ctx.cwd` to hand, and Pi does not guarantee
 * that is the repository root — a session started in a subdirectory points
 * there (WR-13). That asymmetry is not cosmetic for
 * {@link restoreCheckpoint}: `git add -A` and `git write-tree` capture the
 * WHOLE repository whatever the cwd is, so every path this module compares or
 * deletes is repo-root-relative. Resolving the top level here, once, at the
 * module boundary, is what makes "join(root, treePath)" a true statement
 * instead of a silent off-by-a-subdirectory that deletes the wrong file.
 */
export function repoTopLevel(cwd: string): string {
	return resolve(run(cwd, ["rev-parse", "--show-toplevel"]).trim());
}

/**
 * Ref namespace anchoring checkpoint commits (WR-10).
 *
 * `commit-tree` produces an object with NO ref pointing at it, which this
 * module used to state proudly. Unreachable objects are exactly what `git gc`
 * prunes: `git gc --prune=now`, a `--aggressive` run, or simply the default
 * two-week grace period elapsing removes them. The store's row survives; the
 * object does not, and `restoreCheckpoint` then fails with a raw git error
 * while `index.ts` claims "a checkpoint recorded this turn is still findable
 * and restorable next process".
 *
 * `refs/kypi-checkpoints/` sits outside `refs/heads` and `refs/tags`, so it
 * never appears as a branch or a tag, is never pushed by a default
 * `git push`, and is not shown by `git branch`/`git tag`. It only makes the
 * object reachable so gc leaves it alone.
 */
export const CHECKPOINT_REF_PREFIX = "refs/kypi-checkpoints";

/**
 * Pathspecs excluded from every checkpoint capture (WR-19).
 *
 * `git add -A` respects `.gitignore` and nothing else, so in a repository
 * where a secrets file is untracked AND not matched by `.gitignore` — a
 * `config.local.yaml`, a downloaded `.pem` under a name the patterns miss, a
 * `terraform.tfstate` variant — every turn writes its content into
 * `.git/objects`, where it survives deleting the file, survives
 * `git checkout`, and is recoverable by anyone with the repository directory.
 * This repository's own `.gitignore` is thorough; this extension is written to
 * be repo-agnostic and cannot assume the next one's is.
 *
 * These exclusions are applied to BOTH `add -A` call sites — the capture and
 * the "what exists now" side of {@link pathsAddedSince} — so an excluded path
 * is absent from both trees and can therefore never be captured NOR deleted by
 * a restore. Breaking that symmetry would make restore delete files it never
 * saved, which is why the constant exists instead of two literal lists.
 */
export const SECRET_EXCLUDE_PATHSPECS = [
	":(exclude)*.pem",
	":(exclude)*.key",
	":(exclude)*.p12",
	":(exclude)*.pfx",
	":(exclude)id_rsa*",
	":(exclude)id_ed25519*",
	":(exclude)credentials",
	":(exclude)*.tfstate",
	":(exclude)*.tfstate.*",
] as const;

/**
 * Machine state that is neither captured nor deleted, WHATEVER `.gitignore`
 * says (CR2-03).
 *
 * THE DEFECT THIS CLOSES. The symmetry argument above is sound but it was
 * incomplete: `git add -A` respects `.gitignore` AND NOTHING ELSE, so
 * "gitignored paths cannot enter the added set" only holds in a repository
 * whose `.gitignore` lists them. `store.ts` CREATES `<repoRoot>/.pi/state/`
 * itself, on the same turn, moments after {@link createCheckpoint} returns —
 * so in every repository except this one the store is an ordinary
 * untracked-non-ignored path, lands in {@link pathsAddedSince}, and is
 * deleted by the first restore. Executed on a fresh repo with no
 * `.gitignore`:
 *
 *   store written at: <repo>\.pi\state\checkpoints.json
 *   --- after restoreCheckpoint(repo, sha) ---
 *   .pi/state/checkpoints.json   false
 *   readCheckpoints after restore: []
 *
 * One restore destroyed the index naming EVERY other checkpoint, and the
 * extension then reported "no checkpoints recorded yet". `package.json`
 * declares `pi.extensions: ["./.pi/extensions"]`, so the documented
 * `pi install` path loads this at user scope and `rootFor(ctx.cwd)` resolves
 * the SESSION's repository, not this one.
 *
 * WHY THESE FIVE. `.pi/state` and `.pi/logs` are this harness's own durable
 * state — deleting them is the extension destroying itself. `node_modules`,
 * `.env` and `.terraform` are the exact class Phase 7 success criterion 4 is
 * about: expensive-or-secret machine state that a `.gitignore` normally
 * covers and that must not depend on it. Excluding them from BOTH `add -A`
 * sites means they are in neither tree, so they can never be captured (no
 * `node_modules` tree in `.git/objects`, no `.env` content persisted) NOR
 * deleted by a restore.
 *
 * Verified by execution that a directory pathspec excludes its contents and
 * that `*credentials` crosses `/`:
 *
 *   $ git add -A -- . ':(exclude).pi/state' ':(exclude)node_modules' \
 *       ':(exclude).env' ':(exclude).terraform' ':(exclude)*credentials'
 *   $ git diff --cached --name-only
 *   keep.txt                       # and nothing else
 */
export const MACHINE_STATE_EXCLUDE_PATHSPECS = [
	":(exclude).pi/state",
	":(exclude).pi/logs",
	":(exclude)node_modules",
	":(exclude).env",
	":(exclude).terraform",
] as const;

/**
 * The single list both `add -A` call sites read. Splitting it would be how the
 * capture and the restore drift apart, and a restore that deletes what the
 * capture never saved is the CR2-03 defect itself.
 */
export const CHECKPOINT_EXCLUDE_PATHSPECS = [
	...SECRET_EXCLUDE_PATHSPECS,
	...MACHINE_STATE_EXCLUDE_PATHSPECS,
] as const;

/** `git add -A` over the whole repo, minus {@link CHECKPOINT_EXCLUDE_PATHSPECS}. */
function addAllExceptSecrets(root: string, env: NodeJS.ProcessEnv): void {
	run(root, ["add", "-A", "--", ".", ...CHECKPOINT_EXCLUDE_PATHSPECS], env);
}

/**
 * Repo-root-relative paths that exist in the working tree NOW but did not
 * exist in the checkpoint `sha` — i.e. exactly the files a restore has to
 * remove for the resulting tree to be the checkpoint rather than a union of
 * the checkpoint and everything created after it.
 *
 * The "now" side is computed with the SAME scratch-index + `add -A` +
 * `write-tree` sequence {@link createCheckpoint} uses, deliberately: both
 * sides of the comparison then respect `.gitignore` identically, so a
 * gitignored path can never appear in this set and can never be deleted. That
 * symmetry is the whole safety argument — see the SCOPE BOUNDARY section.
 */
function pathsAddedSince(root: string, sha: string): string[] {
	const scratch = scratchIndexPath(root);
	const env = { GIT_INDEX_FILE: scratch };
	try {
		addAllExceptSecrets(root, env);
		const nowTree = run(root, ["write-tree"], env).trim();
		// --diff-filter=A: present in nowTree, absent in the checkpoint tree.
		// -z + NUL split so a path containing a space, a quote or a non-ASCII
		// byte is not mangled by git's default path quoting.
		const out = run(root, ["diff-tree", "-r", "-z", "--name-only", "--diff-filter=A", sha, nowTree]);
		return out.split("\0").filter((p) => p !== "");
	} finally {
		try {
			unlinkSync(scratch);
		} catch {
			// Nothing to clean up, or another process already removed it -- both fine.
		}
	}
}

/**
 * Remove directories left empty by a deletion, walking up from `startDir` and
 * stopping at (never removing) `root`. Best-effort: `rmdirSync` fails on a
 * non-empty directory, which is precisely the stop condition wanted, so every
 * error is swallowed. Git does not track directories, so an empty directory is
 * not itself part of any checkpoint — leaving one behind would be a visible
 * artifact of a restore that claims to reproduce a past state.
 */
function pruneEmptyDirsUpTo(root: string, startDir: string): void {
	let dir = startDir;
	// Bounded by construction: each iteration moves strictly closer to `root`,
	// and the relative-path guard stops the moment `dir` is `root` or outside it.
	while (dir !== root) {
		const rel = relative(root, dir);
		if (rel === "" || rel.startsWith("..")) return;
		try {
			rmdirSync(dir);
		} catch {
			return; // Non-empty, or already gone. Either way, stop climbing.
		}
		dir = dirname(dir);
	}
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
	const root = repoTopLevel(repoRoot);
	const scratch = scratchIndexPath(root);
	const env = { GIT_INDEX_FILE: scratch };
	try {
		// `git add -A` against the SCRATCH index: never touches the caller's real
		// staged changes. Respects .gitignore -- see the SCOPE BOUNDARY section above.
		addAllExceptSecrets(root, env);
		const tree = run(root, ["write-tree"], env).trim();
		const parent = currentSha(root);
		// commit-tree reads no index at all -- run WITHOUT the scratch-index env,
		// against the real HEAD.
		const sha = run(root, ["commit-tree", tree, "-p", parent, "-m", label]).trim();
		// WR-10: anchor the object so `git gc` cannot prune it out from under the
		// store row that names it. See CHECKPOINT_REF_PREFIX.
		run(root, ["update-ref", `${CHECKPOINT_REF_PREFIX}/${sha}`, sha]);
		return sha;
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
 * checkpoint commit `sha` — the whole content, including the ABSENCE of files
 * the checkpoint does not hold.
 *
 * WHY TWO STEPS AND NOT ONE (CR-02). `git restore --source=<sha> --worktree`
 * overwrites paths that exist in the checkpoint tree and does NOTHING to paths
 * that do not: it never deletes. Verified by execution — checkpoint, then
 * create `after.txt`, then restore, and `after.txt` is still there. On its own
 * that command yields the UNION of the checkpoint and everything created
 * since, a state that never existed at any point in history. Concretely: the
 * model writes `src/new-module.ts` and rewrites `src/app.ts` to import it; the
 * user rewinds; `app.ts` comes back without the import while `new-module.ts`
 * stays, and the user proceeds believing the rewind happened.
 *
 * So the removal half is explicit, and SURGICAL rather than a `git clean`:
 * {@link pathsAddedSince} yields exactly the paths present now and absent in
 * the checkpoint; those and only those are removed; directories left empty are
 * pruned; then `git restore` puts the checkpoint's content back over what
 * remains.
 *
 * CORRECTION, CR2-03. This docstring previously argued that a set difference
 * was SAFER than `git clean -fdx` because `clean` "would additionally destroy
 * `node_modules/`, `.env`, `.pi/logs/` and `.pi/state/` — including this
 * extension's own checkpoint store". That was false and is deleted rather
 * than softened. `git add -A` respects `.gitignore` and nothing else, so in
 * any repository that does not ignore those paths they are ordinary
 * untracked-non-ignored paths, land in the added set, and were removed —
 * measured, including this extension's own store, which `store.ts` creates
 * moments after a checkpoint is taken. For untracked-non-ignored paths the
 * set difference was not safer than `git clean -fd`; it was identical, with a
 * larger blast radius than the `-x` `clean` would have needed to be told.
 *
 * WHAT IS TRUE NOW, and why it does not depend on `.gitignore`:
 * {@link CHECKPOINT_EXCLUDE_PATHSPECS} is applied to BOTH `add -A` sites, so
 * `.pi/state`, `.pi/logs`, `node_modules`, `.env`, `.terraform` and the
 * secret-name patterns are in NEITHER tree and are therefore invisible to the
 * diff — never captured, never deleted, whatever the repository ignores.
 * Gitignored paths remain untouched for the original reason as well.
 * `git-checkpoint.test.ts` Cases 3, 7 and 8 assert both halves, Case 7 in a
 * repository with NO `.gitignore` at all — which is what makes the assertion
 * about the mechanism rather than about this repository's own config.
 *
 * RESTORING IS NOT A ONE-WAY DOOR. Whatever survives the exclusions, a
 * restore still deletes files the user may have written by hand since the
 * checkpoint, and the only copy of their content would otherwise be a blob
 * under some LATER checkpoint's tree. So the first thing this function does
 * is take a checkpoint of the CURRENT tree and return its SHA: the state
 * being replaced is anchored under `refs/kypi-checkpoints/` before anything
 * is removed, and `/checkpoint-restore <sha>` reaches it. The caller is
 * responsible for telling the user that SHA — see `index.ts`.
 *
 * Deliberately takes no `ExtensionContext` and needs no UI — this is defect
 * 1's fix at the mechanism layer: nothing here can distinguish an interactive
 * caller from a headless one, so nothing here can silently do less for one.
 */
/**
 * Drop the anchoring ref for `sha` (WR-10's retention half).
 *
 * Called when the store evicts a row, so the ref namespace does not grow
 * without bound alongside the index. Best-effort and NEVER THROWS: a ref that
 * is already gone, or a repository that has moved, must not turn a successful
 * checkpoint into a broken turn. Once the ref is gone the object becomes
 * unreachable again and ordinary `git gc` reclaims it, which is the intent.
 */
export function dropCheckpointRef(repoRoot: string, sha: string): void {
	try {
		run(repoTopLevel(repoRoot), ["update-ref", "-d", `${CHECKPOINT_REF_PREFIX}/${sha}`]);
	} catch {
		// Already deleted, or the repository is unreachable. Both are fine.
	}
}

/** What a restore did, so the caller can tell the user how to undo it. */
export interface RestoreOutcome {
	/**
	 * A checkpoint of the tree AS IT STOOD before this restore ran, anchored
	 * under `refs/kypi-checkpoints/`. Restoring it undoes this restore.
	 */
	readonly undoSha: string;
	/** Repo-root-relative paths removed because the checkpoint does not hold them. */
	readonly removed: readonly string[];
}

export function restoreCheckpoint(repoRoot: string, sha: string): RestoreOutcome {
	const root = repoTopLevel(repoRoot);
	// BEFORE anything is removed. A restore that deletes a file the user wrote by
	// hand since the checkpoint is only acceptable if the content is still
	// reachable afterwards, and this is what makes it so (CR2-03).
	const undoSha = createCheckpoint(root, `pre-restore of ${sha} at ${new Date().toISOString()}`);
	const removed = pathsAddedSince(root, sha);
	for (const rel of removed) {
		const abs = join(root, rel);
		rmSync(abs, { force: true });
		pruneEmptyDirsUpTo(root, dirname(abs));
	}
	run(root, ["restore", `--source=${sha}`, "--worktree", "--", "."]);
	return { undoSha, removed };
}
