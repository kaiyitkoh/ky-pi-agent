/**
 * The deterministic gate's production exec runner, proved against REAL subprocesses, not a scripted
 * `ExecRunner`: the pinned local binary is resolved per platform, never `npx`; a missing binary, an
 * untrusted project or a cwd hazardous to `cmd.exe` degrades to `unavailable`, never to a false FAIL.
 * `quality-gate-order.test.ts` installs an override for the opposite reason (never reach a subprocess).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { commitFile, makeTempRepo, repoRoot } from "../helpers/git.ts";
import { productionExec, runChangeGateStage, runTypecheckAt, setQuickGateExecOverrideForTests } from "../../.pi/extensions/quality/index.ts";
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

	it("this repository's own source typechecks for real through the production runner: PASS, never unavailable", () => {
		setQuickGateExecOverrideForTests(undefined);
		const leg = runTypecheckAt(repoRoot(), true);
		expect(leg.status, leg.status === "fail" ? leg.findings.join("\n") : leg.status === "unavailable" ? leg.reason : "").toBe("pass");
	});

	it("productionExec throws naming the missing binary when cwd has no node_modules at all (never falls through to npx)", () => {
		const repo = makeTempRepo("kypi-cr01-exec-");
		expect(() => productionExec("tsc", ["--noEmit"], repo)).toThrowError(/tsc is not installed under/);
	});

	it("a throwaway fixture with a tsconfig but no node_modules: typecheck and lint are UNAVAILABLE naming the missing binary, never FAIL", () => {
		const repo = makeTempRepo("kypi-cr01-gate-");
		writeFileSync(join(repo, "tsconfig.json"), "{}\n", "utf-8");
		writeFileSync(join(repo, "eslint.config.js"), "export default [];\n", "utf-8");
		const base = commitFile(repo, "seed.txt", "seed\n", "seed");
		writeFileSync(join(repo, "a.ts"), "export const a = 1;\n", "utf-8");
		const result = runChangeGateStage({ cwd: repo, projectTrusted: true, baseSha: base, changed: ["a.ts"], baseTypecheckFailed: false });
		expect(result.typecheck).toEqual({ status: "unavailable", reason: expect.stringContaining("tsc is not installed under") });
		expect(result.lint).toEqual({ status: "unavailable", reason: expect.stringContaining("eslint is not installed under") });
		expect(result.failed).toBe(false);
	});
});

describe("a test-file target absent from cwd degrades honestly, never a false FAIL", () => {
	it("productionExec throws naming the missing target file when a .test.ts argument does not exist under cwd, even if the binary IS installed", () => {
		// repoRoot() has a real vitest binary installed, so this isolates the
		// target-file-existence check from the binary-existence check CR-01
		// already covers.
		expect(() => productionExec("vitest", ["run", "tests/unit/does-not-exist-kypi-cr02.test.ts"], repoRoot())).toThrowError(
			/target file\(s\) not found under .* tests\/unit\/does-not-exist-kypi-cr02\.test\.ts/,
		);
	});
});

/** A minimal real-executable stub binary -- `<name>.cmd` on Windows, a shell script elsewhere. `argsFile` receives the argv. */
function stubBin(repo: string, name: string, opts: { exitCode: number; message?: string; argsFile?: string }): void {
	const binDir = join(repo, "node_modules", ".bin");
	mkdirSync(binDir, { recursive: true });
	const echo = opts.message ? `echo ${opts.message}` : "";
	if (process.platform === "win32") {
		const record = opts.argsFile ? `echo %* > "${opts.argsFile}"\r\n` : "";
		writeFileSync(join(binDir, `${name}.cmd`), `@echo off\r\n${record}${echo}\r\nexit /b ${opts.exitCode}\r\n`, { mode: 0o755 });
	} else {
		const record = opts.argsFile ? `echo "$@" > "${opts.argsFile}"\n` : "";
		writeFileSync(join(binDir, name), `#!/bin/sh\n${record}${echo}\nexit ${opts.exitCode}\n`, { mode: 0o755 });
	}
}

