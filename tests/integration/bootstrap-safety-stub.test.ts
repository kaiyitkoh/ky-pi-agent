/**
 * SAFE-11 -- `bin/bootstrap.sh install_safety_extension`, driven as a real
 * subprocess against a throwaway `PI_CODING_AGENT_DIR`.
 *
 * ---------------------------------------------------------------------------
 * What this proves, and what it deliberately does not
 * ---------------------------------------------------------------------------
 * This file proves the SHELL SCRIPT writes the right bytes in the right place,
 * idempotently, and that `--check-only` reports without mutating. It does NOT
 * prove the written stub actually loads in a real `pi` process -- that is
 * `tests/integration/user-scope-load.test.ts` (the mechanism spike, Plan 01)
 * and `tests/integration/headless-deny.test.ts` (Plan 09 Task 2, which uses
 * `writeUserScopeShim` directly rather than going through the shell script).
 * Two different oracles for two different claims, following this suite's own
 * house rule (`tests/integration/bootstrap-check-only.test.ts`'s docstring).
 *
 * Never asserts on real machine state: every case redirects
 * `PI_CODING_AGENT_DIR` at a fresh `os.tmpdir()` directory, exactly like
 * `bootstrap-check-only.test.ts`. `withStubBin`'s `npm` stub plus
 * `KYPI_SKIP_INSTALL=1` are BOTH present on every full run for the same
 * reason that file gives: two independent guards against ever touching the
 * developer's real global npm prefix.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { type BootstrapRepoCopy, makeBootstrapRepoCopy } from "../helpers/bootstrap-repo.ts";
import { repoRoot } from "../helpers/git.ts";
import { scratchDirs } from "../helpers/scratch.ts";
import { type StubSpec, withStubBin } from "../helpers/stub-bin.ts";

/**
 * Forward slashes: Git Bash `sh` will not accept a backslash path argument.
 *
 * Only ever used for a `--check-only` run below (cases 4/5): `run_check_only`
 * (bin/bootstrap.sh's own dispatcher) never calls `write_env_template`, so it
 * never writes `$REPO_ROOT/.env.example` and is safe to run against the real
 * repo directly. Every FULL run (empty `args`, cases 1/2/6/7) uses its own
 * throwaway `REPO_ROOT` copy instead -- see `bootstrapRepoCopy` below.
 */
const BOOTSTRAP = join(repoRoot(), "bin", "bootstrap.sh").replace(/\\/g, "/");

/** The real registry round-trip in a full/`--check-only` run dominates; npm is slow to start. */
const TIMEOUT_MS = 120_000;

interface Run {
	stdout: string;
	stderr: string;
	status: number | null;
}

const scratch = scratchDirs();
const tempDir = scratch.make;

/**
 * A throwaway `REPO_ROOT` for one full bootstrap run, registered for cleanup
 * the same way every other scratch directory in this suite is. See
 * `tests/helpers/bootstrap-repo.ts` for why this exists (a full run's
 * `write_env_template` would otherwise write the real, tracked
 * `.env.example`) and why it is nested under this repo's own `tmp/` rather
 * than `os.tmpdir()` (so the CR-06 cases' dynamic import of the real safety
 * extension can still resolve `node_modules`).
 */
function bootstrapRepoCopy(): BootstrapRepoCopy {
	const copy = makeBootstrapRepoCopy("kypi-bootstrap-repo-");
	scratch.track(copy.root);
	return copy;
}

/**
 * Run the real script as a subprocess, exactly as `bootstrap-check-only.test.ts`
 * does. `repoCopy`, when given, redirects `SCRIPT_DIR/..` (and the subprocess
 * `cwd`) at a throwaway copy instead of the real repo -- see
 * `bootstrapRepoCopy`.
 */
