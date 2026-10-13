/**
 * `ignore-scripts=true` is asserted before the first install, proven by recorded execution order: stubbed `npm` and
 * `pi` append their argv to one log while the real script runs. The last config check is compared against the first
 * install, so any one late scope fails. Both categories are asserted non-empty first, since an ordering check over an
 * empty log is `-Infinity < Infinity`. Nothing touches the real agent dir or global npm prefix.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { bootstrapNpmStub, type BootstrapRepoCopy, makeBootstrapRepoCopy, runBootstrap } from "../helpers/bootstrap-repo.ts";
import { scratchDirs } from "../helpers/scratch.ts";
import { type StubSpec, withStubBin } from "../helpers/stub-bin.ts";

const scratch = scratchDirs();
const tempDir = scratch.make;

/** A throwaway REPO_ROOT for one full run, so `write_env_template` never writes the tracked `.env.example`. */
function bootstrapRepoCopy(): BootstrapRepoCopy {
	const copy = makeBootstrapRepoCopy("kypi-bootstrap-repo-");
	scratch.track(copy.root);
	return copy;
}

/** Whether `sh` hands an inherited `key` on to the programs it runs. */
function shPassesToChildren(key: string): boolean {
	const r = spawnSync("sh", ["-c", "env"], {
		env: { ...(process.env as Record<string, string>), [key]: "true" },
		encoding: "utf-8",
		windowsHide: true,
	});
	return (r.stdout ?? "").toLowerCase().split("\n").some((l) => l.startsWith(`${key.toLowerCase()}=`));
}

/** `pi` is stubbed too: it must never really run, and if it ever does it is logged. */
function piStub(logTo: string): StubSpec {
	return { exitCode: 0, logTo };
}

/**
 * Environment `npm_config_*` outranks every `.npmrc`, so it must never certify a scope with no file behind it. Both
 * an upper-cased key and npm's hyphenated spelling once slipped through. One row per poison shape: an unhardened dir
 * must exit 1; a hardened dir with strippable poison must exit 0; an un-unsettable key (`unset` kills dash) must exit
 * 1 and name the key.
 */
describe("BOOT-01 (sanitiser) -- npm_config_* can never certify an absent control", () => {
	afterEach(scratch.cleanup);

	/** A `PI_CODING_AGENT_DIR` whose npm root really does carry the control. */
	function hardenedAgentDir(): string {
		const dir = tempDir("kypi-agentdir-");
		mkdirSync(join(dir, "npm"), { recursive: true });
		writeFileSync(join(dir, "npm", ".npmrc"), "ignore-scripts=true\n", "utf-8");
		return dir;
	}

	/** Every shape npm honours; `strippable` is whether a POSIX shell can `unset` the name at all. */
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

	for (const { key, why } of POISON) {
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
		});
	}

	for (const { key, why } of POISON.filter((p) => p.strippable)) {
		it(`strips ${key} and lets the FILE answer (${why})`, () => {
			// Paired positive: a script that failed on any npm_config_* would pass the row above. The poison says `false`,
			// so an unstripped key would make the run exit 1.
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
		});
	}

	for (const { key, why } of POISON.filter((p) => !p.strippable)) {
		it(`refuses even a HARDENED root when ${key} is set (${why})`, () => {
			// A correct control file is on disk, so only a deliberate refusal can exit non-zero, and it must name the key.
			const run = runBootstrap(["--assert-hardening"], {
				agentDir: hardenedAgentDir(),
				env: { ...(process.env as Record<string, string>), [key]: "true" },
			});

			// dash drops a name that is not a valid identifier when it starts, so
			// npm under it never sees the poison and the file really answers.
			if (!shPassesToChildren(key)) {
				expect(run.status, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).toBe(0);
				expect(run.stdout).toContain("All npm scopes are hardened");
				return;
			}

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
		});
	}

	it("passes on a hardened root with no poison at all (the baseline is live)", () => {
		// Anchors the table: if this failed, every exits-1 row would be vacuous.
		const run = runBootstrap(["--assert-hardening"], { agentDir: hardenedAgentDir() });
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
		expect(run.stdout).toContain("All npm scopes are hardened");
	});
});

describe("BOOT-01 (ordering) -- the ignore-scripts assertion precedes any install", () => {
	afterEach(scratch.cleanup);

	it("case 1 -- `--assert-hardening` refuses on an unhardened npm root", () => {
		// An empty temp dir: the real ~/.pi/agent/npm/.npmrc is hardened on this machine and would pass for the wrong reason.
		const run = runBootstrap(["--assert-hardening"], { agentDir: tempDir("kypi-agentdir-") });

		expect(run.status, `stdout:\n${run.stdout}`).toBe(1);
		expect(
			run.stderr,
			"the refusal must name the control, or the operator cannot act on it",
		).toContain("ignore-scripts");
	});

	it("case 2 -- `--assert-hardening` passes once the control is written", () => {
		// Paired positive: same command and root, one file added; otherwise a script failing unconditionally passes.
		const agentDir = tempDir("kypi-agentdir-");

		const before = runBootstrap(["--assert-hardening"], { agentDir });
		expect(before.status, "precondition: an untouched root must not pass").toBe(1);

		mkdirSync(join(agentDir, "npm"), { recursive: true });
		writeFileSync(join(agentDir, "npm", ".npmrc"), "ignore-scripts=true\n", "utf-8");

		const after = runBootstrap(["--assert-hardening"], { agentDir });
		expect(after.status, `stderr:\n${after.stderr}`).toBe(0);
		expect(after.stdout).toContain("ignore-scripts=true");
	});

	it("case 3 -- the recorded invocation order puts the assertion before every install", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const logDir = tempDir("kypi-log-");
		const log = join(logDir, "invocations.log").replace(/\\/g, "/");
		// A throwaway REPO_ROOT: this case reaches a full run, which writes .env.example.
		const repoCopy = bootstrapRepoCopy();

		const run = withStubBin({ npm: bootstrapNpmStub(log), pi: piStub(log) }, (env) => {
			// Pre-flight guard: this case reaches install_pi, so a missing stub would run a real global npm install.
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

		// Non-emptiness first: Math.max/min of an empty array make the comparison trivially true.
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
	});
});
