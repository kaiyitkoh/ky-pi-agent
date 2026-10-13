/**
 * Diagnostics binding over the shared writer in `.pi/lib/jsonl.ts`, which owns append-only, rotation and path
 * confinement (and the append-only rule `tests/unit/jsonl-append-only.test.ts` enforces). This file supplies only
 * {@link OWNED_BASES} (what this subsystem may delete) and the per-stream size caps. Registers nothing.
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

/** Stream base names this binding may DELETE; never widen without a test (a paired negative covers foreign names). */
const OWNED_BASES: readonly string[] = [WIRE_LOG_BASE, TURNS_LOG_BASE, ...AUXILIARY_LOG_BASES];

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

/** Append one JSON record to a diagnostics stream, injecting the per-stream size cap when omitted. */
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

/** Delete aged diagnostics logs, scoped to {@link OWNED_BASES}; `ownedBases` is injected, never caller-supplied. */
export function pruneLogs(cwd: string, opts: PruneOptions = {}): string[] {
	return libPruneLogs(cwd, { ...opts, ownedBases: OWNED_BASES });
}
