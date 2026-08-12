/**
 * Throwaway executable stubs on a throwaway PATH.
 *
 * Why this exists: several controls in this phase are about how a THIRD-PARTY
 * binary behaves -- `gh auth status` for SAFE-16, `npm`/`pi` ordering for
 * BOOT-01/BOOT-06. Asserting against the real ones would mean asserting against
 * the developer's live machine state. That is wrong twice over:
 *
 *   - it is not reproducible. `gh` IS currently authenticated on this machine
 *     (account kaiyitkoh, scopes gist/read:org/repo/workflow)
 *     [VERIFIED: RESEARCH.md 6.3, executed 2026-08-13], so a test asserting
 *     "gh is logged out" would fail here and pass in CI, or vice versa;
 *   - it is destructive. The only way to make that assertion true for real is
 *     `gh auth logout`, and no test may log the developer out.
 *
 * So: write fake binaries into a temp directory, put that directory FIRST on
 * PATH, and delete it afterwards. Nothing outside the temp directory is
 * touched. [threat T-01-07]
 *
 * ---------------------------------------------------------------------------
 * Windows executability -- verified, not assumed
 * ---------------------------------------------------------------------------
 * A stub must be resolvable on both platforms, so each one is written three
 * ways: the real logic in `<name>.mjs`, a POSIX `sh` launcher at `<name>`, and
 * a `<name>.cmd` shim for PATHEXT.
 *
 * `.mjs` is deliberate. PATHEXT on this machine is
 *   .COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.PY;.PYW;.CPL
 * [VERIFIED: executed 2026-08-13] -- note `.JS` is in it. Naming the payload
 * `<name>.js` would let Windows resolve the payload itself and hand it to
 * Windows Script Host, which cannot run ESM and would fail bizarrely. `.mjs`
 * is absent from PATHEXT, so only the launchers are ever resolved.
 *
 * KNOWN LIMITATION, stated rather than papered over. On Windows the reachable
 * launcher is the `.cmd`, and since the CVE-2024-27980 fix Node will not
 * execute a `.cmd`/`.bat` unless the spawning code passes `shell: true`:
 *   [VERIFIED: executed 2026-08-13, node 24.16.0]
 *     spawnSync("<name>", args, {shell:false})           -> error ENOENT
 *     spawnSync("<abs>/<name>.cmd", args, {shell:false}) -> error EINVAL
 *     spawnSync("<name>", args, {shell:true})            -> status 0, ran
 * Test code that invokes a stub itself must therefore spawn with `shell: true`
 * on Windows (`runPi` in ./pi.ts already does). Code we do NOT control cannot
 * be made to: Pi calls `spawnSync("gh", [...])` with no shell
 * [VERIFIED: RESEARCH.md 6.3, interactive-mode.ts:5856-5866], so on Windows a
 * stub can only ever drive Pi down its FAILURE branch (status !== 0), never a
 * simulated success. Assert accordingly; do not write a Windows test that
 * depends on a stubbed `gh` succeeding inside Pi.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export interface StubSpec {
	/** Exit code the stub reports. Default 0. */
	exitCode?: number;
	/** Written verbatim to the stub's stdout. Default "". */
	stdout?: string;
	/**
	 * Absolute path of a file the stub appends one line to per invocation, in
	 * the form `<name> <argv joined by spaces>`.
	 *
	 * This is how call ORDER is proven -- e.g. that the `.npmrc` assertion runs
	 * before any `pi install`. The containing directory must already exist; the
	 * file need not.
	 */
	logTo?: string;
}

/** Windows env keys are case-insensitive; find the real one before writing. */
function pathKeyOf(env: Record<string, string>): string {
	for (const key of Object.keys(env)) {
		if (key.toUpperCase() === "PATH") {
			return key;
		}
	}
	return "PATH";
}

function currentEnv(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) {
			out[key] = value;
		}
	}
	return out;
}

