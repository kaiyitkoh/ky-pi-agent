/**
 * Self-tests for the phase's test harness.
 *
 * Not in the plan's file list; added because the three helpers in
 * tests/helpers/ are what every later plan in this phase asserts THROUGH, and
 * nothing else exercises `runPi` or `withStubBin` at all. A typecheck proves
 * they compile, not that a stub is reachable on PATH or that the `pi` binary
 * runs -- and both of those are platform-specific enough to have already
 * produced two verified Windows surprises (see the module docstrings). A
 * broken helper here would surface in Plan 05/06 as a mysterious failure in
 * the thing under test.
 *
 * Phase 2 extends the same precedent to its own three Wave 0 helpers --
 * `logs.ts`, `session.ts` and `faux.ts` -- at the bottom of this file. The
 * `faux.ts` block is the one that matters most: it is the guard against a
 * whole class of vacuously-green DIAG-01/DIAG-07 tests.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";
import { logFilesIn, readJsonl, readTornSafe, withTempLogCwd } from "../helpers/logs.ts";
import { requirePiOnPath, runPi } from "../helpers/pi.ts";
import { withFauxSession } from "../helpers/session.ts";
import { commandFor, quoteForWindows } from "../helpers/win-quote.ts";
import { runWithStubBin, withStubBin } from "../helpers/stub-bin.ts";

const scratch = mkdtempSync(join(tmpdir(), "kypi-helpers-"));

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true });
});

describe("git helper", () => {
	it("resolves the repository root", () => {
		expect(existsSync(join(repoRoot(), "package.json"))).toBe(true);
	});

	it("reports tracked files for a pathspec", () => {
		expect(trackedFiles("package.json")).toEqual(["package.json"]);
	});
});

describe("pi helper", () => {
	// Deliberately not guarded by a skip: if `pi` is absent, this suite must go
	// red. A skipped load-path test is a vacuous pass.
	it("finds the pi binary and reports its version", () => {
		expect(requirePiOnPath()).toMatch(/^\d+\.\d+\.\d+/);
	});

	it("runs pi and injects --offline", () => {
		const result = runPi(["--version"]);
		expect(result.status).toBe(0);
		expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
	});
});

describe("stub-bin helper", () => {
	it("puts its temp directory first on PATH and removes it afterwards", () => {
		let stubDir = "";
		withStubBin({ "kypi-fake": {} }, (env) => {
			const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
			expect(key).toBeDefined();
			stubDir = (env[key as string] ?? "").split(delimiter)[0] as string;
			expect(existsSync(join(stubDir, "kypi-fake.mjs"))).toBe(true);
			expect(existsSync(join(stubDir, "kypi-fake.cmd"))).toBe(true);
			expect(existsSync(join(stubDir, "kypi-fake"))).toBe(true);
		});
		expect(existsSync(stubDir)).toBe(false);
	});

	it("resolves the stub from PATH and honours stdout and exitCode", () => {
		const result = runWithStubBin(
			{ "kypi-fake": { stdout: "STUBBED_OK\n", exitCode: 3 } },
			"kypi-fake",
			["auth", "status"],
		);
		expect(result.stdout).toContain("STUBBED_OK");
		expect(result.status).toBe(3);
	});

	it("logs its own name and argv, one line per invocation", () => {
		const log = join(scratch, "calls.log");
		runWithStubBin({ "kypi-fake": { logTo: log } }, "kypi-fake", ["install", "--offline"]);
		runWithStubBin({ "kypi-fake": { logTo: log } }, "kypi-fake", ["update"]);
		expect(readFileSync(log, "utf-8").split("\n").filter(Boolean)).toEqual([
			"kypi-fake install --offline",
			"kypi-fake update",
		]);
	});

	it("rejects an async fn rather than deleting the stubs mid-await", () => {
		expect(() => withStubBin({ "kypi-fake": {} }, () => Promise.resolve(1))).toThrow(
			/must be synchronous/,
		);
	});

	it("cleans up even when fn throws", () => {
		let stubDir = "";
		expect(() =>
			withStubBin({ "kypi-fake": {} }, (env) => {
				const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") as string;
				stubDir = (env[key] ?? "").split(delimiter)[0] as string;
				throw new Error("boom");
			}),
		).toThrow("boom");
		expect(existsSync(stubDir)).toBe(false);
	});
});

/**
 * The single Windows quoter, asserted directly.
 *
 * There were four hand-rolled copies of this across the suite and two were
 * wrong -- `stub-bin.ts` escaped quotes but not trailing backslashes, and
 * `load-paths.test.ts` did no escaping at all. All four are now one function,
 * and it is a function no test exercised, on the `shell: true` path Node's
 * DEP0190 warns about. Inputs are test-controlled today, which is exactly why
 * it needs asserting rather than assuming.
 */
