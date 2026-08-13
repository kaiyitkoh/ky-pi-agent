/**
 * ky-pi-agent — Phase 2 diagnostics extension.
 *
 * PURPOSE. This subsystem is the instrument. Everything downstream of Phase 2 —
 * routing (Phase 5), the quality gates (Phase 8), the root-cause discrimination
 * (Phase 10) — is a decision made on numbers, and until those numbers exist on
 * disk every one of them is a guess. This file is where the hooks that produce
 * them are registered.
 *
 * LIFETIME. Permanent. It grows across this phase: plan 02-05 added the wire
 * capture, 02-08 the per-turn rows, 02-09 the prose-tool-call retry and 02-10
 * the `/budget` command. Today it registers `session_start`, the three
 * main-loop provider hooks, the three turn hooks, and `agent_start`.
 *
 * THE TURN ROW IS BUILT FROM THE HOOKS THAT ALWAYS FIRE. `turn_start` supplies
 * the clock, `message_end` the finalized assistant message, `turn_end` the turn
 * index and tool-result count. `after_provider_response` contributes NOTHING to
 * a turns row and must not: it sits after the retry wrapper
 * [VERIFIED: pi-ai 0.84.1 src/api/openai-completions.ts:239] so a 4xx/5xx
 * throws into the catch at `:590` and the hook never fires at all. A row derived
 * from it would be missing exactly the turns most worth having, and the warning
 * sign is a day with errors visible on screen and zero rows carrying
 * `outcome: "error"` (RESEARCH §3.2, Pitfall 3).
 *
 * BOUNDARY RULE (BOOT-10). This subsystem registers **commands and event hooks
 * only**. It must never register a tool. A tool's name, description and
 * complete JSON Schema are serialised into `tools[]` on every single provider
 * request [VERIFIED: pi-ai 0.84.1 src/api/openai-completions.ts:1337-1370],
 * so a diagnostic tool would tax every turn of the cheap model this whole
 * project exists to make reliable — the instrument would become the thing it is
 * measuring. A command costs exactly zero per-turn tokens. This file therefore
 * does not spell the tool-registration call even in prose, the same dodge
 * `harness/index.ts:36` uses, because
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`, comments
 * included.
 *
 * LAYOUT. Sibling modules, and the requirement each serves:
 *
 *   schema.ts     — row types and every literal a test asserts on. DIAG-04/08.
 *   jsonl.ts      — the append-only writer, rotation and retention. DIAG-08.
 *   redact.ts     — credential redaction at capture time.           DIAG-07.
 *   wire.ts       — the three main-loop provider hooks: capture,
 *                   redact, append. Redaction happens INSIDE the hook,
 *                   which is what makes DIAG-07's "at capture time"
 *                   true rather than aspirational.             DIAG-01/07.
 *   turns.ts      — the pure per-turn row composer. This file supplies it
 *                   the message, the clock and the model; it supplies the
 *                   tokens, the cost and the outcome.               DIAG-04.
 *   call-model.ts — THE chokepoint for nested model calls. It writes its
 *                   own `kind:"nested"` rows and counts them through
 *                   {@link noteRowWritten}.                      DIAG-02/03.
 *   prose.ts      — the prose-tool-call PREDICATE. Its EFFECT — the row,
 *                   the capped follow-up and the exhaustion record —
 *                   lives in the `message_end` handler below.       DIAG-05.
 *
 * THE PROSE RETRY IS A FOLLOW-UP MESSAGE, NOT A FABRICATED TOOL CALL. The
 * alternative — returning `{ message }` from `message_end` with the parsed
 * prose promoted into a real `toolCall` content block — was executed during
 * research and it works, at zero extra model calls [RESEARCH §6.4, executed
 * 2026-08-13]. It is deliberately not built here for three reasons: it executes
 * a tool whose arguments were regex-scraped out of untrusted prose, on a laptop
 * where merging to `main` auto-deploys and Phase 4's command guard has not
 * shipped; it rewrites session history to claim the model emitted a call it
 * never emitted, corrupting the very measurement Phase 10 reads; and a wrong
 * parse produces a silently wrong ACTION rather than a visible retry. It becomes
 * an available lever for read-only tools once Phase 4 ships, and
 * `docs/DIAGNOSTICS.md` (plan 02-11) documents it as one. Nothing in this file
 * constructs a content block. [threat T-02-09-01]
 *
 * Only this file is an entry point: `.pi/extensions/<dir>/index.ts` is one of
 * the four auto-discovered shapes [CITED: pi 0.84.1 docs/extensions.md:115-120]
 * and the documented precondition for `/reload` hot-reload. The siblings carry
 * no default export, which is exactly what
 * `tests/unit/extension-layout.test.ts` uses to tell a module from an entry
 * point.
 *
 * FAILING LOUDLY IS NOT AUTOMATIC HERE. Pi catches every exception thrown by an
 * extension handler and routes it to `emitError`, which produces no visible
 * output [VERIFIED: pi 0.84.1 src/core/extensions/runner.ts:861-870 — observed
 * live during Phase 2 research, where a bad regex produced no error anywhere
 * until a local try/catch was added]. A diagnostics extension that dies that
 * way looks identical to a quiet one: the log simply stops. {@link safeHandler}
 * and {@link rowsWrittenThisSession} exist for that single reason.
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

import { appendJsonl, pruneLogs } from "./jsonl.ts";
import { isProseToolCall, proseToolCallName } from "./prose.ts";
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

/**
 * `event` value on the row written once per session start.
 *
 * Exported so a test imports it rather than re-typing the literal — the house
 * rule from `harness/index.ts:50-56`.
 */
