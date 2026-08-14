/**
 * SAFE-02 / SAFE-03 — bash command parsing: a fail-closed node-type deny
 * predicate, followed by wrapper resolution to a canonical invocation so
 * policy (a later plan) evaluates `git push`, never `env` or `sudo`.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DENY PREDICATE IS A NODE-TYPE CHECK, NOT `errors.length`
 * ---------------------------------------------------------------------------
 * `unbash` is a TOLERANT parser. `04-RESEARCH.md` Pattern 1 and this repo's
 * own executed proof (`tests/unit/unbash-ast.test.ts`, Plan 01) both show
 * `errors.length === 0` for `git $(echo push)`, heredoc-to-script,
 * `nohup git push &`, `sh -c "git push"`, `bash -lc "git push"`,
 * `env -i git push` and `git -C /other/repo push`. A guard that fails closed
 * on `errors.length > 0` therefore fails closed almost never. SAFE-03's real
 * mechanism is: walk the whole AST and refuse on the PRESENCE of specific
 * node types (`DENIED_PART_TYPES`, heredoc/herestring redirect operators,
 * `Statement.background`, an unresolved expansion in a policy-relevant
 * position). `errors.length > 0` is kept only as a final catch-all
 * (cause `"parse-error"`).
 *
 * unbash also declares `ParsedScript.errors` as `ParseError[] | undefined`,
 * not `[]`, on a clean parse (Plan 01 SUMMARY, confirmed by execution) — every
 * read below is `(script.errors ?? []).length`, never `script.errors.length`.
 *
 * ---------------------------------------------------------------------------
 * WHY THE WALKER FORCES `Word.value` / `Word.parts` EXPLICITLY
 * ---------------------------------------------------------------------------
 * Both are SELF-MEMOIZING GETTERS on unbash's internal `WordImpl` class
 * (`tests/unit/unbash-ast.test.ts` docstring, Plan 01): `Object.keys(word)`
 * reports only `["text", "pos", "end"]` even though `"value" in word` and
 * `"parts" in word` are both `true` from the start. A walker built purely on
 * `Object.keys()` silently never descends into a command substitution,
 * process substitution or expansion hidden inside a `Word` — exactly the gap
 * Plan 01 found and fixed in its own characterisation test. `walkableKeys()`
 * below reproduces that fix, not a fresh derivation of it.
 *
 * ---------------------------------------------------------------------------
 * WHY "COMMAND POSITION" INCLUDES A GUARDED VERB'S ARGUMENTS, NOT ONLY argv[0]
 * ---------------------------------------------------------------------------
 * The plan's own worked example is `g=push; git $g origin main`. Executed
 * against unbash: `Command.name` is the LITERAL word `"git"` (no parts at
 * all); the unresolved `SimpleExpansion` for `$g` sits in `suffix[0]` — the
 * git SUBCOMMAND position, not the executable-name word. A predicate that
 * only inspects `Command.name` would let this exact adversarial fixture
 * through. So the rule implemented here is: refuse an unresolved expansion in
 * `Command.name` unconditionally (a dynamic executable is inherently
 * unsafe), and ALSO refuse an unresolved expansion anywhere in a command's
 * `suffix[]` when `Command.name` resolves — literally, with no expansion of
 * its own — to one of the project's guarded verbs (`git`, `glab`,
 * `terraform`, `aws`, `kubectl`). `echo "$HOME"` is not a guarded verb, so
 * its argument expansion is correctly left alone (04-03-PLAN.md
 * `<behavior>`); `git $g origin main` is, so it is refused. This is a
 * deliberate, security-favouring reading of the plan's prose where the
 * literal AST disagreed with the prose's "command-name word" phrasing —
 * documented as a deviation in `04-03-SUMMARY.md` rather than silently
 * narrowed to argv[0] only.
 *
 * ---------------------------------------------------------------------------
 * WHY `git $((1+1))` IS NOT THE FIXTURE USED FOR THE ARITHMETIC-EXPANSION ROW
 * ---------------------------------------------------------------------------
 * Executed against unbash: `git $((1+1))` parses to `ArithmeticExpansion` /
 * `ArithmeticBinary` / `ArithmeticWord` — none of which is
 * `ArithmeticCommandExpansion`. The node type this module denies only appears
 * when a command substitution is nested INSIDE an arithmetic expansion, e.g.
 * `echo $(( $(echo 1) ))` (the exact fixture `tests/unit/unbash-ast.test.ts`
 * uses). `04-03-PLAN.md`'s `git $((1+1))` example does not itself produce the
 * node type it names; the test table below uses the nested form instead, per
 * CLAUDE.md's "verify at source, not docs" and this plan's own read_first
 * instruction to prefer the executed vocabulary over the prose when they
 * differ. Documented as a deviation in `04-03-SUMMARY.md`.
 *
 * ---------------------------------------------------------------------------
 * WHY THE `env`/`sudo` OPTION GRAMMARS ARE TABULATED, NOT GUESSED
 * ---------------------------------------------------------------------------
 * `04-RESEARCH.md` Pitfall 2's exact failure mode: `sudo -u root git push`
 * resolving to executable `root` because `-u`'s value argument was treated
 * as the executable. `ENV_VALUE_OPTIONS`/`SUDO_VALUE_OPTIONS` below name
 * every flag that consumes the NEXT word as its value (`-u`, `-C`, ...);
 * everything else recognised is boolean. Getting one flag's arity wrong
 * either fails to resolve the wrapper (stops too early) or over-consumes
 * past the real command (stops too late) — both are silent, not loud, which
 * is exactly why `tests/unit/shell-parse.test.ts` pins `-u` and `-C` with
 * dedicated regression fixtures rather than trusting the table by inspection.
 *
 * ---------------------------------------------------------------------------
 * WHY A SHELL RUNNER CARRYING A GUARDED VERB IS DENIED OUTRIGHT
 * ---------------------------------------------------------------------------
 * `sh -c "git push"` resolves its own executable to `sh`, which is not
 * itself a guarded verb — the guarded verb is hidden inside `sh`'s script
 * argument. Recursively re-parsing that argument as a second nested script
 * is effort `04-RESEARCH.md`'s Anti-Patterns section explicitly says this
 * phase does not need to spend, and the reference implementation
 * (`@ramtinj95/pi-infra-command-guard`, read but not installed per CLAUDE.md)
 * does not do it either. Instead: if the resolved executable is a member of
 * {@link SHELL_RUNNERS} AND the RAW segment text matches
 * {@link GUARDED_VERB_PATTERN}, deny outright (cause `"shell-runner"`) —
 * never route to approval, because SAFE-03's contract is fail-closed, not
 * fail-to-approval, for anything this guard cannot classify with confidence.
 * `sh -c "ls"` is NOT denied: it is a shell runner, but its segment text
 * contains no guarded verb.
 *
 * ---------------------------------------------------------------------------
 * PURITY (matches `.pi/extensions/diagnostics/redact.ts`'s contract)
 * ---------------------------------------------------------------------------
 * No `ctx`, no filesystem, no `child_process`, no default export (a
 * statement-position default export would make
 * `tests/unit/extension-layout.test.ts` reclassify this module as an entry
 * point that must sit at `index.ts` — see that file's own docstring). The
 * only import is `parse` and the AST types from `unbash`.
 *
 * BOUNDARY RULE (BOOT-10). This module registers nothing. It does not spell
 * the tool-registration call, in code or in prose —
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`.
 */
