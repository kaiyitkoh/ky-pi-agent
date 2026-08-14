/**
 * ky-pi-agent — the capability guard (ROUTE-06/07/08): four hard refusals as
 * pure predicates over a resolved `Model<Api>`.
 *
 * ---------------------------------------------------------------------------
 * PURPOSE
 * ---------------------------------------------------------------------------
 * Four routes are impossible, and this module is the only thing that says so
 * before dispatch instead of after a request has already been sent and
 * silently mishandled:
 *
 *   1. ROUTE-06 — image input requested against a model whose `input` carries
 *      no `"image"`.
 *   2. ROUTE-06 — a request estimated larger than a model's `contextWindow`.
 *   3. ROUTE-07 — a Bedrock model that is NOT Claude, has `reasoning: true`,
 *      and thinking is requested. Pi's own request builder returns `undefined`
 *      for this combination — the configuration is DROPPED SILENTLY while the
 *      UI still offers the thinking level, because the picker gates on
 *      `model.reasoning` alone. Reproduced here (not imported — see the
 *      residual-coupling note below `isAnthropicClaudeModel`) from
 *      `buildAdditionalModelRequestFields`, pi-ai 0.84.1
 *      `bedrock-converse-stream.js:889-927`.
 *   4. ROUTE-08 — Bedrock DeepSeek R1 (both ids) as a tool-loop role. R1 does
 *      no tool calling at all, and `Model<TApi>` carries no field anywhere
 *      that expresses tool-calling support, so this cannot be a catalogue
 *      predicate — see the deny-list rationale below.
 *
 * `guardRoute` returns a `GuardVerdict`, never a substituted model. A refusal
 * is a value the caller must read and act on; there is no third arm of the
 * union that lets a caller mistake a refusal for a success.
 *
 * ---------------------------------------------------------------------------
 * THE DENY-LIST, AND WHY IT EXISTS AT ALL (ROUTE-08)
 * ---------------------------------------------------------------------------
 * `Model<TApi>` (pi-ai 0.84.1 `dist/types.d.ts:661-682`) carries `id`, `name`,
 * `api`, `provider`, `baseUrl`, `reasoning`, `thinkingLevelMap`, `input`,
 * `cost`, `contextWindow`, `maxTokens`, `samplingParams`, `headers`, `compat`
 * — and NO FIELD ANYWHERE expresses tool-calling support. There is no
 * `supportsTools`, no `toolCalling`, nothing in `compat` that generalises to
 * "this model rejects tool definitions outright". A future reader who assumes
 * such a flag exists will "simplify" {@link NO_TOOL_CALLING_MODEL_IDS} into a
 * catalogue predicate and silently stop catching R1 — there is no predicate
 * to write instead, verified against the interface above on 2026-08-14.
 *
 * ---------------------------------------------------------------------------
 * DECISION: THE DENY-LIST IS ROLE-SCOPED VIA `need.usesToolLoop`, NOT A ROLE
 * NAME (resolves 05-RESEARCH.md Open Question 1 — taken here, not deferred)
 * ---------------------------------------------------------------------------
 * Block 4 fires when `need.usesToolLoop === true`, and the CALLER sets that
 * flag from `routing/schema.ts`'s `ROLE_MECHANISM` table — `true` for the
 * `set-model` mechanism (executor) and the `subagent` mechanism (planner),
 * `false` for a `call-model` (single-shot) role that passes no tools. This
 * matches ROUTE-08's own wording ("as an executor") and the underlying
 * defect precisely: R1 has no defect for a tool-less completion, and
 * over-blocking a technically-fine use (e.g. R1 serving `summariser`, which
 * never calls a tool) is its own silent-degradation failure — the same
 * failure category this whole guard exists to prevent, just pointed the
 * other way. The guard does not read a role NAME for this block at all; it
 * reads only what the caller declares the role needs.
 *
 * ---------------------------------------------------------------------------
 * PURITY (matches `safety/policy.ts:138-145` — the analog this module copies)
 * ---------------------------------------------------------------------------
 * No `ctx`, no `process.env`, no `node:fs`, no default export. Every fact
 * this module reasons over — the model, the role, and what the request needs
 * — is supplied by the CALLER as plain arguments; nothing is read from the
 * environment or resolved internally. This is what lets
 * `tests/unit/capability-guard.test.ts` be a millisecond fixture table
 * exactly like `tests/unit/policy-compose.test.ts`. `guardRoute` never
 * mutates the model it is handed and never logs — a refusal is a return
 * value, not a side effect.
 *
 * ---------------------------------------------------------------------------
 * RESIDUAL COUPLING — `isAnthropicClaudeModel` IS A LOCAL RE-IMPLEMENTATION
 * ---------------------------------------------------------------------------
 * The identical predicate exists in pi-ai at `bedrock-converse-stream.js:542-
 * 550` but is not exported from pi-ai's public API (not in `dist/index.d.ts`'s
 * export list). This module reproduces the same rule — lower-cased `id`
 * containing `anthropic.claude` or `anthropic/claude`, or lower-cased `name`
 * containing `anthropic.claude`, `anthropic/claude` or `claude` — rather than
 * importing it, because there is nothing to import. If Pi changes this
 * predicate upstream, THIS COPY DIVERGES SILENTLY, with no compile-time or
 * lint-time signal — the same "borrowed, not imported" trade-off Phase 3
 * accepted for `providers/schema.ts`'s `QUOTA_PATTERN`/`UNAVAILABLE_PATTERN`
 * (both borrowed from pi-ai's retry classifier for the identical reason: no
 * export exists). The mitigation is the same as theirs: this comment is
 * searchable, and the behaviour is pinned by
 * `tests/unit/capability-guard.test.ts`, not by Pi's internals — a Pi upgrade
 * that moves the real predicate will not turn this file red on its own, but a
 * developer who greps for "isAnthropicClaudeModel" after reading a changelog
 * entry will land here immediately. [T-05-05, T-05-06]
 *
 * ---------------------------------------------------------------------------
 * EVALUATION ORDER
 * ---------------------------------------------------------------------------
 * The four blocks run in the order listed under PURPOSE above, and the FIRST
 * one that matches returns immediately — there is no "strongest refusal
 * wins" reduction here, unlike `safety/policy.ts`'s multi-segment composition,
 * because `guardRoute` evaluates exactly one model against exactly one need,
 * not a sequence of sub-invocations. `guardRoute` ends with `{ ok: true }`
 * when none of the four blocks fire.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (BOOT-10 / DIAG-03)
 * ---------------------------------------------------------------------------
 * This module registers nothing and calls nothing that reaches a model. It
 * does not spell the tool-registration call, nor the forbidden direct-model
 * routes, even in prose — `tests/unit/contributing-boundary.test.ts` and
 * `tests/unit/chokepoint-lint.test.ts` both scan raw source text, comments
 * included, and grant `routing/` no exemption. They are described here
 * rather than named: the direct-completion method on the model registry, and
 * the method that hands back a raw provider object.
 */
