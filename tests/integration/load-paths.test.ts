/**
 * Both extension load paths against the real `pi` binary, observed through a sentinel model in `--list-models`
 * (registerProvider calls are flushed once the runner binds). Case 4, no `-a`, must not load the project copy: without
 * it case 3 could pass on a machine whose trust.json already trusts the repo. Installing globally and trusting the
 * repo loads it twice, which is a fatal conflict (pi dist/core/resource-loader.js detectExtensionConflicts).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SELFTEST_MODEL_ID } from "../../.pi/extensions/harness/index.ts";
import { repoRoot } from "../helpers/git.ts";
import { requirePiOnPath, runPi } from "../helpers/pi.ts";
import { scratchDirs } from "../helpers/scratch.ts";
import { commandFor } from "../helpers/win-quote.ts";

const IS_WINDOWS = process.platform === "win32";

const scratch = scratchDirs();
const tempDir = scratch.make;

/** Runs git or npm. `shell` is true only on Windows, where npm.cmd cannot run without one (CVE-2024-27980). */
function run(
	cmd: string,
	args: string[],
	opts: { cwd?: string; timeoutMs?: number } = {},
): { stdout: string; stderr: string; status: number | null } {
	// Quoted by the shared CRT-rule quoter (tests/helpers/win-quote.ts).
	const [file, spawnArgs] = commandFor(cmd, args, IS_WINDOWS);
	const result = spawnSync(file, spawnArgs, {
		cwd: opts.cwd,
		encoding: "utf-8",
		shell: IS_WINDOWS,
		timeout: opts.timeoutMs ?? 120_000,
		windowsHide: true,
	});
	if (result.error) {
		throw new Error(`\`${cmd} ${args.join(" ")}\` failed to launch: ${result.error.message}`);
	}
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

/** Pi reports a failed extension factory or a manifest problem on stderr in these two shapes. */
const LOAD_ERROR = /failed to load extension|extension package "|extension error|error loading extension/i;

function loadErrorLines(stderr: string): string[] {
	return stderr.split(/\r?\n/).filter((line) => LOAD_ERROR.test(line));
}

/**
 * `--list-models` exits before Pi reports extension diagnostics, so load errors are only visible on
 * a prompt run. The model call itself fails offline; only stderr matters here.
 */
function probeLoadErrors(extra: string[], opts: { cwd: string; env: Record<string, string> }): string[] {
	const probe = runPi([...extra, "-p", "hi"], opts);
	return loadErrorLines(probe.stderr);
}

/** A Pi env with a throwaway PI_CODING_AGENT_DIR (which also holds trust.json), so no saved trust decision exists. */
function freshAgentEnv(): Record<string, string> {
	return {
		...(process.env as Record<string, string>),
		PI_CODING_AGENT_DIR: tempDir("kypi-agentdir-"),
	};
}

describe("BOOT-02 / BOOT-05 — extension load paths", () => {
	beforeAll(() => {
		// Throws rather than skipping when `pi` is missing: CI installs the pinned Pi first.
		requirePiOnPath();
	});

	afterAll(scratch.cleanup);

	it("case 1 — BOOT-02: loads as a package via `-e <repoRoot>` from an unrelated cwd", () => {
		const result = runPi(["-e", repoRoot(), "--list-models"], {
			cwd: tempDir("kypi-cwd-"),
			env: freshAgentEnv(),
		});

		expect(result.status, `pi failed:\n${result.stderr}`).toBe(0);
		expect(
			result.stdout,
			"the pi manifest, the literal ./.pi/extensions entry, and collectAutoExtensionEntries " +
				"must all resolve from a working directory unrelated to the repo",
		).toContain(SELFTEST_MODEL_ID);
		expect(
			probeLoadErrors(["-e", repoRoot()], { cwd: tempDir("kypi-cwd-"), env: freshAgentEnv() }),
			"every extension and the manifest must load cleanly",
		).toEqual([]);
	});

	it("case 2 — BOOT-02: survives a real `git clone` + `npm install --omit=dev`", () => {
		// Offline proxy for the outstanding live `pi install git:...@<tag>` check: the control files must be committed.
		const clone = join(tempDir("kypi-clone-"), "ky-pi-agent");

		const cloned = run("git", ["clone", "--quiet", repoRoot(), clone]);
		expect(cloned.status, `git clone failed:\n${cloned.stderr}`).toBe(0);

		const installed = run("npm", ["install", "--omit=dev"], { cwd: clone });
		expect(installed.status, `npm install --omit=dev failed:\n${installed.stderr}`).toBe(0);

		const result = runPi(["-e", clone, "--list-models"], {
			cwd: tempDir("kypi-cwd-"),
			env: freshAgentEnv(),
		});

		expect(result.status, `pi failed:\n${result.stderr}`).toBe(0);
		expect(
			result.stdout,
			"a consumer receives what git committed, not what is on the author's disk — " +
				"if this fails, some load-bearing file is untracked",
		).toContain(SELFTEST_MODEL_ID);
		expect(
			probeLoadErrors(["-e", clone], { cwd: tempDir("kypi-cwd-"), env: freshAgentEnv() }),
			"every extension and the manifest must load cleanly from the clone",
		).toEqual([]);
	}, 120_000);

	it("case 3 — BOOT-05: loads project-locally with `-a` and cwd = repoRoot", () => {
		const result = runPi(["-a", "--list-models"], {
			cwd: repoRoot(),
			env: freshAgentEnv(),
		});

		expect(result.status, `pi failed:\n${result.stderr}`).toBe(0);
		expect(
			result.stdout,
			"`.pi/extensions/*/index.ts` is auto-discovered with no settings.json declaration; " +
				"`-a` is load-bearing because the trust gate would otherwise drop it silently",
		).toContain(SELFTEST_MODEL_ID);
		expect(
			probeLoadErrors(["-a"], { cwd: repoRoot(), env: freshAgentEnv() }),
			"every project-local extension must load cleanly",
		).toEqual([]);
	});

	it("case 5: an extension whose factory throws is reported, so the no-load-error assertion can fail", () => {
		const broken = join(repoRoot(), "tests", "fixtures", "broken-extension", "index.ts");
		const lines = probeLoadErrors(["-e", repoRoot(), "-e", broken], {
			cwd: tempDir("kypi-cwd-"),
			env: freshAgentEnv(),
		});

		expect(lines.join(" ")).toMatch(/broken-extension/);
	});

	it("case 4 — BOOT-05 control: the same run WITHOUT `-a` must not see the sentinel", () => {
		// One fresh agent dir for both runs, so only the flag differs.
		const env = freshAgentEnv();

		const gated = runPi(["--list-models"], { cwd: repoRoot(), env });
		expect(gated.status, `pi failed:\n${gated.stderr}`).toBe(0);
		expect(
			gated.stdout,
			"project trust defaults to `ask`, and non-interactive modes never prompt — " +
				"so without -a the project resources must be ignored. Seeing the sentinel " +
				"here would mean every other case in this file passes vacuously.",
		).not.toContain(SELFTEST_MODEL_ID);

		// Paired positive: an absent sentinel could otherwise mean the fresh agent dir broke Pi.
		const approved = runPi(["-a", "--list-models"], { cwd: repoRoot(), env });
		expect(approved.status, `pi failed:\n${approved.stderr}`).toBe(0);
		expect(
			approved.stdout,
			"adding -a and changing nothing else must flip the verdict; if it does not, " +
				"the absence above proves nothing about the trust gate",
		).toContain(SELFTEST_MODEL_ID);
	});
});
