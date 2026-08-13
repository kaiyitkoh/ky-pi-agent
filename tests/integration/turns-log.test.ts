/**
 * DIAG-04 — a live session appends exactly one honest row per turn, including
 * for the turns that failed.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * This is the end-to-end half of DIAG-04: real `createAgentSession`, the real
 * diagnostics extension loaded at user scope, real `turn_start` /
 * `message_end` / `turn_end` hooks, real bytes on disk. The pure composer's
 * field-by-field behaviour — the omitted-key rule, the outcome table, the
 * optional-field discipline — is `tests/unit/turn-row.test.ts`, against inline
 * fixtures. Neither file is sufficient alone: the unit test cannot prove a hook
 * fired, and driving 52 field permutations through a live session would be slow
 * and would prove less.
 *
 * The numbers here are FAUX numbers. `fauxProvider` synthesises usage at four
 * characters per token and hardcodes `usage.cost` to all zeros
 * [VERIFIED: pi-ai 0.84.1 src/providers/faux.ts:118-150, :147] — the non-zero
 * cost this file asserts on comes from `composeTurnRow`'s defensive
 * `calculateCost`, not from a provider. What a real DeepSeek or Bedrock turn
 * reports is `RB-02-01`, which stays **OUTSTANDING**. Never read a green run
 * here as a live measurement.
 *
 * ---------------------------------------------------------------------------
 * THE HOOK CHOICE THIS FILE DEFENDS (Pitfall 3)
 * ---------------------------------------------------------------------------
 * The row's spine is `turn_start` + `message_end` + `turn_end`, deliberately
 * NOT `after_provider_response`. That hook sits after the retry wrapper
 * [VERIFIED: pi-ai src/api/openai-completions.ts:239] and a 4xx/5xx throws into
 * the catch at `:590`, so it never fires on a provider error — a row derived
 * from it would be missing exactly the turns most worth having. Case 4 is the
 * assertion that keeps that choice honest, and Pitfall 3's warning sign is a day
 * with errors visible on screen and **zero rows carrying `outcome: "error"`**.
 *
 * The error turn really does reach `turn_end`:
 * `if (message.stopReason === "error" || message.stopReason === "aborted") {
 *  await emit({ type: "turn_end", message, toolResults: [] }); … }`
 * [VERIFIED: pi-agent-core 0.84.1 dist/agent-loop.js:106-110].
 *
 * ---------------------------------------------------------------------------
 * FIXTURE DISCIPLINE
 * ---------------------------------------------------------------------------
 * Four sessions, because the four questions need four different scripts: a
 * clean single turn, a tool-using pair, an errored turn, and two turns sharing
 * one `sessionId` so faux's prefix-cache simulation engages. Every scanned set
 * is asserted non-empty before it is examined — a filter that matches nothing
 * makes every assertion after it vacuously true, which is the failure mode this
 * whole phase exists to eliminate.
 *
 * The extension loads at USER scope through `extensionPath`: project-scoped
 * `.pi/extensions` is gated behind project trust, which resolves `false`
 * headless with no UI to answer the prompt, and a silently absent extension is a
 * green run over nothing (RESEARCH §8.4).
 */
import { existsSync } from "node:fs";

import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

import { beforeAll, describe, expect, it } from "vitest";

import { SESSION_TURN_ROLE } from "../../.pi/extensions/diagnostics/index.ts";
import { logPath } from "../../.pi/extensions/diagnostics/jsonl.ts";
import {
	TURNS_LOG_BASE,
	WIRE_LOG_BASE,
	type Outcome,
	type RowKind,
	type WireKind,
} from "../../.pi/extensions/diagnostics/schema.ts";
import { SECRET_FIXTURE_TOKEN } from "../helpers/faux.ts";
import { repoRoot } from "../helpers/git.ts";
import { readTornSafe } from "../helpers/logs.ts";
import { withFauxSession } from "../helpers/session.ts";

/** Absolute path of the diagnostics extension this repository ships. */
const EXTENSION_ENTRY = `${repoRoot()}/.pi/extensions/diagnostics/index.ts`;