function payloadSource(name: string, spec: StubSpec): string {
	const exitCode = spec.exitCode ?? 0;
	return [
		"// Generated stub -- see tests/helpers/stub-bin.ts. Lives in a temp dir.",
		'import { appendFileSync, writeSync } from "node:fs";',
		`const NAME = ${JSON.stringify(name)};`,
		`const LOG_TO = ${JSON.stringify(spec.logTo ?? null)};`,
		`const STDOUT = ${JSON.stringify(spec.stdout ?? "")};`,
		`const EXIT_CODE = ${JSON.stringify(exitCode)};`,
		"if (LOG_TO) {",
		"\tconst argv = process.argv.slice(2);",
		'\tappendFileSync(LOG_TO, [NAME, ...argv].join(" ") + "\\n");',
		"}",
		// writeSync, not console.log + process.exit: process.exit can truncate a
		// piped stdout mid-flush, which would make captured output flaky.
		"if (STDOUT) writeSync(1, STDOUT);",
		"process.exitCode = EXIT_CODE;",
		"",
	].join("\n");
}

/**
 * Create executable stubs on a temp PATH, run `fn` with the modified env, then
 * delete the temp directory.
 *
 * `fn` must be SYNCHRONOUS. The temp directory is removed in a `finally`, so an
 * async `fn` would still be running when its stubs vanish -- returning a
 * thenable is therefore rejected loudly rather than left to fail at random.
 */
export function withStubBin<T>(
	stubs: Record<string, StubSpec>,
	fn: (env: Record<string, string>) => T,
): T {
	const dir = mkdtempSync(join(tmpdir(), "kypi-stub-"));

	try {
		for (const [name, spec] of Object.entries(stubs)) {
			const payload = join(dir, `${name}.mjs`);
			writeFileSync(payload, payloadSource(name, spec), "utf-8");

			// POSIX launcher: extensionless, executable, exec's node so the stub
			// process replaces the shell and the exit code passes straight up.
			const posix = join(dir, name);
			writeFileSync(posix, `#!/bin/sh\nexec node "${payload.replace(/\\/g, "/")}" "$@"\n`, "utf-8");
			chmodSync(posix, 0o755);

			// Windows shim: CRLF, and an explicit exit /b so ERRORLEVEL survives.
			const cmd = join(dir, `${name}.cmd`);
			writeFileSync(
				cmd,
				`@echo off\r\nnode "%~dp0${name}.mjs" %*\r\nexit /b %ERRORLEVEL%\r\n`,
				"utf-8",
			);
		}

		const env = currentEnv();
		const key = pathKeyOf(env);
		env[key] = dir + delimiter + (env[key] ?? "");

		const result = fn(env);

		if (result !== null && typeof (result as { then?: unknown })?.then === "function") {
			throw new TypeError(
				"withStubBin: `fn` must be synchronous. It returned a thenable, but the stub " +
					"directory is deleted as soon as `fn` returns, so the stubs would disappear " +
					"mid-await. Use spawnSync-based calls inside `fn`.",
			);
		}

		return result;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Quote for cmd.exe concatenation; see the DEP0190 note in runWithStubBin. */
function quoteForWindows(arg: string): string {
	return /^[A-Za-z0-9_.:@/\\=-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`;
}

/**
 * Convenience: run one command through the stubbed PATH.
 *
 * Uses `shell: true` on Windows for the `.cmd` reason in the module docstring.
 * On that path the arguments are quoted and folded into the command string
 * rather than passed as an array -- an args array combined with `shell: true`
 * is concatenated unescaped, which is exactly what Node's DEP0190 warns about.
 */
export function runWithStubBin(
	stubs: Record<string, StubSpec>,
	command: string,
	args: string[] = [],
): { stdout: string; stderr: string; status: number | null } {
	const isWindows = process.platform === "win32";
	const file = isWindows ? [command, ...args.map(quoteForWindows)].join(" ") : command;
	const argv = isWindows ? [] : args;

	return withStubBin(stubs, (env) => {
		const result = spawnSync(file, argv, {
			env,
			encoding: "utf-8",
			shell: isWindows,
			timeout: 60_000,
			windowsHide: true,
		});
		return {
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? "",
			status: result.status,
		};
	});
}
