/**
 * Allow-and-block audit row writer over .pi/lib/jsonl.ts; imports nothing from diagnostics/ so safety/ is reviewable in isolation.
 * writeAuditRow NEVER THROWS: a failed write must not become an exception that bypasses the guard decision.
 * A silently failing log is a residual risk, covered by the concurrency and subagent tests that read this log as evidence.
 */
import { appendJsonl, pruneLogs } from "../../lib/jsonl.ts";
import { maskSecrets } from "../../lib/secret-patterns.ts";
import { AUDIT_LOG_BASE, AUDIT_ROTATE_BYTES, type AuditRow, type AuditVerdict } from "./schema.ts";

/** Input to writeAuditRow. ts/pid exist for deterministic tests. The row is built field-by-field, never spread, so extra caller keys cannot reach the file. */
export interface AuditRowInput {
	event: string;
	tool: string;
	command: string;
	cwd: string;
	verdict: AuditVerdict;
	reason: string;
	ts?: number;
	pid?: number;
	/** Parent tool call id for nested calls (Pi 1.x `parentToolCallId`). Omitted from the row when undefined. */
	parentToolCallId?: string;
}

export interface WriteAuditRowOptions {
	now?: Date;
	rotateBytes?: number;
}

/** Masks credential values with the table the wire redactor uses, keeping the command shape. Best effort. */
export function redactSecrets(text: string): string {
	return maskSecrets(text, () => "[REDACTED]");
}

/** Append one audit row to <cwd>/.pi/logs/audit-*.jsonl; returns the path, or undefined on failure. NEVER THROWS. */
export function writeAuditRow(cwd: string, input: AuditRowInput, opts: WriteAuditRowOptions = {}): string | undefined {
	const row: AuditRow = {
		ts: input.ts ?? Date.now(),
		event: input.event,
		tool: input.tool,
		command: redactSecrets(input.command),
		cwd: input.cwd,
		verdict: input.verdict,
		reason: redactSecrets(input.reason),
		pid: input.pid ?? process.pid,
		...(input.parentToolCallId !== undefined ? { parentToolCallId: input.parentToolCallId } : {}),
	};
	try {
		return appendJsonl(cwd, AUDIT_LOG_BASE, row, { rotateBytes: opts.rotateBytes ?? AUDIT_ROTATE_BYTES, now: opts.now });
	} catch {
		// Never rethrown: a throw here could bypass the caller's guard logic.
		return undefined;
	}
}

export interface PruneAuditLogsOptions {
	maxRotated?: number;
	retentionDays?: number;
	now?: Date;
}

/** Delete aged audit logs, scoped to AUDIT_LOG_BASE via an injected ownedBases so wire-* and turns-* are never touched. */
export function pruneAuditLogs(cwd: string, opts: PruneAuditLogsOptions = {}): string[] {
	return pruneLogs(cwd, { ...opts, ownedBases: [AUDIT_LOG_BASE] });
}
