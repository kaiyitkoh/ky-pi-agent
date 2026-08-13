/**
 * SAFE-14 — the ALLOW-and-BLOCK audit row writer.
 *
 * A thin binding over `.pi/lib/jsonl.ts`, exactly like
 * `.pi/extensions/diagnostics/jsonl.ts`. Imports NOTHING from
 * `.pi/extensions/diagnostics/` — CONTEXT.md decision 7 ("`safety/` imports
 * nothing from routing or workflows... source-reviewable in isolation") is
 * the reason the shared writer moved to a neutral `.pi/lib/` location in the
 * first place; this file is where that decision gets exercised rather than
 * just stated.
 *
 * DECISION TAKEN HERE (flagged plan-time in 04-PATTERNS.md): this binding does
 * NOT import `safeHandler` from `diagnostics/index.ts`, even though
 * `providers/index.ts` established that reuse as acceptable elsewhere in this
 * project. Decision 7's "source-reviewable in isolation" is the stricter
 * reading, and it is the one a security reviewer needs for code that sits in
 * the credential and command-execution path. Plan 08 defines a minimal local
 * equivalent inside `safety/index.ts` if one turns out to be needed there.
 *
 * WHY `writeAuditRow` NEVER THROWS. An audit write that fails must not turn a
 * BLOCK into an ALLOW: if the caller's control flow depended on `writeAuditRow`
 * succeeding before executing (or refusing) a command, an unhandled exception
 * here could bypass the guard decision entirely, which is a strictly worse
 * outcome than an unrecorded one. So failures are caught and reported as
 * `undefined`, never rethrown. [threat T-04-15, disposition: accept]
 *
 * THE RESIDUAL RISK, STATED RATHER THAN HIDDEN. A silently-unwritten audit log
 * is real: if `writeAuditRow` starts failing on every call, nothing here makes
 * that loud. Two compensating controls exist elsewhere rather than in this
 * file: Plan 10's concurrency/liveness proof, and the SAFE-12 subagent test,
 * which reads this log as its evidence and would itself go red on an empty
 * file.
 *
 * BOUNDARY RULE (BOOT-10). This module registers nothing. It does not spell
 * the tool-registration call, in code or in prose —
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`.
 */
import { appendJsonl, pruneLogs } from "../../lib/jsonl.ts";
import { AUDIT_LOG_BASE, AUDIT_ROTATE_BYTES, type AuditRow, type AuditVerdict } from "./schema.ts";

/**
 * What a caller supplies to {@link writeAuditRow}.
 *
 * `ts` and `pid` are OPTIONAL and exist only for deterministic tests — in
 * production use they default to `Date.now()` and `process.pid`. Deliberately
 * NOT a `Partial<AuditRow>` or a spread of the caller's object into the
 * written row: {@link writeAuditRow} assigns each field by name, so an extra
 * key on a caller's object (tool output, file contents, anything not in
 * {@link AuditRow}) can never reach the file even if TypeScript's structural
 * typing lets a wider object satisfy this interface at a call site.
 */
export interface AuditRowInput {
	event: string;
	tool: string;
	command: string;
	cwd: string;
	verdict: AuditVerdict;
	reason: string;
	/** Injected clock, for deterministic tests. Defaults to `Date.now()`. */
	ts?: number;
	/** Injected pid, for deterministic tests. Defaults to `process.pid`. */
	pid?: number;
}

/** Options accepted by {@link writeAuditRow}. */
export interface WriteAuditRowOptions {
	/** Which dated file this row lands in. Defaults to `new Date()`. */
	now?: Date;
	/** Size cap in bytes. Defaults to {@link AUDIT_ROTATE_BYTES}. */
	rotateBytes?: number;
}

/**
 * Append one audit row — allow or block — to `<cwd>/.pi/logs/audit-*.jsonl`.
 *
 * Returns the absolute path written on success, or `undefined` on failure.
 * NEVER THROWS — see the module docstring for why. The row is built
 * field-by-field from `input`, never spread, so nothing outside the
 * {@link AuditRow} shape can reach the file.
 */
export function writeAuditRow(
	cwd: string,
	input: AuditRowInput,
	opts: WriteAuditRowOptions = {},
): string | undefined {
	const row: AuditRow = {
		ts: input.ts ?? Date.now(),
		event: input.event,
		tool: input.tool,
		command: input.command,
		cwd: input.cwd,
		verdict: input.verdict,
		reason: input.reason,
		pid: input.pid ?? process.pid,
	};

	try {
		return appendJsonl(cwd, AUDIT_LOG_BASE, row, {
			rotateBytes: opts.rotateBytes ?? AUDIT_ROTATE_BYTES,
			now: opts.now,
		});
	} catch {
		// A failed write is reported as `undefined`, never rethrown. See the
		// module docstring: a throw here could let an audit failure short-circuit
		// the caller's own guard logic, turning a BLOCK into an unhandled
		// exception that reaches production code expecting a normal return.
		return undefined;
	}
}

/** Options accepted by {@link pruneAuditLogs}. */
export interface PruneAuditLogsOptions {
	/** Rotated files kept per dated stream. Defaults to the shared writer's own default. */
	maxRotated?: number;
	/** Days of history kept. Defaults to the shared writer's own default. */
	retentionDays?: number;
	/** Injected clock, for deterministic tests. */
	now?: Date;
}

/**
 * Delete aged audit logs, scoped to {@link AUDIT_LOG_BASE} only.
 *
 * `wire-*`, `turns-*` and anything else under `.pi/logs/` are untouched no
 * matter what this call is given, because `ownedBases` is injected here
 * rather than accepted from the caller — the same ownership-not-shape rule
 * `diagnostics/jsonl.ts`'s `pruneLogs` binding follows. [threat T-04-14]
 */
export function pruneAuditLogs(cwd: string, opts: PruneAuditLogsOptions = {}): string[] {
	return pruneLogs(cwd, { ...opts, ownedBases: [AUDIT_LOG_BASE] });
}
