/**
 * BOOT-03 -- the bootstrap reports every probe, and re-running it changes
 * nothing.
 *
 * ---------------------------------------------------------------------------
 * These tests deliberately never assert on real machine state
 * ---------------------------------------------------------------------------
 * The developer's `~/.pi/agent`, their global npm prefix and their `gh` login
 * are all OUT OF SCOPE here, and none of them may be read or mutated. Every
 * case redirects `PI_CODING_AGENT_DIR` at a fresh directory under
 * `os.tmpdir()`, so the user-scope half of the script operates entirely inside
 * a throwaway tree. [threat T-01-07]
 *
 * That redirection is not hygiene, it is correctness. `bin/bootstrap.sh` was
 * run for real against this machine's `~/.pi/agent` during Plan 05, so
 * `~/.pi/agent/npm/.npmrc` NOW EXISTS and is hardened. A test that wanted to
 * observe the *unhardened* user scope and forgot to redirect would pass -- for
 * entirely the wrong reason, and it would then keep passing on a machine where
 * the control had been deleted.
 *
 * ---------------------------------------------------------------------------
 * Why byte-equality rather than "looks the same"
 * ---------------------------------------------------------------------------
 * `--check-only` is a CI gate. A gate whose output drifts between two runs on
 * an unchanged machine cannot be diffed, cannot be cached, and cannot be used
 * to answer "did anything change since the last run". Case 2 is what forbids a
 * timestamp, a duration or a run counter from ever creeping into it.
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { type StubSpec, withStubBin } from "../helpers/stub-bin.ts";

/** Forward slashes: Git Bash `sh` will not accept a backslash path argument. */
const BOOTSTRAP = join(repoRoot(), "bin", "bootstrap.sh").replace(/\\/g, "/");

/** The real registry round-trip in `--check-only` dominates; npm is slow to start. */
const TIMEOUT_MS = 120_000;

interface Run {
	stdout: string;
	stderr: string;
	status: number | null;
}

/** Temp directories created by this suite; removed after every case. */
let scratch: string[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	scratch.push(dir);
	return dir;
}

/**
 * Run the real script as a subprocess, exactly as a user or CI would.
 *
 * `sh` is spawned with an args array and `shell: false`: it resolves through
 * PATH as a genuine executable on both platforms (Git Bash ships `sh.exe`),
 * unlike the `.cmd` shims that force `shell: true` for `npm` and `pi` -- see
 * the CVE-2024-27980 note in `tests/helpers/stub-bin.ts`.
 */
function runBootstrap(
	args: string[],
	opts: { agentDir: string; env?: Record<string, string>; extraEnv?: Record<string, string> },
): Run {
	const env: Record<string, string> = {
		...(opts.env ?? (process.env as Record<string, string>)),
		PI_CODING_AGENT_DIR: opts.agentDir,
		...(opts.extraEnv ?? {}),
	};

	const result = spawnSync("sh", [BOOTSTRAP, ...args], {
		cwd: repoRoot(),
		env,
		encoding: "utf-8",
		timeout: TIMEOUT_MS,
		windowsHide: true,
	});

	if (result.error) {
		throw new Error(
			`failed to run \`sh ${BOOTSTRAP} ${args.join(" ")}\`: ${result.error.message}`,
		);
	}
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

/** Sorted relative paths of everything under `dir`, directories marked with a trailing slash. */
function listRecursive(dir: string, prefix = ""): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir).sort()) {
		const abs = join(dir, entry);
		const rel = prefix + entry;
		if (statSync(abs).isDirectory()) {
			out.push(`${rel}/`);
			out.push(...listRecursive(abs, `${rel}/`));
		} else {
			out.push(rel);
		}
	}
	return out;
}

function gitStatus(): string {
	const result = spawnSync("git", ["status", "--porcelain"], {
		cwd: repoRoot(),
		encoding: "utf-8",
		timeout: 60_000,
		windowsHide: true,
	});
	if (result.error) {
		throw new Error(`git status failed to launch: ${result.error.message}`);
	}
	return result.stdout ?? "";
}

