/**
 * Diagnostics binding over the shared JSONL writer.
 *
 * ---------------------------------------------------------------------------
 * THIN BINDING, NOT A SECOND WRITER
 * ---------------------------------------------------------------------------
 * Every byte of the append-only, rotating, path-confined machinery this file
 * used to contain now lives in `.pi/lib/jsonl.ts` — moved, not copied, so the
 * rotation-race and path-confinement hardening Phase 2 proved stays in exactly
 * one place. Phase 4's safety audit log (SAFE-14) reuses the same writer
 * through its own binding, `.pi/extensions/safety/audit.ts`, without either
 * subsystem importing from the other (CONTEXT.md decision 7).
 *
 * This file's whole job is supplying the two things that are genuinely
 * diagnostics-specific:
 *
 *   - {@link OWNED_BASES} — which dated log files this subsystem may delete.
 *     `.pi/lib/jsonl.ts`'s `pruneLogs` takes `ownedBases` from the caller with
 *     no default and no shared list, precisely so this binding cannot delete
 *     the safety audit log and the safety binding cannot delete `wire-*` or
 *     `turns-*`.
 *   - {@link defaultRotateBytes} — the per-stream size cap map. `wire-*` and
 *     `turns-*` have different caps (`schema.ts`); the shared writer only
 *     knows a single neutral default.
 *
 * EVERY NAME THIS FILE EXPORTED BEFORE THE EXTRACTION IS STILL EXPORTED, WITH
 * AN IDENTICAL SIGNATURE: `logDir`, `logPath`, `rotate`, `appendJsonl`,
 * `pruneLogs`, `producedPaths`, `resetProducedPaths`, `AppendOptions`,
 * `PruneOptions`. `tests/unit/jsonl-rotation.test.ts` and
 * `tests/integration/jsonl-concurrency.test.ts` import from this path and
 * needed NO edits after this move — verified by running both against the
 * binding below with no changes to either test file.
 *
 * `logDir`, `logPath`, `rotate`, `producedPaths` and `resetProducedPaths` pass
 * straight through with no wrapping: none of them differ between bindings.
 * `appendJsonl` and `pruneLogs` are the two that inject the diagnostics-owned
 * values described above.
 *
 * ---------------------------------------------------------------------------
 * THE GATE THIS FILE USED TO CLAIM
 * ---------------------------------------------------------------------------
 * The synchronous-append-only rule and its enforcement now live in
 * `.pi/lib/jsonl.ts`'s module docstring — that is where the write actually
 * happens. `tests/unit/jsonl-append-only.test.ts` scans this directory,
 * `.pi/lib` and `.pi/extensions/safety` together, so the gate still protects
 * every path that can write a log, not only the one that used to.
 *
 * BOUNDARY RULE (BOOT-10). This module registers nothing. It does not name the
 * tool-registration call, in code or in prose, because
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`.
 */
import {
	appendJsonl as libAppendJsonl,
	logDir as libLogDir,
	logPath as libLogPath,
	producedPaths as libProducedPaths,
	pruneLogs as libPruneLogs,
	resetProducedPaths as libResetProducedPaths,
	rotate as libRotate,
} from "../../lib/jsonl.ts";
import { TURNS_LOG_BASE, TURNS_ROTATE_BYTES, WIRE_LOG_BASE, WIRE_ROTATE_BYTES } from "./schema.ts";

/** Straight pass-through: identical between every binding. */
export const logDir = libLogDir;
/** Straight pass-through: identical between every binding. */
export const logPath = libLogPath;
/** Straight pass-through: identical between every binding. */
export const rotate = libRotate;
/** Straight pass-through: process-wide, shared across every binding on purpose. */
export const producedPaths = libProducedPaths;
/** Straight pass-through: process-wide, shared across every binding on purpose. */
export const resetProducedPaths = libResetProducedPaths;

/**
 * The stream base names this binding is allowed to DELETE. Never widen without
 * a test.
 *
 * Diagnostics has no claim on anything outside these two names — in
 * particular, not `safety/schema.ts`'s `AUDIT_LOG_BASE`.
 * `tests/unit/jsonl-rotation.test.ts` plants a foreign name beside a doomed
 * owned one and asserts the foreign file survives — the paired negative that
 * makes this a control rather than a comment.
 */
const OWNED_BASES: readonly string[] = [WIRE_LOG_BASE, TURNS_LOG_BASE];

/** Default size cap for a stream, by base name. */
function defaultRotateBytes(base: string): number {
	return base === WIRE_LOG_BASE ? WIRE_ROTATE_BYTES : TURNS_ROTATE_BYTES;
}

/** Options accepted by {@link appendJsonl}. Identical shape to the shared writer's. */
export interface AppendOptions {
	/** Size cap in bytes. Defaults to the stream's constant in `schema.ts`. */
	rotateBytes?: number;
	/** Rotated files kept. Defaults to the shared writer's own default. */
	maxRotated?: number;
	/** Injected clock, for deterministic tests. */
	now?: Date;
}

/**
 * Append one JSON record to a diagnostics stream.
 *
 * Injects {@link defaultRotateBytes} when the caller omits `rotateBytes`;
 * every other option passes straight through to the shared writer.
 */
export function appendJsonl(
	cwd: string,
	base: string,
	record: unknown,
	opts: AppendOptions = {},
): string {
	return libAppendJsonl(cwd, base, record, {
		...opts,
		rotateBytes: opts.rotateBytes ?? defaultRotateBytes(base),
	});
}

/** Options accepted by {@link pruneLogs}. Identical shape to the shared writer's, minus `ownedBases`. */
export interface PruneOptions {
	/** Rotated files kept per dated stream. Defaults to the shared writer's own default. */
	maxRotated?: number;
	/** Days of history kept. Defaults to the shared writer's own default. */
	retentionDays?: number;
	/** Injected clock, for deterministic tests. */
	now?: Date;
}

/**
 * Delete aged diagnostics logs, scoped to {@link OWNED_BASES} only.
 *
 * The safety audit log and anything else under `.pi/logs/` is untouched no
 * matter what this call is given, because `ownedBases` is injected here rather
 * than accepted from the caller.
 */
export function pruneLogs(cwd: string, opts: PruneOptions = {}): string[] {
	return libPruneLogs(cwd, { ...opts, ownedBases: OWNED_BASES });
}
