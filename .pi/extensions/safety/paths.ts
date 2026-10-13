/**
 * One path canonicalisation, three policies over it: sensitive-read blocking, out-of-project
 * write/delete blocking, deferred-detonation write-target blocking. Pure text manipulation: no
 * `realpath`, no fs, no `process.env`, no default export; `cwd`, `home`, `projectRoot` and
 * `kubeconfigEnv` are caller-supplied. Registers nothing and never spells the tool-registration
 * call (contributing-boundary.test.ts matches it as a substring).
 *
 * Invariants:
 * - Normalises whatever arrives in `.text` and never reads `.value`. The bash caller currently passes
 *   `Word.value`, which eats an unquoted `C:\Users\x\.aws\credentials`'s backslashes as POSIX escapes,
 *   so that form is NOT blocked through bash (docs/SAFETY.md known bypasses).
 * - unbash expands neither `~` nor `$HOME`, so `home` is a parameter and expanded here.
 * - A leading UNC `\` pair is kept as a marker and server+share is pinned as an immutable root
 *   like a drive letter, so `\server\share\..\..\x` cannot climb off the share.
 * - Policy tables compare whole path SEGMENTS case-insensitively (NTFS), never `.includes()`:
 *   `docs/git-hooks-notes.md` and `docs/workflows.md` must not fire.
 */


/** One path argument; `text` should be the raw source slice or tool parameter (bash args currently pass `Word.value`). `value` is never read by {@link canonicalisePathArg}. */
export interface PathWordArg {
	readonly text: string;
	readonly value: string;
}

/** `cwd` and `home` this module resolves relative/`~`/`$HOME` paths against — never read from the environment. */
export interface PathResolutionContext {
	readonly cwd: string;
	readonly home: string;
}


/** Strip one matched pair of surrounding `"` or `'` characters, if present. */
function stripSurroundingQuotes(text: string): string {
	if (text.length >= 2) {
		const first = text[0];
		const last = text[text.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			return text.slice(1, -1);
		}
	}
	return text;
}

/** Expand a leading `~`, `$HOME` or `${HOME}` against `home`; unbash expands none of them. */
function expandHome(path: string, home: string): string {
	const trimmedHome = home.replace(/[/\\]+$/, "");
	const prefixes = ["~/", "$HOME/", "${HOME}/"];
	for (const prefix of prefixes) {
		if (path.startsWith(prefix)) {
			return `${trimmedHome}/${path.slice(prefix.length)}`;
		}
	}
	const bare = ["~", "$HOME", "${HOME}"];
	for (const token of bare) {
		if (path === token) {
			return trimmedHome;
		}
	}
	return path;
}

/** Rewrite MSYS drive prefixes `/cygdrive/<x>/...` and `/<x>/...` to `<X>:/...`. */
function rewriteMsysDrivePrefix(path: string): string {
	const cygdrive = /^\/cygdrive\/([A-Za-z])(\/.*)?$/.exec(path);
	if (cygdrive !== undefined && cygdrive !== null) {
		const [, letter, rest] = cygdrive;
		return `${letter.toUpperCase()}:${rest ?? "/"}`;
	}
	const msys = /^\/([A-Za-z])(\/.*)?$/.exec(path);
	if (msys !== undefined && msys !== null) {
		const [, letter, rest] = msys;
		return `${letter.toUpperCase()}:${rest ?? "/"}`;
	}
	return path;
}

/** Backslashes to slashes except a leading UNC `\` pair, which stays as the UNC marker. */
function normalizeSlashes(path: string): string {
	if (path.startsWith("\\\\")) {
		return "\\\\" + path.slice(2).replace(/\\/g, "/");
	}
	return path.replace(/\\/g, "/");
}

/** True if `path` is already rooted (drive letter, UNC in either spelling, or a bare leading slash). */
function isAbsolutePath(path: string): boolean {
	if (/^[A-Za-z]:\//.test(path)) {
		return true;
	}
	if (path.startsWith("\\\\") || path.startsWith("//")) {
		return true;
	}
	return path.startsWith("/");
}

