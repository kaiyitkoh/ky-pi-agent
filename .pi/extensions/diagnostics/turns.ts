/**
 * Per-turn row composition: a finalized `AssistantMessage` plus turn timing in,
 * one `TurnRow` out. (DIAG-04)
 *
 * ---------------------------------------------------------------------------
 * THE SOURCING RULE — every field comes from the finalized message
 * ---------------------------------------------------------------------------
 * Nothing here may be derived from `after_provider_response`. That hook does
 * not fire on a provider error: the adapter's `onResponse` call sits after
 * `await retryProviderRequest(...)` [VERIFIED: pi-ai 0.84.1
 * src/api/openai-completions.ts:239] and a 4xx/5xx throws into the catch at
 * `:590` instead. A row built from that hook would therefore be missing exactly
 * the turns most worth having (RESEARCH §3.2, Pitfall 3). It contributes one
 * OPTIONAL field, `httpStatus`, passed in by the caller and absent whenever the
 * request failed — and absent on every nested call, where the hook is not wired
 * at all.
 *
 * The finalized message, by contrast, exists for every outcome: an errored turn
 * still produces an `AssistantMessage` carrying `stopReason: "error"` and an
 * `errorMessage`, which is why {@link outcomeFor} reads `stopReason` and never
 * an HTTP status.
 *
 * ---------------------------------------------------------------------------
 * THE OMITTED-KEY RULE
 * ---------------------------------------------------------------------------
 * When `message.usage.reasoning` is `undefined` the `reasoning` key is GENUINELY
 * ABSENT from the composed row — not zero, not `null`. Bedrock's
 * `handleMetadata` never assigns it [VERIFIED: pi-ai
 * src/api/bedrock-converse-stream.ts:589-602] while `openai-completions.ts:1404`
 * does, so a zero written under that key would report every Bedrock turn's
 * thinking as free. That is a fabricated measurement, which locked decision 6
 * forbids (Pitfall 4).
 *
 * Absence of the key means THE PROVIDER REPORTS NO BREAKDOWN. It does not mean
 * zero thinking tokens were billed. `docs/DIAGNOSTICS.md` (plan 02-11) must say
 * this in those words, because a reader who assumes the other reading will
 * under-count Bedrock spend in Phase 8.
 *
 * The same rule governs `cacheReadRatio` (a zero there is indistinguishable
 * from a genuinely cold cache), `httpStatus`, `rawStopReason`, `responseModel`,
 * `turnIndex`, `toolResults`, `thinkingLevel` and `event`. Each is assigned only
 * when it has a value, because `JSON.stringify` drops an `undefined` value but
 * `Object.keys` still reports the key — so "present but undefined" and "absent"
 * are two different objects that serialise identically, and only one of them is
 * honest in memory.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE NAMES `@earendil-works/pi-ai`
 * ---------------------------------------------------------------------------
 * `schema.ts`'s import-concentration rule keeps pi-ai's root entrypoint (which
 * has an announced future removal) spelled in as few modules as possible.
 * `calculateCost` is a VALUE, not a type, so it cannot be re-exported through a
 * type-only barrel — and this module cannot do its job without it. It is
 * therefore one of the sanctioned import sites, together with `schema.ts` and
 * `call-model.ts`, and the types it needs for that call (`Api`, `Model`,
 * `Usage`) come through the same statement rather than a second one.
 *
 * PURITY. No filesystem, no hooks, no clock beyond `Date.now()`, and no
 * mutation of the caller's message: the composer is a function of its input, so
 * `tests/unit/turn-row.test.ts` proves it against inline fixtures in
 * milliseconds with no session at all.
 *
 * BOUNDARY RULE (BOOT-10). This module registers nothing. It never registers a
 * tool, and it does not spell that call even in prose —
 * `tests/unit/contributing-boundary.test.ts` matches the name as a plain
 * substring across every tracked source under `.pi/extensions/`.
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

/**
 * Everything a row needs that is not already inside the message.
 *
 * `latencyMs` is the caller's business because it spans two events — `turn_end`
 * wall clock minus `turn_start.timestamp` [RESEARCH §5.5] — and the message
 * knows nothing about either.
 */
