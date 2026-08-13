/**
 * Main-loop wire capture: the three provider hooks, redacted at capture,
 * appended to `wire-<date>.jsonl`. (DIAG-01, DIAG-07)
 *
 * ---------------------------------------------------------------------------
 * Where this file comes from
 * ---------------------------------------------------------------------------
 * The source is Pi's own bundled reference implementation,
 * `examples/extensions/provider-payload.ts` — fifteen lines that register
 * `before_provider_request` and `after_provider_response` and append
 * `JSON.stringify(event.payload)` to a file under `CONFIG_DIR_NAME`. EXT-06
 * says prefer Pi's bundled examples, and this file is that example plus exactly
 * four deltas:
 *
 *   1. redaction at capture (`redact.ts`), because the dump lands in a working
 *      tree that is a public GitHub repository;
 *   2. rotation and retention (`jsonl.ts`), because the example grows one file
 *      forever;
 *   3. a per-handler `try/catch` (`safeHandler`, injected), because Pi routes a
 *      thrown handler to `emitError` and the failure is invisible;
 *   4. a correlation id, so a `turns-*` row can be tied to the bytes that
 *      produced it.
 *
 * ---------------------------------------------------------------------------
 * THE ONE CONTRACT THAT MUST NOT BE BROKEN
 * ---------------------------------------------------------------------------
 * `before_provider_request` REPLACES the outgoing payload with any non-
 * `undefined` return value:
 *
 *     const handlerResult = await handler(event, ctx);
 *     if (handlerResult !== undefined) { currentPayload = handlerResult; }
 *     [VERIFIED: pi 0.84.1 src/core/extensions/runner.ts:1030-1033;
 *      CITED: docs/extensions.md:680]
 *
 * So an arrow function with an EXPRESSION body — `(event, ctx) =>
 * appendJsonl(...)` — silently rewrites every single request to the string
 * `appendJsonl` happens to return. Every handler below therefore has a block
 * body and no `return` with a value anywhere in it, and
 * `tests/unit/wire-nonmutating.test.ts` asserts the returned value is
 * `undefined` rather than trusting this paragraph.
 *
 * ---------------------------------------------------------------------------
 * Known limits — stated, because a dump that implies completeness is worse
 * than one that admits a hole
 * ---------------------------------------------------------------------------
 * **Bedrock credentials are structurally invisible here.** SigV4 is applied by
 * the AWS SDK's Smithy signing middleware, downstream of everything Pi hands
 * over, and `ProviderRequestOptions.headers` documents that on Bedrock the
 * reserved headers `x-amz-*`, `authorization` and `host` are silently ignored
 * to preserve SigV4 / bearer auth [CITED: pi-ai 0.84.1 src/types.ts:148-153].
 * The inspector therefore never sees a Bedrock credential in
 * `before_provider_headers`. Recording that as a limitation is more honest than
 * implying the dump is complete, and it is why `RB-02-02` is written around the
 * DeepSeek / DashScope bearer path instead. [threat T-02-05-02, accepted]
 *
 * **`after_provider_response` never fires on a provider error.** The adapter's
 * `onResponse` call sits after `await retryProviderRequest(...)`
 * [VERIFIED: pi-ai src/api/openai-completions.ts:239], and a 4xx/5xx throws
 * into the catch at `:590` instead. So the `main.response` record is absent for
 * exactly the requests most worth reading, and NO field of a `turns-*` row may
 * be derived from it — it contributes an optional `httpStatus` and nothing
 * else. (RESEARCH §3.2, Pitfall 3.)
 *
 * **The response body is not reachable.** The hook receives `{ status, headers }`
 * and nothing more [VERIFIED: pi src/core/extensions/types.ts:691-696]. Token
 * counts and content come from the finalized `AssistantMessage` in `message_end`
 * (plan 02-06).
 *
 * **Nested calls are invisible to all three hooks.** They wire into the main
 * agent's `streamFn` only; a `modelRegistry.complete()` fires none of them
 * (RESEARCH §4.4, executed). `call-model.ts` (plan 02-06) restores them per
 * call through `onPayload` / `onResponse` / `transformHeaders`, and shares
 * {@link wireRecord} with this file so the two paths cannot drift.
 *
 * BOUNDARY RULE (BOOT-10). This module registers event hooks only. It never
 * registers a tool, and it does not spell that call even in prose —
 * `tests/unit/contributing-boundary.test.ts` matches the name as a plain
 * substring across every tracked source under `.pi/extensions/`.
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
 * The `after_provider_response` event, recovered from the exported union.
 *
 * Its two siblings (`BeforeProviderHeadersEvent`, `BeforeProviderRequestEvent`)
 * are re-exported from the package root; this one is not — Pi 0.84.1's
 * `dist/index.d.ts:7` type re-export list omits it, while the interface itself
 * is declared at `dist/core/extensions/types.d.ts:518` and IS a member of the
 * exported `ExtensionEvent` union. Extracting it keeps the type tied to Pi's own
 * declaration: re-declaring `{ status: number; headers: Record<string, string> }`
 * locally would compile happily on the day Pi adds or renames a field and
 * silently stop recording it.
 */
