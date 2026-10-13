/**
 * A subagent's git worktree can build, not merely check out: on one fixture the worktree first genuinely fails (untracked
 * node_modules and .env do not travel), then the shipped `.pi/scripts/worktree-setup-hook.mjs` runs and it builds.
 * Whether pi-subagents invokes the hook at runtime is third-party behaviour and a runbook check, not proven here.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { gitResult, headSha, repoRoot } from "../helpers/git.ts";
import { addWorktree, makeTempRepoWithNodeModulesAndEnv, removeWorktree } from "../helpers/worktree.ts";

/** Absolute, resolved once -- never a write target, only ever read from. */
const HOOK_PATH = join(repoRoot(), ".pi", "scripts", "worktree-setup-hook.mjs");
const HOOK_SOURCE = readFileSync(HOOK_PATH, "utf-8");

/** Cleanup callbacks, run in LIFO order so a worktree is removed before its container directory is deleted. */
let cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.reverse()) {
		try {
			cleanup();
		} catch {
			// A failed cleanup must never mask the test's own result.
		}
	}
	cleanups = [];
});

/** `node src/index.js` in `cwd` -- the fixture's own real build proxy, real subprocess. */
function runBuild(cwd: string): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync(process.execPath, [join("src", "index.js")], {
		cwd,
		encoding: "utf-8",
		shell: false,
		windowsHide: true,
	});
	if (result.error) {
		throw new Error(`node src/index.js failed to launch in "${cwd}": ${result.error.message}`);
	}
	return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("EXT-02 -- a fresh worktree provably cannot build, and the shipped hook provably fixes it", () => {
	it(
		"build succeeds in the parent -> fails in a fresh worktree -> " +
			"the shipped hook fixes it -> build succeeds again, on one fixture",
		() => {
			// A temp repo with a tracked build proxy and untracked node_modules/dep and .env.
			const repo = makeTempRepoWithNodeModulesAndEnv("kypi-worktree-build-");
			cleanups.push(() => rmSync(repo, { recursive: true, force: true, maxRetries: 3 }));

			// Fixture sanity: the original repo builds.
			const parentRun = runBuild(repo);
			expect(parentRun.status, `fixture sanity: the parent repo must build cleanly: ${parentRun.stderr}`).toBe(0);
			expect(parentRun.stdout).toContain("WORKTREE_BUILD_OK");

			// Vacuity guard: were these tracked, `git worktree add` would carry them and everything below is a tautology.
			const lsFiles = gitResult(["ls-files", "--", "node_modules", ".env"], repo);
			expect(lsFiles.status, `git ls-files failed in ${repo}`).toBe(0);
			expect(
				lsFiles.stdout.trim(),
				"vacuity guard: node_modules and .env must be genuinely untracked, or the negative proof below proves nothing",
			).toBe("");

			// pi-subagents' own `git worktree add` shape, under os.tmpdir().
			const worktreeContainer = mkdtempSync(join(tmpdir(), "kypi-worktree-dst-"));
			const worktreePath = join(worktreeContainer, "wt");
			const branch = `test-branch-${randomUUID()}`;
			addWorktree(repo, worktreePath, branch);
			cleanups.push(() => rmSync(worktreeContainer, { recursive: true, force: true, maxRetries: 3 }));
			cleanups.push(() => removeWorktree(repo, worktreePath, branch));

			// Untracked files do not travel to a fresh worktree.
			expect(
				existsSync(join(worktreePath, "node_modules")),
				"node_modules must be absent from a fresh worktree -- git worktree add carries only tracked content",
			).toBe(false);
			expect(existsSync(join(worktreePath, ".env")), ".env must be absent from a fresh worktree").toBe(false);

			// The worktree cannot build yet.
			const failedRun = runBuild(worktreePath);
			expect(failedRun.status, "the worktree build must fail before the remedy runs").not.toBe(0);
			expect(
				failedRun.stderr,
				"the failure must name the actual missing module, not fail for an unrelated reason -- " +
					"otherwise a fixture broken for a different cause could be mistaken for the effect under test",
			).toMatch(/Cannot find module ['"]dep['"]/);

			// The remedy: the real shipped hook, spawned as pi-subagents' runWorktreeSetupHook would spawn it.
			const payload = {
				version: 1,
				repoRoot: repo,
				worktreePath,
				agentCwd: worktreePath,
				branch,
				index: 0,
				runId: randomUUID(),
				baseCommit: headSha(repo),
			};
			const hookRun = spawnSync(process.execPath, [HOOK_PATH], {
				cwd: worktreePath,
				encoding: "utf-8",
				shell: false,
				windowsHide: true,
				input: JSON.stringify(payload),
			});
			expect(hookRun.status, `the shipped hook must exit 0 on a valid payload: ${hookRun.stderr}`).toBe(0);
			const hookLines = hookRun.stdout
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line !== "");
			expect(hookLines.length, "the hook must print exactly one line of JSON on stdout").toBe(1);
			const hookOutput = JSON.parse(hookLines[0]) as { syntheticPaths: string[] };
			expect(
				[...hookOutput.syntheticPaths].sort(),
				"the hook must report both node_modules and .env as the paths it synthesised",
			).toEqual([".env", "node_modules"]);

			// The same program in the same worktree now builds.
			const fixedRun = runBuild(worktreePath);
			expect(fixedRun.status, `the worktree build must succeed after the hook runs: ${fixedRun.stderr}`).toBe(0);
			expect(fixedRun.stdout).toContain("WORKTREE_BUILD_OK");

		},
	);
});

/** Spawns the shipped hook with `payload` on stdin from the OS temp dir, so a bug cannot write into this repository. */
function runHook(
	payload: unknown,
	cwd: string = tmpdir(),
): { status: number | null; stderr: string; syntheticPaths: string[]; rawStdout: string } {
	const run = spawnSync(process.execPath, [HOOK_PATH], {
		cwd,
		encoding: "utf-8",
		shell: false,
		windowsHide: true,
		input: JSON.stringify(payload),
	});
	const lines = run.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	// The contract is one JSON line on stdout, on success and failure alike.
	const parsed = lines.length === 1 ? (JSON.parse(lines[0]) as { syntheticPaths: string[] }) : { syntheticPaths: [] };
	return { status: run.status, stderr: run.stderr, syntheticPaths: parsed.syntheticPaths, rawStdout: run.stdout };
}

/**
 * The hook's fail-closed validation branches, above all the containment guard. The drive-letter cases assert the refusal
 * reason, not the exit code: both refusals exit 1, so a status check survives deleting the guard.
 */
describe("EXT-02 / WR-08 -- the hook fails closed on every invalid payload", () => {
	/** A directory that exists, so `worktreePath does not exist` is not what trips a case. */
	function scratch(prefix: string): string {
		const dir = mkdtempSync(join(tmpdir(), prefix));
		cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
		return dir;
	}

	it("refuses every malformed payload with exit 1, an empty syntheticPaths and a stated reason", () => {
		const repo = scratch("kypi-hook-repo-");
		const worktree = scratch("kypi-hook-wt-");
		const nonexistent = join(tmpdir(), `kypi-hook-nope-${randomUUID()}`);

		const refusals: { label: string; payload: unknown }[] = [
			{ label: "not an object", payload: "just a string" },
			{ label: "an array", payload: [{ version: 1 }] },
			{ label: "null", payload: null },
			{ label: "wrong version", payload: { version: 2, repoRoot: repo, worktreePath: worktree } },
			{ label: "missing version", payload: { repoRoot: repo, worktreePath: worktree } },
			{ label: "relative repoRoot", payload: { version: 1, repoRoot: "rel/ative", worktreePath: worktree } },
			{ label: "empty repoRoot", payload: { version: 1, repoRoot: "", worktreePath: worktree } },
			{ label: "non-string repoRoot", payload: { version: 1, repoRoot: 42, worktreePath: worktree } },
			{ label: "relative worktreePath", payload: { version: 1, repoRoot: repo, worktreePath: "rel" } },
			{ label: "empty worktreePath", payload: { version: 1, repoRoot: repo, worktreePath: "" } },
			{ label: "worktreePath IS repoRoot", payload: { version: 1, repoRoot: repo, worktreePath: repo } },
			{
				label: "worktreePath is an ANCESTOR of repoRoot",
				payload: { version: 1, repoRoot: join(repo, "nested"), worktreePath: repo },
			},
			{ label: "worktreePath does not exist", payload: { version: 1, repoRoot: repo, worktreePath: nonexistent } },
		];

		const survivors: string[] = [];
		for (const { label, payload } of refusals) {
			const run = runHook(payload);
			if (run.status !== 1) survivors.push(`${label}: exit ${run.status} (stdout: ${run.rawStdout.trim()})`);
			else if (run.syntheticPaths.length !== 0) survivors.push(`${label}: reported ${JSON.stringify(run.syntheticPaths)}`);
			else if (run.stderr.trim() === "") survivors.push(`${label}: refused silently, with no reason on stderr`);
		}
		expect(
			survivors,
			"every one of these must fail closed: exit 1, {\"syntheticPaths\":[]} on stdout, and a stated " +
				"reason on stderr. A refusal that exits 0, or reports paths it did not create, or says nothing, " +
				"is a hook a caller cannot distinguish from a successful no-op",
		).toEqual([]);

		// Nothing may have been written into the parent repository by the containment refusals.
		expect(
			existsSync(join(repo, "node_modules")) || existsSync(join(repo, ".env")),
			"the containment refusal must run BEFORE any write -- provisioning into the parent repository " +
				"is the one catastrophic failure mode this guard exists for (T-07-06)",
		).toBe(false);
	});

	it("WR-04 -- containment is decided on the CANONICALISED path: realpathSync.native for paths on disk", () => {
		// On existing paths `realpathSync.native` already normalises drive-letter case, so this proves that mechanism; the
		// next case reaches the branch where the case fold is the only guard.
		const repo = scratch("kypi-hook-case-");
		const swapped = repo.replace(/^([a-zA-Z]):/, (_m, drive: string) =>
			`${drive === drive.toLowerCase() ? drive.toUpperCase() : drive.toLowerCase()}:`,
		);
		const differsOnlyByCase = swapped !== repo && swapped.toLowerCase() === repo.toLowerCase();
		if (process.platform !== "win32" || !differsOnlyByCase) {
			// Say so rather than pass silently, so a POSIX green run is not mistaken for coverage.
			console.log(
				`WR-04 case-folding: not applicable on platform=${process.platform} (repo=${repo}) -- ` +
					"the assertion below still runs against the identical-spelling form",
			);
			const same = runHook({ version: 1, repoRoot: repo, worktreePath: repo });
			expect(same.status, "worktreePath === repoRoot must always be refused").toBe(1);
			return;
		}

		const run = runHook({ version: 1, repoRoot: repo, worktreePath: swapped });
		expect(
			run.status,
			`a worktreePath that differs from repoRoot ONLY by drive-letter case is the SAME directory on ` +
				`Windows and must be refused. repoRoot=${repo} worktreePath=${swapped}`,
		).toBe(1);
		expect(
			run.stderr,
			"and it must be refused BY THE CONTAINMENT GUARD, not incidentally by some later check -- exit 1 " +
				"alone cannot tell those apart",
		).toContain("equals or is an ancestor of");
		expect(run.syntheticPaths).toEqual([]);
		expect(
			existsSync(join(repo, "node_modules")),
			"nothing may have been provisioned into the parent under a differently-cased spelling",
		).toBe(false);
	});

	it("WR2-01 -- the case-fold is the ONLY guard when realpathSync.native throws, and this is the fixture that reaches it", () => {
		// When the path is not on disk `canonical()` falls back to `resolve()`, which keeps case, so the fold is the whole
		// guard. Containment is checked before existence, so with both paths absent only the reason tells them apart.
		if (process.platform !== "win32") {
			console.log(`WR2-01: not applicable on platform=${process.platform} -- POSIX paths are case-sensitive`);
			return;
		}
		const parent = scratch("kypi-hook-fold-");
		// Neither is created: worktreePath is an ancestor of repoRoot spelled in different case.
		const worktreePath = join(parent, "NotYetCreated");
		const repoRoot = join(parent, "notyetcreated", "child");
		expect(existsSync(worktreePath), "the fixture is only meaningful while this path is absent").toBe(false);
		expect(existsSync(repoRoot), "the fixture is only meaningful while this path is absent").toBe(false);

		const run = runHook({ version: 1, repoRoot, worktreePath });
		expect(
			run.stderr,
			`a worktreePath that is an ANCESTOR of repoRoot differing only by case is the same directory on ` +
				`Windows, and the containment guard is what must say so. repoRoot=${repoRoot} ` +
				`worktreePath=${worktreePath}. stderr was: ${run.stderr.trim()}`,
		).toContain("equals or is an ancestor of");
		expect(run.status).toBe(1);
		expect(run.syntheticPaths).toEqual([]);
	});

	it("WR2-01 -- and realpathSync.native is the ONLY guard when the alias is a junction, which no case-fold can see through", () => {
		// The converse: a junction alias is a different pathname only `realpathSync.native` resolves. A miss here would copy
		// .env out of the repository into its parent.
		if (process.platform !== "win32") {
			console.log(`WR2-01 junction: not applicable on platform=${process.platform}`);
			return;
		}
		const parent = scratch("kypi-hook-junction-");
		const real = join(parent, "real");
		const repoRoot = join(real, "child");
		mkdirSync(repoRoot, { recursive: true });
		const alias = join(parent, "alias");
		try {
			symlinkSync(real, alias, "junction");
		} catch (err) {
			throw new Error(
				`this case needs a junction and could not create one (${err instanceof Error ? err.message : String(err)}). ` +
					"Skipping silently would turn a green run into evidence of nothing, so it fails instead",
			);
		}
		expect(alias.toLowerCase(), "the alias must not be a mere case variant, or this proves the fold again").not.toBe(
			real.toLowerCase(),
		);

		const run = runHook({ version: 1, repoRoot, worktreePath: alias });
		expect(
			run.stderr,
			`worktreePath ${alias} is a junction to ${real}, the PARENT of repoRoot ${repoRoot}. Only ` +
				`realpathSync.native can see that. stderr was: ${run.stderr.trim()}`,
		).toContain("equals or is an ancestor of");
		expect(run.status).toBe(1);
		expect(run.syntheticPaths).toEqual([]);
		expect(
			existsSync(join(real, "node_modules")) || existsSync(join(real, ".env")),
			"a containment miss here provisions OUT of the repository and into the directory containing it",
		).toBe(false);
	});

	it("a dangling .env symlink in the worktree is left alone, never written through", (ctx) => {
		const repo = scratch("kypi-hook-dangle-");
		writeFileSync(join(repo, ".env"), "SECRET=parent\n", "utf-8");
		const worktree = scratch("kypi-hook-dangle-wt-");
		const outside = join(scratch("kypi-hook-dangle-target-"), "leaked.env");
		try {
			symlinkSync(outside, join(worktree, ".env"), "file");
		} catch {
			ctx.skip();
		}
		const run = runHook({ version: 1, repoRoot: repo, worktreePath: worktree });
		expect(run.status, run.stderr).toBe(0);
		expect(existsSync(outside), "the parent's secrets were copied through the symlink").toBe(false);
		expect(run.syntheticPaths).not.toContain(".env");
	});

	it("WR-05/WR-07 -- every declined provisioning step says so, and declares the right synthetic paths", () => {
		// A: no node_modules and no .env in the parent. Exits 0, but must not be silent.
		const bareRepo = scratch("kypi-hook-bare-");
		const bareWorktree = scratch("kypi-hook-bare-wt-");
		const bare = runHook({ version: 1, repoRoot: bareRepo, worktreePath: bareWorktree });
		expect(bare.status, `a parent with no dependencies is not a failure: ${bare.stderr}`).toBe(0);
		expect(bare.syntheticPaths, "nothing was provisioned, so nothing may be declared synthetic").toEqual([]);
		expect(
			bare.stderr,
			"WR-05: this used to be a SILENT skip -- the subagent got an unbuildable worktree with no " +
				"diagnostic, indistinguishable on stdout from a successful no-op",
		).toContain("does not exist");

		// B: the worktree already has both. Leave them alone, say so, still declare node_modules synthetic but not .env.
		const repo = scratch("kypi-hook-exists-");
		mkdirSync(join(repo, "node_modules"), { recursive: true });
		writeFileSync(join(repo, "node_modules", "marker.txt"), "PARENT\n", "utf-8");
		writeFileSync(join(repo, ".env"), "FROM=parent\n", "utf-8");

		const worktree = scratch("kypi-hook-exists-wt-");
		mkdirSync(join(worktree, "node_modules"), { recursive: true });
		writeFileSync(join(worktree, "node_modules", "marker.txt"), "WORKTREE\n", "utf-8");
		writeFileSync(join(worktree, ".env"), "FROM=worktree-tracked\n", "utf-8");

		const run = runHook({ version: 1, repoRoot: repo, worktreePath: worktree });
		expect(run.status, `leaving existing content alone is not a failure: ${run.stderr}`).toBe(0);
		expect(
			readFileSync(join(worktree, ".env"), "utf-8"),
			"WR-07, the most dangerous of the five: the .env copy was UNCONDITIONAL. In a repository where " +
				".env is TRACKED, git worktree add checks it out and the hook silently overwrote it with the " +
				"parent's -- then declared it synthetic, which makes pi-subagents DELETE it before every " +
				"diff/cleanup pass",
		).toBe("FROM=worktree-tracked\n");
		expect(
			readFileSync(join(worktree, "node_modules", "marker.txt"), "utf-8"),
			"an existing worktree node_modules must be left exactly as it was",
		).toBe("WORKTREE\n");
		expect(
			run.syntheticPaths,
			"WR-05 case 2: node_modules must STILL be declared synthetic even though this hook did not " +
				"create it, or pi-subagents treats it as real worktree content and walks it in every " +
				"diff/cleanup pass. .env must NOT be, because the worktree's own .env is real content and " +
				"may be tracked",
		).toEqual(["node_modules"]);
		expect(run.stderr, "the node_modules skip must be stated").toContain("already exists");
		expect(run.stderr, "the .env skip must be stated too").toContain("already exists in the worktree");
	});

	it("WR-06 -- a failure AFTER provisioning reports what exists, not an empty list", () => {
		// A .env copy failing after the junction must not report an empty provisioned state. Forced by making the source
		// .env a directory, so copyFileSync throws.
		const repo = scratch("kypi-hook-partial-");
		mkdirSync(join(repo, "node_modules"), { recursive: true });
		writeFileSync(join(repo, "node_modules", "marker.txt"), "PARENT\n", "utf-8");
		mkdirSync(join(repo, ".env"), { recursive: true }); // a DIRECTORY, so the copy throws

		const worktree = scratch("kypi-hook-partial-wt-");
		const run = runHook({ version: 1, repoRoot: repo, worktreePath: worktree });

		expect(run.status, `the .env copy must genuinely fail for this case to mean anything: ${run.stderr}`).toBe(1);
		expect(
			existsSync(join(worktree, "node_modules")),
			"fixture sanity: the junction must have been created BEFORE the .env copy failed, or this case " +
				"is not exercising the half-provisioned shape at all",
		).toBe(true);
		expect(
			run.syntheticPaths,
			"WR-06: fail() must report what actually exists. pi-subagents reads the declared syntheticPaths " +
				"for diff and cleanup, so an undeclared junction appears in the subagent's patch output",
		).toEqual(["node_modules"]);
	});
});

describe("EXT-02 -- the link mechanism the hook depends on is measured, not assumed", () => {
	it("the junction form (fs.symlinkSync(target, link, \"junction\")) works unconditionally", () => {
		const base = mkdtempSync(join(tmpdir(), "kypi-link-mechanism-"));
		try {
			const target = join(base, "target");
			mkdirSync(target, { recursive: true });
			writeFileSync(join(target, "f.txt"), "hi\n", "utf-8");

			const junctionLink = join(base, "junction-link");
			// The hook's own node_modules mechanism, load-bearing for the positive proof, so it must work on this machine.
			symlinkSync(target, junctionLink, "junction");
			expect(
				readFileSync(join(junctionLink, "f.txt"), "utf-8"),
				"a junction must resolve through to the target's real contents",
			).toBe("hi\n");
		} finally {
			rmSync(base, { recursive: true, force: true, maxRetries: 3 });
		}
	});

	it("the unqualified two-argument form is MEASURED, not asserted -- outcome is environment-dependent", () => {
		const base = mkdtempSync(join(tmpdir(), "kypi-link-mechanism-unqualified-"));
		try {
			const target = join(base, "target");
			mkdirSync(target, { recursive: true });
			writeFileSync(join(target, "f.txt"), "hi\n", "utf-8");

			const plainLink = join(base, "plain-link");
			let outcome: "succeeded" | { code: string | undefined; message: string };
			try {
				symlinkSync(target, plainLink);
				outcome = "succeeded";
			} catch (err) {
				const nodeErr = err as NodeJS.ErrnoException;
				outcome = { code: nodeErr.code, message: nodeErr.message };
			}

			// Whether the unqualified form fails is environment-dependent (Developer Mode, elevation, POSIX): report, do not assert.
			if (outcome === "succeeded") {
				console.log(
					"MEASURED on this machine: unqualified fs.symlinkSync(target, link) SUCCEEDED " +
						"(Developer Mode or elevation is active here).",
				);
			} else {
				console.log(
					`MEASURED on this machine: unqualified fs.symlinkSync(target, link) FAILED ` +
						`code=${outcome.code} message=${outcome.message}`,
				);
			}
			// The only universal claim: it succeeds or throws an Error, never hangs or silently no-ops.
			expect(outcome === "succeeded" || typeof outcome.message === "string").toBe(true);
		} finally {
			rmSync(base, { recursive: true, force: true, maxRetries: 3 });
		}
	});

	it("the shipped hook contains no unqualified two-argument fs.symlinkSync( call (regression guard)", () => {
		// pi-subagents' unqualified symlink swallows EPERM; guard against the hook reintroducing it. The pattern matches only
		// a real two-identifier call, not the hook header's `symlinkSync(..., "junction")` prose.
		const unqualifiedCallPattern = /symlinkSync\(\s*[A-Za-z_$][\w.]*\s*,\s*[A-Za-z_$][\w.]*\s*\)/;
		const match = HOOK_SOURCE.match(unqualifiedCallPattern);
		expect(
			match,
			`found an unqualified two-argument symlinkSync( call in the shipped hook: ${match?.[0]} -- ` +
				'every call must pass "junction" as a third argument',
		).toBeNull();
	});
});