import { parse } from "unbash";
import type { Command, ParsedScript, Word } from "unbash";

// ---------------------------------------------------------------------------
// Node-type / operator vocabulary (SAFE-03)
// ---------------------------------------------------------------------------

/**
 * The exact runtime `.type` string literals unbash emits for command
 * substitution, process substitution and arithmetic command expansion —
 * verified by direct execution against unbash 4.0.10
 * (`tests/unit/unbash-ast.test.ts`). NOTE: these are the runtime `.type`
 * field values, not the TypeScript interface names in `dist/types.d.ts`
 * (`CommandExpansionPart` etc.) — the interface name is longer than the
 * value a recursive walk actually matches on.
 *
 * Iteration order is deliberate and used as refusal-cause priority when a
 * command trips more than one class at once (see {@link detectDeniedPartType}).
 */
export const DENIED_PART_TYPES = new Set(["CommandExpansion", "ProcessSubstitution", "ArithmeticCommandExpansion"]);

/** Redirect operators that write a heredoc/herestring body — refuse all three. */
export const HEREDOC_OPERATORS = new Set(["<<", "<<-", "<<<"]);

/** Word-part types that mark an UNRESOLVED shell expansion (not a literal value yet). */
const EXPANSION_PART_TYPES = new Set(["SimpleExpansion", "ParameterExpansion"]);

