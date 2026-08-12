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
