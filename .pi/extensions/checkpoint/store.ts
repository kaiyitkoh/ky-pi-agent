/**
 * Durable checkpoint index under .pi/state/, so the list survives a process restart.
 * Sibling of .pi/lib/jsonl.ts rather than a user of it: that writer is hardwired to .pi/logs/, and this is state, not an event log.
 * Whole-file atomic rewrite (temp file + renameSync), because readers need a well-formed array even when racing a write.
 * NEVER THROWS, like safety/audit.ts: failures return undefined / [] so a turn_start handler cannot break the turn.
 * Registers nothing (tests/unit/contributing-boundary.test.ts scans for the registration call name).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

/** Directory segment under Pi's config dir holding checkpoint state. */
export const STATE_DIR_SEGMENT = "state";

/** The single file this module reads and writes. A bare name, validated below. */
const STORE_BASE = "checkpoints.json";

/** `STORE_BASE` must match this before it is ever joined onto a directory. */
const BASE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** One recorded checkpoint. */
export interface CheckpointEntry {
	/** The checkpoint commit SHA. */
	readonly sha: string;
	/** Caller-supplied label, e.g. a session entry id or a timestamp string. */
	readonly label: string;
	/** The session entry id this checkpoint was taken for, when known. */
	readonly entryId: string | undefined;
	/** The repository root the checkpoint was taken in. */
	readonly cwd: string;
	/** `Date.now()` at record time, or an injected value for deterministic tests. */
	readonly ts: number;
}

/** What a caller supplies to {@link recordCheckpoint}; `ts` defaults to `Date.now()`. */
export interface CheckpointRecordInput {
	sha: string;
	label: string;
	entryId?: string;
	cwd: string;
	ts?: number;
}

function stateDir(repoRoot: string): string {
	return join(repoRoot, CONFIG_DIR_NAME, STATE_DIR_SEGMENT);
}

/** Absolute path of the store file; throws if the base or resolved path escapes the state directory. */
function storePath(repoRoot: string): string {
	if (!BASE_RE.test(STORE_BASE)) {
		throw new Error(`invalid checkpoint store base ${JSON.stringify(STORE_BASE)}: expected ${String(BASE_RE)}`);
	}
	const dir = resolve(stateDir(repoRoot));
	const file = resolve(join(dir, STORE_BASE));
	if (file !== dir && !file.startsWith(dir + sep)) {
		throw new Error(`refusing to use ${file}: it resolves outside the checkpoint state directory ${dir}`);
	}
	return file;
}

/**
 * Is `v` a well-formed entry? Malformed rows (hand edit, torn write) are dropped so
 * consumers never hit a TypeError; the NEVER THROWS contract covers what readers return.
 */
function isCheckpointEntry(v: unknown): v is CheckpointEntry {
	if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
	const e = v as Record<string, unknown>;
	return (
		typeof e.sha === "string" &&
		e.sha !== "" &&
		typeof e.label === "string" &&
		typeof e.cwd === "string" &&
		typeof e.ts === "number" &&
		Number.isFinite(e.ts) &&
		(e.entryId === undefined || typeof e.entryId === "string")
	);
}

/** Read the store file, tolerating "missing", "corrupt" and "partly corrupt" as meaning "no such entries". */
function readStoreFile(file: string): CheckpointEntry[] {
	if (!existsSync(file)) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
		return Array.isArray(parsed) ? parsed.filter(isCheckpointEntry) : [];
	} catch {
		return [];
	}
}

/** Rows the store keeps; enforced only in {@link pruneCheckpoints}. */
export const MAX_CHECKPOINT_ENTRIES = 200;

/**
 * Exclusive-lock constants: recordCheckpoint is read-modify-write and a subagent turn can race the main session,
 * so unlocked writers lose rows. `wx` create has no check-then-create race; a lock older than LOCK_STALE_MS is broken
 * so a killed process cannot wedge the repo.
 */