export const SESSION_START_EVENT = "diagnostics.session_start";

/**
 * `role` carried by every main-loop turn row.
 *
 * The main loop has no `opts.role` to pass — that field belongs to
 * `callModel`, where a nested call names the executor it ran as. A constant
 * here keeps the column present and joinable on every row rather than optional
 * on some, so Phase 8's per-role cost query does not need a special case for
 * "the rows with no role".
 */
export const SESSION_TURN_ROLE = "session";

/**
 * `where` on the error row a turn that produced no assistant message leaves.
 *
 * A turn MUST leave a row. Skipping the append when the accumulator is empty
 * would make a broken instrument indistinguishable from a quiet session, which
 * is the single failure class this phase exists to eliminate.
 * [threat T-02-08-02]
 */
export const TURN_NO_MESSAGE_WHERE = "turn_end.no_message";

/**
 * `event` on a row whose cost was computed from a DEGRADED model shape.
 *
 * `ctx.model` is `Model<any> | undefined` [VERIFIED: pi 0.84.1
 * dist/core/extensions/types.d.ts:223]. When it is undefined there are no cost
 * rates to compute with, so the row's `cost` is all zeros — and a zero cost that
 * looks exactly like a computed one is a fabricated measurement. This marker is
 * what lets Phase 8 exclude the row from a spend total instead of quietly
 * under-counting it. [threat T-02-08-05]
 */
export const MODEL_UNAVAILABLE_EVENT = "diagnostics.model_unavailable";

/**
 * Whether the prose retry forces `tool_choice: "required"` on its one extra
 * request. **`false`, and it must stay `false` until Phase 10 says otherwise.**
 *
 * THE MECHANISM EXISTS. On the main loop it is a second `before_provider_request`
 * handler returning a payload with `tool_choice: "required"` for exactly the
 * retry request — Pi treats any non-`undefined` return from that hook as a
 * REPLACEMENT for the outgoing body [RESEARCH §1.2]. On the nested path it is
 * `options.toolChoice` [RESEARCH §4.2]. Neither is hard to build.
 *
 * ITS EFFECT IS **UNVERIFIED**, which is why it is off. Nobody here has measured
 * whether DeepSeek honours the field, and PITFALLS Pitfall 7 note 3 flags the
 * open possibility that it trades a prose tool call for a *wrong* tool call —
 * which would look like a fixed turn and be a worse one. Turning it on before
 * the detector has produced a baseline prose rate would also destroy the
 * baseline: the retry would be measuring the intervention rather than the
 * problem. RESEARCH Open Question 1 assigns the experiment to Phase 10.
 *
 * NO HANDLER IS REGISTERED WHILE THIS IS FALSE. A registered-but-inert handler
 * is one edit away from being live and, worse, would appear in the hook list
 * `tests/unit/diagnostics-entry.test.ts` asserts, implying a capability this
 * subsystem does not have. [threat T-02-09-06, disposition: accept]
 */
