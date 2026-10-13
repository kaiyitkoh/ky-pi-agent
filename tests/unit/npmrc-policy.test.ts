/**
 * `ignore-scripts` is EFFECTIVE, not merely present: Pi passes --prefix, and npm resolves project config from the prefix
 * (pi src/core/package-manager.ts:1758-1778), so a correct repo .npmrc once let a postinstall run. This suite never reads
 * a .npmrc; it asks npm, per scope, and runs the attack in both directions. The real user-scope prefix is bootstrap's
 * (`--assert-hardening`); here it is a throwaway PI_CODING_AGENT_DIR. Nothing writes outside os.tmpdir().
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { scratchDirs } from "../helpers/scratch.ts";
// npm is npm.cmd on Windows, which Node will not spawn without a shell since CVE-2024-27980, and shell plus an args
// array is unescaped concatenation (DEP0190): one shared quoter.
import { quoteForWindows } from "../helpers/win-quote.ts";

const IS_WINDOWS = process.platform === "win32";

/** npm install of a local fixture is fast, but a cold npm start is not. */
const NPM_TIMEOUT_MS = 120_000;

/** The exact bytes bin/bootstrap.sh writes into the user-scope npm prefix. */
const BOOTSTRAP_NPMRC = "ignore-scripts=true\n";

const scratch = scratchDirs();
const tempDir = (label: string): string => scratch.make(`kypi-${label}-`);
afterEach(scratch.cleanup);

interface NpmResult {
	stdout: string;
	stderr: string;
	status: number | null;
}

/**
 * Drops npm's `npm_config_*` environment before asking npm anything. `npx vitest` exports the repo .npmrc's resolved
 * config, and env outranks every file, so the hardened case would pass with the control deleted.
 */
function cleanNpmEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (/^npm_config/i.test(key)) {
			continue;
		}
		env[key] = value;
	}
	return { ...env, ...extra };
}

