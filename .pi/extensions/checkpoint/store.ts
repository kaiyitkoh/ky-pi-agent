/**
 * EXT-07 — durable checkpoint index. Defect 3's fix: a checkpoint list that
 * survives a process restart, not an in-memory `Map` (Pi's bundled
 * `git-checkpoint.ts:11,29,49-51`) cleared on `agent_end`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE DOES NOT BIND TO `.pi/lib/jsonl.ts`
 * ---------------------------------------------------------------------------
 * `.pi/lib/jsonl.ts` is a real, hardened writer this project already proved
 * (rotation races, path-confinement falsification, four-concurrent-process
 * append) — but its directory is hardcoded to
 * `<cwd>/<CONFIG_DIR_NAME>/logs` (`LOG_DIR_SEGMENT = "logs"`, not exported as
 * a parameter). Checkpoints are runtime STATE meant to be read back and acted
 * on (`readCheckpoints` → restore), not an append-only EVENT LOG meant to be
 * inspected after the fact — and `.gitignore` already draws that line itself:
 * `.pi/logs/` and `.pi/state/` are two separate ignored entries. Reusing the
 * log writer would mean either misusing `.pi/logs/` for state or forking the
 * writer's internals to accept a different directory segment, which is a
 * second hardened writer wearing the first one's name. So this module is a
 * SIBLING with the SAME two-layer confinement discipline
 * (`jsonl.ts`'s own docstring: "a character allowlist on the base plus a
 * resolved-path containment assertion"), pointed at `.pi/state/` instead.
 *
 * ---------------------------------------------------------------------------
 * WHY A WHOLE-FILE ATOMIC REWRITE, NOT AN APPEND
 * ---------------------------------------------------------------------------
 * `jsonl.ts` can append safely because each record is independent and a torn
 * write only loses the record being written. This store's `readCheckpoints`
 * must produce a well-formed JSON ARRAY on every read, including one racing a
 * concurrent write, so a torn line is not an acceptable failure mode here.
 * `recordCheckpoint` therefore reads the existing array, appends the new
 * entry, and writes the WHOLE array to a uniquely-named temp file in the same
 * directory before `renameSync`-ing it over the real path. `renameSync` onto
 * an existing destination is atomic on both NTFS and POSIX filesystems, so a
 * reader never observes a partially-written file.
 *
 * ---------------------------------------------------------------------------
 * NEVER THROWS — the same contract as `.pi/extensions/safety/audit.ts`
 * ---------------------------------------------------------------------------
 * `recordCheckpoint` catches and returns `undefined` on any failure, for the
 * identical reason `writeAuditRow` does: this is called from a `turn_start`
 * handler, and an unhandled exception there must never turn a successful
 * checkpoint capture attempt into a broken turn. `readCheckpoints` is equally
 * forgiving on a missing or corrupt file (returns `[]`) — a stale or absent
 * store is "no checkpoints recorded yet", not a crash.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (BOOT-10). This module registers nothing. It does not spell
 * the tool-registration call, in code or in prose —
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

/**
 * Directory segment under Pi's config dir holding checkpoint state. Already
 * gitignored twice over (`.gitignore`: `.pi/state/`); this module never
 * assumes that and never writes anywhere else.
 */
export const STATE_DIR_SEGMENT = "state";

/** The single file this module reads and writes. A bare name, validated below. */
const STORE_BASE = "checkpoints.json";

