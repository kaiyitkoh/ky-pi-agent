/**
 * SAFE-04 / SAFE-05 — the git and glab decision layer.
 *
 * A two-step evaluation, kept as two genuinely separate steps because
 * conflating them is exactly Pitfall 5 (`04-RESEARCH.md:506-511`):
 *
 *   (1) is `HEAD` CURRENTLY the protected branch? — a property of the
 *       checked-out repository, independent of anything in the command's
 *       argument list. Answered by {@link currentBranch}, the only impure
 *       function in this module.
 *   (2) is this subcommand a WRITE to the checked-out branch, given its
 *       arguments? — a property of the command alone, independent of
 *       `HEAD`. Answered by {@link classifyGitInvocation}'s table lookup,
 *       which is pure.
 *
 * Deny only when BOTH hold. A rule that instead asks "does this command
 * mention `main` anywhere" conflates the two questions and blocks
 * `git worktree add -b feat main`, `git fetch origin main`, `git diff main`
 * and `git log origin/main` — breaking the single most useful escape hatch
 * the user has while trying to protect `main`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A TABLE OF PREDICATES, NOT A BOOLEAN OR A FLAT NAME SET
 * ---------------------------------------------------------------------------
 * `04-RESEARCH.md` Open Question 3 names the cases that need a per-subcommand
 * PREDICATE over the argument list, not a static write/read label:
 *   - `rebase` — bare (`git rebase`, no non-flag argument) rewrites the
 *     checked-out branch against its upstream: a WRITE. `git rebase feature`
 *     names an explicit OTHER ref: the read-preview form, a READ.
 *   - `worktree add` — with or without `-b`/`-B`, this reads the named ref
 *     to populate a SECOND working directory. Neither form mutates the named
 *     ref itself, so both are allowed (the pinned answer for the
 *     without-`-b` case the plan calls out explicitly).
 *   - `apply` — writes the tree unless `--check`/`--stat`/`--numstat` makes
 *     it a dry run.
 *   - `commit --amend` — unambiguously a write, regardless of flags.
 *   - `push` — a write regardless of refspec, because the refspec TARGET
 *     cannot be trusted from the argument list alone (it can name a
 *     different remote-tracking ref than the one actually pushed, and
 *     resolving that correctly would need a second git invocation this
 *     module deliberately does not make — see the purity note below).
 *
 * `GIT_WRITE_SUBCOMMANDS` and `GIT_READ_SUBCOMMANDS` are therefore both
 * arrays of `{ subcommand, matches(args), why }`, and a subcommand may
 * legitimately appear in BOTH tables with complementary predicates (`rebase`,
 * `apply`) — the write table's predicate answers "is THIS invocation a
 * write", not "can this subcommand ever write".
 *
 * ---------------------------------------------------------------------------
 * RESOLUTION ORDER AND THE FAIL-CLOSED DEFAULT
 * ---------------------------------------------------------------------------
 * Given `HEAD` is protected:
 *   1. If the subcommand has a write-table entry AND its predicate matches
 *      this invocation's args → BLOCK.
 *   2. Else if the subcommand has a read-table entry AND its predicate
 *      matches → ALLOW.
 *   3. Else if the subcommand appears in EITHER table but neither predicate
 *      matched this exact argument shape (e.g. `git stash pop` — `stash` is
 *      read-table-known, but only the `list` form is named allowed) → BLOCK,
 *      fail closed on the unmatched shape rather than falling through open.
 *   4. Else the subcommand is wholly unknown → BLOCK, fail closed, with the
 *      reason naming the subcommand as unclassified.
 *
 * The documented remedy for a false positive at step 3 or 4 is to ADD a
 * fixture-backed table row, never to widen a predicate's default toward
 * "true" or to special-case around this resolution order. That is the same
 * posture `shell.ts`'s deny predicate states for its own unknown node types.
 *
 * ---------------------------------------------------------------------------
 * WHY `glab mr merge` IS SEPARATE, AND UNCONDITIONAL ON BRANCH
 * ---------------------------------------------------------------------------
 * In the user's work repo an MR merge IS the deploy trigger (CONTEXT.md
 * decision 13) — merging a `.tf` change through GitLab is an infra change,
 * not a local plan. `HEAD` is irrelevant to that: the danger is the MERGE
 * TARGET on GitLab's server, not the branch checked out on this laptop.
 * `classifyGlabInvocation` therefore takes no branch facts at all and blocks
 * `mr merge` (with or without an IID, with or without `--auto-merge`) on
 * EVERY branch, while `mr list`/`mr view`/`ci status` stay allowed so the
 * harness remains usable for ordinary orientation.
 *
 * ---------------------------------------------------------------------------
 * WHY `currentBranch` IS THE ONLY IMPURE EXPORT
 * ---------------------------------------------------------------------------
 * Mirrors `.pi/extensions/safety/shell.ts`'s canonicalise()/wrapper-resolution
 * split and `.pi/extensions/diagnostics/budget.ts`'s PURITY docstring:
 * `classifyGitInvocation`/`classifyGlabInvocation` take a plain data object
 * and a facts object, never `ctx`, never touch the filesystem or a
 * subprocess — which is what lets `tests/unit/git-policy.test.ts` be a
 * millisecond fixture table. The ONE fact that genuinely needs a real
 * repository — "what branch is checked out right now" — is isolated in
 * `currentBranch`, proven against a real disposable checkout in
 * `tests/integration/git-head-main.test.ts`.
 *
 * `currentBranch(cwd)` runs `git symbolic-ref --short HEAD` with
 * `spawnSync(..., { shell: false })`, the exact spawn shape
 * `tests/helpers/git.ts:42-53` uses (copied as a PATTERN — extensions must
 * not import from `tests/`). Exit 0 → the branch name, trimmed. Non-zero
 * (detached HEAD, or no git repository at all) → {@link DETACHED_HEAD}, a
 * distinct named sentinel, NEVER `undefined` and never an empty string.
 * Returning `undefined` and letting a caller's `=== "main"` comparison read
 * it as falsy-therefore-"not main" is exactly how a guard silently fails
 * open on the machine's own quirks (a detached CI checkout, a submodule);
 * `DETACHED_HEAD` cannot equal any configured protected-branch name, so it
 * is unconditionally treated as NOT-protected, on purpose, and that
 * treatment is visible at the call site rather than hidden in a fallback.
 *
 * The caller is responsible for resolving WHICH cwd to interrogate before
 * calling `currentBranch` — `shell.ts`'s `CanonicalInvocation.cwdOverride`
 * (from git's own `-C`/`--git-dir`) takes precedence over the harness's
 * ambient `ctx.cwd` when present, which is what makes
 * `git -C /other/repo push` evaluate against `/other/repo`'s HEAD rather
 * than the harness's own working directory (T-04-18).
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (BOOT-10). This module registers nothing. It does not spell
 * the tool-registration call, in code or in prose —
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`.
 */
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// The HEAD oracle (impure — the only spawnSync call in this module)
// ---------------------------------------------------------------------------

