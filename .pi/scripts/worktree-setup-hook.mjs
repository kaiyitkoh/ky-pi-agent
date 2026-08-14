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
 * non-zero. It never emits a half-provisioned success, and since WR-06 it no
 * longer emits a half-provisioned FAILURE either: a failure that happens after
 * something was created reports what exists (see {@link fail}). Every one of
 * these branches is exercised by `tests/integration/worktree-build.test.ts`'s
 * REFUSALS table -- before WR-08 they had no coverage at all, and deleting the
 * containment check outright would have kept the whole suite green.
 *
 * CONTAINMENT IS ASSERTED BEFORE ANY WRITE. Provisioning "into" the parent
 * repository -- a `worktreePath` that equals or is an ancestor of
 * `repoRoot` -- is the one catastrophic failure mode here, and must be
 * impossible rather than merely unlikely (threat T-07-06). Compared on
 * canonicalised, case-folded real paths, not raw strings -- see
 * {@link canonical} for why a case-sensitive comparison did not meet that bar
 * on this project's own target platform (WR-04).
 *
 * NOTHING IS SKIPPED SILENTLY. Every branch that declines to provision says so
 * on stderr (WR-05, WR-07): a parent with no `node_modules` (the worktree will
 * not build), a worktree that already has one (left as-is but still DECLARED
 * synthetic, or pi-subagents walks it in every diff/cleanup pass), and a
 * worktree that already has a `.env` (left as-is and NOT declared synthetic,
 * because it is the worktree's own content and may be tracked).
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
 * .ENV: COPIED, NEVER LINKED, AND NEVER OVER AN EXISTING FILE. A shared `.env`
 * mutated inside one worktree must not be visible to every other worktree or
 * to the parent (threat T-07-08). The copy is listed in `syntheticPaths`
 * precisely so pi-subagents excludes it from diff/cleanup output and it can
 * never be committed by the subagent. The destination is chmod'd 0600
 * best-effort rather than inheriting whatever mode the source carried.
 *
 * ACCEPTED RESIDUAL (WR-03, recorded in `docs/EXTENSIONS.md` alongside T-07-07
 * and T-07-08): this hook is wired at MACHINE scope by
 * `bin/bootstrap.sh#merge_subagent_config`, because pi-subagents' config file
 * is user-scope and the hook path must be absolute. So a worktree-isolated
 * subagent spawned in ANY repository on this machine copies THAT repository's
 * `.env` into a fresh worktree directory pi-subagents places wherever it
 * likes, commonly outside the repo. The `.env` is not shared and is declared
 * synthetic, but it is a secret-bearing file leaving its repository's
 * directory tree, and that consequence is a property of the machine-scope
 * wiring rather than of any one project.
 *
 * ACCEPTED RESIDUAL (threat T-07-07, recorded in `docs/EXTENSIONS.md`): the
 * `node_modules` junction points at the PARENT's real dependency tree, not a
 * private copy. A subagent that runs a package-manager install inside its
 * "isolated" worktree mutates the parent's `node_modules` too. This is
 * accepted for this phase on cost grounds -- a per-worktree `npm ci` is the
 * isolating alternative, named here so the decision can be reversed
 * deliberately if it ever becomes unacceptable.
 */

import { chmodSync, copyFileSync, existsSync, realpathSync, symlinkSync } from "node:fs";
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
 *
 * WR-06: `provisioned` is what has ALREADY been created on disk at the moment
 * of the failure, and it is reported rather than assumed empty. The `.env`
 * copy runs after the `node_modules` junction, so a `copyFileSync` throw used
 * to print `{"syntheticPaths":[]}` while the junction existed -- a
 * half-provisioned FAILURE whose reported state was wrong. pi-subagents reads
 * the declared `syntheticPaths` for diff and cleanup, so an undeclared
 * junction shows up in the subagent's patch output and may be walked during
 * cleanup. Callers that have provisioned nothing yet simply omit the argument.
 */
function fail(reason, provisioned = []) {
	console.error(`worktree-setup-hook: ${reason}`);
	process.stdout.write(`${JSON.stringify({ syntheticPaths: provisioned })}\n`);
	process.exitCode = 1;
}

/**
 * Canonical form of a path for containment comparison (WR-04).
 *
 * `resolve()` alone is NOT enough on this project's own target platform.
 * Windows paths are case-insensitive and `resolve()` does not normalise
 * drive-letter case, so `c:\repo` and `C:\repo` are the same directory and
 * compare unequal -- a `worktreePath` spelled with the other case would pass
 * the containment guard and the hook would then junction and copy INTO the
 * parent repository. The same holds for 8.3 short names (`C:\Users\ADMIN~1\`)
 * and for a repoRoot reached through a junction alias. The guard's own stated
 * bar is "impossible, not merely unlikely", and a case-sensitive string
 * comparison does not meet it.
 *
 * `realpathSync.native` resolves junctions, symlinks and short names to the
 * real on-disk path. It throws when the path does not exist yet -- which is a
 * legitimate state here, since the worktree existence check runs AFTER
 * containment on purpose -- so that case falls back to `resolve()` alone, and
 * the case-fold below still covers the drive-letter and casing forms.
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
	// See the header comment for why.
	const nodeModulesSrc = resolve(resolvedRepoRoot, "node_modules");
	const nodeModulesDst = resolve(resolvedWorktreePath, "node_modules");
	if (!existsSync(nodeModulesSrc)) {
		// WR-05 case 1. This used to be a SILENT skip: the hook exited 0 reporting
		// `syntheticPaths: []`, and the subagent got an unbuildable worktree with
		// no diagnostic -- indistinguishable on stdout from a successful no-op, and
		// the exact failure this hook exists to prevent. The header's own rule is
		// "a degraded worktree must be visible, never silent". Not a hard failure,
		// because a repository with no dependencies is a legitimate state.
		console.error(
			`worktree-setup-hook: ${nodeModulesSrc} does not exist -- the parent repository has no ` +
				"installed dependencies, so this worktree will not be able to build. Run an install in " +
				"the parent and re-spawn.",
		);
	} else if (existsSync(nodeModulesDst)) {
		// WR-05 case 2. Also a silent skip before, and worse than case 1: it left
		// node_modules OUT of syntheticPaths, so pi-subagents treated the directory
		// as real worktree content and included it in every diff/cleanup pass --
		// precisely the consequence the syntheticPaths contract exists to avoid.
		// Declared synthetic even though this hook did not create it.
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
	if (existsSync(envDst)) {
		// WR-07, and the most dangerous of the five: this copy was UNCONDITIONAL.
		// The hook is wired at machine scope (WR-03), so it runs in repositories
		// this project has never seen. Where `.env` is TRACKED -- bad practice but
		// common for non-secret defaults -- `git worktree add` checks it out, and
		// the hook then silently overwrote that tracked file with the parent's copy
		// AND declared it synthetic, which makes pi-subagents delete it before every
		// diff/cleanup pass. The subagent would work against a replaced file that
		// is then removed. Skipping is the only safe answer, and it must not be
		// declared synthetic either: the worktree's own `.env` is real content.
		console.error(
			`worktree-setup-hook: ${envDst} already exists in the worktree -- left as-is, NOT declared ` +
				"synthetic (it is the worktree's own content, possibly tracked)",
		);
	} else if (existsSync(envSrc)) {
		try {
			copyFileSync(envSrc, envDst);
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
