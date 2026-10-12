/**
 * bash command parsing: a fail-closed node-type deny predicate, then wrapper
 * resolution to a canonical invocation so policy sees `git push`, never `env` or `sudo`.
 *
 * Invariants:
 * - unbash is tolerant: `errors.length === 0` for `git $(echo push)`, `sh -c "git push"`,
 *   heredocs and `nohup git push &`. Denial is by PRESENCE of node types
 *   (`DENIED_PART_TYPES`, heredoc operators, `Statement.background`, expansion in command
 *   position); `errors.length > 0` is only the last catch-all. `script.errors` may be undefined.
 * - `Word.value`/`Word.parts` are self-memoizing getters absent from `Object.keys()`, so
 *   `walkableKeys()` forces them or the walker never descends into substitutions inside a Word.
 * - Command position includes a guarded verb's arguments: `g=push; git $g` has a literal
 *   `git` name and the expansion in `suffix[0]`. Refuse expansion in `Command.name` always, and
 *   in `suffix[]` when the name is literally a guarded verb (`echo "$HOME"` stays allowed).
 * - `git $((1+1))` does not yield `ArithmeticCommandExpansion`; the fixture is `echo $(( $(echo 1) ))`.
 * - env/sudo option arity is tabulated: a wrong flag arity silently mis-resolves
 *   (`sudo -u root git push` must not resolve to `root`); shell-parse.test.ts pins `-u` and `-C`.
 * - A shell runner carrying a guarded verb (`sh -c "git push"`) is denied outright, never routed
 *   to approval, by substring over the raw segment rather than a recursive re-parse.
 *
 * Pure: no ctx, fs or child_process, and no default export (extension-layout.test.ts would
 * treat it as an entry point). Registers nothing and never spells the tool-registration call
 * (contributing-boundary.test.ts matches it as a substring).
 */
import { parse } from "unbash";
import type { Command, ParsedScript, Word } from "unbash";


/**
 * Runtime `.type` strings unbash emits (not the longer `dist/types.d.ts` interface names).
 * Iteration order is the refusal-cause priority (see {@link detectDeniedPartType}).
 */
export const DENIED_PART_TYPES = new Set(["CommandExpansion", "ProcessSubstitution", "ArithmeticCommandExpansion"]);

/** Redirect operators that write a heredoc/herestring body — refuse all three. */
export const HEREDOC_OPERATORS = new Set(["<<", "<<-", "<<<"]);

/** Word-part types that mark an UNRESOLVED shell expansion (not a literal value yet). */
const EXPANSION_PART_TYPES = new Set(["SimpleExpansion", "ParameterExpansion"]);

/** Guarded executables, word-bounded so `git` does not match `digit`; shared by the command-position rule and shell-runner denial. */
export const GUARDED_VERB_PATTERN = /\b(git|glab|terraform|aws|kubectl)\b/i;

/** Runners that can hide a guarded verb in a script argument; denied only with {@link GUARDED_VERB_PATTERN} in the raw segment. */
export const SHELL_RUNNERS = new Set([
	"sh",
	"bash",
	"zsh",
	"dash",
	"fish",
	"xargs",
	"python",
	"python3",
	"node",
	"perl",
	"ruby",
	// `eval STRING` runs in the current shell: same hidden-verb shape as `sh -c`. Closes the literal
	// case only; `CMD="git push"; eval "$CMD"` is a published residual gap (docs/SAFETY.md).
	"eval",
]);

/** Every cause {@link canonicalise} can return; tests iterate it to prove each is reachable. */
export const SHELL_REFUSAL_CAUSES = [
	"command-substitution",
	"process-substitution",
	"arithmetic-expansion",
	"heredoc",
	"background",
	"unresolved-expansion-in-command-position",
	"shell-runner",
	"parse-error",
] as const;

export type ShellRefusalCause = (typeof SHELL_REFUSAL_CAUSES)[number];

const CAUSE_BY_DENIED_TYPE: Record<string, ShellRefusalCause> = {
	CommandExpansion: "command-substitution",
	ProcessSubstitution: "process-substitution",
	ArithmeticCommandExpansion: "arithmetic-expansion",
};


/** `env` flags that take no value argument. */
const ENV_BOOLEAN_OPTIONS = new Set(["-i", "--ignore-environment", "-0", "--null", "-v", "--verbose", "--debug"]);

/** `env` flags that consume the NEXT word as their value — `-C`/`--chdir` is the directory override. */
const ENV_VALUE_OPTIONS = new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]);

/** `sudo` flags that take no value argument. */
const SUDO_BOOLEAN_OPTIONS = new Set([
	"-i",
	"--login",
	"-n",
	"--non-interactive",
	"-S",
	"--stdin",
	"-E",
	"--preserve-env",
	"-H",
	"--set-home",
	"-b",
	"--background",
	"-k",
	"--reset-timestamp",
	"-v",
	"--validate",
	"-A",
	"--askpass",
]);

