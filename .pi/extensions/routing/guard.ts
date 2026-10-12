/**
 * Capability guard: four hard refusals as pure predicates over a resolved `Model<Api>` (no `ctx`, env or fs).
 * Returns a verdict, never a substituted model. Blocks run in order and the first match returns: image against text-only,
 * request over `contextWindow`, thinking on non-Claude Bedrock (Pi drops it silently, `bedrock-converse-stream.js#buildAdditionalModelRequestFields`),
 * and a tool-loop role on Bedrock DeepSeek R1. Contributing-boundary and chokepoint-lint scan comments, so those calls are not named here.
 */
import type { Api, Model } from "@earendil-works/pi-ai";

/** Two arms only: a refusal is never a licence to pick another model. */
export type GuardVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** What the request needs; an absent field means the block does not apply. */
export interface GuardNeed {
	/** The request carries image content. */
	readonly image?: boolean;
	/** A rough estimate of the request's input token count, for the context-window block. */
	readonly estimatedInputTokens?: number;
	/** The caller is asking for a non-off thinking level on this call. */
	readonly thinkingRequested?: boolean;
	/** Set from `ROLE_MECHANISM`; scopes the R1 deny-list, not a role name. */
	readonly usesToolLoop?: boolean;
}

/** Bedrock DeepSeek R1 ids (lower-cased). `Model<Api>` (`pi-ai dist/types.d.ts`) has no tool-calling field, so this cannot be a catalogue predicate. */
export const NO_TOOL_CALLING_MODEL_IDS: readonly string[] = ["deepseek.r1-v1:0", "us.deepseek.r1-v1:0"];

function isNoToolCallingModel(model: Model<Api>): boolean {
	const id = model.id.toLowerCase();
	return NO_TOOL_CALLING_MODEL_IDS.some((denied) => id === denied);
}

/** Local copy of pi-ai's unexported `isAnthropicClaudeModel` (pi-ai 1.1.0 `bedrock-converse-stream.js:650`); it diverges silently if Pi changes it. */
export function isAnthropicClaudeModel(model: Model<Api>): boolean {
	const id = model.id.toLowerCase();
	const name = model.name.toLowerCase();
	return (
		id.includes("anthropic.claude") ||
		id.includes("anthropic/claude") ||
		name.includes("anthropic.claude") ||
		name.includes("anthropic/claude") ||
		name.includes("claude")
	);
}

/** Evaluates the four blocks in order for one `(model, role, need)`; the R1 block is scoped by `need.usesToolLoop`, not `role`. */
export function guardRoute(model: Model<Api>, role: string, need: GuardNeed): GuardVerdict {
	if (need.image === true && !model.input.includes("image")) {
		return {
			ok: false,
			reason:
				`${model.provider}/${model.id} is text-only (input=${JSON.stringify(model.input)}); ` +
				`the ${role} role needs image input`,
		};
	}

	if (need.estimatedInputTokens !== undefined && need.estimatedInputTokens > model.contextWindow) {
		return {
			ok: false,
			reason:
				`${model.provider}/${model.id} has a ${model.contextWindow}-token context window; ` +
				`the request needs an estimated ${need.estimatedInputTokens} tokens`,
		};
	}

	// Pi drops thinking config silently here while the UI still offers it (`bedrock-converse-stream.js#buildAdditionalModelRequestFields`).
	if (
		model.provider === "amazon-bedrock" &&
		model.reasoning === true &&
		!isAnthropicClaudeModel(model) &&
		need.thinkingRequested === true
	) {
		return {
			ok: false,
			reason:
				`${model.provider}/${model.id} silently DROPS thinking configuration on non-Claude ` +
				"Bedrock models — the request builder returns no thinking field at all for this " +
				"combination (pi-ai bedrock-converse-stream.js:889-927), even though the UI still " +
				"offers a thinking level because it gates on model.reasoning alone. This is not a " +
				"vendor rejection; it is a configuration silently dropped in transit.",
		};
	}

	if (need.usesToolLoop === true && isNoToolCallingModel(model)) {
		return {
			ok: false,
			reason:
				`${model.provider}/${model.id} supports no tool calling at all; the ${role} role ` +
				"needs a tool loop and this model cannot serve one",
		};
	}

	return { ok: true };
}
