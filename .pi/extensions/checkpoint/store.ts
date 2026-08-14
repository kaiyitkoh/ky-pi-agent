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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

/** Read the store file, tolerating "missing" and "corrupt" as both meaning "no entries". */
function readStoreFile(file: string): CheckpointEntry[] {
	if (!existsSync(file)) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
		return Array.isArray(parsed) ? (parsed as CheckpointEntry[]) : [];
	} catch {
		return [];
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
		const entries = readStoreFile(file);
		const row: CheckpointEntry = {
			sha: input.sha,
			label: input.label,
			entryId: input.entryId,
			cwd: input.cwd,
			ts: input.ts ?? Date.now(),
		};
		entries.push(row);
		const tmp = join(dir, `.${STORE_BASE}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		writeFileSync(tmp, JSON.stringify(entries), "utf-8");
		renameSync(tmp, file);
		return file;
	} catch {
		// A failed write is reported as `undefined`, never rethrown -- see the
		// module docstring. Called from `turn_start`; a checkpoint failure must
		// never turn into an unhandled exception that breaks the turn.
		return undefined;
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
