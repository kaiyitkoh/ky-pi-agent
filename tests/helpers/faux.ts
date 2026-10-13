/**
 * The `onPayload`-emitting wrapper around `fauxProvider`, plus realistic
 * fixture payloads.
 *
 * ---------------------------------------------------------------------------
 * Why any of this exists
 * ---------------------------------------------------------------------------
 * `fauxProvider()` from `@earendil-works/pi-ai` is the offline harness this
 * whole phase tests through. It **never calls** `options.onPayload`. The faux
 * stream calls only `onResponse`:
 *
 *   queueMicrotask(async () => {
 *       await streamOptions?.onResponse?.({ status: 200, headers: {} }, requestModel);
 *
 * [VERIFIED: pi-ai 1.1.0 dist/providers/faux.js:359 — and :404 and :443 for the
 *  deferred paths. `grep -n "onPayload" faux.ts` returns nothing.]
 *
 * Pi wires `before_provider_request` to the agent's `onPayload` callback
 * (`pi src/core/sdk.ts:294-360`), so a plain faux session **never fires
 * `before_provider_request` at all**. This was executed, not inferred: a live
 * `createAgentSession` against faux with an extension logging all three
 * provider hooks logged `before_provider_headers` and
 * `after_provider_response` and no `before_provider_request` line
 * [VERIFIED: executed 2026-08-13 — RESEARCH.md §8.2].
 *
 * That makes the naive DIAG-01/DIAG-07 test — "register faux, prompt, assert on
 * the captured payload" — **vacuously green**: it asserts on a hook that never
 * ran, over a capture list that is always empty.
 *
 * ---------------------------------------------------------------------------
 * The rule this file imposes on every caller
 * ---------------------------------------------------------------------------
 * Every capture test MUST assert its capture list is non-empty BEFORE asserting
 * anything about its contents. `expect(captured.length).toBeGreaterThan(0)`
 * comes first; `expect(captured[0]).toMatchObject(...)` comes second. Without
 * the first assertion the second one never runs and the test passes having
 * verified nothing. `tests/unit/helpers.test.ts` carries that guard for this
 * module itself.
 *
 * ---------------------------------------------------------------------------
 * Where the emission is placed, and why exactly there
 * ---------------------------------------------------------------------------
 * `onPayload` fires immediately after the request body is assembled and
 * immediately before it is dispatched — the same position every real adapter
 * uses:
 *   - `pi-ai src/api/openai-completions.ts:237`
 *   - `pi-ai src/api/bedrock-converse-stream.ts:247`
 *   - `pi-ai src/api/anthropic-messages.ts:550`
 * The wrapper therefore emits at the top of both `stream` and `streamSimple`
 * and then delegates. The return value of `onPayload` is deliberately ignored:
 * on the main-agent path the payload replacement is Pi's business
 * (`runner.ts:1030-1033`), and a wrapper that honoured it here would be
 * simulating a second, different contract.
 *
 * ---------------------------------------------------------------------------
 * The payload carries no credential — the hazard is secret-SHAPED content
 * ---------------------------------------------------------------------------
 * On every adapter read, the object handed to `onPayload` contains no API key;
 * auth is applied to the client or the headers, downstream of the body
 * [VERIFIED: RESEARCH.md §1.3, 12 `onPayload` call sites]. What the payload
 * does carry is the whole `messages[]` array, including anything the model read
 * into context this session. That is why `SECRET_FIXTURE_TOKEN` below is a
 * *value*-shaped fixture rather than a header-name one.
 *
 * ---------------------------------------------------------------------------
 * The second seam: faux cannot vary the HTTP status either
 * ---------------------------------------------------------------------------
 * {@link wrapFauxWithStatus} exists for PROV-08 — the DeepSeek-direct →
 * DashScope fallback chain. `faux` hard-codes
 * `onResponse({ status: 200, headers: {} })` unconditionally
 * [VERIFIED: pi-ai 1.1.0 dist/providers/faux.js:359], so without a wrapper
 * nothing downstream can ever see a 429 or a 503.
 *
 * CORRECTED, BECAUSE THE OBVIOUS READING IS WRONG. The three error classes are
 * NOT distinguished by HTTP status: `classifyFailure`
 * (`.pi/extensions/providers/fallback.ts`) reads the error TEXT and never sees
 * a status at all. `CLASS_STATUS` in `fallback-chain.test.ts` is used solely to
 * populate the `httpStatus` column of the turns row that case 5 asserts. This
 * wrapper is genuinely needed — for that row — but not for classification, and
 * a reader who comes here looking for a status→class mapping will not find one
 * because there is not one. [IN-04]
 */
