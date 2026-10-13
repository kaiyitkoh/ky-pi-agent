/**
 * `bin/bootstrap.sh install_safety_extension` as a real subprocess against a throwaway PI_CODING_AGENT_DIR: the
 * script writes the right stub bytes idempotently, `--check-only` reports without mutating, and the generated stub
 * registers and fails closed when loaded. Every full run carries both the npm stub and KYPI_SKIP_INSTALL=1, two
 * independent guards against touching the real global npm prefix.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { bootstrapNpmStub, type BootstrapRepoCopy, makeBootstrapRepoCopy, runBootstrap } from "../helpers/bootstrap-repo.ts";
import { repoRoot } from "../helpers/git.ts";
import { scratchDirs } from "../helpers/scratch.ts";
import { withStubBin } from "../helpers/stub-bin.ts";

const TIMEOUT_MS = 120_000;
const scratch = scratchDirs();
const tempDir = scratch.make;

/** A throwaway REPO_ROOT under this repo's tmp/, so a full run cannot write the tracked .env.example and the stub's import still resolves node_modules. */
function bootstrapRepoCopy(): BootstrapRepoCopy {
	const copy = makeBootstrapRepoCopy("kypi-bootstrap-repo-");
	scratch.track(copy.root);
	return copy;
}

function stubPath(agentDir: string): string {
	return join(agentDir, "extensions", "ky-safety", "index.ts");
}

/** The dynamically imported specifier in a stub's content; the stub imports and calls the real extension unconditionally. */
function extractSpecifier(content: string): string {
	const m = /await import\("([^"]+)"\)/.exec(content);
	if (m === null) {
		throw new Error(`stub content does not contain the expected dynamic-import line:\n${content}`);
	}
	return m[1] as string;
}

describe("SAFE-11 -- bin/bootstrap.sh installs the safety extension at user scope", () => {
	afterEach(scratch.cleanup);

	it("case 1 -- a full run writes the stub with a backslash-free specifier resolving to an existing file", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const logDir = tempDir("kypi-log-");
		const log = join(logDir, "npm.log").replace(/\\/g, "/");
		const repoCopy = bootstrapRepoCopy();

		const run = withStubBin({ npm: bootstrapNpmStub(log) }, (env) =>
			runBootstrap([], { agentDir, env, extraEnv: { KYPI_SKIP_INSTALL: "1" }, repoCopy }),
		);
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

		const stub = stubPath(agentDir);
		expect(
			existsSync(stub),
			"the stub must exist at <agentDir>/extensions/ky-safety/index.ts after a full run",
		).toBe(true);

		const content = readFileSync(stub, "utf-8");
		const specifier = extractSpecifier(content);
		expect(
			specifier,
			"the module specifier must contain no backslash -- inside a TS string literal a " +
				"backslash is an escape sequence, not a path separator",
		).not.toContain("\\");

		// The specifier resolves to a real file on disk (folds acceptance
		// criterion 3 into this case, since it needs the same stub content).
		expect(
			existsSync(specifier),
			`the specifier ${specifier} must resolve to an existing file on disk`,
		).toBe(true);
	});

	it("case 2 -- a second run is a no-op: byte-identical content and an unchanged mtime", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const logDir = tempDir("kypi-log-");
		const log = join(logDir, "npm.log").replace(/\\/g, "/");
		const stub = stubPath(agentDir);
		const repoCopy = bootstrapRepoCopy();

		withStubBin({ npm: bootstrapNpmStub(log) }, (env) => {
			const opts = { agentDir, env, extraEnv: { KYPI_SKIP_INSTALL: "1" }, repoCopy };

			const first = runBootstrap([], opts);
			expect(first.status, `first run stderr:\n${first.stderr}`).toBe(0);
			const contentAfterFirst = readFileSync(stub, "utf-8");
			const mtimeAfterFirst = statSync(stub).mtimeMs;

			const second = runBootstrap([], opts);
			expect(second.status, `second run stderr:\n${second.stderr}`).toBe(0);
			expect(
				second.stdout,
				"a second run must report the stub unchanged rather than rewriting it",
			).toMatch(/already current - unchanged/);

			const contentAfterSecond = readFileSync(stub, "utf-8");
			expect(
				contentAfterSecond,
				"the stub's content must be byte-identical across two consecutive runs",
			).toBe(contentAfterFirst);

			const mtimeAfterSecond = statSync(stub).mtimeMs;
			expect(
				mtimeAfterSecond,
				"a genuinely no-op run must not touch the file at all, so its mtime must not change",
			).toBe(mtimeAfterFirst);

			return undefined;
		});
	});

	it("case 4 -- `--check-only` on a stub-free agent dir exits 0 and creates no file", () => {
		const agentDir = tempDir("kypi-agentdir-");

		const run = runBootstrap(["--check-only"], { agentDir });
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
		expect(
			run.stdout,
			"a stub-free agent dir must be reported as not-yet-installed, not silently ignored",
		).toMatch(/user-scope safety extension not installed/);

		// Asserted AFTER the run: the write-nothing half of --check-only's contract.
		expect(
			existsSync(stubPath(agentDir)),
			"--check-only must never create the stub it reports on",
		).toBe(false);
	});

	it("case 5 -- `--check-only` on a stub pointing at a missing target exits non-zero", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const dir = join(agentDir, "extensions", "ky-safety");
		mkdirSync(dir, { recursive: true });
		// The shape install_safety_extension() writes: an unconditional dynamic import, no existsSync guard.
		writeFileSync(
			join(dir, "index.ts"),
			[
				"export default async function (pi) {",
				'  const mod = await import("C:/definitely/does/not/exist/index.ts");',
				"  await mod.default(pi);",
				"}",
				"",
			].join("\n"),
			"utf-8",
		);

		const run = runBootstrap(["--check-only"], { agentDir });
		expect(
			run.status,
			"a stub whose target does not exist is a stale/moved clone -- real breakage, " +
				"and must fail --check-only rather than be silently reported as fine",
		).not.toBe(0);
		expect(run.stderr).toMatch(/does not exist/);
	});
});

