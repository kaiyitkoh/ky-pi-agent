/**
 * THE CHOKEPOINT: every nested model invocation in this harness goes through
 * `callModel`, and nothing else reaches the model API directly. (DIAG-02)
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 * ---------------------------------------------------------------------------
 * This is the only file in the repository permitted to reach the model API
 * directly. An advisor call in Phase 5, a reviewer call in Phase 8, a
 * summariser, a capability probe — each one calls this function, passes a
 * `role`, and is measured. `tests/unit/chokepoint-lint.test.ts` fails the build
 * when any other file under `.pi/extensions/` spells one of the bypass routes,
 * and the exemption is by DIRECTORY (`.pi/extensions/diagnostics/`) rather than
 * by filename, so this file may name the call it wraps and its siblings may
 * describe it in prose.
 *
 * `role` is mandatory for one reason: it is the join key. A `wire-*` record and
 * a `turns-*` row share a correlation id, and the row's `role` is what turns a
 * pile of nested calls into the answer to "was `/max` worth it for the
 * reviewer?". A nested call with no role is a cost with no owner.
 *
 * ---------------------------------------------------------------------------
 * THE VERIFIED TRAP — extension hooks are blind here
 * ---------------------------------------------------------------------------
 * Pi wires `before_provider_headers`, `before_provider_request` and
 * `after_provider_response` into the constructor options of the ONE `Agent`
 * instance the session owns [VERIFIED: pi 0.84.1 src/core/sdk.ts:294-360]. A
 * nested `ModelRegistry` completion does not go through that agent, so it fires
 * none of them.
 *
 * That is executed fact, not inference. A live `createAgentSession` with a
 * user-scope extension logging all three hooks produced a full triple for the
 * main-loop turn and, for the nested call that followed, **no log file at all —
 * the extension's file was never even created** [VERIFIED: executed 2026-08-13,
 * node v24.16.0, Pi 0.84.1 — 02-RESEARCH.md §4.4]. The same run confirmed the
 * three per-call callbacks below are the complete replacement: `onPayload` saw
 * the body, `onResponse` saw `{status: 200}`, `transformHeaders` saw the header
 * map.
 *
 * `transformHeaders` is available on a completion at all because
 * `ModelRegistry.complete` takes `ModelsApiStreamOptions<TApi>`, which is
 * `ApiStreamOptions<TApi> & ModelsRequestTransforms`
 * [VERIFIED: pi-ai 0.84.1 src/models.ts:78-83; pi src/core/model-registry.ts:101-107].
 * `ModelRuntime.prepareRequest` destructures it out and applies it to the merged
 * auth+caller headers [VERIFIED: pi src/core/model-runtime.ts:590-593]. Without
 * it the nested path would satisfy two of DIAG-01's three hooks and quietly
 * report itself complete.
 *
 * THE TWO CALLBACK CONTRACTS, because breaking either alters the real request:
 *   - `onPayload` returns `undefined`. A non-`undefined` return REPLACES the
 *     outgoing payload [VERIFIED: pi-ai src/types.ts:66-70 — "Return undefined
 *     to keep the payload unchanged"].
 *   - `transformHeaders` returns its argument unchanged. It is a transform, not
 *     an observer; whatever it returns is what gets signed and sent.
 * Both are block-bodied for the same reason `wire.ts`'s handlers are: an
 * expression-bodied arrow returns whatever `appendJsonl` returned, which is an
 * absolute file path.
 *
 * WHY THE COST IS RECOMPUTED. The row's `cost` is not copied from
 * `usage.cost` — `composeTurnRow` (`turns.ts`) recomputes it with
 * `calculateCost` on an isolated copy. Real adapters have already called it and
 * it is idempotent [VERIFIED: pi-ai src/models.ts:878-898], but `fauxProvider`
 * hardcodes `usage.cost` to all zeros [VERIFIED: pi-ai src/providers/faux.ts:256-266],
 * and the same executed run above showed the nested `usage.cost` coming back
 * `{total: 0}` until `calculateCost` was applied. Without the defensive
 * recompute every offline cost assertion in this repo is `0 === 0`.
 *
 * ---------------------------------------------------------------------------
 * SCOPE CAVEAT, STATED RATHER THAN OVERCLAIMED
 * ---------------------------------------------------------------------------
 * The build gate is a regex over committed text. These routes reach a model
 * without passing through this function and the gate cannot close them:
 *
 *   1. `ModelRegistry.getProvider(id)` and `getRegisteredNativeProvider(name)`
 *      hand back a `Provider` whose `.stream()` / `.streamSimple()` bypass
 *      everything [pi src/core/model-registry.ts:96-98, 143-145]. The gate bans
 *      the two accessor names; it cannot ban holding the object.
 *   2. The model runtime class is a public export of the package
 *      [pi src/index.ts:184], so it can be constructed directly. The gate bans
 *      the bare identifier, which a rename defeats.
 *   3. `@earendil-works/pi-ai` exposes `./api/*` subpaths, so an adapter's
 *      `stream` can be deep-imported outright. The gate bans that import
 *      specifier, which a dynamic `import()` of a computed string defeats.
 *   4. String-built property access (`ctx["model" + "Registry"]`), a
 *      destructured-then-renamed registry, and `eval` defeat any grep by
 *      construction.
 *   5. A COMPOSED THIRD-PARTY EXTENSION (Phase 7) is not under
 *      `.pi/extensions/` at all, so it is outside the scanned set entirely.
 *   6. `pi.registerProvider` with a hand-written `streamSimple` that calls a
 *      real endpoint is a virtual provider ARCHITECTURE.md keeps as a
 *      deliberate escape hatch. It is the realistic future gap.
 *
 * This is the same honest-limits posture SAFE-15 requires of the bash guard: a
 * control that names what it does not cover is a control; one that implies
 * completeness is a liability. `docs/DIAGNOSTICS.md` (plan 02-11) repeats this
 * list. [threat T-02-07-04, accepted]
 *
 * ---------------------------------------------------------------------------
 * IMPORT CONCENTRATION
 * ---------------------------------------------------------------------------
 * `@earendil-works/pi-ai`'s root entrypoint has an announced future removal, so
 * only `schema.ts`, `turns.ts` and this file name it. Everything here is
 * type-only and fully erased; the one pi-ai VALUE the subsystem needs
 * (`calculateCost`) lives in `turns.ts`.
 *
 * BOUNDARY RULE (BOOT-10). This module registers nothing. It never registers a
 * tool, and it does not spell that call even in prose —
 * `tests/unit/contributing-boundary.test.ts` matches the name as a plain
 * substring across every tracked source under `.pi/extensions/`.
 */
