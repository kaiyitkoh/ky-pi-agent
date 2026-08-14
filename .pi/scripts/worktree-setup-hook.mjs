#!/usr/bin/env node
/**
 * Repo-authored worktree setup hook (EXT-02).
 *
 * NOT AN EXTENSION. This is a plain Node subprocess script, invoked by
 * `pi-subagents`' own `runWorktreeSetupHook` as `spawnSync(hookPath, [],
 * { cwd: worktreePath, shell: false })` -- never loaded by Pi's extension
 * loader. It deliberately does NOT live under `.pi/extensions/`: putting it
 * there would make Pi try to auto-discover and load it as an extension,
 * which it is not (`tests/unit/extension-layout.test.ts` only walks
 * `.pi/extensions/`, so this file sits outside its scope entirely, on
 * purpose).
 *
 * WHY IT SPEAKS JAVASCRIPT, NOT POSIX `sh`. CLAUDE.md's "POSIX sh throughout"
 * rule governs shell SCRIPTS; this is a Node PROGRAM invoked as a subprocess,
 * the same category as every `.ts` extension in this repo. It has to be
 * because `fs.symlinkSync(..., "junction")` -- the load-bearing Windows
 * remedy below -- has no POSIX-`sh`-portable equivalent, and pi-subagents'
 * own contract requires a single executable file that reads stdin JSON and
 * writes stdout JSON, which `.mjs` does natively via `node`.
 *
 * THE CONTRACT, reproduced from `pi-subagents@0.49.0
 * src/runs/shared/worktree.ts:87-101, 318-379` (external; no in-repo
 * analog):
 *
 *   WorktreeSetupHookInput = {
 *     version: 1;
 *     repoRoot: string;
 *     worktreePath: string;
 *     agentCwd: string;
 *     branch: string;
 *     index: number;
 *     runId: string;
 *     baseCommit: string;
 *     agent?: string;
 *   }
 *
 * The hook receives that object as JSON on stdin and must print exactly one
 * line of JSON on stdout: `{"syntheticPaths": ["relative/path", ...]}`.
 * `syntheticPaths` entries must be relative, non-empty, and must not already
 * be tracked in git -- pi-subagents removes them before every diff/cleanup
 * pass, which is what keeps a hook-created junction or copied `.env` out of
 * the subagent's own patch output. Diagnostics go to stderr; stdout carries
 * nothing else, ever -- any stray stdout line breaks the contract for
 * whatever parses it.
 *
 * FAIL CLOSED. On any validation failure -- wrong `version`, a missing or
 * non-absolute `repoRoot`/`worktreePath`, a `worktreePath` that does not yet
 * exist, a `worktreePath` that equals or contains `repoRoot` -- this script
 * prints `{"syntheticPaths":[]}`, writes a diagnostic to stderr, and exits
 * non-zero. It never emits a half-provisioned success.
 *
 * CONTAINMENT IS ASSERTED BEFORE ANY WRITE. Provisioning "into" the parent
 * repository -- a `worktreePath` that equals or is an ancestor of
 * `repoRoot` -- is the one catastrophic failure mode here, and must be
 * impossible rather than merely unlikely (threat T-07-06).
 *
 * NODE_MODULES: A JUNCTION, NEVER AN UNQUALIFIED SYMLINK. Verified directly
 * on this machine [RESEARCH.md, executed 2026-08-15]: the two-argument form
 * of `symlinkSync` fails `EPERM` on Windows without Developer Mode or an
 * elevated shell, and that is exactly what `pi-subagents`' own
 * `linkNodeModulesIfPresent` (`worktree.ts:243-253`) calls -- then swallows
 * the error and returns `false` silently (threat T-07-09). Passing the
 * three-argument form with `"junction"` succeeds with no special privilege
 * on this same machine; on POSIX the third argument is ignored and an
 * ordinary symlink is created. If it fails anyway, this script reports the
 * failure on stderr and exits non-zero -- a degraded worktree must be
 * visible, never silent.
 *
 * .ENV: COPIED, NEVER LINKED. A shared `.env` mutated inside one worktree
 * must not be visible to every other worktree or to the parent (threat
 * T-07-08). The copy is listed in `syntheticPaths` precisely so
 * pi-subagents excludes it from diff/cleanup output and it can never be
 * committed by the subagent.
 *
 * ACCEPTED RESIDUAL (threat T-07-07, recorded in `docs/EXTENSIONS.md`): the
 * `node_modules` junction points at the PARENT's real dependency tree, not a
 * private copy. A subagent that runs a package-manager install inside its
 * "isolated" worktree mutates the parent's `node_modules` too. This is
 * accepted for this phase on cost grounds -- a per-worktree `npm ci` is the
 * isolating alternative, named here so the decision can be reversed
 * deliberately if it ever becomes unacceptable.
 */

import { copyFileSync, existsSync, symlinkSync } from "node:fs";
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
 * Emit the contract-conformant failure shape and mark the process for a
 * non-zero exit. Never calls `process.exit()` directly, so stdout/stderr are
 * flushed before Node actually exits.
 */
function fail(reason) {
	console.error(`worktree-setup-hook: ${reason}`);
	process.stdout.write(`${JSON.stringify({ syntheticPaths: [] })}\n`);
	process.exitCode = 1;
}

/** True when `a` equals `b`, or `a` is a directory ancestor of `b`. */
function isAncestorOrEqual(a, b) {
	return a === b || b.startsWith(a + sep);
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
	// See the header comment for why.
	const nodeModulesSrc = resolve(resolvedRepoRoot, "node_modules");
	const nodeModulesDst = resolve(resolvedWorktreePath, "node_modules");
	if (existsSync(nodeModulesSrc) && !existsSync(nodeModulesDst)) {
		try {
			symlinkSync(nodeModulesSrc, nodeModulesDst, "junction");
			syntheticPaths.push("node_modules");
		} catch (err) {
			fail(
				`failed to junction node_modules into the worktree: ` +
					`${err instanceof Error ? err.message : String(err)} -- a degraded worktree must be ` +
					"visible, not silent",
			);
			return;
		}
	}

	// .env: COPY, never link. A shared .env mutated by one worktree must not be
	// seen by all of them or by the parent.
	const envSrc = resolve(resolvedRepoRoot, ".env");
	const envDst = resolve(resolvedWorktreePath, ".env");
	if (existsSync(envSrc)) {
		try {
			copyFileSync(envSrc, envDst);
			syntheticPaths.push(".env");
		} catch (err) {
			fail(`failed to copy .env into the worktree: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}
	}

	// Exactly one line of JSON on stdout. Nothing else may ever be written
	// there -- diagnostics go to stderr only.
	process.stdout.write(`${JSON.stringify({ syntheticPaths })}\n`);
}

await main();
