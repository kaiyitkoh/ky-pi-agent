/**
 * ky-pi-agent — the routing extension entry point: `/cheap`, `/balanced`,
 * `/max`, `/escalate` and `/mode` (ROUTE-02, ROUTE-03, ROUTE-05, ROUTE-09).
 *
 * ---------------------------------------------------------------------------
 * PURPOSE
 * ---------------------------------------------------------------------------
 * Registers the three mode-switch commands behind one shared code path
 * (`applyMode`), `/escalate`'s own two-way switch (`applyEscalate`, sharing
 * `applyMode`'s pre-flight → guard → `setModel` → persist shape but never its
 * function body — see that function's own doc comment for why), and the
 * read-only `/mode` status command. Every other file in `routing/` is a table
 * or a pure predicate; this is the ONLY file that touches a live session — it
 * is where a mode name or an escalation request a user typed becomes a real
 * `setModel` call, a real session entry and a real settings write, or a
 * refusal with a reason if any step along that chain cannot be done safely.
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
 * itself is this file's own command, defined immediately below `applyMode`
 * — see `applyEscalate`'s own doc comment for why it is a separate,
 * symmetrical function rather than a third branch grafted onto `applyMode`.
 *
 * ---------------------------------------------------------------------------
 * ESCALATION IS STICKY, VISIBLE, AND RECORDED (ROUTE-03)
 * ---------------------------------------------------------------------------
 * ARCHITECTURE:55 chose sticky-and-visible over auto-restore deliberately:
 * auto-restore makes "why was this turn expensive?" unanswerable after the
 * fact. `/escalate` (with no argument, or `on`) therefore does not revert on
 * its own — it lifts the executor to `schema.ts`'s `ESCALATION_MODE` route
 * and STAYS there across every subsequent turn until `/escalate off` (or an
 * explicit mode switch, see above) clears it. `/mode` is the visible half:
 * it prints the concrete `provider/id` serving the executor right now and
 * whether that is an escalation, so "why was this turn expensive" always has
 * an answer on screen rather than only in a log file. Every escalation
 * change ALSO writes a durable JSONL record (`writeEscalationRecord` below)
 * naming the previous and new executor and the escalation flag — the
 * explanation that survives after the session itself is gone (T-05-32). The
 * flag is set only after `pi.setModel` returns `true`: a state that claims
 * an escalation that never took effect is the Tampering threat this plan's
 * register calls T-05-33, and the refusal path below never sets it.
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
 * RESTORE ON `session_start` (ROUTE-09, THE RESTART HALF)
 * ---------------------------------------------------------------------------
 * `applyMode`/`applyEscalate` write the state going FORWARD; {@link
 * restoreModeFromBranch} is the read going BACKWARD, on the next session that
 * resumes this one. It is a thin, exported, directly-testable function that
 * takes the branch entry array (never `ctx` itself), wrapped by a `session_
 * start` handler that follows `safety/index.ts`'s own best-effort pruning
 * hook shape (`safety/index.ts:832-838`): `try`/`catch`, swallowed
 * deliberately, because a corrupt or hand-edited `ky:mode` payload must never
 * be able to stop a session from starting (T-05-39).
 *
 * The recipe is RESEARCH §B.5's, run against `ctx.sessionManager.getBranch()`
 * (root-to-leaf path order): filter for `entry.type === "custom" &&
 * entry.customType === MODE_ENTRY_TYPE`, take the LAST match (last write
 * wins, same rule `pickConfiguredCandidate` and every other "walk in order,
 * take the latest/first that qualifies" helper in this subsystem follows),
 * and validate the payload's shape before trusting it: a `mode` that is not a
 * member of `MODES` is ignored in favour of `DEFAULT_MODE` rather than
 * propagated (T-05-36 — a hand-edited or corrupted session file must not be
 * able to smuggle an unresolvable mode name into module state).
 *
 * **This function does NOT call `pi.setModel`, and never will.** By the time
 * `session_start` fires, Pi has already restored the executor model itself:
 * every successful `pi.setModel()` call wrote a native `model_change` entry
 * [VERIFIED: `dist/core/agent-session.js:1204`], and session resume already
 * derives the effective model from the last such entry on the branch
 * [VERIFIED: `dist/core/session-manager.js:146-161`, `getSessionContextSettings`].
 * Calling `setModel` here would be a SECOND source of truth for the same
 * fact, one that can disagree with Pi's own — exactly the Spoofing threat
 * this plan's register calls T-05-38. What this function restores is
 * strictly narrower: the mode NAME (a raw model id alone cannot say whether
 * it came from `cheap` or `balanced`, if two modes ever share an executor
 * model) and the `/escalate` sticky bookkeeping — see `schema.ts`'s
 * `MODE_ENTRY_TYPE` docstring for the identical point made about the entry
 * shape itself.
 *
 * **`session_start` does NOT fire in a headless `createAgentSession`**
 * [MEASURED: `tests/integration/call-model.test.ts`'s own header — a
 * five-event probe logged nothing before the first prompt, then
 * `before_agent_start`, `turn_start`, `before_provider_headers`, `agent_end`;
 * Pi emits `session_start` from `AgentSession`'s extension-binding step,
 * `agent-session.ts:1761`, which the headless factory this repository's own
 * test helpers use does not reach]. The hook body above is therefore real for
 * interactive/`pi --mode json` use but UNEXERCISED by this repository's own
 * test suite; `tests/integration/mode-persistence.test.ts` proves {@link
 * restoreModeFromBranch} itself directly, against a real branch, rather than
 * waiting for an event this harness has no way to trigger — see that file's
 * own header for the same point stated from the test side.
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
 *   - `index.ts` (this file) — the three mode commands, `/escalate` and the
 *     read-only `/mode` status command. ROUTE-02/03/09, and the ROUTE-05
 *     write's call site.
 */
