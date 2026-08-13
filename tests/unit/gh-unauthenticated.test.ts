/**
 * SAFE-16 -- `scripts/check-gh-unauthenticated.sh` classifies both states.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE BELIEVING A GREEN RUN
 * ---------------------------------------------------------------------------
 * This test proves the CLASSIFIER, not the MACHINE. It says nothing whatsoever
 * about whether `/share` is actually neutered anywhere. The live control --
 * logging `gh` out on the work laptop, then confirming `gh auth status` exits
 * non-zero and that `/share` really does abort in a live Pi session -- is
 * **OUTSTANDING**. It is recorded in `docs/RUNBOOK.md` and must never be
 * reported as passed on the strength of this file. Four green checks here plus
 * an authenticated work laptop is still a full session transcript one keystroke
 * away from a GitHub gist.
 *
 * ---------------------------------------------------------------------------
 * Why every case is stubbed
 * ---------------------------------------------------------------------------
 * `gh` IS authenticated on this dev machine, with `gist` scope, account
 * kaiyitkoh [VERIFIED: RESEARCH.md 6.3 + Runtime State Inventory, executed
 * 2026-08-13]. That is not an oversight: the git remote is HTTPS and no SSH key
 * exists, so the `gh` credential in the OS keyring is how this repo is pushed.
 *
 * Two consequences, both load-bearing:
 *
 *   1. No case here may mutate `gh` auth state. Logging the developer out to
 *      make an assertion true would break their git access -- and it is
 *      irreversible without an interactive browser flow. [threat T-01-07]
 *   2. No case here may assert on real machine state either. "gh is logged out"
 *      would be red on this machine and green on a CI runner that never had
 *      `gh` -- a result that tracks the runner, not the code.
 *
 * So every case runs the script as a subprocess against a `gh` supplied by
 * `withStubBin`, and each one additionally asserts, from the stub's own call
 * log, that the STUB was the binary consulted. That log is the proof the real
 * `gh` was never reached; without it, a PATH-ordering mistake would silently
 * turn this suite into an assertion about the developer's keyring.
 *
 * ---------------------------------------------------------------------------
 * Why cases 1 and 2 must both exist
 * ---------------------------------------------------------------------------
 * They are the same script under inverted stub states, asserting inverted exit
 * codes. Either one alone is satisfied by a script that always exits 0 -- i.e.
 * by a control that never fires. [threat T-01-23]
 *
 * The closed doors the script's header records (no extension hook is upstream
 * of the literal `/share` match at interactive-mode.ts:2902; `--remove-scopes`
 * cannot drop `gist`) are not re-tested here -- they are properties of Pi and
 * of the GitHub CLI, not of this repo. [threats T-01-21, T-01-22]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { type StubSpec, withStubBin } from "../helpers/stub-bin.ts";

/** Forward slashes: Git Bash `sh` will not accept a backslash path argument. */
const SCRIPT = join(repoRoot(), "scripts", "check-gh-unauthenticated.sh").replace(/\\/g, "/");

const TIMEOUT_MS = 60_000;

/**
 * Absolute path to `sh`, resolved once from the REAL environment.
 *
 * Case 4 hands the child a PATH containing nothing but an empty stub directory,
 * so `sh` itself has to be located before that PATH is narrowed. Resolving it
 * up front and spawning the absolute path keeps the child's PATH purely an
 * input to the code under test rather than something the spawn also depends on.
 *
 * Throws rather than skips, per the house rule from Plan 02: a skipped
 * supply-chain check is a green run that verified nothing.
 */
function resolveSh(): string {
	const finder = process.platform === "win32" ? "where" : "which";
	const found = spawnSync(finder, ["sh"], { encoding: "utf-8", windowsHide: true });
	const first = (found.stdout ?? "").split(/\r?\n/).find((line) => line.trim().length > 0);
	if (!first) {
		throw new Error(
			`could not locate \`sh\` via \`${finder} sh\`. This repo ships POSIX sh and ` +
				"requires a real one on PATH -- on Windows that is Git Bash " +
				"(C:\\Program Files\\Git\\usr\\bin\\sh.exe). Install it and re-run.",
		);
	}
	return first.trim();
}

const SH = resolveSh();

/** Windows env keys are case-insensitive; find the real one before writing. */
function pathKeyOf(env: Record<string, string>): string {
	for (const key of Object.keys(env)) {
		if (key.toUpperCase() === "PATH") {
			return key;
		}
	}
	return "PATH";
}

interface CheckRun {
	stdout: string;
	stderr: string;
	status: number | null;
	/** One line per stub invocation, `gh <argv>`. Empty when no stub ran. */
	ghCalls: string[];
}

/**
 * Run the script exactly the way the runbook and CI do: as a subprocess through
 * `sh`, with no in-process reimplementation of the branch under test.
 *
 * `ghExitCode: null` means "no `gh` stub, and a PATH narrowed to the stub
 * directory alone" -- the only honest way to simulate a machine without the
 * GitHub CLI while the real one sits on this machine's PATH.
 */
