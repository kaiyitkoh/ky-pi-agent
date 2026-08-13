/**
 * DIAG-04 — the per-turn row, proven field by field against inline fixtures.
 *
 * WHAT THIS FILE IS FOR. ROADMAP success criterion 3 reads: *"every turn appends
 * a JSONL row carrying model, provider, tokens, cost, latency, cache-read ratio
 * and outcome — and no reasoning-token column for Bedrock, which reports none"*.
 * Two halves of that sentence break silently rather than loudly:
 *
 *   1. A zero under the `reasoning` key on a Bedrock row is a FABRICATED
 *      measurement — Bedrock's `handleMetadata` never assigns the field
 *      [VERIFIED: pi-ai src/api/bedrock-converse-stream.ts:589-602] — and
 *      `expect(row.reasoning).toBeUndefined()` passes just as happily on a row
 *      that carries the key with an `undefined` in it. So the assertions below
 *      go through `Object.keys`, which can tell those two objects apart.
 *   2. A cost assertion written naively is `0 === 0` offline, because
 *      `fauxProvider` hardcodes `usage.cost` to all zeros in `withUsageEstimate`
 *      [VERIFIED: pi-ai src/providers/faux.ts:256-266]. The fixtures below
 *      deliberately carry faux's all-zero `cost` object, so the only way
 *      `row.cost.total` can be positive is the defensive `calculateCost` inside
 *      the composer.
 *
 * INLINE FIXTURES, NO FIXTURE FILE. `.gitignore` blanket-ignores `*.jsonl`
 * (blocker B5), so a committed dump fixture would be untracked, absent from a
 * fresh clone, and this whole file would be skipped or vacuous in CI while
 * passing locally. The analog is `tests/unit/docs-policy.test.ts:273-328`:
 * inline strings for a pure parser, plus a companion case that proves the guard
 * is live rather than assumed.
 *
 * PURE — no session, no network, no filesystem. `composeTurnRow` is a function
 * of its input. The in-session half (do the hooks fire, is the row on disk) is
 * plan 02-08.
 */
import type { Api, Model, Usage } from "@earendil-works/pi-ai";

import { describe, expect, it } from "vitest";

import {
	OUTCOME_BY_STOP_REASON,
	type AssistantMessage,
	type StopReason,
	type TurnRow,
} from "../../.pi/extensions/diagnostics/schema.ts";
import {
	cacheReadRatio,
	composeTurnRow,
	outcomeFor,
	type TurnRowInput,
} from "../../.pi/extensions/diagnostics/turns.ts";
import { SECRET_FIXTURE_TOKEN } from "../helpers/faux.ts";

// ---------------------------------------------------------------------------
// Fixtures — small, explicit, and arithmetic rather than approximate
// ---------------------------------------------------------------------------

/**
 * Cost rates in dollars per million tokens.
 *
 * The same four numbers `tests/helpers/session.ts` gives its faux model, so the
 * unit and integration halves of DIAG-04 price a turn identically. They are
 * chosen to make every product exact in binary-friendly decimals and to make
 * each component distinguishable — equal rates would let a composer that read
 * `output` where it meant `input` pass.
 */
const RATES = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } as const;

/** Token counts used by every case that is not specifically about tokens. */
const TOKENS = { input: 1000, output: 500, cacheRead: 300, cacheWrite: 200, totalTokens: 2000 };

/**
 * Expected cost for {@link TOKENS} at {@link RATES}, stated as arithmetic.
 *
 * input      1    / 1e6 * 1000 = 0.001
 * output     2    / 1e6 *  500 = 0.001
 * cacheRead  0.1  / 1e6 *  300 = 0.00003
 * cacheWrite 1.5  / 1e6 *  200 = 0.0003     (no `cacheWrite1h`, so no 1h split)
 * total                        = 0.00233
 *
 * Written as literals rather than re-derived from `RATES`, so a change to
 * `calculateCost`'s formula fails here instead of being mirrored by the test.
 */
const EXPECTED_COST = { input: 0.001, output: 0.001, cacheRead: 0.00003, cacheWrite: 0.0003, total: 0.00233 };

/**
 * The `cost` object exactly as `fauxProvider` delivers it: all zeros.
 *
 * A fresh object per message, because `calculateCost` mutates whatever it is
 * handed and a shared literal would let one case's recompute leak into the next.
 */