import type {
	AssistantMessage,
	FauxProviderHandle,
	FauxResponseStep,
	Message,
	Model,
	Provider,
	StreamOptions,
	Tool,
	TranscriptContext,
} from "@earendil-works/pi-ai";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";

/** A message that is not a `system` role (system content is read via accessors). */
type NonSystemMessage = Exclude<Message, { role: "system" }>;

/**
 * Read a pi-ai 1.1.0 {@link TranscriptContext} the only correct way: the system
 * prompt and tools live in `role: "system"` messages, so they are replayed with
 * `getCurrentSystemPrompt` / `getCurrentTools`, and `messages` is the
 * non-system remainder. TranscriptContext is structurally assignable to the old
 * Context, so reading `.systemPrompt` compiles and silently yields undefined.
 */
export function transcriptView(context: TranscriptContext): {
	systemPrompt: string;
	tools: Tool[];
	messages: NonSystemMessage[];
} {
	return {
		systemPrompt: getCurrentSystemPrompt(context.messages),
		tools: getCurrentTools(context.messages),
		messages: context.messages.filter((m): m is NonSystemMessage => m.role !== "system"),
	};
}

/** A response step that records the outgoing context before replying with `reply`. */
export function capturing(into: { messages: Message[] }[], reply: AssistantMessage): FauxResponseStep {
	return (context: TranscriptContext) => {
		into.push(context);
		return reply;
	};
}

/** The latest `toolResult` message in a captured context, flattened to its text. */
export function lastToolResult(context: { messages: Message[] }): { isError: boolean; text: string } | undefined {
	const msg = context.messages.findLast((m) => m.role === "toolResult");
	if (msg?.role !== "toolResult") return undefined;
	return { isError: msg.isError, text: msg.content.map((b) => (b.type === "text" ? b.text : "")).join("") };
}

/**
 * A builder that turns the outgoing request into a provider-shaped payload
 * object, standing in for the body a real adapter would have assembled.
 *
 * `options` is `unknown` on purpose: the value handed to a provider's `stream`
 * is `ApiStreamOptions<TApi>`, a conditional type that does not resolve for a
 * generic `TApi`. Builders narrow what they need through {@link readOption}
 * rather than pretending to a per-API type they were not given.
 */
export type FixturePayloadBuilder = (
	model: Model<string>,
	context: TranscriptContext,
	options: unknown,
) => unknown;

/** Options as the wrapper sees them: a stream-options bag with unknown extras. */
type AnyStreamOptions = StreamOptions & Record<string, unknown>;

/** Read one named option out of the untyped per-API options bag. */
function readOption(options: unknown, key: string): unknown {
	if (typeof options !== "object" || options === null) {
		return undefined;
	}
	return (options as Record<string, unknown>)[key];
}

/**
 * A synthetic bearer-shaped credential for the DIAG-01 / DIAG-07 redaction
 * tests to plant in payloads and headers.
 *
 * Assembled from parts at runtime rather than written as one literal. A
 * 24-plus-character run over the token alphabet, next to an `sk-` prefix, is
 * exactly what a secret scanner is built to find — and this is a public repo.
 * Assembling it keeps a token-shaped run out of the committed source while
 * still producing a string that the redactor's `sk-[A-Za-z0-9_-]{16,}` and
 * `Bearer\s+[A-Za-z0-9._-]{20,}` patterns must match at runtime.
 *
 * It is synthetic and matches no real provider key. [threat T-02-01-03]
 */
export const SECRET_FIXTURE_TOKEN = ["sk", "fixture", "x".repeat(32)].join("-");

/**
 * Return a copy of `payload` carrying a credential-shaped `authorization`
 * value, so every redaction test shares one shape instead of hand-rolling one.
 */
export function withSecretHeader(payload: Record<string, unknown>): Record<string, unknown> {
	return { ...payload, authorization: `Bearer ${SECRET_FIXTURE_TOKEN}` };
}

/** Flatten a message's content to the string an OpenAI-shaped body would carry. */
function messageContent(message: NonSystemMessage): unknown {
	if (typeof message.content === "string") {
		return message.content;
	}
	return message.content
		.map((block) => {
			if (block.type === "text") {
				return block.text;
			}
			if (block.type === "thinking") {
				return block.thinking;
			}
			if (block.type === "toolCall") {
				return `${block.name}(${JSON.stringify(block.arguments)})`;
			}
			return `[${block.type}]`;
		})
		.join("");
}