function runCheck(opts: { ghExitCode: number | null; args?: string[] }): CheckRun {
	const logDir = mkdtempSync(join(tmpdir(), "kypi-ghcalls-"));
	const logTo = join(logDir, "calls.log");

	try {
		const stubs: Record<string, StubSpec> =
			opts.ghExitCode === null ? {} : { gh: { exitCode: opts.ghExitCode, logTo } };

		return withStubBin(stubs, (env) => {
			const key = pathKeyOf(env);
			if (opts.ghExitCode === null) {
				// withStubBin prepends its temp dir to the inherited PATH. Keep only
				// that first entry, so the real `gh` (and everything else) is out of
				// reach and `command -v gh` genuinely finds nothing.
				const stubDir = (env[key] ?? "").split(delimiter)[0];
				env[key] = stubDir;
			}

			const result = spawnSync(SH, [SCRIPT, ...(opts.args ?? [])], {
				env,
				encoding: "utf-8",
				timeout: TIMEOUT_MS,
				windowsHide: true,
			});
			if (result.error) {
				throw new Error(`failed to run \`sh ${SCRIPT}\`: ${result.error.message}`);
			}

			const ghCalls = existsSync(logTo)
				? readFileSync(logTo, "utf-8")
						.split("\n")
						.map((line) => line.trim())
						.filter((line) => line.length > 0)
				: [];

			return {
				stdout: result.stdout ?? "",
				stderr: result.stderr ?? "",
				status: result.status,
				ghCalls,
			};
		});
	} finally {
		rmSync(logDir, { recursive: true, force: true });
	}
}

describe("SAFE-16 -- the /share control classifier", () => {
	it("case 1: authenticated + bare invocation fails and names the remedy", () => {
		const run = runCheck({ ghExitCode: 0 });

		// The gate. `gh auth status` exiting 0 means Pi's guard at
		// interactive-mode.ts:5856-5866 lets /share through to the export at
		// :5869, so the check must refuse.
		expect(run.status, `stdout: ${run.stdout}\nstderr: ${run.stderr}`).toBe(1);

		// It has to be actionable, and there is exactly one action. Matched with
		// \s+ so this file never contains the literal command; nothing in the test
		// suite may look like an invocation of it.
		expect(run.stderr).toMatch(/gh\s+auth\s+logout/);
		expect(run.stderr).toMatch(/gist/i);

		// Provenance: the stub answered, not the developer's real GitHub CLI.
		expect(run.ghCalls).toContain("gh auth status");
	}, TIMEOUT_MS);

	it("case 2: unauthenticated passes and says /share aborts", () => {
		const run = runCheck({ ghExitCode: 1 });

		// Inverted stub, inverted verdict. Paired with case 1 this is the whole
		// proof: a script hardcoded to exit 0 passes case 2 and fails case 1, and
		// one hardcoded to exit 1 does the reverse. [threat T-01-23]
		expect(run.status, `stdout: ${run.stdout}\nstderr: ${run.stderr}`).toBe(0);
		expect(run.stdout).toMatch(/unauthenticated/);
		expect(run.stdout).toMatch(/aborts/);

		expect(run.ghCalls).toContain("gh auth status");
	}, TIMEOUT_MS);

	it("case 3: authenticated + --warn-only exits 0 but still reports the risk", () => {
		const run = runCheck({ ghExitCode: 0, args: ["--warn-only"] });

		// The dev-machine mode. It must not fail the build...
		expect(run.status, `stdout: ${run.stdout}\nstderr: ${run.stderr}`).toBe(0);

		// ...and it must not go quiet either, or the escape hatch becomes a way to
		// forget the risk exists. Same warning text as case 1, same remedy.
		expect(run.stderr).toMatch(/gh\s+auth\s+logout/);
		expect(run.stderr).toMatch(/IS authenticated/);
		expect(run.stderr).toMatch(/warn-only/);

		// Nothing reassuring may reach stdout: the OK lines are the two safe
		// verdicts, and this is not one of them.
		expect(run.stdout).not.toMatch(/OK:/);

		expect(run.ghCalls).toContain("gh auth status");
	}, TIMEOUT_MS);

	it("case 4: no gh on PATH passes without invoking anything", () => {
		const run = runCheck({ ghExitCode: null });

		// No `gh` binary means Pi's spawnSync at :5856 cannot succeed either, so
		// /share takes its error branch. Nothing to warn about.
		expect(run.status, `stdout: ${run.stdout}\nstderr: ${run.stderr}`).toBe(0);

		// THIS pair is the real control, and it is discriminating: `gh` is
		// genuinely authenticated on this development machine, so if the narrowed
		// PATH had leaked the script would have taken the authenticated branch and
		// exited 1 with "gh IS authenticated" on stderr. Asserting the
		// not-installed message specifically -- rather than the substring
		// "cannot upload", which the authenticated branch also contains -- is what
		// distinguishes "gh was absent" from "gh answered".
		expect(run.stdout).toMatch(/OK: gh is not installed; \/share cannot upload\./);
		expect(run.stderr).not.toMatch(/gh IS authenticated/);

		// NOT asserted: `expect(run.ghCalls).toEqual([])`. It cannot fail. With
		// `ghExitCode: null` no stub is written and no `logTo` is wired, so the
		// log file cannot exist and `ghCalls` is `[]` by construction whether or
		// not the real `gh` ran. Nor can it be repaired by always writing a
		// logging stub: the leak this is meant to catch is the REAL `gh`, and the
		// real `gh` writes to no log either, so an empty log would still be
		// consistent with the leak. Stated rather than deleted silently, so the
		// next reader does not re-add it thinking it is missing coverage.
	}, TIMEOUT_MS);
});
