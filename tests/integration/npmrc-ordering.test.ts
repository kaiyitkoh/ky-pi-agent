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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type BootstrapRepoCopy, makeBootstrapRepoCopy } from "../helpers/bootstrap-repo.ts";
import { repoRoot } from "../helpers/git.ts";
import { type StubSpec, withStubBin } from "../helpers/stub-bin.ts";

/**
 * Forward slashes: Git Bash `sh` will not accept a backslash path argument.
 *
 * Only ever used for `--assert-hardening` below (cases 1/2): that mode never
 * calls `write_env_template`, so it never writes `$REPO_ROOT/.env.example`
 * and is safe to run against the real repo directly. Case 3's full run uses
 * its own throwaway `REPO_ROOT` copy instead -- see `bootstrapRepoCopy`.
 */
const BOOTSTRAP = join(repoRoot(), "bin", "bootstrap.sh").replace(/\\/g, "/");

const TIMEOUT_MS = 120_000;

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
 * A throwaway `REPO_ROOT` for one full bootstrap run, registered for cleanup
 * the same way every other scratch directory in this suite is. See
 * `tests/helpers/bootstrap-repo.ts`: a full run's `write_env_template` would
 * otherwise write the real, tracked `.env.example`.
 */
function bootstrapRepoCopy(): BootstrapRepoCopy {
	const copy = makeBootstrapRepoCopy("kypi-bootstrap-repo-");
	scratch.push(copy.root);
	return copy;
}

/**
 * Run the real script as a subprocess.
 *
 * `sh` takes an args array with `shell: false` -- it is a genuine executable on
 * both platforms (Git Bash ships `sh.exe`), unlike the `.cmd` shims that force
 * `shell: true` for `npm`/`pi` (CVE-2024-27980 note in stub-bin.ts).
 *
 * `repoCopy`, when given, redirects `SCRIPT_DIR/..` (and the subprocess
 * `cwd`) at a throwaway copy instead of the real repo -- see
 * `bootstrapRepoCopy`.
 */