/**
 * Every field RESEARCH §5.5 says a turn row must always carry.
 *
 * Asserted against `Object.keys` of the DESERIALISED record, so a field that was
 * assigned `undefined` — which `JSON.stringify` silently drops — fails here
 * rather than surviving as a key that is present in memory and absent on disk.
 * The optional fields (`reasoning`, `cacheReadRatio`, `httpStatus`,
 * `rawStopReason`, `responseModel`, `errorMessage`, `event`) are deliberately
 * NOT on this list; their presence rules are the omitted-key rule, asserted in
 * `tests/unit/turn-row.test.ts` and, for `reasoning`, in case 6 below.
 */
const REQUIRED_TURN_FIELDS = [
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
	"turnIndex",
] as const;

/** The shape this file asserts on. Imported unions, never retyped literals. */
interface TurnRowShape {
	ts?: number;
	kind?: RowKind;
	role?: string;
	sessionId?: string;
	corr?: string;
	provider?: string;
	model?: string;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: { input?: number; output?: number; total?: number };
	cacheReadRatio?: number;
	latencyMs?: number;
	stopReason?: string;
	outcome?: Outcome;
	errorMessage?: string;
	toolCalls?: number;
	toolResults?: number;
	turnIndex?: number;
	thinkingLevel?: string;
	event?: string;
	where?: string;
}

/** The wire fields the correlation join needs. */
interface WireRowShape {
	kind?: WireKind;
	corr?: string;
}

/** Both logs a session produced, plus the raw turns bytes. */
interface Capture {
	turns: TurnRowShape[];
	unparseable: string[];
	wire: WireRowShape[];
}

/**
 * Read one stream, failing with the remedy rather than an `ENOENT` stack.
 *
 * A missing file is the single most likely failure of this whole file — it is
 * what "the extension never loaded" looks like — so it gets a message that says
 * so instead of a `readFileSync` trace forty frames from the cause.
 */
function readStream(cwd: string, base: string): { records: unknown[]; unparseable: string[] } {
	const file = logPath(cwd, base);
	if (!existsSync(file)) {
		throw new Error(
			`${file} does not exist: the session wrote no ${base} log at all. The likeliest cause ` +
				"is the diagnostics extension not loading — it must sit at USER scope, which is what " +
				"`extensionPath` in tests/helpers/session.ts arranges, because project-scoped " +
				"`.pi/extensions` is gated behind project trust and that resolves false headless.",
		);
	}
	return readTornSafe(file);
}

/** Only the rows this plan writes: `kind:"turn"`. Error rows carry no `kind`. */
function turnRowsOf(capture: Capture): TurnRowShape[] {
	return capture.turns.filter((row) => row.kind === "turn");
}

/** Drive one session to completion and hand back both logs. */
async function capture(options: {
	responses: Parameters<typeof withFauxSession>[0]["responses"];
	prompts: string[];
	tools?: string[];
	cwdFiles?: Record<string, string>;
}): Promise<Capture> {
	return await withFauxSession(
		{
			extensionPath: EXTENSION_ENTRY,
			responses: options.responses,
			tools: options.tools,
			cwdFiles: options.cwdFiles,
		},
		async ({ session, cwd }) => {
			for (const prompt of options.prompts) {
				await session.prompt(prompt);
			}

			// WHY THE DIRECTORY AND NOT `producedPaths()`. Pi loads the extension
			// through jiti, which keeps its own module registry, so the `jsonl.ts`
			// instance that did the writing is not the one this file imported and the
			// in-process produced-path set is empty here no matter what was written
			// (02-05's finding, re-confirmed in 02-07). The bytes on disk are the
			// honest oracle at this boundary.
			const turns = readStream(cwd, TURNS_LOG_BASE);
			const wire = readStream(cwd, WIRE_LOG_BASE);
			return {
				turns: turns.records as TurnRowShape[],
				unparseable: turns.unparseable,
				wire: wire.records as WireRowShape[],
			};
		},
	);
}