/**
 * The generated stub's own runtime behaviour, in a separate node process with a real cwd: it must register every time,
 * even with a project-scoped copy on disk, because Pi loads that copy only for a trusted project. A subprocess, because
 * process.chdir() in a vitest worker does not reach a nested dynamic import. Loaded through Pi's own jiti, since Pi
 * imports a bare absolute path (dist/core/extensions/loader.js loadExtensionModule) that plain Node ESM rejects.
 */
describe("CR-09 -- the generated stub registers unconditionally, regardless of a project-scoped copy at cwd", () => {
	afterEach(scratch.cleanup);

	/** Pi's own jiti as a file:// URL: this one import is plain Node ESM, which rejects a bare drive-letter path. */
	const JITI_ENTRY = (() => {
		const requireFromRepo = createRequire(join(repoRoot(), "package.json"));
		const jitiCjs = requireFromRepo.resolve("jiti", {
			paths: [join(repoRoot(), "node_modules", "@earendil-works", "pi-coding-agent")],
		});
		return pathToFileURL(join(jitiCjs, "..", "jiti.mjs")).href;
	})();

	/** A driver spawned with `cwd` set to the case: loads the stub through jiti with a recording fake `pi` and prints only the registered tool names as JSON. */
	function driverSource(stubSpecifier: string): string {
		return [
			`import { createJiti } from ${JSON.stringify(JITI_ENTRY)};`,
			"const toolNames = [];",
			"const pi = { on: () => {}, registerTool: (tool) => { toolNames.push(tool.name); } };",
			`const jiti = createJiti(import.meta.url, { moduleCache: false });`,
			`const mod = await jiti.import(${JSON.stringify(stubSpecifier)}, { default: true });`,
			"await mod(pi);",
			"process.stdout.write(JSON.stringify(toolNames));",
			"",
		].join("\n");
	}

	/** BootstrapRun the driver as a real child process with `cwd` set, and parse its stdout as the registered tool-name array. */
	function runDriverAt(cwd: string, stubSpecifier: string): string[] {
		const driverPath = join(tempDir("kypi-cr06-driver-"), "driver.mjs");
		writeFileSync(driverPath, driverSource(stubSpecifier), "utf-8");
		const result = spawnSync("node", [driverPath], {
			cwd,
			encoding: "utf-8",
			timeout: TIMEOUT_MS,
			windowsHide: true,
		});
		if (result.status !== 0) {
			throw new Error(
				`driver subprocess failed (status ${result.status}):\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
			);
		}
		return JSON.parse(result.stdout) as string[];
	}

	it(
		"case 6 -- project-scoped copy ABSENT at cwd: the stub imports and calls the real safety extension",
		() => {
			const agentDir = tempDir("kypi-agentdir-");
			const logDir = tempDir("kypi-log-");
			const log = join(logDir, "npm.log").replace(/\\/g, "/");
			const cwdWithoutCopy = tempDir("kypi-cwd-no-copy-");
			const repoCopy = bootstrapRepoCopy();

			const run = withStubBin({ npm: bootstrapNpmStub(log) }, (env) =>
				runBootstrap([], { agentDir, env, extraEnv: { KYPI_SKIP_INSTALL: "1" }, repoCopy }),
			);
			expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

			const stub = stubPath(agentDir).replace(/\\/g, "/");
			const toolNames = runDriverAt(cwdWithoutCopy, stub);

			expect(
				toolNames.length,
				"with no project-scoped copy at cwd, the stub must have imported and called the real " +
					"safety extension, which registers bash/read/write/edit/approve_ky_command",
			).toBeGreaterThan(0);
		},
		TIMEOUT_MS,
	);

	it(
		"case 7 (CR-09) -- project-scoped copy PRESENT ON DISK at cwd, but NOT loaded (no trust decision behind it): the stub still registers the real safety extension",
		() => {
			// A cwd holding .pi/extensions/safety/index.ts with no project trust: Pi would never load that copy
			// (dist/core/package-manager.js `if (projectTrusted)`), so the stub must still register.
			const agentDir = tempDir("kypi-agentdir-");
			const logDir = tempDir("kypi-log-");
			const log = join(logDir, "npm.log").replace(/\\/g, "/");
			const cwdWithCopy = tempDir("kypi-cwd-with-copy-");
			mkdirSync(join(cwdWithCopy, ".pi", "extensions", "safety"), { recursive: true });
			// Content is irrelevant: the stub never reads this path.
			writeFileSync(join(cwdWithCopy, ".pi", "extensions", "safety", "index.ts"), "export default function () {}\n", "utf-8");
			const repoCopy = bootstrapRepoCopy();

			const run = withStubBin({ npm: bootstrapNpmStub(log) }, (env) =>
				runBootstrap([], { agentDir, env, extraEnv: { KYPI_SKIP_INSTALL: "1" }, repoCopy }),
			);
			expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

			const stub = stubPath(agentDir).replace(/\\/g, "/");
			const toolNames = runDriverAt(cwdWithCopy, stub);

			expect(
				toolNames.length,
				"CR-09: a project-scoped copy merely EXISTING ON DISK at cwd must not suppress the " +
					"user-scope stub -- only a genuinely LOADED project copy could make a second " +
					"registration redundant, and this fixture never grants trust, so the project copy " +
					"was never loaded here. The stub must still import and call the real safety " +
					"extension, registering bash/read/write/edit/approve_ky_command -- this is the exact " +
					"headless-in-this-repository scenario the guard exists to cover.",
			).toBeGreaterThan(0);
		},
		TIMEOUT_MS,
	);

	/** Extracts a `field="<json string>"` value from a block reason; duplicated because the driver runs in its own process. */
	const EXTRACT_QUOTED_FIELD_SOURCE = [
		"function extractQuotedField(text, field) {",
		'  const marker = field + "=";',
		"  const start = text.indexOf(marker);",
		'  if (start === -1) throw new Error("no " + marker + " found in: " + text);',
		"  let i = start + marker.length;",
		'  if (text[i] !== \'"\') throw new Error("expected quote after " + marker);',
		"  let j = i + 1;",
		'  while (j < text.length && text[j] !== \'"\') {',
		'    if (text[j] === "\\\\") j += 1;',
		"    j += 1;",
		"  }",
		"  return JSON.parse(text.slice(i, j + 1));",
		"}",
	].join("\n");

	/**
	 * Loads the stub twice into two `pi` objects in ONE process and drives both tool_call hooks through block, approve,
	 * re-issue, consume and re-issue, the way Pi's emitToolCall does. approve()/consume() come from the real approvals.ts,
	 * and reading the globalThis store directly proves the grant is shared, not merely that both loads behave alike.
	 */
	function cr11DriverSource(stubSpecifier: string, approvalsSpecifier: string): string {
		return [
			`import { createJiti } from ${JSON.stringify(JITI_ENTRY)};`,
			EXTRACT_QUOTED_FIELD_SOURCE,
			"function makeRecordingPi() {",
			"  const handlers = {};",
			"  return { pi: { on: (name, fn) => { handlers[name] = fn; }, registerTool: () => {} }, handlers };",
			"}",
			"const jiti = createJiti(import.meta.url, { moduleCache: false });",
			"",
			"const a = makeRecordingPi();",
			`const modA = await jiti.import(${JSON.stringify(stubSpecifier)}, { default: true });`,
			"await modA(a.pi);",
			"",
			"const b = makeRecordingPi();",
			`const modB = await jiti.import(${JSON.stringify(stubSpecifier)}, { default: true });`,
			"await modB(b.pi);",
			"",
			`const approvalsMod = await jiti.import(${JSON.stringify(approvalsSpecifier)}, { default: false });`,
			"",
			'const hookA = a.handlers["tool_call"];',
			'const hookB = b.handlers["tool_call"];',
			"if (!hookA || !hookB) {",
			'  throw new Error("both independent loads must register their own tool_call hook -- got " + JSON.stringify({ hookA: !!hookA, hookB: !!hookB }));',
			"}",
			"",
			"const fakeCtx = { cwd: process.cwd(), hasUI: false };",
			'const command = "terraform apply";',
			"",
			"async function driveRound(toolCallId) {",
			'  const event = { toolName: "bash", input: { command }, toolCallId };',
			"  const resA = await hookA(event, fakeCtx);",
			"  if (resA && resA.block) return { blockedBy: 'A', result: resA };",
			"  const resB = await hookB(event, fakeCtx);",
			"  if (resB && resB.block) return { blockedBy: 'B', result: resB };",
			"  return { blockedBy: null, result: resA ?? resB ?? null };",
			"}",
			"",
			'const round1 = await driveRound("tool-call-1");',
			"if (!round1.result || !round1.result.block) {",
			'  throw new Error("round1 must block pending confirmation, got: " + JSON.stringify(round1));',
			"}",
			'const requestId = extractQuotedField(round1.result.reason, "request_id");',
			'const approvedCommand = extractQuotedField(round1.result.reason, "command");',
			'const approvedReason = extractQuotedField(round1.result.reason, "reason");',
			"",
			"const approved = approvalsMod.approve(requestId, approvedCommand, approvedReason);",
			"",
			'const round2 = await driveRound("tool-call-2");',
			"",
			"const store = globalThis[approvalsMod.APPROVALS_STORE_KEY];",
			"const grantedKeysAfterRound2 = [...store.granted.keys()];",
			"const consumedOk = grantedKeysAfterRound2.length === 1 ? approvalsMod.consume(grantedKeysAfterRound2[0]) : false;",
			"",
			'const round3 = await driveRound("tool-call-3");',
			"",
			"process.stdout.write(JSON.stringify({",
			"  round1: { blockedBy: round1.blockedBy, blocked: !!(round1.result && round1.result.block) },",
			"  approved,",
			"  round2: { blockedBy: round2.blockedBy, blocked: !!(round2.result && round2.result.block) },",
			"  grantedCountAfterRound2: grantedKeysAfterRound2.length,",
			"  consumedOk,",
			"  round3: { blockedBy: round3.blockedBy, blocked: !!(round3.result && round3.result.block) },",
			"}));",
			"",
		].join("\n");
	}

	interface Cr11Outcome {
		round1: { blockedBy: "A" | "B" | null; blocked: boolean };
		approved: boolean;
		round2: { blockedBy: "A" | "B" | null; blocked: boolean };
		grantedCountAfterRound2: number;
		consumedOk: boolean;
		round3: { blockedBy: "A" | "B" | null; blocked: boolean };
	}

	function runCr11DriverAt(cwd: string, stubSpecifier: string, approvalsSpecifier: string): Cr11Outcome {
		const driverPath = join(tempDir("kypi-cr11-driver-"), "driver.mjs");
		writeFileSync(driverPath, cr11DriverSource(stubSpecifier, approvalsSpecifier), "utf-8");
		const result = spawnSync("node", [driverPath], {
			cwd,
			encoding: "utf-8",
			timeout: TIMEOUT_MS,
			windowsHide: true,
		});
		if (result.status !== 0) {
			throw new Error(
				`CR-11 driver subprocess failed (status ${result.status}):\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
			);
		}
		return JSON.parse(result.stdout) as Cr11Outcome;
	}

	it(
		"case 8 (CR-11, supersedes the CR-09 version of this case) -- project-scoped copy PRESENT at cwd AND this call site's own real safety extension both load: block -> approve -> re-issue lets the command through EXACTLY ONCE, never permanently",
		() => {
			// Only one process can observe the shared approvals store, which separates a duplicate block (harmless) from a permanent one.
			const agentDir = tempDir("kypi-agentdir-");
			const logDir = tempDir("kypi-log-");
			const log = join(logDir, "npm.log").replace(/\\/g, "/");
			const cwdWithCopy = tempDir("kypi-cwd-with-copy-");
			mkdirSync(join(cwdWithCopy, ".pi", "extensions", "safety"), { recursive: true });
			writeFileSync(join(cwdWithCopy, ".pi", "extensions", "safety", "index.ts"), "export default function () {}\n", "utf-8");
			const repoCopy = bootstrapRepoCopy();

			const run = withStubBin({ npm: bootstrapNpmStub(log) }, (env) =>
				runBootstrap([], { agentDir, env, extraEnv: { KYPI_SKIP_INSTALL: "1" }, repoCopy }),
			);
			expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

			const stubFile = stubPath(agentDir);
			const stub = stubFile.replace(/\\/g, "/");
			// approvals.ts sits beside the stub's embedded index.ts and shares its globalThis-keyed store.
			const indexSpecifier = extractSpecifier(readFileSync(stubFile, "utf-8"));
			const approvalsSpecifier = indexSpecifier.replace(/index\.ts$/, "approvals.ts");

			const outcome = runCr11DriverAt(cwdWithCopy, stub, approvalsSpecifier);

			expect(outcome.round1.blocked, "round1 (fresh, no grant) must block pending confirmation").toBe(true);
			expect(outcome.approved, "approve() must have succeeded against the pending entry round1 created").toBe(true);
			expect(
				outcome.round2.blocked,
				"CR-11: round2 (the re-issue, under a double load) must NOT be blocked -- both independent " +
					"loads' hooks must be able to defer to the wrapper for the SAME tool call. Without the " +
					"fix, the second hook's markHookDeferred() call finds the marker already claimed by the " +
					"first and blocks, permanently defeating the confirm -> approve -> re-issue protocol.",
			).toBe(false);
			expect(outcome.grantedCountAfterRound2, "the grant must still be present after round2 -- the hook layer never consumes it").toBe(
				1,
			);
			expect(outcome.consumedOk, "the simulated wrapper consume() must succeed exactly once").toBe(true);
			expect(
				outcome.round3.blocked,
				"round3 (a further re-issue, AFTER the grant was consumed) must block again -- proving the " +
					"approved command was let through EXACTLY ONCE, not permanently unguarded",
			).toBe(true);
		},
		TIMEOUT_MS,
	);

	it(
		"case 9 -- a stub whose target checkout is gone blocks every tool call instead of loading nothing",
		() => {
			const agentDir = tempDir("kypi-agentdir-");
			const logDir = tempDir("kypi-log-");
			const log = join(logDir, "npm.log").replace(/\\/g, "/");
			const repoCopy = bootstrapRepoCopy();

			const run = withStubBin({ npm: bootstrapNpmStub(log) }, (env) =>
				runBootstrap([], { agentDir, env, extraEnv: { KYPI_SKIP_INSTALL: "1" }, repoCopy }),
			);
			expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

			const stub = stubPath(agentDir).replace(/\\/g, "/");
			rmSync(join(repoCopy.root, ".pi", "extensions", "safety"), { recursive: true, force: true });

			const driverPath = join(tempDir("kypi-missing-driver-"), "driver.mjs");
			writeFileSync(
				driverPath,
				[
					`import { createJiti } from ${JSON.stringify(JITI_ENTRY)};`,
					"const handlers = {};",
					"const pi = { on: (name, fn) => { handlers[name] = fn; }, registerTool: () => {} };",
					"const jiti = createJiti(import.meta.url, { moduleCache: false });",
					`const mod = await jiti.import(${JSON.stringify(stub)}, { default: true });`,
					"await mod(pi);",
					"const outcome = handlers.tool_call ? await handlers.tool_call({ toolName: \"read\", input: {} }, {}) : null;",
					"process.stdout.write(JSON.stringify(outcome));",
					"",
				].join("\n"),
				"utf-8",
			);
			const result = spawnSync("node", [driverPath], {
				cwd: repoCopy.root,
				encoding: "utf-8",
				timeout: TIMEOUT_MS,
				windowsHide: true,
			});
			expect(result.status, `stderr:\n${result.stderr}`).toBe(0);
			const outcome = JSON.parse(result.stdout) as { block?: boolean; reason?: string } | null;
			expect(outcome, "the stub must register a tool_call handler when its target is missing").not.toBeNull();
			expect(outcome?.block).toBe(true);
			expect(outcome?.reason).toContain("bootstrap.sh");
			expect(outcome?.reason).toContain("index.ts");
		},
		TIMEOUT_MS,
	);
});

