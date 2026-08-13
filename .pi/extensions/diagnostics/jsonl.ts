/**
 * Append-only JSONL writer with size-based rotation and dated retention.
 *
 * ---------------------------------------------------------------------------
 * The rule, stated up front: `appendFileSync` only, never a buffered stream
 * ---------------------------------------------------------------------------
 * The `node:fs` stream constructor is deliberately NOT spelled anywhere in this
 * file, exactly the way `harness/index.ts:36` refuses to spell the
 * tool-registration call. A plain-substring grep over this file for that
 * constructor is the mechanical proof that no stream is opened here, and naming
 * it in a warning would turn that proof into a permanent false positive —
 * blocker B3's lesson, which this repo has already paid for twice. So: the rule
 * is written out in words, and the check stays live.
 *
 * THAT GREP IS `tests/unit/jsonl-append-only.test.ts`. It bans the stream factory,
 * the stream class, `openSync` and the asynchronous `appendFile(` across every
 * tracked source in this directory, proves each pattern against an inline
 * offending fixture, and asserts this file still contains the synchronous append —
 * so gutting the writer cannot turn the gate green by leaving nothing to object
 * to. Until that file existed this paragraph described a check nobody had written,
 * which is worse than no rule at all.
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
 * Pi exports it (`src/index.ts:322`), but its state is a module-level `Map`
 * inside one process (`core/tools/file-mutation-queue.ts:4`). Subagents are
 * separate `pi` child processes, so it serialises nothing across them — the
 * only case that matters here. Its real purpose is stopping our writes racing
 * the built-in `edit`/`write` tools on a path they share, and nothing else
 * touches these logs. RESEARCH §10.3 proved the shared file needs no lock.
 *
 * ---------------------------------------------------------------------------
 * Path discipline
 * ---------------------------------------------------------------------------
 * Every path is built from the caller's `cwd` plus Pi's exported
 * `CONFIG_DIR_NAME` plus `LOG_DIR_SEGMENT`, joined with `node:path.join` —
 * never a hardcoded `.pi`, never string concatenation (the Windows rule in
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
 * BOUNDARY RULE (BOOT-10). This module registers nothing. It does not name the
 * tool-registration call, in code or in prose, because
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`.
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

import {
	LOG_DIR_SEGMENT,
	MAX_ROTATED_FILES,
	RETENTION_DAYS,
	TURNS_LOG_BASE,
	TURNS_ROTATE_BYTES,
	WIRE_LOG_BASE,
	WIRE_ROTATE_BYTES,
} from "./schema.ts";

/**
 * The stream base names this module is allowed to DELETE. Never widen without a
 * test.
 *
 * `LOG_DIR_SEGMENT` is `"logs"` — the most obvious name any extension would pick
 * under Pi's config dir — and this project composes roughly eleven third-party
 * extensions, several of which keep durable state (`pi-background-tasks`,
 * `@juicesharp/rpiv-todo`). {@link pruneLogs} runs on every `session_start` and
 * unlinks with failures swallowed, so a retention rule scoped by SHAPE rather
 * than by OWNERSHIP would silently and irreversibly delete another component's
 * dated JSONL after fourteen days, on startup, with nothing reported anywhere.
 *
 * Diagnostics has no claim on that directory. It deletes what it wrote.
 * `tests/unit/jsonl-rotation.test.ts` plants a foreign name beside a doomed
 * owned one and asserts the foreign file survives — the paired negative that
 * makes this a control rather than a comment.
 */
const OWNED_BASES: readonly string[] = [WIRE_LOG_BASE, TURNS_LOG_BASE];

/** File extension of every log this module writes. */
const EXT = ".jsonl";

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

/** Cached live-file sizes, keyed by absolute path. */
const sizeCache = new Map<string, { size: number; checkedAt: number }>();

/** Every absolute path this process wrote or created. See {@link producedPaths}. */
const produced = new Set<string>();

/**
 * Absolute path of the directory holding every diagnostic log for `cwd`.
 *
 * `CONFIG_DIR_NAME` is Pi's own exported constant rather than a literal `.pi`
 * [CITED: pi 0.84.1 src/index.ts:7], so a rebranded distribution keeps working
 * and the logs stay next to the rest of the project's runtime state — which
 * `.gitignore:79` already covers.
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
				"Diagnostic paths are built from cwd + CONFIG_DIR_NAME + LOG_DIR_SEGMENT only.",
		);
	}
	return full;
}

/**
 * Absolute path of the live log file for `base` on `now`'s date.
 *
 * Throws on a `base` that is not a bare name — a separator, a `..`, or anything
 * outside {@link BASE_RE}. Callers pass a constant from `schema.ts`; a caller
 * that passes anything else is the bug this refusal exists to surface.
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
 */
export function rotate(file: string, maxRotated: number = MAX_ROTATED_FILES): void {
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
			produced.add(dst);
		} catch {
			// A rotated file another process holds open stays where it is. The
			// live file still rotates below, so the cap still holds.
		}
	}

	if (maxRotated >= 1 && isRegularFile(file)) {
		const dst = rotatedPath(file, 1);
		try {
			renameSync(file, dst);
			produced.add(dst);
		} catch {
			// Rotation failed; the next append will simply keep growing the live
			// file rather than losing the record. Never throw from here.
			return;
		}
		sizeCache.set(file, { size: 0, checkedAt: Date.now() });
	}
}

