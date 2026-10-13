/**
 * One path canonicalisation and three policies over it: sensitive reads, out-of-project writes, deferred-detonation writes.
 * Pure text, no fs or env; `~`/`$HOME` are expanded here because unbash expands neither. Tables compare whole segments
 * case-insensitively (NTFS), never `.includes()`, so `docs/git-hooks-notes.md` does not fire. A UNC server+share is an
 * immutable root like a drive letter, so `..` cannot climb off it. Never spells the tool-registration call (a lint matches it).
 */

/** One path argument; only `text` is read. bash passes `Word.value`, so an unquoted `C:\x` loses its backslashes (docs/SAFETY.md). */
export interface PathWordArg {
	readonly text: string;
	readonly value: string;
}

/** The `cwd` and `home` relative, `~` and `$HOME` paths resolve against; never read from the environment. */
export interface PathResolutionContext {
	readonly cwd: string;
	readonly home: string;
}

function stripSurroundingQuotes(text: string): string {
	const quoted = text.length >= 2 && (text[0] === '"' || text[0] === "'") && text[text.length - 1] === text[0];
	return quoted ? text.slice(1, -1) : text;
}

const HOME_PREFIX = /^(~|\$HOME|\$\{HOME\})(\/|$)/;

function expandHome(path: string, home: string): string {
	const match = HOME_PREFIX.exec(path);
	if (match === null) return path;
	const trimmedHome = home.replace(/[/\\]+$/, "");
	return match[2] === "" ? trimmedHome : `${trimmedHome}/${path.slice(match[0].length)}`;
}

function rewriteMsysDrivePrefix(path: string): string {
	const match = /^(?:\/cygdrive)?\/([A-Za-z])(\/.*)?$/.exec(path);
	return match === null ? path : `${match[1].toUpperCase()}:${match[2] ?? "/"}`;
}

// Backslashes to slashes except a leading UNC `\\` pair, which stays as the UNC marker.
function normalizeSlashes(path: string): string {
	return path.startsWith("\\\\") ? `\\\\${path.slice(2).replace(/\\/g, "/")}` : path.replace(/\\/g, "/");
}

const isAbsolutePath = (path: string): boolean => /^([A-Za-z]:\/|\/)/.test(path) || path.startsWith("\\\\");

interface RootedSegments {
	/** The immutable root prefix: a drive (`C:`), a UNC server+share (`\\server/share`), or `/`. */
	readonly root: string;
	readonly parts: string[];
}

const splitSegments = (path: string): string[] => path.split("/").filter((p) => p.length > 0);

function rootedSegmentsOf(path: string): RootedSegments {
	// The forward-slash UNC spelling is accepted defensively.
	const unc = /^(\\\\|\/\/)/.exec(path);
	if (unc !== null) {
		const rest = splitSegments(path.slice(2));
		return { root: `${unc[1]}${rest.slice(0, 2).join("/")}`, parts: rest.slice(2) };
	}
	const drive = /^([A-Za-z]):\//.exec(path);
	if (drive !== null) return { root: `${drive[1].toUpperCase()}:`, parts: splitSegments(path.slice(drive[0].length)) };
	return { root: "/", parts: splitSegments(path) };
}

const joinRootAndParts = (root: string, parts: readonly string[]): string => `${root === "/" ? "" : root}/${parts.join("/")}`;

// Collapse `.` and `..` segments, uppercasing a leading drive letter in the same pass.
function collapseSegments(path: string): string {
	const { root, parts } = rootedSegmentsOf(path);
	const collapsed: string[] = [];
	for (const part of parts) {
		if (part === "..") collapsed.pop();
		else if (part !== ".") collapsed.push(part);
	}
	return joinRootAndParts(root, collapsed);
}