/**
 * A stub `npm` that answers each of the four questions the script actually
 * asks, rather than answering one thing to all of them.
 *
 * Present in case 4 for one reason only: a full run reaches `install_pi`, and
 * no test may run `npm install -g` against the developer's real global prefix.
 * `KYPI_SKIP_INSTALL=1` is set as well -- two independent guards, because the
 * cost of either failing alone is mutating machine state this suite promised
 * not to touch. [threat T-01-07]
 */
function npmStub(logTo: string): StubSpec {
	return {
		exitCode: 0,
		logTo,
		match: [
			{ when: ["config", "get", "ignore-scripts"], stdout: "true\n" },
			{ when: ["view"], stdout: '"0.84.1"\n' },
			{ when: ["ls", "-g"], stdout: '{"dependencies":{}}\n' },
		],
	};
}

const ENV_EXAMPLE = join(repoRoot(), ".env.example");

describe("BOOT-03 -- bootstrap probe reporting and idempotence", () => {
	afterEach(() => {
		for (const dir of scratch) {
			try {
				rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
			} catch {
				// A leftover temp dir is noise, not a failure. Never mask a real
				// assertion result behind a cleanup error.
			}
		}
		scratch = [];
	});

	it("case 1 -- `--check-only` exits 0 and reports every probe with its requirement class", () => {
		const run = runBootstrap(["--check-only"], { agentDir: tempDir("kypi-agentdir-") });

		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

		// `glab` is the load-bearing name here: it is absent on this machine and
		// on both CI runners (GitLab work is Phase 4/9 and lives on the work
		// laptop). It must still be NAMED on every run, because a probe table
		// that silently omits the tools you do not have tells you nothing about
		// what the harness expects.
		expect(run.stdout, "every probed tool must be named, present or not").toContain("glab");

		// And it must be named with its requirement class, because that is the
		// difference between "install this or nothing works" and "warn and move
		// on". A missing optional tool must never abort the run -- which exit 0
		// above, on a machine with no `glab`, is exactly the proof of.
		expect(run.stdout, "the probe table must render the requirement class").toContain("optional");
		expect(run.stdout).toContain("required");
	}, TIMEOUT_MS);

	it("case 2 -- two consecutive `--check-only` runs are byte-identical", () => {
		// ONE agent dir for both runs, deliberately. The script correctly echoes
		// the user-scope path it is checking, so two different temp dirs would
		// differ in output for an honest reason and prove nothing. Holding every
		// input fixed is what makes any remaining difference a defect: a
		// timestamp, an elapsed time, a counter, a hash of something volatile.
		const agentDir = tempDir("kypi-agentdir-");

		const first = runBootstrap(["--check-only"], { agentDir });
		const second = runBootstrap(["--check-only"], { agentDir });

		expect(first.status, `stderr:\n${first.stderr}`).toBe(0);
		expect(second.status, `stderr:\n${second.stderr}`).toBe(0);
		expect(
			second.stdout,
			"`--check-only` is a CI gate; its output must be diffable across runs, " +
				"so nothing time-varying may appear in it",
		).toBe(first.stdout);

		// Belt and braces on the specific defect class: a date or a clock time
		// would satisfy nothing above if both runs happened inside the same
		// second, which is entirely possible on a fast machine.
		expect(first.stdout, "no ISO date may appear in check-only output").not.toMatch(
			/\d{4}-\d{2}-\d{2}/,
		);
		expect(first.stdout, "no clock time may appear in check-only output").not.toMatch(
			/\d{1,2}:\d{2}:\d{2}/,
		);
	}, TIMEOUT_MS);

	it("case 3 -- `--check-only` mutates nothing, in the agent dir or the repo", () => {
		const agentDir = tempDir("kypi-agentdir-");

		const agentBefore = listRecursive(agentDir);
		const repoBefore = gitStatus();

		const run = runBootstrap(["--check-only"], { agentDir });
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

		// The whole value of `--check-only` as a CI gate is that it is inert.
		// Writing even one file -- notably the user-scope `.npmrc` that the full
		// run legitimately writes -- would make it impossible to use as a
		// read-only assertion, and would make case 2 pass for the wrong reason
		// on the second run.
		expect(
			listRecursive(agentDir),
			"--check-only must not create the user-scope npm root it reports on",
		).toEqual(agentBefore);
		expect(agentBefore, "the agent dir starts genuinely empty").toEqual([]);

		expect(
			gitStatus(),
			"--check-only must not write .env.example, settings or any other repo file",
		).toBe(repoBefore);
	}, TIMEOUT_MS);

	it("case 4 -- a full run repeated changes nothing: settings.json and .env.example are byte-identical", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const logDir = tempDir("kypi-log-");
		const log = join(logDir, "npm.log").replace(/\\/g, "/");

		// `.env.example` is a TRACKED file that the full run legitimately owns.
		// Snapshot its bytes so the working tree is restored no matter what the
		// script decides to do with it.
		const envBefore = existsSync(ENV_EXAMPLE) ? readFileSync(ENV_EXAMPLE) : null;

		try {
			const { first, second, envAfterFirst, envAfterSecond } = withStubBin(
				{ npm: npmStub(log) },
				(env) => {
					const opts = {
						agentDir,
						env,
						extraEnv: { KYPI_SKIP_INSTALL: "1" },
					};
					const a = runBootstrap([], opts);
					const envA = readFileSync(ENV_EXAMPLE, "utf-8");
					const settingsA = readFileSync(join(agentDir, "settings.json"), "utf-8");
					const b = runBootstrap([], opts);
					const envB = readFileSync(ENV_EXAMPLE, "utf-8");
					const settingsB = readFileSync(join(agentDir, "settings.json"), "utf-8");
					return {
						first: { ...a, settings: settingsA },
						second: { ...b, settings: settingsB },
						envAfterFirst: envA,
						envAfterSecond: envB,
					};
				},
			);

			expect(first.status, `first run stderr:\n${first.stderr}`).toBe(0);
			expect(second.status, `second run stderr:\n${second.stderr}`).toBe(0);

			// The stub's own call log. Without this the whole case could be an
			// assertion about the developer's REAL npm: a PATH-ordering mistake
			// would look identical from the outside, right up to the point where
			// it installed something globally.
			const logged = readFileSync(log, "utf-8");
			expect(logged, "the stubbed npm must be the npm the script consulted").toContain(
				"npm config get ignore-scripts",
			);
			expect(logged, "KYPI_SKIP_INSTALL=1 must keep the install step unreached").not.toMatch(
				/^npm install/m,
			);

			expect(
				second.settings,
				"a key-namespaced merge must produce a byte-identical file when the key " +
					"is already current -- anything else corrupts user config over time",
			).toBe(first.settings);

			const parsed = JSON.parse(first.settings) as Record<string, unknown>;
			expect(parsed, "the merge must own a namespaced key, never the file").toHaveProperty(
				"kyPiAgent",
			);

			expect(envAfterSecond, ".env.example must be byte-identical across two runs").toBe(
				envAfterFirst,
			);
		} finally {
			// Restore the tracked file regardless of outcome; a failing assertion
			// must not leave the working tree dirty for the next test or commit.
			if (envBefore !== null) {
				if (!existsSync(ENV_EXAMPLE) || !readFileSync(ENV_EXAMPLE).equals(envBefore)) {
					writeFileSync(ENV_EXAMPLE, envBefore);
				}
			} else if (existsSync(ENV_EXAMPLE)) {
				rmSync(ENV_EXAMPLE);
			}
		}
	}, TIMEOUT_MS);
});
