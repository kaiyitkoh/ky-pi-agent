/**
 * Diagnostics binding over the shared writer in `.pi/lib/jsonl.ts`, which owns append-only, rotation and path
 * confinement (and the append-only rule `tests/unit/jsonl-append-only.test.ts` enforces). This file supplies
 * {@link OWNED_BASES} (what this subsystem may delete), the per-stream caps and the rows-written counter.
 * Registers nothing.
 */
import {
	AUXILIARY_LOG_BASES,
	appendJsonl as libAppendJsonl,
	logDir as libLogDir,
	logPath as libLogPath,
	producedPaths as libProducedPaths,
	pruneLogs as libPruneLogs,
	resetProducedPaths as libResetProducedPaths,
	rotate as libRotate,
} from "../../lib/jsonl.ts";
import { redactString } from "./redact.ts";
import {
	DIAGNOSTICS_ERROR_EVENT,
	MAX_ROTATED_FILES,
	TURNS_LOG_BASE,
	TURNS_ROTATE_BYTES,
	WIRE_LOG_BASE,
	WIRE_ROTATE_BYTES,
} from "./schema.ts";

export const logDir = libLogDir;
export const logPath = libLogPath;
export const rotate = libRotate;
/** Process-wide, shared across every binding on purpose. */
export const producedPaths = libProducedPaths;
export const resetProducedPaths = libResetProducedPaths;

/** Stream base names this binding may DELETE; never widen without a test (a paired negative covers foreign names). */
const OWNED_BASES: readonly string[] = [WIRE_LOG_BASE, TURNS_LOG_BASE, ...AUXILIARY_LOG_BASES];

/**
 * Process-wide slot for the rows-written counter: jiti can load this module twice, so a
 * module-level `let` would undercount (same reason as `wire.ts` COUNTER_KEY).
 */
export const ROWS_WRITTEN_KEY = "__kypiDiagnosticsRowsWritten";

/** Rows written by this process, so `/budget` can show "0 rows" instead of leaving it to inference. */
export function rowsWrittenThisSession(): number {
	const value = (globalThis as Record<string, unknown>)[ROWS_WRITTEN_KEY];
	return typeof value === "number" ? value : 0;
}

/** Record that one row reached disk; {@link appendJsonl} already calls it, so other callers would double-count. */
export function noteRowWritten(): void {
	(globalThis as Record<string, unknown>)[ROWS_WRITTEN_KEY] = rowsWrittenThisSession() + 1;
}

export interface AppendOptions {
	/** Size cap in bytes. Defaults to the stream's constant in `schema.ts`. */
	rotateBytes?: number;
	/** Rotated files kept. Defaults to {@link MAX_ROTATED_FILES}. */
	maxRotated?: number;
	/** Injected clock, for deterministic tests. */
	now?: Date;
}

/** Append one JSON record to a diagnostics stream with its per-stream caps, and count it once it reached disk. */
export function appendJsonl(cwd: string, base: string, record: unknown, opts: AppendOptions = {}): string {
	const file = libAppendJsonl(cwd, base, record, {
		...opts,
		rotateBytes: opts.rotateBytes ?? (base === WIRE_LOG_BASE ? WIRE_ROTATE_BYTES : TURNS_ROTATE_BYTES),
		maxRotated: opts.maxRotated ?? MAX_ROTATED_FILES,
	});
	noteRowWritten();
	return file;
}

/**
 * Append a `diagnostics.error` row with the error text redacted (`String(err)` can quote a `.env` the model read).
 * NEVER THROWS: the instrument cannot instrument its own inability to write.
 */
export function writeErrorRow(cwd: string, where: string, err: unknown): void {
	try {
		appendJsonl(cwd, TURNS_LOG_BASE, {
			ts: Date.now(),
			event: DIAGNOSTICS_ERROR_EVENT,
			where,
			error: redactString(String(err)),
		});
	} catch {}
}

export interface PruneOptions {
	/** Rotated files kept per dated stream. Defaults to the shared writer's own default. */
	maxRotated?: number;
	/** Days of history kept. Defaults to the shared writer's own default. */
	retentionDays?: number;
	/** Injected clock, for deterministic tests. */
	now?: Date;
}

/** Delete aged diagnostics logs, scoped to {@link OWNED_BASES}; `ownedBases` is injected, never caller-supplied. */
export function pruneLogs(cwd: string, opts: PruneOptions = {}): string[] {
	return libPruneLogs(cwd, { ...opts, ownedBases: OWNED_BASES });
}