describe("quoteForWindows -- one implementation of the DEP0190 hazard", () => {
	it("leaves plain arguments alone", () => {
		// Readability of the command string in a failure message is worth this.
		expect(quoteForWindows("--offline")).toBe("--offline");
		expect(quoteForWindows("C:/Users/x/pi")).toBe("C:/Users/x/pi");
		expect(quoteForWindows("@earendil-works/pi-ai@0.84.1")).toBe("@earendil-works/pi-ai@0.84.1");
	});

	it("quotes anything holding a space or a shell metacharacter", () => {
		expect(quoteForWindows("C:/some dir")).toBe('"C:/some dir"');
		expect(quoteForWindows("a&b")).toBe('"a&b"');
		expect(quoteForWindows("")).toBe('""');
	});

	it("doubles a trailing backslash run so it cannot eat the closing quote", () => {
		// THE stub-bin.ts BUG. `"C:\some dir\"` leaves the closing quote escaped,
		// so the argument runs on into whatever follows it on the command line.
		expect(quoteForWindows("C:\\some dir\\")).toBe('"C:\\some dir\\\\"');
		expect(quoteForWindows("C:\\some dir\\\\")).toBe('"C:\\some dir\\\\\\\\"');
		// A backslash NOT before a quote or the end is literal, so it stays put.
		expect(quoteForWindows("C:\\some dir\\file")).toBe('"C:\\some dir\\file"');
	});

	it("escapes an embedded quote and the backslash run before it", () => {
		// CRT rule: 2n backslashes + `"` is a delimiter, 2n+1 is a literal quote.
		expect(quoteForWindows('say "hi"')).toBe('"say \\"hi\\""');
		expect(quoteForWindows('a\\"b')).toBe('"a\\\\\\"b"');
	});

	it("commandFor folds args into one string on Windows and keeps the array off it", () => {
		expect(commandFor("npm", ["config", "get", "ignore-scripts"], false)).toEqual([
			"npm",
			["config", "get", "ignore-scripts"],
		]);
		// The safe `shell: true` shape: everything in the command, args empty.
		expect(commandFor("pi", ["--offline", "-a", "C:/some dir"], true)).toEqual([
			'pi --offline -a "C:/some dir"',
			[],
		]);
	});
});

// ===========================================================================
// Phase 2, Wave 0 helpers. See the note at the top of this file.
// ===========================================================================

/** Compare two absolute paths on a platform where git and node disagree on slashes. */
function normalisePath(path: string): string {
	return resolve(path).replace(/\\/g, "/").toLowerCase();
}

/**
 * The two JSONL readers, and the difference between them.
 *
 * The whole point of `readTornSafe` is that it reports a torn line as DATA
 * rather than raising it as an exception -- DIAG-08 is a measurement ("0 of 800
 * records torn"), and a reader that throws turns that measurement into a stack
 * trace at record 217. Asserting only that `readTornSafe` succeeds would not
 * prove the two readers differ at all; so the strict reader is pointed at the
 * SAME file and required to throw.
 */