/** A credential-carrying provider error, for case 4. */
const ERROR_TEXT = `upstream rejected the request: authorization Bearer ${SECRET_FIXTURE_TOKEN}`;

let onePrompt: Capture;
let toolTurn: Capture;
let errorTurn: Capture;
let twoPrompts: Capture;

describe("DIAG-04 — one turn, one row, on a live session", () => {
	beforeAll(async () => {
		onePrompt = await capture({
			responses: [fauxAssistantMessage("ok", { stopReason: "stop" })],
			prompts: ["hello"],
		});

		toolTurn = await capture({
			responses: [
				fauxAssistantMessage([fauxToolCall("read", { path: "note.txt" })], {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage([fauxText("the note says hi")], { stopReason: "stop" }),
			],
			prompts: ["read the note"],
			tools: ["read"],
			cwdFiles: { "note.txt": "hi\n" },
		});

		errorTurn = await capture({
			responses: [
				fauxAssistantMessage("", { stopReason: "error", errorMessage: ERROR_TEXT }),
			],
			prompts: ["hello"],
		});

		twoPrompts = await capture({
			responses: [
				fauxAssistantMessage("first", { stopReason: "stop" }),
				fauxAssistantMessage("second", { stopReason: "stop" }),
			],
			prompts: ["hello", "and again"],
		});
	});

	it("case 1 — one prompt leaves exactly one turn row, with every required field", () => {
		expect(
			onePrompt.unparseable,
			"a line of the turns log could not be parsed as JSON. The writer is open-write-close per " +
				"record precisely so this cannot happen from a single process",
		).toEqual([]);

		const rows = turnRowsOf(onePrompt);
		expect(
			rows.length,
			'the turns log holds no `kind:"turn"` record for a prompt that completed, so DIAG-04 ' +
				"produced nothing and every assertion below is vacuous. A row count of zero is also " +
				"exactly what a dead instrument looks like: `turn_end` is the only place a main-loop " +
				"row is appended, and a handler that throws there is swallowed by Pi " +
				"(runner.ts:861-870). More than one row means the accumulator is not being cleared",
		).toBe(1);

		const row = rows[0] as TurnRowShape;
		const keys = Object.keys(row);
		for (const field of REQUIRED_TURN_FIELDS) {
			expect(
				keys,
				`the row is missing \`${field}\`, which RESEARCH §5.5 lists as always present. A row ` +
					"with a hole in it is worse than no row: Phase 8 reads these columns as ground " +
					"truth and a missing one becomes an undefined in a cost total. Note this checks " +
					"the DESERIALISED keys, so a field assigned `undefined` fails here — JSON.stringify " +
					"drops it while Object.keys in memory still reports it",
			).toContain(field);
		}

		expect(row.role, "every main-loop row carries the session role, so Phase 8's per-role cost query needs no special case for rows with no role").toBe(
			SESSION_TURN_ROLE,
		);
		expect(
			row.outcome,
			'a `stopReason: "stop"` turn maps to `outcome: "ok"` through OUTCOME_BY_STOP_REASON ' +
				"(RESEARCH §3.3). A different value here means the table and the composer disagree",
		).toBe("ok");
		expect(
			row.stopReason,
			"the provider's own word is kept beside this project's interpretation of it, so a reader " +
				"can disagree with the mapping without losing the evidence",
		).toBe("stop");

		expect(
			Number.isFinite(row.latencyMs) && (row.latencyMs ?? -1) >= 0,
			`latencyMs was ${String(row.latencyMs)}. It is turn_end wall clock minus ` +
				"turn_start.timestamp, and that timestamp is Date.now() at emit " +
				"(pi dist/core/agent-session.js:448-453), so a negative or non-finite value means the " +
				"accumulator was never stamped and the number is fabricated",
		).toBe(true);

		expect(
			row.cost?.total,
			"cost.total is zero or missing. `fauxProvider` hardcodes usage.cost to all zeros " +
				"(pi-ai faux.ts:147), so this number can only be non-zero if composeTurnRow really " +
				"called calculateCost against the model's rates. A zero here means every cost " +
				"assertion in this repository is `0 === 0` [threat T-02-06-03]",
		).toBeGreaterThan(0);

		expect(
			(row.totalTokens ?? 0) > 0,
			"the row reports zero total tokens for a turn that really ran. faux synthesises usage at " +
				"four characters per token (faux.ts:118-150), so zero means the usage came from " +
				"somewhere other than the finalized message",
		).toBe(true);

		expect(
			row.turnIndex,
			"the first turn of an agent run is turnIndex 0 — `_turnIndex` is reset on agent_start " +
				"(pi dist/core/agent-session.js:441-443). This also proves the value came from " +
				"turn_end rather than being invented",
		).toBe(0);

		expect(
			typeof row.thinkingLevel,
			"the row records no thinkingLevel. It is the REQUESTED level, read from `ctx.thinkingLevel` " +
				"at turn_start, and it is the only thing a Bedrock row can honestly say about thinking " +
				"at all: `handleMetadata` never assigns `usage.reasoning` " +
				"(pi-ai src/api/bedrock-converse-stream.ts:589-602), so the cost of thinking is " +
				"undecomposable there and the request is the only surviving evidence (RESEARCH §5.4). " +
				"A live createAgentSession resolves this to a real level, so `undefined` here means " +
				"the accumulator never read it",
		).toBe("string");
	});

	it("case 2 — the turn row and its wire records share one correlation id", () => {
		// WHY THIS CASE EXISTS. `wire-*.jsonl` holds the bytes and `turns-*.jsonl`
		// holds the numbers. Without a shared key the two files cannot be read
		// together, and the first question anyone asks of a bad turn — "what did we
		// actually send?" — has no answer.
		//
		// WHAT IS DELIBERATELY NOT CLAIMED: a PER-ATTEMPT id. Provider retries reuse
		// the same headers rather than re-firing `before_provider_headers`
		// [CITED: pi 0.84.1 docs/extensions.md:676], so an attempt counter is not
		// observable on the main loop and would be fabricated. The id identifies one
		// LOGICAL request — one headers/request/response triple and the row it
		// produced.
		const rows = turnRowsOf(onePrompt);
		expect(rows.length, "no turn row to join, so this case would prove nothing").toBe(1);

		const requests = onePrompt.wire.filter((record) => record.kind === "main.request");
		expect(
			requests.length,
			"the wire log holds no `main.request` record, which is Pitfall 1: `fauxProvider` never " +
				"calls `options.onPayload` (pi-ai faux.ts:510) and Pi wires before_provider_request to " +
				"exactly that callback, so the payload hook does not fire unless the provider is " +
				"wrapped by `wrapFauxWithPayload`. The headers and response hooks fire regardless, " +
				"which is what makes this failure look green to a record-count guard",
		).toBe(1);

		expect(
			rows[0]?.corr,
			"the turn row's correlation id fell back to its `uncorrelated` sentinel, which means no " +
				"id was live when message_end ran and the join below is measuring nothing",
		).not.toBe("uncorrelated");

		expect(
			rows[0]?.corr,
			"the turn row and the main.request record for the same turn carry different correlation " +
				"ids, so the two logs cannot be joined. The id is captured at message_end rather than " +
				"turn_end precisely to avoid this: a nested callModel during tool execution issues its " +
				"own id, and reading the id later would stamp the turn with bytes it never sent",
		).toBe(requests[0]?.corr);
	});

	it("case 3 — a tool-using turn records outcome, tool calls and tool results", () => {
		expect(
			toolTurn.unparseable,
			"a line of the tool-turn log could not be parsed as JSON",
		).toEqual([]);

		const rows = turnRowsOf(toolTurn);
		expect(
			rows.length,
			"a tool call produces TWO turns — the call, then the follow-up after the result — so two " +
				"rows are expected. Fewer means turn_end did not fire for one of them, which is how a " +
				"whole class of turns would go unrecorded",
		).toBe(2);

		const first = rows[0] as TurnRowShape;
		expect(
			first.outcome,
			'`stopReason: "toolUse"` maps to `outcome: "tool_use"`. Phase 10 discriminates ' +
				"root causes on this column; a tool turn recorded as `ok` makes that impossible",
		).toBe("tool_use");

		expect(
			first.toolCalls ?? 0,
			"the row reports no tool calls on a turn that made one. `toolCalls` counts " +
				'`content[].type === "toolCall"` on the finalized message — prose tool calls are text ' +
				"and are deliberately NOT counted here (that is DIAG-05's job), so a zero on a real " +
				"tool call means the message never reached the composer",
		).toBeGreaterThanOrEqual(1);

		expect(
			first.toolResults ?? 0,
			"`toolResults` comes from `turn_end.toolResults.length` and is the only field in the row " +
				"that can only come from that hook. A missing or zero value means turn_end's event " +
				"payload was not read, and the row is being built from the message alone",
		).toBeGreaterThanOrEqual(1);

		expect(
			rows[1]?.outcome,
			"the follow-up turn after the tool result ended normally, so it maps to `ok`",
		).toBe("ok");
	});

	it("case 4 — an errored turn still leaves a row, with the error text redacted", () => {
		// PITFALL 3'S WARNING SIGN, in one sentence: a day with errors visible on
		// screen and ZERO rows carrying `outcome: "error"`. That is what building the
		// row from `after_provider_response` produces, because the hook never fires
		// on a provider error (pi-ai openai-completions.ts:239 vs the catch at :590).
		// This case is the standing guard against that regression.
		expect(errorTurn.unparseable, "a line of the error-turn log could not be parsed").toEqual([]);

		const rows = turnRowsOf(errorTurn);
		expect(
			rows.length,
			"an errored turn produced NO row. This is Pitfall 3 exactly: the turns most worth having " +
				"are the ones that failed, and a spine built on the response hook loses every one of " +
				"them. The agent loop does emit turn_end for an error message " +
				"(pi-agent-core dist/agent-loop.js:106-110), so a missing row is this subsystem's bug, " +
				"not Pi's [threat T-02-08-01]",
		).toBe(1);

		const row = rows[0] as TurnRowShape;
		expect(
			row.outcome,
			'`stopReason: "error"` must map to `outcome: "error"`. This is the column an operator ' +
				"greps to answer 'how often did the cheap model just fail today?'",
		).toBe("error");

		expect(
			row.errorMessage,
			"the row carries no errorMessage, so it records that something failed and nothing about " +
				"what. The finalized message carries the text even when no HTTP response was ever seen",
		).toBeDefined();

		expect(
			(row.errorMessage ?? "").includes(SECRET_FIXTURE_TOKEN),
			"a credential quoted by the provider's error text reached the turns log in plaintext. " +
				"Provider error strings routinely echo request content, and this repository is public: " +
				"redaction happens at capture, because a reader that would have masked it changes " +
				"nothing about the bytes already on disk [threat T-02-08-03]",
		).toBe(false);

		expect(
			row.errorMessage,
			"the non-secret half of the error text must survive. A redactor that blanked the whole " +
				"string would satisfy the assertion above while destroying the diagnostic — " +
				"over-redaction is a failure too, just a quieter one",
		).toContain("upstream rejected the request");

		// THE STRUCTURAL HALF OF PITFALL 3, and the reason this assertion sits on the
		// ERROR row specifically. Faux answers `{status: 200}` unconditionally, before
		// it even looks at the scripted step (pi-ai faux.ts:341), so
		// `after_provider_response` DID fire for this errored turn — and the row still
		// carries no status, because no field of a main-loop row is derived from that
		// hook. Against a real provider the hook would not have fired at all
		// (openai-completions.ts:239 vs the catch at :590); a row that had learned to
		// depend on it would simply not exist. An `httpStatus` appearing here is the
		// early warning that the spine moved.
		expect(
			Object.keys(row),
			"the errored turn row carries an httpStatus. That value can only have come from " +
				"`after_provider_response`, and a row that depends on that hook loses every real " +
				"provider error — which is the entire failure Pitfall 3 describes [threat T-02-08-01]",
		).not.toContain("httpStatus");
	});

	it("case 5 — the second turn of a session reads from cache", () => {
		// This is faux's SIMULATION, not a provider measurement: it keys a prompt
		// cache on `options.sessionId` and reports the common prefix as `cacheRead`
		// whenever `cacheRetention !== "none"` [pi-ai faux.ts:118-150]. Pi's main loop
		// does pass a sessionId (pi dist/core/sdk.js:218), which is what makes the
		// cache column exercisable at all offline. The real figure — what DeepSeek or
		// Bedrock actually report — is an `RB-02-01` observation and stays OUTSTANDING.
		expect(twoPrompts.unparseable, "a line of the two-prompt log could not be parsed").toEqual(
			[],
		);

		const rows = turnRowsOf(twoPrompts);
		expect(
			rows.length,
			"two prompts must leave two rows. One row means a turn went unrecorded; three means the " +
				"per-turn accumulator is appending more than once",
		).toBe(2);

		const second = rows[1] as TurnRowShape;
		expect(
			second.cacheRead ?? 0,
			"the second turn of a session read nothing from cache. Without a non-zero cacheRead the " +
				"cache column is untested end to end, and Phase 8's cache story would be built on a " +
				"number no test has ever seen move",
		).toBeGreaterThan(0);

		const ratio = second.cacheReadRatio;
		expect(
			ratio,
			"cacheReadRatio is absent on a turn that read from cache. The key is omitted only when " +
				"`input + cacheRead` is zero, which is not this turn",
		).toBeDefined();
		expect(
			(ratio ?? 0) > 0 && (ratio ?? 1) < 1,
			`cacheReadRatio was ${String(ratio)}. A value of exactly 0 or exactly 1 means the ` +
				"denominator collapsed — either the cache read nothing, or the whole prompt came from " +
				"cache and the new user message somehow cost no input tokens. Both would mean the " +
				"ratio is not measuring what it claims",
		).toBe(true);

		expect(
			(rows[0]?.cacheRead ?? -1) === 0,
			"the FIRST turn must read nothing from cache — there was nothing cached yet. Without this " +
				"paired negative the assertion above cannot distinguish a working cache column from a " +
				"column that reports a non-zero number unconditionally",
		).toBe(true);
	});

	it("case 6 — no faux row carries a `reasoning` key at all", () => {
		// THE OMITTED-KEY RULE, at the boundary where it is easiest to break. faux
		// never sets `usage.reasoning` [RESEARCH §8.5], which matches Bedrock, whose
		// `handleMetadata` never assigns it
		// [VERIFIED: pi-ai src/api/bedrock-converse-stream.ts:589-602]. A `reasoning:
		// 0` written here would report every Bedrock turn's thinking as free — a
		// fabricated measurement (Pitfall 4). Absence of the key means THE PROVIDER
		// REPORTS NO BREAKDOWN; it does not mean zero thinking tokens were billed.
		//
		// The present-when-numeric half cannot be driven through faux at all and is
		// covered by `tests/unit/turn-row.test.ts`, which feeds `Usage` objects
		// directly. Neither half is sufficient alone.
		const rows = [
			...turnRowsOf(onePrompt),
			...turnRowsOf(toolTurn),
			...turnRowsOf(errorTurn),
			...turnRowsOf(twoPrompts),
		];
		expect(
			rows.length,
			"no rows were collected across the four fixtures, so the loop below iterates nothing and " +
				"this case is a pass that verified nothing",
		).toBeGreaterThan(0);

		for (const row of rows) {
			expect(
				Object.keys(row),
				"a faux row carries a `reasoning` key. faux never reports a reasoning breakdown, so " +
					"the only way this key exists is the composer defaulting it — and a defaulted zero " +
					"is indistinguishable on disk from a provider that genuinely billed no thinking " +
					"tokens. Those are different facts and the row must be able to say both",
			).not.toContain("reasoning");
		}
	});
});
