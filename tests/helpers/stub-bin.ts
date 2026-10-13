/**
 * Fake executables first on a temp PATH, so tests of third-party behaviour (gh, npm, pi) never touch live machine state.
 * Each stub is `<name>.mjs` (not `.js`: `.JS` is in PATHEXT and Windows Script Host cannot run ESM), a POSIX launcher
 * and a `.cmd` shim. Node refuses a `.cmd` without `shell: true` (CVE-2024-27980), so code we do not control, like Pi's
 * own `spawnSync("gh")`, can only ever reach a stub's failure branch on Windows.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { quoteForWindows } from "./win-quote.ts";

/** One argv-conditional response: a multi-subcommand tool like npm cannot be modelled by one static stdout. */
export interface StubResponse {
	/** Tokens that must all appear in argv for this response to win; the first match wins, else the top-level fields. */
	when: string[];
	exitCode?: number;
	stdout?: string;
	stderr?: string;
}

export interface StubSpec {
	/** Exit code the stub reports. Default 0. */
	exitCode?: number;
	/** Written verbatim to the stub's stdout. Default "". */
	stdout?: string;
	/** Written verbatim to stderr. Default "". Real tools split output, e.g. npm's `--json` errors. */
	stderr?: string;
	/**
	 * File the stub appends `<name> <argv>` to per call, before choosing a response, so an ordering proof also sees calls
	 * that fell through to the default. Its directory must exist.
	 */
	logTo?: string;
	/** Argv-conditional responses, tried in order. */
	match?: StubResponse[];
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
		`const MATCH = ${JSON.stringify(spec.match ?? [])};`,
		"const argv = process.argv.slice(2);",
		"let stdout = " + JSON.stringify(spec.stdout ?? "") + ";",
		"let stderr = " + JSON.stringify(spec.stderr ?? "") + ";",
		`let code = ${JSON.stringify(exitCode)};`,
		"if (LOG_TO) {",
		'\tappendFileSync(LOG_TO, [NAME, ...argv].join(" ") + "\\n");',
		"}",
		"for (const m of MATCH) {",
		"\tif (m.when.every((t) => argv.includes(t))) {",
		'\t\tstdout = m.stdout ?? "";',
		'\t\tstderr = m.stderr ?? "";',
		"\t\tcode = m.exitCode ?? 0;",
		"\t\tbreak;",
		"\t}",
		"}",
		// writeSync, not console.log + process.exit: process.exit can truncate a
		// piped stdout mid-flush, which would make captured output flaky.
		"if (stdout) writeSync(1, stdout);",
		"if (stderr) writeSync(2, stderr);",
		"process.exitCode = code;",
		"",
	].join("\n");
}

/** Runs synchronous `fn` with stubs first on PATH, then deletes them; a thenable is rejected, since the stubs would vanish under it. */
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

/**
 * Runs one command through the stubbed PATH. On Windows it needs `shell: true` (the `.cmd` rule above), so the arguments
 * are quoted into the command string: an args array with `shell: true` is concatenated unescaped (DEP0190).
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
