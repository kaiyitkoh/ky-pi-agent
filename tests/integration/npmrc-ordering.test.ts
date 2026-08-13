/**
 * BOOT-01 (ordering) -- `ignore-scripts=true` is asserted BEFORE the first
 * install, proven by recorded execution order.
 *
 * ---------------------------------------------------------------------------
 * Why a log, and not reading the script
 * ---------------------------------------------------------------------------
 * "Asserts it holds *before* its first `pi install`" is a claim about
 * EXECUTION order. Source order is a proxy for it, and a lossy one: a
 * conditional branch, an early `return`, a `trap`, a function moved between
 * call sites, or a later refactor that hoists the install into a helper can all
 * reorder execution without reordering a single line in the file. Opening
 * `bin/bootstrap.sh` and agreeing the lines look right is therefore an opinion
 * about the source, not evidence about the run.
 *
 * So: stub `npm` and `pi`, have every invocation append its own name and full
 * argv to one shared log, run the real script, and read the order out of the
 * log. The proof is a recording of what actually happened.
 *
 * The comparison is deliberately the LAST `npm config get ignore-scripts`
 * against the FIRST install, not first-against-first. The script asserts three
 * scopes; if any one of them ran after an install, the guarantee is broken for
 * that scope, and a first-against-first comparison would happily miss it.
 *
 * ---------------------------------------------------------------------------
 * Vacuity is the failure mode this test has to defend against
 * ---------------------------------------------------------------------------
 * `Math.max(...[]) < Math.min(...[])` is `-Infinity < Infinity` -- true. An
 * ordering assertion over an empty log passes with flying colours while
 * proving nothing at all. Both categories are therefore asserted non-empty
 * before the indices are compared. [threat T-01-19]
 *
 * No case here touches the developer's real `~/.pi/agent` or their global npm
 * prefix: `PI_CODING_AGENT_DIR` is redirected under `os.tmpdir()` throughout,
 * and the one case that reaches `install_pi` reaches a stub. [threat T-01-07]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { type StubSpec, withStubBin } from "../helpers/stub-bin.ts";

/** Forward slashes: Git Bash `sh` will not accept a backslash path argument. */
const BOOTSTRAP = join(repoRoot(), "bin", "bootstrap.sh").replace(/\\/g, "/");

const TIMEOUT_MS = 120_000;

const ENV_EXAMPLE = join(repoRoot(), ".env.example");

interface Run {
	stdout: string;
	stderr: string;
	status: number | null;
}

let scratch: string[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	scratch.push(dir);
	return dir;
}

/**
 * Run the real script as a subprocess.
 *
 * `sh` takes an args array with `shell: false` -- it is a genuine executable on
 * both platforms (Git Bash ships `sh.exe`), unlike the `.cmd` shims that force
 * `shell: true` for `npm`/`pi` (CVE-2024-27980 note in stub-bin.ts).
 */