function fauxZeroCost(): Usage["cost"] {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

/** A `Usage` with faux's all-zero `cost`. Overrides are shallow-merged. */
function makeUsage(overrides: Partial<Usage> = {}): Usage {
	return { ...TOKENS, cost: fauxZeroCost(), ...overrides };
}

/** A finalized `AssistantMessage` shaped like the ones `message_end` delivers. */
function makeMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "hello" }],
		api: "openai-completions",
		provider: "deepseek",
		model: "deepseek-chat",
		usage: makeUsage(),
		stopReason: "stop",
		timestamp: 1_700_000_000_000,
		...overrides,
	};
}

/** A `Model` carrying {@link RATES}. Only the fields the composer reads matter. */
function makeModel(): Model<Api> {
	return {
		id: "deepseek-chat",
		name: "deepseek-chat",
		api: "openai-completions",
		provider: "deepseek",
		baseUrl: "https://api.deepseek.com",
		reasoning: true,
		input: ["text"],
		cost: { ...RATES },
		contextWindow: 128_000,
		maxTokens: 8192,
	};
}

/** Compose a row from the default fixtures, with per-case overrides. */
function makeRow(overrides: Partial<TurnRowInput> = {}): TurnRow {
	const input: TurnRowInput = {
		kind: "turn",
		role: "executor",
		sessionId: "session-fixture",
		corr: "session-fixture#1",
		message: makeMessage(),
		model: makeModel(),
		latencyMs: 1234,
		...overrides,
	};
	return composeTurnRow(input);
}

// ---------------------------------------------------------------------------
// 1. The omitted-key rule
// ---------------------------------------------------------------------------

describe("DIAG-04 — the `reasoning` key is absent, not zero, when the provider reports nothing", () => {
	it("omits the key entirely when `usage.reasoning` is undefined", () => {
		const row = makeRow({ message: makeMessage({ usage: makeUsage({ reasoning: undefined }) }) });

		expect(
			Object.keys(row),
			"a zero under this key would report every Bedrock turn's thinking as free — `handleMetadata` " +
				"never assigns `usage.reasoning` (bedrock-converse-stream.ts:589-602), so the row must say " +
				"'no breakdown reported' rather than 'zero tokens'. Asserted on Object.keys because " +
				"toBeUndefined() passes on a key that is present with an undefined value, which is a " +
				"DIFFERENT object that happens to serialise the same",
		).not.toContain("reasoning");
	});

	it("keeps the key, holding a zero, when the provider genuinely reports zero", () => {
		const row = makeRow({ message: makeMessage({ usage: makeUsage({ reasoning: 0 }) }) });

		expect(
			Object.keys(row),
			"a provider that reports a zero breakdown is a different fact from one that reports no " +
				"breakdown; collapsing them loses the ability to say which",
		).toContain("reasoning");
		expect(row.reasoning).toBe(0);
	});

	it("records a real reasoning count", () => {
		const row = makeRow({ message: makeMessage({ usage: makeUsage({ reasoning: 812 }) }) });

		expect(row.reasoning, "the field is copied verbatim, never derived").toBe(812);
	});

	it("omits `cacheWrite1h` on a provider that reports no retention split", () => {
		expect(
			Object.keys(makeRow()),
			"only Anthropic reports the split [VERIFIED: pi-ai 0.84.1 dist/types.d.ts:258-259], so a " +
				"zero here would claim every DeepSeek row had no 1h writes when the provider said " +
				"nothing about them at all",
		).not.toContain("cacheWrite1h");
	});

	it("records `cacheWrite1h`, and its 2x-input price is then derivable from the row", () => {
		// `calculateCost` prices the 1h portion at 2x the INPUT rate, not at the
		// cacheWrite rate [VERIFIED: pi-ai 0.84.1 dist/models.js:538-543]:
		//   longWrite  = cacheWrite1h                       = 50
		//   shortWrite = cacheWrite - cacheWrite1h    = 200 - 50 = 150
		//   cost       = (1.5 * 150 + 1 * 2 * 50) / 1e6 = (225 + 100) / 1e6
		const cacheWrite1h = 50;
		const shortWrite = TOKENS.cacheWrite - cacheWrite1h;
		const expected = (RATES.cacheWrite * shortWrite + RATES.input * 2 * cacheWrite1h) / 1_000_000;

		const row = makeRow({ message: makeMessage({ usage: makeUsage({ cacheWrite1h }) }) });

		expect(
			row.cacheWrite1h,
			"the column has to be ON the row. WITHOUT IT `cost.cacheWrite` is not reproducible from " +
				"any column: a reader multiplying `cacheWrite` by `rates.cacheWrite` gets a different " +
				"number and nothing on the row explains the gap — which is precisely the fabricated " +
				"measurement the omitted-key rule exists to prevent, in the column Phase 8 reconciles " +
				"spend against",
		).toBe(cacheWrite1h);

		expect(
			row.cost.cacheWrite,
			"and the price must really be the 2x-input arithmetic, not `rates.cacheWrite * 200`. If " +
				"this passes for both formulas the fixture's rates are no longer distinguishable",
		).toBeCloseTo(expected, 12);

		expect(
			expected,
			"the paired guard: the two formulas must give DIFFERENT answers, or the assertion above " +
				"is satisfied by either and proves nothing about the split",
		).not.toBeCloseTo((RATES.cacheWrite * TOKENS.cacheWrite) / 1_000_000, 12);
	});

	it("still lacks the key after a JSON round trip, so the on-disk row matches the in-memory one", () => {
		const row = makeRow({ message: makeMessage({ usage: makeUsage({ reasoning: undefined }) }) });
		const roundTripped = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;

		expect(
			Object.keys(roundTripped),
			"the row is written through JSON.stringify, so the guarantee that matters is the one about " +
				"the bytes a later phase reads back",
		).not.toContain("reasoning");
	});
});

