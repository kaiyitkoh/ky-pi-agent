/**
 * Append-only JSONL writer with size-based rotation and dated retention, shared by diagnostics, safety and workflows.
 * Lives in `.pi/lib/` because `safety/` may import nothing from `diagnostics/`, and Pi auto-discovers only `.pi/extensions`.
 *
 * `appendFileSync` per record, never a held descriptor: one would keep writing into the file rotation renamed away.
 * Appends take no lock (POSIX `O_APPEND` atomicity for very large writes is not guaranteed). Rotation is serialised by a `mkdir` lock and
 * re-checks the live size under it; an append that races the rename lands whole in one fragment or the other.
 * `withFileMutationQueue` is per process (pi 1.1.0 `core/tools/file-mutation-queue.ts:4`); subagents are separate processes.
 *
 * Every path is confined to {@link logDir}, a `base` must match {@link BASE_RE}, and rotation and prune touch only
 * regular files, so a planted symlink is never renamed or unlinked. Mutable state lives on `globalThis` because jiti
 * can load this file twice through different import graphs.
 */
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

/** Directory segment under `<cwd>/<CONFIG_DIR_NAME>/` holding every dated log; `.gitignore` covers it. */
export const LOG_DIR_SEGMENT = "logs";

/** Streams whose writers have no prune of their own; the diagnostics session-start prune owns them. */
export const QODER_LOG_BASE = "qoder";
export const ESCALATION_LOG_BASE = "escalation";
export const AUXILIARY_LOG_BASES: readonly string[] = [QODER_LOG_BASE, ESCALATION_LOG_BASE];

/** Delay after the first failed live-file rename; doubles per failure. */
const ROTATE_RETRY_BASE_MS = 1000;
/** Failed rotations of one file after which this process stops trying and lets the file grow. */
const MAX_ROTATE_FAILURES = 4;
const EXT = ".jsonl";
/** Match `diagnostics/schema.ts` MAX_ROTATED_FILES and RETENTION_DAYS. */
const DEFAULT_MAX_ROTATED_FILES = 10;
const DEFAULT_RETENTION_DAYS = 14;
/** Safety net only: every shipped binding passes its own cap. */
const DEFAULT_ROTATE_BYTES = 8_000_000;
/** A cached size is kept exact by adding each write; the re-read only corrects for other processes. */
const SIZE_RECHECK_MS = 1000;
/** Far above any rotation's duration, so only a crashed holder's lock is ever taken over. */
const ROTATE_LOCK_STALE_MS = 10_000;
/** Makes `..`, separators, drive letters and absolute paths impossible before `join` sees a base. */
const BASE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
/** `<base>-YYYY-MM-DD.jsonl` or `<base>-YYYY-MM-DD.<n>.jsonl`. */
const LOG_NAME_RE = /^([A-Za-z0-9][A-Za-z0-9_-]*)-(\d{4})-(\d{2})-(\d{2})(?:\.(\d+))?\.jsonl$/;

function globalSlot<T>(key: string, create: () => T, is: (v: unknown) => boolean): T {
	const g = globalThis as Record<string, unknown>;
	if (!is(g[key])) g[key] = create();
	return g[key] as T;
}

const isMap = (v: unknown): boolean => v instanceof Map;
const sizeCache = (): Map<string, { size: number; checkedAt: number }> =>
	globalSlot("__kypiJsonlSizeCache", () => new Map(), isMap);
const rotateBackoff = (): Map<string, { failures: number; retryAt: number }> =>
	globalSlot("__kypiJsonlRotateBackoff", () => new Map(), isMap);
const produced = (): Set<string> =>
	globalSlot("__kypiJsonlProducedPaths", () => new Set<string>(), (v) => v instanceof Set);

/** Absolute directory holding every dated log for `cwd`; `CONFIG_DIR_NAME`, not `.pi`, so a rebranded Pi works. */
export function logDir(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, LOG_DIR_SEGMENT);
}

