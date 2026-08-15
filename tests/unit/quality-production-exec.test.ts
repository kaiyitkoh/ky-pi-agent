/**
 * CR-01 -- the deterministic gate stage's PRODUCTION exec runner, proved
 * against REAL subprocesses, not a scripted `ExecRunner`.
 *
 * The code-review's own reproduction: `spawnSync("npx", [...], {shell:false})`
 * throws `ENOENT` on this machine (win32, Node v24.16.0), which degraded
 * BOTH the typecheck and lint legs to `unavailable` -- a leg that is
 * `unavailable` never sets `GateResult.blocking` by design, so a hard
 * TypeScript error or a broken structural lint suite would silently arm a
 * `/quick` run. `quality-gates.test.ts` and `quality-gate-order.test.ts`
 * never catch this class of bug: the former only ever passes a scripted
 * `ExecRunner`, and the latter deliberately overrides it via
 * `setQuickGateExecOverrideForTests` for exactly the opposite reason (never
 * reach a real subprocess against a throwaway fixture). This file is the
 * one place that asserts what actually happens with NEITHER of those safety
 * nets -- the exact shape `runQuickGateStage` runs in for a real user.
 *
 * The fix: resolve `<cwd>/node_modules/.bin/<name>` (branching `shell` on
 * platform for the Windows `.cmd` case) instead of naming `npx`. A missing
 * binary is an honest `unavailable` naming the path, never a network-
 * fetching `npx` -- CR-02 (a following commit) tightens this further for a
 * secondary correctness bug in the lint leg's hardcoded target-file list.
 */
import { afterEach, describe, expect, it } from "vitest";

import { makeTempRepo, repoRoot } from "../helpers/git.ts";
import { productionExec, runQuickGateStage, setQuickGateExecOverrideForTests } from "../../.pi/extensions/quality/index.ts";

afterEach(() => {
	// Belt-and-braces, matching quality-gate-order.test.ts's own discipline --
	// this file never installs an override itself, but a prior file sharing
	// this worker must not leak one in.
	setQuickGateExecOverrideForTests(undefined);
});

describe("CR-01 -- the real production exec runner genuinely spawns on this platform", () => {
	it("productionExec('tsc', ['--version'], repoRoot()) is a REAL spawn -- prints a version string, never throws", () => {
		// The narrowest possible proof, isolated from tsc's own project-wide
		// runtime: if THIS throws, the CR-01 regression (npx ENOENT on
		// Windows, or any other spawn failure) is back, independent of
		// whether this repository's own source happens to typecheck clean.
		const result = productionExec("tsc", ["--version"], repoRoot());
		expect(result.code, `tsc --version exited ${result.code}; stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout).toMatch(/Version \d+\.\d+\.\d+/);
	});

	it(
		"runQuickGateStage(repoRoot()) with NO override installed -- typecheck and lint legs are pass or fail, " +
			"NEVER unavailable (the exact regression CR-01 fixes)",
		() => {
			setQuickGateExecOverrideForTests(undefined); // explicit: proves the PRODUCTION path, not a leaked override
			const result = runQuickGateStage(repoRoot());
			expect(
				result.legs.typecheck.status,
				`typecheck leg is UNAVAILABLE -- ${result.legs.typecheck.status === "unavailable" ? result.legs.typecheck.reason : ""} -- ` +
					"a real 'tsc' binary is installed in this repository's own node_modules, so this leg must genuinely run",
			).not.toBe("unavailable");
			expect(["pass", "fail"]).toContain(result.legs.typecheck.status);

			expect(
				result.legs.lint.status,
				`lint leg is UNAVAILABLE -- ${result.legs.lint.status === "unavailable" ? result.legs.lint.reason : ""} -- ` +
					"a real 'vitest' binary is installed in this repository's own node_modules, so this leg must genuinely run",
			).not.toBe("unavailable");
			expect(["pass", "fail"]).toContain(result.legs.lint.status);
		},
	);

	it("this repository's own source is clean: typecheck and lint both PASS for real (paired positive, not merely 'not unavailable')", () => {
		const result = runQuickGateStage(repoRoot());
		expect(result.legs.typecheck.status, result.legs.typecheck.status === "fail" ? result.legs.typecheck.findings.join("\n") : "").toBe("pass");
		expect(result.legs.lint.status, result.legs.lint.status === "fail" ? result.legs.lint.findings.join("\n") : "").toBe("pass");
	});

	it("productionExec throws naming the missing binary when cwd has no node_modules at all (never falls through to npx)", () => {
		const repo = makeTempRepo("kypi-cr01-exec-");
		expect(() => productionExec("tsc", ["--noEmit"], repo)).toThrowError(/tsc is not installed under/);
	});

	it("runQuickGateStage against a throwaway fixture with no node_modules -- typecheck and lint legs are UNAVAILABLE, naming the missing binary, never FAIL and never a hang", () => {
		const repo = makeTempRepo("kypi-cr01-gate-");
		const result = runQuickGateStage(repo);
		expect(result.legs.typecheck).toEqual({
			status: "unavailable",
			reason: expect.stringContaining("tsc is not installed under"),
		});
		expect(result.legs.lint).toEqual({
			status: "unavailable",
			reason: expect.stringContaining("vitest is not installed under"),
		});
		// UNAVAILABLE never sets blocking, by GATE-01's own three-state contract
		// -- restated here because a regression that turned this into `fail`
		// would ALSO make this specific assertion false, catching either bug.
		expect(result.blocking).toBe(false);
	});
});
