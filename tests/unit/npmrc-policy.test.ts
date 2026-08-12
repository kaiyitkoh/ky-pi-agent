/**
 * BOOT-01 coverage: `ignore-scripts` is EFFECTIVE, not merely present.
 *
 * Why this file exists at all. RESEARCH.md 1.3 ran the real attack against a
 * correctly-written, correctly-placed `.npmrc` and watched the postinstall run
 * anyway -- because npm resolves the project config from `--prefix` when one is
 * given, and Pi always passes `--prefix` on its npm install path
 * (pi 0.84.1 src/core/package-manager.ts:1758-1778). A test that asserted "the
 * file exists and says ignore-scripts=true" would have gone green that day.
 * RESEARCH.md "Common Pitfalls" 1 names the warning sign explicitly: a check of
 * a FILE'S EXISTENCE rather than of `npm config get` output.
 *
 * So this suite never reads a `.npmrc`. It asks npm what npm will do, in each
 * scope, and then it runs the actual attack.
 *
 * Group A -- effective configuration in three scopes, plus a discrimination
 * control. Group B -- the attack in BOTH directions, because a hardened install
 * that writes no sentinel proves nothing until an unhardened install of the same
 * fixture, through the same argv, is shown to write one.
 *
 * Scope boundary, deliberate: the user-scope prefix (the `npm` directory inside
 * Pi's agent directory) is BOOTSTRAP-owned machine state, not repo state. No
 * repo file can reach it, so this suite proves the MECHANISM against a throwaway
 * `PI_CODING_AGENT_DIR` and asserts nothing about the developer's real home
 * directory. The live machine-state check belongs to `bin/bootstrap.sh
 * --assert-hardening` (Plan 06) -- see RESEARCH.md 1.5 control 2 and 6.x
 * "what machine state still matters".
 *
 * Nothing here writes outside `os.tmpdir()`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";

const IS_WINDOWS = process.platform === "win32";

/** npm install of a local fixture is fast, but a cold npm start is not. */
const NPM_TIMEOUT_MS = 120_000;

/**
 * The exact bytes `bin/bootstrap.sh` will write into the user-scope npm prefix
 * (Plan 06). Asserting the mechanism against these bytes is what makes this a
 * test of the control rather than of this machine.
 */
const BOOTSTRAP_NPMRC = "ignore-scripts=true\n";

/** Directories created by this file; removed in afterEach, always. */
const created: string[] = [];

function tempDir(label: string): string {
	const dir = mkdtempSync(join(tmpdir(), `kypi-${label}-`));
	created.push(dir);
	return dir;
}