import type {
	CustomEntry,
	ExtensionAPI,
	ExtensionCommandContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";

import { appendJsonl } from "../../lib/jsonl.ts";
import { agentOverridesFor, writeAgentOverrides } from "./agent-overrides.ts";
import { guardRoute } from "./guard.ts";
import { getModeState, pickConfiguredCandidate, resolveRoute, setEscalated, setMode, type ModeState } from "./modes.ts";
import { DEFAULT_MODE, MODE_ENTRY_TYPE, MODES, ROLES, ROUTING_EVENT, type KyModeData, type ModeName } from "./schema.ts";

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

/**
 * The JSONL base name `/escalate`'s durable record is appended under.
 * Routing-owned, distinct from `diagnostics/`'s `wire-*`/`turns-*` and
 * `safety/`'s `audit-*` — the same ownership-not-shape discipline
 * `.pi/lib/jsonl.ts`'s `pruneLogs` requires of every binding. Nothing here
 * prunes this stream; `/escalate` fires rarely enough that retention was not
 * worth the extra surface for this plan, and `.pi/logs/` is already
 * gitignored wholesale (`.gitignore:23,79`).
 */
const ESCALATION_LOG_BASE = "escalation";

/**
 * Append `/escalate`'s durable record (T-05-32) — reusing `.pi/lib/jsonl.ts`,
 * the SAME hardened writer `safety/audit.ts#writeAuditRow` binds to, never a
 * second one. `previousModel` is `undefined` only when `ctx.model` itself was
 * `undefined` (no model selected yet), which `JSON.stringify` then simply
 * omits from the written line.
 *
 * NEVER THROWS. Best-effort, mirroring `safety/audit.ts#writeAuditRow`'s own
 * catch-and-swallow discipline: a failed record write must never turn a
 * successful `setModel` switch into a reported error, which is exactly why
 * this is called AFTER the switch already succeeded, not as a precondition
 * for it. The residual risk — an unexplained cost spike if this write itself
 * starts failing — is accepted and stated, never hidden (T-05-35).
 */
function writeEscalationRecord(
	cwd: string,
	input: { mode: ModeName; escalated: boolean; previousModel: string | undefined; newModel: string },
): void {
	try {
		appendJsonl(cwd, ESCALATION_LOG_BASE, {
			ts: Date.now(),
			mode: input.mode,
			escalated: input.escalated,
			previousModel: input.previousModel,
			newModel: input.newModel,
		});
	} catch {
		// Best-effort -- see this function's own doc comment and T-05-35.
	}
}

/**
 * `/escalate`'s own two-way switch: `escalate === true` lifts the executor to
 * `ESCALATION_MODE`'s route (via `resolveRoute`'s own executor-only lift —
 * see `modes.ts`'s ESCALATION LIFTS THE EXECUTOR ONLY section); `escalate ===
 * false` restores the CURRENT mode's own executor route. The current mode
 * itself is never touched either way — only the escalation flag and the
 * executor model change.
 *
 * A SEPARATE FUNCTION FROM `applyMode`, DELIBERATELY, THOUGH THE SHAPE
 * RHYMES. `applyMode` always resolves with `escalated: false` (an explicit
 * mode pick clears escalation) and always calls `setMode`; this function
 * always resolves with `escalated: <the argument>` and never calls `setMode`
 * at all — the mode itself is not what changed. Folding both into one
 * function would need a mode of caller intent threaded through every step
 * below, which is exactly the kind of implicit branching this codebase's own
 * `guard.ts`/`policy.ts` house style avoids. The two functions share no code
 * beyond the modules they both import.
 *
 * Runs the identical pre-flight → guard → `setModel` → persist shape
 * `applyMode` uses: `await ctx.waitForIdle()` first: resolve the route and
 * pick a configured candidate (a refusal here leaves both the model and the
 * escalation flag untouched); the capability guard for the executor role;
 * `pi.setModel` in a `try`/`catch` with the boolean return checked
 * explicitly; and ONLY on a `true` return does the escalation state change,
 * the `ky:mode` entry get written, the durable escalation record get
 * appended, and `ROUTING_EVENT` fire.
 */
async function applyEscalate(pi: ExtensionAPI, ctx: ExtensionCommandContext, escalate: boolean): Promise<void> {
	// Step 1 — FIRST, before anything is read or written. Same reason as
	// `applyMode`'s own step 1.
	await ctx.waitForIdle();

	// Step 2 — resolve + pick a configured candidate. The CURRENT mode is
	// preserved either way; only `escalated` reflects the target state.
	const state = getModeState();
	const route = resolveRoute("executor", { mode: state.mode, escalated: escalate });
	const candidate = pickConfiguredCandidate(ctx.modelRegistry, route.candidates);
	if (!candidate.ok) {
		ctx.ui.notify(
			`cannot ${escalate ? "escalate" : "clear escalation"}: ${candidate.reason}`,
			"error",
		);
		return;
	}

	// Step 3 — the capability guard, scoped to a tool-loop role exactly like
	// `applyMode`'s own step 3 (an executor is a tool-loop role by definition).
	const guardVerdict = guardRoute(candidate.model, "executor", { usesToolLoop: true });
	if (!guardVerdict.ok) {
		ctx.ui.notify(guardVerdict.reason, "error");
		return;
	}

	// Captured BEFORE the mutation, for the durable record below -- this is
	// what "previous" means in that record.
	const previousModel = ctx.model !== undefined ? `${ctx.model.provider}/${ctx.model.id}` : undefined;

	// Step 4 — the mutation. Both failure modes are surfaced, neither is
	// swallowed, neither is followed by silently trying something else --
	// same discipline as `applyMode`'s own step 4.
	let switched: boolean;
	try {
		switched = await pi.setModel(candidate.model);
	} catch (err) {
		ctx.ui.notify(
			`setModel threw switching executor to ${candidate.model.provider}/${candidate.model.id}: ${String(err)}`,
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

	// Step 5 — only reached after a true return. The state must not claim an
	// escalation that never took effect (T-05-33) -- `setEscalated` runs only
	// here, never before the switch is known to have succeeded.
	setEscalated(escalate, escalate ? state.mode : undefined);

	const modeData: KyModeData = {
		mode: state.mode,
		escalated: escalate,
		escalatedFrom: escalate ? state.mode : undefined,
		at: Date.now(),
	};
	pi.appendEntry(MODE_ENTRY_TYPE, modeData);

	// The durable, explanatory record -- see writeEscalationRecord's own doc
	// comment. Best-effort: this call can never turn the switch above, which
	// already succeeded, into a reported failure.
	writeEscalationRecord(ctx.cwd, {
		mode: state.mode,
		escalated: escalate,
		previousModel,
		newModel: `${candidate.model.provider}/${candidate.model.id}`,
	});

	// Cross-subsystem signalling is an event, never an import -- see the
	// module docstring.
	pi.events.emit(ROUTING_EVENT, {
		mode: state.mode,
		escalated: escalate,
		model: `${candidate.model.provider}/${candidate.model.id}`,
	});

	// Step 6 — the outcome, in one message.
	ctx.ui.notify(
		escalate
			? `escalated -- executor is now ${candidate.model.provider}/${candidate.model.id} (from ${state.mode}).`
			: `escalation cleared -- executor restored to ${state.mode}'s own model: ` +
				`${candidate.model.provider}/${candidate.model.id}.`,
		"info",
	);
}

/**
 * The read-only `/mode` status command (criterion 2's "visible" half in the
 * only surface this phase owns — Phase 11 renders the statusline from
 * `ROUTING_EVENT` instead). Prints the current mode, whether `/escalate` is
 * active and from which mode, the concrete `provider/id` currently serving
 * the executor, and — for every OTHER role — the model it would resolve to
 * right now, so the executor-only scope of escalation (ROUTE-08's own
 * boundary, restated for a human reading this output rather than a test) is
 * visible in one place. Never touches a session's model or writes anything;
 * it only reads `getModeState()` and resolves candidates the same way
 * `applyMode`/`applyEscalate` do, through `resolveRoute` +
 * `pickConfiguredCandidate`.
 */
async function reportMode(ctx: ExtensionCommandContext): Promise<void> {
	const state = getModeState();

	const lines: string[] = [
		state.escalated
			? `mode: ${state.mode} (escalated from ${state.escalatedFrom ?? state.mode})`
			: `mode: ${state.mode} (not escalated)`,
		`executor: ${ctx.model !== undefined ? `${ctx.model.provider}/${ctx.model.id}` : "(no model selected)"}`,
	];

	for (const role of ROLES) {
		if (role === "executor") {
			// Already reported above, from the session's real `ctx.model` rather
			// than a re-derived candidate -- see the module docstring.
			continue;
		}
		const route = resolveRoute(role, state);
		const candidate = pickConfiguredCandidate(ctx.modelRegistry, route.candidates);
		lines.push(
			`${role}: ${candidate.ok ? `${candidate.model.provider}/${candidate.model.id}` : `unavailable (${candidate.reason})`}`,
		);
	}

	ctx.ui.notify(lines.join("\n"), "info");
}

/** Whether `value` is a member of {@link MODES} -- narrows an `unknown` string before it is trusted as a {@link ModeName}. */
function isModeName(value: unknown): value is ModeName {
	return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

/**
 * Restore the mode name and `/escalate` bookkeeping from a session's branch
 * (ROUTE-09's restart half). See the module docstring's "RESTORE ON
 * `session_start`" section for the full recipe, the citation trail, and why
 * this deliberately never touches the executor model.
 *
 * `branch` is `ctx.sessionManager.getBranch()`'s own return type, root-to-leaf
 * path order -- `getBranch` is not itself type-narrowed by Pi, so every
 * caller (this function, and every test that exercises it directly) filters
 * for `type === "custom" && customType === MODE_ENTRY_TYPE` before trusting
 * an entry's shape at all.
 *
 * Exported as a plain function of `branch`, never of `ctx`, so {@link
 * mode-persistence.test.ts} can call it directly against a real branch
 * without waiting for `session_start` to fire -- an event this repository's
 * own headless test harness cannot trigger (module docstring, same section).
 *
 * NEVER THROWS on a malformed payload -- an invalid `mode` falls back to
 * {@link DEFAULT_MODE} (T-05-36) rather than propagating, and an invalid or
 * missing `escalatedFrom` is dropped (the escalation flag itself is still
 * honoured, but nothing to restore it FROM is trusted). The caller (the
 * `session_start` hook below) ALSO wraps this in its own `try`/`catch`, so a
 * defect in this function's own logic is still contained -- defense in depth
 * for T-05-39, not a substitute for it.
 */
export function restoreModeFromBranch(branch: readonly SessionEntry[]): void {
	const modeEntries = branch.filter(
		(entry): entry is CustomEntry<KyModeData> => entry.type === "custom" && entry.customType === MODE_ENTRY_TYPE,
	);
	const latest = modeEntries.at(-1);
	// WR-04: `latest?.data === undefined` does NOT catch `data: null` --
	// `null === undefined` is `false` in JavaScript, so a malformed payload of
	// exactly `{ data: null }` used to fall through to `isModeName(data.mode)`
	// and dereference `null`, throwing a TypeError straight past this
	// function's own "NEVER THROWS" doc comment (the `session_start` wrapper's
	// `catch` contained the damage there, but the exported function's stated
	// contract -- the thing every direct caller and every test reads -- was
	// false). Checking `typeof latest.data !== "object"` catches `null` (whose
	// typeof IS "object" in JS) via the explicit `=== null` arm first, and
	// catches every other non-object payload shape (a bare string, a number)
	// in the same branch.
	if (latest === undefined || latest.data === null || typeof latest.data !== "object") {
		// Nothing persisted yet on this branch, or the payload is not an
		// object at all -- the module's own getModeState() default
		// (DEFAULT_MODE, not escalated) already covers this case; there is
		// nothing to restore.
		return;
	}

	const data = latest.data;
	// T-05-36 -- validate before trusting. A mode that is not a member of
	// MODES is ignored in favour of DEFAULT_MODE rather than propagated.
	const mode: ModeName = isModeName(data.mode) ? data.mode : DEFAULT_MODE;
	const escalated = data.escalated === true;
	const escalatedFrom = escalated && isModeName(data.escalatedFrom) ? data.escalatedFrom : undefined;

	setMode(mode);
	setEscalated(escalated, escalatedFrom);
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

	// Argument parsing is exact and unforgiving -- see ESCALATION IS STICKY,
	// VISIBLE, AND RECORDED above and `applyEscalate`'s own doc comment.
	// Anything other than empty/"on"/"off" is refused, naming the accepted
	// forms, rather than being silently treated as "on".
	pi.registerCommand("escalate", {
		description: "Lift the executor to the strongest configured model, sticky until `escalate off` clears it",
		handler: async (args, ctx) => {
			const arg = args.trim();
			if (arg !== "" && arg !== "on" && arg !== "off") {
				ctx.ui.notify(
					`escalate: unrecognized argument ${JSON.stringify(arg)} -- accepted forms are: "" (same as "on"), "on", "off"`,
					"error",
				);
				return;
			}
			await applyEscalate(pi, ctx, arg !== "off");
		},
	});

	pi.registerCommand("mode", {
		description: "Show the current mode, escalation state, and every role's resolved route",
		handler: async (_args, ctx) => {
			await reportMode(ctx);
		},
	});

	// ROUTE-09's restart half. Best-effort, mirroring safety/index.ts's own
	// session_start pruning hook (safety/index.ts:832-838): a restore failure
	// must never stop the session from starting (T-05-39). See the module
	// docstring's "RESTORE ON session_start" section and
	// restoreModeFromBranch's own doc comment for the full recipe.
	pi.on("session_start", (_event, ctx) => {
		try {
			restoreModeFromBranch(ctx.sessionManager.getBranch());
		} catch {
			// Swallowed deliberately -- see the comment above.
		}
	});
}