// ---------------------------------------------------------------------------
// 2. The outcome map, exhaustively
// ---------------------------------------------------------------------------

describe("DIAG-04 — `outcome` is derived from `stopReason` through the shared map", () => {
	const stopReasons = Object.keys(OUTCOME_BY_STOP_REASON) as StopReason[];

	it("covers exactly the seven members of pi-ai's StopReason union", () => {
		expect(
			stopReasons.length,
			"the map is typed Record<StopReason, Outcome>, so tsc fails when Pi adds a member — this " +
				"assertion is the other half: it fails when a member is added and mapped but left " +
				"unexercised, which is how a new outcome ships untested [threat T-02-06-05]",
		).toBe(7);
	});

	for (const stopReason of stopReasons) {
		it(`maps "${stopReason}" to "${OUTCOME_BY_STOP_REASON[stopReason]}"`, () => {
			const row = makeRow({ message: makeMessage({ stopReason }) });

			expect(row.outcome, "the composer must read the shared map, not a private branch chain").toBe(
				OUTCOME_BY_STOP_REASON[stopReason],
			);
			expect(row.stopReason, "the provider's own word stays on the row beside our interpretation").toBe(
				stopReason,
			);
		});
	}

	it("exposes the same mapping through `outcomeFor`", () => {
		for (const stopReason of stopReasons) {
			expect(outcomeFor(stopReason)).toBe(OUTCOME_BY_STOP_REASON[stopReason]);
		}
	});
});

// ---------------------------------------------------------------------------
// 3. The error row exists — and is redacted
// ---------------------------------------------------------------------------

