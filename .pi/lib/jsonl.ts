/**
 * Generic append-only JSONL writer with size-based rotation and dated
 * retention. Owned base names and per-stream size caps are the caller's
 * business; this module knows nothing about which subsystem is calling it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS, AND WHY IT LIVES OUTSIDE `.pi/extensions/`
 * ---------------------------------------------------------------------------
 * Phase 2 built and hardened this writer inside `.pi/extensions/diagnostics/
 * jsonl.ts`: rotation races, path-confinement falsification (`..` slips past
 * containment, `wire/../../evil` slips past a loosened allowlist — each catches
 * inputs the other does not) and a four-concurrent-process append proof all
 * happened against that file. Phase 4's safety audit log (SAFE-14) needs the
 * SAME hardened writer, not a second one written under time pressure — but
 * `safety/` may import nothing from `diagnostics/` (CONTEXT.md decision 7: the
 * credential/exec path must be source-reviewable in isolation). So the generic
 * machinery moved here, to a location neither subsystem owns, and both
 * `diagnostics/jsonl.ts` and `safety/audit.ts` bind to it instead of to each
 * other.
 *
 * `.pi/lib/` is deliberately NOT under `.pi/extensions/`: `package.json`'s
 * `pi.extensions` is `["./.pi/extensions"]` only, so Pi never tries to
 * auto-discover this directory as an extension, and
 * `tests/unit/extension-layout.test.ts`'s BOOT-05 shape assertion never has to
 * be scoped around it.
 *
 * ---------------------------------------------------------------------------
 * The rule, stated up front: `appendFileSync` only, never a buffered stream
 * ---------------------------------------------------------------------------
 * The `node:fs` stream constructor is deliberately NOT spelled anywhere in this
 * file, exactly the way `harness/index.ts` refuses to spell the
 * tool-registration call. A plain-substring grep over this file for that
 * constructor is the mechanical proof that no stream is opened here, and naming
 * it in a warning would turn that proof into a permanent false positive —
 * blocker B3's lesson, which this repo has already paid for twice. So: the rule
 * is written out in words, and the check stays live.
 *
 * THAT GREP IS `tests/unit/jsonl-append-only.test.ts`. It bans four routes to a
 * held or buffered descriptor — the stream factory, the stream class, the raw
 * descriptor opener, and the callback-form append whose asynchrony lets two writes
 * interleave inside one line — across every tracked source that can now write a
 * log: `.pi/extensions/diagnostics`, `.pi/lib` and `.pi/extensions/safety`. It
 * proves each pattern against an inline offending fixture and asserts this file
 * still contains the SYNCHRONOUS append, so gutting the writer cannot turn the
 * gate green by leaving nothing to object to.
 *
 * Four concurrent Node processes appending ~950 B records to one shared file
 * produced 6000 of 6000 lines with zero unparseable records, and `renameSync`
 * on that file succeeded with an append handle open in this process and in a
 * child [VERIFIED: executed 2026-08-13, win32, node v24.16.0 — RESEARCH §10.3].
 * Rename-based rotation of a single shared file is therefore viable and needs
 * no lock file.
 *
 * That result depends entirely on open-write-close per record. A held file
 * descriptor keeps writing into the file that was renamed away, so every record
 * after a rotation would land in the rotated file and be lost from the live
 * one. `appendFileSync` opens, writes and closes per call, which narrows that
 * window to a single write. **Never introduce a stream here.**
 *
 * Two caveats recorded rather than hidden: the concurrency evidence was
 * executed on Windows only — the macOS leg belongs to CI's `macos-latest` job,
 * which is itself BOOT-07 OUTSTANDING — and POSIX `O_APPEND` atomicity for very
 * large single writes is not formally guaranteed.
 *
 * ---------------------------------------------------------------------------
 * Why `withFileMutationQueue` is deliberately not used
 * ---------------------------------------------------------------------------
 * Pi exports it (`src/index.ts`), but its state is a module-level `Map`
 * inside one process (pi 1.1.0 `core/tools/file-mutation-queue.ts:4`). Subagents are
 * separate `pi` child processes, so it serialises nothing across them — the
 * only case that matters here. Its real purpose is stopping our writes racing
 * the built-in `edit`/`write` tools on a path they share, and nothing else
 * touches these logs. RESEARCH §10.3 proved the shared file needs no lock.
 *
 * ---------------------------------------------------------------------------
 * Path discipline
 * ---------------------------------------------------------------------------
 * Every path is built from the caller's `cwd` plus Pi's exported
 * `CONFIG_DIR_NAME` plus {@link LOG_DIR_SEGMENT}, joined with `node:path.join`
 * — never a hardcoded `.pi`, never string concatenation (the Windows rule in
 * CLAUDE.md). A `base` is validated against a strict character allowlist and
 * the resolved file is asserted to sit inside `logDir(cwd)` before anything is
 * written, so no path can be steered out of the log directory by a caller —
 * and no path is ever built from model-supplied input. [threats T-02-03-01,
 * T-02-03-07]
 *
 * Rotation and prune touch existing paths, so both check `lstatSync` and skip
 * anything that is not a regular file: a symlink planted in the log directory
 * must not become a rename target or an unlink victim. [threat T-02-03-02]
 *
 * ---------------------------------------------------------------------------
 * Ownership, not shape — {@link PruneOptions.ownedBases} is REQUIRED
 * ---------------------------------------------------------------------------
 * `LOG_DIR_SEGMENT` is `"logs"` — the most obvious name any extension would pick
 * under Pi's config dir — and this project composes roughly eleven third-party
 * extensions, several of which keep durable state (`pi-background-tasks`,
 * `@juicesharp/rpiv-todo`), on top of its own diagnostics and safety streams.
 * {@link pruneLogs} takes its owned base names from the CALLER, with no default
 * and no shared hardcoded list: a shared list would let the diagnostics binding
 * delete the audit log or vice versa, which is precisely the ownership-not-shape
 * rule the original `diagnostics/jsonl.ts` docstring stated. Each binding
 * (`diagnostics/jsonl.ts`, `safety/audit.ts`) supplies its OWN base names.
 * [threat T-04-14]
 *
 * ---------------------------------------------------------------------------
 * The jiti duplicate-module-instance hazard, and why module state lives on
 * `globalThis`
 * ---------------------------------------------------------------------------
 * Pi loads each extension through jiti, which keeps its own module registry.
 * Two module instances of THIS file — one reached through
 * `diagnostics/jsonl.ts`, one through `safety/audit.ts` — would otherwise keep
 * two separate `sizeCache` maps and two separate `produced` sets, and
 * `logs-gitignored.test.ts` reads `producedPaths()` expecting ONE process-wide
 * view. This is the same class of hazard `.pi/extensions/diagnostics/index.ts`
 * already documents and fixes for its own rows-written counter (see
 * `diagnostics/index.ts#ROWS_WRITTEN_KEY`): a module-level `let`/`Map`/`Set` is
 * per JITI INSTANCE, not per process, so both pieces of mutable state here are
 * kept in a `globalThis`-keyed slot instead. That makes the state genuinely
 * per-process regardless of how many times this file is loaded through
 * different import graphs.
 */
