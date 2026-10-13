/**
 * The bootstrap reports every probe, and --check-only is inert and byte-identical across runs, so CI can diff it.
 * Every case points PI_CODING_AGENT_DIR at a temp dir: this machine's real agent dir is already hardened, so an
 * unredirected test would pass for the wrong reason.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { bootstrapNpmStub, type BootstrapRepoCopy, type BootstrapRun, makeBootstrapRepoCopy, runBootstrap } from "../helpers/bootstrap-repo.ts";
import { repoRoot } from "../helpers/git.ts";
import { scratchDirs } from "../helpers/scratch.ts";
import { withStubBin } from "../helpers/stub-bin.ts";

const scratch = scratchDirs();
const tempDir = scratch.make;

/** A throwaway REPO_ROOT for a full run, which would otherwise write the tracked `.env.example`. */
function bootstrapRepoCopy(): BootstrapRepoCopy {
	const copy = makeBootstrapRepoCopy("kypi-bootstrap-repo-");
	scratch.track(copy.root);
	return copy;
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

describe("BOOT-03 -- bootstrap probe reporting and idempotence", () => {
	afterEach(scratch.cleanup);

	it("case 1 -- `--check-only` exits 0 and reports every probe with its requirement class", () => {
		const run = runBootstrap(["--check-only"], { agentDir: tempDir("kypi-agentdir-") });

		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

		// `glab` is absent here and on CI, yet must still be named: a table omitting missing tools says nothing.
		expect(run.stdout, "every probed tool must be named, present or not").toContain("glab");

		// Named with its requirement class; exit 0 above, without glab, proves a missing optional tool never aborts.
		expect(run.stdout, "the probe table must render the requirement class").toContain("optional");
		expect(run.stdout).toContain("required");
	});

	it("case 2 -- two consecutive `--check-only` runs are byte-identical", () => {
		// One agent dir for both runs, since the path is echoed: any remaining difference is a defect.
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

		// Both runs may land in the same second, so a date or clock time is checked for directly.
		expect(first.stdout, "no ISO date may appear in check-only output").not.toMatch(
			/\d{4}-\d{2}-\d{2}/,
		);
		expect(first.stdout, "no clock time may appear in check-only output").not.toMatch(
			/\d{1,2}:\d{2}:\d{2}/,
		);
	});

	it("case 3 -- `--check-only` mutates nothing, in the agent dir or the repo", () => {
		const agentDir = tempDir("kypi-agentdir-");

		const agentBefore = listRecursive(agentDir);
		const repoBefore = gitStatus();

		const run = runBootstrap(["--check-only"], { agentDir });
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

		// --check-only must write nothing, not even the user-scope .npmrc a full run writes.
		expect(
			listRecursive(agentDir),
			"--check-only must not create the user-scope npm root it reports on",
		).toEqual(agentBefore);
		expect(agentBefore, "the agent dir starts genuinely empty").toEqual([]);

		expect(
			gitStatus(),
			"--check-only must not write .env.example, settings or any other repo file",
		).toBe(repoBefore);
	});

	it("case 4 -- a full run repeated changes nothing: settings.json and .env.example are byte-identical", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const logDir = tempDir("kypi-log-");
		const log = join(logDir, "npm.log").replace(/\\/g, "/");
		// A full run against a throwaway REPO_ROOT; its own `.env.example` is what the assertions read.
		const repoCopy = bootstrapRepoCopy();

		const { first, second, envAfterFirst, envAfterSecond } = withStubBin(
			{ npm: bootstrapNpmStub(log) },
			(env) => {
				const opts = {
					agentDir,
					env,
					extraEnv: { KYPI_SKIP_INSTALL: "1" },
					repoCopy,
				};
				const a = runBootstrap([], opts);
				const envA = readFileSync(repoCopy.envExample, "utf-8");
				const settingsA = readFileSync(join(agentDir, "settings.json"), "utf-8");
				const b = runBootstrap([], opts);
				const envB = readFileSync(repoCopy.envExample, "utf-8");
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

		// The stub's call log proves the real npm was never reached.
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
	});

	function writeUserSettings(agentDir: string, packages: unknown[]): void {
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages }, null, 2), "utf-8");
	}

	function writeStub(agentDir: string): void {
		const dir = join(agentDir, "extensions", "ky-safety");
		mkdirSync(dir, { recursive: true });
		const target = join(repoRoot(), ".pi", "extensions", "safety", "index.ts").replace(/\\/g, "/");
		writeFileSync(
			join(dir, "index.ts"),
			`export default async function (pi) {\n  const mod = await import(${JSON.stringify(target)});\n  await mod.default(pi);\n}\n`,
			"utf-8",
		);
	}

	function checkOnlyStubbed(agentDir: string): BootstrapRun {
		const logDir = tempDir("kypi-log-");
		const log = join(logDir, "npm.log").replace(/\\/g, "/");
		return withStubBin({ npm: bootstrapNpmStub(log) }, (env) =>
			runBootstrap(["--check-only"], { agentDir, env }),
		);
	}

	it("case 5 -- the stub plus a git ky-pi-agent package is two delivery paths and fails", () => {
		const agentDir = tempDir("kypi-agentdir-");
		writeStub(agentDir);
		writeUserSettings(agentDir, ["git:github.com/kaiyitkoh/ky-pi-agent@v1.0.0"]);

		const run = checkOnlyStubbed(agentDir);

		expect(run.status).toBe(1);
		expect(run.stderr).toContain("one delivery path");
	});

	it("case 6 -- a git ky-pi-agent package without the stub warns about the double load and exits 0", () => {
		const agentDir = tempDir("kypi-agentdir-");
		writeUserSettings(agentDir, ["git:github.com/kaiyitkoh/ky-pi-agent@v1.0.0"]);

		const run = checkOnlyStubbed(agentDir);

		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
		expect(run.stdout).toMatch(/WARN user-level package git:github\.com\/kaiyitkoh\/ky-pi-agent@v1\.0\.0 .*double-loads/);
	});

	it("case 7 -- an unfiltered local package of this checkout warns that it also loads the guard", () => {
		const agentDir = tempDir("kypi-agentdir-");
		writeStub(agentDir);
		writeUserSettings(agentDir, [repoRoot().replace(/\\/g, "/")]);

		const run = checkOnlyStubbed(agentDir);

		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
		expect(run.stdout).toContain("also loads the safety extension; the second copy skips registering");
		expect(run.stdout).not.toContain("WARN harness package not configured");
	});

	it("case 7b -- the filtered harness entry bootstrap writes is reported as the harness package, without a warning", () => {
		const agentDir = tempDir("kypi-agentdir-");
		writeStub(agentDir);
		const source = repoRoot().replace(/\\/g, "/");
		writeUserSettings(agentDir, [{ source, extensions: ["!.pi/extensions/safety/**"] }]);

		const run = checkOnlyStubbed(agentDir);

		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
		expect(run.stdout).toContain(`harness package ${source} (safety extension filtered out)`);
		expect(run.stdout).not.toMatch(/WARN (user-level|harness)/);
	});

	it("case 7d -- a git package beside the local harness entry fails, stub or not", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const source = repoRoot().replace(/\\/g, "/");
		writeUserSettings(agentDir, [
			"git:github.com/kaiyitkoh/ky-pi-agent@v1.0.0",
			{ source, extensions: ["!.pi/extensions/safety/**"] },
		]);

		const run = checkOnlyStubbed(agentDir);

		expect(run.status).toBe(1);
		expect(run.stderr).toContain("both load the harness");
	});

	it("case 7e -- the filtered harness entry with no stub fails: the harness would run unguarded", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const source = repoRoot().replace(/\\/g, "/");
		writeUserSettings(agentDir, [{ source, extensions: ["!.pi/extensions/safety/**"] }]);

		const run = checkOnlyStubbed(agentDir);

		expect(run.status).toBe(1);
		expect(run.stderr).toContain("without the guard");
	});

	it("case 7c -- no harness entry is reported, since the commands then load only inside this checkout", () => {
		const agentDir = tempDir("kypi-agentdir-");
		writeStub(agentDir);
		writeUserSettings(agentDir, []);

		const run = checkOnlyStubbed(agentDir);

		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
		expect(run.stdout).toContain("WARN harness package not configured");
	});

	it("case 9 -- a dependency the checkout lacks is reported, and nothing is installed", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const repoCopy = bootstrapRepoCopy();
		const manifestFile = join(repoCopy.root, "package.json");
		const manifest = JSON.parse(readFileSync(manifestFile, "utf-8")) as { dependencies: Record<string, string> };
		manifest.dependencies["kypi-absent-fixture"] = "1.0.0";
		manifest.dependencies.unbash = "0.0.1";
		writeFileSync(manifestFile, JSON.stringify(manifest), "utf-8");
		const logDir = tempDir("kypi-log-");
		const log = join(logDir, "npm.log").replace(/\\/g, "/");

		const run = withStubBin({ npm: bootstrapNpmStub(log) }, (env) => runBootstrap(["--check-only"], { agentDir, env, repoCopy }));

		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
		expect(run.stdout).toContain("WARN kypi-absent-fixture@1.0.0 is not installed");
		expect(run.stdout).toMatch(/WARN unbash@0\.0\.1 is installed at \d/);
		expect(readFileSync(log, "utf-8")).not.toContain("npm ci");
		expect(listRecursive(agentDir)).toEqual([]);
	});

	it("case 8 -- unrelated user packages produce the single-path line and no warning", () => {
		const agentDir = tempDir("kypi-agentdir-");
		writeStub(agentDir);
		writeUserSettings(agentDir, ["npm:foo@1.0.0"]);

		const run = checkOnlyStubbed(agentDir);

		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
		expect(run.stdout).toContain("one delivery path (no user-level package loads this checkout)");
		expect(run.stdout).not.toContain("double-loads");
	});
});