/** Canonical form of one path arg: quotes stripped, home expanded, slashes normalised, resolved against `cwd`, `.`/`..` collapsed, then the MSYS drive rewritten. */
export function canonicalisePathArg(arg: PathWordArg, ctx: PathResolutionContext): string {
	const slashNormalized = normalizeSlashes(expandHome(stripSurroundingQuotes(arg.text), ctx.home));
	const rooted = isAbsolutePath(slashNormalized) ? slashNormalized : `${normalizeSlashes(ctx.cwd).replace(/\/+$/, "")}/${slashNormalized}`;
	// The drive rewrite runs on the collapsed path, or `/./c/x` and `/tmp/../c/x` would keep root `/` and miss every home rule.
	return collapseSegments(rewriteMsysDrivePrefix(collapseSegments(rooted)));
}

/** Discriminated verdict shape, mirroring shell.ts's `ShellVerdict`. */
export type PathVerdict =
	| { readonly kind: "allow" }
	| { readonly kind: "block"; readonly reason: string }
	| { readonly kind: "ask"; readonly reason: string };

/** Facts a policy never derives itself; `projectRoot` and `kubeconfigEnv` must already be canonical (only segment-compared). */
export interface PathPolicyFacts {
	readonly projectRoot: string;
	readonly home: string;
	readonly kubeconfigEnv?: string;
	/** Canonical `core.hooksPath` directories, when the caller read them; only write classification uses them. */
	readonly hooksPaths?: readonly string[];
}

interface PathPattern {
	readonly id: string;
	readonly match: (canonicalPath: string, facts: PathPolicyFacts) => boolean;
	readonly reason: (canonicalPath: string) => string;
}

const basenameOf = (canonicalPath: string): string => rootedSegmentsOf(canonicalPath).parts.at(-1) ?? "";

const parentDirOf = (canonicalPath: string): string => rootedSegmentsOf(canonicalPath).parts.at(-2) ?? "";

const lowerSegmentsOf = (canonicalPath: string): string[] => rootedSegmentsOf(canonicalPath).parts.map((p) => p.toLowerCase());

// True when `target`'s segments start with every one of `root`'s, case-insensitively, under the same root.
function isWithinRoot(target: string, root: string): boolean {
	const t = rootedSegmentsOf(target);
	const r = rootedSegmentsOf(root);
	if (t.root.toLowerCase() !== r.root.toLowerCase() || t.parts.length < r.parts.length) return false;
	return r.parts.every((part, i) => part.toLowerCase() === t.parts[i].toLowerCase());
}

const sameCanonicalPath = (a: string, b: string): boolean => isWithinRoot(a, b) && isWithinRoot(b, a);

// `.env.example` and `.env.template` are a deliberate carve-out: blocking documentation trains the user to disable the guard.
function isDotEnvFile(basename: string): boolean {
	const lower = basename.toLowerCase();
	return lower === ".env" || (lower.startsWith(".env.") && lower !== ".env.example" && lower !== ".env.template");
}

// NTFS resolves `name:stream` and `name::$DATA` to `name`, so the final segment is matched without its stream suffix.
function stripStreamSuffix(canonicalPath: string): string {
	const { root, parts } = rootedSegmentsOf(canonicalPath);
	const last = parts.at(-1);
	if (last === undefined || !last.includes(":")) return canonicalPath;
	return joinRootAndParts(root, [...parts.slice(0, -1), last.slice(0, last.indexOf(":"))]);
}

// Windows short-name alias shape (`DOTENV~1.LOC`): it names a long file the policy tables cannot see.
const SHORT_NAME_ALIAS = /^([^~.]{1,6})~\d{1,6}(\.[^.]{0,3})?$/i;

// Long names whose 8.3 alias (`AWS~1` for `.aws`, `PIC454~1` for `.pi`) must be refused in any path segment.
const PROTECTED_LONG_NAMES = [
	...[".aws", ".ssh", ".kube", ".gnupg", ".docker", ".pi", ".git", ".github", ".gitlab-ci.yml", ".husky", ".agents", ".config"],
	...[".git-credentials", ".gitconfig", ".bashrc", ".bash_profile", ".profile", ".env", ".netrc", ".npmrc", ".terraform.d"],
	...["credentials", "id_rsa", "id_ed25519", "auth.json", "kypi-ledger"],
];

