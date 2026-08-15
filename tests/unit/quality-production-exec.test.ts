/**
 * CR-01 / CR-02 / CR2-01 -- the deterministic gate stage's PRODUCTION exec
 * runner, proved against REAL subprocesses, not a scripted `ExecRunner`.
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
 * CR-01's fix: resolve `<cwd>/node_modules/.bin/<name>` (branching `shell`
 * on platform for the Windows `.cmd` case) instead of naming `npx`. A
 * missing binary is an honest `unavailable` naming the path, never a
 * network-fetching `npx`. CR-02's fix (this file's own next `describe`):
 * `LINT_GATE_FILES` (`gates.ts`) is THIS repository's own structural test
 * paths -- in any other `cwd` they do not exist, and vitest would report a
 * false FAIL rather than an honest "this leg does not apply here"; a
 * missing `.test.ts` target is now caught before a subprocess is spawned.
 *
 * CR2-01's fix (`08-REVIEW.md` iteration 2, this file's own last `describe`):
 * the CR-01 fix itself reintroduced CR-01's own failure mode -- `spawnSync(bin,
 * args, {shell: true})` with a raw args array is unescaped `cmd.exe`
 * concatenation, and `bin` embeds `cwd`. A `cwd` containing a space or a
 * shell metacharacter (`&`) corrupted the command line and reported a false
 * `fail` full of `cmd.exe` chatter, never an honest `unavailable`.
 * `.pi/lib/win-quote.ts#commandFor` closes this by quoting every argument
 * and folding them into one command string.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { makeTempRepo, repoRoot } from "../helpers/git.ts";
import { productionExec, runQuickGateStage, setQuickGateExecOverrideForTests } from "../../.pi/extensions/quality/index.ts";
import { runTypecheckLeg } from "../../.pi/extensions/quality/gates.ts";

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

describe("CR-02 -- the lint leg's hardcoded target files degrade honestly in a foreign repository, never a false FAIL", () => {
	it("productionExec throws naming the missing target file when a .test.ts argument does not exist under cwd, even if the binary IS installed (the LINT_GATE_FILES-in-a-foreign-repo bug)", () => {
		// repoRoot() has a real vitest binary installed, so this isolates the
		// target-file-existence check from the binary-existence check CR-01
		// already covers.
		expect(() => productionExec("vitest", ["run", "tests/unit/does-not-exist-kypi-cr02.test.ts"], repoRoot())).toThrowError(
			/target file\(s\) not found under .* tests\/unit\/does-not-exist-kypi-cr02\.test\.ts/,
		);
	});
});

/** A minimal real-executable stub binary -- `tsc.cmd` on Windows, a `tsc` shell script elsewhere. */
function stubTsc(repo: string, opts: { exitCode: number; message?: string }): void {
	const binDir = join(repo, "node_modules", ".bin");
	mkdirSync(binDir, { recursive: true });
	const echo = opts.message ? `echo ${opts.message}` : "";
	if (process.platform === "win32") {
		writeFileSync(join(binDir, "tsc.cmd"), `@echo off\r\n${echo}\r\nexit /b ${opts.exitCode}\r\n`, { mode: 0o755 });
	} else {
		writeFileSync(join(binDir, "tsc"), `#!/bin/sh\n${echo}\nexit ${opts.exitCode}\n`, { mode: 0o755 });
	}
}

describe("CR2-01 -- a cwd containing a space or a shell metacharacter runs the REAL binary, never cmd.exe concatenation noise", () => {
	it("a cwd whose path contains a space -- productionExec via runTypecheckLeg is PASS, never a cmd.exe-noise FAIL", () => {
		const repo = makeTempRepo("kypi cr2-01 spaced ");
		// The fixture itself must genuinely exercise the hazard, or this test
		// would pass on a machine with no space in os.tmpdir() while proving
		// nothing -- exactly IN2-01's "reproducible on this machine only" trap.
		expect(repo, "fixture path must contain a space to exercise the CR2-01 regression").toMatch(/ /);
		stubTsc(repo, { exitCode: 0 });
		expect(runTypecheckLeg(repo, productionExec)).toEqual({ status: "pass" });
	});

	it("a cwd whose path contains '&' -- productionExec via runTypecheckLeg is PASS, never a cmd.exe-split command", () => {
		const repo = makeTempRepo("kypi-cr2-01-amp&dir-");
		expect(repo, "fixture path must contain '&' to exercise the CR2-01 regression's secondary case").toMatch(/&/);
		stubTsc(repo, { exitCode: 0 });
		expect(runTypecheckLeg(repo, productionExec)).toEqual({ status: "pass" });
	});

	it("a genuine compiler FAIL from a spaced cwd carries the stub's own output, never cmd.exe's 'is not recognized' chatter (proves the leg still reports real findings, not just a lucky exit 0)", () => {
		const repo = makeTempRepo("kypi cr2-01 fail spaced ");
		stubTsc(repo, { exitCode: 1, message: "kypi-cr2-01-fake-compiler-error-TS1234" });
		const leg = runTypecheckLeg(repo, productionExec);
		expect(leg.status).toBe("fail");
		if (leg.status === "fail") {
			expect(leg.findings.join("\n")).toMatch(/kypi-cr2-01-fake-compiler-error-TS1234/);
			expect(leg.findings.join("\n")).not.toMatch(/is not recognized as an internal or external command/i);
		}
	});
});

