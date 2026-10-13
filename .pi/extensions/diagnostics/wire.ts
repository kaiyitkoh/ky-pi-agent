/**
 * Main-loop wire capture: three provider hooks, redacted at capture, appended to `wire-<date>.jsonl`.
 * Handlers must return `undefined`: a non-`undefined` return replaces the request payload
 * (pi 1.1.0 dist/core/extensions/runner.js:1066-1079). Known limits and the single-request-at-a-time
 * assumption: docs/DIAGNOSTICS.md. Registers hooks only, never a tool.
 */
import { createHash } from "node:crypto";

import type {
	BeforeProviderHeadersEvent,
	BeforeProviderRequestEvent,
	ExtensionAPI,
	ExtensionContext,
	ExtensionEvent,
} from "@earendil-works/pi-coding-agent";

import { appendJsonl } from "./jsonl.ts";
import { redactDeep, redactHeaders } from "./redact.ts";
import { WIRE_LOG_BASE, WIRE_TAIL_MESSAGES, type WireKind, type WireRecord } from "./schema.ts";

/**
 * The `after_provider_response` event, recovered from the `ExtensionEvent` union because the
 * package root does not re-export it (dist/index.d.ts; declared in core/extensions/types.d.ts).
 */
type AfterProviderResponseEvent = Extract<ExtensionEvent, { type: "after_provider_response" }>;

/** Shape of `index.ts`'s `safeHandler`, injected because importing it back would be a cycle. */
export type SafeHandlerFactory = <E, R = undefined>(
	where: string,
	fn: (event: E, ctx: ExtensionContext) => R | void | Promise<R | void>,
) => (event: E, ctx: ExtensionContext) => Promise<R | undefined>;

/** `corr` when a record is composed before any id was issued; shared with the turns row so greps match. */
export const UNCORRELATED = "uncorrelated";

/**
 * Process-wide slot for the request counter: jiti can load this module twice, and two counters would
 * both stamp `<sessionId>#1` and silently mis-join wire and turns rows.
 */
const COUNTER_KEY = "__kypiDiagnosticsRequestCounter";

/** Most recent id issued: a single slot, so concurrent provider requests would mis-join (docs/DIAGNOSTICS.md). */
let lastCorrelationId: string | undefined;

function nextRequestNumber(): number {
	const scope = globalThis as Record<string, unknown>;
	const previous = scope[COUNTER_KEY];
	const next = (typeof previous === "number" ? previous : 0) + 1;
	scope[COUNTER_KEY] = next;
	return next;
}

/**
 * Issue the next id, `<sessionId>#<n>`. One id per logical request: provider-level retries reuse the headers
 * resolved once per stream call (pi-ai 1.1.0 models.js:435-436), so no per-attempt id exists to claim.
 */
export function nextCorrelationId(sessionId: string): string {
	lastCorrelationId = `${sessionId}#${nextRequestNumber()}`;
	return lastCorrelationId;
}

/** Last id issued by this module instance (per-instance on purpose); the nested path passes its own. */
export function currentCorrelationId(): string | undefined {
	return lastCorrelationId;
}

/** A request payload as recorded: its `messages` cut to the tail, with the full count and hash beside it. */
export interface CapturedRequest {
	payload: unknown;
	messageCount?: number;
	messagesHash?: string;
}

/**
 * The payload fields a given {@link WireKind} may carry. Selecting the arm from the `kind` literal
 * makes each arm's own field required and rejects mixed bags at the call site
 * (tests/unit/wire-record-typing.test.ts).
 */
export type WireFieldsFor<K extends WireKind> = K extends `${string}.request`
	? CapturedRequest
	: K extends `${string}.headers`
		? { headers: Record<string, string | null> }
		: { status: number; headers?: Record<string, string | null> };

export interface WireAttribution {
	corr?: string;
	sessionId?: string;
	role?: string;
}

