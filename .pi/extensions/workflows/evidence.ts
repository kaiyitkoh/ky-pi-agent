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
 * WHY `isError` IS TRUSTED AND MESSAGE TEXT IS NOT. `ToolExecutionEndEvent`
 * [CITED: pi 0.84.1 dist/core/extensions/types.d.ts:593-599] carries a
 * structural `isError: boolean` set by Pi's own tool-execution machinery from
 * the real process exit code — never written by the model, and emitted for
 * EVERY finalized call, including a blocked/invalid/unknown/aborted
 * "immediate" one -- why `index.ts` captures here, not at `tool_result`
 * (CR-01, iteration 3). Reading `dist/core/tools/bash.js:320-348` directly:
 * on a non-zero exit the bash tool THROWS, converted to `isError: true`; on
 * success it returns `{content, details}` with no exit code anywhere. The
 * model's `content` blocks are a separate field, never consulted here — this
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
 *   (2) HEAD never moved (`headSha === baseSha`) -> reject: HEAD is still
 *       what it was when the run was armed, so every record captured is
 *       trivially "at HEAD" by construction and cannot support a completion
 *       claim (CR-01a: this is what stops `bash echo hi` -- or a bare
 *       `read`, which is not even a command -- from satisfying a claim).
 *   (6) [Phase 8, GATE-01] `headTree === baseTree` -> reject: HEAD MOVED
 *       (branch (2) already ruled out the unmoved case) but the tree it now
 *       points at is byte-identical to the tree recorded at arm time -- the
 *       commit, if any, contains no change and cannot support a completion
 *       claim. THIS BRANCH IS POSITIONED HERE, IMMEDIATELY AFTER (2) AND
 *       BEFORE (3), NOT APPENDED AT THE END -- deliberately, and the position
 *       is as binding as the branch itself: (2) catches "no commit at all"
 *       and (6) catches "a commit that changed nothing"; they are the same
 *       class of claim ("HEAD-shaped evidence of work that is not evidence
 *       of work") and belong adjacent in the reading order. It still sits
 *       BEFORE (3) because a recorded tool failure must outrank BOTH of
 *       them, for the identical reason (3)'s own comment gives: a failure is
 *       a fact about the run's task that a later HEAD movement -- empty
 *       commit or not -- does not retroactively erase. Numbered (6), not
 *       renumbered into sequence, because that is the label every caller,
 *       test and doc in this codebase uses for it; the docstring states the
 *       true execution position explicitly rather than relying on the
 *       number to imply it.
 *   (3) ANY record in the run has `isError === true` -> reject, naming every
 *       failing tool. This branch sits BEFORE the `headSha`-vs-evidence
 *       narrowing on purpose (CR-01b): a failed tool result is a fact about
 *       this run's task, and a commit landing AFTER the failure does not
 *       retroactively make it irrelevant -- the failing record must not be
 *       "aged out" of the predicate just because it no longer sits at the
 *       SHA that ends up being HEAD. Without this branch the accept
 *       condition silently reduced to "a commit landed via a tool call that
 *       exited 0", because the only record that can ever sit AT a
 *       post-commit HEAD is the commit call itself.
 *   (4) no record whose `sha === headSha` -> reject, naming the recorded
 *       SHA(s) and `headSha`, stating the claim is stale.
 *   (5) otherwise -> accept, carrying `headSha`. Because branch (3) already
 *       rejected any run containing a failure, every record surviving to
 *       here is known-passing; there is no separate "all failing at HEAD"
 *       branch left to reach.
 *
 * Reject reasons are built from the record data itself, never from a
 * caller-supplied string. A record set containing one stale-but-passing and
 * one fresh-but-failing entry still rejects at step (3), globally, before
 * `headSha` is even consulted -- the fresh failure cannot be diluted by an
 * unrelated stale pass, and (per CR-01) cannot be buried by a LATER commit
 * either.
 *
 * WHAT THIS PREDICATE DOES NOT, AND CANNOT, PROVE: that the commit's diff
 * contains the claimed work, or that anything meaningful was verified at
 * all -- a commit of wholly unrelated content, whose tree DIFFERS from the
 * tree recorded at arm time, still ACCEPTS here, because deciding whether a
 * diff contains the CLAIMED work is a semantic judgement this predicate does
 * not, and cannot, make. (An empty commit, or any other way HEAD can end up
 * pointing at a byte-identical tree, is what branch (6) above closes -- that
 * narrower gap is no longer open.) Callers must not describe an ACCEPT
 * verdict as an endorsement of the work; see `index.ts`'s notification text
 * and `docs/WORKFLOWS.md` section 4.
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

	// (6) [Phase 8, GATE-01]: HEAD moved (branch (2) above already excluded
	// the unmoved case) but its tree is byte-identical to the tree recorded
	// at arm time -- the commit contains no change. See this function's own
	// docstring for why this sits here, between (2) and (3), rather than at
	// the end.
	if (headTree === baseTree) {
		return {
			ok: false,
			reason:
				`HEAD moved to ${headSha} but its tree (${headTree}) is byte-identical to the tree recorded at arm ` +
				`time (${baseTree}) -- the commit contains no change and cannot support a completion claim`,
		};
	}

	// (3) CR-01: any failed tool result ANYWHERE in this run -> reject. Sits
	// BEFORE the headSha narrowing so a failure cannot be aged out of
	// relevance by a commit made after it -- within one run every record
	// belongs to the same task.
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

// ---------------------------------------------------------------------------
// Run state -- one globalThis-keyed slot (see routing/modes.ts's identical
// STATE-SLOT HAZARD reasoning: two jiti module instances in one process is a
// measured bug in this repo, not a hypothetical).
// ---------------------------------------------------------------------------

const RUN_STATE_KEY = "__kypiQuickRun";

interface RunState {
	readonly cwd: string;
	readonly baseSha: string;
	/** [Phase 8, GATE-01] The tree `HEAD` pointed at when this run was armed -- fed to branch (6) at {@link endRun}. */
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

/** CR-01 (iteration 3): push a SYNTHETIC FAILING record so a capture that throws (e.g. `currentSha` on an unreadable repo) rejects at {@link gateCompletion}'s branch (3) instead of vanishing. No-op when no run is armed. */
export function recordCaptureFailure(toolName: string): void {
	const state = runSlot();
	if (state !== undefined) state.records.push({ ts: Date.now(), toolName: `${toolName} (capture failed)`, command: "", isError: true, sha: "" });
}

/** True when a run is currently armed. */
export function isRunArmed(): boolean {
	return runSlot() !== undefined;
}

/** The cwd the armed run was armed against (WR-03), or `undefined` when no run is armed. */
export function armedCwd(): string | undefined {
	return runSlot()?.cwd;
}

/**
 * Compute the verdict for the armed run, write exactly one evidence row,
 * disarm, and return the verdict. Returns `undefined` when no run is armed.
 *
 * `headTree` [Phase 8, GATE-01] feeds branch (6) alongside `state.baseTree`
 * captured at {@link startRun} time -- see `gateCompletion`'s own docstring.
 */
export function endRun(headSha: string, headTree: string): EvidenceVerdict | undefined {
	const state = runSlot();
	if (state === undefined) {
		return undefined;
	}
	const verdict = gateCompletion(state.records, headSha, state.baseSha, headTree, state.baseTree);
	writeEvidenceRow(state.cwd, {
		verdict: verdict.ok ? "accept" : "reject",
		// CR-01 iter4: state what was actually checked, not an endorsement --
		// HEAD moved with no captured failure, NOT that a commit landed or is verified.
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
