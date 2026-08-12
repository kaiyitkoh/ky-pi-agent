/**
 * Subprocess wrapper for the `pi` CLI.
 *
 * Every extension-loading claim in this phase (BOOT-02 package manifest path,
 * BOOT-05 project-local path) is a claim about Pi's discovery order. The only
 * trustworthy way to check it is to run the real binary and read a sentinel out
 * of a supported, exit-coded surface -- `pi --offline -a --list-models` -- and
 * never by parsing Pi's logs. [RESEARCH.md 2.3, "Don't Hand-Roll" row 4]
 *
 * Design decisions, each with its reason:
 *
 * - `requirePiOnPath()` THROWS, it never skips. A load-path test that skips
 *   itself when `pi` is missing is a vacuous pass: CI would go green having
 *   verified nothing, which is the exact failure mode BOOT-02/BOOT-05 exist to
 *   prevent. There is deliberately no skip escape hatch anywhere in this file,
 *   and an auditor grepping for one should find nothing.
 *
 * - `--offline` is merged in unless the caller already passed it. It disables
 *   all startup network operations (update checks, package update checks,
 *   telemetry) [CITED: pi 0.84.1 docs/settings.md:83], which makes runs
 *   deterministic and keeps the suite usable with no network.
 *
 * - `shell` is true ONLY on Windows, and only because it has to be. npm's
 *   global installer ships `pi`, `pi.cmd` and `pi.ps1`; on Windows the
 *   resolvable launcher is the `.cmd`, and since the CVE-2024-27980 fix Node
 *   refuses to execute `.cmd`/`.bat` without a shell:
 *     [VERIFIED: executed 2026-08-13, node 24.16.0]
 *       spawnSync("<name>", args, {shell:false})            -> error ENOENT
 *       spawnSync("<abs>/<name>.cmd", args, {shell:false})  -> error EINVAL
 *       spawnSync("<name>", args, {shell:true})             -> status 0, ran
 *   Because `shell:true` concatenates argv without escaping, arguments are
 *   quoted here and handed over as a single command string -- passing an args
 *   array alongside `shell:true` is what Node's DEP0190 warns about, and the
 *   warning is right. Callers must keep passing a real string[]; the quoting
 *   happens here, once, in one place.
 */
import { spawnSync } from "node:child_process";

const IS_WINDOWS = process.platform === "win32";

/** Cold jiti compile on first run makes Pi's startup slow; 5s is not enough. */
const DEFAULT_TIMEOUT_MS = 120_000;

export interface RunPiResult {
	stdout: string;
	stderr: string;
	/** null when the process was killed by a signal or never launched. */
	status: number | null;
}

export interface RunPiOptions {
	cwd?: string;
	env?: Record<string, string>;
	timeoutMs?: number;
}

/**
 * Wrap an argument for Windows `cmd.exe` concatenation.
 *
 * Only used on the Windows shell path. Anything that is not plainly safe gets
 * double-quoted; embedded double quotes are backslash-escaped, which is what
 * the MSVC-style parser inside the child expects.
 */
function quoteForWindows(arg: string): string {
	if (/^[A-Za-z0-9_.:@/\\=-]+$/.test(arg)) {
		return arg;
	}
	return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

/**
 * Build the `(file, args)` pair for `spawnSync`.
 *
 * On POSIX this is `("pi", args)` with no shell. On Windows the shell is
 * unavoidable (see the module docstring), so everything is quoted and folded
 * into the command string and the args array is left empty -- that is the shape
 * `shell:true` is actually safe in.
 */
function commandFor(args: string[]): [string, string[]] {
	if (!IS_WINDOWS) {
		return ["pi", args];
	}
	return [["pi", ...args.map(quoteForWindows)].join(" "), []];
}

/**
 * Assert the `pi` binary is reachable, and return its reported version.
 *
 * Throws -- deliberately, see the module docstring -- with the exact remedy
 * command when it is absent.
 */
export function requirePiOnPath(): string {
	const [file, argv] = commandFor(["--version"]);
	const result = spawnSync(file, argv, {
		encoding: "utf-8",
		shell: IS_WINDOWS,
		timeout: 60_000,
		windowsHide: true,
	});

	if (result.error || result.status !== 0) {
		const detail = result.error ? result.error.message : `exit ${result.status}`;
		throw new Error(
			[
				`The \`pi\` binary is not usable on PATH (${detail}).`,
				"",
				"This test verifies Pi's real extension-discovery behaviour and MUST NOT be",
				"skipped -- a skipped load-path test is a vacuous pass. Install Pi with:",
				"",
				"  npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.1",
				"",
				"(`--ignore-scripts` is not optional: it is the BOOT-01 control, and Pi",
				"installs itself the same way -- pi 0.84.1 src/config.ts:174.)",
			].join("\n"),
		);
	}

	return (result.stdout ?? "").trim();
}

/**
 * Run `pi` with the given arguments and capture the result.
 *
 * `--offline` is added unless the caller supplied it, so no invocation performs
 * a startup network call.
 */
export function runPi(args: string[], opts: RunPiOptions = {}): RunPiResult {
	const finalArgs = args.includes("--offline") ? [...args] : ["--offline", ...args];
	const [file, argv] = commandFor(finalArgs);

	const result = spawnSync(file, argv, {
		cwd: opts.cwd,
		env: opts.env ?? process.env,
		encoding: "utf-8",
		shell: IS_WINDOWS,
		timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		windowsHide: true,
	});

	if (result.error) {
		throw new Error(`failed to run \`pi ${finalArgs.join(" ")}\`: ${result.error.message}`);
	}

	return {
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		status: result.status,
	};
}
