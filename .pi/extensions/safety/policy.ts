/**
 * evaluate(toolName, input, facts): the single deny-by-default decision composing the shell, paths, git and infra classifiers.
 * Never reads ctx (a `hasUI && !ok` guard allows headless, pi 1.1.0 runner.js:132 noOpUIContext); the running verdict only moves toward block.
 * Pure: no ctx, process.env, node:fs or default export; the one impure fact (current branch) arrives via PolicyFacts.
 */
import type { CanonicalInvocation } from "./shell.ts";
import { canonicalise, foldDirectories, GIT_GLOBAL_VALUE_OPTIONS, normaliseExecutable } from "./shell.ts";
import type { PathPolicyFacts } from "./paths.ts";
import { canonicalisePathArg, classifyPathRead, classifyPathWrite, isSensitiveSearchRoot } from "./paths.ts";
import type { GitInvocation, GitPolicyFacts, GitVerdict } from "./git.ts";
import { classifyGitInvocation, classifyGlabInvocation } from "./git.ts";
import type { InfraVerdict } from "./infra.ts";
import { classifyInfraInvocation } from "./infra.ts";

/**
 * `confirm` goes through the approve-tool protocol; `ask` (a feature-branch push) is put to the human directly by the hook.
 * Both carry the requestKey a grant is keyed on; protected-branch writes and sensitive reads never ask because approval cannot undo them.
 */
export type Verdict =
	| { readonly kind: "allow" }
	| { readonly kind: "ask"; readonly reason: string; readonly requestKey: string; readonly prompt: string }
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
}

const VERDICT_RANK: Record<Verdict["kind"], number> = { allow: 0, ask: 1, confirm: 2, block: 3 };

/** b replaces a only when strictly stronger: a block is never downgraded. One grant cannot carry both an ask and a confirm, so together they block. */
function strongerOf(a: Verdict, b: Verdict): Verdict {
	const kinds = new Set([a.kind, b.kind]);
	if (kinds.has("ask") && kinds.has("confirm")) {
		return { kind: "block", reason: "a git push that needs confirmation is combined with a command that needs approval -- run them separately" };
	}
	if (a.kind === "ask" && b.kind === "ask") {
		return { kind: "block", reason: `two git pushes in one command cannot share one confirmation -- run them separately (${a.reason}; ${b.reason})` };
	}
	return VERDICT_RANK[b.kind] > VERDICT_RANK[a.kind] ? b : a;
}

type FieldExtraction = { readonly kind: "ok"; readonly value: string } | { readonly kind: "missing"; readonly reason: string };

function describeShape(value: unknown): string {
	if (value === null) return "null";
	return Array.isArray(value) ? "an array" : typeof value;
}

/** Missing, non-string and empty are one malformed shape; no classifier ever sees undefined or "". */
function extractStringField(input: unknown, field: string): FieldExtraction {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		return { kind: "missing", reason: `input is not an object (received ${describeShape(input)})` };
	}
	const value = (input as Record<string, unknown>)[field];
	if (typeof value !== "string") return { kind: "missing", reason: `"${field}" is missing or not a string (received ${describeShape(value)})` };
	if (value === "") return { kind: "missing", reason: `"${field}" is an empty string` };
	return { kind: "ok", value };
}

/** Key-sorted: JSON.stringify order is insertion order and not stable across equivalent objects. */
function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Pure function of (tool, command/path, cwd) so the hook and the wrapper derive the identical key independently; not a hash. */
function computeRequestKey(toolName: string, keyedInput: Readonly<Record<string, unknown>>, cwd: string): string {
	return `${toolName}::${stableStringify(keyedInput)}::${cwd}`;
}

const pathFactsOf = (facts: PolicyFacts): PathPolicyFacts => ({
	projectRoot: facts.projectRoot,
	home: facts.home,
	kubeconfigEnv: facts.kubeconfigEnv,
});

const canonicalOf = (text: string, facts: PolicyFacts): string =>
	canonicalisePathArg({ text, value: text }, { cwd: facts.cwd, home: facts.home });

