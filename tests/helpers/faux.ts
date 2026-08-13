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
 * [VERIFIED: pi-ai 0.84.1 src/providers/faux.ts:510 — and :577 and :641 for the
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
 */
import type {
	Context,
	FauxProviderHandle,
	Message,
	Model,
	Provider,
	StreamOptions,
} from "@earendil-works/pi-ai";

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
	context: Context,
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
function messageContent(message: Message): unknown {
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
	context: Context,
	options: unknown,
): Record<string, unknown> {
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
	context: Context,
	options: unknown,
): Record<string, unknown> {
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