export const PROSE_RETRY_FORCES_TOOL_CHOICE = false;

/** Rows this process has written. Read through {@link rowsWrittenThisSession}. */
let rowsWritten = 0;

/**
 * Prose-tool-call retries spent in the CURRENT agent run. Reset on `agent_start`.
 *
 * PER RUN, NOT PER SESSION AND NOT PER TURN. Per turn would be no cap at all —
 * the retry creates a new turn, so the counter would reset the instant it
 * mattered. Per session would silently stop retrying after the first prose call
 * of the day, which is a different behaviour wearing the same name.
 * [threat T-02-09-02]
 */
let proseRetriesThisRun = 0;

/**
 * How many diagnostic rows this process has written.
 *
 * `/budget` (plan 02-08) reports this number so that "0 rows" is something a
 * reader SEES rather than something they infer from an empty file they never
 * thought to open. A silently dead instrument is indistinguishable from a quiet
 * session, and that ambiguity is the failure this phase exists to eliminate.
 * [threat T-02-03-05]
 */
export function rowsWrittenThisSession(): number {
	return rowsWritten;
}

/**
 * Record that one row reached disk.
 *
 * Exported because the sibling modules added later in this phase append rows
 * too, and a counter that only some append paths increment is worse than no
 * counter: it reports a number that looks like a measurement and is not.
 */
export function noteRowWritten(): void {
	rowsWritten += 1;
}

/**
 * Append one row to the turns stream and count it.
 *
 * The rotation cap is passed explicitly even though `appendJsonl` resolves the
 * same numbers from the base name: `call-model.ts` spells them out at its own
 * append, and a reader comparing the two append sites should not have to know
 * that one of them relies on a default to reach the same value.
 */
function writeTurnsRow(cwd: string, record: TurnRow | Record<string, unknown>): void {
	appendJsonl(cwd, TURNS_LOG_BASE, record, {
		rotateBytes: TURNS_ROTATE_BYTES,
		maxRotated: MAX_ROTATED_FILES,
	});
	noteRowWritten();
}

/**
 * What the three turn hooks accumulate between `turn_start` and `turn_end`.
 *
 * ONE MUTABLE RECORD, NOT A MAP. The agent loop is serial: `turn_start` →
 * (provider request) → `message_end` → tool execution → `turn_end`, then the
 * next turn. Keying by `turnIndex` would suggest an interleaving that does not
 * happen and would leak an entry for every turn that never ended.
 */
interface TurnAccumulator {
	/** `turn_start.timestamp`, which is `Date.now()` [VERIFIED: pi 0.84.1 dist/core/agent-session.js:448-453]. */
	startedAt: number;
	/** The correlation id live at `message_end`. See {@link captureCorrelationId}. */
	corr?: string;
	/** The finalized assistant message, or `undefined` if none was seen. */
	message?: AssistantMessage;
	/** `ctx.thinkingLevel` as REQUESTED at turn start. */
	thinkingLevel?: string;
	/**
	 * Out-of-band verdict to stamp on this turn's row — today only
	 * {@link PROSE_EVENT}.
	 *
	 * It rides on the accumulator rather than being appended as its own turn row
	 * because `turn_end` already writes exactly one row per turn and counts it;
	 * a second `kind:"turn"` row from `message_end` would double every per-turn
	 * total Phase 8 computes (02-08's handover note).
	 */
	event?: string;
}

/** The turn currently in flight, or `undefined` between turns. */
let inFlight: TurnAccumulator | undefined;

/**
 * Why the correlation id is captured at `message_end` and not at `turn_end`.
 *
 * `currentCorrelationId()` returns the LAST id this module instance issued.
 * Between the assistant message and the end of the turn, tool execution runs —
 * and a tool (or a Phase 5 router, or a Phase 8 gate) may make a nested
 * `callModel` invocation, which issues its own id. Reading the id at `turn_end`
 * would therefore stamp the turn row with the nested call's correlation and
 * join the turn to bytes it never sent. Reading it at `message_end`, which
 * fires immediately after the provider response, captures the id of the request
 * that produced this very message.
 */
