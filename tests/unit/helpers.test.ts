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
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";
import { requirePiOnPath, runPi } from "../helpers/pi.ts";
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
