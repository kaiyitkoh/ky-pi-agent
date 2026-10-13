/**
 * The one Windows argument quoter; `tests/helpers/win-quote.ts` re-exports it so tests and production share it.
 *
 * `npm` and `pi` are `.cmd` shims on Windows, and since CVE-2024-27980 Node runs a `.cmd` only with `shell: true`,
 * where an args array is unescaped concatenation (DEP0190). So every argument is quoted here and folded into one
 * command string. MSVC argv rules: backslashes are literal unless they precede `"`; `2n` of them before a `"` give
 * `n` and a delimiter, `2n+1` give `n` and a literal `"`. Hence the doubled runs before an embedded quote and at the end.
 */

/** Characters that need no quoting at all: no space, quote or metacharacter. */
const PLAIN = /^[A-Za-z0-9_.:@/\\=-]+$/;

/** Quote one argument for `cmd.exe` concatenation; plainly safe arguments are returned unchanged. */
export function quoteForWindows(arg: string): string {
	if (PLAIN.test(arg)) return arg;
	return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

/** The `(file, args)` pair for `spawnSync`: unchanged on POSIX, one quoted command string with no args on Windows. */
export function commandFor(cmd: string, args: string[], isWindows: boolean): [string, string[]] {
	return isWindows ? [[cmd, ...args].map(quoteForWindows).join(" "), []] : [cmd, args];
}