/** `sudo` flags that consume the NEXT word as their value — `-u`/`--user` is the Pitfall-2 regression case. */
const SUDO_VALUE_OPTIONS = new Set([
	"-u",
	"--user",
	"-g",
	"--group",
	"-p",
	"--prompt",
	"-h",
	"--host",
	"-C",
	"--close-from",
	"-D",
	"--chdir",
	"-R",
	"--chroot",
	"-T",
	"--command-timeout",
	"-U",
	"--other-user",
]);

/** Pass-through wrappers: flag-like words after the name are skipped generically (`stdbuf -o0` packs its value). */
const PASSTHROUGH_WRAPPERS = new Set([
	"nohup",
	"chronic",
	"setsid",
	"time",
	"nice",
	"stdbuf",
	"command",
	"builtin",
	"toybox",
	"busybox",
]);


/** One command's canonical form after wrapper resolution — what policy evaluates. */
export interface CanonicalInvocation {
	/** The real executable, with every wrapper (`sudo`, `env`, `nohup`, ...) resolved away. */
	readonly executable: string;
	/** Arguments AFTER the resolved executable. Quote-resolved (`Word.value`), not raw text. */
	readonly args: readonly string[];
	/** Wrapper names encountered, in the order they appeared (e.g. `["sudo"]`, `["env"]`). */
	readonly wrappers: readonly string[];
	/** The raw source slice for this one command segment — what {@link GUARDED_VERB_PATTERN} tests against. */
	readonly rawSegment: string;
	/** `git -C`/`--git-dir` wins (the only value a `HEAD == main` oracle can trust), else an `env -C` directory. */
	readonly cwdOverride?: string;
}

export type ShellVerdict =
	| { readonly kind: "refused"; readonly cause: ShellRefusalCause; readonly detail: string }
	| {
			readonly kind: "ok";
			readonly invocations: readonly CanonicalInvocation[];
			/** Every distinct `Redirect.operator` in walk order; plan-mode read-only.ts reuses it so there is one AST walk. */
			readonly redirectOperators: readonly string[];
	  };

/**
 * Reduce an executable to the verb policy classifies on: basename, lower-cased, Windows
 * extension stripped. Every bare-verb gate MUST route through it, or `git.exe push`,
 * `/usr/bin/git push` and `terraform.exe apply` classify as allow.
 */
export function normaliseExecutable(executable: string): string {
	const base = executable.replace(/\\/g, "/").split("/").pop() ?? executable;
	return base.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, "");
}


const LAZY_WORD_KEYS = ["value", "parts"] as const;

function walkableKeys(obj: Record<string, unknown>): string[] {
	const keys = new Set(Object.keys(obj));
	for (const lazy of LAZY_WORD_KEYS) {
		if (!keys.has(lazy) && lazy in obj) {
			keys.add(lazy);
		}
	}
	return [...keys];
}

/** Every value found under any `.type` field anywhere in `node`'s subtree. */
function collectTypes(node: unknown, found: Set<string>): void {
	if (node === null || typeof node !== "object") {
		return;
	}
	if (Array.isArray(node)) {
		for (const item of node) {
			collectTypes(item, found);
		}
		return;
	}
	const obj = node as Record<string, unknown>;
	if (typeof obj.type === "string") {
		found.add(obj.type);
	}
	for (const key of walkableKeys(obj)) {
		if (key === "pos" || key === "end") {
			continue;
		}
		collectTypes(obj[key], found);
	}
}

/** Every `Redirect.operator` value found anywhere in `node`'s subtree. */
function collectRedirectOperators(node: unknown, found: Set<string>): void {
	if (node === null || typeof node !== "object") {
		return;
	}
	if (Array.isArray(node)) {
		for (const item of node) {
			collectRedirectOperators(item, found);
		}
		return;
	}
	const obj = node as Record<string, unknown>;
	if (Array.isArray(obj.redirects)) {
		for (const redirect of obj.redirects as Record<string, unknown>[]) {
			if (typeof redirect.operator === "string") {
				found.add(redirect.operator);
			}
		}
	}
	for (const key of walkableKeys(obj)) {
		if (key === "pos" || key === "end") {
			continue;
		}
		collectRedirectOperators(obj[key], found);
	}
}

/** True if any `Statement` node anywhere in `node`'s subtree has `background === true`. */
function anyStatementBackgrounded(node: unknown): boolean {
	if (node === null || typeof node !== "object") {
		return false;
	}
	if (Array.isArray(node)) {
		return node.some((item) => anyStatementBackgrounded(item));
	}
	const obj = node as Record<string, unknown>;
	if (obj.type === "Statement" && obj.background === true) {
		return true;
	}
	return walkableKeys(obj)
		.filter((key) => key !== "pos" && key !== "end")
		.some((key) => anyStatementBackgrounded(obj[key]));
}