describe("logs helper -- a torn line is a measurement, not an exception", () => {
	// Inline, and written at run time into a temp dir. A committed fixture named
	// `*.jsonl` would be silently untracked (.gitignore:30 is a blanket
	// `*.jsonl`), so CI would run this against a file that is not there.
	const MIXED_JSONL = ['{"seq":1,"ok":true}', '{"seq":2,"ok":true}', '{"seq":3,"ok":tr'].join(
		"\n",
	);

	it("readTornSafe returns the good records and the raw text of the torn one", async () => {
		await withTempLogCwd(async (cwd) => {
			const file = join(cwd, "turns-fixture.jsonl");
			writeFileSync(file, `${MIXED_JSONL}\n`, "utf-8");

			const { records, unparseable } = readTornSafe(file);

			expect(
				records,
				"both well-formed records must survive alongside the torn one; a reader that " +
					"drops good records when it meets a bad one under-counts the very thing " +
					"DIAG-08 measures",
			).toEqual([
				{ seq: 1, ok: true },
				{ seq: 2, ok: true },
			]);
			expect(
				unparseable,
				"the torn line must be reported verbatim, so a concurrency failure can be shown " +
					"rather than only counted",
			).toEqual(['{"seq":3,"ok":tr']);
		});
	});

	it("readJsonl throws on the same file, so the two readers are proven different", async () => {
		await withTempLogCwd(async (cwd) => {
			const file = join(cwd, "turns-fixture.jsonl");
			writeFileSync(file, `${MIXED_JSONL}\n`, "utf-8");

			expect(
				() => readJsonl(file),
				"if the strict reader also tolerated a torn line, `readTornSafe`'s tolerance " +
					"would be proving nothing -- the difference between them is the reason both exist",
			).toThrow();
		});
	});

	it("logFilesIn names files, sorts them, and reports an absent directory as empty", async () => {
		await withTempLogCwd(async (cwd) => {
			expect(
				logFilesIn(join(cwd, "does-not-exist")),
				"an absent log directory means the writer produced nothing; making the caller " +
					"guard existsSync first is how that check gets forgotten",
			).toEqual([]);

			writeFileSync(join(cwd, "turns-2026-08-13.jsonl"), "", "utf-8");
			writeFileSync(join(cwd, "wire-2026-08-13.jsonl"), "", "utf-8");
			expect(logFilesIn(cwd)).toEqual(["turns-2026-08-13.jsonl", "wire-2026-08-13.jsonl"]);
		});
	});

	it("removes its temp directory afterwards", async () => {
		let seen = "";
		await withTempLogCwd(async (cwd) => {
			seen = cwd;
			expect(existsSync(cwd)).toBe(true);
		});
		expect(existsSync(seen), "a leaked temp dir per test is how a long run fills a disk").toBe(
			false,
		);
	});
});

/**
 * The in-memory agent session really runs, and really runs OUTSIDE this repo.
 *
 * The second assertion is not hygiene. Pi walks up from `cwd` collecting
 * context files; from anywhere inside this repository that means loading a
 * 49 KB `CLAUDE.md` into every faux request -- measured at 12,725 input tokens
 * for a one-word prompt. Any later `/budget` or token-accounting test would
 * then be measuring this repo's own instructions. [threat T-02-01-02]
 */