import {
	appendFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	renameSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

/**
 * Directory segment under Pi's config dir that holds every dated JSONL log,
 * diagnostics and safety alike.
 *
 * The full directory is `<cwd>/<CONFIG_DIR_NAME>/<LOG_DIR_SEGMENT>` — never a
 * hardcoded `.pi`, because a rebranded Pi distribution uses a different name.
 * `.gitignore:79` (`.pi/logs/`) and `.gitignore:30` (`*.jsonl`) already cover
 * it twice over.
 */
export const LOG_DIR_SEGMENT = "logs";

/** File extension of every log this module writes. */
const EXT = ".jsonl";

/**
 * Rotated files kept per stream, per day, when a caller does not override it.
 *
 * Matches the value Phase 2 proved in production (`diagnostics/schema.ts`'s
 * `MAX_ROTATED_FILES`): 10 x a stream's own cap bounds a bad day at a fixed
 * multiple of the per-file size. A binding that wants a different bound passes
 * its own `maxRotated`.
 */
const DEFAULT_MAX_ROTATED_FILES = 10;

/**
 * Days of history kept, when a caller does not override it.
 *
 * Matches Phase 2's proven value (`diagnostics/schema.ts`'s `RETENTION_DAYS`):
 * long enough to answer "was last week different?", short enough that a
 * working tree in a public repo never accumulates months of log bodies.
 */
const DEFAULT_RETENTION_DAYS = 14;

/**
 * Size cap applied when a caller omits {@link AppendOptions.rotateBytes}
 * entirely.
 *
 * Every binding shipped so far supplies its own cap (`defaultRotateBytes` in
 * `diagnostics/jsonl.ts`, `AUDIT_ROTATE_BYTES` in `safety/schema.ts`), so this
 * value is a safety net for a caller that skips the binding layer, not a
 * number any shipped stream relies on.
 */
const DEFAULT_ROTATE_BYTES = 8_000_000;

/**
 * How stale a cached file size may be before it is re-`stat`ed.
 *
 * A `stat` per append is free at DeepSeek turn rates; caching keeps it free at
 * subagent fan-out (RESEARCH §10.5). The cached value is kept exact by adding
 * each write's byte count to it, so the re-`stat` only corrects for writes made
 * by another process.
 */
const SIZE_RECHECK_MS = 1000;

/**
 * A `base` may only be these characters.
 *
 * The point is not cosmetic. This is what makes `..`, `/`, `\`, a drive letter
 * and an absolute path impossible before `join` ever sees the value. The
 * confinement assertion in {@link assertInsideLogDir} is the second line of the
 * same defence, kept because one check that is easy to weaken is not a control.
 */
const BASE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * `globalThis` key for the cached live-file-size map. See the module docstring
 * section on the jiti duplicate-module-instance hazard.
 */
const SIZE_CACHE_KEY = "__kypiJsonlSizeCache";

/**
 * `globalThis` key for the produced-paths set. See the module docstring
 * section on the jiti duplicate-module-instance hazard.
 */
const PRODUCED_KEY = "__kypiJsonlProducedPaths";

/** The process-wide cached-size map, created on first use. */
function sizeCacheSlot(): Map<string, { size: number; checkedAt: number }> {
	const g = globalThis as Record<string, unknown>;
	if (!(g[SIZE_CACHE_KEY] instanceof Map)) {
		g[SIZE_CACHE_KEY] = new Map<string, { size: number; checkedAt: number }>();
	}
	return g[SIZE_CACHE_KEY] as Map<string, { size: number; checkedAt: number }>;
}

/** The process-wide produced-paths set, created on first use. See {@link producedPaths}. */
function producedSlot(): Set<string> {
	const g = globalThis as Record<string, unknown>;
	if (!(g[PRODUCED_KEY] instanceof Set)) {
		g[PRODUCED_KEY] = new Set<string>();
	}
	return g[PRODUCED_KEY] as Set<string>;
}

/**
 * Absolute path of the directory holding every dated log for `cwd`.
 *
 * `CONFIG_DIR_NAME` is Pi's own exported constant rather than a literal `.pi`
 * [CITED: pi 0.84.1 src/index.ts:7], so a rebranded distribution keeps working
 * and the logs stay next to the rest of the project's runtime state.
 */
export function logDir(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, LOG_DIR_SEGMENT);
}