afterEach(() => {
	while (created.length > 0) {
		const dir = created.pop();
		if (dir !== undefined) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

/**
 * Quote an argument for Windows `cmd.exe` concatenation.
 *
 * Same reasoning as tests/helpers/pi.ts: npm ships as `npm.cmd` on Windows and
 * Node has refused to spawn `.cmd` without a shell since the CVE-2024-27980
 * fix, so `shell: true` is unavoidable there -- and `shell: true` alongside an
 * args array is unescaped concatenation (Node DEP0190). Quote here, hand over a
 * single command string, pass an empty args array.
 */
function quoteForWindows(arg: string): string {
	if (/^[A-Za-z0-9_.:@/\\=-]+$/.test(arg)) {
		return arg;
	}
	return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

interface NpmResult {
	stdout: string;
	stderr: string;
	status: number | null;
}

/**
 * Strip npm's own config-in-the-environment before asking npm anything.
 *
 * [VERIFIED: executed 2026-08-13, npm 11.13.0, node 24.16.0]
 * `npx` and `npm run` export the FULLY RESOLVED config as `npm_config_*`
 * environment variables into the child. Because this suite is launched by
 * `npx vitest` / `npm test` from inside the repo, the launching npm had already
 * read the repo `.npmrc` and exported:
 *
 *     npm_config_ignore_scripts=true
 *     npm_config_save_exact=true
 *     npm_config_local_prefix=<repo>
 *     ... 11 more
 *
 * npm gives environment config higher precedence than any `.npmrc`, so every
 * child `npm` invocation answered `true` for EVERY prefix -- including a bare
 * temp directory with no `.npmrc` at all. Two consequences, one of them nasty:
 *
 *   1. The discrimination controls could never go false.
 *   2. Far worse -- group B's hardened install would have been protected by the
 *      inherited variable rather than by the file under test, so deleting
 *      `.pi/npm/.npmrc` or shipping a typo'd control would still have shown a
 *      blocked postinstall. The suite would have certified a control it had not
 *      exercised: the precise "asserts what it wants to be true" failure that
 *      RESEARCH.md 1.3 caught in the field.
 *
 * The two-directional requirement is what surfaced it -- the unhardened variant
 * refused to fire, which is a dud probe screaming rather than a control quietly
 * passing.
 *
 * So: every npm invocation in this file runs against an environment with no
 * `npm_config_*` keys, which is what a plain interactive shell looks like.
 * npm then re-derives its defaults and reads only files, which is the thing
 * BOOT-01 is a claim about.
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

/**
 * What npm reports it will do -- the only authority that matters.
 *
 * `cwd` and `prefix` are BOTH meaningful and they disagree: RESEARCH.md 1.2
 * executed the matrix and `--prefix` wins for project-config resolution. That
 * single fact is the crux of BOOT-01, so both are exposed here.
 */
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
		// Covers two real paths at once: the developer's own `npm install`, and
		// the `npm install --omit=dev` Pi runs with cwd = a clone of THIS repo
		// when someone runs `pi install https://github.com/kaiyitkoh/ky-pi-agent`
		// (package-manager.ts:1829). The clone carries the committed `.npmrc`.
		expect(ignoreScriptsFor({ cwd: repoRoot() })).toBe("true");
	});

	it("is true for the project-scope prefix <repo>/.pi/npm (`pi install -l`)", () => {
		// Project-scope installs use prefix <cwd>/.pi/npm (package-manager.ts:2004),
		// and Pi auto-installs missing project packages after trust
		// (docs/packages.md:43). The repo-root .npmrc does NOT cover this -- the
		// prefix does -- which is why .pi/npm/.npmrc is a separate control file.
		expect(ignoreScriptsFor({ prefix: join(repoRoot(), ".pi", "npm") })).toBe("true");
	});

	it("is true for a bootstrap-shaped user-scope prefix (mechanism, not machine state)", () => {
		// User scope is the largest gap (RESEARCH.md 1.4) and it is unreachable
		// from any repo file, so bootstrap owns it. What CAN be proven here, with
		// no dependence on the developer's real machine, is that the bytes
		// bootstrap writes actually change npm's answer for that prefix shape.
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
		// Contract assertion for cleanNpmEnv. If a future refactor drops the
		// sanitiser, this fails here with a clear cause instead of turning the
		// whole suite into a set of assertions about the launching shell.
		const env = cleanNpmEnv({ KYPI_EVIL_SENTINEL: "x" });
		expect(Object.keys(env).filter((k) => /^npm_config/i.test(k))).toEqual([]);
		expect(env.KYPI_EVIL_SENTINEL).toBe("x");
		expect(env.PATH ?? env.Path).toBeDefined();
	});

	it("environment config outranks every .npmrc -- which is why sanitising is mandatory", () => {
		// The hazard, asserted rather than described. `npx vitest` and `npm test`
		// both export npm_config_ignore_scripts=true from the repo .npmrc into
		// this process, and npm ranks env above files. An unsanitised suite would
		// therefore report `true` for a directory containing no config at all.
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
		// RESEARCH.md 1.2, row 3 of the executed matrix: cwd carrying a hardened
		// .npmrc plus a --prefix that does not => false. Encoded as an assertion
		// so a future npm release that changed this would be caught here rather
		// than by an attacker.
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
	 * Install the attack fixture exactly the way Pi does.
	 *
	 * The argv shape `install <spec> --prefix <root> --legacy-peer-deps` is
	 * verbatim from package-manager.ts:1758-1778, and cwd is the repo root ON
	 * PURPOSE: that is precisely the configuration RESEARCH.md 1.3 proved
	 * insufficient -- the repo `.npmrc` is present and effective for cwd, and the
	 * postinstall RAN. If this suite ever passes because of the repo file rather
	 * than the prefix file, it is measuring the weather.
	 */
	function installFixture(prefix: string, sentinel: string): NpmResult {
		return runNpm(
			["install", fixtureSpec(), "--prefix", prefix, "--legacy-peer-deps"],
			{
				cwd: repoRoot(),
				// cleanNpmEnv is load-bearing here, not hygiene -- see its
				// docstring. With the inherited npm_config_ignore_scripts the
				// hardened case passes for the wrong reason.
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
		// Not optional. Without this, the assertion above could be passing because
		// the fixture is inert, the sentinel env var is ignored, or npm never
		// reached the lifecycle stage at all.
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