import type {
	Api,
	AssistantMessage,
	Message,
	Model,
	ModelsApiStreamOptions,
	Tool,
	Usage,
} from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { noteRowWritten } from "./index.ts";
import { appendJsonl } from "./jsonl.ts";
import { redactDeep, redactHeaders, redactString } from "./redact.ts";
import {
	MAX_ROTATED_FILES,
	TURNS_LOG_BASE,
	TURNS_ROTATE_BYTES,
	WIRE_LOG_BASE,
	WIRE_ROTATE_BYTES,
	type TurnRow,
	type WireKind,
	type WireRecord,
} from "./schema.ts";
import { composeTurnRow } from "./turns.ts";
import { nextCorrelationId, wireRecord } from "./wire.ts";

/**
 * Everything a nested invocation needs. THIS IS A CROSS-PHASE CONTRACT.
 *
 * Phases 5 (ROUTE-04, GATE-09) and 8 import this interface. It carries payload,
 * response AND header capture from day one precisely so neither phase has to
 * widen it later: a signature that grows is a signature every caller has to be
 * revisited for. [02-RESEARCH.md §4.6]
 */
export interface CallModelOptions<TApi extends Api> {
	/**
	 * The executor this call runs as: `"advisor"`, `"reviewer"`, `"summariser"`, …
	 *
	 * MANDATORY, and deliberately not defaulted. See the join-key paragraph in
	 * the module docstring.
	 */
	role: string;
	model: Model<TApi>;
	systemPrompt?: string;
	messages: Message[];
	tools?: Tool[];
	/**
	 * Per-API request options: `reasoningEffort`, `thinkingEnabled`,
	 * `thinkingBudgetTokens`, `toolChoice`, `maxTokens`, `temperature`, …
	 *
	 * The four capture-and-lifecycle keys are `Omit`ted rather than merely
	 * overwritten below, so a caller that tries to supply its own `onPayload`
	 * gets a compile error instead of silently losing its callback to the spread
	 * order. `signal` is omitted too because it has its own field.
	 */
	api?: Omit<
		ModelsApiStreamOptions<TApi>,
		"onPayload" | "onResponse" | "transformHeaders" | "signal"
	>;
	/**
	 * Defaults to `ctx.signal`, so pressing Esc cancels nested work too.
	 *
	 * A nested call that ignores the abort signal keeps burning tokens after the
	 * user has visibly stopped the turn. [threat T-02-07-06]
	 */
	signal?: AbortSignal;
}