/**
 * Executables this project applies additional policy to. Matched with a word
 * boundary so `git` does not also match `digit`, `magit`, etc. Used for the
 * command-position expansion rule (module docstring) AND, unchanged, for the
 * shell-runner denial below — one pattern, one source of truth, per
 * `04-RESEARCH.md` Pattern 2.
 */
export const GUARDED_VERB_PATTERN = /\b(git|glab|terraform|aws|kubectl)\b/i;

/**
 * Shell/interpreter runners that can hide a guarded verb inside a script
 * argument (`sh -c "git push"`, `xargs git push`). Resolving to one of these
 * does not by itself deny — only combined with {@link GUARDED_VERB_PATTERN}
 * matching the raw segment text (see {@link findShellRunnerDenial}).
 */
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
	// `eval STRING` executes STRING as shell code in the CURRENT shell (no
	// subprocess) -- the same "hides a guarded verb inside a quoted argument"
	// shape as `sh -c "..."`, just without a fork. Found missing from this set
	// by Plan 11's evasion corpus (`eval "git push"` came back `allow`, proven
	// by direct execution against `evaluate()` before this fix landed) --
	// EV-08 in `tests/fixtures/evasion-corpus.ts`. Adding it here closes the
	// LITERAL case (`eval "git push"`); it does NOT close the
	// variable-indirection case (`CMD="git push"; eval "$CMD"`), where the
	// guarded verb text is absent from eval's own raw segment entirely -- that
	// residual gap is published in `docs/SAFETY.md` (EV-09), not silently
	// claimed as fixed by this line.
	"eval",
]);

/**
 * Every cause {@link canonicalise} can return, as a runtime-checkable list —
 * this is what `tests/unit/shell-deny-list.test.ts` and
 * `tests/unit/shell-parse.test.ts` iterate to prove every cause is reachable
 * by at least one fixture.
 */
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

// ---------------------------------------------------------------------------
// Wrapper-resolution vocabulary (SAFE-02) — tabulated, not derived, per
// `04-RESEARCH.md` Pitfall 2 (see module docstring).
// ---------------------------------------------------------------------------

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

/**
 * Bare pass-through wrappers: the wrapper name is consumed, then any
 * following words that LOOK like flags (start with `-`) are skipped
 * generically — none of these take a separate value argument in the forms
 * this project's fixtures exercise (`stdbuf -o0 git push` packs its value
 * into one token, so a generic flag-skip resolves it correctly without a
 * dedicated option table).
 */
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

// ---------------------------------------------------------------------------
// Verdict shape (mirrors the discriminated-verdict style of
// `.pi/extensions/providers/sso.ts`'s `SsoVerdict`)
// ---------------------------------------------------------------------------

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
	/**
	 * Directory the invocation actually targets, if resolvable: `git -C`/`--git-dir`
	 * takes precedence (it is the ONLY value a later `HEAD == main` oracle can
	 * trust), falling back to an `env -C`/`--chdir` wrapper directory when present.
	 */
	readonly cwdOverride?: string;
}

