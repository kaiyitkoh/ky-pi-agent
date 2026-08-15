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
 * `{provider,id}` a MEMBER of the one chain that exists", not "what chain
 * does `max` use". `max` routes most roles to Bedrock Claude, which has no
 * hop in `CHAIN` by design — that role goes through `callModel()` directly,
 * never through the chain, and nothing in this file gives `max` (or any
 * other mode) a chain of its own. A future edit that reads otherwise is the
 * exact mistake 05-CONTEXT.md decision 10 warns against.
 *
 * NOTE (CR-02): membership is a fact about `CHAIN`, not a dispatch rule.
 * {@link runSingleShotRole} does NOT call `usesFallbackChain` to decide
 * between `callWithFallback()` and a direct chokepoint call — see its own
 * `resolvedIsChainHead` check and doc comment for why only the chain's HEAD
 * qualifies. `usesFallbackChain` today has no production caller; it remains
 * exported and tested as a pure predicate on `CHAIN` membership only.
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

/**
 * Narrow an unknown `globalThis` slot value before trusting it as state.
 *
 * WR-03: `candidate.mode` must be a MEMBER of {@link MODES}, not merely a
 * `string` -- this module's own docstring at {@link getModeState} explicitly
 * anticipates the slot holding "a stale shape from a version this module no
 * longer writes" (e.g. `{mode: "turbo", ...}`), and a bare `typeof ===
 * "string"` check lets exactly that value through. `resolveRoute` then
 * evaluates `ROLE_MAP[state.mode][role]` -> `ROLE_MAP["turbo"]` ->
 * `undefined[role]` -> a `TypeError` that crashes `/escalate`, `/mode` and
 * every `runSingleShotRole`. `restoreModeFromBranch` (`../routing/index.ts`)
 * already validates against `MODES` for precisely this reason (T-05-36);
 * this is the SAME narrowing applied at the OTHER reader of a mode value that
 * did not originate from this module's own `setMode`.
 */
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
 * Whether `ref` is a MEMBER of the fixed fallback chain. NOTE (CR-02): a
 * member is NOT sufficient to justify `callWithFallback()`, which always
 * restarts at CHAIN[0] and takes no starting model -- only the chain HEAD is.
 * See {@link runSingleShotRole}'s own `resolvedIsChainHead` check; do not
 * replace it with this predicate. Kept as a pure, tested predicate on
 * `CHAIN` membership; it has no production caller today.
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
// Nested api-options shape — pure. One producer of a nested call's `api` bag,
// branching on the RESOLVED candidate's `model.api`, never assuming
// openai-completions. This is the 08-01 fix: the code this function replaced
// built `{ reasoningEffort }` unconditionally, which is the openai-completions
// shape only — `BedrockOptions` (`@earendil-works/pi-ai`'s
// `api/bedrock-converse-stream.d.ts`) carries NO `reasoningEffort` field, so
// every Bedrock-routed nested call (reviewer/advisor in `balanced`/`max`,
// vision in every mode) silently dropped its declared reasoning effort on the
// floor. GATE-10's own nested proof
// (`tests/integration/gate10-nested-thinking.test.ts`) was run RED against
// the unconditional shape before this function existed.
// -----------------------------------------------------------------------------

