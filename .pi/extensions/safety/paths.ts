/**
 * SAFE-06 / SAFE-08 / SAFE-13 — one path canonicalisation, three policies over
 * it: sensitive-read blocking, out-of-project write/delete blocking, and
 * deferred-detonation write-target blocking.
 *
 * ---------------------------------------------------------------------------
 * WHY NORMALISATION READS `arg.text`, NEVER `arg.value`
 * ---------------------------------------------------------------------------
 * `tests/unit/unbash-ast.test.ts` (Plan 01) and `04-RESEARCH.md` Pitfall 3
 * both prove this by execution, re-confirmed here directly against
 * unbash 4.0.10:
 *
 *   unquoted   `cat C:\Users\Admin\.aws\credentials`
 *              text  = `C:\Users\Admin\.aws\credentials`   (raw, intact)
 *              value = `C:UsersAdmin.awscredentials`        (mangled: an
 *              unquoted backslash is a POSIX escape character to unbash, and
 *              every one of them is eaten)
 *
 *   double-quoted `cat "C:\Users\Admin\.aws\credentials"`
 *              text  = `"C:\Users\Admin\.aws\credentials"`  (raw, quotes
 *              still attached)
 *              value = `C:\Users\Admin\.aws\credentials`    (unmangled)
 *
 *   single-quoted `cat 'C:\Users\Admin\.aws\credentials'`
 *              text  = `'C:\Users\Admin\.aws\credentials'`
 *              value = `C:\Users\Admin\.aws\credentials`    (unmangled)
 *
 * A policy that reads `.value` therefore sees the SAME logical path in three
 * different shapes depending on quoting, and the unquoted shape is actively
 * broken. `.text` is the raw source slice for every one of the three forms
 * above — stripping a matched pair of surrounding quote characters from
 * `.text` yields the identical string in all three cases, which is why this
 * module normalises on `.text` and never reads `.value` at all. Verified by
 * direct execution against unbash 4.0.10 during this plan (not merely
 * inferred from Plan 01's characterisation table).
 *
 * ---------------------------------------------------------------------------
 * WHY `~` AND `$HOME` ARE EXPANDED HERE, NOT LEFT TO THE SHELL
 * ---------------------------------------------------------------------------
 * `tests/unit/unbash-ast.test.ts` proves unbash performs NO home-directory
 * expansion: `cat ~/.aws/credentials` yields `value === "~/.aws/credentials"`
 * verbatim, and `$HOME/.aws/credentials` survives as an unresolved
 * `SimpleExpansion`. A policy that never expands either would never match
 * `~/.aws/credentials` at all. `home` is a CALLER-SUPPLIED parameter — this
 * module never reads `process.env.HOME` or `os.homedir()` — which is what
 * lets `tests/unit/path-policy.test.ts` prove the rule on a fixture home that
 * may not even exist on this machine (04-CONTEXT.md `<specifics>`: an SSO
 * machine typically has no `~/.aws/credentials`; the rule must still hold).
 *
 * ---------------------------------------------------------------------------
 * WHY THE UNC LEADING `\\` PAIR IS TREATED DIFFERENTLY FROM EVERY OTHER
 * BACKSLASH
 * ---------------------------------------------------------------------------
 * `bin/bootstrap.sh:63-83` already draws this exact distinction for
 * `PI_AGENT_DIR`: a drive-letter value (`C:\...`) and a UNC value
 * (`\\server\share\...`) both arrive with backslashes on Windows, but they
 * are not the same shape, and a share root must never be treated as
 * something a `..` can climb past. This module mirrors that discrimination
 * (not bootstrap.sh's literal `tr` invocation, which collapses the UNC
 * leading pair to `//` too): the leading `\\` pair is preserved as a UNC
 * marker distinct from a drive letter, every other backslash in the string —
 * including the ones between the UNC server and share segments — becomes a
 * forward slash, and the server+share pair is then pinned as an immutable
 * root exactly the way a drive letter is, so `\\server\share\..\..\x` cannot
 * walk above the share.
 *
 * ---------------------------------------------------------------------------
 * WHY THE POLICY TABLES ARE SEGMENT-MATCHED, NOT SUBSTRING-MATCHED
 * ---------------------------------------------------------------------------
 * `04-RESEARCH.md:485` names the exact trap: "those are exact paths, not
 * patterns." A substring test for `.git/hooks` would also fire on a source
 * file legitimately named `docs/git-hooks-notes.md`, and a substring test for
 * `workflows` would fire on `docs/workflows.md` — 04-CONTEXT.md's own worked
 * example of the false positive that trains a user to disable the guard.
 * Every DETONATION_TARGETS entry and the `.aws`/`.kube` entries below compare
 * whole path SEGMENTS (case-insensitively, matching NTFS), never a raw
 * `.includes()`.
 *
 * ---------------------------------------------------------------------------
 * PURITY (matches `.pi/extensions/diagnostics/redact.ts` and
 * `.pi/extensions/safety/shell.ts`'s contract)
 * ---------------------------------------------------------------------------
 * No `ctx`, no `node:fs`, no `process.env`, no default export. `cwd`, `home`,
 * `projectRoot` and `kubeconfigEnv` are all caller-supplied parameters — this
 * is what makes every rule provable on a path, and a home directory, that do
 * not exist on disk (`existsSync` appears nowhere in this file).
 *
 * BOUNDARY RULE (BOOT-10). This module registers nothing. It does not spell
 * the tool-registration call, in code or in prose —
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`.
 */

