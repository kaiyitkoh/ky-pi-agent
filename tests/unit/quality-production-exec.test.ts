/**
 * CR-01 / CR-02 / CR2-01 / WR2-01 -- the deterministic gate stage's
 * PRODUCTION exec runner, proved against REAL subprocesses, not a scripted
 * `ExecRunner`.
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
 * CR2-01's fix (`08-REVIEW.md` iteration 2): the CR-01 fix itself reintroduced
 * CR-01's own failure mode -- `spawnSync(bin, args, {shell: true})` with a raw
 * args array is unescaped `cmd.exe` concatenation, and `bin` embeds `cwd`. A
 * `cwd` containing a space or a shell metacharacter (`&`) corrupted the
 * command line and reported a false `fail` full of `cmd.exe` chatter, never an
 * honest `unavailable`. `.pi/lib/win-quote.ts#commandFor` closes this by
 * quoting every argument and folding them into one command string. WR2-01's
 * fix (this file's own last `describe`): `localBin` now walks up to an
 * ancestor `node_modules`, the way the `npx` shim it replaced always did.
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
			// WR2-06: projectTrusted: true -- this IS this repository, genuinely trusted.
			const result = runQuickGateStage(repoRoot(), true);
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
		const result = runQuickGateStage(repoRoot(), true); // WR2-06: this repository is genuinely trusted
		expect(result.legs.typecheck.status, result.legs.typecheck.status === "fail" ? result.legs.typecheck.findings.join("\n") : "").toBe("pass");
		expect(result.legs.lint.status, result.legs.lint.status === "fail" ? result.legs.lint.findings.join("\n") : "").toBe("pass");
	});

	it("productionExec throws naming the missing binary when cwd has no node_modules at all (never falls through to npx)", () => {
		const repo = makeTempRepo("kypi-cr01-exec-");
		expect(() => productionExec("tsc", ["--noEmit"], repo)).toThrowError(/tsc is not installed under/);
	});

	it("runQuickGateStage against a throwaway fixture with no node_modules -- typecheck and lint legs are UNAVAILABLE, naming the missing binary, never FAIL and never a hang", () => {
		const repo = makeTempRepo("kypi-cr01-gate-");
		// WR2-06: projectTrusted: true -- this test isolates CR-01's missing-binary
		// degradation from WR2-06's separate trust gate (covered by its own describe below).
		const result = runQuickGateStage(repo, true);
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

describe(
	"WR3-04 -- a cwd whose resolved binary path contains '%' is refused honestly BEFORE spawning, never " +
		"misreported as a compiler FAIL",
	() => {
		it(
			"a cwd containing '%OS%' -- productionExec via runTypecheckLeg is UNAVAILABLE on Windows (cmd.exe " +
				"would expand %VAR% inside quotes, a hazard CR2-01's own commandFor quoting does not close), " +
				"naming '%' as the reason -- the first test to exercise this guard at all",
			() => {
				// %OS% is always defined on Windows (a built-in cmd.exe variable) and
				// is a harmless literal filename character on POSIX -- reproduces
				// the review's own live evidence (a %PATH%/%OS%-containing cwd
				// producing cmd.exe's "filename ... syntax is incorrect" /
				// "system cannot find the path specified" chatter, neither of which
				// CMD_EXE_SPAWN_FAILURE's regex matches).
				const repo = makeTempRepo("kypi-wr3-04-pct%OS%dir-");
				expect(repo, "fixture path must contain '%' to exercise the WR3-04 regression").toMatch(/%/);
				stubTsc(repo, { exitCode: 0 });
				const leg = runTypecheckLeg(repo, productionExec);
				if (process.platform === "win32") {
					expect(leg.status, `expected unavailable on win32, got ${JSON.stringify(leg)}`).toBe("unavailable");
					if (leg.status === "unavailable") {
						expect(leg.reason).toMatch(/contains '%'/);
						expect(leg.reason).not.toMatch(/is not recognized as an internal or external command/i);
					}
				} else {
					// '%' carries no shell meaning outside cmd.exe, and commandFor's
					// POSIX branch never invokes a shell at all (`isWindows` false ->
					// `[cmd, args]` passed straight to spawnSync with shell:false) --
					// the leg genuinely runs and passes, proving the guard is Windows-
					// only, not an overbroad refusal on every platform.
					expect(leg.status).toBe("pass");
				}
			},
		);

		it(
			"WR3C-02 -- a '%'-bearing ARGUMENT (not the resolved binary path) is refused the same way -- " +
				"commandFor folds [bin, ...args] into ONE cmd.exe command line, so args are exactly as exposed to " +
				"%VAR% expansion as bin is. Currently unreachable via any real caller (LINT_GATE_FILES and " +
				"['--noEmit'] never contain '%'), so this is a direct call, not a runTypecheckLeg/runLintLeg path",
			() => {
				const repo = makeTempRepo("kypi-wr3c-02-args-pct-");
				stubTsc(repo, { exitCode: 0 });
				if (process.platform === "win32") {
					expect(() => productionExec("tsc", ["--foo=%OS%"], repo)).toThrowError(/command line contains '%' in .*--foo=%OS%/);
				} else {
					// '%' carries no shell meaning outside cmd.exe -- the call genuinely
					// spawns and returns a real result, never a thrown guard error.
					const result = productionExec("tsc", ["--foo=%OS%"], repo);
					expect(result.code).toBe(0);
				}
			},
		);

		it("the guard fires on ANY '%' in the resolved path, not only a literal %VAR% pair -- '50% off' also refuses on win32, and still passes cleanly on POSIX", () => {
			// The review's own example ("50% off is harmless") describes the
			// REAL-WORLD rarity of this hazard, not a claim that the guard should
			// try to distinguish a genuine %VAR% pair from an incidental '%'.
			// Reliably telling the two apart would require knowing which
			// environment variables cmd.exe would resolve at spawn time, which is
			// itself unreliable to predict ahead of the spawn -- so the guard is
			// deliberately a blunt "any '%' at all" check, trading a slightly
			// wider (but still honest, never a silent pass or misreported fail)
			// refusal for not having to get that classification right.
			const repo = makeTempRepo("kypi wr3-04 50% off ");
			expect(repo, "fixture path must contain '%' to exercise the WR3-04 regression's second case").toMatch(/%/);
			stubTsc(repo, { exitCode: 0 });
			const leg = runTypecheckLeg(repo, productionExec);
			if (process.platform === "win32") {
				expect(leg.status).toBe("unavailable");
			} else {
				expect(leg.status).toBe("pass");
			}
		});
	},
);

describe("WR2-01 -- localBin walks up to an ancestor node_modules, matching the npx shim it replaced", () => {
	it("productionExec resolves the binary from a subdirectory of repoRoot() that has no node_modules of its own -- never unavailable", () => {
		// docs/ is a real subdirectory of this repository with no node_modules
		// of its own; repoRoot()'s node_modules is its nearest ancestor with one.
		const subdir = join(repoRoot(), "docs");
		const result = productionExec("tsc", ["--version"], subdir);
		expect(result.code, `tsc --version exited ${result.code} from ${subdir}; stderr: ${result.stderr}`).toBe(0);
		expect(result.stdout).toMatch(/Version \d+\.\d+\.\d+/);
	});

	it("runQuickGateStage from a subdirectory with no node_modules of its own -- the typecheck leg is pass or fail, NEVER unavailable (the exact regression WR2-01 fixes)", () => {
		// The typecheck leg's exec ("tsc", ["--noEmit"], cwd) never names a
		// cwd-relative path, so this isolates the binary-resolution fix
		// (localBin's ancestor walk) from CR-02's SEPARATE cwd-relative
		// target-file check, which the lint leg is intentionally still subject
		// to from a non-repo-root cwd -- LINT_GATE_FILES names paths relative
		// to repoRoot(), so the lint leg legitimately still reports unavailable
		// from docs/ (naming the missing target files, not a missing binary);
		// that is CR-02's own documented behaviour, not WR2-01's concern.
		const subdir = join(repoRoot(), "docs");
		const result = runQuickGateStage(subdir, true); // WR2-06: this repository's own subdirectory is trusted
		expect(
			result.legs.typecheck.status,
			result.legs.typecheck.status === "unavailable" ? result.legs.typecheck.reason : "",
		).not.toBe("unavailable");
		expect(["pass", "fail"]).toContain(result.legs.typecheck.status);
	});

	it("productionExec resolves the 'vitest' binary itself from a subdirectory of repoRoot() -- the lint leg's OWN unavailability from docs/ is CR-02's cwd-relative target-file check, never a missing-binary error", () => {
		const subdir = join(repoRoot(), "docs");
		// No .test.ts argument here -- isolates binary resolution (WR2-01) from
		// CR-02's missingTargets check, which only fires when a `.test.ts`
		// argument is present.
		const result = productionExec("vitest", ["--version"], subdir);
		expect(result.code, `vitest --version exited ${result.code} from ${subdir}; stderr: ${result.stderr}`).toBe(0);
	});

	it("productionExec still reports an honest unavailable, naming both cwd and 'or any ancestor's', when no node_modules exists anywhere up the chain (a throwaway temp repo)", () => {
		const repo = makeTempRepo("kypi-wr2-01-exec-");
		expect(() => productionExec("tsc", ["--noEmit"], repo)).toThrowError(/tsc is not installed under .* or any ancestor's/);
	});
});

describe("WR2-06 -- an untrusted project's cwd never reaches a real spawn, even when a real binary is genuinely installed there", () => {
	it("runQuickGateStage(<temp repo with a REAL tsc stub installed>, false) -- typecheck and lint legs are UNAVAILABLE naming trust, never pass or fail, even though a real binary genuinely exists at the resolved path", () => {
		setQuickGateExecOverrideForTests(undefined); // explicit: proves the PRODUCTION path, not a leaked override
		// A throwaway temp repo, never repoRoot() -- isolates this assertion from
		// this repository's OWN unrelated deterministic anti-pattern findings
		// (a pre-existing, accepted residual, orthogonal to WR2-06 entirely) so
		// `result.blocking` below measures only what this test claims to measure.
		const repo = makeTempRepo("kypi-wr2-06-untrusted-");
		stubTsc(repo, { exitCode: 0 }); // a REAL binary genuinely resolvable at node_modules/.bin/tsc(.cmd)
		const result = runQuickGateStage(repo, false);
		expect(result.legs.typecheck).toEqual({
			status: "unavailable",
			reason: expect.stringContaining("is not trusted"),
		});
		expect(result.legs.lint).toEqual({
			status: "unavailable",
			reason: expect.stringContaining("is not trusted"),
		});
		// UNAVAILABLE never sets blocking, by GATE-01's own three-state contract --
		// an untrusted project degrades honestly, it does not block /quick outright
		// (a user who has not yet answered Pi's own trust prompt is not thereby
		// locked out of the command entirely). No .pi/extensions/ content exists in
		// this temp repo, so the (untouched, non-exec) anti-pattern leg trivially
		// passes and the LSP leg is UNAVAILABLE by its own separate contract --
		// neither sets blocking either, so this genuinely isolates WR2-06's own claim.
		expect(result.blocking).toBe(false);
	});

	it("runQuickGateStage(repoRoot(), true) with the SAME repo -- typecheck and lint legs genuinely run (paired positive: the gate is proved to actually flip on trust, not merely always refuse)", () => {
		setQuickGateExecOverrideForTests(undefined);
		const result = runQuickGateStage(repoRoot(), true);
		expect(result.legs.typecheck.status, result.legs.typecheck.status === "fail" ? result.legs.typecheck.findings.join("\n") : "").toBe("pass");
		expect(result.legs.lint.status, result.legs.lint.status === "fail" ? result.legs.lint.findings.join("\n") : "").toBe("pass");
	});

	it("an installed test override wins regardless of projectTrusted -- an override is a scripted stub that never touches disk, so gating it behind trust would be friction with no security benefit", () => {
		const alwaysPass = (): { code: number; stdout: string; stderr: string } => ({ code: 0, stdout: "", stderr: "" });
		setQuickGateExecOverrideForTests(alwaysPass);
		try {
			const untrusted = runQuickGateStage(repoRoot(), false);
			expect(untrusted.legs.typecheck.status, "an installed override must win even when projectTrusted is false").toBe("pass");
			expect(untrusted.legs.lint.status).toBe("pass");
		} finally {
			setQuickGateExecOverrideForTests(undefined);
		}
	});
});