function captureCorrelationId(): string {
	return currentCorrelationId() ?? UNCORRELATED;
}

/**
 * A `Model<Api>` standing in for an absent `ctx.model`, with ZERO cost rates.
 *
 * The rates are zero because there are none to read, not because the turn was
 * free — which is precisely why every row composed against this shape also
 * carries {@link MODEL_UNAVAILABLE_EVENT}. The identifying strings come from the
 * message itself, so the row still says which provider and model ran even when
 * the catalogue entry is gone.
 *
 * `contextWindow` and `maxTokens` are zero and unused: `calculateCost` reads
 * only `model.cost` [VERIFIED: pi-ai 0.84.1 src/models.ts:878-898].
 */
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
 * Wrap a handler so a throw leaves a row instead of vanishing.
 *
 * On catch it appends a turns-log row carrying {@link DIAGNOSTICS_ERROR_EVENT},
 * the handler's name in `where`, and `String(err)` passed through
 * {@link redactString} — an exception message can quote the input that caused
 * it, and that input may be a `.env` the model just read. [threat T-02-03-06]
 *
 * It returns `undefined` from the catch path and never rethrows. Rethrowing
 * would put the exception straight back into the swallowing path this wrapper
 * exists to escape, and several Pi hooks treat any non-`undefined` return as a
 * REPLACEMENT for the thing being hooked (`runner.ts:1031-1033`), so a wrapper
 * that invented a return value on failure could silently rewrite every provider
 * request. The success path's return value is passed through untouched, which
 * is what lets a hook with a real return contract be wrapped too.
 *
 * The write itself is inside a second `try`. If the log cannot be written there
 * is nothing further this code can do, and throwing from the error path would
 * be the original failure all over again.
 */
export function safeHandler<E, R = undefined>(
	where: string,
	fn: (event: E, ctx: ExtensionContext) => R | void | Promise<R | void>,
): (event: E, ctx: ExtensionContext) => Promise<R | undefined> {
	return async (event: E, ctx: ExtensionContext): Promise<R | undefined> => {
		try {
			const result = await fn(event, ctx);
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
				// Swallow: a diagnostics failure must never take the session down.
			}
			return undefined;
		}
	};
}

