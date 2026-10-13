/**
 * git options and forms that run a program or write a file, shared by the safety guard and plan mode.
 * Pure: no ctx, fs, child_process or default export.
 */

/** Long options that run their value as a program or write a file, whatever the subcommand; matched exactly or as `--opt=value`. */
export const GIT_PROGRAM_OR_FILE_OPTIONS: readonly string[] = ["--upload-pack", "--receive-pack", "--exec", "--output", "--ext-diff", "--extcmd"];

/** Per-subcommand short options that take a program; short options bundle (`git grep -iO<cmd>`), so clusters are exploded. */
const SHORT_PROGRAM_OPTIONS: ReadonlyMap<string, readonly string[]> = new Map([
	["grep", ["-O", "--open-files-in-pager"]],
	["rebase", ["-x"]],
	["clone", ["-u"]],
	["ls-remote", ["-u"]],
]);

/** Subcommands whose first operand makes them run an arbitrary command. */
const PROGRAM_RUNNING_OPERANDS: ReadonlyMap<string, string> = new Map([
	["submodule", "foreach"],
	["bisect", "run"],
]);

const explode = (arg: string): string[] =>
	!arg.startsWith("-") || arg.startsWith("--") || arg.length <= 2 ? [arg] : [arg, ...[...arg.slice(1)].map((c) => `-${c}`)];

const matchesOption = (arg: string, option: string): boolean => arg === option || (option.startsWith("--") && arg.startsWith(`${option}=`));

/** The option or form in `args` (the words after the subcommand) that runs a program or writes a file, or undefined. */
export function gitProgramOption(subcommand: string, args: readonly string[]): string | undefined {
	const long = GIT_PROGRAM_OR_FILE_OPTIONS.find((option) => args.some((arg) => matchesOption(arg, option)));
	if (long !== undefined) return long;
	const shorts = SHORT_PROGRAM_OPTIONS.get(subcommand) ?? [];
	const short = shorts.find((option) => args.some((arg) => explode(arg).some((part) => matchesOption(part, option))));
	if (short !== undefined) return short;
	const operand = PROGRAM_RUNNING_OPERANDS.get(subcommand);
	return operand !== undefined && args.find((arg) => !arg.startsWith("-")) === operand ? `${subcommand} ${operand}` : undefined;
}
