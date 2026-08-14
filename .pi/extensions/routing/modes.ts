/**
 * ky-pi-agent — the router (ROUTE-01..04, ROUTE-09): decisions turned into a
 * concrete model, a guard verdict, a mechanism, and — for the single-shot
 * roles only — a dispatched call through Phase 2's chokepoint.
 *
 * ---------------------------------------------------------------------------
 * PURPOSE
 * ---------------------------------------------------------------------------
 * `routing/schema.ts` says WHICH model serves a role, per mode. `routing/
 * guard.ts` says whether a resolved model may serve that role at all. Neither
 * file decides anything on its own — a mode/role pair on its own is not a
 * runnable request. This file is where the three questions a caller actually
 * has ("what model, is it allowed, how do I reach it") get answered as one
 * ordered pipeline, and where the answer to the third question is executed
 * for the roles that need no tool loop.
 *
 * ---------------------------------------------------------------------------
 * THE PLAN / DISPATCH SPLIT, AND WHY IT EXISTS
 * ---------------------------------------------------------------------------
 * Everything up to and including the mechanism decision — {@link resolveRoute},
 * {@link pickConfiguredCandidate}, {@link planRoleCall} — is PURE: no `ctx`, no
 * I/O, no network, nothing awaited. That is what lets
 * `tests/unit/routing-dispatch.test.ts` be a millisecond fixture table with a
 * plain object standing in for a whole model registry. Only
 * {@link runSingleShotRole} is impure, and it is impure for exactly one
 * reason: it has to reach the Phase 2 chokepoint. Splitting the two means the
 * hard part (resolution order, auth-skipping, guard precedence, mechanism
 * selection) is proven without a session ever existing, and the thin
 * dispatch layer left over has almost nothing left to get wrong.
 *
 * ---------------------------------------------------------------------------
 * STATE-SLOT HAZARD — WHY MODE STATE LIVES ON `globalThis`
 * ---------------------------------------------------------------------------
 * Pi loads each extension through jiti, which keeps its own module registry,
 * so two different import graphs in one process can hold two separate copies
 * of this module. `.pi/extensions/diagnostics/index.ts` (lines 192-224 of
 * this repository) documents the exact failure this caused for Phase 2's
 * request counter: a module-level `let` meant a later importer's writes were
 * invisible to an earlier importer's reads, and the number `/budget` printed
 * silently excluded rows the other copy had written. The same shape of bug
 * here is worse than a wrong count — it is a wrong ANSWER: `/max` could
 * appear to take effect in the copy that ran the command while a later read,
 * from the other copy, still reports `cheap`. Mode and escalation state
 * therefore live in ONE process-wide slot keyed on `globalThis`, exactly the
 * pattern `diagnostics/index.ts` already established for
 * `rowsWrittenThisSession()` / `noteRowWritten()`.
 *
 * ---------------------------------------------------------------------------
 * ESCALATION LIFTS THE EXECUTOR ONLY
 * ---------------------------------------------------------------------------
 * `/escalate` is ROUTE-03's "pulls a stronger model", not a second whole-mode
 * switch. {@link resolveRoute} reflects that literally: an escalated state
 * changes the route for `executor` and for no other role. A caller that
 * wants "escalate everything" is asking for a mode switch, which is a
 * different command with a different route through this module entirely.
 *
 * ---------------------------------------------------------------------------
 * THE FALLBACK CHAIN IS FIXED, NOT PARAMETRIZED BY MODE (05-RESEARCH.md A.4)
 * ---------------------------------------------------------------------------
 * `providers/schema.ts`'s `CHAIN` (DeepSeek-direct → DashScope) is imported
 * here and never re-declared: {@link usesFallbackChain} asks "is this
 * `{provider,id}` a member of the one chain that exists", not "what chain
 * does `max` use". `max` routes most roles to Bedrock Claude, which has no
 * hop in `CHAIN` by design — that role goes through `callModel()` directly,
 * never through the chain, and nothing in this file gives `max` (or any
 * other mode) a chain of its own. A future edit that reads otherwise is the
 * exact mistake 05-CONTEXT.md decision 10 warns against.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (DIAG-02/03)
 * ---------------------------------------------------------------------------
 * The only two ways this file reaches a model are the Phase 2 chokepoint and
 * its fallback-chain wrapper, both imported below. It does not spell the
 * direct-completion route or the raw-provider route even in prose —
 * `tests/unit/chokepoint-lint.test.ts` scans raw source text, comments
 * included, and grants `routing/` no exemption; they are described here
 * rather than named, the same dodge every sibling file in this subsystem
 * uses. This file also never mutates the session's active model and never
 * writes a custom session entry: those are the mode-switch commands' job
 * (a later plan's `index.ts`), and `runSingleShotRole` must not blur that
 * line by reaching for either mechanism on its own path.
 *
 * ---------------------------------------------------------------------------
 * LAYOUT
 * ---------------------------------------------------------------------------
 * Named exports only. No default export — this is a sibling module, not the
 * extension entry point (see `schema.ts`'s own docstring for the same rule
 * and the same reason: `tests/unit/extension-layout.test.ts` would otherwise
 * reclassify this file as one).
 */
