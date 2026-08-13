/**
 * One Windows argument quoter, for the one Windows hazard.
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
 * Why it is one function and not four
 * ---------------------------------------------------------------------------
 * There were four hand-rolled copies of this: `tests/helpers/pi.ts`,
 * `tests/helpers/stub-bin.ts`, `tests/unit/npmrc-policy.test.ts` and an inline
 * expression in `tests/integration/load-paths.test.ts`. Two of them were wrong.
 *
 *   stub-bin.ts    `arg.replace(/"/g, '\\"')` with no trailing-backslash
 *                  handling, so `C:\some dir\` became `"C:\some dir\"` -- the
 *                  backslash escapes the closing quote and the argument runs on
 *                  into the next one.
 *   load-paths.ts  bare `"${a}"` with no escaping at all.
 *
 * Test-controlled inputs meant neither had bitten yet. Four implementations of
 * one documented hazard is three too many, and the two correct ones were only
 * correct by having been written more carefully on the day.
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