function runBootstrap(
	args: string[],
	opts: { agentDir: string; env?: Record<string, string> },
): Run {
	const env: Record<string, string> = {
		...(opts.env ?? (process.env as Record<string, string>)),
		PI_CODING_AGENT_DIR: opts.agentDir,
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

/**
 * A stub `npm` that answers each question the script actually asks.
 *
 * Modelled on the real argv shapes documented in RESEARCH 1.1: Pi's two install
 * paths are `npm install --omit=dev` (git source, cwd = clone) and
 * `npm install <spec> --prefix <root> --legacy-peer-deps` (npm source), and the
 * bootstrap's own install is `npm install -g --ignore-scripts <pkg>@<ver>`.
 * Every one of those matches `^npm install`, which is what the ordering
 * assertion keys on.
 *
 * A single static stdout would have to answer `true` to `npm view … version`
 * too, which is not a version -- the stub would then be "passing" the version
 * gate on a token no registry would ever return.
 */
function npmStub(logTo: string): StubSpec {
	return {
		exitCode: 0,
		logTo,
		match: [
			// The control being asserted. Answering `true` here is what lets the
			// run proceed as far as the install step at all.
			{ when: ["config", "get", "ignore-scripts"], stdout: "true\n" },
			// `npm view <pkg>@<ver> version --json` -> a JSON string literal.
			{ when: ["view"], stdout: '"0.84.1"\n' },
			// `npm ls -g --depth=0 --json` -> an empty tree, so the pin does not
			// match and `install_pi` genuinely proceeds. If this answered with the
			// pinned version installed, the script would correctly no-op and the
			// log would contain no install line at all.
			{ when: ["ls", "-g"], stdout: '{"dependencies":{}}\n' },
			// Anything else -- notably `install -g` -- exits 0 silently.
		],
	};
}

/** `pi` is stubbed too: it must never really run, and if it ever does it is logged. */
function piStub(logTo: string): StubSpec {
	return { exitCode: 0, logTo };
}

describe("BOOT-01 (ordering) -- the ignore-scripts assertion precedes any install", () => {
	afterEach(() => {
		for (const dir of scratch) {
			try {
				rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
			} catch {
				// A leftover temp dir is noise, not a failure.
			}
		}
		scratch = [];
	});

	it("case 1 -- `--assert-hardening` refuses on an unhardened npm root", () => {
		// An EMPTY temp dir is the whole point. The full bootstrap was run for
		// real on this machine during Plan 05, so `~/.pi/agent/npm/.npmrc` now
		// exists and is hardened; asserting against the real home directory would
		// pass for entirely the wrong reason and would keep passing after someone
		// deleted the control.
		const run = runBootstrap(["--assert-hardening"], { agentDir: tempDir("kypi-agentdir-") });

		expect(run.status, `stdout:\n${run.stdout}`).toBe(1);
		expect(
			run.stderr,
			"the refusal must name the control, or the operator cannot act on it",
		).toContain("ignore-scripts");
	}, TIMEOUT_MS);

	it("case 2 -- `--assert-hardening` passes once the control is written", () => {
		// The paired positive. Without it, case 1 would be satisfied by a script
		// that fails unconditionally -- which is not a control, it is a brick.
		// Same command, same temp root, one file added.
		const agentDir = tempDir("kypi-agentdir-");

		const before = runBootstrap(["--assert-hardening"], { agentDir });
		expect(before.status, "precondition: an untouched root must not pass").toBe(1);

		mkdirSync(join(agentDir, "npm"), { recursive: true });
		writeFileSync(join(agentDir, "npm", ".npmrc"), "ignore-scripts=true\n", "utf-8");

		const after = runBootstrap(["--assert-hardening"], { agentDir });
		expect(after.status, `stderr:\n${after.stderr}`).toBe(0);
		expect(after.stdout).toContain("ignore-scripts=true");
	}, TIMEOUT_MS);

	it("case 3 -- the recorded invocation order puts the assertion before every install", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const logDir = tempDir("kypi-log-");
		const log = join(logDir, "invocations.log").replace(/\\/g, "/");

		// `.env.example` is tracked and the full run owns it; snapshot and restore.
		const envBefore = existsSync(ENV_EXAMPLE) ? readFileSync(ENV_EXAMPLE) : null;

		try {
			const run = withStubBin({ npm: npmStub(log), pi: piStub(log) }, (env) => {
				// PRE-FLIGHT GUARD, not decoration. This case is the only one that
				// lets the script reach `install_pi` for real, so if the stub were
				// not the `npm` on PATH the script would run
				// `npm install -g @earendil-works/pi-coding-agent@0.84.1` against
				// the developer's real global prefix. Fail before that can happen.
				const which = spawnSync("sh", ["-c", "command -v npm"], {
					env,
					encoding: "utf-8",
					timeout: 30_000,
					windowsHide: true,
				});
				const resolved = (which.stdout ?? "").trim();
				if (!resolved.includes("kypi-stub-")) {
					throw new Error(
						`refusing to run: \`npm\` resolves to ${resolved || "<nothing>"}, not the stub. ` +
							"Running the full bootstrap here would install into the real global npm prefix.",
					);
				}

				return runBootstrap([], { agentDir, env });
			});

			expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

			const lines = readFileSync(log, "utf-8")
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.length > 0);

			const assertions: number[] = [];
			const installs: number[] = [];
			lines.forEach((line, index) => {
				if (/^npm config get ignore-scripts\b/.test(line)) {
					assertions.push(index);
				}
				if (/^(npm|pi) install\b/.test(line)) {
					installs.push(index);
				}
			});

			// Non-emptiness FIRST. Math.max of an empty array is -Infinity and
			// Math.min of an empty array is Infinity, so the comparison below
			// passes trivially on a log that recorded nothing. [threat T-01-19]
			expect(
				assertions.length,
				`no \`npm config get ignore-scripts\` was recorded; log was:\n${lines.join("\n")}`,
			).toBeGreaterThan(0);
			expect(
				installs.length,
				`no install was recorded, so there is nothing to be "before"; log was:\n${lines.join("\n")}`,
			).toBeGreaterThan(0);

			expect(
				Math.max(...assertions),
				"every ignore-scripts assertion must complete before the first install: " +
					"a postinstall that has already executed cannot be un-executed by a " +
					`control written a second later. Log was:\n${lines.join("\n")}`,
			).toBeLessThan(Math.min(...installs));

			// The user-scope assertion is the one no committed file can cover, and
			// the one most easily lost in a refactor. Name it explicitly.
			expect(
				lines.some((l) => l.startsWith("npm config get ignore-scripts --prefix")),
				`a --prefix-scoped assertion must be among them; log was:\n${lines.join("\n")}`,
			).toBe(true);
		} finally {
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