// ---------------------------------------------------------------------------
// Input shape (Task 1)
// ---------------------------------------------------------------------------

/**
 * One path argument as it reaches this module. `text` is the raw source
 * slice (unbash `Word.text`, or the literal tool-parameter string for the
 * `read`/`write`/`edit` surface, which has no separate "raw" and "resolved"
 * form and passes the same string as both). `value` is carried for parity
 * with unbash's `Word` shape and for callers that want it for logging, but
 * {@link canonicalisePathArg} never reads it — see the module docstring.
 */
export interface PathWordArg {
	readonly text: string;
	readonly value: string;
}

/** `cwd` and `home` this module resolves relative/`~`/`$HOME` paths against — never read from the environment. */
export interface PathResolutionContext {
	readonly cwd: string;
	readonly home: string;
}

// ---------------------------------------------------------------------------
// Task 1 — canonicalisePathArg
// ---------------------------------------------------------------------------

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

/**
 * Expand a leading `~`, `~/`, `$HOME`, `$HOME/`, `${HOME}` or `${HOME}/`
 * against the caller-supplied `home`. unbash expands none of these
 * (`tests/unit/unbash-ast.test.ts`), so this module must.
 */
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

/**
 * Rewrite `/cygdrive/<x>/...` and `/<x>/...` (single-letter MSYS drive
 * prefixes) to `<X>:/...`. Checked in this order deliberately: `/cygdrive/c/`
 * is more specific and must not be mistaken for the generic single-letter
 * form (it isn't, structurally — `cygdrive` is not one character — but
 * checking it first keeps the intent explicit rather than relying on that).
 */
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

/**
 * Convert every backslash to a forward slash EXCEPT a leading UNC `\\` pair,
 * which is preserved as the UNC marker — see the module docstring.
 */
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

/**
 * Split an ALREADY forward-slash-normalised, absolute path into an immutable
 * root and the mutable segments after it. The root is what `..` can never
 * climb past — a drive letter or, for UNC, the server+share pair together
 * (climbing past the share is climbing off the share entirely, which is the
 * same class of bug as climbing past a drive letter).
 */
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
	// Forward-slash UNC (`//server/share/...`) — accepted defensively even
	// though this module never produces it itself (it preserves the
	// backslash spelling), in case a caller hands one in directly.
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

