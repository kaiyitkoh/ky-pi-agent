/**
 * DIAG-04 — the two branches of `turn_end` whose failure is INVISIBLE.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE TWO, AND WHY THEY HAD NO TEST
 * ---------------------------------------------------------------------------
 * `TURN_NO_MESSAGE_WHERE` and `MODEL_UNAVAILABLE_EVENT` are both exported under
 * this repository's house rule — "exported so a test imports it rather than
 * re-typing the literal" — and no test imported either. Nothing constructed a
 * turn with no assistant message, and nothing constructed a session whose
 * `ctx.model` is `undefined`, so both paths and the `degradedModel` shape shipped
 * unexecuted.
 *
 * They are exactly the branches whose failure produces no error anywhere:
 *
 *   - [threat T-02-08-02] a turn that leaves NO ROW is indistinguishable from a
 *     quiet session. The handler writes a `diagnostics.error` row instead of
 *     skipping the append precisely so the hole is visible, and nothing checked
 *     that it does.
 *   - [threat T-02-08-05] `ctx.model` is `Model<any> | undefined`
 *     [VERIFIED: pi 0.84.1 dist/core/extensions/types.d.ts:223]. With no
 *     catalogue entry there are no rates, so the row's cost is all zeros — and a
 *     zero cost that looks exactly like a computed one is a FABRICATED
 *     measurement. `MODEL_UNAVAILABLE_EVENT` is what lets Phase 8 exclude the row
 *     from a spend total rather than quietly under-count it, and nothing checked
 *     that the marker is actually stamped.
 *
 * ---------------------------------------------------------------------------
 * NO SESSION IS NEEDED, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 * Same recording stub `wire-nonmutating.test.ts` uses: `ExtensionAPI` and
 * `ExtensionContext` are plain interfaces, so `diagnostics(pi)` registers the REAL
 * handlers and this file invokes them directly. A live session cannot reach either
 * branch — Pi always has a model and always produces a message — which is why the
 * unit route is the only one available and why "untested defensive code is a
 * comment" applies here more than anywhere else in the subsystem.
 *
 * ---------------------------------------------------------------------------
 * THE REQUIRED-FIELD LIST IS DERIVED, NOT TRANSCRIBED
 * ---------------------------------------------------------------------------
 * "Honestly degraded" means the degraded row is still a complete row. Rather than
 * copy `turns-log.test.ts`'s `REQUIRED_TURN_FIELDS` — a duplicated literal list
 * is how an assertion silently stops matching the thing it checks — this file
 * drives a HEALTHY turn through the same handlers in the same session and requires
 * the degraded row to carry every key the healthy one carries. The list maintains
 * itself.
 */
import { existsSync } from "node:fs";

import type { Api, AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { beforeAll, describe, expect, it } from "vitest";

import diagnostics, {
	MODEL_UNAVAILABLE_EVENT,
	SESSION_TURN_ROLE,
	TURN_NO_MESSAGE_WHERE,
} from "../../.pi/extensions/diagnostics/index.ts";
import { logPath } from "../../.pi/extensions/diagnostics/jsonl.ts";
import {
	DIAGNOSTICS_ERROR_EVENT,
	TURNS_LOG_BASE,
} from "../../.pi/extensions/diagnostics/schema.ts";
import { readJsonl, withTempLogCwd } from "../helpers/logs.ts";

/** A handler as Pi stores it. */
type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

/** Cost rates matching `tests/helpers/session.ts`, so the HEALTHY row costs money. */
const RATES = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } as const;

const SESSION_ID = "sess-turn-hooks";

/** A `Usage` carrying faux's all-zero `cost`, which the composer recomputes. */
function makeUsage(): Usage {
	return {
		input: 1000,
		output: 500,
		cacheRead: 300,
		cacheWrite: 200,
		totalTokens: 2000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

/** The finalized assistant message `message_end` delivers. */
function makeMessage(): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "an ordinary answer" }],
		api: "openai-completions",
		provider: "deepseek",
		model: "deepseek-chat",
		usage: makeUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

/** A real catalogue entry, for the healthy control. */
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

