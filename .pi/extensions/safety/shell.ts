/**
 * bash parsing for policy: a fail-closed node-type deny predicate, then resolution of tabulated wrappers
 * (`env`, `sudo`, `npx`, ...) to the executable that really runs; a wrapper it cannot resolve fails closed.
 * Parser quirks and the rules' rationale: docs/SAFETY.md "Implementation invariants".
 * Pure: no ctx, fs, child_process or default export (a default export would make it an extension entry point).
 */
import { posix } from "node:path";
import { parse } from "unbash";
import type { Command, ParsedScript, Redirect, Word } from "unbash";

const wordSet = (words: string): Set<string> => new Set(words.split(" ").filter((w) => w !== ""));

/** Runtime `.type` strings unbash emits; iteration order is the refusal-cause priority. */
export const DENIED_PART_TYPES = new Set(["CommandExpansion", "ProcessSubstitution", "ArithmeticCommandExpansion"]);

/** Redirect operators that write a heredoc/herestring body — refuse all three. */
export const HEREDOC_OPERATORS = new Set(["<<", "<<-", "<<<"]);

// Word-part types that mark an UNRESOLVED shell expansion.
const EXPANSION_PART_TYPES = ["SimpleExpansion", "ParameterExpansion"];

/** Guarded executables, word-bounded; a word followed by a path separator is a directory (`openspec/changes`), not a verb. */
export const GUARDED_VERB_PATTERN = /\b(git|glab|terraform|aws|kubectl|openspec)\b(?![/\\])/i;

/**
 * Executables that run a command string or script argument; denied when the segment names a guarded verb.
 * `eval` closes only the literal case (`eval "$CMD"` is a published gap); `watch` joins its operands into `sh -c`;
 * the Windows interpreters' strings are unparseable here; su/ssh/chroot/... run where this guard cannot see.
 */
export const SHELL_RUNNERS = wordSet(
	"sh bash zsh dash fish xargs python python3 node perl ruby eval watch ksh mksh ash csh tcsh " +
		"cmd powershell pwsh su script parallel ssh chroot strace flock " +
		"trap source . hash alias unalias enable fc bind complete coproc",
);

// Builtins whose arguments are command text or bind a name to one, so a guarded verb anywhere in the script taints them.
const COMMAND_TEXT_BUILTINS = wordSet("trap alias hash enable fc source .");

// Runners whose first argument is command text rather than a script file.
const COMMAND_TEXT_RUNNERS = wordSet("trap alias unalias hash enable fc bind complete coproc");

// `find`/`fd` primaries that run a command, which makes them runners like `xargs`.
const FIND_EXEC_PRIMARIES = new Map([
	["find", wordSet("-exec -execdir -ok -okdir")],
	["fd", wordSet("-x --exec -X --exec-batch")],
]);

/** Every cause {@link canonicalise} can return. */
export const SHELL_REFUSAL_CAUSES = [
	"command-substitution",
	"process-substitution",
	"arithmetic-expansion",
	"heredoc",
	"background",
	"unresolved-expansion-in-command-position",
	"non-literal-command-name",
	"shell-runner",
	"generated-script",
	"command-string-program",
	"inline-code-effect",
	"unresolved-wrapper",
	"parse-error",
] as const;

export type ShellRefusalCause = (typeof SHELL_REFUSAL_CAUSES)[number];

const CAUSE_BY_DENIED_TYPE: Record<string, ShellRefusalCause> = {
	CommandExpansion: "command-substitution",
	ProcessSubstitution: "process-substitution",
	ArithmeticCommandExpansion: "arithmetic-expansion",
};

// One wrapper's option grammar; a word outside it makes resolution unconfident. A wrong arity silently mis-resolves.
interface WrapperGrammar {
	readonly boolean?: ReadonlySet<string>;
	/** Options taking a value, as the next word, `--long=value`, or packed short `-o0`. */
	readonly value?: ReadonlySet<string>;
	/** Options whose value is itself a command string, so no separable executable follows. */
	readonly shellString?: ReadonlySet<string>;
	/** Positional words before the command (`timeout DURATION`). */
	readonly operands?: number;
	/** Accepts `NAME=value` words before the command. */
	readonly assignments?: boolean;
	/** Accepts a bare numeric option (`nice -5`). */
	readonly numericOption?: boolean;
	/** Options that make the wrapper look its operand up instead of running it (`command -v`). */
	readonly query?: ReadonlySet<string>;
}

// npx/bunx/pnpm dlx and kin: `-p` names the package, `-c` takes a shell string instead of a binary.
const PACKAGE_RUNNER_GRAMMAR: WrapperGrammar = {
	boolean: wordSet("-y --yes --no --no-install --ignore-existing -q --quiet --silent --prefer-offline --prefer-online --offline --bun"),
	value: wordSet("-p --package -w --workspace --registry"),
	shellString: wordSet("-c --call --shell-mode"),
};

const WRAPPER_GRAMMARS = new Map<string, WrapperGrammar>([
	[
		"env",
		{
			boolean: wordSet("-i --ignore-environment -0 --null -v --verbose --debug"),
			value: wordSet("-u --unset -C --chdir"),
			shellString: wordSet("-S --split-string"),
			assignments: true,
		},
	],
	[
		"sudo",
		{
			boolean: wordSet("-i --login -n --non-interactive -S --stdin -E --preserve-env -H --set-home -b --background -k --reset-timestamp -v --validate -A --askpass -s --shell"),
			value: wordSet("-u --user -g --group -p --prompt -h --host -C --close-from -D --chdir -R --chroot -T --command-timeout -U --other-user"),
			assignments: true,
		},
	],
	["doas", { boolean: wordSet("-n -s"), value: wordSet("-u -C") }],
	["exec", { boolean: wordSet("-c -l"), value: wordSet("-a") }],
	["timeout", { boolean: wordSet("--preserve-status --foreground -v --verbose"), value: wordSet("-s --signal -k --kill-after"), operands: 1 }],
	["nice", { value: wordSet("-n --adjustment"), numericOption: true }],
	["ionice", { boolean: wordSet("-t --ignore"), value: wordSet("-c --class -n --classdata") }],
	["nohup", {}],
	["chronic", { boolean: wordSet("-e -v") }],
	["setsid", { boolean: wordSet("-c --ctty -f --fork -w --wait") }],
	["time", { boolean: wordSet("-p --portability -v --verbose -a --append -q --quiet"), value: wordSet("-f --format -o --output") }],
	["stdbuf", { value: wordSet("-i --input -o --output -e --error") }],
	["unbuffer", { boolean: wordSet("-p") }],
	["command", { boolean: wordSet("-p"), query: wordSet("-v -V") }],
	["builtin", {}],
	["toybox", {}],
	["busybox", {}],
	["winpty", {}],
	["npx", PACKAGE_RUNNER_GRAMMAR],
	["pnpx", PACKAGE_RUNNER_GRAMMAR],
	["bunx", PACKAGE_RUNNER_GRAMMAR],
]);

// Package managers whose named subcommand runs a package binary (`npm exec openspec` resolves like `npx openspec`), with the global options accepted before it.
const PACKAGE_MANAGER_RUNNERS = new Map<string, { readonly runners: ReadonlySet<string>; readonly globals: WrapperGrammar }>([
	[
		"npm",
		{
			runners: wordSet("exec x"),
			globals: { boolean: wordSet("-y --yes -s --silent -q --quiet -ws --workspaces --offline --prefer-offline"), value: wordSet("--prefix -w --workspace") },
		},
	],
	[
		"pnpm",
		{
			runners: wordSet("dlx exec"),
			globals: { boolean: wordSet("-w --workspace-root -r --recursive -s --silent"), value: wordSet("-C --dir -F --filter") },
		},
	],
	["yarn", { runners: wordSet("dlx exec"), globals: { boolean: wordSet("-s --silent"), value: wordSet("--cwd") } }],
	["bun", { runners: wordSet("x"), globals: { boolean: wordSet("--silent"), value: wordSet("--cwd") } }],
]);