describe("DIAG-04 — an errored turn still produces a row", () => {
	const errorMessage = `provider rejected the request: Authorization: Bearer ${SECRET_FIXTURE_TOKEN}`;

	it("records the row rather than skipping it", () => {
		const row = makeRow({ message: makeMessage({ stopReason: "error", errorMessage }) });

		expect(
			row.outcome,
			"`after_provider_response` never fires on a 4xx/5xx (openai-completions.ts:239 vs the catch " +
				"at :590), so a row sourced from that hook would be missing exactly the turns worth " +
				"reading. Everything here comes from the finalized message, which exists for every outcome",
		).toBe("error");
		expect(row.stopReason).toBe("error");
		expect(row.latencyMs, "an errored turn still took time, and that time is the finding").toBe(1234);
	});

	it("redacts a credential quoted by the provider's error text", () => {
		const row = makeRow({ message: makeMessage({ stopReason: "error", errorMessage }) });

		expect(
			row.errorMessage,
			"provider error text is provider-supplied and routinely echoes the request; this file lands " +
				"in a working tree that is a public GitHub repository [threat T-02-06-01]",
		).not.toContain(SECRET_FIXTURE_TOKEN);
		expect(row.errorMessage).toContain("[redacted:");
	});

	it("leaves the non-secret part of the error text intact", () => {
		const row = makeRow({ message: makeMessage({ stopReason: "error", errorMessage }) });

		expect(
			row.errorMessage,
			"over-redaction is a failure too, just a quieter one — a row whose errorMessage is entirely " +
				"placeholder tells a reader nothing about why the turn failed",
		).toContain("provider rejected the request");
	});

	it("omits `errorMessage` on a successful turn", () => {
		expect(
			Object.keys(makeRow()),
			"an empty-string errorMessage on every successful row is noise that makes the errored ones " +
				"harder to find",
		).not.toContain("errorMessage");
	});
});

// ---------------------------------------------------------------------------
// 4. Cost is real
// ---------------------------------------------------------------------------

describe("DIAG-04 — cost is recomputed, so it is a number even offline", () => {
	it("produces a strictly positive total from faux's all-zero `usage.cost`", () => {
		const message = makeMessage();
		expect(message.usage.cost.total, "the fixture must start where faux leaves it, or this proves nothing").toBe(0);

		const row = composeTurnRow({
			kind: "turn",
			role: "executor",
			sessionId: "session-fixture",
			corr: "session-fixture#1",
			message,
			model: makeModel(),
			latencyMs: 1234,
		});

		expect(
			row.cost.total,
			"without the defensive calculateCost in turns.ts this assertion is 0 === 0: fauxProvider " +
				"hardcodes usage.cost to zeros (faux.ts:256-266), so every offline cost test would pass " +
				"against a column that is always empty [threat T-02-06-03]",
		).toBeGreaterThan(0);
	});

	it("prices each component at the model's own rates", () => {
		const row = makeRow();

		expect(row.cost.input, "1 $/Mtok x 1000 input tokens").toBeCloseTo(EXPECTED_COST.input, 12);
		expect(row.cost.output, "2 $/Mtok x 500 output tokens").toBeCloseTo(EXPECTED_COST.output, 12);
		expect(row.cost.cacheRead, "0.1 $/Mtok x 300 cache-read tokens").toBeCloseTo(EXPECTED_COST.cacheRead, 12);
		expect(row.cost.cacheWrite, "1.5 $/Mtok x 200 cache-write tokens").toBeCloseTo(EXPECTED_COST.cacheWrite, 12);
		expect(
			row.cost.total,
			"the four components must sum; a total computed from a different set of rates than its parts " +
				"is the failure Phase 8's spend accounting would inherit",
		).toBeCloseTo(EXPECTED_COST.total, 12);
	});

	it("does not mutate the message it was handed", () => {
		const message = makeMessage();
		const row = makeRow({ message });

		expect(
			message.usage.cost.total,
			"calculateCost mutates usage.cost in place, so the composer hands it an isolated copy. An " +
				"instrument that edits the finalized message changes what Pi writes to the session file — " +
				"the row is the record, the message is the observation",
		).toBe(0);
		expect(row.cost.total, "and the row still carries the real figure").toBeCloseTo(EXPECTED_COST.total, 12);
	});
});

// ---------------------------------------------------------------------------
// 5. cacheReadRatio
// ---------------------------------------------------------------------------

