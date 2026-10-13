/**
 * Evidence gate: a completion claim needs a new commit and a Pi-computed tool result captured at it; transcript text is never read.
 * `isError` comes from the real exit code (pi-coding-agent dist/core/tools/bash.js). Rationale: docs/WORKFLOWS.md section 4.
 */
import { spawnSync } from "node:child_process";

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
export type EvidenceVerdict =
	| { readonly ok: true; readonly sha: string; readonly failedToolCalls: number }
	| { readonly ok: false; readonly reason: string };

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

/** True when `headSha` is a commit built on top of `baseSha`; false for a checkout or reset to any other commit, or when git cannot say. */
export function isStrictDescendant(cwd: string, baseSha: string, headSha: string): boolean {
	if (baseSha === "" || headSha === "" || baseSha === headSha) return false;
	const r = spawnSync("git", ["merge-base", "--is-ancestor", baseSha, headSha], { cwd, shell: false, windowsHide: true });
	return r.status === 0;
}

/** How far before the arm a commit's dates may fall and still count, so a clock stepped back mid-run is not a false reject. */
export const COMMIT_CLOCK_TOLERANCE_MS = 120_000;

const COMMIT_ROW = /^([0-9a-f]{40,64})\|(\d+)\|(\d+)$/;

/**
 * True when every commit in `baseSha..headSha` has one parent and was authored and committed no earlier than
 * `armedAtMs` less the clock tolerance. A pull, merge or cherry-pick brings in older commits, so it fails; false when git cannot say.
 */
