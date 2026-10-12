/**
 * The chokepoint: every nested model call goes through `callModel` with a mandatory `role` (the join key for cost queries).
 * Extension hooks do not fire for nested completions (dist/core/sdk.js:225-230), so the per-call callbacks capture instead.
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
import { nextCorrelationId, wireRecord, type WireFieldsFor } from "./wire.ts";

/**
 * The caller's option bag minus the keys this function owns. Distributive (`T extends unknown`):
 * a plain `Omit` over the `Api` union would delete every per-API key (pi-ai src/types.ts:179).
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

/** Zero `Usage`, fresh per call because `calculateCost` mutates it (pi-ai src/models.ts:878-898). */
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
 * arrive as a `stopReason: "error"` message (pi-ai src/utils/event-stream.ts:69-83, src/api/lazy.ts).
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

function appendWire(cwd: string, record: WireRecord): void {
	appendJsonl(cwd, WIRE_LOG_BASE, record, {
		rotateBytes: WIRE_ROTATE_BYTES,
		maxRotated: MAX_ROTATED_FILES,
	});
	noteRowWritten();
}

/**
 * Run one capture with total failure containment: the callbacks run inside a call the provider
 * is waiting on, so a throw would fail or alter the measured request. Same role as `safeHandler`.
 */
function contained(fn: () => void): void {
	try {
		fn();
	} catch {
		// A capture that cannot reach disk must not fail the request it is capturing.
	}
}

/**
 * Compose and append one nested turns row, and count it. NEVER THROWS: this runs after the
 * provider has billed, so a disk error must not replace the returned message.
 */
function recordTurn(cwd: string, input: Parameters<typeof composeTurnRow>[0]): void {
	contained(() => {
		const row: TurnRow = composeTurnRow(input);
		appendJsonl(cwd, TURNS_LOG_BASE, row, {
			rotateBytes: TURNS_ROTATE_BYTES,
			maxRotated: MAX_ROTATED_FILES,
		});
		noteRowWritten();
	});
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

	/** Generic in `K` so `WireFieldsFor<K>` narrows to the arm the `kind` literal selects. */
	function record<K extends WireKind>(kind: K, fields: WireFieldsFor<K>): void {
		appendWire(cwd, wireRecord(kind, { corr, sessionId, role, ...fields }));
	}

	let httpStatus: number | undefined;

	// Spread order is the enforcement: captures come last so a caller-supplied callback cannot suppress them.
	const options = {
		...(opts.api ?? {}),
		signal: opts.signal ?? ctx.signal,
		sessionId,
		transformHeaders: (headers: Record<string, string | null>) => {
			// Contained: a throw here escapes `prepareRequest` and fails the completion.
			contained(() => {
				record("nested.headers", { headers: redactHeaders(headers) });
			});
			// Returned unchanged and outside the containment: `prepareRequest` sends what comes back
						// (model-runtime.ts:590-593), so the redacted map must never be returned.
			return headers;
		},
		onPayload: (payload: unknown) => {
			// `redactDeep` copies, so the live payload stays byte-identical. Contained: a throw kills the request.
			contained(() => {
				record("nested.request", { payload: redactDeep(payload) });
			});
			// Returns nothing: a non-`undefined` return replaces the payload (pi-ai src/types.ts:66-70).
			return undefined;
		},
		onResponse: (response: { status: number; headers: Record<string, string> }) => {
			// Assigned before the capture so the row keeps the status even if the wire record fails.
			httpStatus = response.status;
			contained(() => {
				record("nested.response", {
					status: response.status,
					headers: redactHeaders(response.headers),
				});
			});
		},
		// Double cast: `ApiStreamOptions<TApi>` does not resolve for an unbound `TApi` (pi-ai src/types.ts:179).
	} as unknown as ModelsApiStreamOptions<TApi>;

	// No `finally`: it would append on both paths and double-write, and both `recordTurn` calls are total.
	let message: AssistantMessage;
	try {
		message = await ctx.modelRegistry.complete(
			opts.model,
			{ systemPrompt: opts.systemPrompt, messages: opts.messages, tools: opts.tools },
			options,
		);
	} catch (error) {
		recordTurn(cwd, {
			kind: "nested",
			role,
			sessionId,
			corr,
			message: errorMessageFor(opts.model, error),
			model: opts.model,
			latencyMs: Date.now() - started,
			httpStatus,
		});
		// Rethrown: the caller owns the fallback decision.
		throw error;
	}

	recordTurn(cwd, {
		kind: "nested",
		role,
		sessionId,
		corr,
		message,
		model: opts.model,
		latencyMs: Date.now() - started,
		// Omitted when `onResponse` never fired; a defaulted 200 would claim an unobserved success.
		httpStatus,
	});

	return message;
}