interface RootedSegments {
	/** The immutable root prefix: a drive (`C:`), a UNC server+share (`\\server/share`), or `/`. */
	readonly root: string;
	/** Every segment after the root, in order, never including the root's own components. */
	readonly parts: string[];
}

/** Split a slash-normalised absolute path into an immutable root (drive, or UNC server+share) that `..` cannot climb past, and the segments after it. */
function rootedSegmentsOf(path: string): RootedSegments {
	if (path.startsWith("\\\\")) {
		const rest = path.slice(2).split("/").filter((p) => p.length > 0);
		const root = `\\\\${rest.slice(0, 2).join("/")}`;
		return { root, parts: rest.slice(2) };
	}
	const driveMatch = /^([A-Za-z]):\//.exec(path);
	if (driveMatch !== undefined && driveMatch !== null) {
		const root = `${driveMatch[1].toUpperCase()}:`;
		const rest = path.slice(driveMatch[0].length);
		return { root, parts: rest.split("/").filter((p) => p.length > 0) };
	}
	// Forward-slash UNC, accepted defensively if a caller passes one in.
	if (path.startsWith("//")) {
		const rest = path.slice(2).split("/").filter((p) => p.length > 0);
		const root = `//${rest.slice(0, 2).join("/")}`;
		return { root, parts: rest.slice(2) };
	}
	return { root: "/", parts: path.split("/").filter((p) => p.length > 0) };
}

function joinRootAndParts(root: string, parts: readonly string[]): string {
	if (root === "/") {
		return `/${parts.join("/")}`;
	}
	return `${root}/${parts.join("/")}`;
}

/** Collapse `.` and `..` segments, uppercasing a leading drive letter as part of the same pass (see {@link rootedSegmentsOf}). */
function collapseSegments(path: string): string {
	const { root, parts } = rootedSegmentsOf(path);
	const collapsed: string[] = [];
	for (const part of parts) {
		if (part === ".") {
			continue;
		}
		if (part === "..") {
			if (collapsed.length > 0) {
				collapsed.pop();
			}
			continue;
		}
		collapsed.push(part);
	}
	return joinRootAndParts(root, collapsed);
}

function joinWithCwd(cwd: string, relative: string): string {
	const normalizedCwd = normalizeSlashes(cwd).replace(/\/+$/, "");
	return `${normalizedCwd}/${relative}`;
}

/** Canonical form of one path arg: quotes stripped, home expanded, MSYS/UNC/backslashes normalised, resolved against `cwd`, drive letter upper-cased, `.`/`..` collapsed. */
export function canonicalisePathArg(arg: PathWordArg, ctx: PathResolutionContext): string {
	const unquoted = stripSurroundingQuotes(arg.text);
	const homeExpanded = expandHome(unquoted, ctx.home);
	const driveRewritten = rewriteMsysDrivePrefix(homeExpanded);
	const slashNormalized = normalizeSlashes(driveRewritten);
	const rooted = isAbsolutePath(slashNormalized) ? slashNormalized : joinWithCwd(ctx.cwd, slashNormalized);
	return collapseSegments(rooted);
}


/** Discriminated verdict shape, mirroring `.pi/extensions/safety/shell.ts`'s `ShellVerdict`. */
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

function basenameOf(canonicalPath: string): string {
	const { parts } = rootedSegmentsOf(canonicalPath);
	return parts.length > 0 ? parts[parts.length - 1] : "";
}

/** Case-insensitive whole-path equality on root + segments, never a raw string compare. */
function sameCanonicalPath(a: string, b: string): boolean {
	const left = rootedSegmentsOf(a);
	const right = rootedSegmentsOf(b);
	if (left.root.toLowerCase() !== right.root.toLowerCase()) {
		return false;
	}
	if (left.parts.length !== right.parts.length) {
		return false;
	}
	return left.parts.every((part, i) => part.toLowerCase() === right.parts[i].toLowerCase());
}

