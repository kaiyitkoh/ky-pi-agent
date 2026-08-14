/**
 * EXT-02 (ROADMAP criterion 4) -- proof that a subagent in an isolated git
 * worktree can BUILD, not merely check out.
 *
 * SCOPE BOUNDARY. This test exercises real `git worktree` behaviour and this
 * repo's own `.pi/scripts/worktree-setup-hook.mjs` (built and manually
 * proved in 07-02-SUMMARY.md). It says NOTHING about whether `pi-subagents`
 * actually invokes the hook at runtime -- that is third-party runtime
 * behaviour, nothing was ever executed against a real `pi-subagents` during
 * research (07-VALIDATION.md's Manual-Only Verifications table, row 1), and
 * it belongs to the runbook entry plan 07-13 writes.
 *
 * METHODOLOGY, following `tests/unit/npmrc-policy.test.ts` Group B
 * (lines 273-303: "hardened prefix" paired with "unhardened prefix... Not
 * optional. Without this, the assertion above could be passing because the
 * fixture is inert"). A remedied case's pass could be a fixture artifact
 * unless the SAME fixture is first proven to fail under the unremedied
 * mechanism. Describe block 1 below proves, in this order, on ONE fixture:
 * the parent repo builds -> the worktree lacks the untracked files -> the
 * worktree genuinely FAILS to build -> the shipped hook runs and reports
 * what it provisioned -> the SAME worktree now builds. Describe block 2
 * measures (does not assume) the Windows junction-vs-symlink split the hook
 * depends on, per 07-VALIDATION.md's Manual-Only Verifications row 2:
 * "assert the remedy works, do not assert the failure mode is universal."
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { headSha, repoRoot } from "../helpers/git.ts";
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
			// Best-effort teardown -- a failed cleanup must never mask the
			// test's own pass/fail result.
		}
	}
	cleanups = [];
});

/** One real, synchronous `git` invocation -- matches `tests/helpers/git.ts`'s own spawn discipline. */
function git(args: string[], cwd: string): { stdout: string; status: number | null } {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	if (result.error) {
		throw new Error(`git ${args.join(" ")} failed to launch in "${cwd}": ${result.error.message}`);
	}
	return { stdout: result.stdout ?? "", status: result.status };
}

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
			// Steps 1-3 (tests/helpers/worktree.ts): a fresh temp repo with a
			// tracked src/index.js build proxy plus genuinely UNTRACKED
			// node_modules/dep and .env. assertUntracked() inside this helper
			// already threw if either path were somehow tracked.
			const repo = makeTempRepoWithNodeModulesAndEnv("kypi-worktree-build-");
			cleanups.push(() => rmSync(repo, { recursive: true, force: true, maxRetries: 3 }));

			// Step 4: fixture sanity. The ORIGINAL repo must build. If this
			// fails, everything below measures a broken fixture, not the
			// worktree.
			const parentRun = runBuild(repo);
			expect(parentRun.status, `fixture sanity: the parent repo must build cleanly: ${parentRun.stderr}`).toBe(0);
			expect(parentRun.stdout).toContain("WORKTREE_BUILD_OK");

			// Untracked-ness guard (vacuity guard), asserted directly in this
			// file rather than only trusted from the helper: if `node_modules`
			// or `.env` were somehow tracked, `git worktree add` would carry
			// them and every assertion below would be a tautology.
			const lsFiles = git(["ls-files", "--", "node_modules", ".env"], repo);
			expect(lsFiles.status, `git ls-files failed in ${repo}`).toBe(0);
			expect(
				lsFiles.stdout.trim(),
				"vacuity guard: node_modules and .env must be genuinely untracked, or the negative proof below proves nothing",
			).toBe("");

			// Step 5: a real `git worktree add`, mirroring pi-subagents' own
			// invocation shape exactly (worktree.ts:393). worktreePath sits
			// under os.tmpdir(), never inside repo and never inside this
			// repository.
			const worktreeContainer = mkdtempSync(join(tmpdir(), "kypi-worktree-dst-"));
			const worktreePath = join(worktreeContainer, "wt");
			const branch = `test-branch-${randomUUID()}`;
			addWorktree(repo, worktreePath, branch);
			cleanups.push(() => rmSync(worktreeContainer, { recursive: true, force: true, maxRetries: 3 }));
			cleanups.push(() => removeWorktree(repo, worktreePath, branch));

			// Step 6: the negative proof. Untracked files genuinely do not
			// travel to a fresh worktree.
			expect(
				existsSync(join(worktreePath, "node_modules")),
				"node_modules must be absent from a fresh worktree -- git worktree add carries only tracked content",
			).toBe(false);
			expect(existsSync(join(worktreePath, ".env")), ".env must be absent from a fresh worktree").toBe(false);

			// Step 7: the worktree genuinely CANNOT build yet.
			const failedRun = runBuild(worktreePath);
			expect(failedRun.status, "the worktree build must fail before the remedy runs").not.toBe(0);
			expect(
				failedRun.stderr,
				"the failure must name the actual missing module, not fail for an unrelated reason -- " +
					"otherwise a fixture broken for a different cause could be mistaken for the effect under test",
			).toMatch(/Cannot find module ['"]dep['"]/);

			// Step 8: the remedy -- the REAL shipped hook
			// (.pi/scripts/worktree-setup-hook.mjs), spawned exactly as
			// pi-subagents' own runWorktreeSetupHook would spawn it, never an
			// inline reimplementation of what it does.
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

			// Step 9: the positive proof -- criterion 4. The SAME program, in
			// the SAME worktree, now builds.
			const fixedRun = runBuild(worktreePath);
			expect(fixedRun.status, `the worktree build must succeed after the hook runs: ${fixedRun.stderr}`).toBe(0);
			expect(fixedRun.stdout).toContain("WORKTREE_BUILD_OK");

			// Step 10 (cleanup) happens in afterEach via the cleanups[] pushed
			// above, run LIFO: removeWorktree, then the container directory,
			// then the repo.
		},
	);
});