/** Local, not UTC: a log is read by a human in their day. */
function dateStamp(now: Date): string {
	const pad = (n: number, width: number): string => String(n).padStart(width, "0");
	return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

function assertInsideLogDir(cwd: string, file: string): void {
	const dir = resolve(logDir(cwd));
	const full = resolve(file);
	if (full !== dir && !full.startsWith(dir + sep)) {
		throw new Error(`refusing to write ${full}: it resolves outside the log directory ${dir}.`);
	}
}

/** Absolute path of the live log for `base` on `now`'s date; throws on a `base` that is not a bare name. */
export function logPath(cwd: string, base: string, now: Date = new Date()): string {
	if (!BASE_RE.test(base)) {
		throw new Error(`invalid log base ${JSON.stringify(base)}: expected a bare name matching ${String(BASE_RE)}.`);
	}
	const file = resolve(logDir(cwd), `${base}-${dateStamp(now)}${EXT}`);
	assertInsideLogDir(cwd, file);
	return file;
}

function rotatedPath(file: string, n: number): string {
	return `${file.slice(0, -EXT.length)}.${n}${EXT}`;
}

/** Size of `path` when it is a regular file (never a symlink or directory), else undefined. */
function regularFileSize(path: string): number | undefined {
	try {
		const stat = lstatSync(path);
		return stat.isFile() ? stat.size : undefined;
	} catch {
		return undefined;
	}
}

const isRegularFile = (path: string): boolean => regularFileSize(path) !== undefined;

/** A file another process holds open is noise, not an error. */
function unlinkQuietly(path: string): boolean {
	try {
		unlinkSync(path);
		return true;
	} catch {
		return false;
	}
}

function listDir(dir: string): string[] {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

function escapeForRegExp(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Take the rotation lock for `file`: `mkdir` is atomic on every platform, so at most one process renames at a time.
 * A lock older than {@link ROTATE_LOCK_STALE_MS} is a crashed holder's and is taken over.
 */
function tryLock(lock: string): boolean {
	try {
		mkdirSync(lock);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;
	}
	try {
		if (Date.now() - lstatSync(lock).mtimeMs < ROTATE_LOCK_STALE_MS) return false;
		rmdirSync(lock);
		mkdirSync(lock);
		return true;
	} catch {
		return false;
	}
}

/** `busy` when another process holds the rotation lock; nothing moved and the caller should simply append. */
type RotateOutcome = "rotated" | "failed" | "busy";

/**
 * Shift `<stem>.<n>.jsonl` up, highest first, and rename the live file to `<stem>.1.jsonl`; indices at or past
 * `maxRotated` are unlinked, so a lowered cap also bounds what an older one left. Returns false only when the live
 * file could not be renamed. `due` is re-asked under the lock: a sibling may have rotated since the caller's check,
 * and rotating its near-empty successor again would evict a full file.
 */
export function rotate(
	cwd: string,
	file: string,
	maxRotated: number = DEFAULT_MAX_ROTATED_FILES,
	renameFile: typeof renameSync = renameSync,
	due: () => boolean = () => true,
): boolean {
	return rotateLocked(cwd, file, maxRotated, renameFile, due) !== "failed";
}

// Without the lock two processes can both see `.1` free and rename onto it in turn; POSIX rename replaces the
// target silently, so the first rotation's records are lost.
function rotateLocked(
	cwd: string,
	file: string,
	maxRotated: number,
	renameFile: typeof renameSync,
	due: () => boolean,
): RotateOutcome {
	assertInsideLogDir(cwd, file);
	const lock = `${file}.lock`;
	if (!tryLock(lock)) return "busy";
	try {
		return due() ? shiftAndRotate(file, maxRotated, renameFile, due) : "rotated";
	} finally {
		try {
			rmdirSync(lock);
		} catch {
			// A lock left behind goes stale and is taken over; failing the append for it would lose the record.
		}
	}
}

function shiftAndRotate(file: string, maxRotated: number, renameFile: typeof renameSync, due: () => boolean): RotateOutcome {
	const dir = dirname(file);
	const stale = new RegExp(`^${escapeForRegExp(basename(file, EXT))}\\.(\\d+)\\${EXT}$`);
	for (const name of listDir(dir)) {
		const m = stale.exec(name);
		if (m !== null && Number(m[1]) >= maxRotated && isRegularFile(join(dir, name))) unlinkQuietly(join(dir, name));
	}

	for (let n = maxRotated - 1; n >= 1; n--) {
		const src = rotatedPath(file, n);
		const dst = rotatedPath(file, n + 1);
		// renameSync replaces an existing target on every platform, so another process's rotation is skipped, not overwritten.
		if (!isRegularFile(src) || existsSync(dst)) continue;
		try {
			renameFile(src, dst);
			produced().add(dst);
		} catch {
			// A rotated file another process holds open stays put; the live file then grows past the cap until a later retry.
		}
	}

	if (maxRotated >= 1 && isRegularFile(file) && due()) {
		const dst = rotatedPath(file, 1);
		// `.1` could not shift (a holder has it open on Windows); renaming onto it would replace it.
		if (existsSync(dst)) return "rotated";
		try {
			renameFile(file, dst);
			produced().add(dst);
		} catch {
			// The append that follows keeps growing the live file rather than losing the record.
			return "failed";
		}
		sizeCache().set(file, { size: 0, checkedAt: Date.now() });
	}
	return "rotated";
}

function freshSize(file: string, nowMs: number): number {
	const size = regularFileSize(file) ?? 0;
	sizeCache().set(file, { size, checkedAt: nowMs });
	return size;
}

function cachedSize(file: string, nowMs: number): number {
	const entry = sizeCache().get(file);
	return entry !== undefined && nowMs - entry.checkedAt < SIZE_RECHECK_MS ? entry.size : freshSize(file, nowMs);
}

export interface AppendOptions {
	/** Size cap in bytes. */
	rotateBytes?: number;
	maxRotated?: number;
	now?: Date;
	/** Rename used by rotation; injectable so tests can make the live file refuse to move. */
	renameFile?: typeof renameSync;
}

/**
 * Append one JSON record as a line, rotating first when it would cross the cap, and return the path written.
 * A record larger than the cap is still written whole into an empty or fresh file: dropping it would lose the event.
 */
export function appendJsonl(cwd: string, base: string, record: unknown, opts: AppendOptions = {}): string {
	const now = opts.now ?? new Date();
	const file = logPath(cwd, base, now);
	const cap = opts.rotateBytes ?? DEFAULT_ROTATE_BYTES;
	const text = `${JSON.stringify(record)}\n`;
	const bytes = Buffer.byteLength(text, "utf8");
	const nowMs = now.getTime();
	const overCap = (size: number): boolean => size > 0 && size + bytes > cap;

	let size = cachedSize(file, nowMs);
	// The cached size can be a second stale, and another process may have rotated since; decide on a fresh read.
	if (overCap(size)) size = freshSize(file, nowMs);
	if (overCap(size)) {
		const backoff = rotateBackoff();
		const state = backoff.get(file);
		if (state === undefined || nowMs >= state.retryAt) {
			const outcome = rotateLocked(cwd, file, opts.maxRotated ?? DEFAULT_MAX_ROTATED_FILES, opts.renameFile ?? renameSync, () =>
				overCap(regularFileSize(file) ?? 0),
			);
			const fresh = regularFileSize(file) ?? 0;
			// Busy is no failure: the holder rotates, and this record goes to whichever file is live.
			if (outcome === "busy") {
				size = fresh;
			} else if (outcome === "rotated" && !overCap(fresh)) {
				backoff.delete(file);
				size = fresh;
			} else {
				const failures = (state?.failures ?? 0) + 1;
				const retryAt =
					failures >= MAX_ROTATE_FAILURES ? Number.POSITIVE_INFINITY : nowMs + ROTATE_RETRY_BASE_MS * 2 ** (failures - 1);
				backoff.set(file, { failures, retryAt });
			}
		}
	}

	try {
		appendFileSync(file, text, "utf8");
	} catch (error) {
		// The directory is created on first need only, keeping a mkdir off every append.
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		mkdirSync(logDir(cwd), { recursive: true });
		appendFileSync(file, text, "utf8");
	}
	const cache = sizeCache();
	cache.set(file, { size: size + bytes, checkedAt: cache.get(file)?.checkedAt ?? nowMs });
	produced().add(file);
	return file;
}

export interface PruneOptions {
	/** The base names THIS caller owns and may delete; no default, so one binding can never delete another's logs. */
	ownedBases: readonly string[];
	maxRotated?: number;
	retentionDays?: number;
	now?: Date;
}

/** Whole days between a date stamp and `now`, local midnight to local midnight. */
function ageInDays(y: number, m: number, d: number, now: Date): number {
	const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
	return Math.round((today - Date.UTC(y, m - 1, d)) / 86_400_000);
}

/**
 * Delete owned logs past the retention window and rotated files past the cap; returns the deleted paths, sorted.
 * Age comes from the name's date stamp, never an mtime, so it survives a copy and is deterministic. Unlink failures
 * are swallowed so a held file cannot stop a session from starting.
 */
export function pruneLogs(cwd: string, opts: PruneOptions): string[] {
	const dir = logDir(cwd);
	const now = opts.now ?? new Date();
	const retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
	const maxRotated = opts.maxRotated ?? DEFAULT_MAX_ROTATED_FILES;
	const deleted: string[] = [];
	for (const name of listDir(dir)) {
		const match = LOG_NAME_RE.exec(name);
		// Ownership before shape: the pattern matches any base name.
		if (match === null || !opts.ownedBases.includes(match[1] as string)) continue;
		const path = join(dir, name);
		if (!isRegularFile(path)) continue;
		const expired = ageInDays(Number(match[2]), Number(match[3]), Number(match[4]), now) > retentionDays;
		const overCap = match[5] !== undefined && Number(match[5]) > maxRotated;
		if ((expired || overCap) && unlinkQuietly(path)) {
			sizeCache().delete(path);
			deleted.push(path);
		}
	}
	return deleted.sort();
}

/** Every absolute path this process wrote or renamed into existence, so a gitignore test checks real output. */
export function producedPaths(): readonly string[] {
	return [...produced()].sort();
}

/** Forget every recorded path, so a test starts from an empty set. */
export function resetProducedPaths(): void {
	produced().clear();
}