export function onlyCommitsSince(cwd: string, baseSha: string, headSha: string, armedAtMs: number): boolean {
	// `log.showSignature` in the user's gitconfig prints verification lines to stdout ahead of each row.
	const args = ["-c", "log.showSignature=false", "log", "--no-show-signature", "--no-color", "--format=%P|%at|%ct", `${baseSha}..${headSha}`, "--"];
	const r = spawnSync("git", args, { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	const rows = (r.stdout ?? "").split("\n").filter((line) => line.trim() !== "");
	const floor = Math.floor((armedAtMs - COMMIT_CLOCK_TOLERANCE_MS) / 1000);
	const fresh = (m: RegExpExecArray | null): boolean => m !== null && Number(m[2]) >= floor && Number(m[3]) >= floor;
	return r.status === 0 && rows.length > 0 && rows.every((row) => fresh(COMMIT_ROW.exec(row.trim())));
}

/**
 * First match wins: no record, unreadable HEAD, HEAD unmoved, HEAD not built on the base, empty commit, no record at HEAD.
 * Failed intermediate calls are counted, not fatal; the caller checks the declared verification.
 */
export function gateCompletion(
	records: readonly EvidenceRecord[],
	headSha: string,
	baseSha: string,
	headTree: string,
	baseTree: string,
	headDescendsFromBase: boolean,
): EvidenceVerdict {
	if (records.length === 0) {
		return {
			ok: false,
			reason:
				"no structured tool result was recorded for this completion claim -- transcript text is not evidence, " +
				"however convincing it reads",
		};
	}

	if (headSha === "" || headTree === "") {
		return { ok: false, reason: "HEAD could not be read when the run settled, so no commit can be attributed to it" };
	}

	if (headSha === baseSha) {
		return {
			ok: false,
			reason:
				`no commit was made during this run -- HEAD is still ${headSha}, so the recorded tool results predate ` +
				"any work landing and cannot support a completion claim",
		};
	}

	if (!headDescendsFromBase) {
		return {
			ok: false,
			reason:
				`HEAD moved to ${headSha}, which is not a new commit on top of ${baseSha} made during this run -- a checkout, reset, ` +
				"pull, merge or cherry-pick moves HEAD to commits the run did not make, so it cannot support a completion claim",
		};
	}

	// HEAD moved but its tree is byte-identical to the one at arm time: an empty commit.
	if (headTree === baseTree) {
		return {
			ok: false,
			reason:
				`HEAD moved to ${headSha} but its tree (${headTree}) is byte-identical to the tree recorded at arm ` +
				`time (${baseTree}) -- the commit contains no change and cannot support a completion claim`,
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

	return { ok: true, sha: headSha, failedToolCalls: records.filter((r) => r.isError).length };
}

// Run state: one globalThis-keyed slot, because two jiti module instances in one process is a measured bug (see routing/modes.ts).
const RUN_STATE_KEY = "__kypiQuickRun";

interface RunState {
	readonly cwd: string;
	readonly baseSha: string;
	/** The tree HEAD pointed at when armed; used to detect an empty commit. */
	readonly baseTree: string;
	readonly records: EvidenceRecord[];
	readonly armedAt: number;
	/** The prompt that starts this run; until a prompt containing it starts, the run records and settles nothing. */
	readonly prompt?: string;
	started: boolean;
}

function runSlot(): RunState | undefined {
	const raw = (globalThis as Record<string, unknown>)[RUN_STATE_KEY];
	return raw as RunState | undefined;
}

/** Arm a run, replacing any prior one. With `prompt`, the run waits for that prompt to start; without, it counts as started. */
export function startRun(cwd: string, sha: string, tree: string, prompt?: string): void {
	const state: RunState = { cwd, baseSha: sha, baseTree: tree, records: [], armedAt: Date.now(), prompt, started: prompt === undefined };
	(globalThis as Record<string, unknown>)[RUN_STATE_KEY] = state;
}

/** Append one record to the armed run. No-op when no run is armed, so an ordinary session turn outside `/quick` records nothing. */
export function recordToolResult(record: EvidenceRecord): void {
	const state = runSlot();
	if (state === undefined || !state.started) {
		return;
	}
	state.records.push(record);
}

/** Push a synthetic failing record so a throwing capture is counted instead of vanishing. No-op when unarmed. */
export function recordCaptureFailure(toolName: string): void {
	const state = runSlot();
	if (state?.started === true) state.records.push({ ts: Date.now(), toolName: `${toolName} (capture failed)`, command: "", isError: true, sha: "" });
}

/** True when a run is currently armed. */
export function isRunArmed(): boolean {
	return runSlot() !== undefined;
}

/** True when a run is armed but the prompt that starts it has not started; such a run must not settle any turn. */
export function isRunPending(): boolean {
	return runSlot()?.started === false;
}

/**
 * Starts the pending run when its own prompt reaches before_agent_start (`starting`); any other prompt seen first disarms it,
 * since Pi can drop the run's prompt before it starts. Returns true when it disarmed. Rationale: docs/WORKFLOWS.md section 2.
 */
export function notePromptForRun(text: string, starting: boolean): boolean {
	const state = runSlot();
	if (state === undefined || state.started || state.prompt === undefined) return false;
	if (text.includes(state.prompt)) {
		if (starting) state.started = true;
		return false;
	}
	disarmRun();
	return true;
}

/** The cwd the armed run was armed against, or `undefined` when unarmed. */
export function armedCwd(): string | undefined {
	return runSlot()?.cwd;
}

/** Drop the armed run without a verdict or an evidence row, for a run the user aborted. */
export function disarmRun(): void {
	(globalThis as Record<string, unknown>)[RUN_STATE_KEY] = undefined;
}

/** What a settled run carries into its single evidence row. */
export interface RunSummary {
	readonly cwd: string;
	readonly baseSha: string;
	readonly headSha: string;
	readonly recordCount: number;
	readonly tools: readonly string[];
	readonly failedToolCalls: number;
}

export type EndedRun = EvidenceVerdict & { readonly run: RunSummary };

/**
 * Compute the commit verdict for the armed run and disarm it. Writes nothing: the caller writes exactly one row with
 * {@link writeRunEvidence} once every later check (verification, clean tree, drift, gate) has decided. `undefined` when unarmed.
 */
export function endRun(headSha: string, headTree: string): EndedRun | undefined {
	const state = runSlot();
	if (state === undefined) {
		return undefined;
	}
	const descends = isStrictDescendant(state.cwd, state.baseSha, headSha) && onlyCommitsSince(state.cwd, state.baseSha, headSha, state.armedAt);
	const verdict = gateCompletion(state.records, headSha, state.baseSha, headTree, state.baseTree, descends);
	(globalThis as Record<string, unknown>)[RUN_STATE_KEY] = undefined;
	const run: RunSummary = {
		cwd: state.cwd,
		baseSha: state.baseSha,
		headSha,
		recordCount: state.records.length,
		tools: Array.from(new Set(state.records.map((r) => r.toolName))),
		failedToolCalls: state.records.filter((r) => r.isError).length,
	};
	return { ...verdict, run };
}

/** What an accepted commit verdict states: what was checked, never an endorsement of the work. */
export function acceptedReason(run: RunSummary): string {
	return `HEAD moved to ${run.headSha}, a new commit on the base with a changed tree; ${run.failedToolCalls} failed tool call(s) logged -- whether the commit contains the work is unverified`;
}

/** The one evidence row for a settled run, carrying its final verdict. */
export function writeRunEvidence(run: RunSummary, verdict: EvidenceRowInput["verdict"], reason: string): void {
	writeEvidenceRow(run.cwd, { verdict, reason, baseSha: run.baseSha, headSha: run.headSha, recordCount: run.recordCount, tools: run.tools, failedToolCalls: run.failedToolCalls });
}

// JSONL binding: a thin copy of safety/audit.ts's shape over .pi/lib/jsonl.ts.

/** What a caller supplies to {@link writeEvidenceRow}. */
export interface EvidenceRowInput {
	/** "unverified": a commit landed but no deterministic check could run on it, and nobody approved recording it. */
	readonly verdict: "accept" | "reject" | "unverified";
	readonly reason: string;
	readonly baseSha: string;
	readonly headSha: string;
	readonly recordCount: number;
	readonly tools: readonly string[];
	readonly failedToolCalls?: number;
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
		failedToolCalls: input.failedToolCalls ?? 0,
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