export type ShellVerdict =
	| { readonly kind: "refused"; readonly cause: ShellRefusalCause; readonly detail: string }
	| {
			readonly kind: "ok";
			readonly invocations: readonly CanonicalInvocation[];
			/**
			 * Every distinct `Redirect.operator` value found anywhere in the parsed
			 * script, in walk order.
			 *
			 * ADDITIVE, added by the CR-03 fix pass and read by
			 * `.pi/extensions/plan-mode/read-only.ts`. This module's own SAFE-03
			 * predicate refuses heredocs outright and is deliberately indifferent to
			 * ordinary output redirection — `git status > out.txt` is not a
			 * protected-branch push and this layer has no opinion on it. Plan mode
			 * DOES have an opinion, because it promises the model a read-only
			 * boundary and `foo > file` writes a file.
			 *
			 * Exposed here rather than re-walked there so there is exactly one AST
			 * walk in this repository and one notion of "every redirect in this
			 * command" — CLAUDE.md's rule is `unbash`, parse to AST, match resolved
			 * nodes, and a second walker is how two answers to the same question
			 * start to differ.
			 */
			readonly redirectOperators: readonly string[];
	  };

/**
 * CR-03: reduce `CanonicalInvocation.executable` to the verb `policy.ts`/
 * `infra.ts` actually classify on -- basename only, lower-cased, a Windows
 * executable extension stripped.
 *
 * `CanonicalInvocation.executable` is the literal argv[0] word after wrapper
 * resolution, never basename-reduced and never extension-stripped
 * (`extractInvocations` below just slices `values[resolved.index]` verbatim).
 * `policy.ts`'s git/glab gate and `infra.ts`'s aws/terraform/kubectl gate both
 * compared this against a bare lower-cased literal (`=== "git"`) -- exact
 * string equality, not a verb match. Executed against the real `evaluate()`:
 * `git.exe push`, `/usr/bin/git push`, `./git push`, `terraform.exe apply`,
 * `kubectl.exe delete pod x`, `aws.exe secretsmanager get-secret-value ...`
 * and `glab.exe mr merge` all came back `allow` -- and `git.exe` in
 * particular is not an adversarial spelling on this project's own target
 * platform, it is what Git for Windows installs. `SHELL_RUNNERS` does not
 * catch this either (`git.exe` is not a runner).
 *
 * Every caller that gates on a bare verb name (`policy.ts#evaluateInvocation`,
 * `infra.ts#classifyInfraInvocation`) MUST route through this function rather
 * than reading `invocation.executable` directly, so `git.exe` and `git`
 * classify identically everywhere this project cares which verb ran.
 */
export function normaliseExecutable(executable: string): string {
	const base = executable.replace(/\\/g, "/").split("/").pop() ?? executable;
	return base.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, "");
}

// ---------------------------------------------------------------------------
// Generic AST walking — mirrors `tests/unit/unbash-ast.test.ts`'s
// `walkableKeys()` / `collectNodeTypes()` shape so this module and its own
// characterisation test cannot silently drift onto two different notions of
// "every node in the tree".
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// The refusal predicate (SAFE-03)
// ---------------------------------------------------------------------------

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

/**
 * The whole SAFE-03 fail-closed decision, in priority order:
 * denied node type → heredoc → background → command-position expansion →
 * parse error (final catch-all — see module docstring for why it is last,
 * not first).
 */
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

// ---------------------------------------------------------------------------
// Wrapper resolution (SAFE-02)
// ---------------------------------------------------------------------------

interface ResolvedWrappers {
	readonly wrappers: string[];
	readonly cwdOverride: string | undefined;
	/** Index into `values[]` of the first word AFTER every recognised wrapper. */
	readonly index: number;
}

