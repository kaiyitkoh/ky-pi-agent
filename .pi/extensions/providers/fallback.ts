/**
 * ky-pi-agent — PROV-08: a two-hop chain that survives a quota wall, a rate
 * limit and an outage, and refuses to spend a second provider on a 400.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE IS
 * ---------------------------------------------------------------------------
 * One exported function. `callWithFallback(ctx, opts)` walks {@link CHAIN},
 * calls the Phase 2 chokepoint once per hop, and stops on the first message that
 * did not stop with an error — or on the first failure whose class says a second
 * provider cannot help.
 *
 * It registers nothing, hooks nothing and decides nothing about which model
 * should handle a request. `.pi/extensions/providers/index.ts` remains a
 * one-hook extension carrying only plan 03-08's credential classifier; this file
 * is a named-export service module, consumed by Phase 5's router when that
 * exists.
 *
 * SCOPE CAVEAT, PLAINLY. **Routing is Phase 5's job, not this module's.** The
 * chain is a failure path, and the only question it answers is "this attempt
 * failed — is another vendor worth trying?". Which model a request should have
 * gone to in the first place is ROUTE-01..ROUTE-08 and is not decided here, or
 * influenced from here.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CHAIN LIVES IN A FUNCTION AND NOT IN A HOOK
 * ---------------------------------------------------------------------------
 * Two verified facts, and together they close the hook route entirely:
 *
 *   1. The registry facade's completion entry point has **no retry of its own**.
 *      Pi's retry wrapper is called from exactly one place in the whole install
 *      — the compaction path — so a call made through the facade is single-shot
 *      [03-RESEARCH.md §Q4.5, `pi 0.84.1 core/compaction/compaction.ts:450`].
 *   2. A nested invocation fires **no extension events at all**. Pi wires
 *      `before_provider_headers`, `before_provider_request` and
 *      `after_provider_response` into the constructor options of the ONE agent
 *      the session owns [VERIFIED: pi 0.84.1 src/core/sdk.ts:294-360], and a
 *      nested call does not go through that agent — measured live in Phase 2 and
 *      re-proven offline by `tests/integration/call-model.test.ts` case 1.
 *
 * So there is no event a chain could live in, and nothing below the chain that
 * would retry on its behalf.
 *
 * THE THREE REJECTED ALTERNATIVES, WITH THEIR REASONS — recorded so they are not
 * re-derived:
 *
 *   - **`pi.setModel()`** is Phase 5's mode-switch and mutates session state
 *     (ROUTE-02 requires `await ctx.waitForIdle()` before it). Using it for a
 *     per-call failure would leave the whole session parked on the fallback
 *     model after one transient blip — the user's next ten prompts would quietly
 *     go somewhere they did not choose.
 *   - **`before_provider_request`** can replace an outgoing payload and cannot
 *     change which provider is dialled. It is the wrong lever for a question
 *     about vendors.
 *   - **A third-party extension's `fallbackModels`** (`pi-subagents`,
 *     `pi-model-fallback`) is Phase 7's supply-chain decision and out of scope
 *     here. `.planning/research/STACK.md:828` already records the position: an
 *     authored chain around the one instrumented call site is probably the right
 *     end state anyway.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BRANCH IS ON `stopReason` AND THE `try`/`catch` IS STILL THERE
 * ---------------------------------------------------------------------------
 * Both provider failure classes reach the caller as a `stopReason: "error"`
 * MESSAGE rather than as a rejection — an adapter-surfaced failure ends the
 * event stream with an `error` event, and a setup failure is converted to an
 * error message by the lazy stream [both documented at source in
 * `../diagnostics/call-model.ts:233-256`]. So the classification branch reads
 * `stopReason`.
 *
 * The `catch` is kept as well, and is not defensive padding: the chokepoint
 * **rethrows** a rejection from the registry facade itself, and says why —
 * "the caller — not this function — owns the fallback decision"
 * [`../diagnostics/call-model.ts:475-479`]. This module is that caller. It is
 * the only place in the harness where that sentence has an addressee.
 *
 * ---------------------------------------------------------------------------
 * WHAT ADVANCING COSTS, AND THE LIMITS THAT BOUND IT
 * ---------------------------------------------------------------------------
 * Advancing a hop sends the user's prompt, system prompt and tool schemas to a
 * DIFFERENT vendor than the one their request was aimed at. That is a real
 * disclosure and it is bounded four ways, deliberately:
 *
 *   - {@link CHAIN} is a fixed two-entry table with no dynamic membership: no
 *     configuration, no environment variable and no provider response can add a
 *     hop. [threat T-03-10-01]
 *   - a `fatal` class stops the chain outright, so a validation failure, an
 *     authentication failure or an expired credential never reaches a second
 *     vendor. The six credential strings plan 03-08 handles all classify `fatal`
 *     — they match neither of Pi's patterns and none of the quota table — and
 *     the chain test asserts exactly that. [threat T-03-10-02]
 *   - every hop goes through the Phase 2 chokepoint, so every hop leaves a
 *     `kind: "nested"` turns row and its own wire records. A hop the instrument
 *     cannot see is the failure mode DIAG-03 exists to deny, and the lint that
 *     enforces it runs over this file. [threat T-03-10-07]
 *   - the chain adds **no backoff of its own**. Pi's main loop already retries
 *     with exponential backoff (`retry.maxRetries: 3`, `baseDelayMs: 2000`
 *     [CITED: pi 0.84.1 docs/settings.md:136-149]); a second delay layered on
 *     top would multiply wall-clock against a provider that is already known to
 *     be down. [threat T-03-10-04]
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULES
 * ---------------------------------------------------------------------------
 * This directory sits outside `.pi/extensions/diagnostics/`, so the direct
 * completion entry points, the raw-provider routes and the runtime class may not
 * be NAMED here even inside a comment — `tests/unit/chokepoint-lint.test.ts`
 * matches raw source. They are described in prose instead, the way
 * `harness/index.ts:36` describes the tool-registration call. The registry's
 * model LOOKUP is explicitly not banned: the line the lint draws is "reaches a
 * model", not "mentions the registry".
 *
 * Named exports only, and no default export: a sibling module in an extension
 * directory that carries one is reclassified as an entry point by
 * `tests/unit/extension-layout.test.ts` and required to sit at an
 * auto-discovered path.
 */