/** Every `Command` node anywhere in `node`'s subtree, in the order the walk encounters them. */
function collectCommandNodes(node: unknown, found: Command[]): void {
	if (node === null || typeof node !== "object") {
		return;
	}
	if (Array.isArray(node)) {
		for (const item of node) {
			collectCommandNodes(item, found);
		}
		return;
	}
	const obj = node as Record<string, unknown>;
	if (obj.type === "Command") {
		found.push(obj as unknown as Command);
	}
	for (const key of walkableKeys(obj)) {
		if (key === "pos" || key === "end") {
			continue;
		}
		collectCommandNodes(obj[key], found);
	}
}

/** Does this `Word`'s subtree contain an unresolved `SimpleExpansion`/`ParameterExpansion`? */
function hasExpansionPart(word: Word | undefined): boolean {
	if (word === undefined) {
		return false;
	}
	const types = new Set<string>();
	collectTypes(word, types);
	return [...EXPANSION_PART_TYPES].some((t) => types.has(t));
}

/** Is this `Word` a LITERAL (no unresolved expansion of its own) match for {@link GUARDED_VERB_PATTERN}? */
function isLiteralGuardedExecutable(word: Word | undefined): boolean {
	if (word === undefined || hasExpansionPart(word)) {
		return false;
	}
	return GUARDED_VERB_PATTERN.test(word.value);
}

/** The command-position expansion rule — see the module docstring for the worked example. */
function hasUnresolvedExpansionInCommandPosition(commandNodes: readonly Command[]): boolean {
	for (const command of commandNodes) {
		if (hasExpansionPart(command.name)) {
			return true;
		}
		if (isLiteralGuardedExecutable(command.name)) {
			for (const suffixWord of command.suffix) {
				if (hasExpansionPart(suffixWord)) {
					return true;
				}
			}
		}
	}
	return false;
}


function detectDeniedPartType(script: ParsedScript): string | undefined {
	const types = new Set<string>();
	collectTypes(script, types);
	for (const denied of DENIED_PART_TYPES) {
		if (types.has(denied)) {
			return denied;
		}
	}
	return undefined;
}

function detectHeredoc(script: ParsedScript): boolean {
	const operators = new Set<string>();
	collectRedirectOperators(script, operators);
	for (const op of HEREDOC_OPERATORS) {
		if (operators.has(op)) {
			return true;
		}
	}
	return false;
}

/** Fail-closed decision in priority order; parse error is the last catch-all. */
function detectRefusalCause(script: ParsedScript, commandNodes: readonly Command[]): ShellRefusalCause | undefined {
	const deniedType = detectDeniedPartType(script);
	if (deniedType !== undefined) {
		return CAUSE_BY_DENIED_TYPE[deniedType];
	}
	if (detectHeredoc(script)) {
		return "heredoc";
	}
	if (anyStatementBackgrounded(script)) {
		return "background";
	}
	if (hasUnresolvedExpansionInCommandPosition(commandNodes)) {
		return "unresolved-expansion-in-command-position";
	}
	if ((script.errors ?? []).length > 0) {
		return "parse-error";
	}
	return undefined;
}

function describeCause(cause: ShellRefusalCause, command: string): string {
	switch (cause) {
		case "command-substitution":
			return `command substitution ($(...) or a backtick form) in "${command}" hides an arbitrary command from policy`;
		case "process-substitution":
			return `process substitution (<(...) or >(...)) in "${command}" hides an arbitrary command from policy`;
		case "arithmetic-expansion":
			return `a command substitution nested inside an arithmetic expansion in "${command}" hides an arbitrary command from policy`;
		case "heredoc":
			return `a heredoc/herestring redirect in "${command}" can smuggle an arbitrary script past a text-only check`;
		case "background":
			return `"${command}" backgrounds the command (&), which this guard cannot observe complete before returning`;
		case "unresolved-expansion-in-command-position":
			return `"${command}" resolves its executable or a guarded verb's subcommand from an unresolved shell variable`;
		case "shell-runner":
			return `"${command}" hands a guarded verb to a shell runner (${[...SHELL_RUNNERS].join(", ")}) as a script argument`;
		case "parse-error":
			return `"${command}" did not parse cleanly; this catch-all denies rather than falls through to allow`;
		default: {
			const exhaustive: never = cause;
			return exhaustive;
		}
	}
}


interface ResolvedWrappers {
	readonly wrappers: string[];
	readonly cwdOverride: string | undefined;
	/** Index into `values[]` of the first word AFTER every recognised wrapper. */
	readonly index: number;
}