/** Escape a literal for embedding in a `RegExp`. */
function escapeForRegExp(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Default size cap for a stream, by base name. */
function defaultRotateBytes(base: string): number {
	return base === WIRE_LOG_BASE ? WIRE_ROTATE_BYTES : TURNS_ROTATE_BYTES;
}

/** Live size of `file`, re-`stat`ed at most once per {@link SIZE_RECHECK_MS}. */
function cachedSize(file: string, nowMs: number): number {
	const entry = sizeCache.get(file);
	if (entry !== undefined && nowMs - entry.checkedAt < SIZE_RECHECK_MS) {
		return entry.size;
	}
	const size = regularFileSize(file);
	sizeCache.set(file, { size, checkedAt: nowMs });
	return size;
}

/** Options accepted by {@link appendJsonl}. */
export interface AppendOptions {
	/** Size cap in bytes. Defaults to the stream's constant in `schema.ts`. */
	rotateBytes?: number;
	/** Rotated files kept. Defaults to {@link MAX_ROTATED_FILES}. */
	maxRotated?: number;
	/** Injected clock, for deterministic tests. */
	now?: Date;
}

/**
 * Append one JSON record as a line, rotating first when it would cross the cap.
 *
 * Returns the absolute path written, which is also recorded in
 * {@link producedPaths} so DIAG-07's gitignore test can check the paths the
 * writer actually produced rather than a hand-written list.
 *
 * The cap is checked against `size + thisRecord`, so the live file is never
 * larger than the cap rather than merely being rotated once it already is.
 */
export function appendJsonl(
	cwd: string,
	base: string,
	record: unknown,
	opts: AppendOptions = {},
): string {
	const now = opts.now ?? new Date();
	const file = logPath(cwd, base, now);
	const cap = opts.rotateBytes ?? defaultRotateBytes(base);
	const maxRotated = opts.maxRotated ?? MAX_ROTATED_FILES;

	mkdirSync(logDir(cwd), { recursive: true });

	const text = `${JSON.stringify(record)}\n`;
	const bytes = Buffer.byteLength(text, "utf8");

	const nowMs = now.getTime();
	let size = cachedSize(file, nowMs);
	if (size > 0 && size + bytes > cap) {
		rotate(file, maxRotated);
		size = 0;
	}

	appendFileSync(file, text, "utf8");
	sizeCache.set(file, { size: size + bytes, checkedAt: sizeCache.get(file)?.checkedAt ?? nowMs });
	produced.add(file);
	return file;
}

/** Options accepted by {@link pruneLogs}. */
export interface PruneOptions {
	/** Rotated files kept per dated stream. Defaults to {@link MAX_ROTATED_FILES}. */
	maxRotated?: number;
	/** Days of history kept. Defaults to {@link RETENTION_DAYS}. */
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
 * Returns the absolute paths deleted, sorted. Called from `session_start`:
 * cheap, deterministic, and off the hot path (RESEARCH §10.5).
 *
 * Age is computed from the file's DATE STAMP against an injectable `now`, never
 * from an mtime. A stamp is what the name promises, it survives a copy between
 * machines, and it makes the retention test deterministic on both platforms.
 *
 * Every unlink failure is swallowed: a log another process holds open is noise,
 * and a session that cannot start because a prune failed would be a diagnostics
 * subsystem taking the harness down with it.
 *
 * SCOPE. Only files whose base name is in {@link OWNED_BASES} are considered at
 * all. `.pi/logs/` is a directory this module shares with whatever else picks the
 * same obvious name, and a retention rule that deleted by NAME SHAPE would quietly
 * destroy another extension's state. [threat T-02-03-02, and the ownership half]
 */
export function pruneLogs(cwd: string, opts: PruneOptions = {}): string[] {
	const dir = logDir(cwd);
	if (!existsSync(dir)) {
		return [];
	}

	const now = opts.now ?? new Date();
	const retentionDays = opts.retentionDays ?? RETENTION_DAYS;
	const maxRotated = opts.maxRotated ?? MAX_ROTATED_FILES;

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
		// log; it does not say this module wrote it. See {@link OWNED_BASES}.
		if (!OWNED_BASES.includes(match[1] as string)) {
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
				sizeCache.delete(path);
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
				sizeCache.delete(entry.path);
				deleted.push(entry.path);
			}
		}
	}

	return deleted.sort();
}

/**
 * Every absolute path this process wrote or renamed into existence.
 *
 * DIAG-07's gitignore test reads this instead of a hand-written list: a table
 * of literals proves the rules classify the names someone remembered to type,
 * while this proves them against what the writer actually produced.
 */
export function producedPaths(): readonly string[] {
	return [...produced].sort();
}

/**
 * Forget every recorded path.
 *
 * Exported for the DIAG-07 test, which must start from an empty set — otherwise
 * paths produced by an earlier test in the same worker would make its
 * "non-empty" guard pass without this run having written anything.
 */
export function resetProducedPaths(): void {
	produced.clear();
}
