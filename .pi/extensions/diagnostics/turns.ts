/**
 * Per-turn row composition: a finalized `AssistantMessage` plus timing in, one `TurnRow` out.
 *
 * Every field comes from the finalized message, never `after_provider_response`, which does not fire on a
 * provider error (`openai-completions.ts:239`); only the optional caller-supplied `httpStatus` is an exception.
 * Omitted-key rule: an optional field is assigned only when it has a value. Absent `reasoning` means the
 * provider reports no breakdown (not zero billed); "present but undefined" and "absent" differ in memory.
 * Imports `calculateCost` (a value) from pi-ai, one of three sanctioned import sites with `schema.ts` and
 * `call-model.ts`. Pure; registers nothing.
 */
import type { Api, Model, Usage } from "@earendil-works/pi-ai";
import { calculateCost } from "@earendil-works/pi-ai";

import { redactString } from "./redact.ts";
import {
	OUTCOME_BY_STOP_REASON,
	type AssistantMessage,
	type Outcome,
	type RowKind,
	type StopReason,
	type TurnCost,
	type TurnRow,
} from "./schema.ts";

/** Everything a row needs that is not already inside the message. */
export interface TurnRowInput {
	/** `"turn"` for the main loop, `"nested"` for a `callModel` invocation. */
	kind: RowKind;
	/** The executor this ran as — session role, or `opts.role` on a nested call. */
	role: string;
	sessionId: string;
	/** Correlation id tying this row to its `wire-*` records. */
	corr: string;
	/** The FINALIZED assistant message. */
	message: AssistantMessage;
	/** The model actually invoked; its `cost` rates drive {@link composeTurnRow}'s recompute. */
	model: Model<Api>;
	latencyMs: number;
	turnIndex?: number;
	/** HTTP status from a per-call `onResponse`; passed only by `callModel`, so `kind:"turn"` rows never carry it. */
	httpStatus?: number;
	/** `turn_end.toolResults.length`. */
	toolResults?: number;
	/** The REQUESTED thinking level, recorded because Bedrock makes the cost undecomposable. */
	thinkingLevel?: string;
	/** The quality layer's own share of this turn, drained from `quality-cost.ts#takeQualityCost`. */
	qualityMs?: number;
	/** Quality-layer tokens; double-counts its nested rows by design (see `TurnRow.qualityTokens`). */
	qualityTokens?: number;
	/** Out-of-band marker: `PROSE_EVENT`, `DIAGNOSTICS_ERROR_EVENT`, … */
	event?: string;
}

/** Map a provider `stopReason` onto {@link Outcome}; the typed table makes a new Pi member a compile error. */
export function outcomeFor(stopReason: StopReason): Outcome {
	return OUTCOME_BY_STOP_REASON[stopReason];
}

/**
 * `cacheRead / (input + cacheRead)`, or `undefined` when nothing was read. The guard is `> 0`, not `!== 0`:
 * a `NaN` denominator would serialise as `null`. `budget.ts` guards the same way and the two must agree.
 */
export function cacheReadRatio(usage: Usage): number | undefined {
	const denominator = usage.input + usage.cacheRead;
	if (!(denominator > 0)) return undefined;
	return usage.cacheRead / denominator;
}

/**
 * Recompute cost from the model's rates into a FRESH {@link TurnCost}. `fauxProvider` zeroes `usage.cost`
 * (`faux.ts:256-266`), so offline cost assertions would be `0 === 0` otherwise. `calculateCost` mutates
 * `usage.cost`, so it gets a copy rather than the finalized message's own object.
 */
function costFor(model: Model<Api>, usage: Usage): TurnCost {
	const isolated: Usage = { ...usage, cost: { ...usage.cost } };
	const cost = calculateCost(model, isolated);
	return {
		input: cost.input,
		output: cost.output,
		cacheRead: cost.cacheRead,
		cacheWrite: cost.cacheWrite,
		total: cost.total,
	};
}

/** Compose one `turns-*.jsonl` row. Pure. */
export function composeTurnRow(input: TurnRowInput): TurnRow {
	const { message, model } = input;
	const usage = message.usage;

	const row: TurnRow = {
		ts: Date.now(),
		kind: input.kind,
		role: input.role,
		sessionId: input.sessionId,
		corr: input.corr,
		provider: message.provider,
		model: message.model,
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
		totalTokens: usage.totalTokens,
		cost: costFor(model, usage),
		latencyMs: input.latencyMs,
		stopReason: message.stopReason,
		outcome: outcomeFor(message.stopReason),
		// Prose tool calls are text, not blocks, so this counts only real calls.
		toolCalls: message.content.filter((block) => block.type === "toolCall").length,
	};

	// Only when it differs from `model` (OpenRouter `auto` resolves elsewhere, `types.ts:419`).
	if (message.responseModel !== undefined && message.responseModel !== message.model) {
		row.responseModel = message.responseModel;
	}

	// `fauxAssistantMessage` never sets it, so it must not be required.
	if (message.rawStopReason !== undefined) {
		row.rawStopReason = message.rawStopReason;
	}

	// A provider reporting zero gets the key; one reporting no breakdown gets none.
	if (usage.reasoning !== undefined) {
		row.reasoning = usage.reasoning;
	}

	// `calculateCost` prices 1h cache writes at 2x the INPUT rate (`dist/models.js:538-543`); only Anthropic reports the split.
	if (usage.cacheWrite1h !== undefined) {
		row.cacheWrite1h = usage.cacheWrite1h;
	}

	const ratio = cacheReadRatio(usage);
	if (ratio !== undefined) {
		row.cacheReadRatio = ratio;
	}

	if (input.turnIndex !== undefined) {
		row.turnIndex = input.turnIndex;
	}

	// Supplied only by the nested path; the one field a response callback may contribute.
	if (input.httpStatus !== undefined) {
		row.httpStatus = input.httpStatus;
	}

	if (input.toolResults !== undefined) {
		row.toolResults = input.toolResults;
	}

	if (input.thinkingLevel !== undefined) {
		row.thinkingLevel = input.thinkingLevel;
	}

	// Guards against turning an absent quality ledger into a fabricated zero.
	if (input.qualityMs !== undefined) {
		row.qualityMs = input.qualityMs;
	}

	if (input.qualityTokens !== undefined) {
		row.qualityTokens = input.qualityTokens;
	}

	if (input.event !== undefined) {
		row.event = input.event;
	}

	// Provider error text may echo request content, so it is redacted first.
	if (message.errorMessage !== undefined) {
		row.errorMessage = redactString(message.errorMessage);
	}

	// `message.diagnostics` is NOT copied: pi-ai performs no redaction on it, so it would need `redactString` first.

	return row;
}
