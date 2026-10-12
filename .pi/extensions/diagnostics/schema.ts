/**
 * Diagnostics row types and the literals every test asserts on; import them, never re-type them.
 * Declares types and constants only. pi-ai's root entrypoint is slated for removal, so only this
 * module, `turns.ts` and `call-model.ts` import it (`calculateCost` is a value, not a type).
 */
import type { StopReason } from "@earendil-works/pi-ai";

/** pi-ai types re-exported so `prose.ts` and `index.ts` need no pi-ai import of their own. */
export type { Api, AssistantMessage, Model, StopReason } from "@earendil-works/pi-ai";

// ---------------------------------------------------------------------------
// Log file naming
// ---------------------------------------------------------------------------

/** Directory segment under Pi's config dir (`CONFIG_DIR_NAME`, never a hardcoded `.pi`). */
export const LOG_DIR_SEGMENT = "logs";

/** Wire stream base name: `wire-YYYY-MM-DD.jsonl` live, `wire-YYYY-MM-DD.<n>.jsonl` rotated (larger n is older). */
export const WIRE_LOG_BASE = "wire";

/** Base name of the turn stream: one row per turn AND per nested call. */
export const TURNS_LOG_BASE = "turns";

// ---------------------------------------------------------------------------
// Rotation and retention
// ---------------------------------------------------------------------------

/** Rotate `wire-*` at 32 MB: ~50 KB per payload is roughly 600 turns. */
export const WIRE_ROTATE_BYTES = 32_000_000;

/** Rotate `turns-*` at 8 MB: ~600 B per row is roughly 14,000 turns. */
export const TURNS_ROTATE_BYTES = 8_000_000;

/** Rotated files kept per stream per day; the oldest is unlinked first by `rotate` in `jsonl.ts`. */
export const MAX_ROTATED_FILES = 10;

/** Days of history kept, pruned at `session_start`. */
export const RETENTION_DAYS = 14;

// ---------------------------------------------------------------------------
// Prose-tool-call detector
// ---------------------------------------------------------------------------

/** Retries after a prose tool call: one, since repeats double cost per false positive and skew the measured prose rate. */
export const MAX_PROSE_RETRIES = 1;

/** `event` value on a turn row where the detector fired. */
export const PROSE_EVENT = "prose_tool_call";

/** `event` value on a turn row where the retry budget was already spent. */
export const PROSE_EXHAUSTED_EVENT = "prose_tool_call_retry_exhausted";

/**
 * Follow-up user message injected on a prose tool call. Lives here because the integration test finds
 * this text in the outgoing context. It names no tool: interpolating model output would feed it back into a prompt.
 */
export const PROSE_RETRY_PROMPT =
	"Your previous message described a tool call in prose instead of emitting one. " +
	"Re-issue it as a real tool call.";

/** `event` value on the row a failed diagnostics handler writes; Pi swallows handler exceptions (`core/extensions/runner.ts`). */
export const DIAGNOSTICS_ERROR_EVENT = "diagnostics.error";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

/** What a turn row's numbers describe: a top-level turn, or a nested `callModel`. */
export type RowKind = "turn" | "nested";

/** Coarse verdict derived from `stopReason`; the raw `stopReason` stays on the row beside it. */
export type Outcome = "ok" | "tool_use" | "length" | "error" | "aborted" | "deferred" | "pending";

/** The `stopReason` to `outcome` mapping; `Record<StopReason, ...>` makes a new Pi member a compile error (pi-ai `dist/types.d.ts` StopReason). */
export const OUTCOME_BY_STOP_REASON: Record<StopReason, Outcome> = {
	stop: "ok",
	toolUse: "tool_use",
	length: "length",
	error: "error",
	aborted: "aborted",
	deferred: "deferred",
	pending: "pending",
};