/**
 * The one path normalisation every form this project's machine produces must
 * survive: unquoted/quoted Windows paths, `/c/`, `/cygdrive/c/`, UNC, `~` and
 * `$HOME`, relative resolution against a caller-supplied `cwd`, and a
 * case-insensitively comparable drive letter that does not disturb the case
 * of the rest of the path. See the module docstring for the pipeline and why
 * each step exists.
 */
export function canonicalisePathArg(arg: PathWordArg, ctx: PathResolutionContext): string {
	const unquoted = stripSurroundingQuotes(arg.text);
	const homeExpanded = expandHome(unquoted, ctx.home);
	const driveRewritten = rewriteMsysDrivePrefix(homeExpanded);
	const slashNormalized = normalizeSlashes(driveRewritten);
	const rooted = isAbsolutePath(slashNormalized) ? slashNormalized : joinWithCwd(ctx.cwd, slashNormalized);
	return collapseSegments(rooted);
}

// ---------------------------------------------------------------------------
// Task 2 — the three path policies
// ---------------------------------------------------------------------------

/** Discriminated verdict shape, mirroring `.pi/extensions/safety/shell.ts`'s `ShellVerdict`. */
export type PathVerdict = { readonly kind: "allow" } | { readonly kind: "block"; readonly reason: string };

/**
 * Caller-supplied facts a policy needs and this module will never derive for
 * itself. `projectRoot` must already be a canonical path (the output of
 * {@link canonicalisePathArg}, or an equivalent already-normalised absolute
 * path) — this module does not re-run the full pipeline on it, it only
 * segment-compares. Same for `kubeconfigEnv`, when supplied.
 */
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

/**
 * Case-insensitive whole-path equality once both sides are reduced to root +
 * segments (never a raw string compare). IN-01: WR-17 removed
 * `policy.ts#evaluateSearchRootField`'s only call site, so this is no longer
 * exported for a caller outside this module -- it stays module-private,
 * shared by this file's own kubeconfig check and its four detonation-target
 * rules (`.bashrc`/`.bash_profile`/`.profile`/`.gitconfig`), so the "are
 * these the same canonical path" test does not get hand-rolled a second time
 * even within this one module.
 */
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

/**
 * `.env`, `.env.local`, `.env.production` block. `.env.example` and
 * `.env.template` are a DELIBERATE carve-out: those files exist to be read
 * (they are the documentation for what a real `.env` needs), and blocking
 * them makes the harness annoying in a way that trains the user to disable
 * the guard — the exact failure mode 04-CONTEXT.md's `<specifics>` names.
 */
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

/**
 * SAFE-06: the four read classes that must never reach the model's context
 * window — `.env`-family files, `~/.aws/{credentials,config}`, kubeconfig,
 * and Terraform state. Every entry is segment-matched (see module docstring)
 * and proven live, and proven NOT to fire on its nearest benign neighbour, in
 * `tests/unit/path-policy.test.ts`.
 */
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

/**
 * SAFE-13: writes/deletes into any of these are a deferred detonation no
 * bash matcher ever sees — a later, entirely benign command (a git hook
 * firing, a shell starting, a CI run) is what actually executes the payload.
 * Applies to the `write`/`edit` tool surface as well as to bash (Plan 08
 * wires the dual application; this module only classifies).
 */
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

/**
 * SAFE-06: block the four sensitive read classes; allow everything else,
 * including their nearest benign neighbours (`.env.example`, `README.md`,
 * `src/config.ts`, a file merely named `environment.ts`).
 */
export function classifyPathRead(canonicalPath: string, facts: PathPolicyFacts): PathVerdict {
	for (const pattern of SENSITIVE_READ_PATTERNS) {
		if (pattern.match(canonicalPath, facts)) {
			return { kind: "block", reason: pattern.reason(canonicalPath) };
		}
	}
	return { kind: "allow" };
}

