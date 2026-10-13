/**
 * git and glab decision layer: two separate questions, deny only when both hold.
 *
 * - Is `HEAD` currently a protected branch? Answered by {@link currentBranch}, the only impure
 *   function here. Asking "does the command mention `main`" instead would block
 *   `git worktree add -b feat main`, `git fetch origin main`, `git diff main`.
 * - Is this subcommand a WRITE given its args? A pure table of per-subcommand predicates
 *   (`{ subcommand, matches(args), why }`); `apply` appears in both tables with complementary
 *   predicates. `push` and every `rebase` are writes while `HEAD` is protected.
 *
 * `push` on any branch: force, every-branch and protected or ambiguous destinations block. Otherwise the destination is
 * resolved (explicit `src:dst`, or from config via {@link GitPolicyFacts.readConfig} only when nothing earlier in the
 * command can change it) and the verdict is `ask`, so a human sees the resolved branch; unresolvable blocks.
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
 * caller's `=== "main"` would read as falsy and fail open. Callers resolve the cwd first: the
 * directory a command's `cd`, `env -C` and `git -C` lead to beats `ctx.cwd`, so
 * `git -C /other/repo push` evaluates that repo's HEAD.
 *
 * Registers nothing and never spells the tool-registration call, which a lint matches as a substring.
 */
import { spawnSync } from "node:child_process";

import { gitProgramOption } from "./git-options.ts";

/** `currentBranch` result for a detached HEAD or any `git symbolic-ref` failure; never a real branch name, so never protected. */
export const DETACHED_HEAD = "(detached HEAD)";

function runGit(cwd: string, args: readonly string[]): { readonly stdout: string; readonly status: number | null } {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	if (result.error) throw new Error(`git ${args.join(" ")} failed to launch in "${cwd}": ${result.error.message}`);
	return { stdout: (result.stdout ?? "").trim(), status: result.status };
}

/** The branch checked out at `cwd`, via `git symbolic-ref --short HEAD` (never parsed from `git status` text). */
export function currentBranch(cwd: string): string {
	const result = runGit(cwd, ["symbolic-ref", "--short", "HEAD"]);
	return result.status === 0 ? result.stdout : DETACHED_HEAD;
}

/** Every value of `key` via `git config --get-all`; exit 1 means unset, any other failure throws so the caller refuses. */
export function gitConfigValues(cwd: string, key: string): readonly string[] {
	const result = runGit(cwd, ["config", "--get-all", key]);
	if (result.status === 1) return [];
	if (result.status !== 0) throw new Error(`git config --get-all ${key} failed in "${cwd}" (exit ${result.status})`);
	return result.stdout.split(/\r?\n/);
}

/** The branch `rev` resolves to through DWIM and symbolic refs, or undefined for a tag, a detached HEAD or an unknown name. */
export function resolveLocalBranch(cwd: string, rev: string): string | undefined {
	if (rev.startsWith("-")) return undefined;
	const result = runGit(cwd, ["rev-parse", "--symbolic-full-name", rev]);
	const full = result.stdout.split(/\r?\n/)[0] ?? "";
	return result.status === 0 && /^refs\/heads\/./.test(full) ? full.slice("refs/heads/".length) : undefined;
}

/** THROWS with no sentinel: an unknown id must never compare equal to recorded evidence, so callers refuse (fail closed). */
function revParse(cwd: string, rev: string, what: string): string {
	const result = runGit(cwd, ["rev-parse", rev]);
	if (result.status !== 0) {
		throw new Error(
			`git rev-parse ${rev} failed in "${cwd}" (exit ${result.status}) -- no sentinel exists for an unknown ${what}, ` +
				`because an unknown ${what} can never legitimately match a piece of evidence`,
		);
	}
	return result.stdout;
}

/** The HEAD commit SHA at `cwd`; throws on failure (see {@link revParse}). */
export function currentSha(cwd: string): string {
	return revParse(cwd, "HEAD", "SHA");
}

/** The tree id of `HEAD`, telling an empty commit (new SHA, same tree) from real movement; throws on failure. */
export function currentTree(cwd: string): string {
	return revParse(cwd, "HEAD^{tree}", "tree");
}

