/**
 * WR-01 / WR-02 — `bin/bootstrap.sh#merge_subagent_config` writes into
 * `pi-subagents`' own USER-scope config file, and its only coverage was three
 * greps over the shell source.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * `merge_subagent_config()` `mkdir -p`s and writes
 * `$PI_AGENT_DIR/extensions/subagent/config.json` — on a real run, the
 * developer's own `~/.pi/agent/...`. Its entire coverage was
 * `bootstrapSource.includes("merge_subagent_config() {")`, a regex that
 * `run_full()`'s body mentions the name, and that the hook path is tracked.
 * **All three pass if the function body is `:`.** None would catch a JSON
 * corruption, a clobbered unrelated key, a non-idempotent write, or a wrong
 * path — while `tests/integration/templates-install.test.ts` already
 * established the exact harness for this and it was not used.
 *
 * WR-02 adds the missing `--check-only` counterpart. `install_safety_extension`
 * has had a paired `report_safety_extension` since T-04-48, whose reasoning is
 * stated inline there: "a stale stub is silently unguarded rather than loudly
 * broken". `merge_subagent_config` writes an ABSOLUTE path into a
 * machine-scope config, so a moved or deleted clone breaks every subagent
 * worktree spawn on the machine, in every repository. The identical hazard got
 * a guard for the safety stub and none here.
 *
 * ---------------------------------------------------------------------------
 * TWO INDEPENDENT GUARDS AGAINST TOUCHING THIS MACHINE
 * ---------------------------------------------------------------------------
 * Inherited verbatim from `templates-install.test.ts`, whose header states the
 * discipline in full. Every run below sets `PI_CODING_AGENT_DIR` to a fresh
 * directory under `os.tmpdir()` AND `KYPI_SKIP_INSTALL=1`, with a stubbed `npm`
 * first on PATH whose invocation log is asserted before anything else. Two
 * guards rather than one, because the cost of either failing alone is running
 * the real installer against the developer's real `~/.pi/agent`. `REPO_ROOT` is
 * a throwaway copy per run, so nothing writes into this repository either.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type BootstrapRepoCopy, makeBootstrapRepoCopy } from "../helpers/bootstrap-repo.ts";
import { type StubSpec, withStubBin } from "../helpers/stub-bin.ts";

const TIMEOUT_MS = 120_000;

interface Run {
	stdout: string;
	stderr: string;
	status: number | null;
	/** Everything the stubbed `npm` was asked, one invocation per line. */
	log: string;
}

let scratch: string[] = [];

afterEach(() => {
	for (const dir of scratch) {
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	}
	scratch = [];
});

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	scratch.push(dir);
	return dir;
}

function bootstrapRepoCopy(): BootstrapRepoCopy {
	const copy = makeBootstrapRepoCopy("kypi-subagentcfg-repo-");
	scratch.push(copy.root);
	return copy;
}

/** Answers each of the four questions the script actually asks -- see templates-install.test.ts. */
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

function runBootstrap(agentDir: string, args: string[], repoCopy: BootstrapRepoCopy): Run {
	const logDir = tempDir("kypi-log-");
	const log = join(logDir, "npm.log").replace(/\\/g, "/");

	return withStubBin({ npm: npmStub(log) }, (env) => {
		const result = spawnSync("sh", [repoCopy.bootstrapSh, ...args], {
			cwd: repoCopy.root,
			env: {
				...env,
				PI_CODING_AGENT_DIR: agentDir,
				// Both guards, every run.
				KYPI_SKIP_INSTALL: "1",
				KYPI_DASHSCOPE_BASE_URL: "",
			},
			encoding: "utf-8",
			timeout: TIMEOUT_MS,
			windowsHide: true,
		});
		if (result.error) {
			throw new Error(`failed to run \`sh ${repoCopy.bootstrapSh}\`: ${result.error.message}`);
		}
		return {
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? "",
			status: result.status,
			log: existsSync(log) ? readFileSync(log, "utf-8") : "",
		};
	});
}

/**
 * The stub's own call log, asserted BEFORE anything about the written file.
 *
 * Without it every case here could be an assertion about the developer's REAL
 * npm, and a run that never reached the script at all -- a PATH mistake, a
 * silent spawn failure -- would look identical from the outside.
 */
function assertStubWasUsed(run: Run): void {
	expect(
		run.log,
		"the stubbed npm was never invoked. Every assertion below would then be measuring the real " +
			"machine, not the fixture -- see templates-install.test.ts's own statement of this rule",
	).toContain("config get ignore-scripts");
	expect(
		run.log,
		"KYPI_SKIP_INSTALL=1 must keep `npm install -g` unreached; this suite may not install anything",
	).not.toContain("install -g");
}

function configPath(agentDir: string): string {
	return join(agentDir, "extensions", "subagent", "config.json");
}

