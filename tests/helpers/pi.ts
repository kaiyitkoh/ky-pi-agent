/**
 * Subprocess wrapper for the real `pi` CLI, the only trustworthy check of Pi's extension discovery order.
 * `requirePiOnPath()` throws rather than skips, so a missing binary is never a vacuous pass. `--offline` is merged in
 * so runs make no startup network calls. On Windows the launcher is a `.cmd`, which Node refuses to spawn without a
 * shell (CVE-2024-27980), so argv is quoted once here and folded into one command string.
 */
import { spawnSync } from "node:child_process";

import { quoteForWindows } from "./win-quote.ts";

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

/** The `(file, args)` pair for `spawnSync`: plain on POSIX, one quoted command string on Windows. */
function commandFor(args: string[]): [string, string[]] {
	if (!IS_WINDOWS) {
		return ["pi", args];
	}
	return [["pi", ...args.map(quoteForWindows)].join(" "), []];
}

/** Asserts `pi` is reachable and returns its version; throws with the install remedy when it is absent. */
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
				"  npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.1.0",
				"",
				"(`--ignore-scripts` is not optional: it is the BOOT-01 control, and Pi",
				"installs itself the same way -- pi 1.1.0 dist/config.js:99-132.)",
			].join("\n"),
		);
	}

	return (result.stdout ?? "").trim();
}

/** Runs `pi` with `args` (plus `--offline` unless given) and captures the result. */
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