import type { Api, AssistantMessage } from "@earendil-works/pi-ai";
import { isRetryableAssistantError } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { callModel, type CallModelOptions } from "../diagnostics/call-model.ts";
import {
	CHAIN,
	QUOTA_PATTERN,
	UNAVAILABLE_PATTERN,
	type ChainEntry,
	type FailureClass,
} from "./schema.ts";

/**
 * Everything a chained call needs: the Phase 2 contract minus the model.
 *
 * `model` is removed because the chain supplies it — that is the whole point of
 * the chain, and a caller-supplied model would silently be overwritten on the
 * first hop. Everything else is forwarded UNCHANGED, `signal` included, so
 * pressing Esc cancels a chained call exactly as it cancels a direct one.
 *
 * `role` stays MANDATORY and DELIBERATELY UNDEFAULTED, for the reason the
 * chokepoint states about its own copy: the diagnostics turns row joins on it.
 * Defaulting it here would be worse than defaulting it there — every hop of
 * every fallback would land under one invented role name, and the `/budget`
 * question this instrument exists to answer ("what did the fallback path cost
 * me?") would be unanswerable from the log it wrote.
 *
 * Typed at `Api` rather than a free `TApi` because the chain resolves its own
 * models by id, and a lookup hands back a model whose API is the open union.
 */
export type CallWithFallbackOptions = Omit<CallModelOptions<Api>, "model">;

/**
 * The two fields Pi's retry predicate reads, and nothing else.
 *
 * `isRetryableAssistantError` inspects `stopReason` and `errorMessage` and
 * touches no other property [VERIFIED: pi-ai 0.84.1 dist/utils/retry.js:165-172
 * — `if (message.stopReason !== "error" || !message.errorMessage) return false;`
 * then the two pattern tests against `errorMessage`]. So a probe carrying those
 * two fields gets the same verdict Pi would give the real message.
 *
 * WHY A PROBE AND NOT THE MESSAGE ITSELF. A rejection from the registry facade
 * arrives as a thrown value with no message attached (see {@link callWithFallback}),
 * and classifying a rejection by a different rule than a returned failure is how
 * the same outage advances the chain down one path and stops it down the other.
 * One rule, one input: the provider-controlled text.
 */
function retryProbe(errorText: string): AssistantMessage {
	return { stopReason: "error", errorMessage: errorText } as unknown as AssistantMessage;
}

/**
 * Which of the four classes a failure belongs to, from its text alone.
 *
 * ORDER IS THE RULE, AND IT IS NOT ARBITRARY:
 *
 *   1. **quota first.** Pi reports every quota string as non-retryable, so
 *      asking Pi first would collapse `quota` into `fatal` and the chain would
 *      never advance on the one failure a second provider is most certain to
 *      survive. See {@link QUOTA_PATTERN} for why the harness disagrees with Pi
 *      here on purpose, and only here.
 *   2. **then Pi's own predicate**, unmodified and unduplicated, for the
 *      retryable/fatal split. A fourth local regex over the same strings is how
 *      the harness and Pi end up disagreeing about a string neither author
 *      remembers writing down. [threat T-03-10-03]
 *   3. **then the local availability table**, which subdivides the retryable set
 *      into `unavailable` and `transient`. Both advance; the distinction is
 *      descriptive and exists because PROV-08 names three classes.
 *
 * A failure with NO text is `fatal`. That is the conservative direction and it
 * is chosen deliberately: an unclassifiable failure is not evidence that a
 * second vendor would do better, and advancing on it would forward the whole
 * prompt somewhere on the strength of knowing nothing.
 *
 * Exported so the chain test can assert the classification directly, rather than
 * inferring it from attempt counts alone.
 */