/** Zero-padded local `YYYY-MM-DD`. Local, not UTC: a log is read by a human in their day. */
function dateStamp(now: Date): string {
	const y = String(now.getFullYear()).padStart(4, "0");
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/** Throw unless `file` resolves inside `logDir(cwd)`. */
function assertInsideLogDir(cwd: string, file: string): string {
	const dir = resolve(logDir(cwd));
	const full = resolve(file);
	if (full !== dir && !full.startsWith(dir + sep)) {
		throw new Error(
			`refusing to write ${full}: it resolves outside the log directory ${dir}. ` +
				"Log paths are built from cwd + CONFIG_DIR_NAME + LOG_DIR_SEGMENT only.",
		);
	}
	return full;
}

/**
 * Absolute path of the live log file for `base` on `now`'s date.
 *
 * Throws on a `base` that is not a bare name — a separator, a `..`, or anything
 * outside {@link BASE_RE}. Callers pass a constant from their own schema
 * module; a caller that passes anything else is the bug this refusal exists to
 * surface.
 *
 * {@link rotate} applies the same {@link assertInsideLogDir} check, so BOTH
 * exported writers are confined rather than only the one that builds its own path.
 */
export function logPath(cwd: string, base: string, now: Date = new Date()): string {
	if (!BASE_RE.test(base)) {
		throw new Error(
			`invalid log base ${JSON.stringify(base)}: expected a bare name matching ${String(BASE_RE)}. ` +
				"A base carrying a path separator or `..` would place the file outside the log directory.",
		);
	}
	return assertInsideLogDir(cwd, join(logDir(cwd), `${base}-${dateStamp(now)}${EXT}`));
}

/** `<stem>.jsonl` → `<stem>.<n>.jsonl`. */
function rotatedPath(file: string, n: number): string {
	return `${file.slice(0, -EXT.length)}.${n}${EXT}`;
}

/** True when `path` exists and is a regular file — not a directory, not a symlink. */
function isRegularFile(path: string): boolean {
	try {
		return lstatSync(path).isFile();
	} catch {
		return false;
	}
}

/** Size of `path`, or 0 when it is absent or not a regular file. */
function regularFileSize(path: string): number {
	if (!isRegularFile(path)) {
		return 0;
	}
	try {
		return statSync(path).size;
	} catch {
		return 0;
	}
}

/** Unlink, swallowing failure. A file another process has open is noise, not an error. */
function unlinkQuietly(path: string): boolean {
	try {
		unlinkSync(path);
		return true;
	} catch {
		return false;
	}
}

/** Escape a literal for embedding in a `RegExp`. */
function escapeForRegExp(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Shift `<stem>.<n>.jsonl` upward and rename the live file to `<stem>.1.jsonl`.
 *
 * Highest index first, so no rename ever overwrites a file that has not been
 * moved yet. Indices at or beyond `maxRotated` are unlinked — including any
 * stragglers left by a previously larger cap — so the on-disk count is bounded
 * by the current setting rather than by whatever it used to be. [threat
 * T-02-03-03]
 *
 * Nothing here follows a symlink: every candidate is checked with `lstatSync`
 * and skipped unless it is a regular file. [threat T-02-03-02]
 *
 * TAKES `cwd` SO IT CAN BE CONFINED LIKE ITS SIBLINGS. This is a public export
 * that performs `readdirSync`, `renameSync` and `unlinkSync` relative to whatever
 * directory it derives from `file`. `logPath` validates its `base` against
 * `BASE_RE` and runs {@link assertInsideLogDir}, and `appendJsonl` goes through
 * `logPath` — so without this the module docstring's claim ("the resolved
 * file is asserted to sit inside `logDir(cwd)` before anything is written") was
 * simply untrue for one of the two exported writers. [threat T-02-03-07]
 */
export function rotate(cwd: string, file: string, maxRotated: number = DEFAULT_MAX_ROTATED_FILES): void {
	// The same second line of defence `logPath` applies, for the entry point a
	// caller can reach with a path it built itself.
	assertInsideLogDir(cwd, file);
	const stem = file.slice(0, -EXT.length);
	const dir = stem.slice(0, stem.lastIndexOf(sep) + 1);
	const prefix = stem.slice(stem.lastIndexOf(sep) + 1);

	// Stragglers above the current cap, e.g. after maxRotated was reduced.
	const stale = new RegExp(`^${escapeForRegExp(prefix)}\\.(\\d+)\\${EXT}$`);
	if (existsSync(dir === "" ? "." : dir)) {
		for (const name of readdirSync(dir === "" ? "." : dir)) {
			const m = stale.exec(name);
			if (m === null) {
				continue;
			}
			const n = Number(m[1]);
			if (n >= maxRotated && isRegularFile(join(dir, name))) {
				unlinkQuietly(join(dir, name));
			}
		}
	}

	for (let n = maxRotated - 1; n >= 1; n--) {
		const src = rotatedPath(file, n);
		if (!isRegularFile(src)) {
			continue;
		}
		const dst = rotatedPath(file, n + 1);
		try {
			renameSync(src, dst);
			producedSlot().add(dst);
		} catch {
			// A rotated file another process holds open stays where it is. The
			// live file still rotates below, so the cap still holds.
		}
	}

	if (maxRotated >= 1 && isRegularFile(file)) {
		const dst = rotatedPath(file, 1);
		try {
			renameSync(file, dst);
			producedSlot().add(dst);
		} catch {
			// Rotation failed; the next append will simply keep growing the live
			// file rather than losing the record. Never throw from here.
			return;
		}
		sizeCacheSlot().set(file, { size: 0, checkedAt: Date.now() });
	}
}

/** Live size of `file`, re-`stat`ed at most once per {@link SIZE_RECHECK_MS}. */
function cachedSize(file: string, nowMs: number): number {
	const cache = sizeCacheSlot();
	const entry = cache.get(file);
	if (entry !== undefined && nowMs - entry.checkedAt < SIZE_RECHECK_MS) {
		return entry.size;
	}
	const size = regularFileSize(file);
	cache.set(file, { size, checkedAt: nowMs });
	return size;
}

/** Options accepted by {@link appendJsonl}. */
export interface AppendOptions {
	/** Size cap in bytes. Defaults to {@link DEFAULT_ROTATE_BYTES} when the caller omits it. */
	rotateBytes?: number;
	/** Rotated files kept. Defaults to {@link DEFAULT_MAX_ROTATED_FILES}. */
	maxRotated?: number;
	/** Injected clock, for deterministic tests. */
	now?: Date;
}

/**
 * Append one JSON record as a line, rotating first when it would cross the cap.
 *
 * Returns the absolute path written, which is also recorded in
 * {@link producedPaths} so a gitignore test can check the paths the writer
 * actually produced rather than a hand-written list.
 *
 * THE CAP, STATED HONESTLY. It is checked against `size + thisRecord`, so the
 * live file never crosses the cap on account of records that FIT — that is the
 * difference from a writer which rotates only once it is already over.
 *
 * A SINGLE RECORD LARGER THAN THE CAP IS WRITTEN WHOLE REGARDLESS. Two branches
 * write unconditionally: an empty or absent file (`size === 0`, so the guard
 * cannot fire) and the post-rotation path (`size` is reset to `0`). The
 * consequence is real and accepted — the live file sits above the cap and rotates
 * on the very next append, producing a run of one-record rotated files — because
 * the alternative is dropping the record, and dropping a record loses the event it
 * describes, which is the one thing this writer may never do.
 */
export function appendJsonl(
	cwd: string,
	base: string,
	record: unknown,
	opts: AppendOptions = {},
): string {
	const now = opts.now ?? new Date();
	const file = logPath(cwd, base, now);
	const cap = opts.rotateBytes ?? DEFAULT_ROTATE_BYTES;
	const maxRotated = opts.maxRotated ?? DEFAULT_MAX_ROTATED_FILES;

	mkdirSync(logDir(cwd), { recursive: true });

	const text = `${JSON.stringify(record)}\n`;
	const bytes = Buffer.byteLength(text, "utf8");

	const nowMs = now.getTime();
	let size = cachedSize(file, nowMs);
	if (size > 0 && size + bytes > cap) {
		rotate(cwd, file, maxRotated);
		size = 0;
	}

	appendFileSync(file, text, "utf8");
	const cache = sizeCacheSlot();
	cache.set(file, { size: size + bytes, checkedAt: cache.get(file)?.checkedAt ?? nowMs });
	producedSlot().add(file);
	return file;
}

/** Options accepted by {@link pruneLogs}. */
export interface PruneOptions {
	/**
	 * The stream base names THIS CALLER owns and may therefore delete.
	 *
	 * REQUIRED, with no default and no shared hardcoded list. See the module
	 * docstring's "Ownership, not shape" section — a shared list here would let
	 * one binding delete another's logs.
	 */
	ownedBases: readonly string[];
	/** Rotated files kept per dated stream. Defaults to {@link DEFAULT_MAX_ROTATED_FILES}. */
	maxRotated?: number;
	/** Days of history kept. Defaults to {@link DEFAULT_RETENTION_DAYS}. */
	retentionDays?: number;
	/** Injected clock, for deterministic tests. */
	now?: Date;
}

/** `<base>-YYYY-MM-DD.jsonl` or `<base>-YYYY-MM-DD.<n>.jsonl`. */
const LOG_NAME_RE = /^([A-Za-z0-9][A-Za-z0-9_-]*)-(\d{4})-(\d{2})-(\d{2})(?:\.(\d+))?\.jsonl$/;

/** Whole days between two dates, counted from local midnight to local midnight. */
function ageInDays(stamp: { y: number; m: number; d: number }, now: Date): number {
	const then = Date.UTC(stamp.y, stamp.m - 1, stamp.d);
	const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
	return Math.round((today - then) / 86_400_000);
}

/**
 * Delete logs past the retention window and rotated files past the cap.
 *
 * Returns the absolute paths deleted, sorted. Typically called from
 * `session_start`: cheap, deterministic, and off the hot path (RESEARCH §10.5).
 *
 * Age is computed from the file's DATE STAMP against an injectable `now`, never
 * from an mtime. A stamp is what the name promises, it survives a copy between
 * machines, and it makes the retention test deterministic on both platforms.
 *
 * Every unlink failure is swallowed: a log another process holds open is noise,
 * and a session that cannot start because a prune failed would be a subsystem
 * taking the harness down with it.
 *
 * SCOPE. Only files whose base name is in `opts.ownedBases` are considered at
 * all. `.pi/logs/` is a directory shared with whatever else picks the same
 * obvious name, and a retention rule that deleted by NAME SHAPE would quietly
 * destroy another component's state. [threat T-02-03-02, T-04-14]
 */
export function pruneLogs(cwd: string, opts: PruneOptions): string[] {
	const dir = logDir(cwd);
	if (!existsSync(dir)) {
		return [];
	}

	const now = opts.now ?? new Date();
	const retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
	const maxRotated = opts.maxRotated ?? DEFAULT_MAX_ROTATED_FILES;
	const ownedBases = opts.ownedBases;

	const deleted: string[] = [];
	/** Surviving rotated files, grouped by dated stem, so the cap applies per stream. */
	const rotatedByStem = new Map<string, { n: number; path: string }[]>();

	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return [];
	}

	for (const name of names) {
		const match = LOG_NAME_RE.exec(name);
		if (match === null) {
			continue;
		}
		// OWNERSHIP BEFORE SHAPE. `LOG_NAME_RE`'s first group is `[A-Za-z0-9][...]*`,
		// i.e. ANY base name, because the same expression also parses the rotation
		// bucket stem below. Matching the shape says this looks like a dated JSONL
		// log; it does not say this caller wrote it. See `ownedBases` above.
		if (!ownedBases.includes(match[1] as string)) {
			continue;
		}
		const path = join(dir, name);
		// Not a regular file: a symlink or directory shaped like a log name is
		// never followed and never unlinked. [threat T-02-03-02]
		if (!isRegularFile(path)) {
			continue;
		}

		const stamp = { y: Number(match[2]), m: Number(match[3]), d: Number(match[4]) };
		if (ageInDays(stamp, now) > retentionDays) {
			if (unlinkQuietly(path)) {
				sizeCacheSlot().delete(path);
				deleted.push(path);
			}
			continue;
		}

		if (match[5] !== undefined) {
			const stem = `${match[1]}-${match[2]}-${match[3]}-${match[4]}`;
			const bucket = rotatedByStem.get(stem) ?? [];
			bucket.push({ n: Number(match[5]), path });
			rotatedByStem.set(stem, bucket);
		}
	}

	for (const bucket of rotatedByStem.values()) {
		for (const entry of bucket) {
			if (entry.n > maxRotated && unlinkQuietly(entry.path)) {
				sizeCacheSlot().delete(entry.path);
				deleted.push(entry.path);
			}
		}
	}

	return deleted.sort();
}

/**
 * Every absolute path this process wrote or renamed into existence, across
 * every base name any binding has appended through this module.
 *
 * A gitignore test reads this instead of a hand-written list: a table of
 * literals proves the rules classify the names someone remembered to type,
 * while this proves them against what the writer actually produced.
 */
export function producedPaths(): readonly string[] {
	return [...producedSlot()].sort();
}

/**
 * Forget every recorded path.
 *
 * Exported for tests, which must start from an empty set — otherwise paths
 * produced by an earlier test in the same worker would make a "non-empty"
 * guard pass without this run having written anything.
 */
export function resetProducedPaths(): void {
	producedSlot().clear();
}
