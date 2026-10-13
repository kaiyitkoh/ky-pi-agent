/**
 * Plan mode's read-only bash boundary, decided over the safety layer's unbash AST rather than a regex on the raw string.
 * Every resolved invocation must be an allowlisted verb that passes its argument rule; the reasoning is in docs/EXTENSIONS.md,
 * "Plan mode bash boundary". Pure: no ctx, fs, child_process or default export.
 */
import { gitProgramOption } from "../safety/git-options.ts";
import { canonicalise, normaliseExecutable, PACKAGE_RUNNER_WRAPPERS } from "../safety/shell.ts";

/** Plan mode's answer for one bash command. `reason` is shown to the model verbatim. */
export type PlanModeVerdict = { readonly kind: "allow" } | { readonly kind: "deny"; readonly reason: string };

const wordSet = (words: string): Set<string> => new Set(words.split(" "));

/** Verbs with no exec-or-write escape reachable through ordinary flags, as {@link normaliseExecutable} spells them. */
const ALWAYS_READ_ONLY = wordSet(
	"cat head tail wc diff file stat du df which whereis type pwd cd echo printf printenv uname whoami id cal uptime ps free " +
		"hostname ls grep eza jq basename dirname realpath readlink cut tr comm cmp nl tac rev seq md5sum sha1sum sha256sum true false",
);

/** An allowlist, so a git version that grows a mutating subcommand is denied by default. */
const GIT_READ_SUBCOMMANDS = wordSet(
	"status log diff show remote branch tag config blame shortlog describe reflog whatchanged grep cat-file rev-parse rev-list " +
		"ls-files ls-tree ls-remote for-each-ref version",
);

/** The only options accepted before the subcommand: `-c`, `--config-env`, `--exec-path`, `-C` and `--git-dir` can all run code. */
const GIT_SAFE_GLOBAL_FLAGS = wordSet(
	"--no-pager -P --no-replace-objects --literal-pathspecs --glob-pathspecs --noglob-pathspecs --icase-pathspecs " +
		"--no-optional-locks --version --html-path --man-path --info-path",
);

/** `remote` and `reflog` are listed for their listing form; `remote add` and `reflog delete|expire` write. */
const GIT_REMOTE_READ_OPERATIONS = wordSet("show get-url");
const GIT_REFLOG_READ_OPERATIONS = wordSet("show list");

/** `git branch` / `git tag` flags that create, delete, move or rename a ref. */
const GIT_REF_MUTATING_FLAGS = [
	...["-d", "-D", "--delete", "-m", "-M", "--move", "-c", "-C", "--copy", "-f", "--force"],
	...["--edit-description", "-u", "--set-upstream-to", "--unset-upstream", "--create-reflog"],
];

/** Read-only `npm`/`yarn`/`pnpm` subcommands; `audit fix` is refused separately. */
const NODE_PM_READ_SUBCOMMANDS = wordSet("list ls view info search outdated why explain root prefix audit");

/** `curl` flags that write to disk or send a body; a body upload is exfiltration. */
const CURL_DENIED_FLAGS = [
	...["-o", "--output", "-O", "--remote-name", "--output-dir", "-T", "--upload-file", "-d", "--data", "--data-raw"],
	...["--data-binary", "--data-urlencode", "-F", "--form", "--form-string", "-K", "--config", "-X", "--request"],
	...["-c", "--cookie-jar", "-D", "--dump-header", "--trace", "--trace-ascii", "--libcurl", "--json"],
];

/** `find`/`fd` primaries that execute a command or write; `-x`, `-X`, `--exec` and `--exec-batch` are fd's. */
const FIND_DENIED_PRIMARIES = [
	...["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"],
	...["-x", "--exec", "--exec-batch", "-X"],
];

/** `rg` options that run a program: a preprocessor, the hyperlink hostname helper, or a decompressor. */
const RG_DENIED_FLAGS = ["--pre", "--pre-glob", "--hostname-bin", "--search-zip", "-z"];

/** Exact match on the flag or its `--flag=value` form; for verbs whose single-dash options are whole words (`find -maxdepth`). */
function hasFlag(args: readonly string[], flags: readonly string[]): string | undefined {
	for (const arg of args) {
		for (const flag of flags) {
			if (arg === flag || (flag.startsWith("--") && arg.startsWith(`${flag}=`))) return flag;
		}
	}
	return undefined;
}

