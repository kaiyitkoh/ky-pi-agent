/**
 * Safety constants and audit row types; imports nothing from diagnostics/ or harness/ so this credential-path subsystem is reviewable in isolation.
 */

export type AuditVerdict = "allow" | "block";

/** Base name of the audit stream: audit-YYYY-MM-DD.jsonl live, audit-YYYY-MM-DD.<n>.jsonl rotated. */
export const AUDIT_LOG_BASE = "audit";

/** Rotate audit-* at 8 MB; rows are small (command, verdict, reason; no tool output). */
export const AUDIT_ROTATE_BYTES = 8_000_000;

/**
 * One row of audit-*.jsonl. The field list is the whole contract: a command, a verdict and a short reason, never tool output
 * or file contents. `pid` tells a subagent's rows from the main session's in a file several processes append to.
 */
export interface AuditRow {
	ts: number;
	event: string;
	tool: string;
	command: string;
	cwd: string;
	verdict: AuditVerdict;
	reason: string;
	pid: number;
	/** Set only on nested calls (e.g. codemode `executeTool`): the parent tool call id. Additive. */
	parentToolCallId?: string;
}
