/**
 * Git mechanics for checkpoints: capture and restore a working tree, including untracked-but-not-ignored files.
 * Re-authored from Pi's own bundled example `examples/extensions/git-checkpoint.ts`: see PROVENANCE.md and index.ts.
 * Capture: scratch GIT_INDEX_FILE + `add -A` + `write-tree` + `commit-tree`, so the real index is never touched.
 * Restore uses `git restore --worktree`, which unlike `git checkout <sha> -- .` does not stage restored paths.
 * Registers nothing (tests/unit/contributing-boundary.test.ts scans for the registration call name).
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

/** Scratch index under the real git dir, unique per call so concurrent checkpoints never collide. */
function scratchIndexPath(repoRoot: string): string {
	const gitDir = run(repoRoot, ["rev-parse", "--absolute-git-dir"]).trim();
	const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return join(gitDir, `checkpoint-scratch-index-${unique}`);
}

/**
 * The repository's real top level. Pi's cwd may be a subdirectory, but `add -A` and `write-tree`
 * capture the whole repo, so every compared or deleted path must be root-relative.
 */
export function repoTopLevel(cwd: string): string {
	return resolve(run(cwd, ["rev-parse", "--show-toplevel"]).trim());
}

/**
 * Ref namespace that keeps checkpoint commits reachable so `git gc` cannot prune them.
 * Outside refs/heads and refs/tags: not a branch or tag, not pushed by default.
 */
export const CHECKPOINT_REF_PREFIX = "refs/kypi-checkpoints";

/**
 * Secret-looking names excluded from capture, because `add -A` honours only `.gitignore` and
 * captured content persists in `.git/objects`. A mitigation, not a guarantee (docs/EXTENSIONS.md residuals).
 * Applied at BOTH `add -A` sites so an excluded path is in neither tree and is never captured nor deleted.
 */
export const SECRET_EXCLUDE_PATHSPECS = [
	":(exclude)*.pem",
	":(exclude)*.key",
	":(exclude)*.p12",
	":(exclude)*.pfx",
	":(exclude)id_rsa*",
	":(exclude)id_ed25519*",
	// `*credentials`, not `credentials`: without a wildcard a pathspec is a literal root path; `*` crosses `/`.
	":(exclude)*credentials",
	":(exclude)*.tfstate",
	":(exclude)*.tfstate.*",
] as const;

/**
 * Machine state never captured nor deleted, whatever `.gitignore` says. store.ts creates `.pi/state`
 * itself, so without this a restore in a repo that does not ignore it deletes the checkpoint index.
 * Directory pathspecs exclude their contents.
 */
export const MACHINE_STATE_EXCLUDE_PATHSPECS = [
	":(exclude).pi/state",
	":(exclude).pi/logs",
	":(exclude)node_modules",
	":(exclude).env",
	":(exclude).terraform",
] as const;

/** The single list both `add -A` sites read; splitting it lets capture and restore drift apart. */
export const CHECKPOINT_EXCLUDE_PATHSPECS = [
	...SECRET_EXCLUDE_PATHSPECS,
	...MACHINE_STATE_EXCLUDE_PATHSPECS,
] as const;

/** `git add -A` over the whole repo, minus {@link CHECKPOINT_EXCLUDE_PATHSPECS}. */
function addAllExceptSecrets(root: string, env: NodeJS.ProcessEnv): void {
	run(root, ["add", "-A", "--", ".", ...CHECKPOINT_EXCLUDE_PATHSPECS], env);
}

/**
 * Root-relative paths present now but absent from checkpoint `sha`: exactly what a restore must remove.
 * "Now" is built the same way as createCheckpoint, so both sides apply identical exclusions.
 */
function pathsAddedSince(root: string, sha: string): string[] {
	const scratch = scratchIndexPath(root);
	const env = { GIT_INDEX_FILE: scratch };
	try {
		addAllExceptSecrets(root, env);
		const nowTree = run(root, ["write-tree"], env).trim();
		// -z: paths with spaces, quotes or non-ASCII bytes are not mangled by git's quoting.
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

/** Remove directories emptied by a deletion, climbing from `startDir` and stopping before `root`. */
function pruneEmptyDirsUpTo(root: string, startDir: string): void {
	let dir = startDir;
	// Each iteration moves strictly closer to `root`.
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
 * Capture the working tree (tracked changes plus untracked-not-ignored files) as a commit anchored under
 * CHECKPOINT_REF_PREFIX. Returns the SHA. Throws on an unborn HEAD: there is no parent to record.
 */
export function createCheckpoint(repoRoot: string, label: string): string {
	const root = repoTopLevel(repoRoot);
	const scratch = scratchIndexPath(root);
	const env = { GIT_INDEX_FILE: scratch };
	try {
		// Scratch index: the caller's staged changes are never touched.
		addAllExceptSecrets(root, env);
		const tree = run(root, ["write-tree"], env).trim();
		const parent = currentSha(root);
		// commit-tree reads no index: run without the scratch env, against the real HEAD.
		const sha = run(root, ["commit-tree", tree, "-p", parent, "-m", label]).trim();
		// Anchor so `git gc` cannot prune the object a store row names.
		run(root, ["update-ref", `${CHECKPOINT_REF_PREFIX}/${sha}`, sha]);
		return sha;
	} finally {
		// A leftover scratch index is inert and must not turn a successful checkpoint into an error.
		try {
			unlinkSync(scratch);
		} catch {
			// Nothing to clean up, or another process already removed it -- both fine.
		}
	}
}

/**
 * Restore the tree to checkpoint `sha`, including the absence of files it does not hold.
 * `git restore` never deletes, so alone it yields a union of old and new state: paths from
 * pathsAddedSince are removed first, then empty dirs pruned, then content restored. Surgical, not `git clean`.
 * First takes a checkpoint of the current tree (returned as `undoSha`) so the restore is reversible.
 * Exclusions apply to both trees, so `.pi/state`, `node_modules`, secrets etc. survive regardless of `.gitignore`
 * (tests/integration/git-checkpoint.test.ts Cases 3, 7, 8). Takes no ExtensionContext, so headless behaves the same.
 */
/**
 * Drop the anchoring ref when the store evicts a row. Best-effort and NEVER THROWS: a missing ref or a
 * moved repository must not break the turn.
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
	/** Checkpoint of the tree before the restore; restoring it undoes the restore. */
	readonly undoSha: string;
	/** Repo-root-relative paths removed because the checkpoint does not hold them. */
	readonly removed: readonly string[];
}

export function restoreCheckpoint(repoRoot: string, sha: string): RestoreOutcome {
	const root = repoTopLevel(repoRoot);
	// Before anything is removed, so deleted hand-written files stay reachable.
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