/** Every wrapper name that fetches or runs a package binary, as recorded in {@link CanonicalInvocation.wrappers}. */
export const PACKAGE_RUNNER_WRAPPERS: ReadonlySet<string> = new Set([
	...[...WRAPPER_GRAMMARS].filter(([, grammar]) => grammar === PACKAGE_RUNNER_GRAMMAR).map(([name]) => name),
	...[...PACKAGE_MANAGER_RUNNERS].flatMap(([manager, { runners }]) => [...runners].map((sub) => `${manager} ${sub}`)),
]);

const ASSIGNMENT_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** One command's canonical form after wrapper resolution — what policy evaluates. */
export interface CanonicalInvocation {
	/** The real executable, with every wrapper resolved away. */
	readonly executable: string;
	/** Arguments after the resolved executable, quote-resolved (`Word.value`), not raw text. */
	readonly args: readonly string[];
	/** Wrapper names encountered, in order (e.g. `["sudo"]`, `["npm exec"]`). */
	readonly wrappers: readonly string[];
	/** The raw source slice for this one command segment. */
	readonly rawSegment: string;
	/** Earlier `cd` targets, then `env -C`/`sudo -D`, then `git -C`/`--git-dir`, folded as git and env apply them. */
	readonly cwdOverride?: string;
	/** The same directories unfolded, in order; `~` forms are kept for the caller, which knows home, to expand. */
	readonly cwdChain?: readonly string[];
	/** Set when a `cd`/`pushd`/`popd` ran earlier in the script; `"unknown"` when its target is not a literal directory. */
	readonly afterCd?: "known" | "unknown";
	/** Set when `NAME=value` words prefix the command, which can change git's config or repository for this run only. */
	readonly assignments?: true;
	/** Every `NAME=value` word before the command, from the statement prefix and from wrapper assignments (`env NAME=value`). */
	readonly assignmentWords?: readonly string[];
	/** Files this command's own redirects read and write. */
	readonly redirectReads?: readonly string[];
	readonly redirectWrites?: readonly string[];
}

export type ShellVerdict =
	| { readonly kind: "refused"; readonly cause: ShellRefusalCause; readonly detail: string }
	| {
			readonly kind: "ok";
			readonly invocations: readonly CanonicalInvocation[];
			/** Every distinct `Redirect.operator` in walk order, so callers need no second AST walk. */
			readonly redirectOperators: readonly string[];
			/** Input-redirect targets on compound statements (`{ ...; } < f`); a simple command's own are on its invocation. */
			readonly redirectReadTargets: readonly string[];
			/** Output-redirect targets on compound statements; a simple command's own are on its invocation. */
			readonly redirectWriteTargets: readonly string[];
			/** Every `Command` node, including assignment-only statements (`HOME=x`) that yield no invocation. */
			readonly commandCount: number;
			/** `NAME=value` words of assignment-only statements (`GIT_DIR=x;`), which change an already exported variable. */
			readonly scriptAssignments: readonly string[];
	  };

/** Basename, lower-cased, Windows extension stripped; every bare-verb gate must use it or `git.exe push` classifies as allow. */
export function normaliseExecutable(executable: string): string {
	const base = executable.replace(/\\/g, "/").split("/").pop() ?? executable;
	return base.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, "");
}

// Depth-first visit of every object node; Word's `value`/`parts` are lazy getters absent from Object.keys(), so they are forced.
function walk(node: unknown, visit: (obj: Record<string, unknown>) => void): void {
	if (node === null || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const item of node) walk(item, visit);
		return;
	}
	const obj = node as Record<string, unknown>;
	visit(obj);
	const keys = new Set(Object.keys(obj));
	for (const lazy of ["value", "parts"]) if (lazy in obj) keys.add(lazy);
	for (const key of keys) if (key !== "pos" && key !== "end") walk(obj[key], visit);
}

interface ScriptScan {
	readonly types: Set<string>;
	readonly redirects: Set<string>;
	readonly readTargets: string[];
	readonly writeTargets: string[];
	readonly compoundReads: string[];
	readonly compoundWrites: string[];
	readonly commands: Command[];
	/** Commands whose stdin is a pipe from an earlier pipeline element. */
	readonly piped: Set<Command>;
	background: boolean;
}

const WRITE_REDIRECTS = new Set([">", ">>", ">|", "&>", "&>>", "<>"]);
const DESCRIPTOR = /^(\d+-?|-)$/;

// Files a redirect list reads and writes; `<>` does both, and a `<&`/`>&` onto a descriptor touches no file.
function redirectFiles(redirects: readonly Redirect[]): { readonly reads: string[]; readonly writes: string[] } {
	const reads: string[] = [];
	const writes: string[] = [];
	for (const r of redirects) {
		const target = r.target?.value;
		if (target === undefined) continue;
		if (r.operator === "<" || r.operator === "<>" || (r.operator === "<&" && !DESCRIPTOR.test(target))) reads.push(target);
		if (WRITE_REDIRECTS.has(r.operator) || (r.operator === ">&" && !DESCRIPTOR.test(target))) writes.push(target);
	}
	return { reads, writes };
}

function scanScript(script: ParsedScript): ScriptScan {
	const scan: ScriptScan = {
		...{ types: new Set(), redirects: new Set(), commands: [], piped: new Set(), background: false },
		...{ readTargets: [], writeTargets: [], compoundReads: [], compoundWrites: [] },
	};
	walk(script, (node) => {
		if (typeof node.type === "string") scan.types.add(node.type);
		if (node.type === "Statement" && node.background === true) scan.background = true;
		if (node.type === "Command") scan.commands.push(node as unknown as Command);
		if (node.type === "Pipeline") {
			for (const stage of (node.commands as unknown[]).slice(1)) walk(stage, (n) => n.type === "Command" && scan.piped.add(n as unknown as Command));
		}
		if (!Array.isArray(node.redirects)) return;
		const redirects = (node.redirects as Redirect[]).filter((r) => typeof r.operator === "string");
		for (const r of redirects) scan.redirects.add(r.operator);
		const { reads, writes } = redirectFiles(redirects);
		scan.readTargets.push(...reads);
		scan.writeTargets.push(...writes);
		if (node.type !== "Command") {
			scan.compoundReads.push(...reads);
			scan.compoundWrites.push(...writes);
		}
	});
	return scan;
}

function hasExpansionPart(word: Word | undefined): boolean {
	let found = false;
	walk(word, (node) => {
		found ||= EXPANSION_PART_TYPES.includes(node.type as string);
	});
	return found;
}

const NON_LITERAL_NAME_CHARS = /[*?[\]{}~]/;

const isQuotedPart = (part: { readonly type: string; readonly parts?: readonly { readonly type: string }[] }): boolean =>
	part.type === "Literal" ||
	part.type === "SingleQuoted" ||
	part.type === "AnsiCQuoted" ||
	(part.type === "DoubleQuoted" && (part.parts ?? []).every((child) => child.type === "Literal"));