function runNpm(
	args: string[],
	opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): NpmResult {
	const file = IS_WINDOWS ? ["npm", ...args.map(quoteForWindows)].join(" ") : "npm";
	const argv = IS_WINDOWS ? [] : args;

	const result = spawnSync(file, argv, {
		cwd: opts.cwd,
		env: opts.env ?? cleanNpmEnv(),
		encoding: "utf-8",
		shell: IS_WINDOWS,
		timeout: NPM_TIMEOUT_MS,
		windowsHide: true,
	});

	if (result.error) {
		throw new Error(`failed to run \`npm ${args.join(" ")}\`: ${result.error.message}`);
	}
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

/** What npm reports it will do. `cwd` and `prefix` are both exposed because --prefix wins for project config. */
function ignoreScriptsFor(opts: { cwd?: string; prefix?: string }): string {
	const args = ["config", "get", "ignore-scripts"];
	if (opts.prefix !== undefined) {
		args.push("--prefix", opts.prefix);
	}
	const { stdout, status } = runNpm(args, { cwd: opts.cwd });
	if (status !== 0) {
		throw new Error(`npm config get ignore-scripts exited ${status}`);
	}
	return stdout.trim();
}

describe("BOOT-01 group A -- npm's own effective configuration, three scopes", () => {
	it("is true with cwd = the repo root (developer installs, and Pi's git path)", () => {
		// The developer's `npm install`, and Pi's `npm install --omit=dev` in a clone of this repo (package-manager.ts:1829).
		expect(ignoreScriptsFor({ cwd: repoRoot() })).toBe("true");
	});

	it("is true for the project-scope prefix <repo>/.pi/npm (`pi install -l`)", () => {
		// Project installs use prefix <cwd>/.pi/npm (package-manager.ts:2004), which the repo-root .npmrc does not cover.
		expect(ignoreScriptsFor({ prefix: join(repoRoot(), ".pi", "npm") })).toBe("true");
	});

	it("is true for a bootstrap-shaped user-scope prefix (mechanism, not machine state)", () => {
		// User scope is unreachable from repo files; what is provable is that bootstrap's bytes change npm's answer there.
		const agentDir = tempDir("agentdir");
		const npmPrefix = join(agentDir, "npm");
		mkdirSync(npmPrefix, { recursive: true });

		// Before: a bare prefix answers false. This is not decoration -- it is
		// what makes the "after" assertion attributable to the file.
		expect(ignoreScriptsFor({ prefix: npmPrefix })).toBe("false");

		writeFileSync(join(npmPrefix, ".npmrc"), BOOTSTRAP_NPMRC, "utf-8");

		expect(ignoreScriptsFor({ prefix: npmPrefix })).toBe("true");
	});

	it("is false for a fresh prefix with no .npmrc -- the probe discriminates", () => {
		// Without this control a broken probe that always printed `true` would
		// satisfy every other assertion in group A.
		expect(ignoreScriptsFor({ prefix: tempDir("bare-prefix") })).toBe("false");
	});

	it("sanitises npm_config_* out of the child environment", () => {
		// Guards the sanitiser: without it every assertion here is about the launching shell.
		const env = cleanNpmEnv({ KYPI_EVIL_SENTINEL: "x" });
		expect(Object.keys(env).filter((k) => /^npm_config/i.test(k))).toEqual([]);
		expect(env.KYPI_EVIL_SENTINEL).toBe("x");
		expect(env.PATH ?? env.Path).toBeDefined();
	});

	it("environment config outranks every .npmrc -- which is why sanitising is mandatory", () => {
		// The hazard asserted: the inherited env reports `true` for a directory with no config.
		const bare = tempDir("env-precedence");
		const poisoned = cleanNpmEnv({ npm_config_ignore_scripts: "true" });
		const { stdout } = runNpm(["config", "get", "ignore-scripts", "--prefix", bare], {
			env: poisoned,
		});
		expect(stdout.trim()).toBe("true");
		// ...and the same prefix, asked honestly, says false.
		expect(ignoreScriptsFor({ prefix: bare })).toBe("false");
	});

	it("--prefix overrides cwd, which is the whole reason BOOT-01 needs three files", () => {
		// A hardened .npmrc in cwd with a --prefix that has none answers false.
		const bare = tempDir("override");
		expect(ignoreScriptsFor({ cwd: repoRoot(), prefix: bare })).toBe("false");
	});
});

describe("BOOT-01 group B -- the real attack, in both directions", () => {
	/** Absolute path to the fixture, forward-slashed so `file:` specs behave. */
	function fixtureSpec(): string {
		return `file:${join(repoRoot(), "tests", "fixtures", "evil-postinstall").replace(/\\/g, "/")}`;
	}

	/**
	 * Installs the fixture with Pi's argv (package-manager.ts:1758-1778) and cwd at the repo root on purpose: the repo
	 * .npmrc is effective there, so only the prefix file can explain a blocked postinstall.
	 */
	function installFixture(prefix: string, sentinel: string): NpmResult {
		return runNpm(
			["install", fixtureSpec(), "--prefix", prefix, "--legacy-peer-deps"],
			{
				cwd: repoRoot(),
				// Without cleanNpmEnv the hardened case passes for the wrong reason.
				env: cleanNpmEnv({ KYPI_EVIL_SENTINEL: sentinel }),
			},
		);
	}

	it("hardened prefix: the postinstall is blocked and writes no sentinel", () => {
		const prefix = tempDir("hardened-prefix");
		const sentinel = join(tempDir("sentinel-a"), "hardened.sentinel");
		writeFileSync(join(prefix, ".npmrc"), BOOTSTRAP_NPMRC, "utf-8");

		const result = installFixture(prefix, sentinel);

		expect(result.status, `npm install failed: ${result.stderr}`).toBe(0);
		expect(
			existsSync(sentinel),
			"the malicious postinstall RAN despite ignore-scripts=true in the prefix -- " +
				"BOOT-01's control is not effective on Pi's npm install path",
		).toBe(false);
	});

	it("unhardened prefix: the SAME postinstall DOES write its sentinel", () => {
		// Proves the fixture fires at all, so the hardened assertion above is not vacuous.
		const prefix = tempDir("unhardened-prefix");
		const sentinel = join(tempDir("sentinel-b"), "unhardened.sentinel");

		const result = installFixture(prefix, sentinel);

		expect(result.status, `npm install failed: ${result.stderr}`).toBe(0);
		expect(
			existsSync(sentinel),
			"the attack fixture did not fire on an unhardened prefix, so the hardened " +
				"case proves nothing -- the probe is a dud, not the control a success",
		).toBe(true);
	});
});
