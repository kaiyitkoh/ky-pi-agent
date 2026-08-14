/**
 * GATE-07 — the evidence gate.
 *
 * PURPOSE. The model that writes prose tool calls (`diagnostics/prose.ts`
 * exists because it does) can equally write plausible command output. A
 * completion claim is worthless unless a Pi-computed tool result, captured
 * at the SHA that is still HEAD, actually supports it. This module owns
 * that predicate, the run-state buffer `/quick` (plan 06-02) arms and
 * drains, and the JSONL record of every verdict.
 *
 * WHY `isError` IS TRUSTED AND MESSAGE TEXT IS NOT. `ToolResultEventBase`
 * [CITED: pi 0.84.1 dist/core/extensions/types.d.ts:691-699] carries a
 * structural `isError: boolean` set by Pi's own tool-execution machinery
 * from the real process exit code — never written by the model. Reading
 * `dist/core/tools/bash.js:320-348` directly: on a non-zero exit the bash
 * tool THROWS, which Pi converts to `isError: true`; on success it returns
 * `{content, details}` with no exit code anywhere. The model's `content`
 * blocks are a separate field entirely and are never consulted here — this
 * is GATE-07's whole answer to a fabricated transcript.
 *
 * THIS MODULE OWNS THE LOG BASE NAME `"evidence"`. `wire-*`, `turns-*` and
 * `audit-*` belong to other subsystems; {@link pruneEvidenceLogs} can never
 * touch them because `ownedBases` is injected locally, never accepted from a
 * caller — the same "ownership, not shape" rule `.pi/lib/jsonl.ts` states
 * for every binding.
 *
 * PURE EXCEPT FOR TWO CLEARLY SEPARATED IMPURE FUNCTIONS: {@link
 * writeEvidenceRow} (file I/O) and {@link pruneEvidenceLogs} (file I/O).
 * Everything else — {@link gateCompletion}, {@link recordFromToolResult},
 * the run-state accessors — takes and returns plain data.
 *
 * THIS MODULE REGISTERS NOTHING. It imports nothing from `../routing/` and
 * nothing from `../safety/` (CONTEXT.md decision 8: subsystems meet only
 * inside a command, never through an import) and does not spell the
 * tool-registration call, in code or in prose —
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`.
 */
import { redactString } from "../diagnostics/redact.ts";
import { appendJsonl, pruneLogs } from "../../lib/jsonl.ts";

/**
 * Base name of the evidence stream: one JSONL row per `/quick` run's
 * completion verdict.
 */
export const EVIDENCE_LOG_BASE = "evidence";

/** Rotate `evidence-*` at 8 MB, mirroring `safety/schema.ts`'s `AUDIT_ROTATE_BYTES`. */
export const EVIDENCE_ROTATE_BYTES = 8_000_000;

/**
 * One captured tool result, reduced to exactly the fields GATE-07 needs.
 *
 * `command` is a redacted, truncated rendering of the tool's INPUT, never
 * its output and never the model's message text — see
 * {@link recordFromToolResult}.
 */
export interface EvidenceRecord {
	readonly ts: number;
	readonly toolName: string;
	readonly command: string;
	readonly isError: boolean;
	readonly sha: string;
}

/**
 * The whole GATE-07 decision (decision D-C: mirrors `GuardVerdict`/
 * `PlanResult`, since this renders a verdict about a CLAIM, not about a
 * command).
 */
export type EvidenceVerdict = { readonly ok: true; readonly sha: string } | { readonly ok: false; readonly reason: string };

/**
 * Build an {@link EvidenceRecord} from a captured `tool_result`.
 *
 * `command` is `redactString` applied to `String(toolInput.command ??
 * toolInput.path ?? "")`, truncated to 200 characters. Nothing else from
 * `toolInput` is copied, so a file body read by the `write` tool can never
 * reach the record.
 */
export function recordFromToolResult(input: {
	toolName: string;
	toolInput: Record<string, unknown>;
	isError: boolean;
	sha: string;
	ts?: number;
}): EvidenceRecord {
	const raw = String(input.toolInput.command ?? input.toolInput.path ?? "");
	const command = redactString(raw).slice(0, 200);
	return {
		ts: input.ts ?? Date.now(),
		toolName: input.toolName,
		command,
		isError: input.isError,
		sha: input.sha,
	};
}

/**
 * The pure predicate. First-match-wins, mirroring `classifyGitInvocation`'s
 * structure. BRANCH ORDER IS BINDING:
 *
 *   (1) no record at all -> reject, naming that a completion claim needs a
 *       structured tool result and that transcript text is not evidence.
 *   (2) no record whose `sha === headSha` -> reject, naming the recorded
 *       SHA(s) and `headSha`, stating the claim is stale.
 *   (3) every record at `headSha` has `isError === true` (none passing) ->
 *       reject, naming the failing tool(s).
 *   (4) otherwise -> accept, carrying `headSha`.
 *
 * Reject reasons are built from the record data itself, never from a
 * caller-supplied string. A record set containing one stale-but-passing and
 * one fresh-but-failing entry still rejects at step (3): a passing record
 * from a different SHA can never be "borrowed" to satisfy a claim at
 * `headSha`, because step (2) has already narrowed to records AT `headSha`
 * before step (3) ever inspects `isError`.
 */