describe("the generated stub fails closed when the safety extension throws", () => {
	afterEach(scratch.cleanup);

	const jitiEntry = (): string => {
		const requireFromRepo = createRequire(join(repoRoot(), "package.json"));
		const jitiCjs = requireFromRepo.resolve("jiti", { paths: [join(repoRoot(), "node_modules", "@earendil-works", "pi-coding-agent")] });
		return pathToFileURL(join(jitiCjs, "..", "jiti.mjs")).href;
	};

	/** Loads the stub through jiti as Pi does, then reports whether loading threw and what every tool_call handler returns for bash and read. */
	function runStub(stub: string): { threw: string | null; results: unknown[] } {
		const driver = join(tempDir("kypi-stub-throw-driver-"), "driver.mjs");
		writeFileSync(
			driver,
			[
				`import { createJiti } from ${JSON.stringify(jitiEntry())};`,
				"const handlers = [];",
				'const pi = { on: (event, handler) => { if (event === "tool_call") handlers.push(handler); }, registerTool: () => {} };',
				"const jiti = createJiti(import.meta.url, { moduleCache: false });",
				"let threw = null;",
				`try { const mod = await jiti.import(${JSON.stringify(stub)}, { default: true }); await mod(pi); } catch (e) { threw = String(e); }`,
				"const results = [];",
				'for (const h of handlers) for (const toolName of ["bash", "read"]) results.push(await h({ toolName, input: { command: "ls", path: "x" } }, {}));',
				"process.stdout.write(JSON.stringify({ threw, results }));",
				"",
			].join("\n"),
			"utf-8",
		);
		const result = spawnSync("node", [driver], { encoding: "utf-8", timeout: TIMEOUT_MS, windowsHide: true });
		if (result.status !== 0) throw new Error(`driver failed (status ${result.status}):\n${result.stdout}\n${result.stderr}`);
		return JSON.parse(result.stdout) as { threw: string | null; results: unknown[] };
	}

	it.each([
		["the factory throws", 'export default function () { throw new Error("factory boom"); }\n', "factory boom"],
		["the import throws", "export default function ( {\n", "failed to load"],
	])(
		"%s: loading does not throw and every tool call is blocked",
		(_name, broken, reasonPart) => {
			const agentDir = tempDir("kypi-agentdir-");
			const log = join(tempDir("kypi-log-"), "npm.log").replace(/\\/g, "/");
			const repoCopy = bootstrapRepoCopy();
			const run = withStubBin({ npm: bootstrapNpmStub(log) }, (env) => runBootstrap([], { agentDir, env, extraEnv: { KYPI_SKIP_INSTALL: "1" }, repoCopy }));
			expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
			writeFileSync(join(repoCopy.root, ".pi", "extensions", "safety", "index.ts"), broken, "utf-8");

			const outcome = runStub(stubPath(agentDir).replace(/\\/g, "/"));
			expect(outcome.threw, "a throw escaping the stub makes Pi drop it and run unguarded").toBeNull();
			expect(outcome.results.length).toBeGreaterThan(0);
			for (const r of outcome.results) {
				expect(r).toMatchObject({ block: true });
				expect(String((r as { reason: string }).reason)).toContain(reasonPart);
			}
		},
		TIMEOUT_MS,
	);
});
