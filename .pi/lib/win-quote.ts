/**
 * One Windows argument quoter, for the one Windows hazard.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE LIVES OUTSIDE `.pi/extensions/`
 * ---------------------------------------------------------------------------
 * CR2-01 (`08-REVIEW.md` iteration 2): `quality/index.ts#productionExec`
 * originally called `spawnSync(bin, args, {shell: process.platform ===
 * "win32"})` -- `shell: true` alongside an args array is *unescaped
 * concatenation* into `cmd.exe`, which corrupts the command line the moment
 * `cwd` (and therefore `bin`, which embeds it) contains a space or a shell
 * metacharacter. This repository already had the correct, tested answer, but
 * it lived under `tests/helpers/`, and production code under
 * `.pi/extensions/` does not import from `tests/` (`calibration.ts`'s own
 * docstring states the same rule; `safety/git.ts:97` too). So the quoter
 * moved here, to `.pi/lib/`, exactly the way `jsonl.ts` moved here for
 * `safety`/`diagnostics` to share without crossing that same boundary.
 * `tests/helpers/win-quote.ts` now re-exports from this file rather than
 * holding a second copy -- one implementation, not two that can drift apart.
 *
 * ---------------------------------------------------------------------------
 * Why any of this exists
 * ---------------------------------------------------------------------------
 * `npm` and `pi` ship as `.cmd` shims on Windows, and since the CVE-2024-27980
 * fix Node refuses to execute a `.cmd` without a shell -- so `shell: true` is
 * unavoidable on that path. But `shell: true` alongside an args array is
 * *unescaped concatenation*, which is exactly what Node's DEP0190 deprecation
 * warns about: an argument containing a space, a quote or a shell metacharacter
 * is re-split or re-interpreted by `cmd.exe`. The safe shape is to quote every
 * argument here, fold them into a single command string, and pass an empty args
 * array.
 *
 * ---------------------------------------------------------------------------
 * The rules the escaping implements
 * ---------------------------------------------------------------------------
 * From the MSVC/CRT argv parser that `cmd.exe` hands off to:
 *
 *   * A backslash is literal UNLESS it precedes a double quote.
 *   * `2n` backslashes before a `"` produce `n` backslashes and the `"` is a
 *     delimiter; `2n+1` produce `n` backslashes and a literal `"`.
 *
 * So an embedded `"` needs its run of preceding backslashes doubled and itself
 * escaped, and a run of backslashes at the very end of the argument must be
 * doubled -- otherwise it would be sitting immediately before the closing
 * delimiter and would escape it.
 */

/** Characters that need no quoting at all: no space, quote or metacharacter. */
const PLAIN = /^[A-Za-z0-9_.:@/\\=-]+$/;

/**
 * Quote one argument for `cmd.exe` concatenation under `shell: true`.
 *
 * Plainly safe arguments are returned unchanged, which keeps command strings
 * readable in test failure output.
 */
export function quoteForWindows(arg: string): string {
	if (PLAIN.test(arg)) {
		return arg;
	}
	return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

/**
 * Build the `(file, args)` pair for `spawnSync`.
 *
 * On POSIX: `(cmd, args)` with no shell. On Windows: everything quoted and
 * folded into the command string, args array empty -- the only shape
 * `shell: true` is safe in.
 */
export function commandFor(
	cmd: string,
	args: string[],
	isWindows: boolean,
): [string, string[]] {
	if (!isWindows) {
		return [cmd, args];
	}
	return [[cmd, ...args].map(quoteForWindows).join(" "), []];
}