export function gateCompletion(records: readonly EvidenceRecord[], headSha: string): EvidenceVerdict {
	if (records.length === 0) {
		return {
			ok: false,
			reason:
				"no structured tool result was recorded for this completion claim -- transcript text is not evidence, " +
				"however convincing it reads",
		};
	}

	const atHead = records.filter((r) => r.sha === headSha);
	if (atHead.length === 0) {
		const recordedShas = Array.from(new Set(records.map((r) => r.sha))).join(", ");
		return {
			ok: false,
			reason:
				`recorded evidence is stale: recorded at ${recordedShas}, but HEAD is now ${headSha} -- this ` +
				"completion claim's evidence does not match the current commit",
		};
	}

	const passingAtHead = atHead.filter((r) => !r.isError);
	if (passingAtHead.length === 0) {
		const failingTools = Array.from(new Set(atHead.filter((r) => r.isError).map((r) => r.toolName))).join(", ");
		return {
			ok: false,
			reason: `evidence at HEAD (${headSha}) includes a failed tool result from ${failingTools} and no passing one`,
		};
	}

	return { ok: true, sha: headSha };
}

// ---------------------------------------------------------------------------
// Run state -- one globalThis-keyed slot (see routing/modes.ts's identical
// STATE-SLOT HAZARD reasoning: two jiti module instances in one process is a
// measured bug in this repo, not a hypothetical).
// ---------------------------------------------------------------------------

const RUN_STATE_KEY = "__kypiQuickRun";

interface RunState {
	readonly cwd: string;
	readonly baseSha: string;
	readonly records: EvidenceRecord[];
}

function runSlot(): RunState | undefined {
	const raw = (globalThis as Record<string, unknown>)[RUN_STATE_KEY];
	return raw as RunState | undefined;
}

/** Arm a run: clears any prior buffer and stores `{cwd, baseSha, records: []}`. */
export function startRun(cwd: string, sha: string): void {
	const state: RunState = { cwd, baseSha: sha, records: [] };
	(globalThis as Record<string, unknown>)[RUN_STATE_KEY] = state;
}

/** Append one record to the armed run. No-op when no run is armed, so an ordinary session turn outside `/quick` records nothing. */
export function recordToolResult(record: EvidenceRecord): void {
	const state = runSlot();
	if (state === undefined) {
		return;
	}
	state.records.push(record);
}

/** True when a run is currently armed. */
export function isRunArmed(): boolean {
	return runSlot() !== undefined;
}

/**
 * Compute the verdict for the armed run, write exactly one evidence row,
 * disarm, and return the verdict. Returns `undefined` when no run is armed.
 */
export function endRun(headSha: string): EvidenceVerdict | undefined {
	const state = runSlot();
	if (state === undefined) {
		return undefined;
	}
	const verdict = gateCompletion(state.records, headSha);
	writeEvidenceRow(state.cwd, {
		verdict: verdict.ok ? "accept" : "reject",
		reason: verdict.ok ? `evidence accepted at ${headSha}` : verdict.reason,
		baseSha: state.baseSha,
		headSha,
		recordCount: state.records.length,
		tools: Array.from(new Set(state.records.map((r) => r.toolName))),
	});
	(globalThis as Record<string, unknown>)[RUN_STATE_KEY] = undefined;
	return verdict;
}

// ---------------------------------------------------------------------------
// JSONL binding -- a thin binding over `.pi/lib/jsonl.ts`, copying
// `safety/audit.ts`'s shape line for line.
// ---------------------------------------------------------------------------

/** What a caller supplies to {@link writeEvidenceRow}. */
export interface EvidenceRowInput {
	readonly verdict: "accept" | "reject";
	readonly reason: string;
	readonly baseSha: string;
	readonly headSha: string;
	readonly recordCount: number;
	readonly tools: readonly string[];
	/** Injected clock, for deterministic tests. Defaults to `Date.now()`. */
	readonly ts?: number;
}

/**
 * Append one evidence row to `<cwd>/.pi/logs/evidence-*.jsonl`.
 *
 * Returns the absolute path written on success, or `undefined` on failure.
 * NEVER THROWS (decision D-D, same contract as `safety/audit.ts`'s
 * `writeAuditRow`): a log-write failure must not be able to turn a REJECT
 * into an unhandled exception in the caller's control flow. The row is
 * built field by field, never a spread of the caller's input or of an
 * {@link EvidenceRecord}, so no tool output can reach the file.
 */
export function writeEvidenceRow(cwd: string, input: EvidenceRowInput): string | undefined {
	const row = {
		ts: input.ts ?? Date.now(),
		event: "workflows.evidence",
		verdict: input.verdict,
		reason: input.reason,
		baseSha: input.baseSha,
		headSha: input.headSha,
		recordCount: input.recordCount,
		tools: input.tools,
	};
	try {
		return appendJsonl(cwd, EVIDENCE_LOG_BASE, row, { rotateBytes: EVIDENCE_ROTATE_BYTES });
	} catch {
		return undefined;
	}
}

/** Options accepted by {@link pruneEvidenceLogs}. */
export interface PruneEvidenceLogsOptions {
	readonly maxRotated?: number;
	readonly retentionDays?: number;
	/** Injected clock, for deterministic tests. */
	readonly now?: Date;
}

/**
 * Delete aged evidence logs, scoped to {@link EVIDENCE_LOG_BASE} only.
 *
 * `ownedBases` is injected here rather than accepted from the caller, so
 * pruning can never delete `wire-*`, `turns-*` or `audit-*`.
 */
export function pruneEvidenceLogs(cwd: string, opts: PruneEvidenceLogsOptions = {}): string[] {
	return pruneLogs(cwd, {
		ownedBases: [EVIDENCE_LOG_BASE],
		maxRotated: opts.maxRotated,
		retentionDays: opts.retentionDays,
		now: opts.now,
	});
}
