/**
 * evaluate(toolName, input, facts): the single deny-by-default decision composing the shell, paths, git and infra classifiers.
 * Never reads ctx (a `hasUI && !ok` guard allows headless, pi 1.1.0 runner.js:132 noOpUIContext); the running verdict only moves toward block.
 * Pure: no ctx, process.env, node:fs or default export; the one impure fact (current branch) arrives via PolicyFacts.
 */
import type { CanonicalInvocation } from "./shell.ts";
import { canonicalise, GIT_GLOBAL_VALUE_OPTIONS, normaliseExecutable, wrappedCommands, writeOperands } from "./shell.ts";
import type { PathPolicyFacts } from "./paths.ts";
import { canonicalisePathArg, classifyPathRead, classifyPathWrite, classifyReadGlob, isSensitiveSearchRoot } from "./paths.ts";
import type { PathVerdict } from "./paths.ts";
import type { GitInvocation, GitPolicyFacts, GitVerdict } from "./git.ts";
import { classifyGitInvocation, classifyGlabInvocation, isApplyDryRun, switchTarget } from "./git.ts";
import type { InfraVerdict } from "./infra.ts";
import { classifyInfraInvocation } from "./infra.ts";

/**
 * `confirm` goes through the approve-tool protocol; `ask` (a feature-branch push, an extension-code write) is put to the human
 * directly by the hook under `title`. Both carry the requestKey a grant is keyed on; protected-branch writes and sensitive reads
 * never ask because approval cannot undo them.
 */
export type Verdict =
	| { readonly kind: "allow" }
	| { readonly kind: "ask"; readonly reason: string; readonly requestKey: string; readonly prompt: string; readonly title: string }
	| { readonly kind: "confirm"; readonly reason: string; readonly requestKey: string }
	| { readonly kind: "block"; readonly reason: string };

/** Environmental facts evaluate() never derives itself; the caller assembles them once per tool call. */
export interface PolicyFacts {
	readonly cwd: string;
	readonly projectRoot: string;
	readonly home: string;
	/** Lazy: called only for an invocation whose executable is literally git. */
	readonly currentBranchFor: (cwd: string) => string;
	readonly protectedBranches: readonly string[];
	/** Destinations a push may never reach; defaults to `protectedBranches`. */
	readonly pushProtectedBranches?: readonly string[];
	/** Lazy `git config --get-all` in a directory; absent means config is unknown and config-derived push destinations block. */
	readonly gitConfigFor?: (cwd: string, key: string) => readonly string[];
	/** Lazy `git rev-parse --symbolic-full-name` to a local branch name in a directory; required with gitConfigFor. */
	readonly gitBranchFor?: (cwd: string, rev: string) => string | undefined;
	readonly kubeconfigEnv?: string;
	/** The OS temp directory, canonical; bash may write there and under `/tmp`. */
	readonly tempDir?: string;
}

const VERDICT_RANK: Record<Verdict["kind"], number> = { allow: 0, ask: 1, confirm: 2, block: 3 };

// b replaces a only when strictly stronger: a block is never downgraded. One grant cannot carry both an ask and a confirm, so together they block.
function strongerOf(a: Verdict, b: Verdict): Verdict {
	const kinds = new Set([a.kind, b.kind]);
	if (kinds.has("ask") && kinds.has("confirm")) {
		return { kind: "block", reason: "an action that needs confirmation is combined with a command that needs approval -- run them separately" };
	}
	if (a.kind === "ask" && b.kind === "ask") {
		return { kind: "block", reason: `two actions in one command cannot share one confirmation -- run them separately (${a.reason}; ${b.reason})` };
	}
	return VERDICT_RANK[b.kind] > VERDICT_RANK[a.kind] ? b : a;
}

type FieldExtraction = { readonly kind: "ok"; readonly value: string } | { readonly kind: "missing"; readonly reason: string };

function describeShape(value: unknown): string {
	if (value === null) return "null";
	return Array.isArray(value) ? "an array" : typeof value;
}

const asRecord = (input: unknown): Readonly<Record<string, unknown>> | undefined =>
	input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined;

const notAnObject = (input: unknown): string => `input is not an object (received ${describeShape(input)})`;

// Missing, non-string and empty are one malformed shape; no classifier ever sees undefined or "".
function extractStringField(input: unknown, field: string): FieldExtraction {
	const record = asRecord(input);
	if (record === undefined) return { kind: "missing", reason: notAnObject(input) };
	const value = record[field];
	if (typeof value !== "string") return { kind: "missing", reason: `"${field}" is missing or not a string (received ${describeShape(value)})` };
	if (value === "") return { kind: "missing", reason: `"${field}" is an empty string` };
	return { kind: "ok", value };
}