/** `-sTv` -> `["-sTv", "-s", "-T", "-v"]`; a value-taking letter swallows the rest, so exploding over-matches, the safe side. */
function explodeShortCluster(arg: string): string[] {
	if (!arg.startsWith("-") || arg.startsWith("--") || arg.length <= 2) return [arg];
	return [arg, ...[...arg.slice(1)].map((c) => `-${c}`)];
}

/** {@link hasFlag} plus POSIX short-option bundling (`curl -sT`); `--` is deliberately not honoured, which only denies more. */
function hasBundledFlag(args: readonly string[], flags: readonly string[]): string | undefined {
	for (const raw of args) {
		for (const arg of explodeShortCluster(raw)) {
			for (const flag of flags) {
				if (arg === flag || (flag.startsWith("--") && raw.startsWith(`${flag}=`))) return flag;
			}
		}
	}
	return undefined;
}

const firstPositional = (args: readonly string[]): string | undefined => args.find((a) => !a.startsWith("-"));

function gitRule(args: readonly string[]): string | undefined {
	let i = 0;
	for (; i < args.length; i++) {
		const arg = args[i] as string;
		if (!arg.startsWith("-")) break;
		const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
		if (!GIT_SAFE_GLOBAL_FLAGS.has(name)) {
			return `\`git ${name}\` is a global git option that can set config, relocate the exec path or redirect the repository — plan mode accepts only ${[...GIT_SAFE_GLOBAL_FLAGS].join(", ")} before the subcommand`;
		}
	}
	const sub = args[i];
	if (sub === undefined) return "`git` with no subcommand";
	if (!GIT_READ_SUBCOMMANDS.has(sub)) return `\`git ${sub}\` is not a read-only git subcommand`;
	const rest = args.slice(i + 1);
	const program = gitProgramOption(sub, rest);
	if (program !== undefined) return `\`git ${program}\` runs its argument as a command or writes a file`;
	if (sub === "remote" || sub === "reflog") {
		const read = sub === "remote" ? GIT_REMOTE_READ_OPERATIONS : GIT_REFLOG_READ_OPERATIONS;
		const operation = firstPositional(rest);
		if (operation !== undefined && !read.has(operation)) return `\`git ${sub} ${operation}\` is not a read-only \`git ${sub}\` operation`;
	}
	if (sub === "branch" || sub === "tag") {
		const bad = hasBundledFlag(args, GIT_REF_MUTATING_FLAGS);
		if (bad !== undefined) return `\`git ${sub} ${bad}\` creates, deletes or moves a ref`;
		const created = firstPositional(rest);
		if (created !== undefined) return `\`git ${sub} ${created}\` would create a ref; only the listing form is read-only`;
	}
	if (sub === "config" && hasFlag(args, ["--get", "--get-all", "--get-regexp", "--list", "-l"]) === undefined) {
		return "`git config` is only read-only in its --get/--list form";
	}
	return undefined;
}

function nodePackageManagerRule(args: readonly string[]): string | undefined {
	const sub = firstPositional(args);
	if (sub === undefined) return "a package manager with no subcommand";
	if (!NODE_PM_READ_SUBCOMMANDS.has(sub)) return `\`${sub}\` is not a read-only package-manager subcommand`;
	if (sub === "audit" && args.includes("fix")) return "`audit fix` rewrites the dependency tree";
	return undefined;
}

function versionOnlyRule(verb: string, args: readonly string[], allowed: readonly string[]): string | undefined {
	if (args.length === 0) return `bare \`${verb}\` starts an interpreter`;
	if (args.every((a) => allowed.includes(a))) return undefined;
	return `\`${verb}\` is read-only only as ${allowed.join(" / ")} — every other form can execute code`;
}

