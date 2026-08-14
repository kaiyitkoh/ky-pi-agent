/**
 * ky-pi-agent — the routing extension entry point: `/cheap`, `/balanced` and
 * `/max` (ROUTE-02, ROUTE-05, ROUTE-09).
 *
 * ---------------------------------------------------------------------------
 * PURPOSE
 * ---------------------------------------------------------------------------
 * Registers exactly three commands, one shared code path behind them. Every
 * other file in `routing/` is a table or a pure predicate; this is the ONLY
 * file that touches a live session — it is where a mode name a user typed
 * becomes a real `setModel` call, a real session entry and a real settings
 * write, or a refusal with a reason if any step along that chain cannot be
 * done safely.
 *
 * ---------------------------------------------------------------------------
 * THE THREE-MECHANISMS DECISION, RESTATED FOR THE ROLE THIS FILE PLAYS
 * ---------------------------------------------------------------------------
 * `schema.ts`'s own docstring states the three mechanisms in full. This file
 * is ONLY the first of them: executor + `/escalate`, driven from a command
 * handler because `waitForIdle()` exists only on `ExtensionCommandContext`.
 * The other two mechanisms — single-shot roles via `./modes.ts`'s
 * `runSingleShotRole`, and the planner subagent whose pin `./agent-
 * overrides.ts` writes — are consumed here only through their PUBLIC
 * derivation (`agentOverridesFor`), never re-implemented. A mode switch's
 * job is to swap the WHOLE role→model map (ROADMAP criterion 1): the
 * executor mutation below and the subagent-pin write below are the same
 * user action, not two features.
 *
 * ---------------------------------------------------------------------------
 * MODE SWITCH CLEARS ESCALATION
 * ---------------------------------------------------------------------------
 * `/cheap`, `/balanced` and `/max` are an explicit, deliberate re-baseline —
 * the user is naming which map applies now. Any sticky `/escalate` from
 * before this command ran is therefore cleared as part of the switch: the
 * route below is always resolved with `escalated: false`, and the module
 * state is written the same way, so a later read of `getModeState()` never
 * reports an escalation this command did not itself request. `/escalate`
 * itself is a later plan's command, not this file's.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER BELOW IS THE REQUIREMENT, NOT A STYLE CHOICE
 * ---------------------------------------------------------------------------
 *   1. `await ctx.waitForIdle()` — FIRST, before anything is read or
 *      written. This is what removes the race ROUTE-02 exists to close, and
 *      it is why these are commands and not tools: `waitForIdle` exists only
 *      on `ExtensionCommandContext`
 *      [VERIFIED: pi-coding-agent 0.84.1 `dist/core/extensions/types.d.ts:258`].
 *   2. Resolve the executor route for the target mode and pick a configured
 *      candidate. A refusal here names every candidate tried and why each
 *      failed — the session's model is untouched.
 *   3. Run the capability guard for the executor role
 *      (`usesToolLoop: true` — an executor that cannot call a tool is not an
 *      executor, ROUTE-08). A refusal here is the guard's own reason,
 *      verbatim.
 *   4. `pi.setModel(target)` inside a `try`/`catch`, with the boolean return
 *      checked explicitly. The wrapper this calls returns `false` cleanly
 *      when the target provider has no configured auth — the common case on
 *      a machine with partial credentials
 *      [VERIFIED: pi-coding-agent 0.84.1 `dist/core/agent-session.js:1885-1890`].
 *      The inner method can also throw "No API key for …" in a narrow
 *      TOCTOU window between that pre-check and the mutation itself
 *      [VERIFIED: `dist/core/agent-session.js:1197-1209`] — reachable only
 *      in that race, but the `try`/`catch` below does not assume it can
 *      never fire. Neither outcome is swallowed, and neither is followed by
 *      silently trying a different model: that would be exactly the
 *      degradation ROADMAP criterion 3 forbids.
 *   5. Only after a `true` return: the module's mode/escalation state is
 *      updated, the `ky:mode` entry is appended, and the subagent pins are
 *      derived and written — but ONLY when `agentOverridesFor` itself
 *      returns `ok: true`. A guard-blocked subagent pin is never unwrapped,
 *      coerced to `{}`, or written anyway; it is carried into step 6's
 *      message instead.
 *   6. The outcome is reported through `ctx.ui.notify`, naming the mode and
 *      the concrete `provider/id` that now serves the executor. If step 5's
 *      settings write refused, that is said in the SAME message — "mode
 *      switched; subagent pins unchanged because <reason>" — rather than
 *      failing the whole switch or reporting an unqualified success.
 *
 * ---------------------------------------------------------------------------
 * THE `ky:mode` PAYLOAD CARRIES NO MODEL ID
 * ---------------------------------------------------------------------------
 * It is exactly `KyModeData` (mode name, escalation flag, `escalatedFrom`,
 * timestamp). Pi already persists the executor model natively through its
 * own `model_change` session entry, written on every successful `setModel`
 * call [VERIFIED: `dist/core/agent-session.js:1204`,
 * `sessionManager.appendModelChange`] and restored on resume by
 * `getSessionContextSettings` [VERIFIED: `dist/core/session-manager.js:146-
 * 161`]. Re-persisting the model here would create a second source of truth
 * that can disagree with Pi's own resume path — see `schema.ts`'s
 * `MODE_ENTRY_TYPE` docstring for the same point made about the table this
 * file reads from.
 *
 * ---------------------------------------------------------------------------
 * THE EVENT IS EMITTED, NEVER AN IMPORT
 * ---------------------------------------------------------------------------
 * `pi.events.emit(ROUTING_EVENT, …)` fires after a successful switch,
 * carrying the new state. Phase 11 renders it; this file only emits.
 * Cross-subsystem signalling is an event, never an import (05-CONTEXT.md
 * decision 8) — and `safety/` must not gain a routing import in either
 * direction. This file imports nothing from `safety/`, and nothing in
 * `safety/` imports from `routing/`.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE — THIS FILE REGISTERS COMMANDS ONLY
 * ---------------------------------------------------------------------------
 * This module registers commands and calls nothing that reaches a model
 * directly, and it never registers a tool. `tests/unit/contributing-
 * boundary.test.ts` matches the tool-registration call as a plain substring
 * across every tracked `.ts` under `.pi/extensions/`, and `routing/` is not
 * on that file's allowlist — so this file does not spell the call even in
 * prose, to say it does not use it. The phase's one allowlisted registered
 * tool sits at `.pi/extensions/qoder/index.ts` — a foreign-agent delegate
 * the model must be able to invoke mid-turn, which is exactly the kind of
 * need a command cannot serve. Nothing here reaches a model directly
 * either: this file does not spell the direct-completion method on the
 * model registry, nor the method that hands back a raw provider object,
 * even in prose — `tests/unit/chokepoint-lint.test.ts` scans raw source
 * text, comments included, and grants `routing/` no exemption.
 *
 * ---------------------------------------------------------------------------
 * LAYOUT
 * ---------------------------------------------------------------------------
 *   - `schema.ts` — the pure role→model map and mode vocabulary. ROUTE-01.
 *   - `guard.ts` — the pure capability-guard predicate. ROUTE-06/07/08.
 *   - `modes.ts` — mode/escalation state, resolution, and the single-shot
 *     dispatcher (consumed by the roles this file does not serve).
 *     ROUTE-04/09's state primitives.
 *   - `agent-overrides.ts` — the `settings.subagents.agentOverrides`
 *     read-modify-write helper. ROUTE-05.
 *   - `index.ts` (this file) — the three mode commands. ROUTE-02/09, and the
 *     ROUTE-05 write's call site.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { agentOverridesFor, writeAgentOverrides } from "./agent-overrides.ts";
import { guardRoute } from "./guard.ts";
import { pickConfiguredCandidate, resolveRoute, setEscalated, setMode, type ModeState } from "./modes.ts";
import { MODE_ENTRY_TYPE, MODES, ROUTING_EVENT, type KyModeData, type ModeName } from "./schema.ts";

/**
 * The one code path all three commands share, so `/cheap`, `/balanced` and
 * `/max` cannot drift from one another. See the module docstring's
 * "THE ORDER BELOW IS THE REQUIREMENT" section for what each step below does
 * and why it is ordered this way.
 */
