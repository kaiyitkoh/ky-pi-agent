/**
 * Allow-and-block audit row writer over .pi/lib/jsonl.ts; imports nothing from diagnostics/ so safety/ is reviewable in isolation.
 * writeAuditRow NEVER THROWS: a failed write must not become an exception that bypasses the guard decision.
 * A silently failing log is a residual risk, covered by the concurrency and subagent tests that read this log as evidence.
 */
import { appendJsonl, pruneLogs } from "../../lib/jsonl.ts";
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

/** Local secret redaction (safety/ must not import diagnostics/): masks credential values, keeps the command shape. Best effort. */
const SECRET_PATTERNS: readonly [RegExp, string][] = [
	[/\b(AKIA|ASIA)[0-9A-Z]{16}/g, "[REDACTED]"],
	[/\bsk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]"],
	[/\b(gh[pousr]_|glpat-|xox[abprs]-)[A-Za-z0-9_-]{10,}/g, "[REDACTED]"],
	[/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]"],
	[/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[REDACTED]"],
	[/(?<![\w-])(?:-u|--user)[ =]+[^\s:'"]+:[^\s'"]+/g, "-u [REDACTED]"],
	[/(?<=\bmysql(?:dump|admin)?\b[^\n|;&]{0,200}\s)-p\S+/g, "-p[REDACTED]"],
	[
		/((?:password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization|credential)[A-Za-z0-9_-]*["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"'&;]+)/gi,
		"$1[REDACTED]",
	],
];

export function redactSecrets(text: string): string {
	let out = text;
	for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
	return out;
}

/** Append one audit row to <cwd>/.pi/logs/audit-*.jsonl; returns the path, or undefined on failure. NEVER THROWS. */
export function writeAuditRow(
	cwd: string,
	input: AuditRowInput,
	opts: WriteAuditRowOptions = {},
): string | undefined {
	const row: AuditRow = {
		ts: input.ts ?? Date.now(),
		event: input.event,
		tool: input.tool,
		command: redactSecrets(input.command),
		cwd: input.cwd,
		verdict: input.verdict,
		reason: redactSecrets(input.reason),
		pid: input.pid ?? process.pid,
	};
	if (input.parentToolCallId !== undefined) {
		row.parentToolCallId = input.parentToolCallId;
	}

	try {
		return appendJsonl(cwd, AUDIT_LOG_BASE, row, {
			rotateBytes: opts.rotateBytes ?? AUDIT_ROTATE_BYTES,
			now: opts.now,
		});
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