// The base an 8.3 alias is cut from: leading dots dropped, the extension removed, inner dots and spaces squeezed out.
function shortNameBase(name: string): string {
	const upper = name.replace(/^\.+/, "").toUpperCase();
	const dot = upper.lastIndexOf(".");
	return (dot === -1 ? upper : upper.slice(0, dot)).replace(/[. ]/g, "");
}

const PROTECTED_SHORT_BASES = PROTECTED_LONG_NAMES.map(shortNameBase);

// An 8.3 segment whose prefix is a truncation of a protected base, or the hashed form (two letters plus four hex digits).
function aliasesProtectedName(segment: string): boolean {
	const match = SHORT_NAME_ALIAS.exec(segment);
	if (match === null) return false;
	const prefix = match[1].toUpperCase();
	if (match[2]?.toUpperCase() === ".TFS") return true;
	const hashed = prefix.length === 6 && /^[0-9A-F]{4}$/.test(prefix.slice(2));
	return PROTECTED_SHORT_BASES.some((base) => base.startsWith(prefix) || (hashed && base.startsWith(prefix.slice(0, 2))));
}

const under = (base: string, segments: readonly string[]): string => [base.replace(/[/\\]+$/, ""), ...segments].join("/");
const homePath = (facts: PathPolicyFacts, ...segments: string[]): string => under(facts.home, segments);
const projectPath = (facts: PathPolicyFacts, ...segments: string[]): string => under(facts.projectRoot, segments);

// A pattern for one file directly at a home-relative path.
const homeFile = (id: string, segments: readonly string[], what: string): PathPattern => ({
	id,
	match: (path, facts) => sameCanonicalPath(path, under(facts.home, segments)),
	reason: (path) => `"${path}" ${what}`,
});

/** The git-dir subdirectory holding the harness's signed /execute ledger and key. */
export const HARNESS_LEDGER_SEGMENT = "kypi-ledger";

/** Read classes that must never reach the model: `.env`-family, AWS/SSH/git/docker/Pi credentials, kubeconfig, Terraform state, the harness ledger. */
export const SENSITIVE_READ_PATTERNS: readonly PathPattern[] = [
	{
		id: "dotenv",
		match: (path) => isDotEnvFile(basenameOf(path)),
		reason: (path) =>
			`"${path}" is a .env-family secrets file, not the .example/.template carve-out — its contents must never enter the model's context window`,
	},
	{
		id: "aws-credentials",
		match: (path) => parentDirOf(path).toLowerCase() === ".aws" && ["credentials", "config"].includes(basenameOf(path).toLowerCase()),
		reason: (path) => `"${path}" is an AWS credentials/config file under a ".aws" directory`,
	},
	{
		id: "kubeconfig",
		match: (path, facts) =>
			(parentDirOf(path).toLowerCase() === ".kube" && basenameOf(path).toLowerCase() === "config") ||
			(facts.kubeconfigEnv !== undefined && sameCanonicalPath(path, facts.kubeconfigEnv)),
		reason: (path) => `"${path}" is a kubeconfig file (default "~/.kube/config" location, or the caller-supplied KUBECONFIG path)`,
	},
	{
		id: "tfstate",
		match: (path) => /\.tfstate(\.backup)?$/.test(basenameOf(path).toLowerCase()),
		reason: (path) => `"${path}" is Terraform state, which holds plaintext secrets in its resource attributes`,
	},
	{
		id: "short-name-alias",
		match: (path) => SHORT_NAME_ALIAS.test(basenameOf(path)),
		reason: (path) => `"${path}" looks like a Windows 8.3 short name, which can alias a protected file; use the long file name`,
	},
	{
		id: "short-name-protected",
		match: (path) => rootedSegmentsOf(path).parts.some(aliasesProtectedName),
		reason: (path) => `"${path}" has a Windows 8.3 short-name segment that can alias a credentials or configuration directory; use the long name`,
	},
	{
		id: "home-aws",
		match: (path, facts) => isWithinRoot(path, homePath(facts, ".aws")),
		reason: (path) => `"${path}" is under ~/.aws, which holds credentials and SSO/CLI token caches`,
	},
	{
		id: "home-ssh",
		match: (path, facts) => isWithinRoot(path, homePath(facts, ".ssh")),
		reason: (path) => `"${path}" is under ~/.ssh, which holds private keys`,
	},
	homeFile("git-credentials", [".git-credentials"], "is the git credential store"),
	homeFile("docker-config", [".docker", "config.json"], "is the Docker client config, which can hold registry credentials"),
	homeFile("pi-auth", [".pi", "agent", "auth.json"], "is Pi's credential store"),
	{
		id: "home-credential-stores",
		match: (path, facts) =>
			[[".netrc"], [".npmrc"], [".terraform.d", "credentials.tfrc.json"], [".config", "gh", "hosts.yml"]].some((segments) =>
				sameCanonicalPath(path, homePath(facts, ...segments)),
			) || [[".gnupg"], [".kube"], [".config", "glab-cli"]].some((segments) => isWithinRoot(path, homePath(facts, ...segments))),
		reason: (path) => `"${path}" is a credential store (netrc, npm, Terraform, gh, glab, GnuPG or kube cache)`,
	},
	{
		id: "process-environment",
		match: (path) => {
			const { root, parts } = rootedSegmentsOf(path);
			return root === "/" && parts.length === 3 && parts[0] === "proc" && parts[2].toLowerCase() === "environ";
		},
		reason: (path) => `"${path}" is a process environment, which holds secret variables`,
	},
	{
		id: "harness-ledger",
		match: (path) => lowerSegmentsOf(path).includes(HARNESS_LEDGER_SEGMENT),
		reason: (path) => `"${path}" is the harness's signed /execute ledger or its key, which only the harness itself may read or write`,
	},
];