import type { Api, Model } from "@earendil-works/pi-ai";

// -----------------------------------------------------------------------------
// Verdict shape
// -----------------------------------------------------------------------------

/**
 * The whole decision. Deliberately two arms, not three: there is no
 * "downgrade" outcome. A caller that receives `{ ok: false, ... }` must stop
 * and surface `reason`; it may never treat a refusal as licence to pick a
 * different model on its own (05-CONTEXT.md decision 4 — "never a silent
 * downgrade").
 */
export type GuardVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * What a caller declares the request needs, BEFORE dispatch. Every field is
 * optional because a caller only supplies what it actually knows for this
 * particular call — an absent field means "this need does not apply", never
 * "unknown, assume the worst" or "unknown, assume the best": each block below
 * checks its own field with an explicit `=== true` / `!== undefined`
 * comparison, so an omitted field simply cannot trigger that block.
 */
export interface GuardNeed {
	/** The request carries image content. */
	readonly image?: boolean;
	/** A rough estimate of the request's input token count, for the context-window block. */
	readonly estimatedInputTokens?: number;
	/** The caller is asking for a non-off thinking level on this call. */
	readonly thinkingRequested?: boolean;
	/**
	 * The role this model would serve needs a tool loop — set from
	 * `routing/schema.ts`'s `ROLE_MECHANISM` (`true` for `set-model`/
	 * `subagent`, `false` for `call-model`). See the DECISION section above:
	 * this is what scopes ROUTE-08's deny-list, not a role name.
	 */
	readonly usesToolLoop?: boolean;
}

