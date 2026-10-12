/**
 * Router: resolves role to model, runs the capability guard, picks a mechanism, and dispatches single-shot roles
 * through the chokepoint. Everything but `runSingleShotRole` is pure. Never mutates the session model or writes session entries.
 * Reaches a model only via the chokepoint and its fallback wrapper (chokepoint-lint scans comments too, so no other route is named).
 * Named exports only: a default export would reclassify this file as an extension entry point.
 */
import type { Api, AssistantMessage, Message, Model, ModelsApiStreamOptions, Tool } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { callModel } from "../diagnostics/call-model.ts";
import { callWithFallback } from "../providers/fallback.ts";
import { CHAIN } from "../providers/schema.ts";
import { guardRoute, type GuardNeed } from "./guard.ts";
import {
	DEFAULT_MODE,
	ESCALATION_MODE,
	MODES,
	ROLE_MAP,
	ROLE_MECHANISM,
	type KyModeData,
	type Mechanism,
	type ModeName,
	type ModelRef,
	type Role,
	type RoleRoute,
} from "./schema.ts";


/** Minimal structural registry lookup; a plain object satisfies it in tests. */
export interface ModelRegistryLike {
	find(provider: string, id: string): Model<Api> | undefined;
	hasConfiguredAuth(model: Model<Api>): boolean;
}


/** `globalThis` slot key: jiti keeps separate module registries, so a module-level `let` would split state across copies (same hazard as `diagnostics/index.ts#ROWS_WRITTEN_KEY`). */
const MODE_STATE_KEY = "__kypiRoutingModeState";

/** The mode/escalation shape a resolution actually needs — no `at`, no `escalatedFrom`. */
export type ModeState = Pick<KyModeData, "mode" | "escalated">;

function defaultState(): KyModeData {
	return { mode: DEFAULT_MODE, escalated: false, at: Date.now() };
}

/** Rejects a stale or foreign slot value; an unknown mode would make `ROLE_MAP[mode][role]` throw. */
function isKyModeData(value: unknown): value is KyModeData {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Partial<KyModeData>;
	return (
		typeof candidate.mode === "string" &&
		(MODES as readonly string[]).includes(candidate.mode) &&
		typeof candidate.escalated === "boolean" &&
		typeof candidate.at === "number"
	);
}

function writeModeState(state: KyModeData): void {
	(globalThis as Record<string, unknown>)[MODE_STATE_KEY] = state;
}

/** Current mode/escalation state, falling back to the default when the slot is empty or malformed. */
export function getModeState(): KyModeData {
	const raw = (globalThis as Record<string, unknown>)[MODE_STATE_KEY];
	return isKyModeData(raw) ? raw : defaultState();
}

/** Switches the mode; escalation bookkeeping is left untouched. */
export function setMode(mode: ModeName): void {
	const current = getModeState();
	writeModeState({ ...current, mode, at: Date.now() });
}

/** Records sticky escalation; `from` is dropped when `escalated` goes false. */
export function setEscalated(escalated: boolean, from?: ModeName): void {
	const current = getModeState();
	writeModeState({
		...current,
		escalated,
		escalatedFrom: escalated ? from : undefined,
		at: Date.now(),
	});
}


/** Only the `executor` route changes under escalation; every other role reads its mode's own route. */
export function resolveRoute(role: Role, state: ModeState): RoleRoute {
	if (role === "executor" && state.escalated) {
		return ROLE_MAP[ESCALATION_MODE].executor;
	}
	return ROLE_MAP[state.mode][role];
}


export type CandidateResult =
	| { readonly ok: true; readonly model: Model<Api>; readonly ref: ModelRef }
	| { readonly ok: false; readonly reason: string };

/** First candidate that resolves AND has configured auth; the refusal reason names every candidate tried. */
export function pickConfiguredCandidate(registry: ModelRegistryLike, candidates: readonly ModelRef[]): CandidateResult {
	const attempts: string[] = [];
	for (const candidate of candidates) {
		const key = `${candidate.provider}/${candidate.id}`;
		const model = registry.find(candidate.provider, candidate.id);
		if (!model) {
			attempts.push(`${key} (did not resolve)`);
			continue;
		}
		if (!registry.hasConfiguredAuth(model)) {
			attempts.push(`${key} (no configured auth)`);
			continue;
		}
		return { ok: true, model, ref: candidate };
	}
	return {
		ok: false,
		reason: `no configured candidate among: ${attempts.length > 0 ? attempts.join(", ") : "(no candidates)"}`,
	};
}


/** Whether `role` needs a tool loop; the one source for `GuardNeed.usesToolLoop`. */
export function usesToolLoop(role: Role): boolean {
	return ROLE_MECHANISM[role] !== "call-model";
}

/** Chain membership only. Not a dispatch rule: `callWithFallback` always restarts at the chain head, so only the head qualifies (see `runSingleShotRole`). */
export function usesFallbackChain(ref: ModelRef): boolean {
	return CHAIN.some((entry) => entry.provider === ref.provider && entry.id === ref.id);
}


/** `GuardNeed` minus `usesToolLoop`, which is derived from the role. */
export type RoleNeed = Omit<GuardNeed, "usesToolLoop">;

export interface PlanRoleCallOptions {
	readonly role: Role;
	readonly state: ModeState;
	readonly need: RoleNeed;
}