// Key-sorted: JSON.stringify order is insertion order and not stable across equivalent objects.
function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

// Pure function of (tool, command/path, cwd) so the hook and the wrapper derive the identical key independently; not a hash.
function computeRequestKey(toolName: string, keyedInput: Readonly<Record<string, unknown>>, cwd: string): string {
	return `${toolName}::${stableStringify(keyedInput)}::${cwd}`;
}

const pathFactsOf = (facts: PolicyFacts): PathPolicyFacts => ({
	projectRoot: facts.projectRoot,
	home: facts.home,
	kubeconfigEnv: facts.kubeconfigEnv,
});

// Write facts add `core.hooksPath`, read lazily because only a write needs it; an unreadable config adds nothing.
function writeFactsOf(facts: PolicyFacts): PathPolicyFacts {
	let values: readonly string[];
	try {
		values = facts.gitConfigFor?.(facts.cwd, "core.hooksPath") ?? [];
	} catch {
		values = [];
	}
	const hooksPaths = values.filter((v) => v !== "").map((v) => canonicalOf(v, facts, facts.projectRoot));
	return { ...pathFactsOf(facts), hooksPaths };
}

const canonicalOf = (text: string, facts: PolicyFacts, cwd = facts.cwd): string => canonicalisePathArg({ text, value: text }, { cwd, home: facts.home });

// The directory an invocation runs in: each `cd`/`env -C`/`git -C` target resolved against the one before, `~` expanded.
const invocationDir = (invocation: CanonicalInvocation, facts: PolicyFacts): string =>
	(invocation.cwdChain ?? []).reduce((dir, next) => canonicalOf(next, facts, dir), facts.cwd);

// Independent of the cwd: a drive or root path, `~`, or `$HOME`.
const CWD_INDEPENDENT = /^(([A-Za-z]:)?[/\\]|~([/\\]|$)|\$\{?HOME\}?([/\\]|$))/;

function fromGitVerdict(verdict: GitVerdict, requestKey: string): Verdict {
	// No approval path for a git/glab block.
	// The resolved destination is part of the key, so a grant never covers a push that now resolves elsewhere.
	if (verdict.kind === "ask") {
		return { kind: "ask", reason: verdict.reason, requestKey: `${requestKey}::${verdict.prompt}`, prompt: verdict.prompt, title: "Allow this git push?" };
	}
	return verdict.kind === "allow" ? { kind: "allow" } : { kind: "block", reason: verdict.reason };
}

function fromInfraVerdict(verdict: InfraVerdict, requestKey: string): Verdict {
	switch (verdict.kind) {
		case "not-applicable":
		case "allow":
			return { kind: "allow" };
		case "confirm":
			return { kind: "confirm", reason: verdict.reason, requestKey };
		case "sensitive-read":
			// Approving cannot un-expose a secret already in the model's context; not routed to approval.
			return { kind: "block", reason: verdict.reason };
		default: {
			// Exhaustiveness: a new InfraVerdict.kind without an arm is a compile error, not a fallthrough to allow.
			const exhaustive: never = verdict;
			return exhaustive;
		}
	}
}

// Global options that point git at another repository or ref namespace than the cwd the guard reads config in.
const GIT_REPO_REDIRECT_OPTIONS = /^--(git-dir|work-tree|namespace)(=|$)/;

const wordSet = (words: string): ReadonlySet<string> => new Set(words.split(" "));

// `-c` keys that only affect output formatting; every other override can make git run a program or move a push target.
const GIT_FORMATTING_CONFIG_KEYS = wordSet("core.quotepath color.ui");

// Global options that take no value and cannot change what runs.
const GIT_BOOLEAN_GLOBALS = wordSet(
	"--no-pager -P --paginate -p --bare --literal-pathspecs --glob-pathspecs --noglob-pathspecs --icase-pathspecs " +
		"--no-replace-objects --no-optional-locks --no-lazy-fetch",
);

// `NAME=value` words a git invocation may carry; any other GIT_* variable can redirect config, hooks or transport.
const GIT_ALLOWED_ASSIGNMENTS = wordSet("GIT_PAGER=cat GIT_TERMINAL_PROMPT=0");

/**
 * Splits git's global options from the subcommand. In strict mode an option outside the known sets marks the invocation
 * unparsed (it blocks on every branch); glab keeps the lenient skip because its flags are not git's.
 */