export function classifyFailure(errorText: string): FailureClass {
	if (QUOTA_PATTERN.test(errorText)) {
		return "quota";
	}
	if (!isRetryableAssistantError(retryProbe(errorText))) {
		return "fatal";
	}
	return UNAVAILABLE_PATTERN.test(errorText) ? "unavailable" : "transient";
}

/**
 * The error an unresolved chain entry raises, with the remedy in the message.
 *
 * NEVER A SILENT SKIP. Assumption A7 is that DashScope serves this model under
 * the same id as DeepSeek-direct; if it ever does not, a `continue` here would
 * turn a two-provider chain into a one-provider chain that still reports itself
 * as a chain. The failure would look exactly like "both providers were down",
 * which is the most misleading answer available. [threat T-03-10-05]
 */
function unresolvedEntryError(entry: ChainEntry): Error {
	return new Error(
		`callWithFallback: the chain entry ${entry.provider}/${entry.id} does not resolve in this ` +
			"session's registry, so that hop would be skipped in silence and a chain failure would be " +
			"reported for a chain that was never walked. Either the provider is not configured (add it " +
			"to ~/.pi/agent/models.json from .pi/templates/models-template.json) or the model id has " +
			"been renamed upstream (Assumption A7) — in which case fix CHAIN in " +
			".pi/extensions/providers/schema.ts, do not delete the hop",
	);
}

/**
 * Call the chain: the first hop that answers wins, and a fatal failure stops it.
 *
 * Per entry, in order:
 *   1. resolve the model by provider id and model id — an entry that does not
 *      resolve throws, it is never skipped;
 *   2. call the Phase 2 chokepoint with that model and the forwarded options;
 *   3. return the message unless it stopped with an error;
 *   4. classify the failure. `fatal` returns it as-is without touching a second
 *      provider; `quota`, `transient` and `unavailable` advance immediately,
 *      with no backoff of this module's own;
 *   5. after the last entry, return the last failing message.
 *
 * A rejection is treated by the SAME classification rule and then, if the chain
 * is not advancing, RETHROWN rather than converted into a message. Converting it
 * would hand the caller a synthetic failure that no provider actually produced
 * and would erase the stack that says where it came from; the chokepoint already
 * wrote its turns row before rethrowing, so nothing is lost by letting it
 * through.
 */
export async function callWithFallback(
	ctx: ExtensionContext,
	opts: CallWithFallbackOptions,
): Promise<AssistantMessage> {
	let lastFailure: AssistantMessage | undefined;

	for (const [index, entry] of CHAIN.entries()) {
		const isLast = index === CHAIN.length - 1;

		// The registry's model LOOKUP, which the chokepoint lint deliberately does
		// not ban: it hands back a model description, not a way to call one.
		const model = ctx.modelRegistry.find(entry.provider, entry.id);
		if (!model) {
			throw unresolvedEntryError(entry);
		}

		let message: AssistantMessage;
		try {
			// THE ONE SANCTIONED PATH TO A MODEL outside `diagnostics/`. Every hop is
			// therefore visible to `/budget` as its own row, which is what makes a
			// fallback measurable rather than merely observed. [threat T-03-10-07]
			message = await callModel(ctx, { ...opts, model });
		} catch (error) {
			if (isLast || classifyFailure(String(error)) === "fatal") {
				throw error;
			}
			continue;
		}

		if (message.stopReason !== "error") {
			return message;
		}

		lastFailure = message;

		if (classifyFailure(message.errorMessage ?? "") === "fatal") {
			// STOP. A 400, a 401 or an expired credential fails identically at every
			// vendor, so advancing would disclose the whole prompt to a second one to
			// be rejected a second time. [threat T-03-10-01, T-03-10-02]
			return message;
		}
	}

	// Every hop failed with an advancing class. The last failure is returned
	// rather than a synthesised summary: it is a real message, from a real
	// provider, and the caller can classify it with the same function this
	// module used.
	if (lastFailure === undefined) {
		// Unreachable while CHAIN is non-empty — every path above either returns,
		// throws or assigns. Stated as an error rather than a non-null assertion so
		// an emptied CHAIN says so instead of returning `undefined` as a message.
		throw new Error(
			"callWithFallback: CHAIN is empty, so no provider was attempted. A chain with no " +
				"entries is not a fallback policy; restore CHAIN in .pi/extensions/providers/schema.ts",
		);
	}
	return lastFailure;
}