/** True when `target`'s segments start with every one of `root`'s segments, case-insensitively, under the same root. */
function isWithinRoot(target: string, root: string): boolean {
	const t = rootedSegmentsOf(target);
	const r = rootedSegmentsOf(root);
	if (t.root.toLowerCase() !== r.root.toLowerCase()) {
		return false;
	}
	if (t.parts.length < r.parts.length) {
		return false;
	}
	return r.parts.every((part, i) => part.toLowerCase() === t.parts[i].toLowerCase());
}

/** `.env`, `.env.local`, `.env.production` block in any letter case; `.env.example` and `.env.template` are a deliberate carve-out, since blocking documentation trains the user to disable the guard. */
function isDotEnvFile(basename: string): boolean {
	const lower = basename.toLowerCase();
	if (lower === ".env") {
		return true;
	}
	if (!lower.startsWith(".env.")) {
		return false;
	}
	const suffix = lower.slice(".env.".length);
	return suffix !== "example" && suffix !== "template";
}

/** NTFS resolves `name:stream` and `name::$DATA` to `name`, so the final segment is matched without its stream suffix. */
function stripStreamSuffix(canonicalPath: string): string {
	const { root, parts } = rootedSegmentsOf(canonicalPath);
	if (parts.length === 0) {
		return canonicalPath;
	}
	const last = parts[parts.length - 1];
	const colon = last.indexOf(":");
	if (colon === -1) {
		return canonicalPath;
	}
	return joinRootAndParts(root, [...parts.slice(0, -1), last.slice(0, colon)]);
}

/** Windows short-name alias shape (`DOTENV~1.LOC`): it names a long file the policy tables cannot see. */
const SHORT_NAME_ALIAS = /^([^~.]{1,6})~\d{1,6}(\.[^.]{0,3})?$/i;

/** Long names whose 8.3 alias (`AWS~1` for `.aws`, `PIC454~1` for `.pi`) must be refused in any path segment. */
const PROTECTED_LONG_NAMES = [
	...[".aws", ".ssh", ".kube", ".gnupg", ".docker", ".pi", ".git", ".github", ".gitlab-ci.yml", ".husky", ".agents", ".config"],
	...[".git-credentials", ".gitconfig", ".bashrc", ".bash_profile", ".profile", ".env", ".netrc", ".npmrc", ".terraform.d"],
	...["credentials", "id_rsa", "id_ed25519", "auth.json", "kypi-ledger"],
];

/** The base an 8.3 alias is cut from: leading dots dropped, the extension removed, inner dots and spaces squeezed out. */
function shortNameBase(name: string): string {
	const upper = name.replace(/^\.+/, "").toUpperCase();
	const dot = upper.lastIndexOf(".");
	return (dot === -1 ? upper : upper.slice(0, dot)).replace(/[. ]/g, "");
}

const PROTECTED_SHORT_BASES = PROTECTED_LONG_NAMES.map(shortNameBase);

/** An 8.3 segment whose prefix is a truncation of a protected base, or the hashed form (two letters plus four hex digits). */
function aliasesProtectedName(segment: string): boolean {
	const match = SHORT_NAME_ALIAS.exec(segment);
	if (match === null) return false;
	const prefix = match[1].toUpperCase();
	if (match[2]?.toUpperCase() === ".TFS") return true;
	const hashed = prefix.length === 6 && /^[0-9A-F]{4}$/.test(prefix.slice(2));
	return PROTECTED_SHORT_BASES.some((base) => base.startsWith(prefix) || (hashed && base.startsWith(prefix.slice(0, 2))));
}

function homePath(facts: PathPolicyFacts, ...segments: string[]): string {
	return [facts.home.replace(/[/\\]+$/, ""), ...segments].join("/");
}

function projectPath(facts: PathPolicyFacts, ...segments: string[]): string {
	return [facts.projectRoot.replace(/[/\\]+$/, ""), ...segments].join("/");
}

function parentDirOf(canonicalPath: string): string {
	const { parts } = rootedSegmentsOf(canonicalPath);
	return parts.length >= 2 ? parts[parts.length - 2] : "";
}

/** The git-dir subdirectory holding the harness's signed /execute ledger and key. */
export const HARNESS_LEDGER_SEGMENT = "kypi-ledger";