/** One git/glab invocation split into subcommand and args; `shell.ts` does the string parsing. */
export interface GitInvocation {
	readonly subcommand: string;
	readonly args: readonly string[];
	/** `name=value` from git's global `-c`/`--config-env`, which precede the subcommand. */
	readonly configOverrides?: readonly string[];
	/** Why the global options before the subcommand could not be understood; such an invocation blocks on every branch. */
	readonly unparsed?: string;
}

export interface GitPolicyFacts {
	readonly currentBranch: string;
	readonly protectedBranches: readonly string[];
	/** Destinations a push may never reach; defaults to `protectedBranches`. */
	readonly pushProtectedBranches?: readonly string[];
	/** `git config --get-all <key>` in the push's repo; absent means unknown, so config-derived destinations refuse. */
	readonly readConfig?: (key: string) => readonly string[];
	/** True only when nothing else in the command can change HEAD or config before the push runs. */
	readonly configTrusted?: boolean;
	/** The local branch `rev` names after DWIM and symbolic refs (`git rev-parse --symbolic-full-name`), or undefined. */
	readonly resolveBranch?: (rev: string) => string | undefined;
}

/** `ask` is a push to a resolved non-protected branch; `prompt` is the resolved remote and branch the human is shown. */
export type GitVerdict =
	| { readonly kind: "allow" }
	| { readonly kind: "ask"; readonly reason: string; readonly prompt: string }
	| { readonly kind: "block"; readonly reason: string };

interface GitSubcommandRule {
	readonly subcommand: string;
	readonly matches: (args: readonly string[]) => boolean;
	readonly why: string;
}

/** Subcommands that WRITE to the checked-out branch for at least some argument shapes. */
export const GIT_WRITE_SUBCOMMANDS: readonly GitSubcommandRule[] = [
	{ subcommand: "push", matches: () => true, why: "a write regardless of refspec, since an implicit destination is the checked-out branch" },
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
		matches: () => true,
		why: "rewrites the checked-out branch, or the branch it switches to first",
	},
];

/** Subcommands safe even when `HEAD` is protected; each is a named allow, never a default. */
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
		subcommand: "apply",
		matches: (args) => args.includes("--check") || args.includes("--stat") || args.includes("--numstat"),
		why: "--check/--stat/--numstat is a dry run -- does not write the tree",
	},
];

/** Every subcommand that may run on any branch; an alias or an unlisted name is not one, because an alias can expand to a push. */
export const GIT_KNOWN_SUBCOMMANDS: ReadonlySet<string> = new Set(
	(
		"add commit checkout switch restore branch merge rebase reset stash tag cherry-pick revert worktree fetch pull clone init " +
		"diff log show status remote ls-files ls-remote rev-parse blame grep apply am clean mv rm describe shortlog reflog bisect " +
		"submodule gc cat-file ls-tree rev-list show-ref for-each-ref merge-base config help version push check-ignore symbolic-ref " +
		"format-patch archive notes diff-tree name-rev count-objects sparse-checkout"
	).split(" "),
);

/** Subcommands that hand a program or a remote end the ability to write, whatever their arguments. */
const GIT_ALWAYS_BLOCKED: ReadonlyMap<string, string> = new Map([
	["send-pack", "pushes refs without going through the push checks"],
	["receive-pack", "runs the receiving end of a push"],
	["upload-pack", "runs a program on behalf of a remote"],
	["http-push", "pushes refs without going through the push checks"],
	["remote-ext", "runs an arbitrary command as a remote transport"],
	["daemon", "serves repositories over the network"],
]);