function fromGitVerdict(verdict: GitVerdict, requestKey: string): Verdict {
	// No approval path for a git/glab block.
	// The resolved destination is part of the key, so a grant never covers a push that now resolves elsewhere.
	if (verdict.kind === "ask") return { kind: "ask", reason: verdict.reason, requestKey: `${requestKey}::${verdict.prompt}`, prompt: verdict.prompt };
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

/** Global options that point git at another repository or ref namespace than the cwd the guard reads config in. */
const GIT_REPO_REDIRECT_OPTIONS = /^--(git-dir|work-tree|namespace)(=|$)/;

/** Skips git's global options and their values, so the subcommand is the first positional word rather than "-C". */
function toGitInvocation(invocation: CanonicalInvocation): GitInvocation {
	const args = invocation.args;
	const configOverrides: string[] = [];
	let i = 0;
	while (i < args.length && args[i].startsWith("-")) {
		const flag = args[i];
		if (flag.startsWith("--config-env=")) {
			configOverrides.push(flag.slice("--config-env=".length));
			i += 1;
		} else if (GIT_GLOBAL_VALUE_OPTIONS.has(flag)) {
			if ((flag === "-c" || flag === "--config-env") && args[i + 1] !== undefined) configOverrides.push(args[i + 1]);
			i += 2;
		} else {
			// Unrecognised or boolean flag: skip only itself, never guessing an arity that over-consumes the subcommand.
			i += 1;
		}
	}
	return { subcommand: args[i] ?? "", args: args.slice(i + 1), configOverrides };
}

/** One invocation's strongest verdict across git/glab, infra and path classification; `sole` means it is the command's only invocation. */
function evaluateInvocation(invocation: CanonicalInvocation, facts: PolicyFacts, requestKey: string, sole: boolean): Verdict {
	let strongest: Verdict = { kind: "allow" };
	const executable = normaliseExecutable(invocation.executable);

	if (executable === "git") {
		const branchIn = (dir?: string): string => facts.currentBranchFor(foldDirectories([facts.cwd, dir ?? "."]) ?? facts.cwd);
		// A subshell's `cd` does not persist, so the session cwd counts too; an unreadable `cd` target counts as protected.
		const afterCd = invocation.afterCd === "unknown" ? [facts.protectedBranches[0] ?? ""] : invocation.afterCd === "known" ? [branchIn()] : [];
		const branches = [branchIn(invocation.cwdOverride), ...afterCd];
		const gitDir = foldDirectories([facts.cwd, invocation.cwdOverride ?? "."]) ?? facts.cwd;
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
		strongest = strongerOf(strongest, fromGitVerdict(classifyGitInvocation(toGitInvocation(invocation), gitFacts), requestKey));
	} else if (executable === "glab") {
		// glab needs protectedBranches for its mr create rule, not currentBranch.
		strongest = strongerOf(
			strongest,
			fromGitVerdict(classifyGlabInvocation(toGitInvocation(invocation), facts.protectedBranches), requestKey),
		);
	}

	strongest = strongerOf(strongest, fromInfraVerdict(classifyInfraInvocation(invocation), requestKey));

	const pathFacts = pathFactsOf(facts);
	// Bash args use classifyPathRead, not Write: write containment would block nearly every absolute path a command mentions.
	// Args are Word.value-resolved, so an unquoted Windows path through bash may mangle (docs/SAFETY.md known bypasses).
	for (const arg of invocation.args) {
		const pathVerdict = classifyPathRead(canonicalOf(arg, facts), pathFacts);
		if (pathVerdict.kind === "block") {
			strongest = strongerOf(strongest, { kind: "block", reason: pathVerdict.reason });
		}
	}

	return strongest;
}

/** canonicalise() refusal blocks first; then each invocation is classified and the strongest verdict wins, so one blocked segment blocks the whole command. */
function evaluateBash(input: unknown, facts: PolicyFacts): Verdict {
	const commandField = extractStringField(input, "command");
	if (commandField.kind === "missing") return { kind: "block", reason: `bash input is malformed: ${commandField.reason}` };
	const command = commandField.value;

	const shellVerdict = canonicalise(command);
	if (shellVerdict.kind === "refused") {
		return {
			kind: "block",
			reason: `shell.ts refused "${command}" (cause: ${shellVerdict.cause}): ${shellVerdict.detail}`,
		};
	}

	const requestKey = computeRequestKey("bash", { command }, facts.cwd);

	let strongest: Verdict = { kind: "allow" };
	for (const invocation of shellVerdict.invocations) {
		strongest = strongerOf(strongest, evaluateInvocation(invocation, facts, requestKey, shellVerdict.commandCount === 1));
	}
	return strongest;
}

function evaluateRead(input: unknown, facts: PolicyFacts): Verdict {
	const pathField = extractStringField(input, "path");
	if (pathField.kind === "missing") return { kind: "block", reason: `read input is malformed: ${pathField.reason}` };
	const verdict = classifyPathRead(canonicalOf(pathField.value, facts), pathFactsOf(facts));
	return verdict.kind === "block" ? { kind: "block", reason: verdict.reason } : { kind: "allow" };
}

/** Shared by write and edit: both take { path } and are governed by classifyPathWrite. */
function evaluateWrite(input: unknown, facts: PolicyFacts): Verdict {
	const pathField = extractStringField(input, "path");
	if (pathField.kind === "missing") return { kind: "block", reason: `write/edit input is malformed: ${pathField.reason}` };
	const verdict = classifyPathWrite(canonicalOf(pathField.value, facts), pathFactsOf(facts));
	return verdict.kind === "block" ? { kind: "block", reason: verdict.reason } : { kind: "allow" };
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
	if (isSensitiveSearchRoot(canonicalPath, pathFacts)) {
		return {
			kind: "block",
			reason: `"${canonicalPath}" is at or above a sensitive location -- a recursive search rooted here would expose its contents`,
		};
	}
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

/** grep returns file content, so only path and glob are checked; pattern is never inspected (the contract is which file is read). */
function evaluateGrep(input: unknown, facts: PolicyFacts): Verdict {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		return { kind: "block", reason: `grep input is malformed: input is not an object (received ${describeShape(input)})` };
	}
	const record = input as Record<string, unknown>;
	const pathVerdict = evaluateSearchRootField(extractOptionalStringField(record, "path"), facts, `grep "path"`);
	if (pathVerdict.kind === "block") return pathVerdict;
	return evaluateGlobField(extractOptionalStringField(record, "glob"), facts);
}

/** find/ls leak names, not contents; a path is evaluated as a search root like grep's (defense in depth). */
function evaluateFindOrLs(input: unknown, facts: PolicyFacts): Verdict {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		return { kind: "block", reason: `find/ls input is malformed: input is not an object (received ${describeShape(input)})` };
	}
	return evaluateSearchRootField(extractOptionalStringField(input as Record<string, unknown>, "path"), facts, `find/ls "path"`);
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
				return evaluateWrite(input, facts);
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
		return {
			kind: "block",
			reason: `policy evaluation threw for tool "${toolName}": ${
				err instanceof Error ? err.message : String(err)
			} -- deny by construction, never allow on an exception`,
		};
	}
}