/**
 * Consume recognised wrappers and their option grammars; `values[index]` is the real executable.
 * Names go through {@link normaliseExecutable} so `/usr/bin/env git push` and `env.exe` resolve.
 */
function resolveWrappers(values: readonly string[]): ResolvedWrappers {
	const wrappers: string[] = [];
	let cwdOverride: string | undefined;
	let i = 0;

	while (i < values.length) {
		const word = values[i];
		const verb = normaliseExecutable(word);

		if (verb === "env") {
			wrappers.push("env");
			i += 1;
			while (i < values.length && values[i].startsWith("-")) {
				const flag = values[i];
				if (ENV_VALUE_OPTIONS.has(flag)) {
					if (flag === "-C" || flag === "--chdir") {
						cwdOverride = values[i + 1];
					}
					i += 2;
				} else if (ENV_BOOLEAN_OPTIONS.has(flag)) {
					i += 1;
				} else {
					// Unrecognised flag: stop rather than over-consume into the real command (inert, never a bypass).
					break;
				}
			}
			continue;
		}

		if (verb === "sudo") {
			wrappers.push("sudo");
			i += 1;
			while (i < values.length && values[i].startsWith("-")) {
				const flag = values[i];
				if (SUDO_VALUE_OPTIONS.has(flag)) {
					i += 2;
				} else if (SUDO_BOOLEAN_OPTIONS.has(flag)) {
					i += 1;
				} else {
					break;
				}
			}
			continue;
		}

		if (PASSTHROUGH_WRAPPERS.has(verb)) {
			wrappers.push(verb);
			i += 1;
			while (i < values.length && values[i].startsWith("-")) {
				i += 1;
			}
			continue;
		}

		break;
	}

	return { wrappers, cwdOverride, index: i };
}

/** `git -C <dir>` / `--git-dir[=]<dir>`; normalised so `git.exe -C /other push` keeps its override. */
function extractGitCwdOverride(executable: string, args: readonly string[]): string | undefined {
	if (normaliseExecutable(executable) !== "git") {
		return undefined;
	}
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "-C" || arg === "--git-dir") {
			return args[i + 1];
		}
		if (arg.startsWith("--git-dir=")) {
			return arg.slice("--git-dir=".length);
		}
	}
	return undefined;
}

/** One entry per `Command` node, wrapper indirection resolved. */
function extractInvocations(
	script: ParsedScript,
	command: string,
	commandNodes: readonly Command[],
): CanonicalInvocation[] {
	// Backtick-decoded scripts index the decoded `ParsedScript.source`, not the caller's string.
	const sourceText = script.source ?? command;

	const invocations: CanonicalInvocation[] = [];
	for (const node of commandNodes) {
		if (node.name === undefined) {
			// Assignment-only statement (`g=push`): nothing executes.
			continue;
		}
		const values = [node.name.value, ...node.suffix.map((w) => w.value)];
		const resolved = resolveWrappers(values);
		const executable = values[resolved.index] ?? "";
		const args = values.slice(resolved.index + 1);
		const cwdOverride = extractGitCwdOverride(executable, args) ?? resolved.cwdOverride;

		invocations.push({
			executable,
			args,
			wrappers: resolved.wrappers,
			rawSegment: sourceText.slice(node.pos, node.end),
			...(cwdOverride !== undefined ? { cwdOverride } : {}),
		});
	}
	return invocations;
}

/** Deny when a resolved invocation hands a guarded verb to a shell runner; executable normalised so `/bin/sh -c` and `bash.exe -c` match. */
function findShellRunnerDenial(invocations: readonly CanonicalInvocation[]): CanonicalInvocation | undefined {
	return invocations.find(
		(inv) => SHELL_RUNNERS.has(normaliseExecutable(inv.executable)) && GUARDED_VERB_PATTERN.test(inv.rawSegment),
	);
}


/** Parse and fail closed on {@link SHELL_REFUSAL_CAUSES}; otherwise one canonical invocation per `Command` node. */
export function canonicalise(command: string): ShellVerdict {
	let script: ParsedScript;
	try {
		script = parse(command);
	} catch (err) {
		return {
			kind: "refused",
			cause: "parse-error",
			detail: `parse() threw for "${command}": ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	const commandNodes: Command[] = [];
	collectCommandNodes(script, commandNodes);

	const cause = detectRefusalCause(script, commandNodes);
	if (cause !== undefined) {
		return { kind: "refused", cause, detail: describeCause(cause, command) };
	}

	const invocations = extractInvocations(script, command, commandNodes);

	const shellRunnerHit = findShellRunnerDenial(invocations);
	if (shellRunnerHit !== undefined) {
		return { kind: "refused", cause: "shell-runner", detail: describeCause("shell-runner", command) };
	}

	const redirects = new Set<string>();
	collectRedirectOperators(script, redirects);

	return { kind: "ok", invocations, redirectOperators: [...redirects] };
}
