/**
 * Evidence gate: a completion claim needs a Pi-computed tool result captured at the SHA that is still HEAD.
 * `isError` is trusted because Pi sets it from the real exit code (dist/core/tools/bash.js throws on non-zero;
 * core/extensions/types.d.ts ToolExecutionEndEvent); the model's content blocks are never consulted. Emitted for every finalized call, which is why capture is at tool_execution_end.
 * Owns log base "evidence"; pruning only touches that base. Registers nothing and imports nothing from ../routing or ../safety.
 */
import { redactString } from "../diagnostics/redact.ts";
import { appendJsonl, pruneLogs } from "../../lib/jsonl.ts";

/** Base name of the evidence stream: one JSONL row per `/quick` run verdict. */
export const EVIDENCE_LOG_BASE = "evidence";

/** Rotate `evidence-*` at 8 MB, mirroring `safety/schema.ts`'s `AUDIT_ROTATE_BYTES`. */
export const EVIDENCE_ROTATE_BYTES = 8_000_000;

/** One captured tool result; `command` is a redacted, truncated rendering of the tool INPUT, never output. */
export interface EvidenceRecord {
	readonly ts: number;
	readonly toolName: string;
	readonly command: string;
	readonly isError: boolean;
	readonly sha: string;
}

/** The gate decision: a verdict about a claim, mirroring GuardVerdict. */
export type EvidenceVerdict = { readonly ok: true; readonly sha: string } | { readonly ok: false; readonly reason: string };

/** Build a record from a captured tool result; only `command`/`path` of the input is copied, so file bodies never reach it. */
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
 * The pure predicate; first match wins and BRANCH ORDER IS BINDING:
 *   (1) no record -> reject; transcript text is not evidence.
 *   (2) HEAD never moved -> reject: every record is trivially "at HEAD", so none can support a claim.
 *   (6) HEAD moved but its tree equals the tree at arm time -> reject (empty commit). Numbered (6) because callers and docs use that label.
 *       It sits after (2) and before (3) so a recorded failure outranks it.
 *   (3) any record has isError -> reject, naming the failing tools. Before (4) so a later commit cannot age out a failure.
 *   (4) no record at HEAD -> reject as stale.
 *   (5) otherwise accept, carrying headSha.
 * Cannot prove the diff contains the claimed work, so callers must not describe ACCEPT as an endorsement (docs/WORKFLOWS.md section 4).
 */
export function gateCompletion(
	records: readonly EvidenceRecord[],
	headSha: string,
	baseSha: string,
	headTree: string,
	baseTree: string,
): EvidenceVerdict {
	if (records.length === 0) {
		return {
			ok: false,
			reason:
				"no structured tool result was recorded for this completion claim -- transcript text is not evidence, " +
				"however convincing it reads",
		};
	}

	if (headSha === baseSha) {
		return {
			ok: false,
			reason:
				`no commit was made during this run -- HEAD is still ${headSha}, so the recorded tool results predate ` +
				"any work landing and cannot support a completion claim",
		};
	}

	// (6) HEAD moved but its tree is byte-identical to the one at arm time: an empty commit.
	if (headTree === baseTree) {
		return {
			ok: false,
			reason:
				`HEAD moved to ${headSha} but its tree (${headTree}) is byte-identical to the tree recorded at arm ` +
				`time (${baseTree}) -- the commit contains no change and cannot support a completion claim`,
		};
	}

	// (3) Any failure in the run rejects, before the headSha narrowing; every record in a run belongs to one task.
	const failing = records.filter((r) => r.isError);
	if (failing.length > 0) {
		const failingTools = Array.from(new Set(failing.map((r) => r.toolName))).join(", ");
		return {
			ok: false,
			reason:
				`a tool result in this run failed (${failingTools}) -- a completion claim cannot be supported by a ` +
				"run that contains a recorded failure, even if a commit landed afterwards",
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

	return { ok: true, sha: headSha };
}

// Run state: one globalThis-keyed slot, because two jiti module instances in one process is a measured bug (see routing/modes.ts).
const RUN_STATE_KEY = "__kypiQuickRun";

interface RunState {
	readonly cwd: string;
	readonly baseSha: string;
	/** The tree HEAD pointed at when armed; fed to branch (6). */
	readonly baseTree: string;
	readonly records: EvidenceRecord[];
}

function runSlot(): RunState | undefined {
	const raw = (globalThis as Record<string, unknown>)[RUN_STATE_KEY];
	return raw as RunState | undefined;
}

/** Arm a run: clears any prior buffer and stores `{cwd, baseSha, baseTree, records: []}`. */
export function startRun(cwd: string, sha: string, tree: string): void {
	const state: RunState = { cwd, baseSha: sha, baseTree: tree, records: [] };
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

/** Push a synthetic failing record so a throwing capture rejects at branch (3) instead of vanishing. No-op when unarmed. */
export function recordCaptureFailure(toolName: string): void {
	const state = runSlot();
	if (state !== undefined) state.records.push({ ts: Date.now(), toolName: `${toolName} (capture failed)`, command: "", isError: true, sha: "" });
}

/** True when a run is currently armed. */
export function isRunArmed(): boolean {
	return runSlot() !== undefined;
}

/** The cwd the armed run was armed against, or `undefined` when unarmed. */
export function armedCwd(): string | undefined {
	return runSlot()?.cwd;
}

/** Compute the verdict for the armed run, write one evidence row, disarm. Returns `undefined` when unarmed. */
export function endRun(headSha: string, headTree: string): EvidenceVerdict | undefined {
	const state = runSlot();
	if (state === undefined) {
		return undefined;
	}
	const verdict = gateCompletion(state.records, headSha, state.baseSha, headTree, state.baseTree);
	writeEvidenceRow(state.cwd, {
		verdict: verdict.ok ? "accept" : "reject",
		// States what was checked (HEAD moved, no failure), not an endorsement.
		reason: verdict.ok
			? `HEAD moved to ${headSha} with no failed tool result recorded during this run -- whether a commit was created, and whether it contains the work, are both unverified`
			: verdict.reason,
		baseSha: state.baseSha,
		headSha,
		recordCount: state.records.length,
		tools: Array.from(new Set(state.records.map((r) => r.toolName))),
	});
	(globalThis as Record<string, unknown>)[RUN_STATE_KEY] = undefined;
	return verdict;
}

// JSONL binding: a thin copy of safety/audit.ts's shape over .pi/lib/jsonl.ts.

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
 * Append one row to `<cwd>/.pi/logs/evidence-*.jsonl`; returns the path, or undefined on failure.
 * NEVER THROWS (same contract as writeAuditRow): a log failure must not turn a REJECT into an exception.
 * Fields are copied one by one so no tool output can reach the file.
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

/** Delete aged evidence logs; `ownedBases` is fixed here so wire-*, turns-* and audit-* are never touched. */
export function pruneEvidenceLogs(cwd: string, opts: PruneEvidenceLogsOptions = {}): string[] {
	return pruneLogs(cwd, {
		ownedBases: [EVIDENCE_LOG_BASE],
		maxRotated: opts.maxRotated,
		retentionDays: opts.retentionDays,
		now: opts.now,
	});
}