function stubTsc(repo: string, opts: { exitCode: number; message?: string }): void {
	stubBin(repo, "tsc", opts);
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
				"%VAR% expansion as bin is. No gate caller passes such an argument, so this is a direct call, not a leg path",
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

	it("a tsconfig in an ancestor below the git top level counts: typecheck runs from a subdirectory, never unavailable", () => {
		const repo = makeTempRepo("kypi-tsconfig-walk-");
		writeFileSync(join(repo, "tsconfig.json"), "{}\n", "utf-8");
		stubTsc(repo, { exitCode: 0 });
		const sub = join(repo, "packages", "app");
		mkdirSync(sub, { recursive: true });
		expect(runTypecheckAt(sub, true)).toEqual({ status: "pass" });
	});

	it("productionExec resolves the 'vitest' binary itself from a subdirectory of repoRoot()", () => {
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

describe("an untrusted project's cwd never reaches a real spawn, even when a real binary is installed there", () => {
	function fixture(prefix: string): { repo: string; base: string } {
		const repo = makeTempRepo(prefix);
		writeFileSync(join(repo, "tsconfig.json"), "{}\n", "utf-8");
		writeFileSync(join(repo, "eslint.config.js"), "export default [];\n", "utf-8");
		stubBin(repo, "tsc", { exitCode: 0 });
		stubBin(repo, "eslint", { exitCode: 0 });
		const base = commitFile(repo, "seed.txt", "seed\n", "seed");
		writeFileSync(join(repo, "a.ts"), "export const a = 1;\n", "utf-8");
		return { repo, base };
	}

	it("untrusted: typecheck and lint are UNAVAILABLE naming trust, never pass or fail", () => {
		setQuickGateExecOverrideForTests(undefined);
		const { repo, base } = fixture("kypi-untrusted-");
		const result = runChangeGateStage({ cwd: repo, projectTrusted: false, baseSha: base, changed: ["a.ts"], baseTypecheckFailed: false });
		expect(result.typecheck).toEqual({ status: "unavailable", reason: expect.stringContaining("is not trusted") });
		expect(result.lint).toEqual({ status: "unavailable", reason: expect.stringContaining("is not trusted") });
		expect(result.failed).toBe(false);
	});

	it("paired positive: the same fixture trusted genuinely runs both legs", () => {
		setQuickGateExecOverrideForTests(undefined);
		const { repo, base } = fixture("kypi-trusted-");
		const result = runChangeGateStage({ cwd: repo, projectTrusted: true, baseSha: base, changed: ["a.ts"], baseTypecheckFailed: false });
		expect(result.typecheck).toEqual({ status: "pass" });
		expect(result.lint).toEqual({ status: "pass" });
	});

	it("an installed test override wins regardless of projectTrusted", () => {
		const alwaysPass = (): { code: number; stdout: string; stderr: string } => ({ code: 0, stdout: "", stderr: "" });
		setQuickGateExecOverrideForTests(alwaysPass);
		try {
			expect(runTypecheckAt(repoRoot(), false).status, "an installed override must win even when projectTrusted is false").toBe("pass");
		} finally {
			setQuickGateExecOverrideForTests(undefined);
		}
	});
});

describe("the change gate's four legs report only what ran", () => {
	function repoWith(prefix: string, opts: { tsconfig?: boolean; eslintConfig?: boolean }): { repo: string; base: string } {
		const repo = makeTempRepo(prefix);
		if (opts.tsconfig) writeFileSync(join(repo, "tsconfig.json"), "{}\n", "utf-8");
		if (opts.eslintConfig) writeFileSync(join(repo, "eslint.config.js"), "export default [];\n", "utf-8");
		const base = commitFile(repo, "seed.txt", "seed\n", "seed");
		writeFileSync(join(repo, "a.ts"), "export const a = 1;\n", "utf-8");
		return { repo, base };
	}
	const gate = (repo: string, base: string, changed = ["a.ts"]) =>
		runChangeGateStage({ cwd: repo, projectTrusted: true, baseSha: base, changed, baseTypecheckFailed: false });

	it("no tsconfig.json anywhere up to the git top level: typecheck is UNAVAILABLE naming the tsconfig, even with a failing tsc installed", () => {
		setQuickGateExecOverrideForTests(undefined);
		const { repo, base } = repoWith("kypi-notsconfig-", {});
		stubBin(repo, "tsc", { exitCode: 2, message: "kypi-would-fail" });
		const result = gate(repo, base);
		expect(result.typecheck).toEqual({ status: "unavailable", reason: expect.stringContaining("tsconfig") });
		expect(result.failed).toBe(false);
	});

	it("control: with a tsconfig the same failing tsc is a FAIL", () => {
		setQuickGateExecOverrideForTests(undefined);
		const { repo, base } = repoWith("kypi-tsconfig-", { tsconfig: true });
		stubBin(repo, "tsc", { exitCode: 2, message: "kypi-would-fail" });
		const result = gate(repo, base);
		expect(result.typecheck.status).toBe("fail");
		expect(result.failed).toBe(true);
	});

	it("lint: the repo's own eslint exiting 1 is a FAIL carrying its output; it is invoked with only the changed code file", () => {
		setQuickGateExecOverrideForTests(undefined);
		const { repo, base } = repoWith("kypi-lint-fail-", { eslintConfig: true });
		const argsFile = join(repo, "eslint-args.txt");
		stubBin(repo, "eslint", { exitCode: 1, message: "kypi-lint-finding", argsFile });
		writeFileSync(join(repo, "notes.md"), "x\n", "utf-8");
		const result = gate(repo, base, ["a.ts", "notes.md", "gone.ts"]);
		expect(result.lint.status).toBe("fail");
		expect(result.lint.status === "fail" && result.lint.findings.join("\n")).toContain("kypi-lint-finding");
		const args = readFileSync(argsFile, "utf-8").trim().split(/\s+/);
		expect(args.filter((a) => a !== "--")).toEqual(["a.ts"]);
		expect(result.failed).toBe(true);
	});

	it("lint: eslint exiting 0 is a PASS", () => {
		setQuickGateExecOverrideForTests(undefined);
		const { repo, base } = repoWith("kypi-lint-pass-", { eslintConfig: true });
		stubBin(repo, "eslint", { exitCode: 0 });
		expect(gate(repo, base).lint).toEqual({ status: "pass" });
	});

	it("lint: an exit code other than 0 or 1 is UNAVAILABLE, not a verdict", () => {
		setQuickGateExecOverrideForTests(undefined);
		const { repo, base } = repoWith("kypi-lint-crash-", { eslintConfig: true });
		stubBin(repo, "eslint", { exitCode: 2, message: "kypi-config-error" });
		expect(gate(repo, base).lint).toEqual({ status: "unavailable", reason: expect.stringContaining("exited 2") });
	});

	it("lint: no ESLint config is UNAVAILABLE and never invokes eslint", () => {
		setQuickGateExecOverrideForTests(undefined);
		const { repo, base } = repoWith("kypi-lint-noconfig-", {});
		const argsFile = join(repo, "eslint-args.txt");
		stubBin(repo, "eslint", { exitCode: 1, argsFile });
		expect(gate(repo, base).lint).toEqual({ status: "unavailable", reason: expect.stringContaining("no ESLint config") });
		expect(existsSync(argsFile)).toBe(false);
	});

	it("lsp is UNAVAILABLE and never PASS, with the tools registered or missing", () => {
		const key = "__kypiQualityRegisteredToolNames";
		const g = globalThis as Record<string, unknown>;
		const saved = g[key];
		const { repo, base } = repoWith("kypi-lsp-", {});
		try {
			g[key] = () => ["lsp_diagnostics", "lsp_fix"];
			expect(gate(repo, base).lsp).toEqual({ status: "unavailable", reason: expect.stringContaining("registered but not run") });
			g[key] = () => [];
			expect(gate(repo, base).lsp).toEqual({ status: "unavailable", reason: expect.stringContaining("lsp_diagnostics") });
		} finally {
			g[key] = saved;
		}
	});

	it("the report lists the four legs in order, and ranAny is false when nothing ran", () => {
		setQuickGateExecOverrideForTests(undefined);
		const { repo, base } = repoWith("kypi-report-", {});
		const result = gate(repo, base, ["notes.md"]);
		const ids = result.report.split("\n").map((l) => l.split(":")[0]);
		expect(ids).toEqual(["typecheck", "lint", "lsp", "anti-pattern"]);
		expect(result.ranAny).toBe(false);
	});
});

describe("a cwd below the git top level still gates the changed files git reports", () => {
	it("an anti-pattern added under the subdirectory is found, and lint runs from the config above cwd on the real file", () => {
		setQuickGateExecOverrideForTests(undefined);
		const repo = makeTempRepo("kypi-subdir-gate-");
		const base = commitFile(repo, "seed.txt", "seed\n", "seed");
		const sub = join(repo, "apps", "web");
		mkdirSync(join(sub, "src"), { recursive: true });
		writeFileSync(join(repo, "eslint.config.js"), "export default [];\n", "utf-8");
		const argsFile = join(repo, "eslint-args.txt");
		stubBin(repo, "eslint", { exitCode: 0, argsFile });
		writeFileSync(join(sub, "src", "x.ts"), "export function f(): void {\n  try {\n    JSON.parse('x');\n  } catch {}\n}\n", "utf-8");
		const result = runChangeGateStage({ cwd: sub, projectTrusted: true, baseSha: base, changed: ["apps/web/src/x.ts"], baseTypecheckFailed: false });
		expect(result.antiPattern.status, result.report).toBe("fail");
		expect(result.lint.status, result.report).toBe("pass");
		expect(readFileSync(argsFile, "utf-8")).toContain("x.ts");
	});
});

describe("localBin never resolves a binary above the git top level", () => {
	it("a tsc installed in a directory that contains the repo is not used", () => {
		const outer = mkdtempSync(join(tmpdir(), "kypi-outer-bin-"));
		stubBin(outer, "tsc", { exitCode: 0 });
		const repo = join(outer, "repo");
		mkdirSync(repo);
		expect(spawnSync("git", ["init", "-q"], { cwd: repo, shell: false }).status).toBe(0);
		expect(() => productionExec("tsc", ["--version"], repo)).toThrowError(/not installed under .* up to the git top level/);
		rmSync(outer, { recursive: true, force: true });
	});
});
