#!/usr/bin/env node
/**
 * Worktree setup hook, run by pi-subagents as `spawnSync(hookPath, [], { cwd: worktreePath, shell: false })`.
 * It is a plain Node program, not an extension, so it lives outside `.pi/extensions/`.
 *
 * Contract: JSON on stdin (`version: 1`, `repoRoot`, `worktreePath`, `agentCwd`, `branch`, `index`,
 * `runId`, `baseCommit`, optional `agent`); exactly one stdout line `{"syntheticPaths": [...]}` of
 * relative, untracked paths that pi-subagents strips before every diff and cleanup. Diagnostics go
 * to stderr only.
 *
 * Fails closed: any validation failure prints `{"syntheticPaths":[]}` (or what was already created),
 * writes a reason to stderr and exits non-zero. Containment (worktree equal to or above the repo) is
 * checked before any write, on canonicalised paths.
 *
 * node_modules is a junction: the two-argument `symlinkSync` fails with EPERM on Windows without
 * Developer Mode. `.env` is copied, never linked, never over an existing file, and chmod 0600.
 * Nothing is skipped silently; every declined step is reported on stderr.
 *
 * Residual risk: the hook is wired at machine scope, so a worktree in any repository receives that
 * repository's `.env`, and the node_modules junction points at the parent's real dependency tree.
 */