import type { Api, AssistantMessage, Message, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { callModel } from "../diagnostics/call-model.ts";
import { callWithFallback } from "../providers/fallback.ts";
import { CHAIN } from "../providers/schema.ts";
import { guardRoute, type GuardNeed } from "./guard.ts";
import {
	DEFAULT_MODE,
	ESCALATION_MODE,
	ROLE_MAP,
	ROLE_MECHANISM,
	type KyModeData,
	type Mechanism,
	type ModeName,
	type ModelRef,
	type Role,
	type RoleRoute,
} from "./schema.ts";

// -----------------------------------------------------------------------------
// The minimal structural interface a registry lookup needs — never
// `ExtensionContext`. A plain object satisfies this in a unit test; Pi's real
// registry satisfies it structurally, with no adapter required.
// -----------------------------------------------------------------------------

/**
 * What {@link pickConfiguredCandidate} (and therefore {@link planRoleCall})
 * needs from a model registry — nothing more. `find` and `hasConfiguredAuth`
 * are both on `tests/unit/chokepoint-lint.test.ts`'s explicitly-permitted
 * list (line 99-104 of that file): they resolve and inspect a model, they
 * never reach one.
 */
export interface ModelRegistryLike {
	find(provider: string, id: string): Model<Api> | undefined;
	hasConfiguredAuth(model: Model<Api>): boolean;
}

// -----------------------------------------------------------------------------
// Mode / escalation state — one process-wide slot. See STATE-SLOT HAZARD
// above.
// -----------------------------------------------------------------------------

/** The `globalThis` key this module's mode/escalation slot lives under. */
const MODE_STATE_KEY = "__kypiRoutingModeState";

/** The mode/escalation shape a resolution actually needs — no `at`, no `escalatedFrom`. */
export type ModeState = Pick<KyModeData, "mode" | "escalated">;

function defaultState(): KyModeData {
	return { mode: DEFAULT_MODE, escalated: false, at: Date.now() };
}

/** Narrow an unknown `globalThis` slot value before trusting it as state. */
function isKyModeData(value: unknown): value is KyModeData {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Partial<KyModeData>;
	return typeof candidate.mode === "string" && typeof candidate.escalated === "boolean" && typeof candidate.at === "number";
}

function writeModeState(state: KyModeData): void {
	(globalThis as Record<string, unknown>)[MODE_STATE_KEY] = state;
}

/**
 * The mode/escalation state in force right now, in THIS process, regardless
 * of which jiti copy of this module is asking — see STATE-SLOT HAZARD above.
 * Falls back to {@link defaultState} when nothing has been written yet, or
 * when the slot holds something that does not look like {@link KyModeData}
 * (e.g. a stale shape from a version this module no longer writes).
 */
export function getModeState(): KyModeData {
	const raw = (globalThis as Record<string, unknown>)[MODE_STATE_KEY];
	return isKyModeData(raw) ? raw : defaultState();
}

/**
 * Switch the mode. Escalation bookkeeping is left untouched — a mode switch
 * and an escalation change are two different user actions and this function
 * only performs the one it is named for.
 */
export function setMode(mode: ModeName): void {
	const current = getModeState();
	writeModeState({ ...current, mode, at: Date.now() });
}

/**
 * Record `/escalate`'s sticky state. `from` is the mode escalation was
 * invoked from, so a later "escalate off" can restore it; it is dropped
 * (never carried over stale) the moment `escalated` goes back to `false`.
 */
export function setEscalated(escalated: boolean, from?: ModeName): void {
	const current = getModeState();
	writeModeState({
		...current,
		escalated,
		escalatedFrom: escalated ? from : undefined,
		at: Date.now(),
	});
}

// -----------------------------------------------------------------------------
// Resolution — pure, no registry involved yet.
// -----------------------------------------------------------------------------

/**
 * The {@link RoleRoute} that applies right now for `role`, given `state`. See
 * ESCALATION LIFTS THE EXECUTOR ONLY above: only the `executor` role's route
 * changes when `state.escalated` is true, and it changes to
 * `ROLE_MAP[ESCALATION_MODE].executor` — every other role reads
 * `ROLE_MAP[state.mode][role]` exactly as it would with escalation off.
 */
export function resolveRoute(role: Role, state: ModeState): RoleRoute {
	if (role === "executor" && state.escalated) {
		return ROLE_MAP[ESCALATION_MODE].executor;
	}
	return ROLE_MAP[state.mode][role];
}

// -----------------------------------------------------------------------------
// Candidate selection — pure, registry-shaped.
// -----------------------------------------------------------------------------

/** What {@link pickConfiguredCandidate} hands back. */
export type CandidateResult =
	| { readonly ok: true; readonly model: Model<Api>; readonly ref: ModelRef }
	| { readonly ok: false; readonly reason: string };

/**
 * Walk `candidates` in order and return the first that BOTH resolves in
 * `registry` AND has configured auth. A candidate that resolves but carries
 * no auth is skipped, never treated as a hard stop — the whole point of an
 * ordered list is that a later entry may still be usable. Exhausting every
 * candidate is a refusal whose reason names every one tried and states,
 * per candidate, whether it failed to resolve or resolved with no
 * configured auth.
 */
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

// -----------------------------------------------------------------------------
// Mechanism helpers — pure, exported so both are unit-testable alone.
// -----------------------------------------------------------------------------

/**
 * Whether `role` needs a tool loop — `true` for the `set-model` mechanism
 * (executor) and the `subagent` mechanism (planner), `false` for every
 * `call-model` (single-shot) role. This is the ONE place ROUTE-08's deny-list
 * scope is decided; `guard.ts`'s `GuardNeed.usesToolLoop` is always derived
 * from this function, never set independently by a caller.
 */
export function usesToolLoop(role: Role): boolean {
	return ROLE_MECHANISM[role] !== "call-model";
}

/**
 * Whether `ref` is a member of the fixed fallback chain — asked, never
 * assumed, against the imported `CHAIN`. See THE FALLBACK CHAIN IS FIXED
 * above: this is the only test a caller needs to decide between
 * `callWithFallback()` and a direct chokepoint call.
 */
export function usesFallbackChain(ref: ModelRef): boolean {
	return CHAIN.some((entry) => entry.provider === ref.provider && entry.id === ref.id);
}

// -----------------------------------------------------------------------------
// Planning — pure. resolve -> pick a candidate -> guard -> report a
// mechanism. The order is binding; see the module docstring's PLAN / DISPATCH
// SPLIT section.
// -----------------------------------------------------------------------------

/** What a caller of {@link planRoleCall} supplies about the request's needs — everything `GuardNeed` carries except `usesToolLoop`, which this module derives itself from the role. */
export type RoleNeed = Omit<GuardNeed, "usesToolLoop">;

export interface PlanRoleCallOptions {
	readonly role: Role;
	readonly state: ModeState;
	readonly need: RoleNeed;
}

/** What {@link planRoleCall} hands back. `mechanism` and `reasoningEffort` never appear on a refusal. */
export type PlanResult =
	| {
			readonly ok: true;
			readonly role: Role;
			readonly model: Model<Api>;
			readonly mechanism: Mechanism;
			readonly reasoningEffort?: "high" | "max";
	  }
	| { readonly ok: false; readonly reason: string };

/**
 * The whole plan for one `(role, state, need)` triple: resolve the route,
 * pick a configured candidate, run the capability guard, and only then
 * report which mechanism serves the request. A guard refusal is returned
 * VERBATIM as this function's own reason — never rewritten, never
 * downgraded, never followed by a silently substituted model (05-CONTEXT.md
 * decision 4).
 */
export function planRoleCall(registry: ModelRegistryLike, opts: PlanRoleCallOptions): PlanResult {
	const route = resolveRoute(opts.role, opts.state);
	const candidate = pickConfiguredCandidate(registry, route.candidates);
	if (!candidate.ok) {
		return { ok: false, reason: candidate.reason };
	}

	// The ONE place ROUTE-08's scope is decided — see usesToolLoop's own docstring.
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

// -----------------------------------------------------------------------------
// Dispatch — impure. The only half of this file that touches a session.
// -----------------------------------------------------------------------------

export interface RunSingleShotRoleOptions {
	readonly role: Role;
	readonly messages: Message[];
	readonly systemPrompt?: string;
	readonly need: RoleNeed;
}

/**
 * Run a single-shot role's call. Used ONLY for roles whose mechanism is
 * `call-model` — the four ROUTE-04 names (reviewer, advisor, vision,
 * summariser). Reads the current mode/escalation state, plans the call via
 * {@link planRoleCall}, and on success dispatches through the Phase 2
 * chokepoint: `callWithFallback()` when the resolved `{provider,id}` is a
 * member of the fixed fallback chain, `callModel()` directly otherwise (a
 * Bedrock-pinned role has no hop in that chain by design).
 *
 * A plan refusal is thrown as an `Error` carrying the reason verbatim — never
 * swallowed into an `undefined` result, so the caller (a command or a tool)
 * always has something to report.
 *
 * `api` carries `{ reasoningEffort }` only when the route declares one.
 * `signal` is deliberately never passed: `callModel()`/`callWithFallback()`
 * both default it to the session's own abort signal, so pressing Esc cancels
 * this nested work too. Nothing here reaches for the mode-switch commands'
 * own mechanism, and nothing here writes a custom session entry — this path
 * mutates no session state at all (ROUTE-04).
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
	const api = plan.reasoningEffort !== undefined ? { reasoningEffort: plan.reasoningEffort } : undefined;

	if (usesFallbackChain(ref)) {
		return callWithFallback(ctx, {
			role: opts.role,
			systemPrompt: opts.systemPrompt,
			messages: opts.messages,
			api,
		});
	}

	return callModel(ctx, {
		role: opts.role,
		model: plan.model,
		systemPrompt: opts.systemPrompt,
		messages: opts.messages,
		api,
	});
}