async function applyMode(pi: ExtensionAPI, ctx: ExtensionCommandContext, mode: ModeName): Promise<void> {
	// Step 1 — FIRST, before anything is read or written. Removes the race
	// entirely; see the module docstring.
	await ctx.waitForIdle();

	// Step 2 — resolve + pick a configured candidate. Escalation is cleared
	// by every explicit mode pick (see the module docstring), so the route is
	// resolved with escalated:false rather than whatever state preceded this
	// command.
	const state: ModeState = { mode, escalated: false };
	const route = resolveRoute("executor", state);
	const candidate = pickConfiguredCandidate(ctx.modelRegistry, route.candidates);
	if (!candidate.ok) {
		ctx.ui.notify(`cannot switch to ${mode}: ${candidate.reason}`, "error");
		return;
	}

	// Step 3 — the capability guard, scoped to a tool-loop role (an executor
	// is one by definition; ROUTE-08).
	const guardVerdict = guardRoute(candidate.model, "executor", { usesToolLoop: true });
	if (!guardVerdict.ok) {
		ctx.ui.notify(guardVerdict.reason, "error");
		return;
	}

	// Step 4 — the mutation. Both failure modes are surfaced, neither is
	// swallowed, neither is followed by silently trying something else.
	let switched: boolean;
	try {
		switched = await pi.setModel(candidate.model);
	} catch (err) {
		ctx.ui.notify(
			`setModel threw switching to ${candidate.model.provider}/${candidate.model.id}: ${String(err)}`,
			"error",
		);
		return;
	}
	if (!switched) {
		ctx.ui.notify(
			`setModel returned false for ${candidate.model.provider}/${candidate.model.id} -- no configured auth`,
			"error",
		);
		return;
	}

	// Step 5 — only reached after a true return. Module state, the mode
	// entry, then the subagent pins -- an agentOverridesFor refusal is
	// carried into step 6's message, never unwrapped or written anyway.
	setMode(mode);
	setEscalated(false);

	const modeData: KyModeData = { mode, escalated: false, at: Date.now() };
	pi.appendEntry(MODE_ENTRY_TYPE, modeData);

	let overridesNote = "";
	const overridesResult = agentOverridesFor({ mode });
	if (!overridesResult.ok) {
		overridesNote = ` subagent pins unchanged because ${overridesResult.reason}`;
	} else {
		const writeResult = writeAgentOverrides(overridesResult.overrides);
		if (!writeResult.ok) {
			overridesNote = ` subagent pins unchanged because ${writeResult.reason}`;
		}
	}

	// Cross-subsystem signalling is an event, never an import -- see the
	// module docstring.
	pi.events.emit(ROUTING_EVENT, {
		mode,
		escalated: false,
		model: `${candidate.model.provider}/${candidate.model.id}`,
	});

	// Step 6 — the outcome, in one message.
	ctx.ui.notify(
		`mode switched to ${mode}; executor is now ${candidate.model.provider}/${candidate.model.id}.` +
			overridesNote,
		"info",
	);
}

export default function (pi: ExtensionAPI): void {
	for (const mode of MODES) {
		pi.registerCommand(mode, {
			description: `Switch the executor and subagent pins to ${mode}`,
			handler: async (_args, ctx) => {
				await applyMode(pi, ctx, mode);
			},
		});
	}
}