/** Per-verb rules for verbs read-only in their ordinary form only; a returned string denies. These only narrow the allowlist. */
const ARGUMENT_RULES: Record<string, (args: readonly string[]) => string | undefined> = {
	git: gitRule,
	rg: (args) => {
		const bad = hasBundledFlag(args, RG_DENIED_FLAGS);
		return bad === undefined ? undefined : `\`rg ${bad}\` runs a program`;
	},
	tree: (args) => (hasBundledFlag(args, ["-o"]) === undefined ? undefined : "`tree -o` writes a file"),
	uniq: (args) => (args.filter((a) => !a.startsWith("-")).length > 1 ? "`uniq INPUT OUTPUT` writes the second file" : undefined),
	npm: nodePackageManagerRule,
	yarn: nodePackageManagerRule,
	pnpm: nodePackageManagerRule,
	node: (args) => versionOnlyRule("node", args, ["--version", "-v"]),
	python: (args) => versionOnlyRule("python", args, ["--version", "-V"]),
	python3: (args) => versionOnlyRule("python3", args, ["--version", "-V"]),
	find: (args) => {
		const bad = hasFlag(args, FIND_DENIED_PRIMARIES);
		return bad === undefined ? undefined : `\`find ${bad}\` runs a command or writes`;
	},
	fd: (args) => {
		// fd is a clap CLI, whose short options bundle (`fd -Hx cmd`).
		const bad = hasBundledFlag(args, FIND_DENIED_PRIMARIES);
		return bad === undefined ? undefined : `\`fd ${bad}\` runs a command`;
	},
	curl: (args) => {
		const bad = hasBundledFlag(args, CURL_DENIED_FLAGS);
		return bad === undefined ? undefined : `\`curl ${bad}\` writes to disk or sends a body`;
	},
	wget: (args) => {
		// wget writes a file by default, so only the stream-to-stdout form is read-only.
		const toStdout = args.includes("--output-document=-") || args.some((a, i) => (a === "-O" || a === "--output-document") && args[i + 1] === "-");
		return toStdout ? undefined : "`wget` writes a file unless it is given `-O -`";
	},
	sort: (args) => {
		const bad = hasBundledFlag(args, ["-o", "--output"]);
		return bad === undefined ? undefined : `\`sort ${bad}\` writes a file`;
	},
	date: (args) => (hasBundledFlag(args, ["-s", "--set"]) === undefined ? undefined : "`date -s` sets the system clock"),
	bat: (args) => (args.some((a, i) => a === "--pager" || a.startsWith("--pager=") || a === "--paging=always" || (a === "--paging" && args[i + 1] === "always")) ? "`bat` runs a pager, which can run commands" : undefined),
};

/** Every verb plan mode will consider at all. */
const READ_ONLY_VERBS = new Set<string>([...ALWAYS_READ_ONLY, ...Object.keys(ARGUMENT_RULES)]);

/** Plan mode's verdict for one bash command; unparseable input, an empty invocation list and an unlisted verb all deny. */
export function classifyPlanModeCommand(command: unknown): PlanModeVerdict {
	// Pi lets an earlier handler mutate event.input with no re-validation, so a non-string must deny rather than throw.
	if (typeof command !== "string" || command.trim() === "") {
		return { kind: "deny", reason: `empty or non-string command (${typeof command})` };
	}

	const verdict = canonicalise(command);
	if (verdict.kind === "refused") {
		return {
			kind: "deny",
			reason: `the shell parser refused this command (${verdict.cause}) — plan mode allows only plain read-only invocations`,
		};
	}

	const writingRedirect = verdict.redirectOperators.find((op) => op.includes(">"));
	if (writingRedirect !== undefined) {
		return { kind: "deny", reason: `redirection \`${writingRedirect}\` writes, and plan mode is read-only` };
	}

	if (verdict.invocations.length === 0) {
		return { kind: "deny", reason: "no command could be resolved from this input" };
	}

	for (const invocation of verdict.invocations) {
		const packageRunner = invocation.wrappers.find((w) => PACKAGE_RUNNER_WRAPPERS.has(w));
		if (packageRunner !== undefined) return { kind: "deny", reason: `\`${packageRunner}\` runs package code; plan mode is read-only` };
		const verb = normaliseExecutable(invocation.executable);
		// A bare `env` resolves to an empty executable with `env` as its wrapper.
		if (verb === "") return { kind: "deny", reason: "a command with no resolvable executable" };
		if (!READ_ONLY_VERBS.has(verb)) return { kind: "deny", reason: `\`${verb}\` is not on plan mode's read-only allowlist` };
		const problem = ARGUMENT_RULES[verb]?.(invocation.args);
		if (problem !== undefined) return { kind: "deny", reason: problem };
	}

	return { kind: "allow" };
}