describe("DIAG-04 — cache-read ratio", () => {
	it("is cacheRead / (input + cacheRead)", () => {
		const row = makeRow({
			message: makeMessage({ usage: makeUsage({ input: 100, cacheRead: 300 }) }),
		});

		expect(row.cacheReadRatio, "300 / (100 + 300)").toBe(0.75);
	});

	it("omits the key when nothing was read at all", () => {
		const row = makeRow({
			message: makeMessage({ usage: makeUsage({ input: 0, cacheRead: 0 }) }),
		});

		expect(
			Object.keys(row),
			"a zero here would be indistinguishable from a genuinely cold cache, which is a real and " +
				"actionable measurement; 'no input tokens at all' is not a measurement of caching",
		).not.toContain("cacheReadRatio");
	});

	it("returns undefined from the exported helper on a zero denominator", () => {
		expect(cacheReadRatio(makeUsage({ input: 0, cacheRead: 0 }))).toBeUndefined();
		expect(cacheReadRatio(makeUsage({ input: 100, cacheRead: 300 }))).toBe(0.75);
	});

	it("omits the key on a non-finite denominator rather than serialising a null", () => {
		// `Usage` types both counts as `number`, which FORBIDS NaN and forbids a
		// negative — and forces no adapter to honour either. A `denominator !== 0`
		// guard lets NaN through, `NaN !== undefined` so the composer assigns it, and
		// `JSON.stringify` then writes `"cacheReadRatio":null` — which the omitted-key
		// rule and docs/DIAGNOSTICS.md both promise can never happen.
		for (const usage of [
			makeUsage({ input: Number.NaN }),
			makeUsage({ cacheRead: Number.NaN }),
			makeUsage({ input: -100, cacheRead: 100 }),
		]) {
			expect(
				cacheReadRatio(usage),
				"a NaN or negative denominator is not a measurement of caching, so there is no ratio " +
					"to report. `budget.ts` guards with `> 0` and both files claim to print one " +
					"definition of one number",
			).toBeUndefined();
		}

		const row = makeRow({ message: makeMessage({ usage: makeUsage({ input: Number.NaN }) }) });

		expect(
			Object.keys(row),
			"the composer must leave the key OFF, not assign a NaN. Asserted on Object.keys because " +
				"`toBeUndefined()` passes on a key present with a NaN in it once JSON has flattened it",
		).not.toContain("cacheReadRatio");

		expect(
			JSON.stringify(row),
			"and the bytes a later phase reads back must carry no null under this key",
		).not.toContain('"cacheReadRatio":null');
	});
});

// ---------------------------------------------------------------------------
// 6. Optional-field discipline
// ---------------------------------------------------------------------------

describe("DIAG-04 — optional fields are absent rather than empty", () => {
	it("omits `httpStatus` when the caller has none", () => {
		expect(
			Object.keys(makeRow()),
			"the response hook does not fire on error and is not wired for nested calls, so a row with a " +
				"fabricated 200 would claim a success that was never observed",
		).not.toContain("httpStatus");
	});

	it("records `httpStatus` when the caller supplies one", () => {
		expect(makeRow({ httpStatus: 500 }).httpStatus, "so the absence above is a rule, not a broken assignment").toBe(
			500,
		);
	});

	it("omits `rawStopReason` when the provider set none, and the row is still complete", () => {
		const row = makeRow();

		expect(
			Object.keys(row),
			"`fauxAssistantMessage` never sets rawStopReason (RESEARCH §8.5); requiring it would make " +
				"every offline row incomplete",
		).not.toContain("rawStopReason");
		expect(row.stopReason, "the mapped stop reason is still there — nothing was lost with it").toBe("stop");
	});

	it("records `rawStopReason` when the provider sent its own word", () => {
		expect(makeRow({ message: makeMessage({ rawStopReason: "max_tokens" }) }).rawStopReason).toBe("max_tokens");
	});

	it("omits `responseModel` when it merely repeats `model`", () => {
		const row = makeRow({ message: makeMessage({ responseModel: "deepseek-chat" }) });

		expect(
			Object.keys(row),
			"every non-OpenRouter provider echoes the requested id; a duplicated column on every row is " +
				"noise that hides the rows where it differs",
		).not.toContain("responseModel");
	});

	it("records `responseModel` when the provider resolved a different model", () => {
		const row = makeRow({ message: makeMessage({ responseModel: "deepseek-reasoner" }) });

		expect(row.responseModel, "OpenRouter `auto` is the case this exists for (pi-ai types.ts:419)").toBe(
			"deepseek-reasoner",
		);
	});

	it("omits `turnIndex`, `toolResults`, `thinkingLevel` and `event` when unsupplied, and records them when given", () => {
		const bare = Object.keys(makeRow());
		for (const key of ["turnIndex", "toolResults", "thinkingLevel", "event"]) {
			expect(bare, `${key} must be absent rather than undefined-valued`).not.toContain(key);
		}

		const full = makeRow({ turnIndex: 3, toolResults: 2, thinkingLevel: "high", event: "prose_tool_call" });
		expect(full.turnIndex).toBe(3);
		expect(full.toolResults).toBe(2);
		expect(full.thinkingLevel, "the REQUESTED level, recorded because Bedrock makes the cost undecomposable").toBe(
			"high",
		);
		expect(full.event).toBe("prose_tool_call");
	});

	it("counts the tool-call blocks the provider actually emitted", () => {
		const row = makeRow({
			message: makeMessage({
				stopReason: "toolUse",
				content: [
					{ type: "text", text: "I will read the file" },
					{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } },
					{ type: "toolCall", id: "call-2", name: "read", arguments: { path: "b.ts" } },
				],
			}),
		});

		expect(
			row.toolCalls,
			"a prose tool call is TEXT, not a block — that is the whole of DIAG-05 — so this must count " +
				"blocks and never mentions",
		).toBe(2);
		expect(makeRow().toolCalls, "and a text-only turn counts zero rather than omitting the key").toBe(0);
	});
});

