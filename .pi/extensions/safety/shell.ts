/**
 * SAFE-03 — bash command parsing: the fail-closed node-type deny predicate.
 *
 * Task 2 of this plan (04-03) extends this file with wrapper resolution
 * (SAFE-02); this Task 1 version implements only {@link canonicalise}'s
 * refusal half plus a minimal, wrapper-unaware invocation extraction.
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
 * boundary so `git` does not also match `digit`, `magit`, etc. Used here for
 * the command-position expansion rule (see module docstring); Task 2 reuses
 * this same pattern, unchanged, for the shell-runner check — one pattern,
 * one source of truth, per `04-RESEARCH.md` Pattern 2. Not yet exported:
 * Task 1's acceptance criteria does not require it, and Task 2 exports it
 * alongside `SHELL_RUNNERS`.
 */
const GUARDED_VERB_PATTERN = /\b(git|glab|terraform|aws|kubectl)\b/i;

/**
 * Every cause {@link canonicalise} can return, as a runtime-checkable list —
 * this is what `tests/unit/shell-deny-list.test.ts` iterates to prove every
 * cause is reachable by at least one fixture. Task 2 appends `"shell-runner"`
 * once wrapper resolution can detect it.
 */
export const SHELL_REFUSAL_CAUSES = [
	"command-substitution",
	"process-substitution",
	"arithmetic-expansion",
	"heredoc",
	"background",
	"unresolved-expansion-in-command-position",
	"parse-error",
] as const;

export type ShellRefusalCause = (typeof SHELL_REFUSAL_CAUSES)[number];

const CAUSE_BY_DENIED_TYPE: Record<string, ShellRefusalCause> = {
	CommandExpansion: "command-substitution",
	ProcessSubstitution: "process-substitution",
	ArithmeticCommandExpansion: "arithmetic-expansion",
};

// ---------------------------------------------------------------------------
// Verdict shape (mirrors the discriminated-verdict style of
// `.pi/extensions/providers/sso.ts`'s `SsoVerdict`)
// ---------------------------------------------------------------------------

/**
 * One command's canonical form. In this Task 1 version, `wrappers` is always
 * `[]` and `cwdOverride` is always absent — Task 2 replaces the extraction
 * function this interface feeds with real wrapper resolution.
 */
export interface CanonicalInvocation {
	/** The executable word as unbash resolved it (quoting resolved; wrapper resolution is Task 2). */
	readonly executable: string;
	/** Arguments after the executable. Quote-resolved (`Word.value`), not raw text. */
	readonly args: readonly string[];
	/** Wrapper names encountered, in order. Always `[]` until Task 2. */
	readonly wrappers: readonly string[];
	/** The raw source slice for this one command segment — what a guarded-verb check tests against. */
	readonly rawSegment: string;
	/** Directory the invocation targets, if resolvable. Always absent until Task 2. */
	readonly cwdOverride?: string;
}

export type ShellVerdict =
	| { readonly kind: "refused"; readonly cause: ShellRefusalCause; readonly detail: string }
	| { readonly kind: "ok"; readonly invocations: readonly CanonicalInvocation[] };

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
		case "parse-error":
			return `"${command}" did not parse cleanly; this catch-all denies rather than falls through to allow`;
		default: {
			const exhaustive: never = cause;
			return exhaustive;
		}
	}
}

/**
 * Task 1's minimal invocation extraction: one entry per `Command` node found
 * anywhere in the parsed tree, executable/args taken directly from unbash's
 * quote-resolved `Word.value` with NO wrapper resolution. Task 2 replaces
 * this function's body with real `sudo`/`env`/`nohup`/`-C` handling.
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
		invocations.push({
			executable: node.name.value,
			args: node.suffix.map((w) => w.value),
			wrappers: [],
			rawSegment: sourceText.slice(node.pos, node.end),
		});
	}
	return invocations;
}

// ---------------------------------------------------------------------------
// The public entry point
// ---------------------------------------------------------------------------

/**
 * Parse `command` with `unbash`, fail closed on any of the node classes named
 * in {@link SHELL_REFUSAL_CAUSES}, and otherwise resolve one canonical
 * invocation per command segment found anywhere in the parsed tree.
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

	return { kind: "ok", invocations: extractInvocations(script, command, commandNodes) };
}
