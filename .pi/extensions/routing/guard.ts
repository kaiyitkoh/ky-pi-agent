/**
 * Capability guard: four hard refusals as pure predicates over a resolved `Model<Api>` (no `ctx`, env or fs).
 * Returns a verdict, never a substituted model. Blocks run in order and the first match returns: image against text-only,
 * request over `contextWindow`, thinking on a Bedrock reasoning model whose request builder sends none (pi-ai 1.1.0 `dist/api/bedrock-converse-stream.js:1011`),
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

/** Matches Bedrock DeepSeek R1 under any inference-profile prefix. `Model<Api>` has no tool-calling field, so this cannot be a catalogue predicate. */
const NO_TOOL_CALLING_ID = /(^|\.)deepseek\.r1-v1:0$/i;

function isNoToolCallingModel(model: Model<Api>): boolean {
	return NO_TOOL_CALLING_ID.test(model.id);
}

/** Whether pi-ai's Bedrock request builder emits a thinking field: Claude, and ids containing `gpt-` (pi-ai 1.1.0 `bedrock-converse-stream.js:1011-1068`). */
function bedrockSendsThinking(model: Model<Api>): boolean {
	if (isAnthropicClaudeModel(model)) return true;
	const id = model.id.toLowerCase();
	const name = model.name.toLowerCase();
	return id.includes("gpt-") || name.includes("gpt-");
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

/** The slice of `ExtensionContext` that {@link deriveNeed} reads. */
export interface NeedContext {
	getContextUsage(): { tokens: number | null } | undefined;
	readonly thinkingLevel?: string;
	readonly sessionManager: { getBranch(): readonly unknown[] };
}

function branchHasImage(branch: readonly unknown[]): boolean {
	return branch.some((entry) => {
		const message = (entry as { type?: unknown; message?: { content?: unknown } } | null)?.message;
		const content = message?.content;
		return Array.isArray(content) && content.some((block) => (block as { type?: unknown } | null)?.type === "image");
	});
}

/** Builds a {@link GuardNeed} from the live session: context usage plus extra prompt size, image blocks in the branch, and the thinking level. */
export function deriveNeed(
	ctx: NeedContext,
	extra: { promptChars?: number; extraTokens?: number; usesToolLoop?: boolean } = {},
): GuardNeed {
	const used = ctx.getContextUsage()?.tokens ?? 0;
	const level = ctx.thinkingLevel;
	return {
		image: branchHasImage(ctx.sessionManager.getBranch()),
		estimatedInputTokens: used + Math.ceil((extra.promptChars ?? 0) / 4) + (extra.extraTokens ?? 0),
		thinkingRequested: level !== undefined && level !== "off",
		usesToolLoop: extra.usesToolLoop,
	};
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
		!bedrockSendsThinking(model) &&
		need.thinkingRequested === true
	) {
		return {
			ok: false,
			reason:
				`${model.provider}/${model.id} silently DROPS thinking configuration: the Bedrock ` +
				"request builder emits no thinking field for this model (pi-ai 1.1.0 " +
				"dist/api/bedrock-converse-stream.js:1011), even though the UI still offers a thinking " +
				"level because it gates on model.reasoning alone. Set thinking to off or pick another model.",
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