/**
 * Build the `api` options bag for a nested single-shot call, for the api the
 * RESOLVED candidate actually carries — never the caller's assumption of
 * which api that is. Returns `undefined` when `effort` is `undefined` (the
 * route declares no elevated reasoning for this role), matching the field's
 * prior unconditional behaviour for that case exactly.
 *
 * `"bedrock-converse-stream"` -> `{ reasoning: effort }`
 * (`node_modules/@earendil-works/pi-ai/dist/api/bedrock-converse-stream.d.ts:6-11`
 * — this api's field is named `reasoning`, not `reasoningEffort`; the latter
 * does not exist on `BedrockOptions` and a real adapter silently ignores it).
 * This is the ONE branch that had to change: every other api keeps the prior
 * unconditional shape.
 *
 * `"anthropic-messages"` THROWS: `ROLE_MAP` resolves no `anthropic-messages`
 * candidate today, so there is no measured per-level token budget to map
 * `effort` onto — `AnthropicMessagesOptions` wants `thinkingBudgetTokens`, a
 * concrete number, not a level string, and inventing one here would be a
 * fabricated measurement (05-RESEARCH.md Assumption A3). A throw is the
 * honest degradation, reachable only if the routing table changes to resolve
 * an `anthropic-messages` candidate for a role that declares `reasoningEffort`
 * — at which point this function's error message says exactly what is
 * missing and where to add it.
 *
 * `"openai-completions"` -> `{ reasoningEffort: effort }`
 * (`node_modules/@earendil-works/pi-ai/dist/api/openai-completions.d.ts:4-9`),
 * and this is ALSO the `default` case, DELIBERATELY, not a distinct arm.
 *
 * WHY `default` FALLS BACK TO THE OPENAI SHAPE RATHER THAN THROWING — A
 * DEVIATION FROM THE PLAN'S OWN WORDING, RECORDED HERE RATHER THAN HIDDEN
 * (08-01-SUMMARY.md's Deviations section states it too). The plan's action
 * text asked for a `default` arm that throws, matching a compile-time
 * exhaustiveness idiom. Two things ruled that out once tried:
 *
 *   1. `Api` is `KnownApi | (string & {})` [pi-ai `types.d.ts:16`] — an OPEN
 *      union, kept open on purpose so a custom `models.json` entry can carry
 *      an api id this package's own catalogue does not know about (PROV-06).
 *      A `default: { const exhaustive: never = model.api; }` throwing arm
 *      does not even COMPILE against this type — verified by trying it:
 *      `tsc` reports TS2322, `"google-generative-ai" | (string & {})` is not
 *      assignable to `never`, because equality narrowing on literal `case`s
 *      cannot exclude the open `(string & {})` fallback arm no matter how
 *      many literals are matched.
 *   2. A throwing `default` at RUNTIME (tried and reverted — see the git
 *      history on this line if it is ever restored) broke
 *      `tests/integration/single-shot-roles.test.ts`, an EXISTING, in-scope,
 *      required-green proof this plan may not modify: that file's own
 *      `fauxProvider({provider:"deepseek", ...})` call passes no `api`
 *      option, so pi-ai's `fauxProvider` assigns a RANDOM id
 *      (`faux:<timestamp>:<random>`, `pi-ai src/providers/faux.js:297`) —
 *      neither `"openai-completions"` nor any other `KnownApi` member. That
 *      is a legitimate test fixture, not a bug to fix by editing a plan-
 *      external file: every api this codebase's `ROLE_MAP` resolves today
 *      (openai-completions, bedrock-converse-stream) is either explicitly
 *      handled above or falls into this default, and an unlabelled faux
 *      provider is exactly the class of "some other api, treat it like the
 *      historical default" case this function must still serve without
 *      breaking. Reproduced: throwing here turned 2 passing tests in that
 *      file red with `buildNestedApiOptions: unrecognised model.api
 *      "faux:...:..." `.
 *
 * The scope of the actual defect this function fixes is narrow — Bedrock got
 * the wrong shape — and the fix stays narrow: ONE branch changed
 * (`bedrock-converse-stream`), ONE branch added (`anthropic-messages`, which
 * genuinely cannot be served honestly), and everything else — the real
 * `openai-completions` api along with every other api id this function has
 * never been told how to handle, faux test ids included — keeps doing
 * exactly what the pre-fix code did for it.
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
			// See this function's own docstring for why `default` is the
			// openai-completions shape rather than a throw: `model.api`'s type
			// here is NOT `never` (Api's open `(string & {})` fallback arm makes
			// true compile-time exhaustiveness impossible for this union), and a
			// runtime throw here broke an existing, in-scope, required-green test
			// whose faux fixture carries an unlabelled api id.
			return { reasoningEffort: effort };
	}
}

// -----------------------------------------------------------------------------
// Dispatch — impure. The only half of this file that touches a session.
// -----------------------------------------------------------------------------

export interface RunSingleShotRoleOptions {
	readonly role: Role;
	readonly messages: Message[];
	readonly systemPrompt?: string;
	readonly need: RoleNeed;
	/**
	 * Threads straight to the chokepoint's existing `tools` field
	 * (`CallModelOptions.tools`, `.pi/extensions/diagnostics/call-model.ts`) —
	 * that field has existed since Phase 2 with no caller until this one. How a
	 * nested call is given a forced structured-output tool: pass the single
	 * tool the caller wants the model to invoke.
	 */
	readonly tools?: Tool[];
}

/**
 * Run a single-shot role's call. Used ONLY for roles whose mechanism is
 * `call-model` — the four ROUTE-04 names (reviewer, advisor, vision,
 * summariser). Reads the current mode/escalation state, plans the call via
 * {@link planRoleCall}, and on success dispatches through the Phase 2
 * chokepoint: `callWithFallback()` when the resolved `{provider,id}` is the
 * HEAD of the fixed fallback chain (CR-02: not merely a member), `callModel()`
 * directly for every other resolved candidate (a Bedrock-pinned role has no
 * hop in that chain by design, and a later chain member must be served with
 * the router's own specific model, never by restarting the chain at its head).
 *
 * A plan refusal is thrown as an `Error` carrying the reason verbatim — never
 * swallowed into an `undefined` result, so the caller (a command or a tool)
 * always has something to report.
 *
 * `api` is built by {@link buildNestedApiOptions}, which branches on the
 * RESOLVED candidate's `model.api` — `{ reasoningEffort }` for
 * openai-completions, `{ reasoning }` for bedrock-converse-stream, never the
 * same shape for both. `BedrockOptions` carries no `reasoningEffort` field at
 * all, so the earlier unconditional `{ reasoningEffort }` shape silently
 * dropped every Bedrock-routed nested call's declared reasoning effort (the
 * 08-01 fix). `api` is `undefined` when the route declares no elevated
 * reasoning for this role, exactly as before. `signal` is deliberately never
 * passed: `callModel()`/`callWithFallback()` both default it to the session's
 * own abort signal, so pressing Esc cancels this nested work too. Nothing
 * here reaches for the mode-switch commands' own mechanism, and nothing here
 * writes a custom session entry — this path mutates no session state at all
 * (ROUTE-04).
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

	// CR-02: `callWithFallback` always restarts at the chain's OWN head
	// (`../providers/fallback.ts`'s own doc comment, "Per entry, in order",
	// starting from index 0) -- it takes no starting model. `plan.model` may
	// legitimately be a LATER chain member: `pickConfiguredCandidate` skips a
	// candidate with no configured auth (that is the ordering rule's whole
	// purpose, `schema.ts:48-56`), so on a machine with only the second hop's
	// credentials configured, `plan.model` can resolve to that second hop
	// while the chain's own head has no auth at all. Entering the chain in
	// that case would silently discard the candidate the router just picked,
	// guard-approved, and restart at a head this machine cannot authenticate
	// against -- disclosing the prompt to a provider already known to reject
	// it (see this function's own module docstring, T-03-10-02's sibling
	// concern applied one layer up). So the chain is entered ONLY when the
	// resolved candidate genuinely IS the chain's head; every other resolved
	// candidate -- chain member or not -- is served directly through the
	// chokepoint with the SPECIFIC model the router selected.
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
