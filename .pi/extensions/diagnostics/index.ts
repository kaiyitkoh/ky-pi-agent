/**
 * Diagnostics entry point: event hooks plus the `/budget` command, never a tool
 * (a tool's schema is sent on every provider request). Rationale: docs/DIAGNOSTICS.md.
 */
import type {
	AgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
	MessageEndEvent,
	SessionStartEvent,
	TurnEndEvent,
	TurnStartEvent,
} from "@earendil-works/pi-coding-agent";

import { registerBudgetCommand } from "./budget.ts";
import { appendJsonl, pruneLogs } from "./jsonl.ts";
import { isProseToolCall, proseToolCallName } from "./prose.ts";
import { takeQualityCost } from "./quality-cost.ts";
import { redactString } from "./redact.ts";
import {
	DIAGNOSTICS_ERROR_EVENT,
	MAX_PROSE_RETRIES,
	MAX_ROTATED_FILES,
	PROSE_EVENT,
	PROSE_EXHAUSTED_EVENT,
	PROSE_RETRY_PROMPT,
	TURNS_LOG_BASE,
	TURNS_ROTATE_BYTES,
	type Api,
	type AssistantMessage,
	type Model,
	type TurnRow,
} from "./schema.ts";
import { composeTurnRow } from "./turns.ts";
import { currentCorrelationId, registerWireHooks, UNCORRELATED } from "./wire.ts";

/** `event` on the row written once per session start. */
export const SESSION_START_EVENT = "diagnostics.session_start";

/** `role` on every main-loop turn row, so per-role cost queries need no special case. */
export const SESSION_TURN_ROLE = "session";

/** `where` on the error row left by a turn with no assistant message: a turn must always leave a row. */
export const TURN_NO_MESSAGE_WHERE = "turn_end.no_message";

/** `event` on a row costed from a degraded model shape; lets spend totals exclude it. */
export const MODEL_UNAVAILABLE_EVENT = "diagnostics.model_unavailable";

/**
 * Whether the prose retry forces `tool_choice: "required"`. Must stay `false` until the
 * effect on DeepSeek is measured; no handler is registered while it is off.
 */
export const PROSE_RETRY_FORCES_TOOL_CHOICE = false;

/**
 * Process-wide slot for the rows-written counter: jiti can load this module twice, so a
 * module-level `let` would undercount (same reason as `wire.ts` COUNTER_KEY).
 */
export const ROWS_WRITTEN_KEY = "__kypiDiagnosticsRowsWritten";

/** Prose-tool-call retries spent in the current agent run (per run, not per turn); reset on `agent_start`. */
let proseRetriesThisRun = 0;

/** Rows written by this process, so `/budget` can show "0 rows" instead of leaving it to inference. */
export function rowsWrittenThisSession(): number {
	const value = (globalThis as Record<string, unknown>)[ROWS_WRITTEN_KEY];
	return typeof value === "number" ? value : 0;
}

/** Record that one row reached disk; every append path must call this. */
export function noteRowWritten(): void {
	(globalThis as Record<string, unknown>)[ROWS_WRITTEN_KEY] = rowsWrittenThisSession() + 1;
}

/** Append one row to the turns stream and count it. */
function writeTurnsRow(cwd: string, record: TurnRow | Record<string, unknown>): void {
	appendJsonl(cwd, TURNS_LOG_BASE, record, {
		rotateBytes: TURNS_ROTATE_BYTES,
		maxRotated: MAX_ROTATED_FILES,
	});
	noteRowWritten();
}

/** State accumulated between `turn_start` and `turn_end`; one record, because the loop is serial. */
interface TurnAccumulator {
	/** `turn_start.timestamp` (dist/core/agent-session.js). */
	startedAt: number;
	corr?: string;
	message?: AssistantMessage;
	thinkingLevel?: string;
	/** Verdict stamped on this turn's row (only {@link PROSE_EVENT}); a second row would double per-turn totals. */
	event?: string;
}