const FORMAT_PATCH_SEND_OPTION = /^--(to|cc|bcc|send-email|smtp[\w-]*|in-reply-to)(=|$)/;
const CONFIG_READ_FLAGS = new Set(["--get", "--get-all", "--get-regexp", "--get-urlmatch", "--list", "-l"]);
const CONFIG_SCOPE_FLAGS = new Set(["--global", "--local", "--system", "--worktree", "--show-origin", "--show-scope", "--null", "-z", "--name-only"]);
const CONFIG_DANGEROUS_KEY =
	/^(alias\..*|core\.(sshcommand|fsmonitor|pager|editor|hookspath|askpass|gitproxy)|credential\..*|include\..*|includeif\..*|url\..*|remote\..*\.(push|url|pushurl|receivepack|uploadpack|proxy)|diff\..*\.(textconv|command)|filter\..*|pager\..*|sequence\.editor|gpg\..*program|sendemail\..*)$/i;

/** Why `git config <args>` is not a plain read, or undefined when it is one. */
function configWriteReason(args: readonly string[]): string | undefined {
	const flags = args.filter((a) => a.startsWith("-"));
	const positionals = args.filter((a) => !a.startsWith("-"));
	const unknown = flags.find((f) => !CONFIG_SCOPE_FLAGS.has(f) && !CONFIG_READ_FLAGS.has(f));
	if (unknown !== undefined) return `"${unknown}" is not a read form of git config`;
	if (flags.some((f) => CONFIG_READ_FLAGS.has(f))) return undefined;
	if (positionals.length !== 1) return "git config with a value, or without exactly one key, writes configuration";
	const key = positionals[0];
	return CONFIG_DANGEROUS_KEY.test(key) ? `"${key}" makes git run programs or rewrites push targets` : undefined;
}

const positionalsOf = (args: readonly string[]): string[] => args.filter((a) => !a.startsWith("-"));

/** Per-subcommand argument limits for the subcommands admitted only in a restricted form; undefined means the form is allowed. */
function restrictedFormReason(subcommand: string, args: readonly string[]): string | undefined {
	switch (subcommand) {
		case "config":
			return configWriteReason(args);
		case "symbolic-ref":
			return positionalsOf(args).length > 1 || args.some((a) => a === "-d" || a === "--delete" || a === "-m")
				? "only the read form of symbolic-ref is allowed"
				: undefined;
		case "format-patch": {
			const send = args.find((a) => FORMAT_PATCH_SEND_OPTION.test(a));
			if (send !== undefined) return `"${send}" sends mail`;
			const outIndex = args.findIndex((a) => a === "-o" || a === "--output-directory" || a.startsWith("--output-directory="));
			const dir = outIndex === -1 ? undefined : args[outIndex].includes("=") ? args[outIndex].split("=")[1] : args[outIndex + 1];
			return dir !== undefined && (/^([A-Za-z]:)?[\\/]/.test(dir) || dir.split(/[\\/]/).includes(".."))
				? "format-patch may write only inside the project"
				: undefined;
		}
		case "archive":
			return args.some((a) => a === "--remote" || a.startsWith("--remote=") || a === "--exec" || a.startsWith("--exec="))
				? "archive --remote and --exec reach another machine or run a program"
				: undefined;
		case "notes":
			return args.length === 0 || args[0] === "list" || args[0] === "show" ? undefined : "only `notes list` and `notes show` are allowed";
		case "sparse-checkout":
			return args[0] === "list" ? undefined : "only `sparse-checkout list` is allowed";
		default:
			return undefined;
	}
}

const BRANCH_MUTATING_FLAGS = new Set(
	"-f --force -M -m --move -C -c --copy -D -d --delete -u --set-upstream-to --unset-upstream --edit-description".split(" "),
);