/**
 * A zero `Usage`, for the row a THROWN provider error still has to produce.
 *
 * Fresh object per call: `calculateCost` mutates `usage.cost` in place
 * [VERIFIED: pi-ai src/models.ts:878-898], so a shared constant would be
 * corrupted by the first error row that reached it. Every count is zero because
 * no count was reported — which is a fact, unlike a guess.
 */
function zeroUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

/**
 * Synthesise the finalized message a thrown provider error never produced.
 *
 * `ModelRegistry.complete` resolves with a `stopReason: "error"` message for a
 * failure the ADAPTER surfaced — the event stream's final result is the error
 * message itself [VERIFIED: pi-ai src/utils/event-stream.ts:69-83]. But it
 * THROWS for a failure raised before the stream exists: an unknown provider or
 * unresolved auth both throw out of `prepareRequest`
 * [VERIFIED: pi src/core/model-runtime.ts:582, :588]. Those are exactly the
 * calls worth recording, and without this the measurement would be lost on
 * precisely the failures a reader goes looking for.
 *
 * The text is redacted here rather than only in `composeTurnRow`, so no
 * unredacted string is ever held on a row this function composes. `redactString`
 * is idempotent over its own `[redacted:N chars]` placeholder, so the second
 * pass changes nothing.
 */
function errorMessageFor<TApi extends Api>(model: Model<TApi>, error: unknown): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: zeroUsage(),
		stopReason: "error",
		errorMessage: redactString(String(error)),
		timestamp: Date.now(),
	};
}

/** Append one wire record for the nested path and count it. */
function appendWire(cwd: string, record: WireRecord): void {
	appendJsonl(cwd, WIRE_LOG_BASE, record, {
		rotateBytes: WIRE_ROTATE_BYTES,
		maxRotated: MAX_ROTATED_FILES,
	});
	noteRowWritten();
}

/** Append one turns row for the nested path and count it. */
function appendTurn(cwd: string, row: TurnRow): void {
	appendJsonl(cwd, TURNS_LOG_BASE, row, {
		rotateBytes: TURNS_ROTATE_BYTES,
		maxRotated: MAX_ROTATED_FILES,
	});
	noteRowWritten();
}

/**
 * Invoke a model outside the main agent loop, fully instrumented.
 *
 * Produces four records under one correlation id: `nested.headers`,
 * `nested.request` and `nested.response` in `wire-*.jsonl`, and one
 * `kind: "nested"` row in `turns-*.jsonl`. The turns row is written on BOTH the
 * success and the failure path — a thrown error is rethrown to the caller
 * afterwards, because the caller decides what to do about it and the instrument
 * decides nothing, but the measurement is never lost.
 *
 * The correlation id is issued HERE, explicitly, and passed to every record.
 * `wireRecord` otherwise stamps `currentCorrelationId()`, and the main loop may
 * have issued one in between — which would attribute this call's bytes to a
 * different request. (02-05's note, applied.)
 */