/**
 * CR-07: directory segment names conventionally holding credential material
 * directly under a user's home directory. Distinct from
 * {@link SENSITIVE_READ_PATTERNS} (which matches a specific FILE's basename
 * plus its immediate parent segment) — this matches a recursive SEARCH ROOT
 * that IS one of these directories, or sits below one, the shape
 * `grep`/`find`/`ls`'s own `path` parameter actually is. Kept lower-case;
 * compared case-insensitively via {@link rootedSegmentsOf}'s own segments,
 * matching every other segment comparison in this module.
 */
const SENSITIVE_SEARCH_ROOT_SEGMENTS = new Set([".aws", ".kube", ".ssh", ".gnupg"]);

/**
 * CR-07: true when `canonicalPath`, used as a recursive SEARCH ROOT (never a
 * single-file target), would reach a sensitive location. `evaluateGrep`
 * (`policy.ts`) canonicalises `path`/`glob` and ran them through
 * {@link classifyPathRead} alone, whose patterns match on basename + parent
 * segment — a DIRECTORY (`~/.aws`, or the directory's own trailing-slash
 * spelling) never matches a basename+parent-segment pattern, while `grep`
 * happily recurses into it and returns file CONTENTS. Executed end to end
 * against the real `createGrepTool`: `grep { path: "~/.aws" }` returned a
 * real credential line with a bare `classifyPathRead` check returning
 * `allow`.
 *
 * Two independent ways a search root reaches a sensitive location:
 *   1. the root is `facts.home` ITSELF, or reaches BELOW it (searching a
 *      subdirectory OF `~/.aws` still walks credential files), AND one of
 *      its segments is one of {@link SENSITIVE_SEARCH_ROOT_SEGMENTS} — the
 *      HOME-anchoring is WR-14's own fix: an earlier version of this
 *      predicate matched a `.aws`/`.kube`/`.ssh`/`.gnupg` segment ANYWHERE in
 *      the path, unanchored, so a legitimate in-project path that merely
 *      contains one of those segment names (`C:/repo/tests/fixtures/.ssh/
 *      known_hosts_fixture`, `node_modules/<pkg>/.aws/`) blocked a genuine,
 *      benign search. Every one of this project's conventional per-user
 *      secret directories lives directly under `$HOME` — that is the only
 *      place this segment check has a security reason to fire at all —
 *      checked by segment membership, not a substring test, matching every
 *      other rule in this module.
 *   2. the root is `facts.home` itself, or an ANCESTOR of it
 *      (`isWithinRoot(facts.home, canonicalPath)`: is `$HOME` at or below the
 *      search root). This is what makes `path: "~"` / `path: "C:/Users/me"`
 *      itself block even though `$HOME`'s own basename is never one of
 *      {@link SENSITIVE_SEARCH_ROOT_SEGMENTS} — a search rooted AT or ABOVE
 *      home reaches every conventional secret directory without this module
 *      enumerating them individually.
 *
 * NOT covered: a caller-supplied `kubeconfigEnv` pointing OUTSIDE `$HOME`
 * entirely, and any glob WILDCARD shape (`.env*`) — both are residual,
 * PUBLISHED gaps (`docs/SAFETY.md`'s Known bypasses table), never silently
 * claimed as closed by this function.
 */
export function isSensitiveSearchRoot(canonicalPath: string, facts: PathPolicyFacts): boolean {
	const { parts } = rootedSegmentsOf(canonicalPath);
	if (isWithinRoot(canonicalPath, facts.home) && parts.some((part) => SENSITIVE_SEARCH_ROOT_SEGMENTS.has(part.toLowerCase()))) {
		return true;
	}
	return isWithinRoot(facts.home, canonicalPath);
}

/**
 * SAFE-13 first (detonation targets block regardless of project-root
 * containment — a hook OUTSIDE the project is just as dangerous as one
 * inside it), then SAFE-08 (containment). The default for anything not
 * explicitly listed as an allowed-outside root is to BLOCK — this module
 * defines no allowed-outside root at all; a later plan that needs one (a
 * system temp directory, say) must add it explicitly and name it in a
 * comment here, not default it open.
 */
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