type AfterProviderResponseEvent = Extract<ExtensionEvent, { type: "after_provider_response" }>;

/**
 * The shape of `index.ts`'s `safeHandler`, injected rather than imported.
 *
 * `index.ts` imports this module to register the hooks; importing `safeHandler`
 * back out of it would make the two files a cycle. Injection also lets the unit
 * test drive the real registration with its own recording wrapper.
 */
export type SafeHandlerFactory = <E, R = undefined>(
	where: string,
	fn: (event: E, ctx: ExtensionContext) => R | void | Promise<R | void>,
) => (event: E, ctx: ExtensionContext) => Promise<R | undefined>;

/**
 * `corr` used when a record is composed before any correlation id was issued.
 *
 * This should never appear in a real dump: `before_provider_headers` fires
 * first on every request (RESEARCH §2.3) and issues one. Seeing it in a file
 * means the header hook did not run, which is a finding rather than a detail —
 * so it is recorded as a distinct value instead of being silently omitted.
 */
const UNCORRELATED = "uncorrelated";

/**
 * Where the request counter lives, so it is PER PROCESS and not per module
 * instance.
 *
 * A module-level `let` would be per instance, and this module has more than one
 * instance whenever more than one extension reaches it: Pi loads each extension
 * through jiti, which keeps its own module registry, so `.pi/extensions/foo`
 * importing `call-model.ts` and the diagnostics entry point importing `wire.ts`
 * can hold two separate copies of this file in one process. Two copies means two
 * counters both starting at 1, both stamping `<sessionId>#1`, both appending to
 * the same `wire-*.jsonl` — and the correlation id silently stops identifying a
 * request. That is not hypothetical: it was OBSERVED between a test file's
 * import graph and Pi's jiti graph while plan 02-07 was being written.
 *
 * The id is the join key between `wire-*` and `turns-*`. A duplicate one
 * mis-joins a nested call's bytes onto a different call's row, which is worse
 * than having no id at all, because the wrong answer looks like an answer.
 */
const COUNTER_KEY = "__kypiDiagnosticsRequestCounter";

/** The most recently issued correlation id. See {@link currentCorrelationId}. */
let lastCorrelationId: string | undefined;

/** Increment and return the process-wide request counter. */
function nextRequestNumber(): number {
	const scope = globalThis as Record<string, unknown>;
	const previous = scope[COUNTER_KEY];
	const next = (typeof previous === "number" ? previous : 0) + 1;
	scope[COUNTER_KEY] = next;
	return next;
}

/**
 * Issue the next correlation id for `sessionId`, as `<sessionId>#<n>`.
 *
 * WHY THE COUNTER LIVES HERE AND NOT IN A HOOK. `before_provider_headers` fires
 * once per LOGICAL request: `transformHeaders` runs inside
 * `ModelRuntime.prepareRequest` [VERIFIED: pi src/core/model-runtime.ts:590-593]
 * while provider-level retries happen further down, wrapped around the SDK call
 * (`retryProviderRequest`, `openai-completions.ts:245-252`). Pi's docs say it
 * outright: *"Runs once per provider request; retries reuse the same headers
 * rather than re-firing the hook."* [CITED: docs/extensions.md:676]
 *
 * So a PER-ATTEMPT id is not observable on the main loop and must not be
 * claimed. What this counter identifies is one logical request — one
 * headers/request/response triple — and an `attempt` field is deliberately
 * absent rather than fabricated.
 *
 * The counter itself is process-wide rather than module-level; see
 * {@link COUNTER_KEY} for the failure that forces it.
 */