describe("session helper -- a real agent run with no network and no credentials", () => {
	it("drives one prompt through the faux provider and disposes cleanly", async () => {
		let seenCwd = "";
		let seenAgentDir = "";

		await withFauxSession({}, async (handle) => {
			seenCwd = handle.cwd;
			seenAgentDir = handle.agentDir;

			await handle.session.prompt("hello");

			expect(
				handle.faux.state.callCount,
				"the session must have reached the provider exactly once; 0 means the prompt " +
					"never produced a request and every hook assertion downstream is vacuous",
			).toBe(1);

			expect(
				normalisePath(handle.cwd).startsWith(normalisePath(repoRoot())),
				`session cwd ${handle.cwd} is inside the repository at ${repoRoot()} -- Pi would ` +
					"load this repo's CLAUDE.md into every faux request and every token measurement " +
					"would be measuring the harness rather than the thing under test",
			).toBe(false);
		});

		expect(existsSync(seenCwd), "the temp cwd must be removed by dispose()").toBe(false);
		expect(existsSync(seenAgentDir), "the temp agentDir must be removed by dispose()").toBe(
			false,
		);
	});
});

/**
 * PITFALL 1 -- the guard this whole plan exists for.
 *
 * `fauxProvider` never calls `onPayload` (pi-ai src/providers/faux.ts:510), so
 * under a PLAIN faux session `before_provider_request` never fires and a
 * capture list is always empty. A DIAG-01 or DIAG-07 test written as "register
 * faux, prompt, assert the captured payload" would then pass while asserting
 * nothing, because its loop over an empty list never executes a single
 * expectation.
 *
 * `wrapFauxWithPayload` is the fix. This block is the proof that the fix is
 * live: it loads a user-scope extension that records every payload
 * `before_provider_request` hands it, runs one prompt, and requires the count
 * to be strictly positive BEFORE looking at any content.
 */
describe("faux helper -- before_provider_request actually fires", () => {
	/**
	 * The extension under test, as source. Written into `<agentDir>/extensions/`
	 * at USER scope by the session helper -- project scope is gated behind
	 * project trust, which resolves false headless.
	 *
	 * The handler has a BLOCK body and no return. Returning any non-undefined
	 * value from `before_provider_request` REPLACES the request payload for
	 * every later handler and for the real request
	 * (pi 0.84.1 src/core/extensions/runner.ts:1030-1033), so an expression-bodied
	 * arrow that happened to return something would silently rewrite the wire.
	 */
	const CAPTURE_EXTENSION = [
		'import { appendFileSync } from "node:fs";',
		'import { join } from "node:path";',
		"",
		"// Module-scoped: every payload this session saw, in order.",
		"const captured = [];",
		"",
		"export default function (pi) {",
		'	pi.on("before_provider_request", (event, ctx) => {',
		"		captured.push(event.payload);",
		"		appendFileSync(",
		'			join(ctx.cwd, "captured.jsonl"),',
		'			JSON.stringify({ index: captured.length - 1, keys: Object.keys(event.payload) }) + "\\n",',
		'			"utf-8",',
		"		);",
		"		// No return. See the docstring above.",
		"	});",
		"}",
		"",
	].join("\n");

	it("captures at least one payload through before_provider_request", async () => {
		await withFauxSession({ extensionSource: CAPTURE_EXTENSION }, async (handle) => {
			await handle.session.prompt("hello");

			const capturePath = join(handle.cwd, "captured.jsonl");
			const captured = existsSync(capturePath) ? readJsonl(capturePath) : [];

			expect(
				captured.length,
				"ZERO payloads were captured. `before_provider_request` did not fire, which means " +
					"tests/helpers/faux.ts is no longer emitting onPayload -- fauxProvider itself " +
					"never does (pi-ai src/providers/faux.ts:510). Every DIAG-01 and DIAG-07 " +
					"assertion downstream of this helper is therefore vacuous: it iterates an " +
					"empty capture list and passes without executing a single expectation. Fix the " +
					"wrapper; do not weaken this assertion.",
			).toBeGreaterThan(0);

			const first = captured[0] as { keys: string[] };
			expect(
				first.keys,
				"the captured payload must carry the OpenAI-completions shape from " +
					"buildOpenAiFixturePayload, not an invented one -- an unrealistic fixture " +
					"would let a redactor pass here and fail on the wire",
			).toEqual(expect.arrayContaining(["model", "messages", "stream"]));
		});
	});
});