function readConfig(agentDir: string): Record<string, unknown> {
	return JSON.parse(readFileSync(configPath(agentDir), "utf-8")) as Record<string, unknown>;
}

describe("WR-01 -- merge_subagent_config writes the hook wiring, idempotently, without clobbering", () => {
	it("(a) absent file -> created with both keys, a tab indent and a trailing newline", () => {
		const agentDir = tempDir("kypi-agent-");
		const repo = bootstrapRepoCopy();
		const run = runBootstrap(agentDir, [], repo);
		assertStubWasUsed(run);
		expect(run.status, `bootstrap must exit 0: ${run.stderr}`).toBe(0);

		expect(existsSync(configPath(agentDir)), "the config file must be created").toBe(true);
		const cfg = readConfig(agentDir);
		expect(
			cfg.worktreeSetupHook,
			"the wired hook must be an ABSOLUTE path into the clone that wrote it -- the config is " +
				"machine-scope and a relative path would resolve against whatever repo a session is in",
		).toBe(join(repo.root, ".pi", "scripts", "worktree-setup-hook.mjs").replace(/\\/g, "/"));
		expect(cfg.worktreeSetupHookTimeoutMs, "the timeout key must be written too").toBe(30000);

		const raw = readFileSync(configPath(agentDir), "utf-8");
		expect(
			raw.endsWith("\n"),
			"a trailing newline, matching pi-subagents' own saveConfig -- so a later in-app write is not " +
				"the first thing to ever reformat this file",
		).toBe(true);
		expect(raw, "tab-indented, matching pi-subagents' own saveConfig byte-for-byte").toContain('\n\t"');
	});

	it("(b) second run -> reports 'already current' and the file is byte-identical", () => {
		const agentDir = tempDir("kypi-agent-");
		const repo = bootstrapRepoCopy();

		const first = runBootstrap(agentDir, [], repo);
		expect(first.status, `first run must exit 0: ${first.stderr}`).toBe(0);
		const afterFirst = readFileSync(configPath(agentDir), "utf-8");

		// The SAME repo copy, so the absolute hook path is identical.
		const second = runBootstrap(agentDir, [], repo);
		assertStubWasUsed(second);
		expect(second.status, `second run must exit 0: ${second.stderr}`).toBe(0);
		expect(
			second.stdout,
			"a second run must SAY it changed nothing -- an installer that silently rewrites is one nobody " +
				"can tell apart from one that silently corrupts",
		).toContain("already current - unchanged");
		expect(
			readFileSync(configPath(agentDir), "utf-8"),
			"the file must be byte-identical after the second run",
		).toBe(afterFirst);
	});

	it("(c) a pre-existing unrelated key survives the merge", () => {
		const agentDir = tempDir("kypi-agent-");
		mkdirSync(join(agentDir, "extensions", "subagent"), { recursive: true });
		writeFileSync(
			configPath(agentDir),
			JSON.stringify({ maxConcurrent: 3, model: "some/model" }, null, "\t") + "\n",
			"utf-8",
		);

		const run = runBootstrap(agentDir, [], bootstrapRepoCopy());
		assertStubWasUsed(run);
		expect(run.status, `bootstrap must exit 0: ${run.stderr}`).toBe(0);

		const cfg = readConfig(agentDir);
		expect(
			cfg.maxConcurrent,
			"this is a KEY-NAMESPACED merge: anything the operator or a later pi-subagents /agent-config " +
				"write put in this file must survive untouched",
		).toBe(3);
		expect(cfg.model, "and so must every other key").toBe("some/model");
		expect(cfg.worktreeSetupHook, "while the two keys this function owns are still written").toBeTypeOf("string");
	});

	it("(d) invalid JSON -> non-zero exit, file untouched byte-for-byte", () => {
		const agentDir = tempDir("kypi-agent-");
		mkdirSync(join(agentDir, "extensions", "subagent"), { recursive: true });
		const corrupt = '{ "maxConcurrent": 3,,, \n';
		writeFileSync(configPath(agentDir), corrupt, "utf-8");

		const run = runBootstrap(agentDir, [], bootstrapRepoCopy());
		assertStubWasUsed(run);
		expect(
			run.status,
			"a config file this script cannot parse must stop the run, not be overwritten. It may hold " +
				"settings the operator cares about and this script did not write",
		).not.toBe(0);
		expect(
			readFileSync(configPath(agentDir), "utf-8"),
			"the unparseable file must be left EXACTLY as it was",
		).toBe(corrupt);
		expect(run.stdout + run.stderr, "and the refusal must say why").toContain("not valid JSON");
	});

	it("(e) a JSON array -> refused, file untouched", () => {
		const agentDir = tempDir("kypi-agent-");
		mkdirSync(join(agentDir, "extensions", "subagent"), { recursive: true });
		const arrayFile = '["not", "an", "object"]\n';
		writeFileSync(configPath(agentDir), arrayFile, "utf-8");

		const run = runBootstrap(agentDir, [], bootstrapRepoCopy());
		assertStubWasUsed(run);
		expect(run.status, "a JSON array is valid JSON and an invalid config -- both must be refused").not.toBe(0);
		expect(readFileSync(configPath(agentDir), "utf-8")).toBe(arrayFile);
		expect(run.stdout + run.stderr).toContain("not a JSON object");
	});
});