function toGitInvocation(invocation: CanonicalInvocation, strict = true): GitInvocation {
	const args = invocation.args;
	const configOverrides: string[] = [];
	let unparsed: string | undefined;
	let i = 0;
	while (i < args.length && args[i].startsWith("-")) {
		const flag = args[i];
		if (flag === "-c") {
			const setting = args[i + 1];
			const key = setting?.split("=")[0].toLowerCase();
			if (setting === undefined || key === undefined || !GIT_FORMATTING_CONFIG_KEYS.has(key)) {
				unparsed ??= `overrides git config with -c ${setting ?? ""}`.trim();
			}
			if (setting !== undefined) configOverrides.push(setting);
			i += 2;
		} else if (flag === "--config-env" || flag.startsWith("--config-env=")) {
			unparsed ??= "overrides git config with --config-env";
			configOverrides.push(flag.startsWith("--config-env=") ? flag.slice("--config-env=".length) : (args[i + 1] ?? ""));
			i += flag === "--config-env" ? 2 : 1;
		} else if (GIT_REPO_REDIRECT_OPTIONS.test(flag) && flag.includes("=")) {
			i += 1;
		} else if (GIT_GLOBAL_VALUE_OPTIONS.has(flag)) {
			i += 2;
		} else {
			if (strict && !GIT_BOOLEAN_GLOBALS.has(flag)) unparsed ??= `has the global option "${flag}", which this guard does not understand`;
			i += 1;
		}
	}
	return { subcommand: args[i] ?? "", args: args.slice(i + 1), configOverrides, ...(unparsed !== undefined ? { unparsed } : {}) };
}

// `git-push` and kin are the git subcommand run as its own executable; classify them as `git <x>`.
function asGitSubcommandInvocation(invocation: CanonicalInvocation): CanonicalInvocation | undefined {
	const match = /^git-(.+)$/.exec(normaliseExecutable(invocation.executable));
	return match === null ? undefined : { ...invocation, executable: "git", args: [match[1], ...invocation.args] };
}

const isRiskyGitWord = (w: string): boolean => /^GIT_\w*(=|$)/i.test(w) && !GIT_ALLOWED_ASSIGNMENTS.has(w);

const nonFormattingGitAssignment = (invocation: CanonicalInvocation): string | undefined => (invocation.assignmentWords ?? []).find(isRiskyGitWord);

const EXPORTING_BUILTINS = wordSet("export declare typeset readonly local");

// A `GIT_*` variable set or exported anywhere in a script that runs git reaches that git through the environment.
function scriptGitVariable(invocations: readonly CanonicalInvocation[], scriptAssignments: readonly string[]): string | undefined {
	const runsGit = invocations.some((inv) => /^git(-|$)/.test(normaliseExecutable(inv.executable)));
	if (!runsGit) return undefined;
	const exported = invocations.filter((inv) => EXPORTING_BUILTINS.has(normaliseExecutable(inv.executable))).flatMap((inv) => inv.args);
	return [...scriptAssignments, ...exported].find(isRiskyGitWord);
}