export interface TurnRowInput {
	/** `"turn"` for the main loop, `"nested"` for a `callModel` invocation. */
	kind: RowKind;
	/** The executor this ran as — session role, or `opts.role` on a nested call. */
	role: string;
	sessionId: string;
	/** Correlation id tying this row to its `wire-*` records. */
	corr: string;
	/** The FINALIZED assistant message. See the sourcing rule above. */
	message: AssistantMessage;
	/** The model actually invoked; its `cost` rates drive {@link composeTurnRow}'s recompute. */
	model: Model<Api>;
	latencyMs: number;
	turnIndex?: number;
	/**
	 * HTTP status as a per-call `onResponse` reported it.
	 *
	 * Passed only by `callModel`. `index.ts`'s `turn_end` never supplies one, so a
	 * `kind:"turn"` row never carries the key — see `TurnRow.httpStatus` in
	 * `schema.ts` for why that is deliberate rather than an omission.
	 */
	httpStatus?: number;
	/** `turn_end.toolResults.length`. */
	toolResults?: number;
	/** The REQUESTED thinking level, recorded because Bedrock makes the cost undecomposable. */
	thinkingLevel?: string;
	/**
	 * The quality layer's own share of this turn, drained from
	 * `quality-cost.ts#takeQualityCost`. See `TurnRow.qualityMs` in
	 * `schema.ts` for the omission rule and the share-vs-total distinction.
	 */
	qualityMs?: number;
	/** See `TurnRow.qualityTokens` in `schema.ts` for the omission rule and the documented double-count. */
	qualityTokens?: number;
	/** Out-of-band marker: `PROSE_EVENT`, `DIAGNOSTICS_ERROR_EVENT`, … */
	event?: string;
}

/**
 * Map a provider `stopReason` onto this project's coarse {@link Outcome}.
 *
 * A table lookup rather than a hand-written branch chain, deliberately:
 * `OUTCOME_BY_STOP_REASON` is typed `Record<StopReason, Outcome>` against pi-ai's
 * own union, so a new member in a future Pi release is a COMPILE error here
 * rather than an `undefined` sitting in a log file [threat T-02-06-05]. A branch
 * chain with a default arm would have swallowed it silently, and
 * `tests/unit/turn-row.test.ts` asserts against the same table so the two can
 * never disagree.
 */
export function outcomeFor(stopReason: StopReason): Outcome {
	return OUTCOME_BY_STOP_REASON[stopReason];
}

/**
 * `cacheRead / (input + cacheRead)`, or `undefined` when nothing was read.
 *
 * WHY `undefined` AND NOT `0`. A zero would be indistinguishable from a genuine
 * cold cache — a turn that read 0 of 4,000 input tokens from cache is a real,
 * actionable measurement, and a turn that consumed no input tokens at all is
 * not a measurement of anything. Collapsing the two would make the Phase 8 cache
 * story unreadable in exactly the sessions where it matters.
 *
 * THE GUARD IS `> 0`, NOT `!== 0`, AND THAT IS THE WHOLE POINT OF THIS FUNCTION
 * HAVING ONE. `Usage` types both counts as `number`, which forbids `NaN` and
 * forbids a negative without forcing any adapter to honour either. A `!== 0`
 * guard lets a non-finite denominator through, `NaN / NaN` is `NaN`,
 * `NaN !== undefined` so {@link composeTurnRow} ASSIGNS it, and `JSON.stringify`
 * writes `"cacheReadRatio":null` — which the omitted-key rule and
 * `docs/DIAGNOSTICS.md` both promise can never appear. `budget.ts` already
 * guards with `> 0`; the two must agree, because both files claim to print one
 * definition of one number.
 */
export function cacheReadRatio(usage: Usage): number | undefined {
	const denominator = usage.input + usage.cacheRead;
	if (!(denominator > 0)) return undefined;
	return usage.cacheRead / denominator;
}

