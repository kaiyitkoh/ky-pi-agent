/**
 * Main-loop wire capture: three provider hooks, redacted at capture, appended to `wire-<date>.jsonl`.
 * Handlers must return `undefined`: a non-`undefined` return replaces the request payload
 * (dist/core/extensions/runner.js:1066-1079). Known limits and the single-request-at-a-time
 * assumption: docs/DIAGNOSTICS.md. Registers hooks only, never a tool.
 */
import type {
	BeforeProviderHeadersEvent,
	BeforeProviderRequestEvent,
	ExtensionAPI,
	ExtensionContext,
	ExtensionEvent,
} from "@earendil-works/pi-coding-agent";

import { appendJsonl } from "./jsonl.ts";
import { redactDeep, redactHeaders } from "./redact.ts";
import {
	MAX_ROTATED_FILES,
	WIRE_LOG_BASE,
	WIRE_ROTATE_BYTES,
	type WireKind,
	type WireRecord,
} from "./schema.ts";

/**
 * The `after_provider_response` event, recovered from the `ExtensionEvent` union because the
 * package root does not re-export it (dist/index.d.ts:7; declared at types.d.ts:518).
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
 * Issue the next id, `<sessionId>#<n>`. One id per logical request: retries reuse the headers hook
 * (docs/extensions.md:676), so no per-attempt id exists to claim.
 */
export function nextCorrelationId(sessionId: string): string {
	lastCorrelationId = `${sessionId}#${nextRequestNumber()}`;
	return lastCorrelationId;
}

/** Last id issued by this module instance (per-instance on purpose); the nested path passes its own. */
export function currentCorrelationId(): string | undefined {
	return lastCorrelationId;
}

/**
 * The payload fields a given {@link WireKind} may carry. Selecting the arm from the `kind` literal
 * makes each arm's own field required and rejects mixed bags at the call site
 * (tests/unit/wire-record-typing.test.ts).
 */
export type WireFieldsFor<K extends WireKind> = K extends `${string}.request`
	? { payload: unknown }
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

/** Register the three main-loop provider hooks. `safeHandler` and `noteRow` are injected to avoid an import cycle. */
export function registerWireHooks(
	pi: ExtensionAPI,
	safeHandler: SafeHandlerFactory,
	noteRow: () => void,
): void {
	function append(cwd: string, record: WireRecord): void {
		appendJsonl(cwd, WIRE_LOG_BASE, record, {
			rotateBytes: WIRE_ROTATE_BYTES,
			maxRotated: MAX_ROTATED_FILES,
		});
		noteRow();
	}

	pi.on(
		"before_provider_headers",
		safeHandler<BeforeProviderHeadersEvent>("before_provider_headers", (event, ctx) => {
			// First hook of the triple, so the id is issued here.
			const sessionId = ctx.sessionManager.getSessionId();
			const corr = nextCorrelationId(sessionId);
			append(
				ctx.cwd,
				wireRecord("main.headers", {
					corr,
					sessionId,
					headers: redactHeaders(event.headers),
				}),
			);
			// Pi ignores this hook's return value (runner.ts:1059-1064); shape kept identical to the others.
		}),
	);

	pi.on(
		"before_provider_request",
		safeHandler<BeforeProviderRequestEvent>("before_provider_request", (event, ctx) => {
			append(
				ctx.cwd,
				wireRecord("main.request", {
					// Passed explicitly so the join key is visible at the call site.
					corr: currentCorrelationId() ?? UNCORRELATED,
					sessionId: ctx.sessionManager.getSessionId(),
					// `redactDeep` copies; the live payload stays byte-identical.
					payload: redactDeep(event.payload),
				}),
			);
			// No return: a non-`undefined` return replaces the payload (runner.ts:1031-1033).
		}),
	);

	pi.on(
		"after_provider_response",
		safeHandler<AfterProviderResponseEvent>("after_provider_response", (event, ctx) => {
			append(
				ctx.cwd,
				wireRecord("main.response", {
					// Explicit, for the reason given above.
					corr: currentCorrelationId() ?? UNCORRELATED,
					sessionId: ctx.sessionManager.getSessionId(),
					status: event.status,
					headers: redactHeaders(event.headers),
				}),
			);
			// Never fires on a provider error (openai-completions.ts:239, :590): derive nothing but `httpStatus` from it.
		}),
	);
}