export type PlanResult =
	| {
			readonly ok: true;
			readonly role: Role;
			readonly model: Model<Api>;
			readonly mechanism: Mechanism;
			readonly reasoningEffort?: "high" | "max";
	  }
	| { readonly ok: false; readonly reason: string };

/** Resolve, pick a configured candidate, guard, then report the mechanism. A guard refusal is returned verbatim, never replaced by another model. */
export function planRoleCall(registry: ModelRegistryLike, opts: PlanRoleCallOptions): PlanResult {
	const route = resolveRoute(opts.role, opts.state);
	const candidate = pickConfiguredCandidate(registry, route.candidates);
	if (!candidate.ok) {
		return { ok: false, reason: candidate.reason };
	}

	const need: GuardNeed = { ...opts.need, usesToolLoop: usesToolLoop(opts.role) };
	const verdict = guardRoute(candidate.model, opts.role, need);
	if (!verdict.ok) {
		return { ok: false, reason: verdict.reason };
	}

	return {
		ok: true,
		role: opts.role,
		model: candidate.model,
		mechanism: ROLE_MECHANISM[opts.role],
		reasoningEffort: route.reasoningEffort,
	};
}


/**
 * Builds the nested call's `api` options for the resolved candidate's `model.api`.
 * `BedrockOptions` has no `reasoningEffort` field (pi-ai 1.1.0 `dist/api/bedrock-converse-stream.d.ts:10`), so it needs `{ reasoning }`;
 * openai-completions takes `{ reasoningEffort }` (pi-ai 1.1.0 `dist/api/openai-completions.d.ts:7`).
 * `anthropic-messages` throws: it needs a measured `thinkingBudgetTokens` and none exists.
 * `default` keeps the openai shape because `Api` is an open union (`pi-ai types.d.ts` Api) that cannot be exhaustively narrowed,
 * and faux test providers carry random api ids (`pi-ai providers/faux.js`).
 */
export function buildNestedApiOptions(
	model: Model<Api>,
	effort: "high" | "max" | undefined,
): ModelsApiStreamOptions<Api> | undefined {
	if (effort === undefined) {
		return undefined;
	}
	switch (model.api) {
		case "bedrock-converse-stream":
			return { reasoning: effort };
		case "anthropic-messages":
			throw new Error(
				`buildNestedApiOptions: no per-level token budget has been chosen for anthropic-messages ` +
					`(model ${model.provider}/${model.id}) -- ROLE_MAP resolves no anthropic-messages candidate ` +
					"today (05-RESEARCH.md Assumption A3), so there is nothing measured to map " +
					`${JSON.stringify(effort)} onto. AnthropicMessagesOptions wants thinkingBudgetTokens, a ` +
					"concrete number, not a level string -- inventing one here would be a fabricated " +
					"measurement. Add a real mapping to this function before routing any role through an " +
					"anthropic-messages candidate that declares reasoningEffort.",
			);
		case "openai-completions":
		default:
			// Open `Api` union: not exhaustively narrowable, and faux test ids must still be served.
			return { reasoningEffort: effort };
	}
}


export interface RunSingleShotRoleOptions {
	readonly role: Role;
	readonly messages: Message[];
	readonly systemPrompt?: string;
	readonly need: RoleNeed;
	/** Forced structured-output tool(s), forwarded to the chokepoint's `tools`. */
	readonly tools?: Tool[];
}

/**
 * Runs a `call-model` role: plan, then dispatch through the chokepoint. A plan refusal is thrown verbatim.
 * `signal` is never passed; the chokepoint defaults it to the session abort signal so Esc cancels nested work.
 */
export async function runSingleShotRole(ctx: ExtensionContext, opts: RunSingleShotRoleOptions): Promise<AssistantMessage> {
	const state = getModeState();
	const plan = planRoleCall(ctx.modelRegistry, { role: opts.role, state, need: opts.need });
	if (!plan.ok) {
		throw new Error(`runSingleShotRole: cannot serve role "${opts.role}": ${plan.reason}`);
	}
	if (plan.mechanism !== "call-model") {
		throw new Error(
			`runSingleShotRole: role "${opts.role}" resolves to mechanism "${plan.mechanism}", not ` +
				'"call-model" -- this dispatcher serves the single-shot roles only',
		);
	}

	const ref: ModelRef = { provider: plan.model.provider, id: plan.model.id };
	const api = buildNestedApiOptions(plan.model, plan.reasoningEffort);

	// `callWithFallback` always restarts at the chain head and takes no starting model, so enter the chain only when the
	// resolved candidate IS the head; otherwise it would discard the router's pick and hit a provider with no auth.
	const chainHead = CHAIN[0];
	const resolvedIsChainHead =
		chainHead !== undefined && ref.provider === chainHead.provider && ref.id === chainHead.id;

	if (resolvedIsChainHead) {
		return callWithFallback(ctx, {
			role: opts.role,
			systemPrompt: opts.systemPrompt,
			messages: opts.messages,
			tools: opts.tools,
			api,
		});
	}

	return callModel(ctx, {
		role: opts.role,
		model: plan.model,
		systemPrompt: opts.systemPrompt,
		messages: opts.messages,
		tools: opts.tools,
		api,
	});
}