export async function callModel<TApi extends Api>(
	ctx: ExtensionContext,
	opts: CallModelOptions<TApi>,
): Promise<AssistantMessage> {
	const started = Date.now();
	const cwd = ctx.cwd;
	const sessionId = ctx.sessionManager.getSessionId();
	const corr = nextCorrelationId(sessionId);
	const role = opts.role;

	/** Compose and append one nested wire record under this call's own `corr`. */
	function record(kind: WireKind, fields: Partial<WireRecord>): void {
		appendWire(cwd, wireRecord(kind, { corr, sessionId, role, ...fields }));
	}

	/** Set by `onResponse`. Stays `undefined` when no HTTP response was seen. */
	let httpStatus: number | undefined;

	const options = {
		...(opts.api ?? {}),
		signal: opts.signal ?? ctx.signal,
		sessionId,
		transformHeaders: (headers: Record<string, string | null>) => {
			record("nested.headers", { headers: redactHeaders(headers) });
			// RETURNED UNCHANGED. This is a transform: `prepareRequest` uses what
			// comes back as the real request's headers
			// [VERIFIED: pi src/core/model-runtime.ts:590-593]. Returning the
			// redacted map would send `[redacted:N chars]` as the bearer token.
			return headers;
		},
		onPayload: (payload: unknown) => {
			// `redactDeep` returns a NEW structure and never touches the live
			// payload, so what the provider receives stays byte-identical.
			record("nested.request", { payload: redactDeep(payload) });
			// NO value returned. A non-`undefined` return REPLACES the outgoing
			// payload [VERIFIED: pi-ai src/types.ts:66-70]. [threat T-02-07-03]
			return undefined;
		},
		onResponse: (response: { status: number; headers: Record<string, string> }) => {
			httpStatus = response.status;
			record("nested.response", {
				status: response.status,
				headers: redactHeaders(response.headers),
			});
		},
		// The double cast is unavoidable, and it is not a shrug. `ApiStreamOptions<TApi>`
		// is a conditional type that does not resolve for an unbound `TApi`
		// [pi-ai src/types.ts:179], so tsc cannot prove any object literal is
		// comparable to it and rejects even the single-step cast (TS2352). The
		// checking that matters happens on `CallModelOptions.api`, which IS typed as
		// the `Omit` of this same type: a caller passing `reasoningEfort` is a
		// compile error at the call site, which is where a human can act on it.
	} as unknown as ModelsApiStreamOptions<TApi>;

	try {
		const message = await ctx.modelRegistry.complete(
			opts.model,
			{ systemPrompt: opts.systemPrompt, messages: opts.messages, tools: opts.tools },
			options,
		);

		appendTurn(
			cwd,
			composeTurnRow({
				kind: "nested",
				role,
				sessionId,
				corr,
				message,
				model: opts.model,
				latencyMs: Date.now() - started,
				// Omitted when `onResponse` never fired. `composeTurnRow` leaves the
				// key off rather than defaulting it to 200: a defaulted status would
				// claim a success that was never observed.
				httpStatus,
			}),
		);

		return message;
	} catch (error) {
		appendTurn(
			cwd,
			composeTurnRow({
				kind: "nested",
				role,
				sessionId,
				corr,
				message: errorMessageFor(opts.model, error),
				model: opts.model,
				latencyMs: Date.now() - started,
				httpStatus,
			}),
		);
		// Rethrown deliberately. Swallowing it would make the instrument change the
		// behaviour of the thing it measures, and the caller — not this function —
		// owns the fallback decision.
		throw error;
	}
}