let inFlight: TurnAccumulator | undefined;

/** Read at `message_end`, not `turn_end`: tools may make nested calls in between that issue their own id. */
function captureCorrelationId(): string {
	return currentCorrelationId() ?? UNCORRELATED;
}

/** Stand-in for an absent `ctx.model`; zero rates, so rows carry {@link MODEL_UNAVAILABLE_EVENT}. */
function degradedModel(message: AssistantMessage): Model<Api> {
	return {
		id: message.model,
		name: message.model,
		api: message.api,
		provider: message.provider,
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 0,
		maxTokens: 0,
	};
}

/**
 * Wrap a handler so a throw leaves an error row instead of vanishing. Never rethrows and
 * returns `undefined` on failure: several Pi hooks treat any other return as a replacement
 * (pi 1.1.0 runner.js:1077-1078). The error text is redacted before logging.
 */
export function safeHandler<E, R = undefined>(
	where: string,
	fn: (event: E, ctx: ExtensionContext) => R | void | Promise<R | void>,
): (event: E, ctx: ExtensionContext) => Promise<R | undefined> {
	return async (event: E, ctx: ExtensionContext): Promise<R | undefined> => {
		try {
			const result = await fn(event, ctx);
			// `null` becomes `undefined`: a `null` from before_provider_request would replace the request body
						// (dist/core/extensions/runner.js).
			return (result ?? undefined) as R | undefined;
		} catch (err) {
			try {
				writeTurnsRow(ctx.cwd, {
					ts: Date.now(),
					event: DIAGNOSTICS_ERROR_EVENT,
					where,
					error: redactString(String(err)),
				});
			} catch {
				// The instrument cannot instrument its own inability to write.
			}
			return undefined;
		}
	};
}