const HOOK_MANAGER_FILES = new Set([".pre-commit-config.yaml", ".pre-commit-config.yml", "lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".lefthook.yaml", "lefthook-local.yml"]);

/** Write/delete targets that are deferred detonation: a later benign command (git hook, new shell, CI run) executes the payload. Applies to the `write`/`edit` tools and to bash redirects and write operands. */
export const DETONATION_TARGETS: readonly PathPattern[] = [
	{
		id: "git-hooks",
		match: (path, facts) => {
			const parts = lowerSegmentsOf(path);
			const git = parts.indexOf(".git");
			const hooks = parts.indexOf("hooks", git + 1);
			// Submodule hooks live under .git/modules/<name>/hooks; core.hooksPath can name any directory.
			return (git !== -1 && hooks !== -1 && parts.length > hooks + 1) || (facts.hooksPaths ?? []).some((root) => isWithinRoot(path, root));
		},
		reason: (path) => `"${path}" is a git hook — a later, benign git operation executes it automatically`,
	},
	{
		id: "git-config",
		match: (path) => {
			const parts = lowerSegmentsOf(path);
			return parts.slice(0, -1).includes(".git") && ["config", "config.worktree"].includes(parts.at(-1) ?? "");
		},
		reason: (path) => `"${path}" is a git config file — an [alias] entry there executes on the next ordinary git command`,
	},
	{
		id: "hook-manager",
		match: (path) => {
			const parts = lowerSegmentsOf(path);
			return parts.slice(0, -1).includes(".husky") || HOOK_MANAGER_FILES.has(parts.at(-1) ?? "");
		},
		reason: (path) => `"${path}" configures a git hook manager (husky, pre-commit, lefthook) — the next commit or push runs it`,
	},
	homeFile("bashrc", [".bashrc"], "is the user's shell rc file — it executes on every new shell"),
	homeFile("bash-profile", [".bash_profile"], "is the user's shell profile — it executes on every new login shell"),
	homeFile("profile", [".profile"], "is the user's POSIX shell profile — it executes on every new login shell"),
	homeFile("gitconfig", [".gitconfig"], "is the user's global git config — an [alias] entry there executes on the next ordinary git command"),
	{
		id: "github-workflows",
		match: (path) => {
			const parts = lowerSegmentsOf(path);
			return parts.at(-3) === ".github" && parts.at(-2) === "workflows" && /\.ya?ml$/.test(parts.at(-1) ?? "");
		},
		reason: (path) => `"${path}" is a GitHub Actions workflow — it runs on the next push/PR event, on GitHub's infrastructure`,
	},
	{
		id: "agent-definitions",
		match: (path, facts) =>
			[projectPath(facts, ".pi", "agents"), projectPath(facts, ".agents"), homePath(facts, ".pi", "agent", "agents")].some((root) => isWithinRoot(path, root)),
		reason: (path) => `"${path}" is a subagent definition; agent definitions are edited by a human outside Pi`,
	},
	{
		id: "pi-settings",
		match: (path, facts) =>
			sameCanonicalPath(path, homePath(facts, ".pi", "agent", "settings.json")) || sameCanonicalPath(path, projectPath(facts, ".pi", "settings.json")),
		reason: (path) => `"${path}" is a Pi settings file that points at agent definitions; it is edited by a human outside Pi`,
	},
	{
		id: "gitlab-ci",
		match: (path) => basenameOf(path).toLowerCase() === ".gitlab-ci.yml",
		reason: (path) => `"${path}" is the GitLab CI pipeline definition — it runs on the next push, and this project's "main" auto-deploys`,
	},
];

/** Extension code Pi runs in-process at the next start or `/reload`, the guard included: a write needs a human confirm. */
export const GUARD_CODE_TARGETS: readonly PathPattern[] = [
	{
		id: "extension-code",
		match: (path, facts) =>
			[projectPath(facts, ".pi", "extensions"), projectPath(facts, ".pi", "npm"), homePath(facts, ".pi", "agent", "extensions"), homePath(facts, ".pi", "agent", "npm")].some(
				(root) => isWithinRoot(path, root),
			) || sameCanonicalPath(path, homePath(facts, ".pi", "agent", "models.json")),
		reason: (path) => `"${path}" is extension code or provider config that Pi loads with full permissions, the safety guard included`,
	},
];

/** Block the sensitive read classes; allow their benign neighbours (`.env.example`, `src/config.ts`). `ignore` names pattern ids to skip. */
export function classifyPathRead(canonicalPath: string, facts: PathPolicyFacts, ignore: readonly string[] = []): PathVerdict {
	const target = stripStreamSuffix(canonicalPath);
	const hit = SENSITIVE_READ_PATTERNS.find((pattern) => !ignore.includes(pattern.id) && pattern.match(target, facts));
	return hit === undefined ? { kind: "allow" } : { kind: "block", reason: hit.reason(canonicalPath) };
}

/** Names a glob is probed against; a basename glob that can match any of them is treated as a secret read. */
export const SENSITIVE_NAME_PROBES: readonly string[] = [
	".env", ".env.local", ".env.production", "credentials", "id_rsa", "id_ed25519", ".git-credentials", "auth.json", "terraform.tfstate",
];

const GLOB_META = /[*?[{]/;

// Home-level directories holding credentials, matched as a search-root segment or a wildcard directory under home.
const SENSITIVE_SEARCH_ROOT_SEGMENTS: readonly string[] = [".aws", ".kube", ".ssh", ".gnupg"];

// Compile one glob segment (`*`, `?`, `[..]`, `{a,b}`) to a case-insensitive anchored regex.
function globSegmentRegex(segment: string): RegExp {
	let out = "";
	let braceDepth = 0;
	for (let i = 0; i < segment.length; i += 1) {
		const ch = segment[i];
		if (ch === "*") {
			out += "[^/]*";
		} else if (ch === "?") {
			out += "[^/]";
		} else if (ch === "[") {
			const close = segment.indexOf("]", i + 2);
			if (close === -1) {
				out += "\\[";
			} else {
				const body = segment.slice(i + 1, close);
				out += `[${body.startsWith("!") ? `^${body.slice(1)}` : body}]`;
				i = close;
			}
		} else if (ch === "{") {
			braceDepth += 1;
			out += "(?:";
		} else if (ch === "}" && braceDepth > 0) {
			braceDepth -= 1;
			out += ")";
		} else if (ch === "," && braceDepth > 0) {
			out += "|";
		} else {
			out += ch.replace(/[.+^$()|\\\]{}]/g, "\\$&");
		}
	}
	out += ")".repeat(braceDepth);
	try {
		return new RegExp(`^(?:${out})$`, "i");
	} catch {
		// An uncompilable class matches everything so the caller fails closed.
		return /^/;
	}
}

/**
 * Block a glob that can reach a sensitive read: a literal directory prefix inside a sensitive root, a wildcard
 * directory under home that can match one, or a basename glob that can match a probe name.
 * A glob without metacharacters is classified as a literal path.
 */
export function classifyReadGlob(canonicalGlob: string, facts: PathPolicyFacts): PathVerdict {
	if (!GLOB_META.test(canonicalGlob)) return classifyPathRead(canonicalGlob, facts);
	const { root, parts } = rootedSegmentsOf(canonicalGlob);
	const firstMeta = parts.findIndex((part) => GLOB_META.test(part));
	const prefix = joinRootAndParts(root, parts.slice(0, firstMeta));
	if (isSensitiveSearchRoot(prefix, facts)) {
		return { kind: "block", reason: `"${canonicalGlob}" expands inside a directory that holds credentials` };
	}
	if (firstMeta < parts.length - 1 && sameCanonicalPath(prefix, facts.home)) {
		const re = globSegmentRegex(parts[firstMeta]);
		if (SENSITIVE_SEARCH_ROOT_SEGMENTS.some((name) => re.test(name))) {
			return { kind: "block", reason: `"${canonicalGlob}" has a wildcard directory that can match a credentials directory` };
		}
	}
	const base = parts[parts.length - 1];
	const baseRe = GLOB_META.test(base) ? globSegmentRegex(base) : undefined;
	const hit = baseRe === undefined ? undefined : SENSITIVE_NAME_PROBES.find((name) => baseRe.test(name));
	return hit === undefined ? { kind: "allow" } : { kind: "block", reason: `"${canonicalGlob}" can match "${hit}", a secrets file` };
}

/**
 * True when a recursive search root reaches a credentials directory below `$HOME`, or is `$HOME` or an ancestor of it.
 * Anchored to home, so `tests/fixtures/.ssh/` does not fire; a `kubeconfigEnv` outside home is a published gap (docs/SAFETY.md).
 */
export function isSensitiveSearchRoot(canonicalPath: string, facts: PathPolicyFacts): boolean {
	const belowHome = isWithinRoot(canonicalPath, facts.home) && lowerSegmentsOf(canonicalPath).some((part) => SENSITIVE_SEARCH_ROOT_SEGMENTS.includes(part));
	return belowHome || isWithinRoot(facts.home, canonicalPath);
}

// Read classes that block a write too: the ledger, and an 8.3 segment that can alias a protected name.
// Resolved at load, in this order, so a renamed id throws instead of silently allowing the write.
const WRITE_BLOCKS: readonly PathPattern[] = [
	...DETONATION_TARGETS,
	...["harness-ledger", "short-name-protected"].map((id) => {
		const pattern = SENSITIVE_READ_PATTERNS.find((p) => p.id === id);
		if (pattern === undefined) throw new Error(`paths.ts: no sensitive-read pattern "${id}"`);
		return pattern;
	}),
];

/** Detonation targets block regardless of project containment, then writes outside the project and the caller's explicit `scratchRoots` block; extension code asks. */
export function classifyPathWrite(rawCanonicalPath: string, facts: PathPolicyFacts, scratchRoots: readonly string[] = []): PathVerdict {
	const canonicalPath = stripStreamSuffix(rawCanonicalPath);
	const blocked = WRITE_BLOCKS.find((target) => target.match(canonicalPath, facts));
	if (blocked !== undefined) return { kind: "block", reason: blocked.reason(canonicalPath) };
	if (![facts.projectRoot, ...scratchRoots].some((root) => isWithinRoot(canonicalPath, root))) {
		return { kind: "block", reason: `"${canonicalPath}" resolves outside the project root "${facts.projectRoot}"` };
	}
	const guardCode = GUARD_CODE_TARGETS.find((target) => target.match(canonicalPath, facts));
	return guardCode !== undefined ? { kind: "ask", reason: guardCode.reason(canonicalPath) } : { kind: "allow" };
}
