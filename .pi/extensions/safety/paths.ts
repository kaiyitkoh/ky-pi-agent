/**
 * One path canonicalisation, three policies over it: sensitive-read blocking, out-of-project
 * write/delete blocking, deferred-detonation write-target blocking. Pure text manipulation: no
 * `realpath`, no fs, no `process.env`, no default export; `cwd`, `home`, `projectRoot` and
 * `kubeconfigEnv` are caller-supplied. Registers nothing and never spells the tool-registration
 * call (contributing-boundary.test.ts matches it as a substring).
 *
 * Invariants:
 * - Normalise on `Word.text`, never `.value`: an unquoted `C:\Users\x\.aws\credentials` has its
 *   backslashes eaten as POSIX escapes in `.value`; stripping one pair of quotes from `.text`
 *   yields the same path for all three quoting forms.
 * - unbash expands neither `~` nor `$HOME`, so `home` is a parameter and expanded here.
 * - A leading UNC `\` pair is kept as a marker and server+share is pinned as an immutable root
 *   like a drive letter, so `\server\share\..\..\x` cannot climb off the share.
 * - Policy tables compare whole path SEGMENTS case-insensitively (NTFS), never `.includes()`:
 *   `docs/git-hooks-notes.md` and `docs/workflows.md` must not fire.
 */


/** One path argument; `text` is the raw source slice (or the literal tool parameter). `value` is carried for parity but never read by {@link canonicalisePathArg}. */
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
export type PathVerdict = { readonly kind: "allow" } | { readonly kind: "block"; readonly reason: string };

/** Facts a policy never derives itself; `projectRoot` and `kubeconfigEnv` must already be canonical (only segment-compared). */
export interface PathPolicyFacts {
	readonly projectRoot: string;
	readonly home: string;
	readonly kubeconfigEnv?: string;
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

/** `.env`, `.env.local`, `.env.production` block; `.env.example` and `.env.template` are a deliberate carve-out, since blocking documentation trains the user to disable the guard. */
function isDotEnvFile(basename: string): boolean {
	if (basename === ".env") {
		return true;
	}
	if (!basename.startsWith(".env.")) {
		return false;
	}
	const suffix = basename.slice(".env.".length).toLowerCase();
	return suffix !== "example" && suffix !== "template";
}

function parentDirOf(canonicalPath: string): string {
	const { parts } = rootedSegmentsOf(canonicalPath);
	return parts.length >= 2 ? parts[parts.length - 2] : "";
}

/** Read classes that must never reach the model: `.env`-family, `~/.aws/{credentials,config}`, kubeconfig, Terraform state. Each has a paired negative in path-policy.test.ts. */
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
];

function hasSegmentPair(parts: readonly string[], first: string, second: string): number {
	for (let i = 0; i < parts.length - 1; i += 1) {
		if (parts[i].toLowerCase() === first && parts[i + 1].toLowerCase() === second) {
			return i;
		}
	}
	return -1;
}

/** Write/delete targets that are deferred detonation: a later benign command (git hook, new shell, CI run) executes the payload, so no bash matcher sees it. Applies to bash and the `write`/`edit` tools. */
export const DETONATION_TARGETS: readonly PathPattern[] = [
	{
		id: "git-hooks",
		match: (path) => {
			const { parts } = rootedSegmentsOf(path);
			const idx = hasSegmentPair(parts, ".git", "hooks");
			return idx !== -1 && parts.length > idx + 2;
		},
		reason: (path) => `"${path}" is a git hook — a later, benign git operation executes it automatically`,
	},
	{
		id: "git-config",
		match: (path) => {
			const { parts } = rootedSegmentsOf(path);
			const idx = hasSegmentPair(parts, ".git", "config");
			return idx !== -1 && idx + 1 === parts.length - 1;
		},
		reason: (path) => `"${path}" is the repository's git config — an [alias] entry there executes on the next ordinary git command`,
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
		id: "gitlab-ci",
		match: (path) => basenameOf(path).toLowerCase() === ".gitlab-ci.yml",
		reason: (path) => `"${path}" is the GitLab CI pipeline definition — it runs on the next push, and this project's "main" auto-deploys`,
	},
];

/** Block the sensitive read classes; allow their benign neighbours (`.env.example`, `src/config.ts`). */
export function classifyPathRead(canonicalPath: string, facts: PathPolicyFacts): PathVerdict {
	for (const pattern of SENSITIVE_READ_PATTERNS) {
		if (pattern.match(canonicalPath, facts)) {
			return { kind: "block", reason: pattern.reason(canonicalPath) };
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
 * Not covered, published in docs/SAFETY.md: a `kubeconfigEnv` outside `$HOME` and wildcard globs (`.env*`).
 */
export function isSensitiveSearchRoot(canonicalPath: string, facts: PathPolicyFacts): boolean {
	const { parts } = rootedSegmentsOf(canonicalPath);
	if (isWithinRoot(canonicalPath, facts.home) && parts.some((part) => SENSITIVE_SEARCH_ROOT_SEGMENTS.has(part.toLowerCase()))) {
		return true;
	}
	return isWithinRoot(facts.home, canonicalPath);
}

/** Detonation targets block regardless of project containment, then out-of-root writes block. No allowed-outside root exists; add one explicitly rather than default open. */
export function classifyPathWrite(canonicalPath: string, facts: PathPolicyFacts): PathVerdict {
	for (const target of DETONATION_TARGETS) {
		if (target.match(canonicalPath, facts)) {
			return { kind: "block", reason: target.reason(canonicalPath) };
		}
	}
	if (!isWithinRoot(canonicalPath, facts.projectRoot)) {
		return {
			kind: "block",
			reason: `"${canonicalPath}" resolves outside the project root "${facts.projectRoot}"`,
		};
	}
	return { kind: "allow" };
}
