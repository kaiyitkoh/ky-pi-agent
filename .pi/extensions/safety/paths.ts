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