// Allow-list over the word-part union, so a part type added later is refused until it is listed.
function isPlainCommandWord(word: Word | undefined): boolean {
	if (word === undefined) return true;
	if (word.text === "[" || word.text === "[[") return true;
	if (/\s/.test(word.value)) return false;
	const singleQuoted = word.parts?.length === 1 && word.parts[0].type === "SingleQuoted";
	// A leading `~/` is the home directory, not a pattern, so `~/bin/x` runs a literal path.
	if (!singleQuoted && NON_LITERAL_NAME_CHARS.test(word.text.replace(/^~\//, ""))) return false;
	return (word.parts ?? []).every((part) => isQuotedPart(part));
}

const hasBraceOrGlobPart = (word: Word): boolean => (word.parts ?? []).some((part) => part.type === "BraceExpansion" || part.type === "ExtendedGlob");

function hasNonLiteralCommandWord(commands: readonly Command[]): boolean {
	return commands.some((c) => {
		if (c.name === undefined) return false;
		if (!isPlainCommandWord(c.name)) return true;
		return isLiteralGuardedExecutable(c.name) && c.suffix.some(hasBraceOrGlobPart);
	});
}

function isLiteralGuardedExecutable(word: Word | undefined): boolean {
	return word !== undefined && !hasExpansionPart(word) && GUARDED_VERB_PATTERN.test(word.value);
}

// Expansion in `Command.name` always, and in a literally guarded verb's suffix (`g=push; git $g`); `echo "$HOME"` stays allowed.
function hasUnresolvedExpansionInCommandPosition(commands: readonly Command[]): boolean {
	return commands.some((c) => hasExpansionPart(c.name) || (isLiteralGuardedExecutable(c.name) && c.suffix.some((w) => hasExpansionPart(w))));
}

// Denial is by PRESENCE of node types: unbash parses `sh -c "git push"` and heredocs without errors, so errors are only the last catch-all.
function detectRefusalCause(script: ParsedScript, scan: ScriptScan): ShellRefusalCause | undefined {
	const denied = [...DENIED_PART_TYPES].find((t) => scan.types.has(t));
	if (denied !== undefined) return CAUSE_BY_DENIED_TYPE[denied];
	if ([...HEREDOC_OPERATORS].some((op) => scan.redirects.has(op))) return "heredoc";
	if (scan.background) return "background";
	if (hasUnresolvedExpansionInCommandPosition(scan.commands)) return "unresolved-expansion-in-command-position";
	if (hasNonLiteralCommandWord(scan.commands)) return "non-literal-command-name";
	return (script.errors ?? []).length > 0 ? "parse-error" : undefined;
}

const CAUSE_DETAIL: Record<ShellRefusalCause, (command: string) => string> = {
	"command-substitution": (c) => `command substitution ($(...) or a backtick form) in "${c}" hides an arbitrary command from policy`,
	"process-substitution": (c) => `process substitution (<(...) or >(...)) in "${c}" hides an arbitrary command from policy`,
	"arithmetic-expansion": (c) =>
		`a command substitution nested inside an arithmetic expansion in "${c}" hides an arbitrary command from policy`,
	heredoc: (c) => `a heredoc/herestring redirect in "${c}" can smuggle an arbitrary script past a text-only check`,
	background: (c) => `"${c}" backgrounds the command (&), which this guard cannot observe complete before returning`,
	"unresolved-expansion-in-command-position": (c) =>
		`"${c}" resolves its executable or a guarded verb's subcommand from an unresolved shell variable`,
	"non-literal-command-name": (c) =>
		`"${c}" names a command through a brace expansion, glob, tilde or embedded whitespace; spell the command literally`,
	"shell-runner": (c) =>
		`"${c}" hands a guarded verb or an encoded script to a shell runner (${[...SHELL_RUNNERS].join(", ")}, find -exec) as a script argument`,
	"generated-script": (c) =>
		`"${c}" gives a code runner its input through a pipe or a stdin alias (whatever its arguments), feeds input words to one through xargs or parallel, sets an interpreter startup variable, reads an awk or sed program from stdin, or runs or imports a file the same command writes, so the guard never sees the code; pass input as a file argument or through jq, and write a script in one command and run it in another`,
	"command-string-program": (c) =>
		`"${c}" runs a program that takes a command string from its own arguments (awk system() or a pipe, sed e or w /dev/, tar --to-command or -I, rsync -e, bat --pager, make --eval or -f -, sort --compress-program) or an interactive pager or editor`,
	"inline-code-effect": (c) =>
		`"${c}" runs interpreter one-liner code that opens files, writes them or starts processes, which the guard cannot classify; read files with cat or jq and run programs directly`,
	"unresolved-wrapper": (c) =>
		`"${c}" puts a guarded verb, a code runner or piped input behind a wrapper word this guard cannot resolve, or runs a wrapper under xargs, find -exec or parallel, whose command then comes from the input`,
	"parse-error": (c) => `"${c}" did not parse cleanly; this catch-all denies rather than falls through to allow`,
};

const refused = (cause: ShellRefusalCause, command: string): ShellVerdict => ({ kind: "refused", cause, detail: CAUSE_DETAIL[cause](command) });

interface ConsumedOptions {
	readonly index: number;
	readonly confident: boolean;
	readonly query?: true;
}

// Consume one wrapper's options and operands from `start`; `onValue` sees each value option.
function consumeWrapperOptions(
	values: readonly string[],
	start: number,
	grammar: WrapperGrammar,
	onValue: (option: string, value: string) => void,
): ConsumedOptions {
	const has = (set: ReadonlySet<string> | undefined, word: string): boolean => set?.has(word) === true;
	let i = start;
	for (; i < values.length; i += 1) {
		const word = values[i];
		if (word === "--") {
			i += 1;
			break;
		}
		if (grammar.assignments === true && ASSIGNMENT_WORD.test(word)) continue;
		if (!word.startsWith("-") || word === "-") break;
		const eq = word.indexOf("=");
		const longName = word.startsWith("--") && eq > 0 ? word.slice(0, eq) : word;
		const shortName = word.startsWith("--") ? word : word.slice(0, 2);
		if (has(grammar.shellString, longName) || has(grammar.shellString, shortName)) return { index: i, confident: false };
		if (has(grammar.query, word)) return { index: i, confident: true, query: true };
		if (has(grammar.boolean, word)) continue;
		if (has(grammar.value, word)) {
			if (i + 1 >= values.length) return { index: values.length, confident: false };
			onValue(word, values[i + 1]);
			i += 1;
		} else if (longName !== word && has(grammar.value, longName)) {
			onValue(longName, word.slice(eq + 1));
		} else if (shortName !== word && has(grammar.value, shortName)) {
			onValue(shortName, word.slice(2));
		} else if (grammar.numericOption !== true || !/^-\d+$/.test(word)) {
			return { index: i, confident: false };
		}
	}
	const operands = grammar.operands ?? 0;
	return i + operands > values.length ? { index: values.length, confident: false } : { index: i + operands, confident: true };
}

// Find `exec`/`dlx`/`x` past a package manager's global options (`npm --yes exec`, `pnpm -C . dlx`).
function locatePackageManagerRunner(
	values: readonly string[],
	start: number,
	verb: string,
): { readonly subcommandIndex: number; readonly confident: boolean; readonly stopIndex: number } | undefined {
	const manager = PACKAGE_MANAGER_RUNNERS.get(verb);
	if (manager === undefined) return undefined;
	const consumed = consumeWrapperOptions(values, start + 1, manager.globals, () => {});
	if (consumed.confident) {
		return manager.runners.has(values[consumed.index] ?? "")
			? { subcommandIndex: consumed.index, confident: true, stopIndex: consumed.index }
			: undefined;
	}
	// An unknown global option may or may not take a value, so any later runner subcommand fails closed.
	const offset = values.slice(consumed.index).findIndex((word) => manager.runners.has(word));
	return offset === -1 ? undefined : { subcommandIndex: consumed.index + offset, confident: false, stopIndex: consumed.index };
}

// Consume recognised wrappers; `values[index]` is the real executable, and `confident` is false when a word fell outside a grammar.
function resolveWrappers(values: readonly string[]): { wrappers: string[]; dirs: string[]; index: number; confident: boolean } {
	const wrappers: string[] = [];
	const dirs: string[] = [];
	let i = 0;
	let confident = true;
	while (i < values.length) {
		const verb = normaliseExecutable(values[i]);
		const runner = locatePackageManagerRunner(values, i, verb);
		const grammar = runner !== undefined ? PACKAGE_RUNNER_GRAMMAR : WRAPPER_GRAMMARS.get(verb);
		if (grammar === undefined) break;
		wrappers.push(runner !== undefined ? `${verb} ${values[runner.subcommandIndex]}` : verb);
		if (runner !== undefined && !runner.confident) {
			i = runner.stopIndex;
			confident = false;
			break;
		}
		const consumed = consumeWrapperOptions(values, runner !== undefined ? runner.subcommandIndex + 1 : i + 1, grammar, (option, value) => {
			if ((verb === "env" && option === "-C") || (verb === "sudo" && option === "-D") || option === "--chdir") dirs.push(value);
		});
		if (consumed.query === true) {
			// The wrapper itself is what runs, and it runs nothing.
			wrappers.pop();
			break;
		}
		i = consumed.index;
		if (!consumed.confident) {
			confident = false;
			break;
		}
	}
	// A wrapper that left an option or assignment in command position has not reached the real executable.
	const next = values[i];
	if (wrappers.length > 0 && next !== undefined && (next.startsWith("-") || ASSIGNMENT_WORD.test(next))) confident = false;
	return { wrappers, dirs, index: i, confident };
}

/** git global options that take a value as the next word. */
export const GIT_GLOBAL_VALUE_OPTIONS = wordSet("-C -c --config-env --git-dir --work-tree --namespace");

// Every `-C`/`--git-dir` before the subcommand, in order; `git commit -C <commit>` names a commit, not a directory.
function gitDirectories(executable: string, args: readonly string[]): string[] {
	const dirs: string[] = [];
	for (let i = 0; normaliseExecutable(executable) === "git" && i < args.length && args[i].startsWith("-"); i += 1) {
		if ((args[i] === "-C" || args[i] === "--git-dir") && i + 1 < args.length) dirs.push(args[i + 1]);
		if (args[i].startsWith("--git-dir=")) dirs.push(args[i].slice("--git-dir=".length));
		if (GIT_GLOBAL_VALUE_OPTIONS.has(args[i])) i += 1;
	}
	return dirs;
}

/** Each directory is relative to the one before, as git applies repeated `-C`; an absolute one starts over. */
export const foldDirectories = (dirs: readonly string[]): string | undefined =>
	dirs.reduce<string | undefined>((acc, dir) => (acc === undefined || /^([A-Za-z]:)?[\\/]/.test(dir) ? dir : posix.join(acc, dir)), undefined);

const CD_COMMANDS = wordSet("cd pushd popd");

// Any expansion among wrapper words is refused too: word splitting can turn `timeout $T apply` into `timeout 5 terraform apply`.
function hasExpansionBehindWrappers(words: readonly Word[], index: number): boolean {
	if (index === 0) return false;
	if (words.slice(0, index + 1).some((w) => hasExpansionPart(w) || !isPlainCommandWord(w))) return true;
	return isLiteralGuardedExecutable(words[index]) && words.slice(index + 1).some((w) => hasExpansionPart(w));
}

interface ExtractedInvocation {
	readonly invocation: CanonicalInvocation;
	readonly confident: boolean;
	readonly expansionInCommandPosition: boolean;
	readonly node: Command;
}

function redirectFields(node: Command): Pick<CanonicalInvocation, "redirectReads" | "redirectWrites"> {
	const { reads, writes } = redirectFiles(node.redirects);
	return { ...(reads.length > 0 ? { redirectReads: reads } : {}), ...(writes.length > 0 ? { redirectWrites: writes } : {}) };
}

function extractInvocations(script: ParsedScript, command: string, commands: readonly Command[]): ExtractedInvocation[] {
	// Backtick-decoded scripts index the decoded `ParsedScript.source`, not the caller's string.
	const sourceText = script.source ?? command;
	let cd: { readonly dirs: readonly string[]; readonly known: boolean } | undefined;
	const cdpath = /\bCDPATH\b/.test(sourceText);
	// An assignment-only statement (`g=push`) has no name and executes nothing.
	return commands.flatMap((node) => {
		if (node.name === undefined) return [];
		const words = [node.name, ...node.suffix];
		const values = words.map((w) => w.value);
		const resolved = resolveWrappers(values);
		const word = values[resolved.index] ?? "";
		// A package spec's `@version` is not part of the binary name; a local `./ls@x` script keeps it.
		const viaPackageRunner = resolved.wrappers.some((w) => PACKAGE_RUNNER_WRAPPERS.has(w));
		const executable = viaPackageRunner ? word.replace(/(.)@[^@/]*$/, "$1") : word;
		const args = values.slice(resolved.index + 1);
		const cwdChain = [...(cd?.dirs ?? []), ...resolved.dirs, ...gitDirectories(executable, args)];
		const cwdOverride = foldDirectories(cwdChain);
		const rawSegment = sourceText.slice(node.pos, node.end);
		const assignmentWords = [...node.prefix.map((a) => a.text), ...values.slice(0, resolved.index).filter((w) => ASSIGNMENT_WORD.test(w))];
		const afterCd = cd === undefined ? {} : { afterCd: cd.known ? ("known" as const) : ("unknown" as const) };
		const cdName = normaliseExecutable(executable);
		if (CD_COMMANDS.has(cdName)) {
			// `popd`, `pushd` with no target or `+N`/`-N` (stack rotation), `cd -`, `cd ~user` and `cd "$D"` leave the directory unknowable here.
			const stackMove = cdName === "popd" || (cdName === "pushd" && (args.length === 0 || /^[+-]\d+$/.test(args[0])));
			// `$HOME` is the one expansion a cd target may carry: the path classifier expands it like `~`.
			const homeOnly = /^\$(HOME|\{HOME\})([/\\][^$`]*)?$/.test(args[0] ?? "");
			const unreadable = args.length !== 1 || (hasExpansionPart(words[resolved.index + 1]) && !homeOnly);
			const target = stackMove ? "-" : args.length === 0 ? "~" : unreadable ? "-" : args[0];
			// bash resolves a relative target that does not start with `.` or `..` through CDPATH first.
			const viaCdpath = cdpath && !/^([/\\~$]|\.\.?([/\\]|$)|[A-Za-z]:)/.test(target);
			const literal = !viaCdpath && !target.startsWith("-") && (!target.startsWith("~") || /^~([/\\]|$)/.test(target));
			cd = { dirs: [...(cd?.dirs ?? []), ...(literal ? [target] : [])], known: (cd?.known ?? true) && literal };
		}
		return [
			{
				invocation: {
					executable,
					args,
					wrappers: resolved.wrappers,
					rawSegment,
					...(cwdOverride !== undefined ? { cwdOverride, cwdChain } : {}),
					...afterCd,
					...(node.prefix.length > 0 ? { assignments: true as const } : {}),
					...(assignmentWords.length > 0 ? { assignmentWords } : {}),
					...redirectFields(node),
				},
				confident: resolved.confident,
				expansionInCommandPosition: hasExpansionBehindWrappers(words, resolved.index),
				node,
			},
		];
	});
}

// Each removal only adds matches: quotes, backslashes, cmd `^`, PowerShell backtick and expansions an unset variable empties (`g${u}it`).
const VERB_NORMALISERS = [/['"]/g, /['"\\]/g, /['"\\^`]|\$(\{[^}]*\}|[@*#?!$0-9]|[A-Za-z_]\w*)/g];

// Tested as-is too, so a backslash path separator (`C:\Git\cmd\git.exe`) still bounds the verb.
const variantsOf = (text: string): string[] => [text, ...VERB_NORMALISERS.map((re) => text.replace(re, ""))];

const mentionsGuardedVerb = (texts: readonly string[]): boolean =>
	texts.some((text) => variantsOf(text).some((variant) => GUARDED_VERB_PATTERN.test(variant)));

const segmentTexts = (inv: CanonicalInvocation): string[] => [inv.rawSegment, inv.executable, ...inv.args];

// `find -exec` runs only the words after its primary; an interpreter's script file is opaque unless its name
// starts with a guarded verb (`openspec.js`, `openspec-setup.sh`, not `gen-openspec.mjs`).
function runnerTexts(inv: CanonicalInvocation): string[] | undefined {
	const executable = normaliseExecutable(inv.executable);
	const execPrimaries = FIND_EXEC_PRIMARIES.get(executable);
	if (execPrimaries !== undefined) {
		const at = inv.args.findIndex((arg) => execPrimaries.has(arg));
		return at === -1 ? undefined : inv.args.slice(at + 1);
	}
	if (!SHELL_RUNNERS.has(executable)) return undefined;
	if (COMMAND_TEXT_RUNNERS.has(executable)) return segmentTexts(inv);
	const script = inv.args[0] ?? "-";
	const namedForVerb = variantsOf(normaliseExecutable(script)).some((v) => v.search(GUARDED_VERB_PATTERN) === 0);
	return script.startsWith("-") || namedForVerb ? segmentTexts(inv) : [inv.rawSegment.replace(script, " "), ...inv.args.slice(1)];
}

// PowerShell's `-EncodedCommand` and every prefix it accepts (`-e`, `-enc`, `-ec`); `-ExecutionPolicy` does not match.
const ENCODED_COMMAND_OPTION = /^[-/](ec|e(n(c(o(d(e(d(c(o(m(m(a(n(d)?)?)?)?)?)?)?)?)?)?)?)?)?)$/i;

// A base64 script hides any verb, so it is refused whatever it contains.
function hidesItsScript(inv: CanonicalInvocation): boolean {
	const executable = normaliseExecutable(inv.executable);
	return (executable === "powershell" || executable === "pwsh") && inv.args.some((arg) => ENCODED_COMMAND_OPTION.test(arg));
}

// Denied outright, never routed to approval, by a word match rather than a recursive re-parse.
const findShellRunnerDenial = (invocations: readonly CanonicalInvocation[]): CanonicalInvocation | undefined =>
	invocations.find((inv) => {
		const texts = runnerTexts(inv);
		return texts !== undefined && (mentionsGuardedVerb(texts) || hidesItsScript(inv));
	});

// A trap, alias, hash or sourced file can carry a verb into a later segment, so any guarded verb in the script taints them.
const carriesVerbAcrossSegments = (invocations: readonly CanonicalInvocation[]): boolean =>
	invocations.some((inv) => COMMAND_TEXT_BUILTINS.has(normaliseExecutable(inv.executable))) &&
	mentionsGuardedVerb(invocations.flatMap(segmentTexts));

// Per-command options that take a value, so the value is not mistaken for a file operand.
const WRITE_VALUE_OPTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	["cp", wordSet("-S --suffix")],
	["mv", wordSet("-S --suffix")],
	["install", wordSet("-m --mode -o --owner -g --group -S --suffix")],
	["truncate", wordSet("-s --size -r --reference")],
	["touch", wordSet("-d --date -t -r --reference")],
	["sed", wordSet("-e --expression -f --file -l --line-length")],
	["perl", wordSet("-e -E -M -m -I")],
	["tee", wordSet("")],
]);

function positionalOperands(executable: string, args: readonly string[]): string[] {
	const valued = WRITE_VALUE_OPTIONS.get(executable) ?? new Set<string>();
	const out: string[] = [];
	for (let i = 0; i < args.length; i += 1) {
		if (args[i] === "--") return [...out, ...args.slice(i + 1)];
		if (valued.has(args[i])) i += 1;
		else if (!args[i].startsWith("-") || args[i] === "-") out.push(args[i]);
	}
	return out;
}

const optionValue = (args: readonly string[], names: readonly string[]): string | undefined => {
	for (let i = 0; i < args.length; i += 1) {
		const name = names.find((n) => args[i] === n || (n.startsWith("--") && args[i].startsWith(`${n}=`)));
		if (name !== undefined) return args[i] === name ? args[i + 1] : args[i].slice(name.length + 1);
	}
	return undefined;
};

/** Files an invocation writes or deletes through its own operands (not redirects): tee, cp/mv/install/ln destinations, dd of=, sed -i, perl -i, rm, touch, truncate, curl -o, wget -O. */
export function writeOperands(inv: Pick<CanonicalInvocation, "executable" | "args">): string[] {
	const executable = normaliseExecutable(inv.executable);
	const args = inv.args;
	const positionals = positionalOperands(executable, args);
	switch (executable) {
		case "tee":
		case "rm":
		case "rmdir":
		case "touch":
		case "truncate":
		case "shred":
			return positionals.filter((p) => p !== "-");
		case "cp":
		case "mv":
		case "install":
		case "ln": {
			const dir = optionValue(args, ["-t", "--target-directory"]);
			if (dir !== undefined) return [dir];
			return positionals.length >= 2 ? [positionals[positionals.length - 1]] : [];
		}
		case "dd":
			return args.filter((a) => a.startsWith("of=")).map((a) => a.slice(3));
		case "sed": {
			if (!args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))) return [];
			const scripted = optionValue(args, ["-e", "--expression", "-f", "--file"]) !== undefined;
			return scripted ? positionals : positionals.slice(1);
		}
		case "perl":
			return args.some((a) => /^-[a-zA-Z]*i/.test(a)) ? positionals : [];
		case "curl":
		case "wget": {
			const out = optionValue(args, executable === "curl" ? ["-o", "--output"] : ["-O", "--output-document"]);
			return out === undefined || out === "-" ? [] : [out];
		}
		default:
			return [];
	}
}

const SHELL_INLINE: RegExp = /^-[a-zA-Z]*c$/;
const SCRIPT_INLINE: RegExp = /^-[a-zA-Z]*[eE]$/;

// Interpreters' options that make the code an argument rather than a file or stdin.
const INLINE_CODE_FLAGS: ReadonlyMap<string, (arg: string) => boolean> = new Map([
	..."sh bash zsh dash fish ksh mksh ash csh tcsh".split(" ").map((n) => [n, (a: string) => SHELL_INLINE.test(a)] as const),
	...["python", "python3", "py"].map((n) => [n, (a: string) => a === "-c"] as const),
	...["node", "bun", "deno"].map((n) => [n, (a: string) => /^(-e|-p|--eval|--print|eval)$/.test(a)] as const),
	...["perl", "ruby"].map((n) => [n, (a: string) => SCRIPT_INLINE.test(a)] as const),
	["php", (a: string) => a === "-r"],
	...["pwsh", "powershell"].map((n) => [n, (a: string) => /^-(c|command)$/i.test(a)] as const),
	["cmd", (a: string) => /^\/{1,2}[ck]$/i.test(a)],
]);

// A deny-list with known gaps: REPLs and tools whose input language can run shell commands count as code runners too.
const CODE_RUNNER_NAMES = wordSet(
	"sh bash zsh dash ksh mksh ash csh tcsh fish busybox pwsh powershell cmd node deno bun perl ruby php lua rscript osascript parallel " +
		"su script rlwrap strace flock watch tsx ts-node ipython irb pry julia r tclsh wish expect jshell jython graalpy micropython " +
		"sqlite3 psql mysql ed dc",
);

const PYTHON_RUNNER = /^(python[\d.]*w?|py|pypy[\d.]*|pytest|py\.test)$/;

// Package managers whose `run` subcommand starts an interpreter from the project environment.
const RUN_SUBCOMMAND_RUNNERS = wordSet("uv poetry pipenv conda");

// Programs that run code they read; their code must never come from a pipe, a stdin alias or a file the same command wrote.
const isCodeRunner = (executable: string): boolean =>
	CODE_RUNNER_NAMES.has(executable) || PYTHON_RUNNER.test(executable) || /^(lua[\d.]*|perl[\d.]*|ruby[\d.]*|php[\d.]*)$/.test(executable);

const runsCode = (inv: Pick<CanonicalInvocation, "executable" | "args">): boolean => {
	const executable = normaliseExecutable(inv.executable);
	return isCodeRunner(executable) || (RUN_SUBCOMMAND_RUNNERS.has(executable) && inv.args.includes("run"));
};

const STDIN_ALIAS = /^(-|\/dev\/stdin|\/dev\/fd\/\d+|\/proc\/[^/]+\/fd\/\d+|php:\/\/(stdin|fd\/0))$/i;

// Python imports these from the working directory or sys.path without naming them on the command line.
const PYTHON_IMPORTABLE = /\.(py|pyc|pyd|so|pth)$/;

// Variables that make an interpreter load code before or instead of its script.
const STARTUP_VARIABLE = /\b(BASH_ENV|NODE_OPTIONS|RUBYOPT|PERL5OPT|PERL5DB|PERL5LIB|PYTHONINSPECT|PYTHONSTARTUP|PHP_INI_SCAN_DIR)\b/;
const NODE_OPTIONS_BENIGN = /\bNODE_OPTIONS=(["']?)(--(max-old-space-size|max-semi-space-size|stack-size)=\d+ ?)+\1(?=[\s;&|]|$)/g;

const baseOf = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop()?.toLowerCase() ?? "";

// The word itself, an `--opt=value` value and an attached short-option value (`-rfile`), any of which can name a file.
const optionValues = (arg: string): string[] => [arg, ...(arg.includes("=") ? [arg.slice(arg.indexOf("=") + 1)] : []), ...(/^-[A-Za-z]./.test(arg) ? [arg.slice(2)] : [])];

// A written basename inside a word, as a whole name: `require "w.pl"` matches w.pl, `new.pl` does not.
const mentionsName = (word: string, name: string): boolean => new RegExp(`(^|[^\\w.-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w.])`).test(word.toLowerCase());

// The program file awk (-f, gawk -E) or sed (-f) reads its script from.
function programFiles(inv: Pick<CanonicalInvocation, "executable" | "args">): string[] {
	const executable = normaliseExecutable(inv.executable);
	const names = /^[gmn]?awk$/.test(executable) ? ["-f", "--file", "-E", "--exec"] : executable === "sed" ? ["-f", "--file"] : [];
	return inv.args.flatMap((a, i) => {
		const name = names.find((n) => a === n || a.startsWith(n.startsWith("--") ? `${n}=` : n));
		if (name === undefined) return [];
		return a === name ? [inv.args[i + 1] ?? "-"] : [a.slice(name.length + (name.startsWith("--") ? 1 : 0))];
	});
}

// Compared by basename because a `cd` may sit between the write and the run.
function runsGeneratedScript(extracted: readonly ExtractedInvocation[], scan: ScriptScan): boolean {
	const writtenPaths = [...scan.writeTargets, ...extracted.flatMap((e) => writeOperands(e.invocation))];
	const written = new Set(writtenPaths.map(baseOf));
	const isWritten = (path: string): boolean => written.has(baseOf(path));
	const mentionable = writtenPaths.filter((p) => !/^(\/dev\/|nul$)/i.test(p)).map(baseOf).filter((b) => b !== "");
	const runners = extracted.filter((e) => runsCode(e.invocation));
	// `exec 0<f` and a bare `< f` rebind stdin for every later command.
	const stdinRebinds = scan.commands.filter((c) => c.name === undefined || c.name.value === "exec").flatMap((c) => redirectFiles(c.redirects).reads);
	if (runners.length > 0 && [...scan.compoundReads, ...stdinRebinds].some(isWritten)) return true;
	const writesPythonCode = [...written].some((b) => PYTHON_IMPORTABLE.test(b));
	return extracted.some(({ invocation, node }) => {
		const executable = normaliseExecutable(invocation.executable);
		const sourced = executable === "source" || executable === "." ? invocation.args : [];
		if ([...sourced, ...(/[/\\]/.test(invocation.executable) ? [invocation.executable] : [])].some(isWritten)) return true;
		const wrapped = wrappedCommands(invocation) ?? [];
		if ([invocation, ...wrapped].flatMap(programFiles).some((f) => STDIN_ALIAS.test(f) || isWritten(f))) return true;
		if (wrapped.filter(runsCode).some((w) => w.args.some(isWritten))) return true;
		// A wrapper with no command left (`sudo -s`, `sudo -i`) starts a shell that reads stdin.
		if (executable === "" && invocation.wrappers.length > 0 && scan.piped.has(node)) return true;
		if (!runsCode(invocation)) return false;
		if (writesPythonCode && (PYTHON_RUNNER.test(executable) || RUN_SUBCOMMAND_RUNNERS.has(executable))) return true;
		const perlModules = /^perl[\d.]*$/.test(executable)
			? invocation.args.flatMap((a) => (/^-[Mm]./.test(a) ? [`${a.slice(2).split("=")[0].replace(/::/g, "/")}.pm`] : []))
			: [];
		const values = invocation.args.flatMap(optionValues);
		const stdinFiles = node.redirects.filter((r) => r.operator === "<" || r.operator === "<>").flatMap((r) => r.target?.value ?? []);
		if (scan.piped.has(node) || values.some((v) => STDIN_ALIAS.test(v))) return true;
		return [...values, ...perlModules, ...stdinFiles].some(isWritten) || invocation.args.some((a) => mentionable.some((b) => mentionsName(a, b)));
	});
}

// A startup variable set or named anywhere in a command that runs code; a heap-size NODE_OPTIONS stays allowed.
const setsStartupVariable = (command: string, invocations: readonly CanonicalInvocation[]): boolean =>
	invocations.some((inv) => runsCode(inv) || (wrappedCommands(inv) ?? []).some(runsCode)) && STARTUP_VARIABLE.test(command.replace(NODE_OPTIONS_BENIGN, ""));

/** A command xargs, find -exec, fd -x or parallel runs over its input names. */
export interface WrappedCommand {
	readonly executable: string;
	readonly args: readonly string[];
}

const XARGS_SHORT = { boolean: "0oprtx", value: "adEILnPsJRS", optional: "eil" };
const XARGS_LONG_BOOLEAN = wordSet("--null --open-tty --interactive --no-run-if-empty --verbose --exit --show-limits --replace --eof --max-lines");
const XARGS_LONG_VALUE = wordSet("--arg-file --delimiter --max-args --max-procs --max-chars --process-slot-var");

// Short options bundle (`-0r`, `-n1`, `-I{}`); `-e`, `-i` and `-l` take an optional attached value. Undefined when an option is unknown.
function xargsCommand(args: readonly string[]): WrappedCommand | undefined {
	let i = 0;
	for (; i < args.length && args[i].startsWith("-") && args[i] !== "-"; i += 1) {
		const word = args[i];
		if (word === "--") {
			i += 1;
			break;
		}
		if (word.startsWith("--")) {
			const name = word.split("=")[0];
			if (XARGS_LONG_VALUE.has(name) && !word.includes("=")) i += 1;
			else if (!XARGS_LONG_BOOLEAN.has(name) && !XARGS_LONG_VALUE.has(name)) return undefined;
			continue;
		}
		for (let k = 1; k < word.length; k += 1) {
			if (XARGS_SHORT.boolean.includes(word[k])) continue;
			if (XARGS_SHORT.value.includes(word[k]) && k === word.length - 1) i += 1;
			else if (!XARGS_SHORT.value.includes(word[k]) && !XARGS_SHORT.optional.includes(word[k])) return undefined;
			break;
		}
	}
	if (i > args.length) return undefined;
	return args.length === i ? { executable: "echo", args: [] } : { executable: args[i], args: args.slice(i + 1) };
}

const PARALLEL_GRAMMAR: WrapperGrammar = {
	boolean: wordSet("-k --keep-order -v --verbose -q --quote --dry-run --tag -u --ungroup --line-buffer --bar --progress --eta -0 --null -X -m --xargs --halt-on-error"),
	value: wordSet("-j --jobs -N -n --max-args -I --delay --timeout --results --joblog -a --arg-file -d --delimiter --colsep -C"),
};

/** Every command an input-driven runner runs, `[]` for any other program, undefined when the command cannot be found. */
export function wrappedCommands(inv: Pick<CanonicalInvocation, "executable" | "args">): WrappedCommand[] | undefined {
	const executable = normaliseExecutable(inv.executable);
	if (executable === "xargs") {
		const command = xargsCommand(inv.args);
		return command === undefined ? undefined : [command];
	}
	if (executable === "parallel") {
		const consumed = consumeWrapperOptions(inv.args, 0, PARALLEL_GRAMMAR, () => {});
		const end = inv.args.findIndex((a, i) => i >= consumed.index && a.startsWith(":::"));
		const tail = inv.args.slice(consumed.index, end === -1 ? undefined : end);
		if (!consumed.confident) return undefined;
		return tail.length === 0 ? [] : [{ executable: tail[0], args: tail.slice(1) }];
	}
	const primaries = FIND_EXEC_PRIMARIES.get(executable);
	if (primaries === undefined) return [];
	const commands: WrappedCommand[] = [];
	for (let i = 0; i < inv.args.length; i += 1) {
		if (!primaries.has(inv.args[i])) continue;
		const end = inv.args.findIndex((a, j) => j > i && (a === ";" || a === "+"));
		const tail = inv.args.slice(i + 1, end === -1 ? undefined : end);
		if (tail.length === 0) return undefined;
		commands.push({ executable: tail[0], args: tail.slice(1) });
		i = end === -1 ? inv.args.length : end;
	}
	return commands;
}

const INPUT_RUNNERS = wordSet("xargs parallel find fd watch");

const REPLACE_OPTION = /^(-[0oprtx]*[Ii]|--replace)/;

// xargs and parallel turn their input into the runner's arguments, so only a fixed script operand keeps the code visible.
const inputPicksCode = (outer: CanonicalInvocation, w: WrappedCommand): boolean => {
	const first = w.args[0] === "-m" && PYTHON_RUNNER.test(normaliseExecutable(w.executable)) ? w.args[1] : w.args[0];
	return first === undefined || first.startsWith("-") || w.args.some((a) => a.includes("{")) || outer.args.some((a) => REPLACE_OPTION.test(a));
};

// A wrapped command is refused when it is itself a wrapper, or a code runner whose inline code would receive the input names.
function wrappedRefusal(outer: CanonicalInvocation, w: WrappedCommand): ShellRefusalCause | undefined {
	const executable = normaliseExecutable(w.executable);
	const managerWithoutSubcommand = PACKAGE_MANAGER_RUNNERS.has(executable) && !w.args.some((a) => !a.startsWith("-"));
	if (WRAPPER_GRAMMARS.has(executable) || INPUT_RUNNERS.has(executable) || managerWithoutSubcommand) return "unresolved-wrapper";
	if (!runsCode(w)) return undefined;
	const inline = INLINE_CODE_FLAGS.get(executable);
	const inlineCode = inline !== undefined && w.args.some(inline);
	const fromInput = ["xargs", "parallel"].includes(normaliseExecutable(outer.executable)) && inputPicksCode(outer, w);
	return inlineCode || fromInput || w.args.some((a) => STDIN_ALIAS.test(a)) ? "generated-script" : undefined;
}

const firstWrappedRefusal = (invocations: readonly CanonicalInvocation[]): ShellRefusalCause | undefined => {
	for (const inv of invocations) {
		const wrapped = wrappedCommands(inv);
		if (wrapped === undefined) return "unresolved-wrapper";
		const cause = wrapped.map((w) => wrappedRefusal(inv, w)).find((c) => c !== undefined);
		if (cause !== undefined) return cause;
	}
	return undefined;
};

// GNU getopt accepts any unambiguous prefix of a long option, so a prefix of a listed name counts.
const longOptionIn = (arg: string, names: readonly string[]): boolean => {
	const name = arg.split("=")[0];
	return name.length >= 4 && name.startsWith("--") && names.some((n) => n.startsWith(name));
};

const shortFlagIn = (arg: string, letters: RegExp): boolean => /^-[^-]/.test(arg) && letters.test(arg.slice(1));

const AWK_RUNS_COMMAND = /\bsystem\s*\(|\|\s*getline|\|&|@load|\b(print|printf)\b[^;}]*?[^|]\|(?!\|)/;
const SED_E_COMMAND = /(^|[;{}\n])\s*(\d+|\$|\/[^/]*\/)?(\s*,\s*(\d+|\$|\/[^/]*\/))?\s*!?\s*e(\s|;|$)/;
const SED_SUBSTITUTE = /s([^\\\n])(?:\\.|(?!\1)[^\\])*\1(?:\\.|(?!\1)[^\\])*\1([a-zA-Z0-9]*)/g;
const SED_WRITE_DEVICE = /(^|[;{}\s\d$/])[wW]\s*\/dev\//;

// Interactive programs that run commands from a prompt or an option; a non-interactive agent has no use for them.
const INTERACTIVE_COMMAND_RUNNERS = wordSet("less more most man vi vim nvim view ex vimdiff emacs nano pico gdb");

// The sed scripts in `args`: every -e/--expression value, else the first positional.
function sedScripts(args: readonly string[]): string[] {
	const flagged = args.flatMap((a, i) => (a === "-e" || a === "--expression" ? [args[i + 1] ?? ""] : a.startsWith("--expression=") ? [a.slice(13)] : []));
	return flagged.length > 0 ? flagged : args.filter((a) => !a.startsWith("-")).slice(0, 1);
}

const sedRunsCommand = (script: string): boolean =>
	SED_E_COMMAND.test(script) || SED_WRITE_DEVICE.test(script) || [...script.matchAll(SED_SUBSTITUTE)].some((m) => /^[^w]*e/.test(m[2]));

// Why a program runs a command string taken from its own arguments, or undefined; plain awk and sed stay allowed.
function commandStringProgram(inv: Pick<CanonicalInvocation, "executable" | "args" | "assignmentWords">): string | undefined {
	const executable = normaliseExecutable(inv.executable);
	const args = inv.args;
	if (INTERACTIVE_COMMAND_RUNNERS.has(executable)) return "is interactive and runs commands from its prompt or options";
	switch (executable) {
		case "awk":
		case "gawk":
		case "mawk":
		case "nawk":
			return args.some((a) => AWK_RUNS_COMMAND.test(a)) ? "runs an awk program that starts a command" : undefined;
		case "sed":
			return sedScripts(args).some(sedRunsCommand) ? "runs a sed script with the e command or flag, or one that writes to a device" : undefined;
		case "tar": {
			const names = ["--to-command", "--use-compress-program", "--checkpoint-action", "--info-script", "--new-volume-script", "--rsh-command"];
			const oldStyle = args[0] !== undefined && /^[a-zA-Z]*[IF][a-zA-Z]*$/.test(args[0]);
			return oldStyle || args.some((a) => longOptionIn(a, names) || shortFlagIn(a, /[IF]/)) ? "names a program for tar to run" : undefined;
		}
		case "rsync":
			return args.some((a) => longOptionIn(a, ["--rsh", "--rsync-path"]) || shortFlagIn(a, /e/)) ? "names a shell or program for rsync to run" : undefined;
		case "bat": {
			const pagerVariable = (inv.assignmentWords ?? []).some((w) => /^(BAT_)?PAGER=/.test(w));
			return pagerVariable || args.some((a) => a === "--pager" || a.startsWith("--pager=")) ? "names a pager for bat to run" : undefined;
		}
		case "make": {
			const stdinFile = args.some((a, i) => (a === "-f" || longOptionIn(a, ["--file", "--makefile"])) && STDIN_ALIAS.test(a.includes("=") ? a.split("=")[1] : (args[i + 1] ?? "")));
			return stdinFile || args.some((a) => longOptionIn(a, ["--eval"]) || /^-E/.test(a)) ? "takes a rule from its arguments or stdin" : undefined;
		}
		case "sort":
			return args.some((a) => longOptionIn(a, ["--compress-program"])) ? "names a compressor for sort to run" : undefined;
		default:
			return undefined;
	}
}

const firstCommandString = (invocations: readonly CanonicalInvocation[]): string | undefined => {
	const commands = invocations.flatMap((inv) => [inv, ...(wrappedCommands(inv) ?? [])]);
	return commands.map(commandStringProgram).find((why) => why !== undefined);
};

const ONE_LINER_RUNNERS = /^(python[\d.]*|py|pypy[\d.]*|node|deno|bun|perl[\d.]*|ruby[\d.]*|php[\d.]*)$/;

// Calls and modules that open files, start processes or load code by name; a match refuses the one-liner.
const INLINE_CODE_EFFECT = new RegExp(
	[
		String.raw`\b(open|exec\w*|eval|system|popen\w*|spawn\w*|fork|unlink\w*|rename\w*|remove|rmdir\w*|mkdir\w*|makedirs|write\w*|chmod\w*|symlink\w*|copy\w*|move|getattr|compile|Function|constructor|require|import_module|__import__)\s*\(`,
		String.raw`\b(subprocess|shutil|pathlib|importlib|child_process|ctypes|socket|urllib|Open3|FileUtils|Kernel|globalThis)\b`,
		String.raw`\b(os|fs|Deno|Bun|File|IO|Dir)\.|process\.binding|__\w+__|\bimport\s*\(|` + "`" + String.raw`|\bqx\W|%x\W`,
	].join("|"),
);

// Effects that only print or parse a JSON file, removed before the check.
const INLINE_CODE_BENIGN = /\brequire\s*\(\s*(['"])[^'"]*\.json\1\s*\)|\b(process\.|sys\.)?std(out|err)\.write\s*\(/g;

// An interpreter one-liner (`python -c`, `node -e`, `perl -e`, `ruby -e`, `php -r`) whose code may write, open or run.
function inlineCodeEffect(inv: Pick<CanonicalInvocation, "executable" | "args">): boolean {
	const executable = normaliseExecutable(inv.executable);
	// perl splices a -M/-m value into `use ...;`, so anything beyond a module name and import list is code.
	const perlModuleCode =
		/^perl[\d.]*$/.test(executable) &&
		inv.args.some((a, i) => /^-[Mm]/.test(a) && !/^-?[\w:]+(=[\w:,]*)?$/.test(a.length === 2 ? (inv.args[i + 1] ?? "") : a.slice(2)));
	if (perlModuleCode) return true;
	const inline = INLINE_CODE_FLAGS.get(executable) ?? (/^python[\d.]*$/.test(executable) ? (a: string) => a === "-c" : undefined);
	if (inline === undefined || !ONE_LINER_RUNNERS.test(executable)) return false;
	const codes = inv.args.flatMap((a, i) => (inline(a) ? [inv.args[i + 1] ?? ""] : []));
	return codes.some((code) => INLINE_CODE_EFFECT.test(code.replace(INLINE_CODE_BENIGN, "")));
}

/** Parse and fail closed on {@link SHELL_REFUSAL_CAUSES}; otherwise one canonical invocation per `Command` node. */
export function canonicalise(command: string): ShellVerdict {
	let script: ParsedScript;
	try {
		script = parse(command);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { kind: "refused", cause: "parse-error", detail: `parse() threw for "${command}": ${message}` };
	}
	const scan = scanScript(script);
	const cause = detectRefusalCause(script, scan);
	if (cause !== undefined) return refused(cause, command);

	const extracted = extractInvocations(script, command, scan.commands);
	const invocations = extracted.map((e) => e.invocation);
	if (extracted.some((e) => e.expansionInCommandPosition)) return refused("unresolved-expansion-in-command-position", command);
	if (findShellRunnerDenial(invocations) !== undefined || carriesVerbAcrossSegments(invocations)) return refused("shell-runner", command);
	const wrappedCause = firstWrappedRefusal(invocations);
	if (wrappedCause !== undefined) return refused(wrappedCause, command);
	if (firstCommandString(invocations) !== undefined) return refused("command-string-program", command);
	if (invocations.some(inlineCodeEffect)) return refused("inline-code-effect", command);
	if (runsGeneratedScript(extracted, scan) || setsStartupVariable(command, invocations)) return refused("generated-script", command);
	// An unresolved wrapper is refused when a guarded verb or a code runner could be behind it, or it reads a pipe; `env -x ls` stays ok.
	const hidesRunner = (e: ExtractedInvocation): boolean =>
		mentionsGuardedVerb(segmentTexts(e.invocation)) || scan.piped.has(e.node) || [e.invocation.executable, ...e.invocation.args].some((w) => isCodeRunner(normaliseExecutable(w)));
	if (extracted.some((e) => !e.confident && hidesRunner(e))) return refused("unresolved-wrapper", command);
	const redirectTargets = { redirectReadTargets: scan.compoundReads, redirectWriteTargets: scan.compoundWrites };
	const scriptAssignments = scan.commands.filter((c) => c.name === undefined).flatMap((c) => c.prefix.map((a) => a.text));
	return { kind: "ok", invocations, redirectOperators: [...scan.redirects], commandCount: scan.commands.length, scriptAssignments, ...redirectTargets };
}
