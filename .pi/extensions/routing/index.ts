/**
 * Routing entry point: `/cheap`, `/balanced`, `/max`, `/escalate` and `/mode`.
 * The only routing file that touches a live session; registers commands only (never a tool, never a direct model call).
 */
import type {
	CustomEntry,
	ExtensionAPI,
	ExtensionCommandContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";

import { appendJsonl } from "../../lib/jsonl.ts";
import { agentOverridesFor, writeAgentOverrides, type AgentOverridesForOptions } from "./agent-overrides.ts";
import { guardRoute } from "./guard.ts";
import { getModeState, pickConfiguredCandidate, resolveRoute, setEscalated, setMode, type ModeState } from "./modes.ts";
import { DEFAULT_MODE, MODE_ENTRY_TYPE, MODES, ROLES, ROUTING_EVENT, type KyModeData, type ModeName } from "./schema.ts";

/** Test-only seam threaded to `agentOverridesFor` so integration tests can inject a guard-blocked planner. */
export interface RoutingTestOptions {
	readonly agentOverridesFor?: AgentOverridesForOptions;
}

/**
 * Shared path for the three mode commands. Order is the requirement: idle first (`waitForIdle` exists only on
 * `ExtensionCommandContext`, `dist/core/extensions/types.d.ts:258`), then resolve, guard, `setModel`, persist, notify.
 * An explicit mode pick clears any sticky escalation.
 */
async function applyMode(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	mode: ModeName,
	testOverrides?: RoutingTestOptions,
): Promise<void> {
	await ctx.waitForIdle();

	const priorState = getModeState();
	const previousModel = ctx.model !== undefined ? `${ctx.model.provider}/${ctx.model.id}` : undefined;

	// Escalation is cleared by every explicit mode pick.
	const state: ModeState = { mode, escalated: false };
	const route = resolveRoute("executor", state);
	const candidate = pickConfiguredCandidate(ctx.modelRegistry, route.candidates);
	if (!candidate.ok) {
		ctx.ui.notify(`cannot switch to ${mode}: ${candidate.reason}`, "error");
		return;
	}

	const guardVerdict = guardRoute(candidate.model, "executor", { usesToolLoop: true });
	if (!guardVerdict.ok) {
		ctx.ui.notify(guardVerdict.reason, "error");
		return;
	}

	// `setModel` returns false without auth (`dist/core/agent-session.js:1885-1890`) and can throw in a TOCTOU window (`:1197-1209`);
	// surface both, never silently try another model.
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

	// A pin-derivation refusal is carried into the final message, never written anyway.
	setMode(mode);
	setEscalated(false);

	const modeData: KyModeData = { mode, escalated: false, at: Date.now() };
	pi.appendEntry(MODE_ENTRY_TYPE, modeData);

	// Clearing a real escalation needs a durable record, else escalation-*.jsonl shows ON and never OFF.
	if (priorState.escalated) {
		writeEscalationRecord(ctx.cwd, {
			mode,
			escalated: false,
			previousModel,
			newModel: `${candidate.model.provider}/${candidate.model.id}`,
		});
	}

	let overridesNote = "";
	const overridesResult = agentOverridesFor({ mode }, testOverrides?.agentOverridesFor);
	if (!overridesResult.ok) {
		overridesNote = ` subagent pins unchanged because ${overridesResult.reason}`;
	} else {
		const writeResult = writeAgentOverrides(overridesResult.overrides);
		if (!writeResult.ok) {
			overridesNote = ` subagent pins unchanged because ${writeResult.reason}`;
		}
	}

	pi.events.emit(ROUTING_EVENT, {
		mode,
		escalated: false,
		model: `${candidate.model.provider}/${candidate.model.id}`,
	});

	ctx.ui.notify(
		`mode switched to ${mode}; executor is now ${candidate.model.provider}/${candidate.model.id}.` +
			overridesNote,
		"info",
	);
}

/** Routing-owned JSONL base name; never pruned because writes are rare. */
const ESCALATION_LOG_BASE = "escalation";

/**
 * NEVER THROWS: best-effort record, written after `setModel` succeeded so a failed write cannot turn a switch into an error.
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
		// Best-effort.
	}
}

/** `/escalate` two-way switch; a separate function from `applyMode` because it never calls `setMode` and resolves with `escalated: escalate`. */
async function applyEscalate(pi: ExtensionAPI, ctx: ExtensionCommandContext, escalate: boolean): Promise<void> {
	await ctx.waitForIdle();

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

	const guardVerdict = guardRoute(candidate.model, "executor", { usesToolLoop: true });
	if (!guardVerdict.ok) {
		ctx.ui.notify(guardVerdict.reason, "error");
		return;
	}

	const previousModel = ctx.model !== undefined ? `${ctx.model.provider}/${ctx.model.id}` : undefined;

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

	// State must not claim an escalation that never took effect.
	setEscalated(escalate, escalate ? state.mode : undefined);

	const modeData: KyModeData = {
		mode: state.mode,
		escalated: escalate,
		escalatedFrom: escalate ? state.mode : undefined,
		at: Date.now(),
	};
	pi.appendEntry(MODE_ENTRY_TYPE, modeData);

	writeEscalationRecord(ctx.cwd, {
		mode: state.mode,
		escalated: escalate,
		previousModel,
		newModel: `${candidate.model.provider}/${candidate.model.id}`,
	});

	pi.events.emit(ROUTING_EVENT, {
		mode: state.mode,
		escalated: escalate,
		model: `${candidate.model.provider}/${candidate.model.id}`,
	});

	ctx.ui.notify(
		escalate
			? `escalated -- executor is now ${candidate.model.provider}/${candidate.model.id} (from ${state.mode}).`
			: `escalation cleared -- executor restored to ${state.mode}'s own model: ` +
				`${candidate.model.provider}/${candidate.model.id}.`,
		"info",
	);
}

/** Read-only `/mode` status: mode, escalation, and each role's resolved model. */
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
			// Executor is reported above from the real `ctx.model`.
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

/** Narrows an unknown string to a {@link ModeName}. */
function isModeName(value: unknown): value is ModeName {
	return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

/**
 * Restores mode name and escalation bookkeeping from a session branch (root-to-leaf).
 * Deliberately never calls `setModel`: Pi already restores the executor from its native `model_change` entry
 * (`dist/core/agent-session.js:1204`, `dist/core/session-manager.js:146-161`); a second source of truth could disagree.
 * NEVER THROWS on a malformed payload: an invalid mode falls back to {@link DEFAULT_MODE}, an invalid `escalatedFrom` is dropped.
 * `session_start` does not fire in a headless `createAgentSession` (see `tests/integration/call-model.test.ts`), so tests call this directly.
 */
export function restoreModeFromBranch(branch: readonly SessionEntry[]): void {
	const modeEntries = branch.filter(
		(entry): entry is CustomEntry<KyModeData> => entry.type === "custom" && entry.customType === MODE_ENTRY_TYPE,
	);
	const latest = modeEntries.at(-1);
	// `null` passes a bare `=== undefined` check, so reject it and every non-object payload explicitly (contract: never throws).
	if (latest === undefined || latest.data === null || typeof latest.data !== "object") {
		return;
	}

	const data = latest.data;
	// Validate before trusting: a hand-edited session file must not smuggle in an unresolvable mode.
	const mode: ModeName = isModeName(data.mode) ? data.mode : DEFAULT_MODE;
	const escalated = data.escalated === true;
	const escalatedFrom = escalated && isModeName(data.escalatedFrom) ? data.escalatedFrom : undefined;

	setMode(mode);
	setEscalated(escalated, escalatedFrom);
}

/** `testOverrides` is the test-only seam; production calls this with one argument. */
export default function (pi: ExtensionAPI, testOverrides?: RoutingTestOptions): void {
	for (const mode of MODES) {
		pi.registerCommand(mode, {
			description: `Switch the executor and subagent pins to ${mode}`,
			handler: async (_args, ctx) => {
				await applyMode(pi, ctx, mode, testOverrides);
			},
		});
	}

	// Anything but empty/on/off is refused rather than treated as on.
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

	// Best-effort like safety/index.ts's session_start prune: a bad payload must not stop session start.
	pi.on("session_start", (_event, ctx) => {
		try {
			restoreModeFromBranch(ctx.sessionManager.getBranch());
		} catch {
			// Swallowed deliberately.
		}
	});
}
