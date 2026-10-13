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
import { appendJsonl, pruneLogs, writeErrorRow } from "./jsonl.ts";
import { proseToolCallName } from "./prose.ts";
import { takeQualityCost } from "./quality-cost.ts";
import {
	DIAGNOSTICS_ERROR_EVENT,
	MAX_PROSE_RETRIES,
	PROSE_EVENT,
	PROSE_EXHAUSTED_EVENT,
	PROSE_RETRY_PROMPT,
	TURNS_LOG_BASE,
	type Api,
	type AssistantMessage,
	type Model,
} from "./schema.ts";
import { composeTurnRow } from "./turns.ts";
import { currentCorrelationId, registerWireHooks, UNCORRELATED } from "./wire.ts";

export { noteRowWritten, ROWS_WRITTEN_KEY, rowsWrittenThisSession } from "./jsonl.ts";

/** `event` on the row written once per session start. */
export const SESSION_START_EVENT = "diagnostics.session_start";

/** `role` on every main-loop turn row, so per-role cost queries need no special case. */
export const SESSION_TURN_ROLE = "session";

/** `where` on the error row left by a turn with no assistant message: a turn must always leave a row. */
export const TURN_NO_MESSAGE_WHERE = "turn_end.no_message";

/** `event` on a row costed from a degraded model shape; lets spend totals exclude it. */
export const MODEL_UNAVAILABLE_EVENT = "diagnostics.model_unavailable";

/** Prose-tool-call retries spent in the current agent run (per run, not per turn); reset on `agent_start`. */
let proseRetriesThisRun = 0;

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
 * (pi 1.1.0 runner.js:1077-1078).
 */
export function safeHandler<E, R = undefined>(
	where: string,
	fn: (event: E, ctx: ExtensionContext) => R | void | Promise<R | void>,
): (event: E, ctx: ExtensionContext) => Promise<R | undefined> {
	return async (event: E, ctx: ExtensionContext): Promise<R | undefined> => {
		try {
			// `null` becomes `undefined`: a `null` from before_provider_request would replace the request body.
			return ((await fn(event, ctx)) ?? undefined) as R | undefined;
		} catch (err) {
			writeErrorRow(ctx.cwd, where, err);
			return undefined;
		}
	};
}

export default function (pi: ExtensionAPI): void {
	pi.on(
		"session_start",
		safeHandler<SessionStartEvent>("session_start", (_event, ctx) => {
			// Retention runs here, off the hot path.
			const pruned = pruneLogs(ctx.cwd);
			appendJsonl(ctx.cwd, TURNS_LOG_BASE, {
				ts: Date.now(),
				event: SESSION_START_EVENT,
				prunedFiles: pruned.length,
			});
		}),
	);

	// `safeHandler` is passed in because an import back from wire.ts would be a cycle.
	registerWireHooks(pi, safeHandler);

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

			// Read live, never hardcoded: the active-tool list may differ by the time anyone reads the log.
			const tool = proseToolCallName(event.message, pi.getActiveTools());
			if (tool === undefined) {
				return;
			}

			// Verdict sits alongside `stopReason`, never instead of it, so the provider's word stays readable.
			turn.event = PROSE_EVENT;
			// Capped: an uncapped detector against a prose-prone model is unbounded spend.
			const exhausted = proseRetriesThisRun >= MAX_PROSE_RETRIES;

			// Immediate record that survives if `turn_end` throws (core/extensions/runner.ts). No `kind`, so it is not counted as a turn.
			// Contained so a failed write cannot cancel the retry.
			try {
				appendJsonl(ctx.cwd, TURNS_LOG_BASE, {
					ts: Date.now(),
					event: exhausted ? PROSE_EXHAUSTED_EVENT : PROSE_EVENT,
					tool,
					sessionId: ctx.sessionManager.getSessionId(),
					corr: turn.corr,
				});
			} catch (err) {
				writeErrorRow(ctx.cwd, "message_end.prose_row", err);
			}
			if (exhausted) {
				return;
			}

			proseRetriesThisRun += 1;
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
			const corr = turn?.corr ?? captureCorrelationId();
			const message = turn?.message;

			if (message === undefined) {
				// A visible hole, not a skipped append: zero rows looks like a dead instrument.
				appendJsonl(ctx.cwd, TURNS_LOG_BASE, {
					ts: Date.now(),
					event: DIAGNOSTICS_ERROR_EVENT,
					where: TURN_NO_MESSAGE_WHERE,
					sessionId,
					corr,
					turnIndex: event.turnIndex,
					toolResults: event.toolResults.length,
				});
				return;
			}

			// A missing model still writes a row, with zero rates and a marker.
			const model = ctx.model as Model<Api> | undefined;
			// Drained only here: nested `recordTurn` sites must not empty the quality ledger before this row.
			const qualityCost = takeQualityCost();

			appendJsonl(
				ctx.cwd,
				TURNS_LOG_BASE,
				composeTurnRow({
					kind: "turn",
					role: SESSION_TURN_ROLE,
					sessionId,
					corr,
					message,
					model: model ?? degradedModel(message),
					// `turn_start` never ran only for synthetic events; 0 beats a fabricated duration.
					latencyMs: Date.now() - (turn?.startedAt ?? Date.now()),
					turnIndex: event.turnIndex,
					toolResults: event.toolResults.length,
					thinkingLevel: turn?.thinkingLevel,
					qualityMs: qualityCost?.qualityMs,
					qualityTokens: qualityCost?.qualityTokens,
					// The degraded-cost marker wins over the prose verdict, which the `message_end` record keeps.
					event: model === undefined ? MODEL_UNAVAILABLE_EVENT : turn?.event,
				}),
			);
		}),
	);

	// Retry budget is per agent run. Goes through `safeHandler`: a silent failure would leave the counter at its cap forever.
	pi.on(
		"agent_start",
		safeHandler<AgentStartEvent>("agent_start", () => {
			proseRetriesThisRun = 0;
		}),
	);

	registerBudgetCommand(pi);
}