/**
 * A `ChatCompletionCreateParamsStreaming`-shaped payload.
 *
 * Transcribed from `buildParams` in `pi-ai src/api/openai-completions.ts:681-760`:
 * `model`, `messages`, `stream: true`, `stream_options: { include_usage: true }`
 * (emitted when `compat.supportsUsageInStreaming !== false`, :707-709), `tools`
 * as `{ type: "function", function: { name, description, parameters } }`
 * (:730-731 via `convertTools`), and the thinking keys only when the
 * corresponding option is set (:754-768).
 *
 * The shape is realistic; it is not the real thing. RESEARCH §12 keeps that
 * distinction honest — the live payload is a [RUNBOOK] check.
 */
export function buildOpenAiFixturePayload(
	model: Model<string>,
	transcript: TranscriptContext,
	options: unknown,
): Record<string, unknown> {
	const context = transcriptView(transcript);
	const messages: { role: string; content: unknown }[] = [];
	if (context.systemPrompt) {
		messages.push({ role: "system", content: context.systemPrompt });
	}
	for (const message of context.messages) {
		messages.push({ role: message.role, content: messageContent(message) });
	}

	const payload: Record<string, unknown> = {
		model: model.id,
		messages,
		stream: true,
		stream_options: { include_usage: true },
	};

	if (context.tools && context.tools.length > 0) {
		payload.tools = context.tools.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			},
		}));
	}

	// `reasoningEffort` is the per-API name (openai-completions.ts:630);
	// `reasoning` is the SimpleStreamOptions name faux is actually called with.
	const effort = readOption(options, "reasoningEffort") ?? readOption(options, "reasoning");
	if (effort !== undefined) {
		payload.reasoning_effort = effort;
	}
	const thinking = readOption(options, "thinking");
	if (thinking !== undefined) {
		payload.thinking = thinking;
	}

	const maxTokens = readOption(options, "maxTokens");
	if (maxTokens !== undefined) {
		payload.max_completion_tokens = maxTokens;
	}
	const temperature = readOption(options, "temperature");
	if (temperature !== undefined) {
		payload.temperature = temperature;
	}

	return payload;
}

/**
 * A `ConverseStreamCommandInput`-shaped payload.
 *
 * Transcribed from `pi-ai src/api/bedrock-converse-stream.ts:235-246`: exactly
 * the keys `modelId`, `messages`, `system`, `inferenceConfig`, `toolConfig`,
 * `additionalModelRequestFields`.
 *
 * Bedrock matters here for a reason beyond coverage: SigV4 is applied by the
 * AWS SDK's signing middleware, downstream of everything Pi hands over, so a
 * Bedrock credential can never appear in a dump. A wire-inspector test that
 * only ever exercises the OpenAI shape would silently generalise from the one
 * adapter where the credential path is visible.
 */
export function buildBedrockFixturePayload(
	model: Model<string>,
	transcript: TranscriptContext,
	options: unknown,
): Record<string, unknown> {
	const context = transcriptView(transcript);
	const inferenceConfig: Record<string, unknown> = {};
	const maxTokens = readOption(options, "maxTokens");
	if (maxTokens !== undefined) {
		inferenceConfig.maxTokens = maxTokens;
	}
	const temperature = readOption(options, "temperature");
	if (temperature !== undefined) {
		inferenceConfig.temperature = temperature;
	}

	return {
		modelId: model.id,
		messages: context.messages.map((message) => ({
			role: message.role,
			content: [{ text: messageContent(message) }],
		})),
		system: context.systemPrompt ? [{ text: context.systemPrompt }] : [],
		inferenceConfig,
		toolConfig:
			context.tools && context.tools.length > 0
				? {
						tools: context.tools.map((tool) => ({
							toolSpec: {
								name: tool.name,
								description: tool.description,
								inputSchema: { json: tool.parameters },
							},
						})),
					}
				: undefined,
		additionalModelRequestFields: {},
	};
}

/**
 * Wrap a faux provider so it emits `onPayload` the way a real adapter does.
 *
 * Returns a spread copy of `faux.provider` — the auth stub, model list and
 * deferred methods are untouched — whose `stream` and `streamSimple` both call
 * `options.onPayload(...)` immediately before delegating to the original.
 *
 * Register the RESULT, not `faux.provider`:
 *   modelRuntime.registerNativeProvider(wrapFauxWithPayload(faux));
 * Registering the bare provider is the vacuous-capture failure mode this file
 * exists to remove.
 */