/** Per-turn cost in dollars, as `calculateCost` computes it (pi-ai models.ts#calculateCost). */
export interface TurnCost {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

/**
 * One row of `turns-*.jsonl`. Written from `message_end` + `turn_end`, never from
 * `after_provider_response`: a 4xx/5xx throws past that hook, so the worst turns would be missing.
 */
export interface TurnRow {
	/** `Date.now()` at row composition. */
	ts: number;
	kind: RowKind;
	/** The executor this turn ran as — session role, or `opts.role` on a nested call. */
	role: string;
	sessionId: string;
	/** Correlation id tying this row to its `wire-*` records. */
	corr: string;
	turnIndex?: number;
	provider: string;
	model: string;
	/** Present when it differs from `model` — OpenRouter `auto` reports the resolved one. */
	responseModel?: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/**
	 * Subset of `cacheWrite` written with 1h retention; key omitted when the provider does not report it.
	 * Needed because `calculateCost` prices the 1h part at 2x the INPUT rate, so without it
	 * `cost.cacheWrite` cannot be reproduced from the row (pi-ai `dist/models.js` calculateCost).
	 * Only Anthropic reports the split (pi 1.1.0 `dist/types.d.ts:296-297` cacheWrite1h).
	 */
	cacheWrite1h?: number;
	totalTokens: number;
	/**
	 * Reasoning tokens, a subset of `output`. Key omitted when the provider reports no breakdown,
	 * never `0` or `null`: absence is not zero billed thinking. Bedrock never assigns it
	 * (`bedrock-converse-stream.ts`), `openai-completions.ts` does.
	 */
	reasoning?: number;
	/**
	 * `cacheRead / (input + cacheRead)`. Omitted unless the denominator is strictly positive;
	 * a `NaN` would serialise to `null`, which the omitted-key rule forbids.
	 */
	cacheReadRatio?: number;
	cost: TurnCost;
	/** `turn_end` wall clock minus `turn_start.timestamp`. */
	latencyMs: number;
	stopReason: StopReason;
	rawStopReason?: string;
	outcome: Outcome;
	/** `message.errorMessage`, passed through the redactor. */
	errorMessage?: string;
	/** Count of `content[].type === "toolCall"` in the assistant message. */
	toolCalls: number;
	toolResults?: number;
	/**
	 * HTTP status as a per-call `onResponse` reported it; ONLY present on a `kind:"nested"` row.
	 * Main-loop rows never get one because `after_provider_response` sits after the retry wrapper
	 * and never fires on a 4xx/5xx (`openai-completions.ts`). On a nested row it can sit beside
	 * `outcome: "error"` (a 200 whose stream then errored); absent if no response was reached.
	 */
	httpStatus?: number;
	/** The REQUESTED thinking level, recorded because Bedrock makes it undecomposable. */
	thinkingLevel?: string;
	/**
	 * The quality layer's own share of this turn's wall clock in ms, not the turn total
	 * ({@link TurnRow.latencyMs}). Omitted when the quality layer did not run. Drained from
	 * `quality-cost.ts#takeQualityCost` once, at `turn_end`.
	 */
	qualityMs?: number;
	/**
	 * The quality layer's summed input+output tokens for this turn; omitted when it did not run.
	 * Its nested calls also emit their own `kind:"nested"` rows, so summing this across turn rows and
	 * `totalTokens` across nested rows measures the same spend; never add the two.
	 */
	qualityTokens?: number;
	/** Set for out-of-band rows: {@link PROSE_EVENT}, {@link DIAGNOSTICS_ERROR_EVENT}, … */
	event?: string;
}

/** Which side of which call a wire record came from. */
export type WireKind =
	| "main.headers"
	| "main.request"
	| "main.response"
	| "nested.headers"
	| "nested.request"
	| "nested.response";

/** Fields every wire record carries regardless of which side it captured. */
interface WireRecordBase {
	ts: number;
	/** Correlation id tying this record to its `turns-*` row. */
	corr: string;
	kind: WireKind;
	role?: string;
	sessionId?: string;
}

/**
 * One row of `wire-*.jsonl`, already redacted. A union so a record with both a request `payload`
 * and a response `status` does not typecheck. The response arm carries `status` and `headers`
 * together because `AfterProviderResponseEvent` is one event with both (Pi `core/extensions/types.ts`);
 * `headers` is optional since Bedrock supplies only `x-amzn-requestid` (`bedrock-converse-stream.ts`).
 */
export type WireRecord =
	| (WireRecordBase & { payload: unknown; headers?: never; status?: never })
	| (WireRecordBase & {
			headers: Record<string, string | null>;
			payload?: never;
			status?: never;
	  })
	| (WireRecordBase & {
			status: number;
			headers?: Record<string, string | null>;
			payload?: never;
	  });