const LOCK_SUFFIX = ".lock";
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 2;
/** Above LOCK_STALE_MS so a waiter always sees the staleness breaker get a full window before giving up. */
const LOCK_MAX_WAIT_MS = LOCK_STALE_MS + 5_000;

/** Sleep synchronously. `Atomics.wait` is the only dependency-free synchronous sleep in Node. */
function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `body` under an exclusive lock on `file`; throws if not acquired within LOCK_MAX_WAIT_MS.
 * Callers translate the throw to undefined / []; the catch clauses here carry the same NEVER THROWS contract.
 * Never degrade to running unlocked on timeout: that measurably lost rows (590/600) under CPU contention.
 */
function withLock<T>(file: string, body: () => T): T {
	const lock = `${file}${LOCK_SUFFIX}`;
	const deadline = Date.now() + LOCK_MAX_WAIT_MS;
	let held = false;
	while (Date.now() < deadline) {
		try {
			// `wx` = create-exclusive: succeeds only if the path did not exist.
			writeFileSync(lock, `${process.pid}\n`, { encoding: "utf-8", flag: "wx" });
			held = true;
			break;
		} catch (error) {
			// A missing or invalid directory never heals; other codes retry (Windows reports a mid-delete lock as EPERM).
			if (["ENOENT", "ENOTDIR", "EISDIR", "EROFS"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
			try {
				if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
					rmSync(lock, { force: true });
					continue;
				}
			} catch {
				// The lock vanished between the failed create and the stat -- retry.
			}
			sleepSync(LOCK_RETRY_MS);
		}
	}
	if (!held) {
		throw new Error(`withLock: could not acquire lock on ${lock} within ${String(LOCK_MAX_WAIT_MS)}ms`);
	}
	try {
		return body();
	} finally {
		try {
			rmSync(lock, { force: true });
		} catch {
			// Nothing to release. Never mask the body's own result.
		}
	}
}

/** Append one entry; returns the store path, or undefined on ANY failure (NEVER THROWS). */
export function recordCheckpoint(repoRoot: string, input: CheckpointRecordInput): string | undefined {
	try {
		const dir = stateDir(repoRoot);
		mkdirSync(dir, { recursive: true });
		const file = storePath(repoRoot);
		const row: CheckpointEntry = {
			sha: input.sha,
			label: input.label,
			entryId: input.entryId,
			cwd: input.cwd,
			ts: input.ts ?? Date.now(),
		};
		// Read and write are one critical section, or a concurrent recorder's entry is lost.
		withLock(file, () => {
			const entries = readStoreFile(file);
			entries.push(row);
			writeStoreFile(dir, file, entries);
		});
		return file;
	} catch {
		// Called from turn_start: a failed write must not break the turn.
		return undefined;
	}
}

/** Write `entries` as the whole store, atomically (temp file + rename). */
function writeStoreFile(dir: string, file: string, entries: readonly CheckpointEntry[]): void {
	const tmp = join(dir, `.${STORE_BASE}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	writeFileSync(tmp, JSON.stringify(entries), "utf-8");
	renameSync(tmp, file);
}

/**
 * Trim the store to the newest `max` entries and return the evicted rows, oldest first, so index.ts can drop
 * their anchoring refs (keeps this module git-free). NEVER THROWS: on failure returns [], meaning nothing evicted.
 */
export function pruneCheckpoints(repoRoot: string, max: number = MAX_CHECKPOINT_ENTRIES): CheckpointEntry[] {
	try {
		const dir = stateDir(repoRoot);
		const file = storePath(repoRoot);
		return withLock(file, () => {
			const entries = readStoreFile(file);
			if (entries.length <= max) return [];
			const dropped = entries.slice(0, entries.length - max);
			writeStoreFile(dir, file, entries.slice(entries.length - max));
			return dropped;
		});
	} catch {
		return [];
	}
}

/** Every recorded checkpoint, oldest first. Never throws: a missing or corrupt store reads as []. */
export function readCheckpoints(repoRoot: string): CheckpointEntry[] {
	try {
		return readStoreFile(storePath(repoRoot));
	} catch {
		return [];
	}
}
