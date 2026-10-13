/**
 * BOOT-02 / BOOT-05 — both extension load paths, executed against the real
 * `pi` binary.
 *
 * ROADMAP success criterion 2 is "one set of files serves both load paths".
 * That is a claim about Pi's discovery order, so it is proven by running Pi and
 * reading a sentinel out of `--list-models`, never by reasoning about the
 * manifest. `pi.registerProvider` calls made during the extension factory are
 * queued and flushed once the runner binds its context
 * [CITED: pi 0.84.1 docs/extensions.md:1709], which is precisely what makes a
 * registered model observable to `--list-models` with no credential, no TTY and
 * no model call.
 *
 * Four cases:
 *   1  BOOT-02 package path      — `-e <repoRoot>` from an unrelated cwd
 *   2  BOOT-02 real clone        — git clone + `npm install --omit=dev`
 *   3  BOOT-05 dogfood path      — `-a` with cwd = repoRoot
 *   4  BOOT-05 trust-gate control — no `-a`, sentinel must be ABSENT
 *
 * Case 4 is not decoration. Without it, case 3 could pass for the wrong reason
 * on any machine whose `trust.json` already holds a decision, and the whole
 * suite could silently become vacuous. Non-interactive modes never prompt for
 * project trust and fall back to `defaultProjectTrust: "ask"`, which *ignores*
 * project resources with no error message
 * [CITED: pi 0.84.1 docs/security.md:27, docs/settings.md:16].
 *
 * DOUBLE-LOAD CAVEAT. If a user both `pi install`s this repo globally *and*
 * trusts it as a project, its extensions load twice from two absolute paths.
 * That is fatal, not cosmetic: two paths registering one tool name are a load
 * error and Pi exits (pi 1.1.0 dist/core/resource-loader.js
 * detectExtensionConflicts, dist/main.js). The safety extension skips its tools
 * on a second load (tests/integration/safety-double-load.test.ts); the rest of
 * the harness relies on the README's one-delivery-path rule, and these tests
 * never exercise both at once.
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

/**
 * Run a non-Pi command (git, npm) and return its captured result.
 *
 * `shell` is true only on Windows, and only because it has to be: npm's global
 * installer ships `npm.cmd`, and since the CVE-2024-27980 fix Node refuses to
 * execute `.cmd` without a shell. Arguments are quoted and folded into the
 * command string rather than passed alongside `shell:true`, which is what
 * Node's DEP0190 warns about. Same rule, same reason as `tests/helpers/pi.ts`.
 */
function run(
	cmd: string,
	args: string[],
	opts: { cwd?: string; timeoutMs?: number } = {},
): { stdout: string; stderr: string; status: number | null } {
	// This used to be a bare `"${a}"` with no escaping at all -- the weakest of
	// the four hand-rolled quoters that existed here. One shared implementation
	// now; see tests/helpers/win-quote.ts for the CRT parser rules it obeys.
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

/**
 * A Pi environment with a throwaway agent directory.
 *
 * `PI_CODING_AGENT_DIR` relocates everything Pi keeps under `~/.pi/agent`
 * [VERIFIED: pi 0.84.1 dist/config.js:397,412-418 — `ENV_AGENT_DIR` is read by
 * `getAgentDir()`], including `trust.json`. Pointing it at a fresh directory is
 * what makes the trust-gate control honest: no saved decision can exist, so the
 * verdict comes from the gate rather than from this machine's history.
 */
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

function freshAgentEnv(): Record<string, string> {
	return {
		...(process.env as Record<string, string>),
		PI_CODING_AGENT_DIR: tempDir("kypi-agentdir-"),
	};
}

describe("BOOT-02 / BOOT-05 — extension load paths", () => {
	beforeAll(() => {
		// Throws rather than bypassing itself: a load-path assertion that quietly
		// removes itself when `pi` is missing is a green CI run that verified
		// nothing, which is the exact failure BOOT-02/BOOT-05 exist to catch. CI
		// installs the pinned Pi globally before running the suite.
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
		// The offline proxy for the OUTSTANDING live
		// `pi install git:github.com/kaiyitkoh/ky-pi-agent@<tag>` check, recorded in
		// docs/RUNBOOK.md. This is the ONLY case that proves the control files are
		// genuinely committed rather than merely present on the author's disk, and
		// the only one that proves nothing in devDependencies is needed at runtime.
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
		// One agent dir, two runs. Sharing it is the point: the only difference
		// between the two invocations is the flag, so the difference in outcome can
		// only be the trust gate. A fresh dir guarantees no saved decision exists.
		const env = freshAgentEnv();

		const gated = runPi(["--list-models"], { cwd: repoRoot(), env });
		expect(gated.status, `pi failed:\n${gated.stderr}`).toBe(0);
		expect(
			gated.stdout,
			"project trust defaults to `ask`, and non-interactive modes never prompt — " +
				"so without -a the project resources must be ignored. Seeing the sentinel " +
				"here would mean every other case in this file passes vacuously.",
		).not.toContain(SELFTEST_MODEL_ID);

		// Paired positive: same directory, same cwd, only `-a` added. Without this,
		// an absent sentinel could equally mean the fresh agent dir broke Pi
		// outright — which would make the control itself a vacuous pass.
		const approved = runPi(["-a", "--list-models"], { cwd: repoRoot(), env });
		expect(approved.status, `pi failed:\n${approved.stderr}`).toBe(0);
		expect(
			approved.stdout,
			"adding -a and changing nothing else must flip the verdict; if it does not, " +
				"the absence above proves nothing about the trust gate",
		).toContain(SELFTEST_MODEL_ID);
	});
});