const GLOB_CHARS = /[*?[]/;
const LEADING_WILDCARD = /^[*?[{]/;

// The shell never matches a dotfile with a leading wildcard, so such a basename is judged by its directory part alone.
function classifyGlobArg(canonical: string, facts: PathPolicyFacts): PathVerdict {
	const slash = Math.max(canonical.lastIndexOf("/"), canonical.lastIndexOf("\\"));
	const base = canonical.slice(slash + 1);
	return LEADING_WILDCARD.test(base) ? classifyReadGlob(`${canonical.slice(0, slash + 1)}x`, facts) : classifyReadGlob(canonical, facts);
}

// The argument itself, plus the file it names when it is `@file` or `key=@file` (curl, jq and others read the file).
function fileOperandsOf(arg: string): string[] {
	const operands = [arg];
	if (arg.startsWith("@")) operands.push(arg.slice(1));
	const at = arg.indexOf("=@");
	if (at !== -1) operands.push(arg.slice(at + 2));
	return operands;
}

const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY|API_KEY|CREDENTIAL)/i;
const SECRET_EXPANSION = /\$\{?[A-Za-z0-9_]*(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY|API_KEY|CREDENTIAL)/i;

// Why an invocation prints the environment or a secret-named variable into the model's context, or undefined.
function environmentDump(invocation: CanonicalInvocation): string | undefined {
	const executable = normaliseExecutable(invocation.executable);
	const named = invocation.args.filter((a) => !a.startsWith("-"));
	if (executable === "" && invocation.wrappers.includes("env")) return "prints every environment variable";
	if (executable === "printenv" && (named.length === 0 || named.some((n) => SECRET_NAME.test(n)))) return "prints secret environment variables";
	if (executable === "set" && invocation.args.length === 0) return "prints every shell variable";
	if ((executable === "export" || executable === "declare" || executable === "typeset") && named.length === 0) return "prints exported variables";
	const printer = executable === "echo" || executable === "printf";
	return printer && invocation.args.some((a) => SECRET_EXPANSION.test(a)) ? "prints a secret-named variable" : undefined;
}

// `sole`: the command's only invocation; `switched`: an earlier checkout, switch or worktree add may have put HEAD on a protected branch.
function evaluateInvocation(rawInvocation: CanonicalInvocation, facts: PolicyFacts, requestKey: string, sole: boolean, switched = false): Verdict {
	let strongest: Verdict = { kind: "allow" };
	const invocation = asGitSubcommandInvocation(rawInvocation) ?? rawInvocation;
	const executable = normaliseExecutable(invocation.executable);

	if (executable === "git") {
		const envWord = nonFormattingGitAssignment(invocation);
		if (envWord !== undefined) {
			return { kind: "block", reason: `"${envWord.split("=")[0]}" in the environment of a git command can make git run a program or use other config` };
		}
		const gitDir = invocationDir(invocation, facts);
		// A subshell's `cd` does not persist, so the session cwd counts too; an unreadable `cd` target counts as protected.
		const afterCd =
			invocation.afterCd === "unknown" ? [facts.protectedBranches[0] ?? ""] : invocation.afterCd === "known" ? [facts.currentBranchFor(facts.cwd)] : [];
		const branches = [facts.currentBranchFor(gitDir), ...afterCd, ...(switched ? [facts.protectedBranches[0] ?? ""] : [])];
		const { gitConfigFor, gitBranchFor } = facts;
		const gitFacts: GitPolicyFacts = {
			currentBranch: branches.find((b) => facts.protectedBranches.includes(b)) ?? branches[0],
			protectedBranches: facts.protectedBranches,
			pushProtectedBranches: facts.pushProtectedBranches,
			...(gitConfigFor !== undefined ? { readConfig: (key: string) => gitConfigFor(gitDir, key) } : {}),
			...(gitBranchFor !== undefined ? { resolveBranch: (rev: string) => gitBranchFor(gitDir, rev) } : {}),
			configTrusted:
				sole &&
				invocation.wrappers.length === 0 &&
				invocation.assignments !== true &&
				invocation.afterCd === undefined &&
				!invocation.args.some((a) => GIT_REPO_REDIRECT_OPTIONS.test(a)),
		};
		const parsed = toGitInvocation(invocation);
		strongest = strongerOf(strongest, fromGitVerdict(classifyGitInvocation(parsed, gitFacts), requestKey));
		if (gitPathWrites(parsed) === "unnamed") {
			strongest = strongerOf(strongest, { kind: "confirm", reason: `"${invocation.rawSegment}" rewrites files a patch names, which the guard cannot see`, requestKey });
		}
	} else if (executable === "glab") {
		// glab needs protectedBranches for its mr create rule, not currentBranch.
		strongest = strongerOf(
			strongest,
			fromGitVerdict(classifyGlabInvocation(toGitInvocation(invocation, false), facts.protectedBranches), requestKey),
		);
	}

	for (const wrapped of wrappedCommands(invocation) ?? []) {
		const inner: CanonicalInvocation = { ...invocation, executable: wrapped.executable, args: wrapped.args, redirectReads: undefined, redirectWrites: undefined };
		strongest = strongerOf(strongest, evaluateInvocation(inner, facts, requestKey, false, switched));
		// The input names land on `{}`, or are appended; a write operand carrying the placeholder is a file the guard cannot name.
		const pasted = wrapped.args.some((a) => a.includes("{}"));
		const probe = pasted ? wrapped.args.map((a) => a.replaceAll("{}", INPUT_NAME)) : [...wrapped.args, INPUT_NAME, INPUT_NAME];
		if (writeOperands({ executable: wrapped.executable, args: probe }).some((o) => o.includes(INPUT_NAME))) {
			strongest = strongerOf(strongest, { kind: "confirm", reason: `"${invocation.rawSegment}" writes or deletes files named by its input, which the guard cannot see`, requestKey });
		}
	}
	strongest = strongerOf(strongest, fromInfraVerdict(classifyInfraInvocation(invocation), requestKey));
	const dump = environmentDump(invocation);
	if (dump !== undefined) return { kind: "block", reason: `"${invocation.rawSegment}" ${dump}; approving cannot take a secret back out of the context` };

	return strongerOf(strongest, classifyInvocationPaths(invocation, executable, facts, requestKey));
}

const sensitiveRootReason = (canonicalPath: string): string =>
	`"${canonicalPath}" is at or above a sensitive location -- a recursive search rooted here would expose its contents`;

const GREP_RECURSIVE = /^(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive|--dereference-recursive|--directories=recurse)$/;

interface Walker {
	readonly when: RegExp | true;
	readonly implicitDot: boolean;
	readonly pattern?: true;
}

const walkers = (names: readonly string[], walker: Walker): [string, Walker][] => names.map((n) => [n, walker]);

// Executables that walk a directory tree, with the flag that makes them recurse (`true`: always) and whether they default to `.`.
const RECURSIVE_WALKERS = new Map<string, Walker>([
	...walkers(["rg", "ag"], { when: true, implicitDot: true, pattern: true }),
	...walkers(["find", "fd"], { when: true, implicitDot: true }),
	...walkers(["grep", "egrep", "fgrep"], { when: GREP_RECURSIVE, implicitDot: true, pattern: true }),
	...walkers(["ls"], { when: /^(-[a-zA-Z]*R[a-zA-Z]*|--recursive)$/, implicitDot: true }),
	...walkers(["cp"], { when: /^(-[a-zA-Z]*[rRa][a-zA-Z]*|--recursive|--archive)$/, implicitDot: false }),
	...walkers(["rsync"], { when: /^(-[a-zA-Z]*[ra][a-zA-Z]*|--recursive|--archive)$/, implicitDot: false }),
	...walkers(["zip"], { when: /^(-[a-zA-Z]*r[a-zA-Z]*|--recurse-paths)$/, implicitDot: false }),
	...walkers(["tar"], { when: true, implicitDot: false }),
]);

// The directories a recursive walker descends from; a pattern-first search with no path operand walks `.`.
function recursiveRoots(executable: string, args: readonly string[]): string[] {
	const walker = RECURSIVE_WALKERS.get(executable);
	const when = walker?.when;
	if (walker === undefined || (when instanceof RegExp && !args.some((a) => when.test(a)))) return [];
	const positionals = args.filter((a) => !a.startsWith("-"));
	const explicitPattern = args.some((a) => /^(-e|-f|--regexp|--file)(=|$)/.test(a));
	const paths = walker.pattern === true && !explicitPattern ? positionals.slice(1) : positionals;
	return paths.length === 0 && walker.implicitDot ? ["."] : paths;
}

const PATTERN_FIRST = new Set(["grep", "egrep", "fgrep", "rg", "ag", "sed", "awk"]);

// Indexes of a search tool's pattern operands, which are text, not paths: each `-e` value, else the first positional. A `-f` file is still a path.
function patternOperands(executable: string, args: readonly string[]): Set<number> {
	if (!PATTERN_FIRST.has(executable)) return new Set();
	const flagged = args.flatMap((a, i) => (a === "-e" || a === "--regexp" || a === "--expression" ? [i + 1] : []));
	if (flagged.length > 0 || args.some((a) => /^(-f|--file)(=|$)/.test(a))) return new Set(flagged);
	const at = args.findIndex((a) => !a.startsWith("-"));
	return new Set(at === -1 ? [] : [at]);
}

const INPUT_NAME = "\u0000input";

const WRITE_ONLY_DESTINATIONS = new Set(["cp", "mv", "install", "ln", "tee", "touch"]);

const PATH_SHAPED = /[./\\*?[~]/;
const SECRET_BARE_NAME = /^(id_\w+|credentials|config|known_hosts|authorized_keys|environ|netrc|npmrc)$/i;

// Every path an invocation names, read-classified in the session cwd and in the directory its `cd`s lead to (a subshell `cd` does not persist).
function classifyInvocationPaths(invocation: CanonicalInvocation, executable: string, facts: PolicyFacts, requestKey: string): Verdict {
	const patterns = patternOperands(executable, invocation.args);
	if (invocation.afterCd === "unknown" && executable !== "git" && executable !== "glab") {
		// A bare word is a path only when it names a credentials file; `npm test` stays allowed.
		const named = invocation.args.filter((a, i) => !a.startsWith("-") && !patterns.has(i)).flatMap(fileOperandsOf);
		const io = [...(invocation.redirectReads ?? []), ...(invocation.redirectWrites ?? []), ...writeOperands(invocation), ...recursiveRoots(executable, invocation.args)];
		const paths = [...named.filter((a) => PATH_SHAPED.test(a) || SECRET_BARE_NAME.test(a)), ...io];
		if (paths.some((a) => !CWD_INDEPENDENT.test(a))) {
			return { kind: "block", reason: `"${invocation.rawSegment}" names a relative path after a cd/pushd/popd whose target is not a literal directory -- use an absolute path` };
		}
	}
	const pathFacts = pathFactsOf(facts);
	const dir = invocationDir(invocation, facts);
	const dirs = dir === facts.cwd ? [facts.cwd] : [facts.cwd, dir];
	// A destination these commands only write (`cp .env.example .env`) exposes nothing; it is write-classified below.
	const destinations = new Set(WRITE_ONLY_DESTINATIONS.has(executable) ? writeOperands(invocation) : []);
	const operands = invocation.args.filter((a, i) => !patterns.has(i) && !destinations.has(a));
	// git reads `<rev>:<path>` from the object store, so the part after the colon is a path too.
	const revisionPaths = executable === "git" ? operands.filter((a) => /^[^-:][^:]*:|^:/.test(a) && !a.includes("://")).map((a) => a.slice(a.indexOf(":") + 1)) : [];
	const reads = [...operands.flatMap(fileOperandsOf), ...revisionPaths, ...(invocation.redirectReads ?? [])];
	// git arguments are revisions as often as paths, and `HEAD~1` has the 8.3 shape; protected-name aliases still block.
	const ignore = executable === "git" ? ["short-name-alias"] : [];
	// Args are Word.value-resolved, so an unquoted Windows path through bash may mangle (docs/SAFETY.md known bypasses).
	for (const cwd of dirs) {
		for (const candidate of reads) {
			const canonical = canonicalOf(candidate, facts, cwd);
			const pathVerdict = classifyPathRead(canonical, pathFacts, ignore);
			const globVerdict = GLOB_CHARS.test(candidate) && !candidate.startsWith("-") ? classifyGlobArg(canonical, pathFacts) : pathVerdict;
			const blocked = [pathVerdict, globVerdict].find((v) => v.kind === "block");
			if (blocked?.kind === "block") return { kind: "block", reason: blocked.reason };
		}
		for (const root of recursiveRoots(executable, invocation.args)) {
			const canonical = canonicalOf(root, facts, cwd);
			if (isSensitiveSearchRoot(canonical, pathFacts)) return { kind: "block", reason: sensitiveRootReason(canonical) };
		}
	}
	const gitWrites = executable === "git" ? gitPathWrites(toGitInvocation(invocation)) : [];
	const writes = [...writeOperands(invocation), ...(Array.isArray(gitWrites) ? gitWrites : []), ...(invocation.redirectWrites ?? [])];
	return classifyShellWrites(writes, dirs, facts, requestKey);
}

const GIT_PATH_VALUE_OPTIONS = new Set(["-s", "--source", "-b", "-B", "--orphan", "-m", "--conflict"]);

// Working-tree paths a git subcommand rewrites, or `"unnamed"` when a patch or a pathspec file names them instead.
function gitPathWrites(git: GitInvocation): string[] | "unnamed" {
	const { subcommand, args } = git;
	if (subcommand === "am" || (subcommand === "apply" && !isApplyDryRun(args))) return "unnamed";
	if (!["checkout", "restore", "rm", "mv"].includes(subcommand)) return [];
	if (args.some((a) => a.startsWith("--pathspec-from-file"))) return "unnamed";
	const dashes = args.indexOf("--");
	const named = dashes === -1 ? args : args.slice(0, dashes);
	return [...named.filter((a, i) => !a.startsWith("-") && !GIT_PATH_VALUE_OPTIONS.has(named[i - 1] ?? "")), ...(dashes === -1 ? [] : args.slice(dashes + 1))];
}

const DEVICE_FILE = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/i;

const EXTENSION_CODE_TITLE = "Allow this change to extension code?";

// An extension-code write asks; the canonical paths are the prompt and part of the key, so a grant covers only these files.
function askForPaths(reasons: readonly string[], paths: readonly string[], requestKey: string): Verdict {
	if (paths.length === 0) return { kind: "allow" };
	const prompt = `Path: ${[...new Set(paths)].join(", ")}`;
	return { kind: "ask", reason: reasons.join("; "), requestKey: `${requestKey}::${prompt}`, prompt, title: EXTENSION_CODE_TITLE };
}

// Bash writes go through the write tool's classifier in every candidate directory; device files, `/tmp` and the temp dir are scratch.
function classifyShellWrites(targets: readonly string[], dirs: Iterable<string>, facts: PolicyFacts, requestKey: string): Verdict {
	const scratch = ["/tmp", ...(facts.tempDir !== undefined ? [facts.tempDir] : [])];
	const askReasons: string[] = [];
	const askPaths: string[] = [];
	const writeFacts = targets.length > 0 ? writeFactsOf(facts) : pathFactsOf(facts);
	for (const cwd of dirs) {
		for (const target of targets) {
			const canonical = canonicalOf(target, facts, cwd);
			if (DEVICE_FILE.test(canonical)) continue;
			const verdict = classifyPathWrite(canonical, writeFacts, scratch);
			if (verdict.kind === "block") return { kind: "block", reason: `bash write: ${verdict.reason}` };
			if (verdict.kind === "ask") {
				askReasons.push(verdict.reason);
				askPaths.push(canonical);
			}
		}
	}
	return askForPaths(askReasons, askPaths, requestKey);
}

// canonicalise() refusal blocks first; then each invocation is classified and the strongest verdict wins, so one blocked segment blocks the whole command.
function evaluateBash(input: unknown, facts: PolicyFacts): Verdict {
	const commandField = extractStringField(input, "command");
	if (commandField.kind === "missing") return { kind: "block", reason: `bash input is malformed: ${commandField.reason}` };
	const command = commandField.value;

	const shellVerdict = canonicalise(command);
	if (shellVerdict.kind === "refused") {
		return { kind: "block", reason: `shell.ts refused "${command}" (cause: ${shellVerdict.cause}): ${shellVerdict.detail}` };
	}

	const requestKey = computeRequestKey("bash", { command }, facts.cwd);
	const gitVariable = scriptGitVariable(shellVerdict.invocations, shellVerdict.scriptAssignments);
	if (gitVariable !== undefined) {
		return { kind: "block", reason: `"${gitVariable.split("=")[0]}" is set in a script that runs git, which can make git run a program or use another repository` };
	}

	let strongest: Verdict = { kind: "allow" };
	let switched = false;
	for (const invocation of shellVerdict.invocations) {
		strongest = strongerOf(strongest, evaluateInvocation(invocation, facts, requestKey, shellVerdict.commandCount === 1, switched));
		// HEAD is read once, before the command runs, so a later write after a switch onto a protected branch counts as on it.
		const git = asGitSubcommandInvocation(invocation) ?? invocation;
		if (normaliseExecutable(git.executable) === "git") {
			const parsed = toGitInvocation(git);
			const target = switchTarget(parsed.subcommand, parsed.args);
			switched ||= target === "-" || (target !== undefined && facts.protectedBranches.some((b) => b.toLowerCase() === target.toLowerCase()));
		}
	}
	// A compound statement's redirect may run in any directory its commands reach.
	const dirs = new Set([facts.cwd, ...shellVerdict.invocations.map((inv) => invocationDir(inv, facts))]);
	strongest = strongerOf(strongest, classifyShellWrites(shellVerdict.redirectWriteTargets, dirs, facts, requestKey));
	for (const cwd of dirs) {
		for (const target of shellVerdict.redirectReadTargets) {
			const verdict = classifyPathRead(canonicalOf(target, facts, cwd), pathFactsOf(facts));
			if (verdict.kind === "block") strongest = strongerOf(strongest, { kind: "block", reason: `input redirect: ${verdict.reason}` });
		}
	}
	return strongest;
}

function evaluateRead(input: unknown, facts: PolicyFacts): Verdict {
	const pathField = extractStringField(input, "path");
	if (pathField.kind === "missing") return { kind: "block", reason: `read input is malformed: ${pathField.reason}` };
	const verdict = classifyPathRead(canonicalOf(pathField.value, facts), pathFactsOf(facts));
	return verdict.kind === "block" ? { kind: "block", reason: verdict.reason } : { kind: "allow" };
}

// Shared by write and edit: both take { path } and are governed by classifyPathWrite.
function evaluateWrite(toolName: string, input: unknown, facts: PolicyFacts): Verdict {
	const pathField = extractStringField(input, "path");
	if (pathField.kind === "missing") return { kind: "block", reason: `write/edit input is malformed: ${pathField.reason}` };
	const canonical = canonicalOf(pathField.value, facts);
	const verdict = classifyPathWrite(canonical, writeFactsOf(facts));
	if (verdict.kind === "block") return { kind: "block", reason: verdict.reason };
	return verdict.kind === "ask" ? askForPaths([verdict.reason], [canonical], computeRequestKey(toolName, { path: pathField.value }, facts.cwd)) : { kind: "allow" };
}

type OptionalFieldExtraction =
	| { readonly kind: "absent" }
	| { readonly kind: "ok"; readonly value: string }
	| { readonly kind: "malformed"; readonly reason: string };

/**
 * Optional path-shaped field (path on grep/find/ls, glob on grep): absent or empty means the tool default applies;
 * a non-string value is malformed and denied, never silently ignored.
 */
function extractOptionalStringField(input: Readonly<Record<string, unknown>>, field: string): OptionalFieldExtraction {
	const value = input[field];
	if (value === undefined || value === "") return { kind: "absent" };
	if (typeof value !== "string") return { kind: "malformed", reason: `"${field}" is present but not a string (received ${describeShape(value)})` };
	return { kind: "ok", value };
}

/**
 * grep/find/ls "path" is a recursive search root: checks the sensitive-read file table and isSensitiveSearchRoot
 * (a directory such as ~/.aws never matches a file pattern). An absent path is evaluated as projectRoot (already canonical)
 * with no exemption when the session is rooted at $HOME, where the default search would walk ~/.aws and ~/.ssh.
 */
function evaluateSearchRootField(extraction: OptionalFieldExtraction, facts: PolicyFacts, fieldLabel: string): Verdict {
	if (extraction.kind === "malformed") return { kind: "block", reason: `${fieldLabel} is malformed: ${extraction.reason}` };
	const canonicalPath = extraction.kind === "ok" ? canonicalOf(extraction.value, facts) : facts.projectRoot;
	const pathFacts = pathFactsOf(facts);
	const fileVerdict = classifyPathRead(canonicalPath, pathFacts);
	if (fileVerdict.kind === "block") return { kind: "block", reason: fileVerdict.reason };
	if (isSensitiveSearchRoot(canonicalPath, pathFacts)) return { kind: "block", reason: sensitiveRootReason(canonicalPath) };
	return { kind: "allow" };
}

/**
 * grep "glob": checked against the sensitive-read table via its basename; deliberately not search-root-aware.
 * Wildcard shapes such as ".env*" are a published residual gap (docs/SAFETY.md known bypasses).
 */
function evaluateGlobField(extraction: OptionalFieldExtraction, facts: PolicyFacts): Verdict {
	if (extraction.kind === "malformed") return { kind: "block", reason: `grep "glob" is malformed: ${extraction.reason}` };
	if (extraction.kind === "absent") return { kind: "allow" };
	const verdict = classifyPathRead(canonicalOf(extraction.value, facts), pathFactsOf(facts));
	return verdict.kind === "block" ? { kind: "block", reason: `grep glob refers to a sensitive file: ${verdict.reason}` } : { kind: "allow" };
}

// grep returns file content, so only path and glob are checked; pattern is never inspected (the contract is which file is read).
function evaluateGrep(input: unknown, facts: PolicyFacts): Verdict {
	const record = asRecord(input);
	if (record === undefined) return { kind: "block", reason: `grep input is malformed: ${notAnObject(input)}` };
	const pathVerdict = evaluateSearchRootField(extractOptionalStringField(record, "path"), facts, `grep "path"`);
	if (pathVerdict.kind === "block") return pathVerdict;
	return evaluateGlobField(extractOptionalStringField(record, "glob"), facts);
}

// find/ls leak names, not contents; a path is evaluated as a search root like grep's (defense in depth).
function evaluateFindOrLs(input: unknown, facts: PolicyFacts): Verdict {
	const record = asRecord(input);
	if (record === undefined) return { kind: "block", reason: `find/ls input is malformed: ${notAnObject(input)}` };
	return evaluateSearchRootField(extractOptionalStringField(record, "path"), facts, `find/ls "path"`);
}

/** The whole decision for one tool call; an unrecognised tool NAME (not input shape) is the one case it allows. */
export function evaluate(toolName: string, input: unknown, facts: PolicyFacts): Verdict {
	try {
		switch (toolName) {
			case "bash":
				return evaluateBash(input, facts);
			case "read":
				return evaluateRead(input, facts);
			case "write":
			case "edit":
				return evaluateWrite(toolName, input, facts);
			case "grep":
				return evaluateGrep(input, facts);
			case "find":
			case "ls":
				return evaluateFindOrLs(input, facts);
			default:
				// Governs exactly Pi's seven built-ins; other tools (e.g. an extension tool that shells out) are a published gap (docs/SAFETY.md).
				return { kind: "allow" };
		}
	} catch (err) {
		// A classifier throwing becomes a block, never an exception a caller could read as "nothing to block".
		const message = err instanceof Error ? err.message : String(err);
		return { kind: "block", reason: `policy evaluation threw for tool "${toolName}": ${message} -- deny by construction, never allow on an exception` };
	}
}