/**
 * Spawn the SHIPPED hook with `payload` on stdin and parse its one line of
 * stdout. `cwd` defaults to the OS temp directory: the hook's behaviour must
 * not depend on where it was launched from, and launching it inside this
 * repository would risk a bug writing here.
 */
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
	// The contract is ONE line of JSON on stdout, on success AND on failure.
	// Parsing it here rather than in each case means a hook that printed
	// nothing, or printed prose, fails every case below with a clear message.
	const parsed = lines.length === 1 ? (JSON.parse(lines[0]) as { syntheticPaths: string[] }) : { syntheticPaths: [] };
	return { status: run.status, stderr: run.stderr, syntheticPaths: parsed.syntheticPaths, rawStdout: run.stdout };
}

/**
 * WR-08 -- the hook's fail-closed validation branches, which had ZERO coverage.
 *
 * `worktree-build.test.ts`'s Pattern C chain is a genuinely strong proof of the
 * happy path, and it covers exactly one hook invocation with one valid payload.
 * Nothing exercised non-object stdin, malformed JSON, a wrong `version`, a
 * non-absolute or empty `repoRoot`/`worktreePath`, a `worktreePath` that does
 * not exist, or -- most importantly -- the containment guard the hook's own
 * header calls "the one catastrophic failure mode here". A regression that
 * deleted `isAncestorOrEqual` outright would have kept the entire suite green.
 * MUTATION-VERIFIED: see this file's commit message for the recorded run.
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

		// And the catastrophic case specifically: nothing may have been written
		// into the parent repository by the containment refusals above.
		expect(
			existsSync(join(repo, "node_modules")) || existsSync(join(repo, ".env")),
			"the containment refusal must run BEFORE any write -- provisioning into the parent repository " +
				"is the one catastrophic failure mode this guard exists for (T-07-06)",
		).toBe(false);
	});

	it("WR-04 -- containment holds when the worktreePath is spelled with different case (Windows)", () => {
		// `resolve()` does not normalise drive-letter case and Windows paths are
		// case-insensitive, so `c:\repo` and `C:\repo` are ONE directory that a
		// raw `===` calls different. Before the canonical() fix the hook would
		// have junctioned and copied into the parent. On POSIX the two spellings
		// really are different directories, so this case asserts the platform's
		// own truth rather than a universal.
		const repo = scratch("kypi-hook-case-");
		const swapped = repo.replace(/^([a-zA-Z]):/, (_m, drive: string) =>
			`${drive === drive.toLowerCase() ? drive.toUpperCase() : drive.toLowerCase()}:`,
		);
		const differsOnlyByCase = swapped !== repo && swapped.toLowerCase() === repo.toLowerCase();
		if (process.platform !== "win32" || !differsOnlyByCase) {
			// Not applicable here -- but say so out loud rather than silently
			// passing, so a green run on POSIX is not mistaken for coverage.
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
		expect(run.syntheticPaths).toEqual([]);
		expect(
			existsSync(join(repo, "node_modules")),
			"nothing may have been provisioned into the parent under a differently-cased spelling",
		).toBe(false);
	});

	it("WR-05/WR-07 -- every declined provisioning step says so, and declares the right synthetic paths", () => {
		// Case A: parent has no node_modules and no .env. Exits 0 (a repository
		// with no dependencies is legitimate) but must NOT be silent.
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

		// Case B: the worktree ALREADY has node_modules and .env. The hook must
		// leave both alone, say so, and declare node_modules synthetic anyway
		// while NOT declaring .env.
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
		// The .env copy runs after the node_modules junction, so a copy failure
		// used to print {"syntheticPaths":[]} while the junction was already on
		// disk -- a half-provisioned FAILURE whose reported state was wrong.
		// Forced here by making the destination .env path un-writable: a
		// DIRECTORY named `.env` in the worktree makes copyFileSync throw EISDIR
		// while existsSync(envDst) is... true. So instead, make the .env source
		// unreadable is unreliable on Windows; use the source-is-a-directory form,
		// which makes existsSync(envSrc) true and copyFileSync throw.
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
			// This is the exact mechanism .pi/scripts/worktree-setup-hook.mjs
			// uses for node_modules. It must be proven to work on whatever
			// machine runs this suite -- it is load-bearing for the positive
			// proof above.
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

			// Per 07-VALIDATION.md's Manual-Only Verifications row 2: whether
			// the unqualified form fails is environment-dependent (Windows
			// Developer Mode / elevation / POSIX). Asserting a specific
			// outcome universally would fail the suite on a correctly
			// configured machine, which is the wrong failure. Report, do not
			// assert.
			//
			// On THIS machine, 2026-08-15 (07-02-SUMMARY.md's own measurement,
			// reproduced here): EPERM, no Developer Mode / elevation.
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
			// The only universal assertion: the call either succeeds or throws
			// an Error -- it must not hang, silently no-op, or crash the
			// process. That much IS safe to assert everywhere.
			expect(outcome === "succeeded" || typeof outcome.message === "string").toBe(true);
		} finally {
			rmSync(base, { recursive: true, force: true, maxRetries: 3 });
		}
	});

	it("the shipped hook contains no unqualified two-argument fs.symlinkSync( call (regression guard)", () => {
		// pi-subagents' own linkNodeModulesIfPresent uses exactly this
		// unqualified form and swallows its EPERM silently
		// (07-RESEARCH.md Pattern B / Pitfall 2; 07-02-SUMMARY.md's own
		// measurement). This assertion is the regression guard against the
		// shipped hook silently reintroducing that same defect into this
		// repo's own remedy.
		// Matches only a REAL two-argument call site (both arguments simple
		// identifiers/property accesses, e.g. `symlinkSync(nodeModulesSrc,
		// nodeModulesDst)`), deliberately narrow enough not to match this same
		// file's own header comment prose (`symlinkSync(..., "junction")`,
		// where "..." is not an identifier).
		const unqualifiedCallPattern = /symlinkSync\(\s*[A-Za-z_$][\w.]*\s*,\s*[A-Za-z_$][\w.]*\s*\)/;
		const match = HOOK_SOURCE.match(unqualifiedCallPattern);
		expect(
			match,
			`found an unqualified two-argument symlinkSync( call in the shipped hook: ${match?.[0]} -- ` +
				'every call must pass "junction" as a third argument',
		).toBeNull();
	});
});