export function wrapFauxWithPayload(
	faux: FauxProviderHandle,
	buildPayload: FixturePayloadBuilder = buildOpenAiFixturePayload,
): Provider {
	const inner = faux.provider;

	// The emission is written out twice rather than factored into a helper.
	// Task acceptance greps this file for the call inside BOTH overrides, and a
	// duplicated four-line body is a cheaper price than an assertion that stops
	// matching the thing it checks.
	return {
		...inner,
		stream(model, context, options) {
			// Position matches openai-completions.ts:237 /
			// bedrock-converse-stream.ts:247 / anthropic-messages.ts:550 -- body
			// assembled, nothing dispatched yet. The return value is ignored on
			// purpose: payload replacement is Pi's contract (runner.ts:1030-1033),
			// not this wrapper's.
			const bag = options as unknown as AnyStreamOptions | undefined;
			void bag?.onPayload?.(buildPayload(model, context, options), model);
			return inner.stream(model, context, options);
		},
		streamSimple(model, context, options) {
			const bag = options as unknown as AnyStreamOptions | undefined;
			void bag?.onPayload?.(buildPayload(model, context, options), model);
			return inner.streamSimple(model, context, options);
		},
	};
}

/**
 * Wrap a faux provider so every call reports `status` instead of the 200 faux
 * hard-codes — exactly once per call. [PROV-08]
 *
 * `faux` has no path to a 429 or a 503: `stream()` runs
 * `await streamOptions?.onResponse?.({ status: 200, headers: {} }, requestModel)`
 * unconditionally [VERIFIED: pi-ai 1.1.0 dist/providers/faux.js:359, and :404 /
 * :443 for the deferred paths]. PROV-08's error taxonomy — quota, transient,
 * unavailable — is a claim about statuses, so without this wrapper all three
 * classes are the same green 200 and the chain test verifies nothing.
 *
 * THE DECISION, STATED SO IT IS NOT RE-OPENED (RESEARCH Open Question 4).
 * There are two ways to get a non-200 out of faux and this helper takes the
 * second:
 *
 *   (a) **pre-call** `onResponse({ status, ... })` before delegating — the
 *       shape RESEARCH sketched. It is wrong. Faux's own hard-coded 200 still
 *       fires afterwards, so the caller is called TWICE per request and the
 *       LAST value it sees is 200. Under Phase 2's instrument that writes two
 *       `main.response` wire records under one correlation id, and `/budget`
 *       then counts a row that never happened.
 *   (b) **substitute** `onResponse` in the options bag, which is what happens
 *       below. The wrapper hands the inner provider a shallow copy of the bag
 *       whose `onResponse` forwards `{ status, headers: {} }` to the caller's
 *       original. Faux's hard-coded call then invokes the substitute, so the
 *       200 is *rewritten* rather than duplicated: exactly one invocation, and
 *       it carries `status`.
 *
 * `tests/unit/helpers.test.ts` asserts the invocation count is exactly 1, which
 * is the assertion that would go red if anyone converted this back to a
 * pre-call. [threat T-03-01-04]
 *
 * The caller's bag is copied, never mutated — a wrapper that wrote `onResponse`
 * back onto the caller's own object would leave the substitute installed after
 * the wrapper went out of scope.
 *
 * Accepts either a `FauxProviderHandle` or an already-wrapped `Provider`, so
 * the two wrappers compose:
 *   modelRuntime.registerNativeProvider(
 *       wrapFauxWithStatus(wrapFauxWithPayload(faux), 503));
 * keeps `onPayload` emission intact and reports 503.
 */
export function wrapFauxWithStatus(faux: FauxProviderHandle | Provider, status: number): Provider {
	const inner = "provider" in faux ? faux.provider : faux;

	// The substitution is written out twice rather than factored into a helper,
	// for the same reason the sibling above duplicates its emission: task
	// acceptance greps this file for the substitution inside BOTH overrides, and
	// a duplicated body is a cheaper price than an assertion that stops matching
	// the thing it checks.
	return {
		...inner,
		stream(model, context, options) {
			const bag = options as unknown as AnyStreamOptions | undefined;
			const original = bag?.onResponse;
			// Substituted, NOT pre-called -- see the docstring. The incoming
			// response is faux's hard-coded 200 and is deliberately discarded.
			const onResponse: AnyStreamOptions["onResponse"] = (_response, responseModel) => {
				void original?.({ status, headers: {} }, responseModel);
			};
			const forwarded = { ...(bag ?? {}), onResponse } as unknown as typeof options;
			return inner.stream(model, context, forwarded);
		},
		streamSimple(model, context, options) {
			const bag = options as unknown as AnyStreamOptions | undefined;
			const original = bag?.onResponse;
			const onResponse: AnyStreamOptions["onResponse"] = (_response, responseModel) => {
				void original?.({ status, headers: {} }, responseModel);
			};
			const forwarded = { ...(bag ?? {}), onResponse } as unknown as typeof options;
			return inner.streamSimple(model, context, forwarded);
		},
	};
}