function runBootstrap(
	args: string[],
	opts: { agentDir: string; env?: Record<string, string>; repoCopy?: BootstrapRepoCopy },
): Run {
	const env: Record<string, string> = {
		...(opts.env ?? (process.env as Record<string, string>)),
		PI_CODING_AGENT_DIR: opts.agentDir,
	};

	const script = opts.repoCopy?.bootstrapSh ?? BOOTSTRAP;
	const cwd = opts.repoCopy?.root ?? repoRoot();

	const result = spawnSync("sh", [script, ...args], {
		cwd,
		env,
		encoding: "utf-8",
		timeout: TIMEOUT_MS,
		windowsHide: true,
	});

	if (result.error) {
		throw new Error(
			`failed to run \`sh ${script} ${args.join(" ")}\`: ${result.error.message}`,
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

/**
 * BOOT-01 (sanitiser) -- `npm_config_*` in the environment can never produce a
 * pass for a scope that has no file behind it.
 *
 * npm ranks environment config ABOVE every `.npmrc`, and `npm run`/`npx` export
 * the whole resolved config into their children. So a probe that does not strip
 * `npm_config_*` measures its own launcher rather than the file under test, and
 * `--assert-hardening` would certify a control it never exercised.
 *
 * This has now been a live defect TWICE, and neither time did a test catch it:
 *
 *   01-06  the strip was lower-case only. A Node runner hands children the keys
 *          UPPER-cased, and Windows env names are case-insensitive, so
 *          `NPM_CONFIG_IGNORE_SCRIPTS=true` sailed through.
 *   CR-03-era review (CR-01)  the strip's character class was `[A-Za-z0-9_]`,
 *          which excludes `-`. `npm_config_ignore-scripts=true` -- npm's own
 *          canonical spelling -- matched nothing, was neither unset nor
 *          reported, and `--assert-hardening` printed "All npm scopes are
 *          hardened" for an empty directory. `unset` cannot fix that one: under
 *          `dash` a special-builtin error kills the shell even inside
 *          `|| true` (rc=2), so the script must REFUSE instead.
 *
 * The reason neither was caught is that the only coverage was incidental --
 * `case 1` below happens to run under vitest, which happens to export
 * `NPM_CONFIG_IGNORE_SCRIPTS`. That is a property of the launcher, not an
 * assertion. Run the suite from a runner that does not export those keys and
 * the guard silently evaporates. Hence this table: one row per poison shape,
 * asserted explicitly.
 *
 * Two-directional, per the repo's own rule that every control assertion ships
 * with the case that must fail:
 *   - unhardened dir + poison  -> MUST exit 1 (no false certification)
 *   - hardened dir + strippable poison -> MUST exit 0 (the strip really strips;
 *     without this, a script that failed unconditionally would pass the first)
 *   - hardened dir + un-unsettable poison -> MUST exit 1 AND name the key (the
 *     refusal is deliberate, not an accident of the directory being empty)
 */
describe("BOOT-01 (sanitiser) -- npm_config_* can never certify an absent control", () => {
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

	/** A `PI_CODING_AGENT_DIR` whose npm root really does carry the control. */
	function hardenedAgentDir(): string {
		const dir = tempDir("kypi-agentdir-");
		mkdirSync(join(dir, "npm"), { recursive: true });
		writeFileSync(join(dir, "npm", ".npmrc"), "ignore-scripts=true\n", "utf-8");
		return dir;
	}

	/**
	 * Every shape npm honours. `strippable` records whether a POSIX shell can
	 * `unset` the name at all -- which is what decides between "strip it and
	 * carry on" and "refuse, because we cannot".
	 */
	const POISON: ReadonlyArray<{
		readonly key: string;
		readonly why: string;
		readonly strippable: boolean;
	}> = [
		{
			key: "npm_config_ignore_scripts",
			why: "the form `npm run` and `npx` export on POSIX",
			strippable: true,
		},
		{
			key: "NPM_CONFIG_IGNORE_SCRIPTS",
			why: "the form a Node test runner exports; the 01-06 defect",
			strippable: true,
		},
		{
			key: "NpM_CoNfIg_IgNoRe_ScRiPtS",
			why: "Windows env names are case-insensitive, so mixed case is equally effective",
			strippable: true,
		},
		{
			key: "npm_config_ignore-scripts",
			why: "npm's own canonical spelling; no shell can unset it, so it must REFUSE",
			strippable: false,
		},
		{
			key: "NPM_CONFIG_IGNORE-SCRIPTS",
			why: "the upper-cased hyphen form -- both defects at once",
			strippable: false,
		},
	];

	for (const { key, why, strippable } of POISON) {
		it(`refuses to certify an empty npm root when ${key} is set (${why})`, () => {
			const run = runBootstrap(["--assert-hardening"], {
				agentDir: tempDir("kypi-agentdir-"),
				env: { ...(process.env as Record<string, string>), [key]: "true" },
			});

			expect(
				run.status,
				`\`${key}=true\` produced a PASS for a directory containing no .npmrc. ` +
					`npm ranks environment config above every file, so this is a certificate ` +
					`for a control that was never exercised.\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
			).toBe(1);
			expect(
				run.stdout,
				"a refusal must never also print the all-clear",
			).not.toContain("All npm scopes are hardened");
		}, TIMEOUT_MS);
	}

	for (const { key, why } of POISON.filter((p) => p.strippable)) {
		it(`strips ${key} and lets the FILE answer (${why})`, () => {
			// The paired positive. Without it the row above is satisfied by a
			// script that fails whenever any npm_config_* is present -- which is
			// not a sanitiser, it is a brick, and it would break every run under
			// `npm test`. Note the poison says `false` here: if it were NOT
			// stripped, npm would answer `false` and the run would exit 1.
			const run = runBootstrap(["--assert-hardening"], {
				agentDir: hardenedAgentDir(),
				env: { ...(process.env as Record<string, string>), [key]: "false" },
			});

			expect(
				run.status,
				`\`${key}=false\` outranked a .npmrc that says true, so the strip did not ` +
					`happen.\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
			).toBe(0);
			expect(run.stdout).toContain("All npm scopes are hardened");
		}, TIMEOUT_MS);
	}

	for (const { key, why } of POISON.filter((p) => !p.strippable)) {
		it(`refuses even a HARDENED root when ${key} is set (${why})`, () => {
			// The discriminating case. The empty-directory rows above would also
			// pass if the refusal were merely the ordinary "no .npmrc here"
			// failure. This one has a real, correct control file on disk, so the
			// only thing that can produce a non-zero exit is the sanitiser
			// deliberately refusing -- and it must say which key it choked on,
			// because the operator cannot `unset` these and needs to know why.
			const run = runBootstrap(["--assert-hardening"], {
				agentDir: hardenedAgentDir(),
				env: { ...(process.env as Record<string, string>), [key]: "true" },
			});

			expect(
				run.status,
				`\`${key}\` cannot be unset by any POSIX shell, so every assertion after it ` +
					`is about the environment rather than the files. The script must refuse.\n` +
					`stdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
			).toBe(1);
			expect(
				run.stderr.toLowerCase(),
				"the refusal must name the offending variable, or it is unactionable",
			).toContain(key.toLowerCase());
			expect(run.stdout).not.toContain("All npm scopes are hardened");
		}, TIMEOUT_MS);
	}

	it("passes on a hardened root with no poison at all (the baseline is live)", () => {
		// Anchors the whole table: if this failed, every "exits 1" row above
		// would be vacuous, because the run would exit 1 for reasons unrelated
		// to any environment variable.
		const run = runBootstrap(["--assert-hardening"], { agentDir: hardenedAgentDir() });
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
		expect(run.stdout).toContain("All npm scopes are hardened");
	}, TIMEOUT_MS);
});

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
		// A throwaway `REPO_ROOT` -- this is the only case that lets the script
		// reach a full run, and `write_env_template` would otherwise write the
		// real, tracked `.env.example`. Torn down by this suite's normal
		// `scratch` cleanup, no restore needed.
		const repoCopy = bootstrapRepoCopy();

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

			return runBootstrap([], { agentDir, env, repoCopy });
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
	}, TIMEOUT_MS);
});
