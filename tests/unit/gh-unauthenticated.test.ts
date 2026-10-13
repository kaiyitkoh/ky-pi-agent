/**
 * check-gh-unauthenticated.sh classifies both gh states. This proves the classifier, not the machine: logging gh out
 * on the work laptop is an outstanding runbook check. Every case stubs gh (the dev machine's gh is authenticated and
 * pushes this repo, so its state must never be changed or asserted) and checks from the stub's log that the stub
 * answered. Cases 1 and 2 invert the stub and the verdict, so a script hardcoded to one exit code fails one of them.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { type StubSpec, withStubBin } from "../helpers/stub-bin.ts";

/** Forward slashes: Git Bash `sh` will not accept a backslash path argument. */
const SCRIPT = join(repoRoot(), "scripts", "check-gh-unauthenticated.sh").replace(/\\/g, "/");

const TIMEOUT_MS = 60_000;

/** Absolute `sh`, resolved before case 4 narrows PATH to an empty stub directory. Throws rather than skips. */
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

/** Runs the script through `sh` as CI does; `ghExitCode: null` means no stub and a PATH holding only the stub dir. */
function runCheck(opts: {
	ghExitCode: number | null;
	args?: string[];
	radius?: boolean;
	tokenStored?: boolean;
	envToken?: string;
}): CheckRun {
	const logDir = mkdtempSync(join(tmpdir(), "kypi-ghcalls-"));
	const agentDir = mkdtempSync(join(tmpdir(), "kypi-ghagent-"));
	if (opts.radius) {
		writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ radius: { type: "oauth" } }), "utf-8");
	}
	const logTo = join(logDir, "calls.log");

	try {
		const match = opts.tokenStored === true ? [{ when: ["auth", "token"], exitCode: 0, stdout: "token" }] : [];
		const stubs: Record<string, StubSpec> = opts.ghExitCode === null ? {} : { gh: { exitCode: opts.ghExitCode, logTo, match } };

		return withStubBin(stubs, (env) => {
			env.PI_CODING_AGENT_DIR = agentDir;
			delete env.GH_TOKEN;
			delete env.GITHUB_TOKEN;
			if (opts.envToken !== undefined) env.GH_TOKEN = opts.envToken;
			const key = pathKeyOf(env);
			if (opts.ghExitCode === null) {
				// Keep only withStubBin's own PATH entry, so `command -v gh` genuinely finds nothing.
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
		rmSync(agentDir, { recursive: true, force: true });
	}
}

describe("SAFE-16 -- the /share control classifier", () => {
	it("case 1: authenticated + bare invocation fails and names the remedy", () => {
		const run = runCheck({ ghExitCode: 0 });

		// gh auth status exiting 0 lets /share through Pi's guard (interactive-mode.ts:5856-5866), so the check must refuse.
		expect(run.status, `stdout: ${run.stdout}\nstderr: ${run.stderr}`).toBe(1);

		// Matched with \s+ so this file never contains the literal command.
		expect(run.stderr).toMatch(/gh\s+auth\s+logout/);
		expect(run.stderr).toMatch(/gist/i);

		// Provenance: the stub answered, not the developer's real GitHub CLI.
		expect(run.ghCalls.some((c) => c.startsWith("gh auth"))).toBe(true);
	}, TIMEOUT_MS);

	it("case 2: unauthenticated passes and says /share aborts", () => {
		const run = runCheck({ ghExitCode: 1 });

		// Inverted stub, inverted verdict: with case 1 this rules out a hardcoded exit code.
		expect(run.status, `stdout: ${run.stdout}\nstderr: ${run.stderr}`).toBe(0);
		expect(run.stdout).toMatch(/unauthenticated/);
		expect(run.stdout).toMatch(/cannot upload/);

		expect(run.ghCalls.some((c) => c.startsWith("gh auth"))).toBe(true);
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

		expect(run.ghCalls.some((c) => c.startsWith("gh auth"))).toBe(true);
	}, TIMEOUT_MS);

	it("case 4: no gh on PATH passes without invoking anything", () => {
		const run = runCheck({ ghExitCode: null });

		// No `gh` binary means Pi's spawnSync at :5856 cannot succeed either, so
		// /share takes its error branch. Nothing to warn about.
		expect(run.status, `stdout: ${run.stdout}\nstderr: ${run.stderr}`).toBe(0);

		// Discriminating because the real gh is authenticated: a leaked PATH would take the authenticated branch, so the
		// not-installed message is asserted rather than the shared "cannot upload" substring.
		expect(run.stdout).toMatch(/OK: gh is not installed; \/share cannot upload\./);
		expect(run.stderr).not.toMatch(/gh IS authenticated/);

		// No ghCalls assertion: with no stub the log cannot exist, and the real gh writes no log either.
	}, TIMEOUT_MS);

	it("case 5: a stored Radius credential fails even when gh is unauthenticated", () => {
		const run = runCheck({ ghExitCode: 1, radius: true });

		expect(run.status, `stdout: ${run.stdout}
stderr: ${run.stderr}`).toBe(1);
		expect(run.stderr).toMatch(/Radius IS configured/);
		expect(run.stderr).toMatch(/without gh/);
		expect(run.stdout).not.toMatch(/OK:/);
	}, TIMEOUT_MS);

	it("case 6: a stored Radius credential fails even when gh is not installed", () => {
		const run = runCheck({ ghExitCode: null, radius: true });

		expect(run.status, `stdout: ${run.stdout}
stderr: ${run.stderr}`).toBe(1);
		expect(run.stderr).toMatch(/Radius IS configured/);
	}, TIMEOUT_MS);

	it("case 8: a stored token fails even when gh auth status cannot validate it (offline)", () => {
		const run = runCheck({ ghExitCode: 1, tokenStored: true });

		expect(run.status, `stdout: ${run.stdout}
stderr: ${run.stderr}`).toBe(1);
		expect(run.stderr).toMatch(/gh IS authenticated/);
		expect(run.ghCalls).toContain("gh auth token");
	}, TIMEOUT_MS);

	it("case 9: GH_TOKEN in the environment fails even with nothing stored", () => {
		const run = runCheck({ ghExitCode: 1, envToken: "x" });

		expect(run.status, `stdout: ${run.stdout}
stderr: ${run.stderr}`).toBe(1);
		expect(run.stderr).toMatch(/GITHUB_TOKEN/);
	}, TIMEOUT_MS);

	it("case 7: a stored Radius credential with --warn-only reports and exits 0", () => {
		const run = runCheck({ ghExitCode: 1, radius: true, args: ["--warn-only"] });

		expect(run.status, `stdout: ${run.stdout}
stderr: ${run.stderr}`).toBe(0);
		expect(run.stderr).toMatch(/Radius IS configured/);
		expect(run.stderr).toMatch(/warn-only/);
	}, TIMEOUT_MS);
});