const isProtectedName = (ref: string, protectedBranches: readonly string[]): boolean => {
	const leaf = ref.replace(/^\+/, "").replace(/^(refs\/)?heads\//i, "");
	return protectedBranches.some((b) => b.toLowerCase() === leaf.toLowerCase());
};

const optionValue = (args: readonly string[], names: readonly string[]): string | undefined => {
	const at = args.findIndex((a) => names.includes(a));
	return at === -1 ? undefined : args[at + 1];
};

/** A protected branch this invocation writes by name from any HEAD: `branch -f main`, `fetch . feat:main`, `checkout -B main`. */
function protectedRefWrite(subcommand: string, args: readonly string[], protectedBranches: readonly string[]): string | undefined {
	const named = (refs: readonly (string | undefined)[]): string | undefined =>
		refs.find((r): r is string => r !== undefined && isProtectedName(r, protectedBranches));
	switch (subcommand) {
		case "branch": {
			const mutating = args.some((a) => BRANCH_MUTATING_FLAGS.has(a.split("=")[0]) || /^-[a-zA-Z]*[fMmCcDdu]/.test(a));
			const upstream = args.find((a) => a.startsWith("--set-upstream-to="))?.split("=")[1];
			return mutating ? named([...positionalsOf(args), upstream]) : undefined;
		}
		case "fetch":
		case "pull":
			return named(positionalsOf(args).filter((r) => r.includes(":")).map((r) => r.slice(r.indexOf(":") + 1)));
		case "checkout":
			return named([optionValue(args, ["-b", "-B"])]);
		case "switch":
			return named([optionValue(args, ["-c", "-C", "--create", "--force-create"])]);
		case "worktree":
			return args[0] === "add" ? named([optionValue(args, ["-b", "-B"])]) : undefined;
		case "rebase": {
			// `rebase <upstream> <branch>` switches to <branch> first; with --root the only positional is the branch.
			const positionals = args.filter((a, i) => !a.startsWith("-") && !REBASE_VALUE_OPTIONS.has(args[i - 1] ?? ""));
			return named([args.includes("--root") ? positionals[0] : positionals[1]]);
		}
		default:
			return undefined;
	}
}

const REBASE_VALUE_OPTIONS = new Set(["--onto", "-s", "--strategy", "-X", "--strategy-option", "-x", "--exec"]);

/** The branch a `checkout`/`switch`/`worktree add` leaves a HEAD on, `"-"` when it cannot be known here, or undefined when no HEAD moves. */
export function switchTarget(subcommand: string, args: readonly string[]): string | undefined {
	if (subcommand === "worktree") {
		if (args[0] !== "add" || optionValue(args, ["-b", "-B"]) !== undefined) return undefined;
		return args.slice(1).filter((a, i, rest) => !a.startsWith("-") && rest[i - 1] !== "--reason")[1];
	}
	if ((subcommand !== "checkout" && subcommand !== "switch") || args.includes("--")) return undefined;
	const created = optionValue(args, subcommand === "checkout" ? ["-b", "-B"] : ["-c", "-C", "--create", "--force-create"]);
	if (created !== undefined) return created;
	const target = positionalsOf(args)[0];
	if (target === "-" || args.includes("-") || target?.includes("@{") === true) return "-";
	// `--track <remote>/<branch>` creates and checks out the local <branch>.
	const tracking = args.some((a) => a === "-t" || a === "--track" || a.startsWith("--track="));
	return tracking && target !== undefined ? target.slice(target.indexOf("/") + 1) : target;
}

function isProtected(facts: GitPolicyFacts): boolean {
	return facts.protectedBranches.some((b) => b.toLowerCase() === facts.currentBranch.toLowerCase());
}

const PUSH_REFUSED_LONG: ReadonlyMap<string, string> = new Map([
	["--all", "pushes every branch, protected ones included"],
	["--branches", "pushes every branch, protected ones included"],
	["--mirror", "mirrors every ref, force-updating and deleting protected ones"],
	["--tags", "pushes every tag, and only branch pushes can be confirmed"],
	["--follow-tags", "also pushes tags, and only branch pushes can be confirmed"],
	["--prune", "deletes remote branches that have no local counterpart"],
	// git lets a positional remote override --repo; refusing it avoids showing the wrong remote.
	["--repo", "is refused; name the remote as the first argument"],
	["--receive-pack", "runs a remote-side program the guard cannot see"],
	["--exec", "runs a remote-side program the guard cannot see"],
]);
const PUSH_FORCE_FLAG = /^--(force|force-with-lease|force-if-includes)(=|$)/;
const PUSH_OPTION_FLAGS: ReadonlySet<string> = new Set(["-o", "--push-option"]);
const PUSH_SAFE_LONG: ReadonlySet<string> = new Set(
	(
		"--set-upstream --verbose --quiet --dry-run --porcelain --progress --no-progress --atomic --no-atomic --verify " +
		"--no-verify --no-follow-tags --thin --no-thin --signed --no-signed --ipv4 --ipv6 --no-force-with-lease " +
		"--no-recurse-submodules"
	).split(" "),
);
const PUSH_SAFE_SHORT = new Set("uvqn46");
/** GitLab `merge_request.*` push options create, retarget or merge an MR server-side; `glab mr` covers that path. */
const PUSH_OPTION_REFUSED = /^merge_request\./i;
const GIT_FALSE = /^(false|no|off|0)$/i;

/** Destinations git resolves to more than one branch, or to the remote's default branch, count as every protected one. */
function destinationIsProtected(dst: string, protectedBranches: readonly string[]): boolean {
	const ref = dst.replace(/^\+/, "");
	if (ref === "" || ref.includes("*") || /^(head|@)$/i.test(ref)) return true;
	// git DWIMs a short destination against the remote's refs, so `heads/main` reaches refs/heads/main.
	const leaf = ref.replace(/^(refs\/)?heads\//i, "");
	return protectedBranches.some((b) => b.toLowerCase() === leaf.toLowerCase());
}

const branchOf = (ref: string): string => ref.replace(/^refs\/heads\//i, "");

type PushPlan =
	| { readonly kind: "refused"; readonly why: string }
	| { readonly kind: "resolved"; readonly remote: string; readonly targets: readonly string[]; readonly via: string };

const refuse = (why: string): PushPlan => ({ kind: "refused", why });

interface PushArgs {
	readonly remote?: string;
	readonly refspecs: readonly string[];
	readonly deleting: boolean;
	readonly submodulesOff: boolean;
	readonly followTagsOff: boolean;
	readonly optionsGiven: boolean;
}

/** Parse push flags against an allow-list; an unknown flag refuses because its arity could hide the real remote or refspec. */
function parsePushArgs(args: readonly string[]): PushArgs | string {
	const positionals: string[] = [];
	let deleting = false;
	let submodulesOff = false;
	let followTagsOff = false;
	let optionsGiven = false;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		const name = a.startsWith("--") ? a.split("=")[0] : a;
		const inlineValue = a.startsWith("--") && a.includes("=") ? a.slice(a.indexOf("=") + 1) : undefined;
		if (a === "--") {
			positionals.push(...args.slice(i + 1));
			break;
		}
		if (PUSH_FORCE_FLAG.test(a)) return `"${a}" force-pushes, which is refused on every branch`;
		if (PUSH_REFUSED_LONG.has(name)) return `"${a}" ${PUSH_REFUSED_LONG.get(name)}`;
		if (PUSH_OPTION_FLAGS.has(name)) {
			const value = inlineValue ?? args[++i];
			if (value === undefined) return `"${a}" has no value`;
			if (PUSH_OPTION_REFUSED.test(value)) return `push option "${value}" acts on a merge request server-side`;
			optionsGiven = true;
		} else if (name === "--delete") {
			deleting = true;
		} else if (name === "--recurse-submodules") {
			if (inlineValue !== "no" && inlineValue !== "check") return `"${a}" also pushes submodule branches this guard does not resolve`;
			submodulesOff = true;
		} else if (a.startsWith("--")) {
			if (!PUSH_SAFE_LONG.has(name)) return `"${a}" is not a recognised push flag`;
			submodulesOff ||= name === "--no-recurse-submodules";
			followTagsOff ||= name === "--no-follow-tags";
		} else if (a.startsWith("-") && a.length > 1) {
			for (const ch of a.slice(1)) {
				if (ch === "f") return `"${a}" force-pushes, which is refused on every branch`;
				if (ch === "d") deleting = true;
				else if (!PUSH_SAFE_SHORT.has(ch)) return `short-flag cluster "${a}" contains "-${ch}", which is not parsed`;
			}
		} else {
			positionals.push(a);
		}
	}
	const refspecs = positionals.slice(1).filter((r) => !r.startsWith("^"));
	return { remote: positionals[0], refspecs, deleting, submodulesOff, followTagsOff, optionsGiven };
}

/** The last value of a config key, as git reads a single-valued key. */
function lastConfig(facts: GitPolicyFacts, key: string): string | undefined {
	const values = facts.readConfig?.(key) ?? [];
	return values.length > 0 ? values[values.length - 1] : undefined;
}

const configList = (facts: GitPolicyFacts, key: string): readonly string[] => facts.readConfig?.(key) ?? [];

/** Destinations git derives from config, read now; untrusted when an earlier command could rewrite HEAD or config first. */
function configDerivedTargets(facts: GitPolicyFacts, what: string): string | undefined {
	if (facts.readConfig === undefined || facts.resolveBranch === undefined) return `${what}, and this repo's git config cannot be read`;
	if (facts.configTrusted !== true) {
		return `${what}, and something else in the command (cd, an assignment, a wrapper or another segment) could change HEAD or config before it runs -- run the push on its own`;
	}
	return undefined;
}

/** Every configured upstream of `branch`; git refuses to push a multi-valued one, but each is still checked. */
const mergeTargets = (facts: GitPolicyFacts, branch: string): string[] => configList(facts, `branch.${branch}.merge`).map(branchOf);

/** `git push <remote> <src>`: builtin/push.c set_refspecs maps a bare source via remote.<r>.push, else via branch.<src>.merge under push.default=upstream. */
function resolveBareSource(src: string, remote: string, facts: GitPolicyFacts): PushPlan {
	const untrusted = configDerivedTargets(facts, `refspec "${src}" has no explicit destination`);
	if (untrusted !== undefined) return refuse(untrusted);
	if (src === "tag") return refuse('"tag <name>" pushes a tag, and only branch pushes can be confirmed');
	// git follows DWIM spellings (`heads/x`) and symbolic refs to the branch it actually pushes.
	const name = /^[\w./-]+$/.test(src) && !src.startsWith("-") ? facts.resolveBranch?.(src) : undefined;
	if (name === undefined) return refuse(`refspec "${src}" does not resolve to exactly one local branch`);
	if (configList(facts, `remote.${remote}.push`).length > 0) {
		return refuse(`remote.${remote}.push is configured and may remap "${src}" to any destination`);
	}
	const pushDefault = (lastConfig(facts, "push.default") ?? "simple").toLowerCase();
	const merges = pushDefault === "upstream" || pushDefault === "tracking" ? mergeTargets(facts, name) : [];
	const targets = [...new Set([name, ...merges])];
	const via = merges.length > 0 ? `push.default=${pushDefault} maps "${name}" to branch.${name}.merge` : `"${src}" is branch "${name}", pushed to the same name`;
	return { kind: "resolved", remote, targets, via };
}

/** `git push [<remote>]`: remote and destination both come from config (git-config(1) push.default, branch.<b>.pushRemote). */
function resolveNoRefspec(given: string | undefined, facts: GitPolicyFacts): PushPlan {
	const untrusted = configDerivedTargets(facts, "names no refspec, so its destination comes from config");
	if (untrusted !== undefined) return refuse(untrusted);
	const head = facts.resolveBranch?.("HEAD");
	if (head === undefined) return refuse("names no refspec and HEAD is not on a local branch");
	const upstreamRemote = lastConfig(facts, `branch.${head}.remote`);
	const remote = given ?? lastConfig(facts, `branch.${head}.pushRemote`) ?? lastConfig(facts, "remote.pushDefault") ?? upstreamRemote ?? "origin";
	if (configList(facts, `remote.${remote}.push`).length > 0) {
		return refuse(`remote.${remote}.push is configured and may push to any destination`);
	}
	const pushDefault = (lastConfig(facts, "push.default") ?? "simple").toLowerCase();
	const merges = mergeTargets(facts, head);
	if (pushDefault === "current") return { kind: "resolved", remote, targets: [head], via: `push.default=current pushes HEAD ("${head}") to the same name` };
	if (pushDefault === "upstream" || pushDefault === "tracking") {
		if (merges.length === 0) return refuse(`push.default=${pushDefault} but "${head}" has no upstream`);
		return { kind: "resolved", remote, targets: [...new Set(merges)], via: `push.default=${pushDefault} pushes "${head}" to its upstream branch.${head}.merge` };
	}
	if (pushDefault === "simple") {
		// simple refuses a differently named upstream on the upstream remote; every name is checked rather than trusting that refusal.
		const targets = [...new Set([head, ...(upstreamRemote === remote ? merges : [])])];
		return { kind: "resolved", remote, targets, via: `push.default=simple pushes HEAD ("${head}")` };
	}
	return refuse(`push.default=${pushDefault} may push branches other than HEAD, protected ones included`);
}

/** Config that turns an ordinary push into something else; read whenever config is readable, whatever the refspec. */
function remoteConfigRefusal(remote: string | undefined, parsed: PushArgs, facts: GitPolicyFacts): string | undefined {
	if (facts.readConfig === undefined) return undefined;
	if (remote !== undefined && !/[/:\\]/.test(remote)) {
		// Without remote.<r>.url, git falls back to .git/remotes/<r> and .git/branches/<r>, which carry their own push rules.
		if (configList(facts, `remote.${remote}.url`).length === 0) return `"${remote}" is not a remote configured in git config`;
		const mirror = lastConfig(facts, `remote.${remote}.mirror`);
		if (mirror !== undefined && !GIT_FALSE.test(mirror)) return `remote.${remote}.mirror makes every push a forced mirror`;
		if (configList(facts, `remote.${remote}.receivepack`).length > 0) return `remote.${remote}.receivepack runs a remote-side program the guard cannot see`;
	}
	if (!parsed.optionsGiven && configList(facts, "push.pushOption").some((o) => PUSH_OPTION_REFUSED.test(o))) {
		return "push.pushOption sets a merge_request.* option that acts server-side";
	}
	const followTags = lastConfig(facts, "push.followTags");
	if (!parsed.followTagsOff && followTags !== undefined && !GIT_FALSE.test(followTags)) {
		return "push.followTags also pushes tags -- add --no-follow-tags";
	}
	if (!parsed.submodulesOff) {
		const push = lastConfig(facts, "push.recurseSubmodules");
		const recurse = lastConfig(facts, "submodule.recurse");
		if ((push !== undefined && !/^(no|check)$/i.test(push)) || (push === undefined && recurse !== undefined && !GIT_FALSE.test(recurse))) {
			return "config recurses into submodules, whose branches this guard does not resolve -- add --no-recurse-submodules";
		}
	}
	return undefined;
}

/** Every branch a push may update, or why it cannot be confirmed; force, protected and ambiguous destinations always refuse. */
function planPush(args: readonly string[], configOverrides: readonly string[], facts: GitPolicyFacts): PushPlan {
	// An include.path or any other override can redirect config this guard reads, so none is accepted on a push.
	if (configOverrides.length > 0) return refuse("overrides git config with -c/--config-env");
	const parsed = parsePushArgs(args);
	if (typeof parsed === "string") return refuse(parsed);
	const protectedNames = facts.pushProtectedBranches ?? facts.protectedBranches;
	let plan: PushPlan;
	if (parsed.refspecs.length === 0) {
		plan = parsed.deleting ? refuse("--delete names no branch") : resolveNoRefspec(parsed.remote, facts);
	} else {
		const remote = parsed.remote ?? "";
		const targets: string[] = [];
		const vias: string[] = [];
		for (const r of parsed.refspecs) {
			if (r.startsWith("+")) return refuse(`refspec "${r}" force-pushes, which is refused on every branch`);
			const colon = r.indexOf(":");
			if (parsed.deleting || colon === 0) {
				const name = colon === -1 ? r : r.slice(colon + 1);
				if (destinationIsProtected(name, protectedNames)) return refuse(`refspec "${r}" deletes a protected or ambiguous branch`);
				targets.push(`delete ${branchOf(name)}`);
			} else if (colon > 0) {
				targets.push(branchOf(r.slice(colon + 1)));
			} else {
				const bare = resolveBareSource(r, remote, facts);
				if (bare.kind === "refused") return bare;
				targets.push(...bare.targets);
				vias.push(bare.via);
			}
		}
		plan = { kind: "resolved", remote, targets, via: vias.length > 0 ? vias.join("; ") : "explicit <src>:<dst> refspec" };
	}
	if (plan.kind === "refused") return plan;
	const configWhy = remoteConfigRefusal(plan.remote === "" ? undefined : plan.remote, parsed, facts);
	if (configWhy !== undefined) return refuse(configWhy);
	for (const t of plan.targets) {
		const dst = t.replace(/^delete /, "");
		if (destinationIsProtected(dst, protectedNames)) {
			return refuse(`resolves to "${dst}", a protected or ambiguous destination (${protectedNames.join(", ")})`);
		}
	}
	return plan;
}

/** Refuse a push that is forced or may reach a protected destination regardless of `HEAD`, or any write while `HEAD` is protected; a resolvable feature-branch push asks. */
export function classifyGitInvocation(invocation: GitInvocation, facts: GitPolicyFacts): GitVerdict {
	const display = `git ${invocation.subcommand}${invocation.args.length > 0 ? ` ${invocation.args.join(" ")}` : ""}`;

	if (invocation.unparsed !== undefined) {
		return { kind: "block", reason: `"${display}" ${invocation.unparsed} -- blocked on every branch because git options can turn git into a program runner` };
	}
	const alwaysBlocked = GIT_ALWAYS_BLOCKED.get(invocation.subcommand);
	if (alwaysBlocked !== undefined) return { kind: "block", reason: `"${display}" ${alwaysBlocked} -- blocked on every branch` };
	if (!GIT_KNOWN_SUBCOMMANDS.has(invocation.subcommand) && invocation.subcommand !== "") {
		const detail = invocation.subcommand === "subtree" ? "subtree can push" : "an alias or unlisted subcommand may expand to a push";
		return {
			kind: "block",
			reason:
				`"${display}": ${detail}, so only these subcommands run: ${[...GIT_KNOWN_SUBCOMMANDS].sort().join(", ")} -- ` +
				"blocked on every branch; spell the real subcommand",
		};
	}
	const restricted = restrictedFormReason(invocation.subcommand, invocation.args);
	if (restricted !== undefined) return { kind: "block", reason: `"${display}": ${restricted} -- blocked on every branch` };
	const program = gitProgramOption(invocation.subcommand, invocation.args);
	if (program !== undefined) {
		return { kind: "block", reason: `"${display}": "${program}" runs a program or writes a file -- blocked on every branch` };
	}
	const protectedRef = protectedRefWrite(invocation.subcommand, invocation.args, facts.protectedBranches);
	if (protectedRef !== undefined) {
		return { kind: "block", reason: `"${display}" moves, creates or deletes the protected branch "${protectedRef}" without checking it out -- blocked on every branch` };
	}

	const push = invocation.subcommand === "push" ? planPush(invocation.args, invocation.configOverrides ?? [], facts) : undefined;
	if (push?.kind === "refused") {
		return {
			kind: "block",
			reason:
				`"${display}" ${push.why} -- checked regardless of the checked-out branch ("${facts.currentBranch}"); ` +
				"push a non-protected branch without force, e.g. git push <remote> <branch>:<branch>",
		};
	}

	if (push?.kind === "resolved" && !isProtected(facts)) {
		const remote = push.remote === "" ? "(none named)" : push.remote;
		return {
			kind: "ask",
			reason: `"${display}" pushes to ${push.targets.join(", ")} on ${remote}, which needs human confirmation`,
			prompt: `Remote: ${remote}\nBranch: ${push.targets.join(", ")}\nResolved: ${push.via}`,
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
			`to block (fail closed; add it to the read or write table with a fixture, never ` +
			`widen the default)`,
	};
}

const GLAB_BLOCKED_SUBCOMMANDS: readonly GitSubcommandRule[] = [
	{
		subcommand: "mr",
		matches: (args) => args[0] === "merge",
		why: "an MR merge is the deploy trigger in the user's work repo",
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