/** Read classes that must never reach the model: `.env`-family, AWS/SSH/git/docker/Pi credentials, kubeconfig, Terraform state, the harness ledger. Each has a paired negative in path-policy.test.ts. */
export const SENSITIVE_READ_PATTERNS: readonly PathPattern[] = [
	{
		id: "dotenv",
		match: (path) => isDotEnvFile(basenameOf(path)),
		reason: (path) =>
			`"${path}" is a .env-family secrets file, not the .example/.template carve-out — its contents must never enter the model's context window`,
	},
	{
		id: "aws-credentials",
		match: (path) => {
			const base = basenameOf(path).toLowerCase();
			return parentDirOf(path).toLowerCase() === ".aws" && (base === "credentials" || base === "config");
		},
		reason: (path) => `"${path}" is an AWS credentials/config file under a ".aws" directory`,
	},
	{
		id: "kubeconfig",
		match: (path, facts) => {
			const base = basenameOf(path).toLowerCase();
			const isDefaultKubeconfig = parentDirOf(path).toLowerCase() === ".kube" && base === "config";
			const isNamedKubeconfig = facts.kubeconfigEnv !== undefined && sameCanonicalPath(path, facts.kubeconfigEnv);
			return isDefaultKubeconfig || isNamedKubeconfig;
		},
		reason: (path) => `"${path}" is a kubeconfig file (default "~/.kube/config" location, or the caller-supplied KUBECONFIG path)`,
	},
	{
		id: "tfstate",
		match: (path) => {
			const base = basenameOf(path).toLowerCase();
			return base.endsWith(".tfstate") || base.endsWith(".tfstate.backup");
		},
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
	{
		id: "git-credentials",
		match: (path, facts) => sameCanonicalPath(path, homePath(facts, ".git-credentials")),
		reason: (path) => `"${path}" is the git credential store`,
	},
	{
		id: "docker-config",
		match: (path, facts) => sameCanonicalPath(path, homePath(facts, ".docker", "config.json")),
		reason: (path) => `"${path}" is the Docker client config, which can hold registry credentials`,
	},
	{
		id: "pi-auth",
		match: (path, facts) => sameCanonicalPath(path, homePath(facts, ".pi", "agent", "auth.json")),
		reason: (path) => `"${path}" is Pi's credential store`,
	},
	{
		id: "harness-ledger",
		match: (path) => rootedSegmentsOf(path).parts.some((part) => part.toLowerCase() === HARNESS_LEDGER_SEGMENT),
		reason: (path) => `"${path}" is the harness's signed /execute ledger or its key, which only the harness itself may read or write`,
	},
];

const HOOK_MANAGER_FILES = new Set([".pre-commit-config.yaml", ".pre-commit-config.yml", "lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".lefthook.yaml", "lefthook-local.yml"]);

function hasSegmentPair(parts: readonly string[], first: string, second: string): number {
	for (let i = 0; i < parts.length - 1; i += 1) {
		if (parts[i].toLowerCase() === first && parts[i + 1].toLowerCase() === second) {
			return i;
		}
	}
	return -1;
}

/** Write/delete targets that are deferred detonation: a later benign command (git hook, new shell, CI run) executes the payload. Applies to the `write`/`edit` tools and to bash redirects and write operands. */
export const DETONATION_TARGETS: readonly PathPattern[] = [
	{
		id: "git-hooks",
		match: (path, facts) => {
			const parts = rootedSegmentsOf(path).parts.map((p) => p.toLowerCase());
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
			const parts = rootedSegmentsOf(path).parts.map((p) => p.toLowerCase());
			const base = parts[parts.length - 1];
			return parts.slice(0, -1).includes(".git") && (base === "config" || base === "config.worktree");
		},
		reason: (path) => `"${path}" is a git config file — an [alias] entry there executes on the next ordinary git command`,
	},
	{
		id: "hook-manager",
		match: (path) => {
			const parts = rootedSegmentsOf(path).parts.map((p) => p.toLowerCase());
			const base = parts[parts.length - 1] ?? "";
			return parts.slice(0, -1).includes(".husky") || HOOK_MANAGER_FILES.has(base);
		},
		reason: (path) => `"${path}" configures a git hook manager (husky, pre-commit, lefthook) — the next commit or push runs it`,
	},
	{
		id: "bashrc",
		match: (path, facts) => sameCanonicalPath(path, `${facts.home.replace(/[/\\]+$/, "")}/.bashrc`),
		reason: (path) => `"${path}" is the user's shell rc file — it executes on every new shell`,
	},
	{
		id: "bash-profile",
		match: (path, facts) => sameCanonicalPath(path, `${facts.home.replace(/[/\\]+$/, "")}/.bash_profile`),
		reason: (path) => `"${path}" is the user's shell profile — it executes on every new login shell`,
	},
	{
		id: "profile",
		match: (path, facts) => sameCanonicalPath(path, `${facts.home.replace(/[/\\]+$/, "")}/.profile`),
		reason: (path) => `"${path}" is the user's POSIX shell profile — it executes on every new login shell`,
	},
	{
		id: "gitconfig",
		match: (path, facts) => sameCanonicalPath(path, `${facts.home.replace(/[/\\]+$/, "")}/.gitconfig`),
		reason: (path) => `"${path}" is the user's global git config — an [alias] entry there executes on the next ordinary git command`,
	},
	{
		id: "github-workflows",
		match: (path) => {
			const { parts } = rootedSegmentsOf(path);
			const idx = hasSegmentPair(parts, ".github", "workflows");
			if (idx === -1 || idx + 2 !== parts.length - 1) {
				return false;
			}
			const file = parts[parts.length - 1].toLowerCase();
			return file.endsWith(".yml") || file.endsWith(".yaml");
		},
		reason: (path) => `"${path}" is a GitHub Actions workflow — it runs on the next push/PR event, on GitHub's infrastructure`,
	},
	{
		id: "agent-definitions",
		match: (path, facts) =>
			isWithinRoot(path, projectPath(facts, ".pi", "agents")) ||
			isWithinRoot(path, projectPath(facts, ".agents")) ||
			isWithinRoot(path, homePath(facts, ".pi", "agent", "agents")),
		reason: (path) => `"${path}" is a subagent definition; agent definitions are edited by a human outside Pi`,
	},
	{
		id: "pi-settings",
		match: (path, facts) =>
			sameCanonicalPath(path, homePath(facts, ".pi", "agent", "settings.json")) ||
			sameCanonicalPath(path, projectPath(facts, ".pi", "settings.json")),
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
		match: (path, facts) => {
			const roots = [projectPath(facts, ".pi", "extensions"), projectPath(facts, ".pi", "npm")];
			roots.push(homePath(facts, ".pi", "agent", "extensions"), homePath(facts, ".pi", "agent", "npm"));
			return roots.some((root) => isWithinRoot(path, root)) || sameCanonicalPath(path, homePath(facts, ".pi", "agent", "models.json"));
		},
		reason: (path) => `"${path}" is extension code or provider config that Pi loads with full permissions, the safety guard included`,
	},
];

/** Block the sensitive read classes; allow their benign neighbours (`.env.example`, `src/config.ts`). `ignore` names pattern ids to skip. */
export function classifyPathRead(canonicalPath: string, facts: PathPolicyFacts, ignore: readonly string[] = []): PathVerdict {
	const target = stripStreamSuffix(canonicalPath);
	for (const pattern of SENSITIVE_READ_PATTERNS) {
		if (!ignore.includes(pattern.id) && pattern.match(target, facts)) {
			return { kind: "block", reason: pattern.reason(canonicalPath) };
		}
	}
	return { kind: "allow" };
}

/** Names a glob is probed against; a basename glob that can match any of them is treated as a secret read. */
export const SENSITIVE_NAME_PROBES: readonly string[] = [
	".env",
	".env.local",
	".env.production",
	"credentials",
	"id_rsa",
	"id_ed25519",
	".git-credentials",
	"auth.json",
	"terraform.tfstate",
];

const GLOB_META = /[*?[{]/;
const SENSITIVE_DIR_NAMES: readonly string[] = [".aws", ".kube", ".ssh", ".gnupg"];

/** Compile one glob segment (`*`, `?`, `[..]`, `{a,b}`) to a case-insensitive anchored regex. */
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
	if (!GLOB_META.test(canonicalGlob)) {
		return classifyPathRead(canonicalGlob, facts);
	}
	const { root, parts } = rootedSegmentsOf(canonicalGlob);
	const firstMeta = parts.findIndex((part) => GLOB_META.test(part));
	const prefix = joinRootAndParts(root, parts.slice(0, firstMeta));
	if (isSensitiveSearchRoot(prefix, facts)) {
		return { kind: "block", reason: `"${canonicalGlob}" expands inside a directory that holds credentials` };
	}
	if (firstMeta < parts.length - 1 && sameCanonicalPath(prefix, facts.home)) {
		const re = globSegmentRegex(parts[firstMeta]);
		if (SENSITIVE_DIR_NAMES.some((name) => re.test(name))) {
			return { kind: "block", reason: `"${canonicalGlob}" has a wildcard directory that can match a credentials directory` };
		}
	}
	const base = parts[parts.length - 1];
	if (GLOB_META.test(base)) {
		const re = globSegmentRegex(base);
		const hit = SENSITIVE_NAME_PROBES.find((name) => re.test(name));
		if (hit !== undefined) {
			return { kind: "block", reason: `"${canonicalGlob}" can match "${hit}", a secrets file` };
		}
	}
	return { kind: "allow" };
}

/** Home-level directories holding credentials; matched as a SEARCH ROOT segment, case-insensitively. */
const SENSITIVE_SEARCH_ROOT_SEGMENTS = new Set([".aws", ".kube", ".ssh", ".gnupg"]);

/**
 * True when a recursive SEARCH ROOT (`grep`/`find`/`ls` path) would reach a sensitive location.
 * `classifyPathRead` matches file basename + parent, so a directory like `~/.aws` slipped through
 * while grep recursed into it. Blocks when:
 * - the root is at or below `$HOME` and a segment is in {@link SENSITIVE_SEARCH_ROOT_SEGMENTS}
 *   (anchored to home: an unanchored match blocked `tests/fixtures/.ssh/` and `node_modules/x/.aws/`);
 * - the root is `$HOME` or an ancestor of it, which reaches every secret directory.
 * Not covered, published in docs/SAFETY.md: a `kubeconfigEnv` outside `$HOME`.
 */
export function isSensitiveSearchRoot(canonicalPath: string, facts: PathPolicyFacts): boolean {
	const { parts } = rootedSegmentsOf(canonicalPath);
	if (isWithinRoot(canonicalPath, facts.home) && parts.some((part) => SENSITIVE_SEARCH_ROOT_SEGMENTS.has(part.toLowerCase()))) {
		return true;
	}
	return isWithinRoot(facts.home, canonicalPath);
}

/** Detonation targets block regardless of project containment, then writes outside the project and the caller's explicit `scratchRoots` block; extension code asks. */
export function classifyPathWrite(rawCanonicalPath: string, facts: PathPolicyFacts, scratchRoots: readonly string[] = []): PathVerdict {
	const canonicalPath = stripStreamSuffix(rawCanonicalPath);
	for (const target of DETONATION_TARGETS) {
		if (target.match(canonicalPath, facts)) {
			return { kind: "block", reason: target.reason(canonicalPath) };
		}
	}
	for (const id of ["harness-ledger", "short-name-protected"]) {
		const pattern = SENSITIVE_READ_PATTERNS.find((p) => p.id === id);
		if (pattern?.match(canonicalPath, facts) === true) return { kind: "block", reason: pattern.reason(canonicalPath) };
	}
	if (![facts.projectRoot, ...scratchRoots].some((root) => isWithinRoot(canonicalPath, root))) {
		return {
			kind: "block",
			reason: `"${canonicalPath}" resolves outside the project root "${facts.projectRoot}"`,
		};
	}
	const guardCode = GUARD_CODE_TARGETS.find((target) => target.match(canonicalPath, facts));
	return guardCode !== undefined ? { kind: "ask", reason: guardCode.reason(canonicalPath) } : { kind: "allow" };
}