/**
 * Walk `values` (the command name followed by its suffix words, all
 * quote-resolved) consuming recognised wrapper executables and their option
 * grammars, stopping at the first word that is not itself a wrapper. That
 * word — `values[index]` — is the real executable.
 *
 * CR-10: each wrapper name is matched via {@link normaliseExecutable}, not a
 * bare `.toLowerCase()` — this module's own `normaliseExecutable` docstring
 * already says every caller that gates on a bare verb name MUST route
 * through it, and this function's three gates (`env`, `sudo`,
 * {@link PASSTHROUGH_WRAPPERS}) were the ones CR-08 missed inside `shell.ts`
 * itself. Executed before this fix: `/usr/bin/env git push`, `env.exe git
 * push`, `/usr/bin/sudo git push` and `/usr/bin/nohup git push` all came back
 * `allow` -- `/usr/bin/env` is the canonical POSIX spelling and `env.exe` is
 * the Git-for-Windows one, neither adversarial, and this module's own
 * docstring already names `env -i git push` and `sudo -u root git push`
 * (bare spellings only) as the shapes wrapper resolution exists to handle.
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
					// Unrecognised env flag: stop consuming rather than guess past it
					// (Pitfall 2's exact failure mode is over-consuming into the real
					// command). The unresolved word becomes the "executable" below,
					// which is a safe, inert failure -- never a silent bypass.
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

/**
 * `git -C <dir>` / `git --git-dir <dir>` / `git --git-dir=<dir>` — the ONLY cwd override a later `HEAD == main` oracle can trust.
 *
 * CR-08: routed through {@link normaliseExecutable}, not a bare
 * `.toLowerCase()` comparison -- this function's own module docstring already
 * says every bare-verb gate MUST do this, and this was the one caller inside
 * `shell.ts` itself that did not. Executed before this fix: `git.exe -C
 * /other/repo push` compared `"git.exe" !== "git"` and silently dropped its
 * `cwdOverride`, so the later `currentBranchFor` oracle was asked about the
 * WRONG repository (the invoking cwd, not the `-C` target).
 */
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

/**
 * One entry per `Command` node found anywhere in the parsed tree, wrapper
 * indirection resolved so policy evaluates the real executable.
 */
function extractInvocations(
	script: ParsedScript,
	command: string,
	commandNodes: readonly Command[],
): CanonicalInvocation[] {
	// `ParsedScript.source` is present only for backtick-decoded scripts, whose
	// positions index the DECODED string, not the caller's original source
	// (`dist/types.d.ts` docstring on `ParsedScript.source`). Slicing raw
	// segments must use whichever string the node's `pos`/`end` actually index.
	const sourceText = script.source ?? command;

	const invocations: CanonicalInvocation[] = [];
	for (const node of commandNodes) {
		if (node.name === undefined) {
			// Assignment-only statement (e.g. the `g=push` half of `g=push; git $g`)
			// — nothing executes here, so there is no invocation to canonicalise.
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

/**
 * Deny outright when a resolved invocation hands a guarded verb to a shell
 * runner as a script argument — see the module docstring's "shell runner"
 * section for why this is a substring check over raw text, not a recursive
 * re-parse.
 *
 * CR-08: `inv.executable` is routed through {@link normaliseExecutable}
 * before the `SHELL_RUNNERS` membership check, not a bare `.toLowerCase()`.
 * Executed before this fix: `bash.exe -c "git push"`, `/bin/sh -c "git
 * push"` and `/usr/bin/xargs git push` all came back `allow` -- `bash.exe`
 * and `/bin/sh` are ordinary Git-Bash-on-Windows/POSIX spellings, not
 * adversarial ones, and this module's own docstring already names `sh -c
 * "git push"` and `xargs git push` as the exact shapes this rule exists to
 * catch.
 */
function findShellRunnerDenial(invocations: readonly CanonicalInvocation[]): CanonicalInvocation | undefined {
	return invocations.find(
		(inv) => SHELL_RUNNERS.has(normaliseExecutable(inv.executable)) && GUARDED_VERB_PATTERN.test(inv.rawSegment),
	);
}

// ---------------------------------------------------------------------------
// The public entry point
// ---------------------------------------------------------------------------

/**
 * Parse `command` with `unbash`, fail closed on any of the node classes named
 * in {@link SHELL_REFUSAL_CAUSES}, and otherwise resolve wrapper indirection
 * to a canonical invocation per command segment (one per `Command` node found
 * anywhere in the parsed tree — `g=push; git $g` and `cd /tmp && git push`
 * each yield their own entries, never only the first).
 */
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