/**
 * A context carrying only what the turn handlers read.
 *
 * `model` is passed explicitly, `undefined` included, because that absence is the
 * whole subject of the second case.
 */
function fakeCtx(cwd: string, model: Model<Api> | undefined): ExtensionContext {
	return {
		cwd,
		thinkingLevel: "high",
		model,
		sessionManager: { getSessionId: () => SESSION_ID },
	} as unknown as ExtensionContext;
}

/** The row shape this file asserts on. */
interface Row {
	kind?: string;
	role?: string;
	event?: string;
	where?: string;
	sessionId?: string;
	corr?: string;
	provider?: string;
	model?: string;
	turnIndex?: number;
	toolResults?: number;
	cost?: { total?: number; input?: number };
}

let healthy: Row | undefined;
let degraded: Row | undefined;
let noMessage: Row | undefined;
let rowCount = 0;

describe("DIAG-04 — turn_end's two invisible branches", () => {
	beforeAll(async () => {
		await withTempLogCwd(async (cwd) => {
			const handlers = new Map<string, Handler>();
			const pi = {
				on(event: string, handler: Handler) {
					handlers.set(event, handler);
				},
				registerCommand() {
					/* /budget is registered and never invoked here. */
				},
				// EMPTY ON PURPOSE. `isProseToolCall` refuses an empty active-tool list
				// by design (gate 3), so `message_end` records the message and takes
				// none of the prose branch — which belongs to prose-retry.test.ts and
				// would otherwise put extra rows in this file's log.
				getActiveTools: () => [],
				getAllTools: () => [],
				sendUserMessage() {
					throw new Error("the prose retry must not fire in this fixture");
				},
			} as unknown as ExtensionAPI;

			diagnostics(pi);

			const turnStart = handlers.get("turn_start");
			const messageEnd = handlers.get("message_end");
			const turnEnd = handlers.get("turn_end");
			expect(
				[turnStart, messageEnd, turnEnd].every((h) => h !== undefined),
				"one of the three turn hooks was not registered, so every assertion below would be " +
					"about a handler that was never called",
			).toBe(true);

			// The accumulator is module state and the agent loop is serial, so the three
			// sequences run in order inside ONE log and are told apart by position.
			// `turn_end` takes and clears the accumulator first, so sequence 3's
			// `turn_start` genuinely starts from nothing.

			// 1 — HEALTHY: a real catalogue entry. The control.
			await turnStart?.({ type: "turn_start", timestamp: Date.now() }, fakeCtx(cwd, makeModel()));
			await messageEnd?.({ type: "message_end", message: makeMessage() }, fakeCtx(cwd, makeModel()));
			await turnEnd?.(
				{ type: "turn_end", turnIndex: 0, toolResults: [] },
				fakeCtx(cwd, makeModel()),
			);

			// 2 — DEGRADED: `ctx.model` is undefined at turn_end.
			await turnStart?.({ type: "turn_start", timestamp: Date.now() }, fakeCtx(cwd, undefined));
			await messageEnd?.({ type: "message_end", message: makeMessage() }, fakeCtx(cwd, undefined));
			await turnEnd?.(
				{ type: "turn_end", turnIndex: 1, toolResults: [{}] },
				fakeCtx(cwd, undefined),
			);

			// 3 — NO MESSAGE: a turn that ended without an assistant message.
			await turnStart?.({ type: "turn_start", timestamp: Date.now() }, fakeCtx(cwd, makeModel()));
			await turnEnd?.(
				{ type: "turn_end", turnIndex: 2, toolResults: [{}, {}] },
				fakeCtx(cwd, makeModel()),
			);

			const file = logPath(cwd, TURNS_LOG_BASE);
			const rows = existsSync(file) ? (readJsonl(file) as Row[]) : [];
			rowCount = rows.length;
			[healthy, degraded, noMessage] = rows;
		});
	});

	it("wrote exactly one row per turn, including the two that had nothing to report", () => {
		expect(
			rowCount,
			"three turns must leave three rows. Fewer means a branch SKIPPED its append, which is the " +
				"failure that makes a broken instrument look like a quiet session; more means the prose " +
				"branch fired and this fixture is measuring something else",
		).toBe(3);
	});

	it("the healthy control really is healthy, so the degraded row below means something", () => {
		expect(
			healthy?.event,
			"a row composed against a real catalogue entry must carry NO `event` at all. If the marker " +
				"were stamped unconditionally the degraded assertion below would pass for every row and " +
				"Phase 8 would exclude every turn from its spend total",
		).toBeUndefined();

		expect(
			healthy?.cost?.total,
			"and it must cost real money, from the model's own rates. A zero here would make the " +
				"degraded row's zero indistinguishable and this whole file vacuous",
		).toBeGreaterThan(0);

		expect(healthy?.kind, "it is a main-loop turn").toBe("turn");
		expect(healthy?.role, "carrying the constant session role").toBe(SESSION_TURN_ROLE);
	});

	it("marks a row whose cost was computed from a DEGRADED model shape", () => {
		expect(
			degraded?.event,
			`\`ctx.model\` is \`Model<any> | undefined\`, and with no catalogue entry there are no rates ` +
				`to compute with. ${MODEL_UNAVAILABLE_EVENT} is what lets Phase 8 EXCLUDE this row from a ` +
				"spend total instead of quietly under-counting it: a zero cost that looks exactly like a " +
				"computed one is a fabricated measurement [threat T-02-08-05]",
		).toBe(MODEL_UNAVAILABLE_EVENT);

		expect(
			degraded?.cost?.total,
			"the cost must be zero, because the rates were zero — not because the turn was free. The " +
				"marker above is the only thing that says which",
		).toBe(0);

		expect(
			degraded?.provider,
			"the row must still name the provider. The degraded shape takes its identifying strings " +
				"from the MESSAGE, so the row says what ran even when the catalogue entry is gone",
		).toBe(makeMessage().provider);

		expect(degraded?.model, "and the model id, for the same reason").toBe(makeMessage().model);
	});

	it("keeps every field the healthy row has, so 'honestly degraded' is a tested claim", () => {
		// Derived from the healthy row rather than transcribed from
		// `turns-log.test.ts`'s REQUIRED_TURN_FIELDS: a duplicated literal list is how
		// an assertion silently stops matching the thing it checks.
		const expected = Object.keys(healthy ?? {}).sort();

		expect(
			expected.length,
			"the healthy row has no keys at all, so the comparison below is vacuous",
		).toBeGreaterThanOrEqual(15);

		expect(
			expected.filter((key) => !Object.keys(degraded ?? {}).includes(key)),
			"the degraded row is missing fields the healthy one carries. `degradedModel` exists so the " +
				"row is a COMPLETE row with honest zeros, not a stub: a partial row cannot be joined to " +
				"its wire records or attributed to a session, and Phase 8 would have to special-case it",
		).toEqual([]);
	});

	it("leaves a visible hole when a turn produced no assistant message", () => {
		expect(
			noMessage?.event,
			`a turn with no message must still append. Skipping it would make a broken instrument ` +
				`indistinguishable from a quiet session, which is the single failure class this phase ` +
				"exists to eliminate [threat T-02-08-02]",
		).toBe(DIAGNOSTICS_ERROR_EVENT);

		expect(
			noMessage?.where,
			`the row must name ${TURN_NO_MESSAGE_WHERE}, so a reader grepping the turns log can tell ` +
				"this hole from a handler that threw",
		).toBe(TURN_NO_MESSAGE_WHERE);

		expect(
			noMessage?.kind,
			"and it must carry NO `kind`. `kind:\"turn\"` is what a per-turn total sums over, so a row " +
				"with no tokens counted as a turn would drag every average down",
		).toBeUndefined();

		expect(
			[noMessage?.turnIndex, noMessage?.toolResults],
			"the turn's own index and tool-result count are the evidence about WHICH turn vanished; a " +
				"row that only says `something went wrong` is barely better than silence",
		).toEqual([2, 2]);

		expect(
			noMessage?.sessionId,
			"and it must be attributable, or the hole cannot be tied to the session it happened in",
		).toBe(SESSION_ID);

		expect(
			typeof noMessage?.corr,
			"the correlation id must be present even here — it is the only route from this row to the " +
				"bytes that were sent before the message went missing",
		).toBe("string");
	});
});