function runBootstrap(
	args: string[],
	opts: {
		agentDir: string;
		env?: Record<string, string>;
		extraEnv?: Record<string, string>;
		repoCopy?: BootstrapRepoCopy;
	},
): Run {
	const env: Record<string, string> = {
		...(opts.env ?? (process.env as Record<string, string>)),
		PI_CODING_AGENT_DIR: opts.agentDir,
		...(opts.extraEnv ?? {}),
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
		throw new Error(`failed to run \`sh ${script} ${args.join(" ")}\`: ${result.error.message}`);
	}
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

/**
 * A stub `npm` answering the four questions a full run asks. Mirrors
 * `bootstrap-check-only.test.ts`'s own `npmStub` -- duplicated rather than
 * imported because that file does not export it, and this suite's own
 * `npm log` assertions (below) need the exact same shape.
 */
function npmStub(logTo: string): StubSpec {
	return {
		exitCode: 0,
		logTo,
		match: [
			{ when: ["config", "get", "ignore-scripts"], stdout: "true\n" },
			{ when: ["view"], stdout: '"1.1.0"\n' },
			{ when: ["ls", "-g"], stdout: '{"dependencies":{}}\n' },
		],
	};
}

function stubPath(agentDir: string): string {
	return join(agentDir, "extensions", "ky-safety", "index.ts");
}

/**
 * Pull the dynamically-imported specifier out of a stub's content, or throw
 * with the content shown. CR-06/CR-09: the stub is no longer a plain
 * `export { default } from "...";` re-export -- it is a function that
 * unconditionally dynamically imports and calls the real safety extension's
 * default export, with no existence check or dedup of any kind (CR-09
 * removed the existsSync guard an earlier fix added -- see this file's own
 * describe block below, and bin/bootstrap.sh's own CR-09 docstring section,
 * for why that guard was itself a fail-open bug).
 */
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

		const run = withStubBin({ npm: npmStub(log) }, (env) =>
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
	}, TIMEOUT_MS);

	it("case 2 -- a second run is a no-op: byte-identical content and an unchanged mtime", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const logDir = tempDir("kypi-log-");
		const log = join(logDir, "npm.log").replace(/\\/g, "/");
		const stub = stubPath(agentDir);
		const repoCopy = bootstrapRepoCopy();

		withStubBin({ npm: npmStub(log) }, (env) => {
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
	}, TIMEOUT_MS);

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
	}, TIMEOUT_MS);

	it("case 5 -- `--check-only` on a stub pointing at a missing target exits non-zero", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const dir = join(agentDir, "extensions", "ky-safety");
		mkdirSync(dir, { recursive: true });
		// CR-09 shape: a dynamic import, unconditional, no existsSync guard --
		// matches what install_safety_extension() actually writes now.
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
	}, TIMEOUT_MS);
});

/**
 * CR-09 (supersedes the CR-06 version of this block) -- the generated stub's
 * OWN runtime behaviour: does it register EVERY TIME it runs, regardless of
 * whether a project-scoped copy also exists at the session's own cwd?
 * `bootstrap-safety-stub.test.ts`'s cases above only prove the shell script
 * writes the right BYTES; this describe block runs the real generated stub
 * in a REAL, SEPARATE `node` subprocess, with a REAL `cwd` set at
 * process-spawn time, so it is the direct regression test for the exact
 * mechanism CR-09's fix and CR-09's own bug both live in (as opposed to
 * `tests/unit/safety-entry.test.ts`'s CR-06 case, which proves the
 * UNDERLYING extension itself has no globalThis guard any more -- a
 * different claim about a different file).
 *
 * An earlier shape of this stub returned early when a project-scoped copy
 * existed ON DISK at `process.cwd()`, reasoning that Pi would also load that
 * copy. Case 7 below is the executed proof that reasoning was wrong: Pi only
 * auto-discovers a project-scoped copy when the project is TRUSTED, and this
 * describe block's own driver never binds any UI or trust decision at all --
 * so a project-scoped copy merely existing on disk at cwd, with no trust
 * behind it, must NOT suppress the stub. Case 7 is renamed from its CR-06
 * wording ("returns without registering") to its CR-09 contract ("registers
 * regardless") -- this is not a new test file, it is the fix for the exact
 * assertion the review found locking the fail-open bug in.
 *
 * A SUBPROCESS, not `process.chdir()` inside this vitest worker: `process.
 * chdir()` inside a vitest/Vite SSR-executed test was measured, by direct
 * execution while authoring this test, to NOT reliably propagate into a
 * nested dynamic `import()`'s own execution context (the imported module's
 * `process.cwd()` observed the vitest WORKER's own root cwd, not the chdir
 * target), which would make a chdir-based version of this test either
 * silently pass vacuously or fail for a reason unrelated to the fix under
 * test. A real child process has no such ambiguity: `cwd` is an OS-level
 * property of the process itself.
 *
 * THROUGH JITI, NOT PLAIN NODE ESM: the stub is loaded with a RAW,
 * scheme-less absolute path specifier (`await import("C:/Users/.../index.ts")`),
 * which is exactly what Pi's own `loadExtensionModule` does
 * [`dist/core/extensions/loader.js:358-369`] -- that only works because Pi
 * resolves every extension through **jiti**, not plain Node ESM (`node
 * --experimental-strip-types`'s own loader rejects a bare Windows path with
 * `ERR_UNSUPPORTED_ESM_URL_SCHEME`, confirmed by direct execution while
 * authoring this test). The driver below resolves jiti from
 * `@earendil-works/pi-coding-agent`'s own `node_modules` (the exact copy Pi
 * itself uses) and drives the stub through `jiti.import(path, { default:
 * true })`, mirroring `loadExtensionModule` exactly, so this test exercises
 * the REAL production loading mechanism rather than a Node ESM shape Pi
 * never actually uses for this file.
 */
