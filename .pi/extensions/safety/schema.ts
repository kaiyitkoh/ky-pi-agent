/**
 * ky-pi-agent — safety subsystem constants and row types.
 *
 * PURPOSE. Mirrors `.pi/extensions/diagnostics/schema.ts`'s shape: one place
 * for every literal the writer and its tests both need, so a duplicated
 * literal cannot silently drift out of sync with what is asserted
 * (`.pi/extensions/harness/index.ts:50-56`).
 *
 * SOURCE-REVIEWABLE IN ISOLATION. This file imports nothing from
 * `.pi/extensions/diagnostics/` and nothing from `.pi/extensions/harness/` —
 * CONTEXT.md decision 7: "`safety/` imports nothing from routing or
 * workflows... source-reviewable in isolation." It sits in the credential and
 * command-execution path of a laptop where merging to `main` auto-deploys, so
 * a reader auditing this subsystem must be able to do so without also reading
 * every other subsystem this project composes.
 *
 * BOUNDARY RULE (BOOT-10). This file declares types and constants only. It
 * registers nothing, and does not spell the tool-registration call even in
 * prose — `tests/unit/contributing-boundary.test.ts` matches that name as a
 * plain substring across every tracked source under `.pi/extensions/`.
 */

/** The two verdicts an audit row can record. */
export type AuditVerdict = "allow" | "block";

/**
 * Base name of the audit stream (SAFE-14): every allowed and every blocked
 * command, in one dated file.
 *
 * Files are `audit-YYYY-MM-DD.jsonl` live and `audit-YYYY-MM-DD.<n>.jsonl`
 * rotated, matching the naming `.pi/lib/jsonl.ts` already establishes for
 * every stream.
 */
export const AUDIT_LOG_BASE = "audit";

/**
 * Rotate `audit-*` at 8 MB.
 *
 * An audit row is small — a command string, a verdict, a short reason, no
 * tool output and no file contents (see {@link AuditRow}) — so 8 MB covers
 * tens of thousands of rows, comfortably past what a single day of evasion
 * testing (SAFE-17's 30+ attempts) or ordinary use produces.
 */
export const AUDIT_ROTATE_BYTES = 8_000_000;

/**
 * One row of `audit-*.jsonl`.
 *
 * THE FIELD LIST IS THE WHOLE CONTRACT (T-04-10). A guard decision is
 * recorded as a command, a verdict and a short reason — never the tool's
 * OUTPUT and never file CONTENTS. `writeAuditRow` in `audit.ts` builds this
 * object field-by-field rather than spreading its caller's input, so an
 * extra key on the caller's side cannot reach the file even by accident.
 *
 * `pid` is what distinguishes a subagent's row from the main session's in a
 * file multiple OS processes append to concurrently (SAFE-11/SAFE-12): a
 * block that fires in the main session and never appears in a subagent's
 * audit trail is Pitfall 15's exact failure signature, and `pid` is the
 * column that tells the two apart without needing a second file per process.
 */
export interface AuditRow {
	/** `Date.now()` at row composition, or an injected value for deterministic tests. */
	ts: number;
	/** What kind of decision this row records, e.g. `"bash_call"`. Free-form, not an enum. */
	event: string;
	/** The tool this decision was made about, e.g. `"bash"`. */
	tool: string;
	/** The command text the guard evaluated. Never tool OUTPUT. */
	command: string;
	/** The working directory the command would run in. */
	cwd: string;
	/** Whether the command was allowed or blocked. */
	verdict: AuditVerdict;
	/** A short, human-readable reason for the verdict. */
	reason: string;
	/** `process.pid`, or an injected value for deterministic tests. */
	pid: number;
}
