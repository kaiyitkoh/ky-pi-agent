/**
 * git and glab decision layer: two separate questions, deny only when both hold.
 *
 * - Is `HEAD` currently a protected branch? Answered by {@link currentBranch}, the only impure
 *   function here. Asking "does the command mention `main`" instead would block
 *   `git worktree add -b feat main`, `git fetch origin main`, `git diff main`.
 * - Is this subcommand a WRITE given its args? A pure table of per-subcommand predicates
 *   (`{ subcommand, matches(args), why }`); `rebase` and `apply` appear in both tables with
 *   complementary predicates. `push` is always a write: the refspec target cannot be trusted
 *   from argv and resolving it would need a second git invocation.
 *
 * With `HEAD` protected: a matching write entry blocks; else a matching read entry allows; else a
 * subcommand in either table with no matching shape (`git stash pop`) or an unknown one blocks
 * (fail closed). Fix a false positive by adding a fixture-backed row, never by widening a predicate.
 *
 * `glab mr merge` blocks on every branch: an MR merge is the deploy trigger on GitLab's server,
 * regardless of local `HEAD`. `mr create` is a conditional allow only with one explicit,
 * non-protected `--target-branch`/`-b` given first (GitLab defaults an omitted target to the protected default
 * branch, so silence is the trigger). The blocked table is consulted first so `create` can never
 * admit a `merge`.
 *
 * `currentBranch` runs `git symbolic-ref --short HEAD` with `shell: false`. A non-zero exit returns
 * {@link DETACHED_HEAD}, a named sentinel never equal to a protected name, not `undefined`, which a
 * caller's `=== "main"` would read as falsy and fail open. Callers resolve the cwd first:
 * `CanonicalInvocation.cwdOverride` (`git -C`) beats `ctx.cwd`, so `git -C /other/repo push`
 * evaluates that repo's HEAD.
 *
 * Registers nothing and never spells the tool-registration call (contributing-boundary.test.ts
 * matches it as a substring).
 */
import { spawnSync } from "node:child_process";


/** `currentBranch` result for a detached HEAD or any `git symbolic-ref` failure; never a real branch name, so never protected. */
export const DETACHED_HEAD = "(detached HEAD)";

/** The branch checked out at `cwd`, via `git symbolic-ref --short HEAD` (never parsed from `git status` text). */
export function currentBranch(cwd: string): string {
	const result = spawnSync("git", ["symbolic-ref", "--short", "HEAD"], {
		cwd,
		encoding: "utf-8",
		shell: false,
		windowsHide: true,
	});
	if (result.error) {
		throw new Error(`git symbolic-ref --short HEAD failed to launch in "${cwd}": ${result.error.message}`);
	}
	if (result.status === 0) {
		return (result.stdout ?? "").trim();
	}
	return DETACHED_HEAD;
}

/**
 * The HEAD commit SHA at `cwd`. THROWS on failure with no sentinel: an unknown SHA must never
 * compare equal to recorded evidence, so callers wrap it and refuse (fail closed).
 */