/**
 * The distinct value `currentBranch` returns for a detached HEAD (or when
 * `git symbolic-ref` fails for any other reason — no repository, no HEAD at
 * all). Never equal to any real branch name, so it is unconditionally
 * NOT-protected wherever it is compared against `protectedBranches`. See the
 * module docstring's "WHY `currentBranch` IS THE ONLY IMPURE EXPORT" section
 * for why this is a named sentinel rather than `undefined`.
 */
export const DETACHED_HEAD = "(detached HEAD)";

/**
 * What branch is checked out in the repository at `cwd`, right now.
 *
 * `git symbolic-ref --short HEAD` is git's own documented primitive for this
 * question (`04-RESEARCH.md`'s Don't-Hand-Roll table, row 3) — never parsed
 * out of `git branch`/`git status` text. Exit 0 → the branch name, trimmed.
 * Non-zero → {@link DETACHED_HEAD}.
 */
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

// ---------------------------------------------------------------------------
// The pure classifier half
// ---------------------------------------------------------------------------

/**
 * One parsed git or glab invocation, already split into its (sub)command word
 * and everything after it. This module never parses a raw command string
 * itself — that is `shell.ts`'s job (`CanonicalInvocation.args`), and the
 * test table builds this shape directly from its own fixtures.
 */
export interface GitInvocation {
	/** The git subcommand (`"push"`, `"worktree"`, ...) or the glab first-level verb (`"mr"`, `"ci"`, ...). */
	readonly subcommand: string;
	/** Every argument AFTER the subcommand, in order. */
	readonly args: readonly string[];
}

/** Facts `classifyGitInvocation` needs and will never derive for itself — see the module docstring. */
export interface GitPolicyFacts {
	/** The checked-out branch, from {@link currentBranch} — or {@link DETACHED_HEAD}. */
	readonly currentBranch: string;
	/** Branch names treated as protected. Compared case-insensitively. */
	readonly protectedBranches: readonly string[];
}

/** Discriminated verdict shape, mirroring `shell.ts`'s `ShellVerdict` and `paths.ts`'s `PathVerdict`. */
export type GitVerdict = { readonly kind: "allow" } | { readonly kind: "block"; readonly reason: string };

/** One subcommand's write-or-read predicate over its own argument list. */
interface GitSubcommandRule {
	readonly subcommand: string;
	/** True when THIS invocation's args make it match this table's classification. */
	readonly matches: (args: readonly string[]) => boolean;
	readonly why: string;
}

/** True if any element of `args` does not start with `-` — i.e. there is a positional (non-flag) argument. */
function hasPositionalArg(args: readonly string[]): boolean {
	return args.some((a) => !a.startsWith("-"));
}

/**
 * Subcommands that WRITE to the checked-out branch, at least for some
 * argument shapes. See the module docstring for `rebase`/`apply`'s
 * conditional predicates.
 */
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