// ---------------------------------------------------------------------------
// 7. Required-field completeness
// ---------------------------------------------------------------------------

/**
 * The fields RESEARCH §5.5 marks as always present.
 *
 * Every one of them is named in ROADMAP success criterion 3 or is what makes a
 * row attributable: `corr` ties the row to its `wire-*` records, `sessionId` and
 * `role` say who spent the money, `kind` separates a nested call from a turn.
 */
const REQUIRED_FIELDS = [
	"ts",
	"kind",
	"role",
	"sessionId",
	"corr",
	"provider",
	"model",
	"input",
	"output",
	"cacheRead",
	"cacheWrite",
	"totalTokens",
	"cost",
	"latencyMs",
	"stopReason",
	"outcome",
	"toolCalls",
] as const;

describe("DIAG-04 — every required field is on every row", () => {
	for (const field of REQUIRED_FIELDS) {
		it(`carries \`${field}\` on a successful turn`, () => {
			expect(
				Object.keys(makeRow()),
				"ROADMAP criterion 3 names model, provider, tokens, cost, latency, cache-read ratio and " +
					"outcome; the rest is attribution — a row nobody can tie to a session, a role or a " +
					"wire record is a number without a provenance",
			).toContain(field);
		});
	}

	it("carries them on an errored turn too", () => {
		const keys = Object.keys(makeRow({ message: makeMessage({ stopReason: "error", errorMessage: "boom" }) }));
		for (const field of REQUIRED_FIELDS) {
			expect(keys, `${field} is missing from the error row, which is the row worth having`).toContain(field);
		}
	});

	it("copies provider, model and token counts verbatim", () => {
		const row = makeRow();

		expect(row.provider).toBe("deepseek");
		expect(row.model).toBe("deepseek-chat");
		expect(row.input).toBe(TOKENS.input);
		expect(row.output).toBe(TOKENS.output);
		expect(row.cacheRead).toBe(TOKENS.cacheRead);
		expect(row.cacheWrite).toBe(TOKENS.cacheWrite);
		expect(
			row.totalTokens,
			"totalTokens is the provider's own figure, not input+output — the two disagree whenever " +
				"cache tokens are billed",
		).toBe(TOKENS.totalTokens);
	});

	it("stamps `ts` at composition rather than copying the message timestamp", () => {
		const before = Date.now();
		const row = makeRow();

		expect(
			row.ts,
			"the row's ts is when the measurement was recorded; the message's own timestamp belongs to " +
				"the provider's clock and is not the same event",
		).toBeGreaterThanOrEqual(before);
		expect(row.ts).not.toBe(makeMessage().timestamp);
	});

	it("passes `kind`, `role`, `sessionId` and `corr` through untouched", () => {
		const row = makeRow({ kind: "nested", role: "reviewer", sessionId: "s-9", corr: "s-9#4" });

		expect(row.kind, "a nested callModel row must be distinguishable from a main-loop turn").toBe("nested");
		expect(row.role).toBe("reviewer");
		expect(row.sessionId).toBe("s-9");
		expect(row.corr, "this is the join key between turns-*.jsonl and wire-*.jsonl").toBe("s-9#4");
	});
});