/** Compose a wire record, shared with `call-model.ts` so both paths stay byte-compatible. `fields` spreads last, so an explicit `corr` wins. */
export function wireRecord<K extends WireKind>(
	kind: K,
	fields: WireFieldsFor<K> & WireAttribution,
): WireRecord {
	// The cast covers only tsc's inability to place a generic spread in one union member.
	return {
		ts: Date.now(),
		corr: currentCorrelationId() ?? UNCORRELATED,
		kind,
		...fields,
	} as WireRecord;
}

/**
 * Truncated SHA-256 of `JSON.stringify(messages)`, fed one message at a time so the whole history is never held as
 * one string; the bytes match, so digests join with older rows. 64 bits over the whole array reveal no secret in it.
 */
function hashMessages(messages: readonly unknown[]): string {
	const hash = createHash("sha256").update("[");
	messages.forEach((message, i) => {
		// Array JSON renders an unserialisable element as `null`.
		hash.update(`${i > 0 ? "," : ""}${JSON.stringify(message) ?? "null"}`);
	});
	return hash.update("]").digest("hex").slice(0, 16);
}

/**
 * Cut `messages` in a request payload to the last {@link WIRE_TAIL_MESSAGES}, returning the full count and a hash of the
 * full array beside it. A payload without a `messages` array is returned unchanged. Never mutates its argument.
 */
export function boundRequestPayload(raw: unknown): CapturedRequest {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { payload: raw };
	}
	const messages = (raw as { messages?: unknown }).messages;
	if (!Array.isArray(messages)) {
		return { payload: raw };
	}
	const payload = messages.length > WIRE_TAIL_MESSAGES ? { ...raw, messages: messages.slice(-WIRE_TAIL_MESSAGES) } : raw;
	return { payload, messageCount: messages.length, messagesHash: hashMessages(messages) };
}

/** Bounds, then redacts, so the redactor's node budget is spent on the tail that is kept, never on history that is dropped. */
export function captureRequestPayload(raw: unknown): CapturedRequest {
	const bounded = boundRequestPayload(raw);
	return { ...bounded, payload: redactDeep(bounded.payload) };
}

/** Register the three main-loop provider hooks. `safeHandler` is injected to avoid an import cycle. */
export function registerWireHooks(pi: ExtensionAPI, safeHandler: SafeHandlerFactory): void {
	pi.on(
		"before_provider_headers",
		safeHandler<BeforeProviderHeadersEvent>("before_provider_headers", (event, ctx) => {
			// First hook of the triple, so the id is issued here.
			const sessionId = ctx.sessionManager.getSessionId();
			const corr = nextCorrelationId(sessionId);
			appendJsonl(
				ctx.cwd,
				WIRE_LOG_BASE,
				wireRecord("main.headers", { corr, sessionId, headers: redactHeaders(event.headers) }),
			);
			// Pi ignores this hook's return value (core/extensions/runner.ts); shape kept identical to the others.
		}),
	);

	pi.on(
		"before_provider_request",
		safeHandler<BeforeProviderRequestEvent>("before_provider_request", (event, ctx) => {
			appendJsonl(
				ctx.cwd,
				WIRE_LOG_BASE,
				wireRecord("main.request", {
					sessionId: ctx.sessionManager.getSessionId(),
					// Bounding and `redactDeep` both copy; the live payload stays byte-identical.
					...captureRequestPayload(event.payload),
				}),
			);
			// No return: a non-`undefined` return replaces the payload (pi 1.1.0 runner.js:1077-1078).
		}),
	);

	pi.on(
		"after_provider_response",
		safeHandler<AfterProviderResponseEvent>("after_provider_response", (event, ctx) => {
			appendJsonl(
				ctx.cwd,
				WIRE_LOG_BASE,
				wireRecord("main.response", {
					sessionId: ctx.sessionManager.getSessionId(),
					status: event.status,
					headers: redactHeaders(event.headers),
				}),
			);
			// Never fires on a provider error (openai-completions.ts): derive nothing but `httpStatus` from it.
		}),
	);
}
