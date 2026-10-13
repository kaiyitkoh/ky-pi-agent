/**
 * Faux-provider wrappers and realistic fixture payloads. `fauxProvider` never calls `onPayload` and always reports
 * status 200 (pi-ai 1.1.0 dist/providers/faux.js:359), so a bare faux session never fires `before_provider_request`
 * and a capture test over it is vacuously green. Every capture test must assert its list is non-empty first.
 * The payload carries no credential (auth is applied downstream); the hazard is secret-shaped message content.
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
 * The system prompt, tools and non-system messages of a transcript. Reading `.systemPrompt` directly compiles but
 * yields undefined: the prompt and tools live in `role: "system"` messages.
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

/** Builds the provider-shaped body a real adapter would assemble; `options` is untyped because `ApiStreamOptions<TApi>` does not resolve generically. */
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

/** A synthetic `sk-` credential, assembled at runtime so no token-shaped run sits in this public source. */
export const SECRET_FIXTURE_TOKEN = ["sk", "fixture", "x".repeat(32)].join("-");

/** A copy of `payload` carrying a credential-shaped `authorization` value. */
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

/** An OpenAI chat-completions-shaped payload, transcribed from pi-ai src/api/openai-completions.ts:681-760. */
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

	// `reasoningEffort` is the per-API name; faux is called with SimpleStreamOptions' `reasoning`.
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
 * A Bedrock Converse-shaped payload (pi-ai src/api/bedrock-converse-stream.ts:235-246). Bedrock's SigV4 is applied
 * downstream of the payload, so it is the adapter where a credential can never appear in a dump.
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
 * Wraps faux so `stream` and `streamSimple` call `onPayload` right before delegating, as real adapters do. Register
 * the result, not `faux.provider`, or every capture is vacuous.
 */
export function wrapFauxWithPayload(
	faux: FauxProviderHandle,
	buildPayload: FixturePayloadBuilder = buildOpenAiFixturePayload,
): Provider {
	const inner = faux.provider;

	return {
		...inner,
		stream(model, context, options) {
			// The return value is ignored: payload replacement is Pi's contract, not this wrapper's.
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
 * Wraps faux (or an already-wrapped provider) so each call reports `status` exactly once. It substitutes
 * `onResponse` in a copied options bag rather than pre-calling it, which would fire twice with 200 last.
 */
export function wrapFauxWithStatus(faux: FauxProviderHandle | Provider, status: number): Provider {
	const inner = "provider" in faux ? faux.provider : faux;

	return {
		...inner,
		stream(model, context, options) {
			const bag = options as unknown as AnyStreamOptions | undefined;
			const original = bag?.onResponse;
			// faux's hard-coded 200 is discarded.
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