export default function (pi: ExtensionAPI): void {
	// Retention runs at session start, off the hot path.
	pi.on(
		"session_start",
		safeHandler<SessionStartEvent>("session_start", (_event, ctx) => {
			const pruned = pruneLogs(ctx.cwd);
			writeTurnsRow(ctx.cwd, {
				ts: Date.now(),
				event: SESSION_START_EVENT,
				prunedFiles: pruned.length,
			});
		}),
	);

	// `safeHandler` and `noteRowWritten` are passed in because an import back from wire.ts would be a cycle.
	registerWireHooks(pi, safeHandler, noteRowWritten);

	// Turn rows come from these hooks, never from `after_provider_response` (it does not fire on errors).

	pi.on(
		"turn_start",
		safeHandler<TurnStartEvent>("turn_start", (event, ctx) => {
			// Fresh record: clears any stale message from a turn that never ended.
			inFlight = {
				// Fallback is for synthetic events in unit tests.
				startedAt: typeof event.timestamp === "number" ? event.timestamp : Date.now(),
				// Requested level, recorded now because Bedrock reports no reasoning breakdown.
				thinkingLevel: ctx.thinkingLevel,
			};
		}),
	);

	pi.on(
		"message_end",
		safeHandler<MessageEndEvent>("message_end", (event, ctx) => {
			// `message_end` also fires for user and toolResult messages (core/extensions/types.d.ts MessageEndEvent).
			if (event.message.role !== "assistant") {
				return;
			}

			const turn = inFlight ?? { startedAt: Date.now(), thinkingLevel: ctx.thinkingLevel };
			turn.message = event.message;
			turn.corr = captureCorrelationId();
			inFlight = turn;

			// The active-tool list is live, never hardcoded: `isProseToolCall` refuses an empty list.
			const activeTools = pi.getActiveTools();
			if (!isProseToolCall(event.message, activeTools)) {
				return;
			}

			// Verdict sits alongside `stopReason`, never instead of it, so the provider's word stays readable.
			turn.event = PROSE_EVENT;

			const sessionId = ctx.sessionManager.getSessionId();
			// Read now: the active-tool list may differ by the time anyone reads the log.
			const tool = proseToolCallName(event.message, activeTools);

			if (proseRetriesThisRun >= MAX_PROSE_RETRIES) {
				// Capped: an uncapped detector against a prose-prone model is unbounded spend.
				writeTurnsRow(ctx.cwd, {
					ts: Date.now(),
					event: PROSE_EXHAUSTED_EVENT,
					tool,
					sessionId,
					corr: turn.corr,
				});
				return;
			}

			proseRetriesThisRun += 1;

			// Immediate record that survives if `turn_end` throws (core/extensions/runner.ts). No `kind`, so it is not counted as a turn.
			writeTurnsRow(ctx.cwd, {
				ts: Date.now(),
				event: PROSE_EVENT,
				tool,
				sessionId,
				corr: turn.corr,
			});

			// `deliverAs` is mandatory: `prompt` throws mid-stream (core/agent-session.ts#prompt).
						// `followUp` resumes the same run (pi-agent-core agent-loop.ts).
			pi.sendUserMessage(PROSE_RETRY_PROMPT, { deliverAs: "followUp" });

			// Returns nothing by contract: a returned `{ message }` replaces the finalized message
						// (core/extensions/types.ts), which is how scraped prose would become an executed call.
		}),
	);

	pi.on(
		"turn_end",
		safeHandler<TurnEndEvent>("turn_end", (event, ctx) => {
			// Taken and cleared first so an exception cannot contaminate the next turn.
			const turn = inFlight;
			inFlight = undefined;

			const sessionId = ctx.sessionManager.getSessionId();
			const message = turn?.message;

			if (message === undefined) {
				// A visible hole, not a skipped append: zero rows looks like a dead instrument.
				writeTurnsRow(ctx.cwd, {
					ts: Date.now(),
					event: DIAGNOSTICS_ERROR_EVENT,
					where: TURN_NO_MESSAGE_WHERE,
					sessionId,
					corr: turn?.corr ?? captureCorrelationId(),
					turnIndex: event.turnIndex,
					toolResults: event.toolResults.length,
				});
			} else {
				// A missing model still writes a row, with zero rates and a marker.
				const model = ctx.model as Model<Api> | undefined;

				// Drained only here: nested `recordTurn` sites must not empty the quality ledger before this row.
				const qualityCost = takeQualityCost();

				writeTurnsRow(
					ctx.cwd,
					composeTurnRow({
						kind: "turn",
						role: SESSION_TURN_ROLE,
						sessionId,
						corr: turn?.corr ?? captureCorrelationId(),
						message,
						model: model ?? degradedModel(message),
						// Falls back to now only if `turn_start` never ran, giving 0 rather than a fabricated duration.
						latencyMs: Date.now() - (turn?.startedAt ?? Date.now()),
						turnIndex: event.turnIndex,
						toolResults: event.toolResults.length,
						thinkingLevel: turn?.thinkingLevel,
						qualityMs: qualityCost?.qualityMs,
						qualityTokens: qualityCost?.qualityTokens,
						// The degraded-cost marker wins over the prose verdict: losing it would hide a fabricated zero cost.
												// The prose verdict is still recorded by the standalone `message_end` record.
						event: model === undefined ? MODEL_UNAVAILABLE_EVENT : turn?.event,
					}),
				);
			}
			// No `return` in these handlers; wire-nonmutating.test.ts asserts it.
		}),
	);

	// Retry budget is per agent run, so it resets here. Goes through `safeHandler`: a silent
		// failure would leave the counter at its cap forever.
	pi.on(
		"agent_start",
		safeHandler<AgentStartEvent>("agent_start", () => {
			proseRetriesThisRun = 0;
		}),
	);

	// `/budget` is the only non-hook registration. Counters are passed in to avoid an import cycle.
	registerBudgetCommand(pi, rowsWrittenThisSession, noteRowWritten);
}