export function nextCorrelationId(sessionId: string): string {
	lastCorrelationId = `${sessionId}#${nextRequestNumber()}`;
	return lastCorrelationId;
}

/**
 * The last id THIS module instance issued, or `undefined` before its first.
 *
 * Deliberately per-instance, unlike the counter. It exists so {@link wireRecord}
 * can stamp a record composed by the same code path that issued the id; a
 * process-wide "last id" would let one extension's record inherit another
 * extension's correlation. Callers who know their own id — the nested path,
 * where the id is issued per call — pass it explicitly instead.
 */
export function currentCorrelationId(): string | undefined {
	return lastCorrelationId;
}

/**
 * Compose a wire record, stamping `ts` and the current `corr`.
 *
 * Shared with `call-model.ts` (plan 02-06) so the main-loop and nested paths
 * produce byte-compatible rows: two composers would drift the first time a
 * field is added to one of them.
 *
 * `fields` is spread last, so a caller that knows its own correlation id — the
 * nested path, where the id is issued per call rather than by a hook — can
 * override the stamp.
 */
export function wireRecord(kind: WireKind, fields: Partial<WireRecord>): WireRecord {
	// The cast is the price of the plan's signature. `Partial<WireRecord>`
	// distributes over the union, so TypeScript cannot prove the spread lands in
	// one arm; the union in `schema.ts` still rejects a caller that passes, say,
	// both a `payload` and a `status` in `fields`.
	return {
		ts: Date.now(),
		corr: currentCorrelationId() ?? UNCORRELATED,
		kind,
		...fields,
	} as WireRecord;
}

/**
 * Register the three main-loop provider hooks.
 *
 * `safeHandler` and `noteRow` are injected from `index.ts` rather than imported
 * (see {@link SafeHandlerFactory}). `noteRow` is not optional and has no
 * default: a rows-written counter that only some append paths increment reports
 * a number that looks like a measurement and is not (02-03's rule).
 */
export function registerWireHooks(
	pi: ExtensionAPI,
	safeHandler: SafeHandlerFactory,
	noteRow: () => void,
): void {
	/** Append one wire record and count it. */
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
			// First hook of the three (RESEARCH §2.3), so this is where the id for
			// the whole triple is issued.
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
			// Nothing is mutated. Pi ignores this hook's return value
			// (runner.ts:1059-1064), but the shape is kept identical to the other
			// two so a reader never has to remember which one is which.
		}),
	);

	pi.on(
		"before_provider_request",
		safeHandler<BeforeProviderRequestEvent>("before_provider_request", (event, ctx) => {
			append(
				ctx.cwd,
				wireRecord("main.request", {
					sessionId: ctx.sessionManager.getSessionId(),
					// `redactDeep` returns a NEW structure; the live payload is never
					// touched, so what the provider receives is byte-identical.
					payload: redactDeep(event.payload),
				}),
			);
			// NO return. A non-`undefined` return replaces the payload for later
			// handlers AND for the actual request
			// [VERIFIED: pi src/core/extensions/runner.ts:1031-1033], so an arrow
			// function with an expression body here would silently rewrite every
			// request the harness ever makes. [threat T-02-05-03]
		}),
	);

	pi.on(
		"after_provider_response",
		safeHandler<AfterProviderResponseEvent>("after_provider_response", (event, ctx) => {
			append(
				ctx.cwd,
				wireRecord("main.response", {
					sessionId: ctx.sessionManager.getSessionId(),
					status: event.status,
					headers: redactHeaders(event.headers),
				}),
			);
			// This hook NEVER fires on a provider error: `onResponse` sits after the
			// retry wrapper [VERIFIED: pi-ai src/api/openai-completions.ts:239] and a
			// 4xx/5xx throws into the catch at `:590`. No field of a turns row may be
			// derived from it — it contributes an optional `httpStatus` only.
		}),
	);
}