/** `STORE_BASE` must match this before it is ever joined onto a directory. */
const BASE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** One recorded checkpoint. */
export interface CheckpointEntry {
	/** The checkpoint commit SHA — see `git.ts#createCheckpoint`. */
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

/**
 * Absolute path of the store file for `repoRoot`. Throws if `STORE_BASE` ever
 * stops matching {@link BASE_RE} (it cannot, today — this is the same
 * defence-in-depth `jsonl.ts#logPath` applies to a caller-supplied base, kept
 * here even though this module's base is a compile-time constant) or if the
 * resolved path would sit outside {@link stateDir} (it cannot, by
 * construction — the second layer of the same confinement discipline).
 */
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
 * Is `v` a well-formed {@link CheckpointEntry}? (WR-11)
 *
 * `readStoreFile` used to cast blind once `JSON.parse` succeeded and the
 * result was an array, so `[1, 2, 3]`, `[null]` and `[{"label":"x"}]` all
 * passed — reachable through a partially-restored backup, a hand edit, or a
 * torn concurrent write. `index.ts` then does `e.sha.slice(0, 12)` and
 * `e.sha.startsWith(...)`, both of which throw `TypeError: Cannot read
 * properties of undefined`: in the command handler that is an unhandled
 * rejection, and in `session_before_fork` it throws out of an event handler on
 * a path the user reached by asking to fork. This module's "NEVER THROWS"
 * contract covered `recordCheckpoint`/`readCheckpoints` but not their
 * consumers, and the guarantee it actually gave was weaker than the one its
 * callers assumed. Non-conforming elements are now dropped rather than
 * returned.
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

/**
 * How many checkpoint rows the store keeps (WR-10).
 *
 * One row per `turn_start`, forever, in one file per repository across every
 * session, with the WHOLE array re-serialised on every turn — cost grew with
 * history and nothing pruned. 200 is roughly a long working week of turns and
 * keeps the file well under a hundred kilobytes; it is a number chosen for
 * being obviously enough rather than measured, and it is enforced in exactly
 * one place ({@link pruneCheckpoints}) so it cannot drift.
 */
export const MAX_CHECKPOINT_ENTRIES = 200;

/**
 * Exclusive-lock helpers (WR-09).
 *
 * `recordCheckpoint` is read-modify-write, and `git.ts` explicitly designs for
 * "two concurrent checkpoints -- the main session and a subagent's own turn"
 * by giving each a uniquely-named scratch index. Those same two processes both
 * write this one shared file. Interleave read-A, read-B, write-A, write-B and
 * A's entry is gone: a checkpoint the user can never restore, lost silently
 * because `recordCheckpoint` still returns a path and looks successful. The
 * module docstring argued carefully for atomic READERS (correct — `renameSync`
 * gives that) and never addressed lost updates, so its concurrency claim read
 * stronger than it was.
 *
 * `wx` creates the lock or throws `EEXIST`; there is no check-then-create race.
 * A lock older than {@link LOCK_STALE_MS} is broken, because a process killed
 * mid-write must not wedge every later turn in the repository forever.
 */
const LOCK_SUFFIX = ".lock";
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 2;
const LOCK_MAX_WAIT_MS = 2_000;

/** Sleep synchronously. `Atomics.wait` is the only dependency-free synchronous sleep in Node. */
function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `body` holding an exclusive lock on `file`, or run it unlocked if the
 * lock cannot be taken within {@link LOCK_MAX_WAIT_MS}.
 *
 * Degrading to unlocked rather than failing is deliberate and is the same
 * trade the NEVER THROWS contract makes elsewhere in this module: a checkpoint
 * recorded with a small chance of a lost update is strictly better for the
 * user than a turn that records nothing because a stale lock outlived its
 * owner in a way the staleness check did not catch.
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
		} catch {
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
	try {
		return body();
	} finally {
		if (held) {
			try {
				rmSync(lock, { force: true });
			} catch {
				// Nothing to release. Never mask the body's own result.
			}
		}
	}
}

/**
 * Append one checkpoint entry to the durable store for `repoRoot`, surviving
 * a fresh process/module load. Returns the absolute path written on success,
 * or `undefined` on ANY failure — see the module docstring's "NEVER THROWS"
 * section. Writes atomically: the whole (existing + new) array is written to
 * a uniquely-named temp file in the same directory, then `renameSync`-d over
 * the real path, so a reader never observes a partial file.
 */
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
		// WR-09: the READ and the WRITE must be one critical section, or a
		// concurrent recorder's entry is silently lost.
		withLock(file, () => {
			const entries = readStoreFile(file);
			entries.push(row);
			writeStoreFile(dir, file, entries);
		});
		return file;
	} catch {
		// A failed write is reported as `undefined`, never rethrown -- see the
		// module docstring. Called from `turn_start`; a checkpoint failure must
		// never turn into an unhandled exception that breaks the turn.
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
 * Trim the store to the newest `max` entries and return the rows evicted
 * (WR-10), oldest first.
 *
 * Separate from {@link recordCheckpoint} because the caller has to do
 * something with the evicted rows — `index.ts` drops each one's anchoring git
 * ref (`git.ts#dropCheckpointRef`) so the ref namespace does not outgrow the
 * index it mirrors. Returning them rather than deleting refs here keeps this
 * module free of any git dependency, which is the reason it can be reasoned
 * about as plain filesystem state.
 *
 * NEVER THROWS, like everything else here: on any failure it returns `[]`,
 * meaning "nothing was evicted", which is always a safe thing for the caller
 * to believe.
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

/**
 * Read every checkpoint recorded for `repoRoot`, oldest first. Never throws:
 * a missing or corrupt store reads as "no checkpoints recorded yet" (`[]`),
 * matching {@link recordCheckpoint}'s forgiving posture.
 */
export function readCheckpoints(repoRoot: string): CheckpointEntry[] {
	try {
		return readStoreFile(storePath(repoRoot));
	} catch {
		return [];
	}
}