describe("CR-09 -- the generated stub registers unconditionally, regardless of a project-scoped copy at cwd", () => {
	afterEach(scratch.cleanup);

	/**
	 * The exact jiti entry point Pi itself resolves and uses --
	 * `node_modules/@earendil-works/pi-coding-agent`'s own copy, as a
	 * `file://` URL: this ONE import is plain Node ESM (jiti is not loaded
	 * yet at this point to resolve it any other way), and plain Node ESM
	 * rejects a bare Windows drive-letter path as an unsupported URL scheme.
	 */
	const JITI_ENTRY = (() => {
		const requireFromRepo = createRequire(join(repoRoot(), "package.json"));
		const jitiCjs = requireFromRepo.resolve("jiti", {
			paths: [join(repoRoot(), "node_modules", "@earendil-works", "pi-coding-agent")],
		});
		return pathToFileURL(join(jitiCjs, "..", "jiti.mjs")).href;
	})();

	/**
	 * A driver script, spawned with `cwd` set to the case under test. Loads
	 * the real generated stub through jiti (see this describe block's own
	 * docstring for why plain Node ESM cannot be used here), drives it with a
	 * recording fake `pi`, and prints the registered tool names as one JSON
	 * array on stdout -- the ONLY output this driver produces, so the test
	 * can parse it directly.
	 */
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

	/** Run the driver as a real child process with `cwd` set, and parse its stdout as the registered tool-name array. */
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

			const run = withStubBin({ npm: npmStub(log) }, (env) =>
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
			// This is the EXACT executed proof CR-09 demanded: a directory that
			// DOES contain .pi/extensions/safety/index.ts at cwd -- mirroring
			// this repository itself -- but where nothing in this test grants
			// project trust, so Pi itself would never have auto-discovered or
			// loaded that copy (dist/core/package-manager.js:1980's
			// `if (projectTrusted)` gate; dist/core/project-trust.js's
			// `resolveProjectTrusted` returning `false` with no UI). Before the
			// CR-09 fix, the stub used a bare existsSync(...) check as a proxy for
			// "the project copy will also load" -- wrong, because existence on
			// disk says nothing about trust. That earlier stub found this exact
			// file present and returned WITHOUT ever calling the real safety
			// extension, so NEITHER copy registered anything: the driver's own
			// tool list came back `[]` on this fixture, confirmed by direct
			// execution before this fix landed.
			const agentDir = tempDir("kypi-agentdir-");
			const logDir = tempDir("kypi-log-");
			const log = join(logDir, "npm.log").replace(/\\/g, "/");
			const cwdWithCopy = tempDir("kypi-cwd-with-copy-");
			mkdirSync(join(cwdWithCopy, ".pi", "extensions", "safety"), { recursive: true });
			// Content is irrelevant -- the fixed stub never even looks at this
			// path, let alone imports it; it exists only to model "a
			// project-scoped copy sits on disk at this cwd".
			writeFileSync(join(cwdWithCopy, ".pi", "extensions", "safety", "index.ts"), "export default function () {}\n", "utf-8");
			const repoCopy = bootstrapRepoCopy();

			const run = withStubBin({ npm: npmStub(log) }, (env) =>
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

	/**
	 * Extract a `field="<json-quoted string>"` value from the hook's
	 * block-reason text, unescaping it via `JSON.parse`. Mirrors
	 * `tests/unit/safety-entry.test.ts`'s own `extractQuotedField` helper --
	 * duplicated inline here because this driver runs as its own spawned
	 * `node` subprocess, with no access to this test file's own imports.
	 */
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
	 * CR-11 -- a driver that loads the real generated stub TWICE, into two
	 * fresh `pi` objects, IN ONE PROCESS (unlike `runDriverAt`'s tool-name
	 * proof above, which spawns a SEPARATE process per call and therefore
	 * cannot observe any property that depends on shared process state).
	 * Drives both recorded `tool_call` hooks through block -> approve ->
	 * re-issue -> (simulated wrapper) consume -> re-issue, exactly the way
	 * Pi's own `emitToolCall` drives every loaded extension's hook for one
	 * tool call, and prints the outcome of each round as JSON.
	 *
	 * `approve()`/`consume()`/`APPROVALS_STORE_KEY` are pulled directly from
	 * the real `approvals.ts` sibling module (derived from the stub's own
	 * embedded specifier) rather than routed through `approve_ky_command`'s
	 * UI-gated `execute()` -- this isolates the CR-11 property (does the
	 * DEFERRAL MARKER survive a double load) from `approve_ky_command`'s own,
	 * separately-tested UI-gating property (T-04-03,
	 * `tests/unit/safety-entry.test.ts`'s WR-11 cases). Reading
	 * `globalThis[APPROVALS_STORE_KEY].granted` directly (the same pattern
	 * the review's own CR-11 investigation and this project's `approvals.ts`
	 * module docstring both use) is what proves the grant is genuinely
	 * shared, not merely that both loads happen to behave the same way.
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
			// WR-18: the PRIOR shape of this case called `runDriverAt` TWICE --
			// two SEPARATE node subprocesses, sharing no globalThis, no
			// approvals store and no hook list. "The same full tool set comes
			// back twice" was true by construction and would have stayed true
			// no matter how badly the IN-PROCESS double load actually behaved --
			// structurally incapable of observing the CR-11 property it claimed
			// to pin. This case drives BOTH independent loads' hooks in ONE
			// process instead, through the full block -> approve -> re-issue ->
			// consume -> re-issue cycle, which is the only oracle that can tell
			// "duplicate block" (harmless) apart from "permanently blocked" (the
			// real CR-11 bug, reproduced by direct execution while diagnosing
			// this finding: reverting only CR-11's `event.toolCallId` keying
			// makes round2 below come back BLOCKED, forever, for every re-issue).
			const agentDir = tempDir("kypi-agentdir-");
			const logDir = tempDir("kypi-log-");
			const log = join(logDir, "npm.log").replace(/\\/g, "/");
			const cwdWithCopy = tempDir("kypi-cwd-with-copy-");
			mkdirSync(join(cwdWithCopy, ".pi", "extensions", "safety"), { recursive: true });
			writeFileSync(join(cwdWithCopy, ".pi", "extensions", "safety", "index.ts"), "export default function () {}\n", "utf-8");
			const repoCopy = bootstrapRepoCopy();

			const run = withStubBin({ npm: npmStub(log) }, (env) =>
				runBootstrap([], { agentDir, env, extraEnv: { KYPI_SKIP_INSTALL: "1" }, repoCopy }),
			);
			expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

			const stubFile = stubPath(agentDir);
			const stub = stubFile.replace(/\\/g, "/");
			// The stub's OWN embedded specifier points at the real index.ts;
			// approvals.ts is its sibling module -- same directory, same
			// globalThis-keyed store (see approvals.ts's own module docstring).
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

			const run = withStubBin({ npm: npmStub(log) }, (env) =>
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
			const run = withStubBin({ npm: npmStub(log) }, (env) => runBootstrap([], { agentDir, env, extraEnv: { KYPI_SKIP_INSTALL: "1" }, repoCopy }));
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