export function currentSha(cwd: string): string {
	const result = spawnSync("git", ["rev-parse", "HEAD"], {
		cwd,
		encoding: "utf-8",
		shell: false,
		windowsHide: true,
	});
	if (result.error) {
		throw new Error(`git rev-parse HEAD failed to launch in "${cwd}": ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(
			`git rev-parse HEAD failed in "${cwd}" (exit ${result.status}) -- no sentinel exists for an ` +
				"unknown SHA, because an unknown SHA can never legitimately match a piece of evidence",
		);
	}
	return (result.stdout ?? "").trim();
}

/** The tree id of `HEAD`, telling an empty commit (new SHA, same tree) from real movement. Same THROWS contract as {@link currentSha}. */
export function currentTree(cwd: string): string {
	const result = spawnSync("git", ["rev-parse", "HEAD^{tree}"], {
		cwd,
		encoding: "utf-8",
		shell: false,
		windowsHide: true,
	});
	if (result.error) {
		throw new Error(`git rev-parse HEAD^{tree} failed to launch in "${cwd}": ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(
			`git rev-parse HEAD^{tree} failed in "${cwd}" (exit ${result.status}) -- no sentinel exists for an ` +
				"unknown tree, because an unknown tree can never legitimately match a piece of evidence",
		);
	}
	return (result.stdout ?? "").trim();
}


/** One git/glab invocation split into subcommand and args; `shell.ts` does the string parsing. */
export interface GitInvocation {
	readonly subcommand: string;
	readonly args: readonly string[];
}

export interface GitPolicyFacts {
	readonly currentBranch: string;
	readonly protectedBranches: readonly string[];
}

export type GitVerdict = { readonly kind: "allow" } | { readonly kind: "block"; readonly reason: string };

interface GitSubcommandRule {
	readonly subcommand: string;
	readonly matches: (args: readonly string[]) => boolean;
	readonly why: string;
}

function hasPositionalArg(args: readonly string[]): boolean {
	return args.some((a) => !a.startsWith("-"));
}

/** Subcommands that WRITE to the checked-out branch for at least some argument shapes. */
export const GIT_WRITE_SUBCOMMANDS: readonly GitSubcommandRule[] = [
	{
		subcommand: "push",
		matches: () => true,
		why: "a write regardless of refspec -- the refspec target cannot be trusted from argv alone",
	},
	{ subcommand: "commit", matches: () => true, why: "unconditional write to the checked-out branch" },
	{ subcommand: "reset", matches: () => true, why: "moves the checked-out branch's tip" },
	{ subcommand: "merge", matches: () => true, why: "merges into the checked-out branch" },
	{ subcommand: "cherry-pick", matches: () => true, why: "writes a new commit onto the checked-out branch" },
	{ subcommand: "revert", matches: () => true, why: "writes a new commit onto the checked-out branch" },
	{ subcommand: "am", matches: () => true, why: "applies patches as commits onto the checked-out branch" },
	{
		subcommand: "apply",
		matches: (args) => !args.includes("--check") && !args.includes("--stat") && !args.includes("--numstat"),
		why: "writes the tree unless --check/--stat/--numstat makes it a dry run",
	},
	{
		subcommand: "rebase",
		matches: (args) => !hasPositionalArg(args),
		why: "bare rebase rewrites the checked-out branch's history against its upstream",
	},
];

/** Subcommands safe even when `HEAD` is protected; each needs a named allow row in git-policy.test.ts. */
export const GIT_READ_SUBCOMMANDS: readonly GitSubcommandRule[] = [
	{ subcommand: "fetch", matches: () => true, why: "reads from a remote, never mutates the checked-out branch" },
	{ subcommand: "diff", matches: () => true, why: "read-only comparison" },
	{ subcommand: "log", matches: () => true, why: "read-only history view" },
	{ subcommand: "status", matches: () => true, why: "read-only" },
	{ subcommand: "show", matches: () => true, why: "read-only object inspection" },
	{ subcommand: "branch", matches: () => true, why: "creating/listing a branch ref does not mutate the checked-out branch's history" },
	{ subcommand: "remote", matches: () => true, why: "read-only remote listing/inspection" },
	{
		subcommand: "stash",
		matches: (args) => args[0] === "list",
		why: "only the list form is named allowed; stash push/pop/apply are conservatively left unclassified",
	},
	{
		subcommand: "worktree",
		matches: () => true,
		why:
			"reads the named ref to populate a SECOND working directory -- with or without -b/-B, neither form " +
			"mutates the named ref itself (the pinned answer for the without--b case)",
	},
	{
		subcommand: "rebase",
		matches: (args) => hasPositionalArg(args),
		why: "an explicit target ref makes this the read-preview form, rewriting the OTHER ref, not the checked-out branch",
	},
	{
		subcommand: "apply",
		matches: (args) => args.includes("--check") || args.includes("--stat") || args.includes("--numstat"),
		why: "--check/--stat/--numstat is a dry run -- does not write the tree",
	},
];

function isProtected(facts: GitPolicyFacts): boolean {
	return facts.protectedBranches.some((b) => b.toLowerCase() === facts.currentBranch.toLowerCase());
}

const PUSH_EVERY_BRANCH_FLAGS: ReadonlySet<string> = new Set(["--all", "--mirror", "--branches"]);

/**
 * Does a `push` argv name a protected branch as destination, whatever `HEAD` is? A positional token is `src:dst`
 * when it has `:`, else a bare ref; a leading `+` (force) and `refs/heads/` are stripped; comparison is
 * case-insensitive. Flags that push every branch count as naming every protected one.
 */
function pushTargetsProtected(args: readonly string[], protectedBranches: readonly string[]): boolean {
	if (args.some((a) => PUSH_EVERY_BRANCH_FLAGS.has(a))) {
		return true;
	}
	return args.some((a) => {
		if (a.startsWith("-")) {
			return false;
		}
		const dst = a.includes(":") ? a.slice(a.indexOf(":") + 1) : a;
		const leaf = dst.replace(/^\+/, "").replace(/^refs\/heads\//, "");
		return protectedBranches.some((b) => b.toLowerCase() === leaf.toLowerCase());
	});
}

/** Deny a push naming a protected destination regardless of `HEAD`, or any write while `HEAD` is protected; see the module header for the resolution order. */
export function classifyGitInvocation(invocation: GitInvocation, facts: GitPolicyFacts): GitVerdict {
	const display = `git ${invocation.subcommand}${invocation.args.length > 0 ? ` ${invocation.args.join(" ")}` : ""}`;

	if (invocation.subcommand === "push" && pushTargetsProtected(invocation.args, facts.protectedBranches)) {
		return {
			kind: "block",
			reason:
				`"${display}" pushes to a protected ref by refspec -- the destination side of the argv names ` +
				`a protected branch regardless of the checked-out branch ("${facts.currentBranch}"); the refspec ` +
				"target cannot be trusted from argv alone, so this is checked independently of HEAD",
		};
	}

	if (!isProtected(facts)) {
		return { kind: "allow" };
	}

	const writeRule = GIT_WRITE_SUBCOMMANDS.find((r) => r.subcommand === invocation.subcommand);
	if (writeRule !== undefined && writeRule.matches(invocation.args)) {
		return {
			kind: "block",
			reason: `HEAD is "${facts.currentBranch}" (protected) and "${display}" writes to the checked-out branch: ${writeRule.why}`,
		};
	}

	const readRule = GIT_READ_SUBCOMMANDS.find((r) => r.subcommand === invocation.subcommand);
	if (readRule !== undefined && readRule.matches(invocation.args)) {
		return { kind: "allow" };
	}

	if (writeRule !== undefined || readRule !== undefined) {
		return {
			kind: "block",
			reason:
				`HEAD is "${facts.currentBranch}" (protected) and "${display}" does not match a named allow form ` +
				`for subcommand "${invocation.subcommand}" -- defaults to block (fail closed; add a read-table ` +
				`fixture rather than widening a predicate's default)`,
		};
	}

	return {
		kind: "block",
		reason:
			`HEAD is "${facts.currentBranch}" (protected) and "${display}" is an unclassified subcommand -- defaults ` +
			`to block (fail closed, per SAFE-03's posture; add it to the read or write table with a fixture, never ` +
			`widen the default)`,
	};
}


const GLAB_BLOCKED_SUBCOMMANDS: readonly GitSubcommandRule[] = [
	{
		subcommand: "mr",
		matches: (args) => args[0] === "merge",
		why: "an MR merge is the deploy trigger in the user's work repo (CONTEXT.md decision 13)",
	},
];

const GLAB_READ_SUBCOMMANDS: readonly GitSubcommandRule[] = [
	{ subcommand: "mr", matches: (args) => args[0] === "list" || args[0] === "view", why: "read-only MR inspection" },
	{ subcommand: "ci", matches: (args) => args[0] === "status", why: "read-only pipeline status" },
];

const MR_TARGET_FLAG = "--target-branch";
const MR_TARGET_SHORT = "-b";
const MR_TARGET_EQ = `${MR_TARGET_FLAG}=`;

/** Strip a `refs/heads/` prefix and surrounding whitespace, lower-cased, so every spelling of a branch compares equal. */
function normaliseBranch(raw: string): string {
	return raw.trim().replace(/^refs\/heads\//i, "").toLowerCase();
}

type MrTargetScan =
	| { readonly kind: "ok"; readonly target: string }
	| { readonly kind: "refused"; readonly why: string };

/**
 * glab parses flags with pflag: a repeated flag keeps its LAST value, a value-taking flag swallows the next token
 * even when it looks like a flag, and short flags cluster (`-db x`). So allow only one target, given first.
 */
function scanMrCreateTarget(argsAfterCreate: readonly string[]): MrTargetScan {
	let target: string | undefined;
	let occurrences = 0;
	for (let i = 0; i < argsAfterCreate.length; i++) {
		const a = argsAfterCreate[i];
		if (a === MR_TARGET_FLAG || a === MR_TARGET_SHORT) {
			occurrences++;
			const value = argsAfterCreate[i + 1];
			if (i === 0 && value !== undefined && !value.startsWith("-")) target = value;
			i++;
			continue;
		}
		if (a.startsWith(MR_TARGET_EQ)) {
			occurrences++;
			if (i === 0) target = a.slice(MR_TARGET_EQ.length);
			continue;
		}
		if (/^-[^-]/.test(a) && a.includes("b")) {
			return { kind: "refused", why: `short-flag form "${a}" may set the target and is not parsed` };
		}
	}
	if (occurrences === 0) {
		return { kind: "refused", why: "names no explicit --target-branch/-b, and GitLab defaults an omitted target to the protected default branch" };
	}
	if (occurrences > 1) {
		return { kind: "refused", why: "repeats the target flag, and glab honours the last one" };
	}
	if (target === undefined || normaliseBranch(target) === "") {
		return { kind: "refused", why: "the target flag must come straight after `create` with a value, so no earlier flag can swallow it" };
	}
	return { kind: "ok", target: normaliseBranch(target) };
}

/** `glab mr merge` blocks on every branch; `mr list`/`view`/`ci status` stay allowed; `mr create` is the conditional allow; unknown forms fail closed. Takes `protectedBranches` rather than `GitPolicyFacts` because the destination check does not depend on `HEAD`. */
export function classifyGlabInvocation(invocation: GitInvocation, protectedBranches: readonly string[]): GitVerdict {
	const display = `glab ${invocation.subcommand}${invocation.args.length > 0 ? ` ${invocation.args.join(" ")}` : ""}`;

	const blockRule = GLAB_BLOCKED_SUBCOMMANDS.find((r) => r.subcommand === invocation.subcommand);
	if (blockRule !== undefined && blockRule.matches(invocation.args)) {
		return { kind: "block", reason: `"${display}": ${blockRule.why}` };
	}

	const readRule = GLAB_READ_SUBCOMMANDS.find((r) => r.subcommand === invocation.subcommand);
	if (readRule !== undefined && readRule.matches(invocation.args)) {
		return { kind: "allow" };
	}

	if (invocation.subcommand === "mr" && invocation.args[0] === "create") {
		const scan = scanMrCreateTarget(invocation.args.slice(1));
		if (scan.kind === "refused") {
			return { kind: "block", reason: `"${display}" ${scan.why} -- defaults to block (fail closed)` };
		}
		if (protectedBranches.some((b) => b.toLowerCase() === scan.target)) {
			return {
				kind: "block",
				reason: `"${display}" targets "${scan.target}", a protected branch (${protectedBranches.join(", ")}) -- defaults to block (fail closed)`,
			};
		}
		return { kind: "allow" };
	}

	return {
		kind: "block",
		reason: `"${display}" is an unclassified glab form -- defaults to block (fail closed, same posture as git)`,
	};
}


/** `"protected-branch-rejection"` is the server refusing a protected ref (the one control enforced where the harness runs no code); `"other"` exists so the classifier is tested in both directions. */
export type PushFailureClassification = "protected-branch-rejection" | "other";

/** GitLab's rejection wording, reproduced from the fixture hook; a loose case-insensitive match tolerates differences in the live message (confirm on the work laptop per docs/RUNBOOK.md). */
const PROTECTED_BRANCH_REJECTION_RE = /not allowed to push code to protected branches/i;

/** Classify a push failure from stderr text; exit codes are non-zero for every rejection so cannot distinguish this one. Pure reader, never runs git. */
export function classifyPushFailure(stderr: string): PushFailureClassification {
	return PROTECTED_BRANCH_REJECTION_RE.test(stderr) ? "protected-branch-rejection" : "other";
}