// -----------------------------------------------------------------------------
// Block 4's deny-list (ROUTE-08)
// -----------------------------------------------------------------------------

/**
 * Bedrock DeepSeek R1, under both ids Pi's catalogue serves it — the region-
 * qualified `us.` id and the bare one. Lower-cased; matched case-insensitively
 * against a lower-cased `model.id` by {@link isNoToolCallingModel}. See the
 * DENY-LIST rationale above for why this cannot be a catalogue predicate.
 * [VERIFIED live, 2026-08-14: pi-ai 0.84.1
 * `dist/providers/data/amazon-bedrock.json` — both ids carry `reasoning:true`,
 * `input:["text"]`, `contextWindow:128000`, and neither carries any
 * tool-calling-related `compat` key that `deepseek.v3-v1:0`/`deepseek.v3.2`
 * carry (`supportsStrictMode`).]
 */
export const NO_TOOL_CALLING_MODEL_IDS: readonly string[] = ["deepseek.r1-v1:0", "us.deepseek.r1-v1:0"];

function isNoToolCallingModel(model: Model<Api>): boolean {
	const id = model.id.toLowerCase();
	return NO_TOOL_CALLING_MODEL_IDS.some((denied) => id === denied);
}

// -----------------------------------------------------------------------------
// Block 3's predicate (ROUTE-07) — residual coupling, see module docstring
// -----------------------------------------------------------------------------

/**
 * Reproduces pi-ai 0.84.1's own `isAnthropicClaudeModel`
 * (`bedrock-converse-stream.js:542-550`), not imported because it is not
 * exported from pi-ai's public API. See the module docstring's RESIDUAL
 * COUPLING section for the trade-off this represents.
 */
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

// -----------------------------------------------------------------------------
// The public entry point
// -----------------------------------------------------------------------------

/**
 * The whole ROUTE-06/07/08 decision for one `(model, role, need)` triple. See
 * the module docstring for the four blocks, their order, and why the deny-
 * list (block 4) is scoped by `need.usesToolLoop` rather than by `role`.
 *
 * `role` is carried through into every refusal reason so a caller reading a
 * log line knows which route was refused, even though only block 1's message
 * currently names it directly — kept as a parameter (not folded into
 * `GuardNeed`) because it identifies WHAT is being routed, not a NEED of the
 * request.
 */
export function guardRoute(model: Model<Api>, role: string, need: GuardNeed): GuardVerdict {
	// Block 1 (ROUTE-06) — image requested against a model with no image input.
	if (need.image === true && !model.input.includes("image")) {
		return {
			ok: false,
			reason:
				`${model.provider}/${model.id} is text-only (input=${JSON.stringify(model.input)}); ` +
				`the ${role} role needs image input`,
		};
	}

	// Block 2 (ROUTE-06) — the request is larger than the model's context window.
	if (need.estimatedInputTokens !== undefined && need.estimatedInputTokens > model.contextWindow) {
		return {
			ok: false,
			reason:
				`${model.provider}/${model.id} has a ${model.contextWindow}-token context window; ` +
				`the request needs an estimated ${need.estimatedInputTokens} tokens`,
		};
	}

	// Block 3 (ROUTE-07) — Bedrock non-Claude + thinking requested. Pi's own
	// request builder drops this SILENTLY (buildAdditionalModelRequestFields
	// returns undefined for this exact combination) while the UI still offers
	// the thinking level, because the picker gates on `model.reasoning` alone.
	// [VERIFIED: pi-ai 0.84.1 bedrock-converse-stream.js:889-927]
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

	// Block 4 (ROUTE-08) — a tool-loop role targeting a model with no tool
	// calling at all. Scoped by `need.usesToolLoop`, not by `role` — see the
	// module docstring's DECISION section.
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