describe("WR-02 -- --check-only reports the wiring, and fails loudly on a stale one", () => {
	it("absent config -> WARN with a remedy, and check-only still exits 0", () => {
		// A machine that has never run the full bootstrap has nothing BROKEN, it
		// has something not yet DONE. --check-only must exit 0 on a clean runner
		// (bootstrap's own documented split from --assert-hardening).
		const agentDir = tempDir("kypi-agent-");
		const run = runBootstrap(agentDir, ["--check-only"], bootstrapRepoCopy());
		assertStubWasUsed(run);
		expect(run.status, `--check-only must exit 0 on a clean runner: ${run.stderr}`).toBe(0);
		expect(run.stdout, "an absent wiring is a WARN").toContain("worktree setup hook not wired");
		expect(run.stdout, "and a WARN without a remedy is just noise").toContain("remedy: run bin/bootstrap.sh");
	});

	it("wired config with a live target -> reported, exit 0", () => {
		const agentDir = tempDir("kypi-agent-");
		const repo = bootstrapRepoCopy();
		expect(runBootstrap(agentDir, [], repo).status, "the full run must succeed first").toBe(0);

		const run = runBootstrap(agentDir, ["--check-only"], repo);
		assertStubWasUsed(run);
		expect(run.status, `--check-only must exit 0 on a healthy wiring: ${run.stderr}`).toBe(0);
		// The SUBAGENT config's own line, not just the substring "(target exists)"
		// -- report_safety_extension prints that same phrase, so the loose form was
		// satisfied by a different reporter entirely. Found by the drop-report-call
		// mutation, which left this case green while the other three went red.
		const reported = run.stdout
			.split("\n")
			.filter((line) => line.includes(configPath(agentDir).replace(/\\/g, "/")) && line.includes("(target exists)"));
		expect(
			reported.length,
			`--check-only must report the SUBAGENT wiring specifically. stdout was:\n${run.stdout}`,
		).toBe(1);
		expect(reported[0], "and must name the hook it resolved to").toContain("worktree-setup-hook.mjs");
	});

	it("STALE config -- the clone that wrote it is gone -> FATAL, non-zero exit", () => {
		// This is the whole point of WR-02, and it is the hazard report_safety_
		// extension already guarded for the safety stub. The config is USER-scope,
		// so a moved or deleted clone breaks every subagent worktree spawn on the
		// machine, in every repository -- and whether pi-subagents then fails
		// loudly or degrades silently is not something this repo controls
		// (RB-07-01 leg 2 is OUTSTANDING). Loud on THIS side of the boundary.
		const agentDir = tempDir("kypi-agent-");
		mkdirSync(join(agentDir, "extensions", "subagent"), { recursive: true });
		writeFileSync(
			configPath(agentDir),
			JSON.stringify(
				{
					worktreeSetupHook: join(tmpdir(), "kypi-deleted-clone-that-never-existed", "hook.mjs").replace(
						/\\/g,
						"/",
					),
					worktreeSetupHookTimeoutMs: 30000,
				},
				null,
				"\t",
			) + "\n",
			"utf-8",
		);

		const run = runBootstrap(agentDir, ["--check-only"], bootstrapRepoCopy());
		assertStubWasUsed(run);
		expect(
			run.status,
			"a stale hook path must fail LOUDLY. Silently unguarded is the failure shape T-04-48 named " +
				"for the safety stub, and this config has a wider blast radius than that one",
		).not.toBe(0);
		expect(run.stdout + run.stderr, "the failure must name the missing target").toContain("which does not exist");
		expect(
			run.stdout + run.stderr,
			"and must say the blast radius is machine-wide, not just this repository",
		).toContain("every repository");
	});

	it("config with NO worktreeSetupHook key -> FATAL", () => {
		const agentDir = tempDir("kypi-agent-");
		mkdirSync(join(agentDir, "extensions", "subagent"), { recursive: true });
		writeFileSync(configPath(agentDir), JSON.stringify({ maxConcurrent: 3 }, null, "\t") + "\n", "utf-8");

		const run = runBootstrap(agentDir, ["--check-only"], bootstrapRepoCopy());
		assertStubWasUsed(run);
		expect(run.status, "a config that exists but carries no wiring is broken, not absent").not.toBe(0);
		expect(run.stdout + run.stderr).toContain("carries no worktreeSetupHook");
	});
});