export default function (pi: ExtensionAPI): void {
	// Retention runs at session start: cheap, deterministic, off the hot path
	// (RESEARCH §10.5). Later plans in this phase register the turn, prose and
	// budget handlers on this same function.
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

	// DIAG-01 / DIAG-07 — the three main-loop provider hooks.
	//
	// `safeHandler` and `noteRowWritten` are passed IN rather than imported by
	// `wire.ts`: this file already imports that module, and an import back the
	// other way would make the pair a cycle. Passing the counter explicitly is
	// also what keeps there being exactly ONE counter, incremented by every
	// append path — a counter only some paths increment reports a number that
	// looks like a measurement and is not.
	registerWireHooks(pi, safeHandler, noteRowWritten);

	// DIAG-04 — the three turn hooks. See the module docstring for why the row
	// is built from these and never from `after_provider_response`.

	pi.on(
		"turn_start",
		safeHandler<TurnStartEvent>("turn_start", (event, ctx) => {
			// A FRESH record, which is also how a stale message from a turn that
			// somehow never ended is cleared: carrying one forward would attribute
			// the previous turn's tokens and cost to this one.
			inFlight = {
				// `timestamp` is `Date.now()` at emit
				// [VERIFIED: pi 0.84.1 dist/core/agent-session.js:448-453], so the
				// subtraction at `turn_end` is a real wall-clock latency. The
				// fallback exists for a synthetic event in a unit harness, not for
				// production.
				startedAt: typeof event.timestamp === "number" ? event.timestamp : Date.now(),
				// The REQUESTED level, recorded here rather than at `turn_end`
				// because that is when it was requested — and because Bedrock never
				// reports a reasoning-token breakdown, so the request is the only
				// thing about thinking a Bedrock row can honestly carry
				// (RESEARCH §5.4, §5.5).
				thinkingLevel: ctx.thinkingLevel,
			};
		}),
	);

	pi.on(
		"message_end",
		safeHandler<MessageEndEvent>("message_end", (event, ctx) => {
			// `message_end` fires for user and toolResult messages too
			// [pi 0.84.1 dist/core/extensions/types.d.ts:573], so the role check is
			// what keeps a tool result from overwriting the turn's real message.
			if (event.message.role !== "assistant") {
				return;
			}

			const turn = inFlight ?? { startedAt: Date.now(), thinkingLevel: ctx.thinkingLevel };
			turn.message = event.message;
			turn.corr = captureCorrelationId();
			inFlight = turn;

			// DIAG-05 — the prose-tool-call effect. The predicate is `prose.ts`;
			// everything from here down is what the harness DOES about it.
			//
			// The active-tool list comes from `pi.getActiveTools()` and is never
			// hardcoded: `isProseToolCall` refuses on an empty list by design
			// (gate 3), so a mis-wired call is a detector that reports 0% rather
			// than one that reports 100% against a generic `\w+\(\{`.
			const activeTools = pi.getActiveTools();
			if (!isProseToolCall(event.message, activeTools)) {
				return;
			}

			// ALONGSIDE `stopReason`, NEVER INSTEAD OF IT. `composeTurnRow` writes
			// both columns, so the row still says the provider stopped cleanly AND
			// that this project judged the turn a prose tool call. RESEARCH §3.3 is
			// explicit that the verdict sits next to the provider's own word: the
			// mapping is an interpretation and the evidence for it must stay
			// readable by someone who disagrees. [threat T-02-09-03]
			turn.event = PROSE_EVENT;

			const sessionId = ctx.sessionManager.getSessionId();
			// The tool the model MEANT to call. This is the column Phase 10 groups
			// by, and it is read here rather than re-derived later because the
			// active-tool list is a live value that may differ by the time anyone
			// reads the log.
			const tool = proseToolCallName(event.message, activeTools);

			if (proseRetriesThisRun >= MAX_PROSE_RETRIES) {
				// A SECOND PROSE RESPONSE IS A SIGNAL, NOT SOMETHING TO KEEP PAYING
				// FOR (RESEARCH §6.6). Against a model that reliably writes prose an
				// uncapped detector is an unbounded spend, and the loop would be
				// invisible: every iteration looks like an ordinary extra turn.
				// [threat T-02-09-02]
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

			// AN IMMEDIATE RECORD, IN ADDITION TO THE VERDICT ON THE TURN ROW. The
			// turn row is written later, by `turn_end`, and this record is what
			// survives if that never happens — a handler that throws there is
			// swallowed by Pi (runner.ts:861-870). It carries no `kind`, exactly
			// like the `session_start` and `diagnostics.error` rows, so it is never
			// counted as a turn: `kind:"turn"` is what a per-turn total sums over.
			writeTurnsRow(ctx.cwd, {
				ts: Date.now(),
				event: PROSE_EVENT,
				tool,
				sessionId,
				corr: turn.corr,
			});

			// `deliverAs` IS MANDATORY HERE. Inside `message_end` the agent is
			// always streaming (`isIdle()` logged `false` in the research probe),
			// and `AgentSession.prompt` throws "Agent is already processing" when
			// no streaming behaviour is given [VERIFIED: pi 0.84.1
			// agent-session.ts:1167-1172]. `followUp` resumes the SAME agent run at
			// the loop's own resumption point [VERIFIED: pi-agent-core
			// agent-loop.ts:262-268], so there is one `agent_end` for the pair and
			// `/session` accounting stays coherent. `steer` would also be drained
			// (agent-loop.ts:259) but means "interrupt", and the stream has already
			// finished — a follow-up is the honest queue.
			pi.sendUserMessage(PROSE_RETRY_PROMPT, { deliverAs: "followUp" });

			// THIS HANDLER RETURNS NOTHING, AND THAT IS A CONTRACT, NOT A STYLE.
			// A returned `{ message }` REPLACES the finalized message, and the
			// replacement must keep the original role
			// [VERIFIED: pi 0.84.1 src/core/extensions/types.ts:1097-1100]; the
			// runner applies it by deleting every key on the live object and
			// `Object.assign`-ing the replacement onto it
			// (`agent-session.ts:710-724`), which the agent loop then reads back
			// immediately (`pi-agent-core agent-loop.ts:350-352`). Diagnostics never
			// replaces a message. The prose retry above is the one thing in this
			// subsystem with a reason to want to, and it deliberately does not: the
			// replacement path is how a regex-scraped argument becomes an executed
			// tool call. See the promotion paragraph in the module docstring.
			// [threats T-02-08-04, T-02-09-04]
		}),
	);

	pi.on(
		"turn_end",
		safeHandler<TurnEndEvent>("turn_end", (event, ctx) => {
			// Taken and cleared FIRST, so an exception below cannot leave a
			// half-consumed accumulator to contaminate the next turn.
			const turn = inFlight;
			inFlight = undefined;

			const sessionId = ctx.sessionManager.getSessionId();
			const message = turn?.message;

			if (message === undefined) {
				// A VISIBLE HOLE, not a skipped append. Zero rows on a turn that
				// really happened is the same picture as a dead instrument, and
				// `rowsWrittenThisSession()` would still count this one — so
				// `/budget` reports a number that matches the file.
				// [threat T-02-08-02]
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
				// `ctx.model` is `Model<any> | undefined`. When it is missing the row
				// is still written — with zero rates and a marker saying so — because
				// a missing row is worse than an honestly-degraded one.
				const model = ctx.model as Model<Api> | undefined;

				writeTurnsRow(
					ctx.cwd,
					composeTurnRow({
						kind: "turn",
						role: SESSION_TURN_ROLE,
						sessionId,
						corr: turn?.corr ?? captureCorrelationId(),
						message,
						model: model ?? degradedModel(message),
						// `startedAt` falls back to now only when `turn_start` never
						// ran, which yields 0 rather than a fabricated duration.
						latencyMs: Date.now() - (turn?.startedAt ?? Date.now()),
						turnIndex: event.turnIndex,
						toolResults: event.toolResults.length,
						thinkingLevel: turn?.thinkingLevel,
						// `composeTurnRow` omits the key when this is undefined, so a
						// healthy row carries no `event` at all.
						//
						// PRECEDENCE, AND WHY THIS WAY ROUND. `event` is one string and
						// two things want it: the degraded-cost marker, and the prose
						// verdict `message_end` stamped on the accumulator. The marker
						// wins, because losing it means a fabricated zero cost enters a
						// Phase 8 spend total with nothing anywhere saying so
						// [threat T-02-08-05]. Losing the prose verdict here costs
						// nothing equivalent: `message_end` already appended a standalone
						// record carrying it, which is exactly the case that record
						// exists for.
						event: model === undefined ? MODEL_UNAVAILABLE_EVENT : turn?.event,
					}),
				);
			}
			// No `return` anywhere in this handler, and none in the two above it.
			// Pi ignores what `turn_start` and `turn_end` return, but the shape is
			// kept identical to `message_end` — where a return value is a
			// REPLACEMENT — so a reader never has to remember which is which.
			// `tests/unit/wire-nonmutating.test.ts` asserts the value, rather than
			// trusting this comment.
		}),
	);

	// DIAG-05 — the retry budget is per agent RUN, so it is reset here.
	//
	// Registered last and fired first: Pi emits `agent_start` before the run's
	// first `turn_start`, and registration order across different events has no
	// bearing on emission order. It sits at the bottom so the whole prose effect
	// reads in one place — the detector and the cap in `message_end` above, the
	// reset here — rather than being spliced into the DIAG-04 block.
	//
	// It goes through `safeHandler` like everything else. A reset that threw and
	// vanished would leave the counter at its cap forever, and the symptom would
	// be a detector that logs `prose_tool_call_retry_exhausted` on every single
	// prose turn and never retries once — a plausible-looking log with no error
	// in it anywhere.
	pi.on(
		"agent_start",
		safeHandler<AgentStartEvent>("agent_start", () => {
			proseRetriesThisRun = 0;
		}),
	);
}