/**
 * Recompute cost from the model's rates into a FRESH {@link TurnCost}.
 *
 * `calculateCost` is called defensively on every row. Real adapters already
 * called it — Bedrock's `handleMetadata` does
 * [VERIFIED: pi-ai src/api/bedrock-converse-stream.ts:589-602] — and it
 * recomputes from the same rates, so it is idempotent
 * [VERIFIED: pi-ai src/models.ts:878-898]. But `fauxProvider` hardcodes
 * `usage.cost` to all zeros in `withUsageEstimate`
 * [VERIFIED: pi-ai src/providers/faux.ts:256-266], so WITHOUT this call every
 * offline cost assertion in this repo is `0 === 0` — a green test proving the
 * column exists and nothing about whether it is right [threat T-02-06-03].
 *
 * It is handed a shallow COPY of the usage rather than the message's own object.
 * `calculateCost` mutates `usage.cost` in place, and an instrument that edits
 * the finalized message it is measuring changes what Pi later writes to the
 * session file. The recomputed numbers are identical either way in production;
 * offline, the copy is what keeps the faux message honestly all-zero while the
 * ROW carries the real figure.
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

/**
 * Compose one `turns-*.jsonl` row. Pure; field provenance is RESEARCH §5.5.
 *
 * Every optional field is ASSIGNED rather than declared, so an absent value
 * leaves the key off the object entirely. See the omitted-key rule in the module
 * docstring for why that distinction is load-bearing rather than stylistic.
 */
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
		// Prose tool calls are text, not blocks — that is the whole of DIAG-05 —
		// so this counts only the calls the provider really emitted.
		toolCalls: message.content.filter((block) => block.type === "toolCall").length,
	};

	// `responseModel` is recorded only when it says something `model` does not.
	// OpenRouter `auto` resolves to a different id [pi-ai types.ts:419]; every
	// other provider echoes the requested one, and a duplicated column would be
	// noise on every row of every other provider.
	if (message.responseModel !== undefined && message.responseModel !== message.model) {
		row.responseModel = message.responseModel;
	}

	// `rawStopReason` is the provider's own untranslated word. `fauxAssistantMessage`
	// never sets it [RESEARCH §8.5], so requiring it would make every offline row
	// incomplete and every offline completeness assertion a lie.
	if (message.rawStopReason !== undefined) {
		row.rawStopReason = message.rawStopReason;
	}

	// THE OMITTED-KEY RULE, at the one line that implements it. A provider that
	// genuinely reports zero reasoning tokens gets the key with a zero in it; a
	// provider that reports no breakdown at all gets no key. Those are different
	// facts and the row must be able to say both.
	if (usage.reasoning !== undefined) {
		row.reasoning = usage.reasoning;
	}

	// THE SAME RULE, FOR THE COLUMN THAT MAKES `cost.cacheWrite` CHECKABLE.
	// `calculateCost` prices a 1h cache write at 2x the INPUT rate rather than at
	// the cacheWrite rate [VERIFIED: pi-ai 0.84.1 dist/models.js:538-543], and only
	// Anthropic reports the split [VERIFIED: pi-ai dist/types.d.ts:258-259]. Copy
	// it or Phase 8's reconciliation finds a cost it cannot derive from any column
	// on the row, with nothing there explaining why.
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

	// SUPPLIED BY THE NESTED PATH AND BY NOTHING ELSE. `index.ts`'s `turn_end` never
	// passes one, so a `kind:"turn"` row never carries this key at all; `callModel`
	// always supplies an `onResponse`, so a `kind:"nested"` row carries it whenever a
	// response was seen — errored rows included. See the sourcing rule: this is the
	// ONLY field a response callback is allowed to contribute.
	if (input.httpStatus !== undefined) {
		row.httpStatus = input.httpStatus;
	}

	if (input.toolResults !== undefined) {
		row.toolResults = input.toolResults;
	}

	if (input.thinkingLevel !== undefined) {
		row.thinkingLevel = input.thinkingLevel;
	}

	// THE OMISSION RULE, FOR THE QUALITY LEDGER. `takeQualityCost()` returns
	// `undefined` on an untouched slot, so `index.ts`'s `turn_end` handler
	// simply does not pass these keys at all on a turn the quality layer never
	// ran on — this guard is what stops that absence turning into a
	// fabricated zero if a future caller ever does pass one explicitly.
	if (input.qualityMs !== undefined) {
		row.qualityMs = input.qualityMs;
	}

	if (input.qualityTokens !== undefined) {
		row.qualityTokens = input.qualityTokens;
	}

	if (input.event !== undefined) {
		row.event = input.event;
	}

	// Provider error text is provider-supplied and may echo request content, so it
	// goes through the redactor before it can reach a file [threat T-02-06-01].
	if (message.errorMessage !== undefined) {
		row.errorMessage = redactString(message.errorMessage);
	}

	// `message.diagnostics` is NOT copied. Its docstring calls it "Redacted
	// provider/runtime diagnostics", but `pi-ai/src/utils/diagnostics.ts` contains
	// no redaction logic whatsoever [VERIFIED: RESEARCH §3.3] — the word describes
	// intent, not behaviour. If a later plan decides the row needs them, every
	// string inside must go through the redactor first, exactly like
	// `errorMessage` above. Recording them verbatim would put an unredacted
	// provider stack trace in a public working tree.

	return row;
}