/**
 * Subcommands that are safe regardless of `HEAD`, at least for some argument
 * shapes -- ALLOWED even when `HEAD` is protected. Every one of these must
 * appear as a named row in `tests/unit/git-policy.test.ts` (Pitfall 5: "a
 * named allow-case, not merely absent from the deny-list").
 */
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

/**
 * The whole SAFE-04 decision: deny only when `HEAD` is protected AND the
 * subcommand classifies as a write for these exact args. See the module
 * docstring for the four-step resolution order and the fail-closed default.
 */
export function classifyGitInvocation(invocation: GitInvocation, facts: GitPolicyFacts): GitVerdict {
	if (!isProtected(facts)) {
		return { kind: "allow" };
	}

	const display = `git ${invocation.subcommand}${invocation.args.length > 0 ? ` ${invocation.args.join(" ")}` : ""}`;

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

// ---------------------------------------------------------------------------
// glab -- separate and unconditional on branch (decision 13)
// ---------------------------------------------------------------------------

/** `glab` subcommand forms blocked on every branch -- the deploy trigger. */
const GLAB_BLOCKED_SUBCOMMANDS: readonly GitSubcommandRule[] = [
	{
		subcommand: "mr",
		matches: (args) => args[0] === "merge",
		why: "an MR merge is the deploy trigger in the user's work repo (CONTEXT.md decision 13)",
	},
];

/** `glab` subcommand forms explicitly allowed -- orientation commands that must stay usable. */
const GLAB_READ_SUBCOMMANDS: readonly GitSubcommandRule[] = [
	{ subcommand: "mr", matches: (args) => args[0] === "list" || args[0] === "view", why: "read-only MR inspection" },
	{ subcommand: "ci", matches: (args) => args[0] === "status", why: "read-only pipeline status" },
];

/**
 * `glab mr merge` blocks unconditionally, regardless of `HEAD` -- the danger
 * is the merge target on GitLab's server, not the branch checked out on this
 * laptop. `mr list`/`mr view`/`ci status` stay allowed. An unknown subcommand
 * fails closed, same posture as {@link classifyGitInvocation}.
 */
export function classifyGlabInvocation(invocation: GitInvocation): GitVerdict {
	const display = `glab ${invocation.subcommand}${invocation.args.length > 0 ? ` ${invocation.args.join(" ")}` : ""}`;

	const blockRule = GLAB_BLOCKED_SUBCOMMANDS.find((r) => r.subcommand === invocation.subcommand);
	if (blockRule !== undefined && blockRule.matches(invocation.args)) {
		return { kind: "block", reason: `"${display}": ${blockRule.why}` };
	}

	const readRule = GLAB_READ_SUBCOMMANDS.find((r) => r.subcommand === invocation.subcommand);
	if (readRule !== undefined && readRule.matches(invocation.args)) {
		return { kind: "allow" };
	}

	return {
		kind: "block",
		reason: `"${display}" is an unclassified glab form -- defaults to block (fail closed, same posture as git)`,
	};
}

// ---------------------------------------------------------------------------
// SAFE-01's classifier half -- reads a push failure, never causes one
// ---------------------------------------------------------------------------

/**
 * What kind of failure a `git push` produced, read off its stderr text.
 *
 * `"protected-branch-rejection"` means the SERVER rejected the push because the
 * target ref is protected -- the only control in this phase enforced where the
 * harness has no code execution at all (CONTEXT.md decision 1). `"other"` is
 * every other push failure -- non-fast-forward, network, auth, anything -- and
 * exists so this classifier can be driven in BOTH directions: a classifier that
 * answers `"protected-branch-rejection"` for everything would pass a
 * one-directional test just as well as a correct one.
 */
export type PushFailureClassification = "protected-branch-rejection" | "other";

/**
 * GitLab's own wording for a protected-branch push rejection.
 *
 * `tests/integration/gitlab-push-protection.test.ts`'s fixture hook writes this
 * exact sentence to stderr, and its own comment says so: it is a REPRODUCTION
 * of GitLab's real message, not a captured one, because this machine has no
 * GitLab access. `RB-04-01` (`docs/RUNBOOK.md`) is what confirms the real
 * wording on the work laptop -- this pattern is deliberately loose (a
 * case-insensitive substring test) so a live message that differs from the
 * fixture only in capitalisation or surrounding text still classifies
 * correctly, while the phrase itself is specific enough not to match an
 * ordinary git failure by accident.
 */
const PROTECTED_BRANCH_REJECTION_RE = /not allowed to push code to protected branches/i;

/**
 * Classifies one `git push` failure's stderr text.
 *
 * Pure, and deliberately reads text rather than an exit code: `git push`'s
 * process exit code is non-zero for every rejection reason (protected branch,
 * non-fast-forward, network failure, auth failure, ...), so the exit code alone
 * cannot distinguish this phase's one server-side control from any other
 * failure. This is a proxy-side READER, never a caller of `git push` itself --
 * it takes text the caller already captured.
 */
export function classifyPushFailure(stderr: string): PushFailureClassification {
	return PROTECTED_BRANCH_REJECTION_RE.test(stderr) ? "protected-branch-rejection" : "other";
}
