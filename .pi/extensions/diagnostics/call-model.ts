/**
 * The chokepoint: every nested model call goes through `callModel` with a mandatory `role` (the join key for cost queries).
 * Extension hooks do not fire for nested completions (dist/core/sdk.js), so the per-call callbacks capture instead.
 * Routes the build gate cannot close: docs/DIAGNOSTICS.md. Registers nothing, never a tool.
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

import { appendJsonl } from "./jsonl.ts";
import { redactHeaders, redactString } from "./redact.ts";
import { TURNS_LOG_BASE, WIRE_LOG_BASE, type WireKind } from "./schema.ts";
import { composeTurnRow } from "./turns.ts";
import { captureRequestPayload, nextCorrelationId, wireRecord, type WireFieldsFor } from "./wire.ts";

/**
 * The caller's option bag minus the keys this function owns. Distributive (`T extends unknown`):
 * a plain `Omit` over the `Api` union would delete every per-API key (pi-ai src/types.ts#ApiStreamOptions).
 * Advisory only for `Model<Api>`; the spread order at the call site is the enforcement.
 */
type WithoutCaptures<T> = T extends unknown
	? Omit<T, "onPayload" | "onResponse" | "transformHeaders" | "signal">
	: never;

/** Everything a nested invocation needs; imported across subsystems, so widen it rather than reshape it. */
export interface CallModelOptions<TApi extends Api> {
	/** The executor this call runs as, e.g. `"advisor"`. Mandatory: it is the join key. */
	role: string;
	model: Model<TApi>;
	systemPrompt?: string;
	messages: Message[];
	tools?: Tool[];
	/** Per-API request options. The capture keys are omitted from the type; the spread order holds the line. */
	api?: WithoutCaptures<ModelsApiStreamOptions<TApi>>;
	/** Defaults to `ctx.signal` so Esc also cancels nested work. */
	signal?: AbortSignal;
}

/** Zero `Usage`, fresh per call because `calculateCost` mutates it (pi-ai src/models.ts#calculateCost). */
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
 * Synthesise the message a rejected completion never produced. Rarely fires: failures normally
 * arrive as a `stopReason: "error"` message (pi-ai src/utils/event-stream.ts, src/api/lazy.ts).
 * Text is redacted here so no unredacted string sits on a row.
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

/**
 * Run one capture with total failure containment. NEVER THROWS: the callbacks run inside a call the
 * provider is waiting on, so a throw would fail or alter the measured request. Same role as `safeHandler`.
 */
function contained(fn: () => void): void {
	try {
		fn();
	} catch {
		// A capture that cannot reach disk must not fail the request it is capturing.
	}
}

/**
 * Invoke a model outside the main loop, fully instrumented. Writes `nested.headers`, `nested.request`
 * and `nested.response` wire records plus one `kind: "nested"` turns row, on success and failure alike.
 * A record that cannot be written is dropped and the request proceeds; errors are rethrown to the caller.
 * The correlation id is issued here so the main loop cannot interleave its own.
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

	/** Generic in `K` so `WireFieldsFor<K>` narrows to the arm the `kind` literal selects. Fields are built inside the containment. */
	function record<K extends WireKind>(kind: K, fields: () => WireFieldsFor<K>): void {
		contained(() => {
			appendJsonl(cwd, WIRE_LOG_BASE, wireRecord(kind, { corr, sessionId, role, ...fields() }));
		});
	}

	let httpStatus: number | undefined;

	/**
	 * Append the nested turns row. NEVER THROWS: the provider has billed, so a disk error must not replace the message.
	 * The message is built inside the containment, since `String(error)` can throw and would mask the provider error.
	 */
	function recordNested(message: () => AssistantMessage): void {
		// `httpStatus` stays omitted when `onResponse` never fired; a defaulted 200 would claim an unobserved success.
		const latencyMs = Date.now() - started;
		contained(() => {
			const row = { kind: "nested", role, sessionId, corr, message: message(), model: opts.model, latencyMs, httpStatus } as const;
			appendJsonl(cwd, TURNS_LOG_BASE, composeTurnRow(row));
		});
	}

	// Spread order is the enforcement: captures come last so a caller-supplied callback cannot suppress them.
	const options = {
		...(opts.api ?? {}),
		signal: opts.signal ?? ctx.signal,
		sessionId,
		transformHeaders: (headers: Record<string, string | null>) => {
			// Contained: a throw here escapes `prepareRequest` and fails the completion.
			record("nested.headers", () => ({ headers: redactHeaders(headers) }));
			// Returned unchanged and outside the containment: `prepareRequest` sends what comes back
			// (core/model-runtime.ts), so the redacted map must never be returned.
			return headers;
		},
		onPayload: (payload: unknown) => {
			// Bounding and `redactDeep` both copy, so the live payload stays byte-identical. Contained: a throw kills the request.
			record("nested.request", () => captureRequestPayload(payload));
			// Returns nothing: a non-`undefined` return replaces the payload (pi 1.1.0 runner.js:1077-1078).
			return undefined;
		},
		onResponse: (response: { status: number; headers: Record<string, string> }) => {
			// Assigned before the capture so the row keeps the status even if the wire record fails.
			httpStatus = response.status;
			record("nested.response", () => ({ status: response.status, headers: redactHeaders(response.headers) }));
		},
		// Double cast: `ApiStreamOptions<TApi>` does not resolve for an unbound `TApi` (pi-ai src/types.ts#ApiStreamOptions).
	} as unknown as ModelsApiStreamOptions<TApi>;

	// No `finally`: it would append on both paths and double-write, and `recordNested` is total.
	let message: AssistantMessage;
	try {
		message = await ctx.modelRegistry.complete(
			opts.model,
			{ systemPrompt: opts.systemPrompt, messages: opts.messages, tools: opts.tools },
			options,
		);
	} catch (error) {
		recordNested(() => errorMessageFor(opts.model, error));
		// Rethrown: the caller owns the fallback decision.
		throw error;
	}
	recordNested(() => message);
	return message;
}