import { chmodSync, constants, copyFileSync, existsSync, lstatSync, realpathSync, symlinkSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

/** Read the whole of stdin as a UTF-8 string. */
async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Emit the failure shape and mark the process for a non-zero exit without calling `process.exit()`,
 * so stdio flushes. `provisioned` lists what already exists so pi-subagents can clean it up.
 */
function fail(reason, provisioned = []) {
	console.error(`worktree-setup-hook: ${reason}`);
	process.stdout.write(`${JSON.stringify({ syntheticPaths: provisioned })}\n`);
	process.exitCode = 1;
}

/**
 * Real, case-folded form of a path for containment comparison. Windows paths are case-insensitive
 * and `resolve()` keeps drive-letter case; `realpathSync.native` also resolves junctions and 8.3
 * names. A path not on disk yet falls back to `resolve()`, where only the case fold applies.
 */
function canonical(p) {
	let out = resolve(p);
	try {
		out = realpathSync.native(out);
	} catch {
		// Not on disk yet: resolve() is the best available canonical form.
	}
	return process.platform === "win32" ? out.toLowerCase() : out;
}

/** True when `a` equals `b`, or `a` is a directory ancestor of `b`. */
function isAncestorOrEqual(a, b) {
	const ca = canonical(a);
	const cb = canonical(b);
	return ca === cb || cb.startsWith(ca + sep);
}

async function main() {
	let raw;
	try {
		raw = await readStdin();
	} catch (err) {
		fail(`failed to read stdin: ${err instanceof Error ? err.message : String(err)}`);
		return;
	}

	let input;
	try {
		input = JSON.parse(raw);
	} catch (err) {
		fail(`stdin was not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
		return;
	}

	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		fail(`stdin JSON was not an object, got ${JSON.stringify(input)}`);
		return;
	}

	if (input.version !== 1) {
		fail(
			`unsupported version ${JSON.stringify(input.version)} -- this hook speaks ` +
				"WorktreeSetupHookInput version 1 only",
		);
		return;
	}

	const { repoRoot, worktreePath } = input;
	if (typeof repoRoot !== "string" || repoRoot === "" || !isAbsolute(repoRoot)) {
		fail(`repoRoot must be a non-empty absolute path, got ${JSON.stringify(repoRoot)}`);
		return;
	}
	if (typeof worktreePath !== "string" || worktreePath === "" || !isAbsolute(worktreePath)) {
		fail(`worktreePath must be a non-empty absolute path, got ${JSON.stringify(worktreePath)}`);
		return;
	}

	const resolvedRepoRoot = resolve(repoRoot);
	const resolvedWorktreePath = resolve(worktreePath);

	// The one catastrophic failure mode: provisioning "into" the parent repo.
	// Must be impossible, not merely unlikely. Checked before anything else
	// that touches the filesystem.
	if (isAncestorOrEqual(resolvedWorktreePath, resolvedRepoRoot)) {
		fail(
			`worktreePath ${resolvedWorktreePath} equals or is an ancestor of repoRoot ` +
				`${resolvedRepoRoot} -- refusing to provision anywhere near the parent repository`,
		);
		return;
	}

	if (!existsSync(resolvedWorktreePath)) {
		fail(
			`worktreePath ${resolvedWorktreePath} does not exist -- this hook must run after ` +
				"`git worktree add` has already created it",
		);
		return;
	}

	const syntheticPaths = [];

	// node_modules: a junction, never the unqualified two-argument symlink form.
	const nodeModulesSrc = resolve(resolvedRepoRoot, "node_modules");
	const nodeModulesDst = resolve(resolvedWorktreePath, "node_modules");
	if (!existsSync(nodeModulesSrc)) {
		// Not a hard failure: a repository with no dependencies is legitimate, but its worktree cannot build.
		console.error(
			`worktree-setup-hook: ${nodeModulesSrc} does not exist -- the parent repository has no ` +
				"installed dependencies, so this worktree will not be able to build. Run an install in " +
				"the parent and re-spawn.",
		);
	} else if (existsSync(nodeModulesDst)) {
		// Declared synthetic although not created here, so pi-subagents keeps it out of diff and cleanup.
		console.error(
			`worktree-setup-hook: ${nodeModulesDst} already exists -- left as-is, declared synthetic so ` +
				"pi-subagents still excludes it from diff and cleanup",
		);
		syntheticPaths.push("node_modules");
	} else {
		try {
			symlinkSync(nodeModulesSrc, nodeModulesDst, "junction");
			syntheticPaths.push("node_modules");
		} catch (err) {
			fail(
				`failed to junction node_modules into the worktree: ` +
					`${err instanceof Error ? err.message : String(err)} -- a degraded worktree must be ` +
					"visible, not silent",
				syntheticPaths,
			);
			return;
		}
	}

	// .env: COPY, never link. A shared .env mutated by one worktree must not be
	// seen by all of them or by the parent.
	const envSrc = resolve(resolvedRepoRoot, ".env");
	const envDst = resolve(resolvedWorktreePath, ".env");
	// lstat, not exists: a dangling tracked `.env` symlink must count as present, or the copy would write through it.
	let envDstPresent = true;
	try {
		lstatSync(envDst);
	} catch {
		envDstPresent = false;
	}
	if (envDstPresent) {
		// A tracked `.env` is checked out by `git worktree add`; overwriting it and declaring it synthetic would
		// make pi-subagents delete it. It is the worktree's own content, so it is left alone.
		console.error(
			`worktree-setup-hook: ${envDst} already exists in the worktree -- left as-is, NOT declared ` +
				"synthetic (it is the worktree's own content, possibly tracked)",
		);
	} else if (existsSync(envSrc)) {
		try {
			copyFileSync(envSrc, envDst, constants.COPYFILE_EXCL);
			// The parent's `.env` may hold secrets and `copyFileSync` propagates the
			// source's mode, which on Windows is effectively meaningless and on POSIX
			// is whatever the source happened to carry. Set it explicitly.
			try {
				chmodSync(envDst, 0o600);
			} catch {
				// Best-effort: a filesystem that cannot express POSIX modes (or a
				// Windows volume) must not turn a successful copy into a failure.
			}
			syntheticPaths.push(".env");
		} catch (err) {
			fail(
				`failed to copy .env into the worktree: ${err instanceof Error ? err.message : String(err)}`,
				syntheticPaths,
			);
			return;
		}
	}

	// Exactly one line of JSON on stdout. Nothing else may ever be written
	// there -- diagnostics go to stderr only.
	process.stdout.write(`${JSON.stringify({ syntheticPaths })}\n`);
}

await main();
