/**
 * Routing entry point: `/cheap`, `/balanced`, `/max`, `/escalate` and `/mode`.
 * The only routing file that touches a live session; registers commands, a flag and the `bg_enable` loader, and narrows
 * the active tool set to the profile without ever removing a declared tool (never a direct model call).
 */
import type {
	CustomEntry,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { getCurrentTools, type Api, type Model } from "@earendil-works/pi-ai";

import { appendJsonl, ESCALATION_LOG_BASE } from "../../lib/jsonl.ts";
import { agentOverridesFor, plannerPinHeld, readAgentOverride, restorePlannerPin, writeAgentOverrides, type AgentOverridesForOptions } from "./agent-overrides.ts";
import { deriveNeed, guardRoute } from "./guard.ts";
import { registerBgLoader } from "./loader.ts";
import { freshSessionPlan, getModeState, isModeName, pickConfiguredCandidate, resolveRoute, setEscalated, setMode, type ModeState } from "./modes.ts";
import { applyProfile, DEFAULT_PROFILE, hasExplicitToolAllowlist, resolveProfile } from "./profiles.ts";
import { AGENT_NAME_BY_ROLE, DEFAULT_MODE, MODE_ENTRY_TYPE, MODES, ROLES, ROUTING_EVENT, type KyModeData, type ModeName } from "./schema.ts";

const REVERTING_KEY = "__kypiRoutingReverting";
/** pi-subagents 0.76.1 sets this in every child it launches (`src/runs/shared/child-runtime-config.js:6`); a child never owns the parent's pin. */
const isSubagentChild = (): boolean => process.env.PI_SUBAGENT_CHILD === "1";

/** Test-only seam threaded to `agentOverridesFor` so integration tests can inject a guard-blocked planner. */
export interface RoutingTestOptions {
	readonly agentOverridesFor?: AgentOverridesForOptions;
}

const refOf = (model: { readonly provider: string; readonly id: string }): string => `${model.provider}/${model.id}`;

interface Switched {
	readonly model: Model<Api>;
	readonly previousModel: string | undefined;
}

/**
 * Resolves, guards and sets the executor for `state`; a refusal comes back as text and another model is never tried.
 * `keepCurrent` skips `setModel` when the executor already is the target.
 */
async function switchExecutor(pi: ExtensionAPI, ctx: ExtensionContext, state: ModeState, keepCurrent = false): Promise<Switched | string> {
	const candidate = pickConfiguredCandidate(ctx.modelRegistry, resolveRoute("executor", state).candidates);
	if (!candidate.ok) return candidate.reason;
	const previousModel = ctx.model === undefined ? undefined : refOf(ctx.model);
	const target = refOf(candidate.model);
	if (keepCurrent && previousModel === target) return { model: candidate.model, previousModel };
	const verdict = guardRoute(candidate.model, "executor", deriveNeed(ctx, { usesToolLoop: true }));
	if (!verdict.ok) return verdict.reason;
	// `setModel` returns false without auth (`dist/core/agent-session.js#setModel`) and can throw in a TOCTOU window.
	try {
		return (await pi.setModel(candidate.model)) ? { model: candidate.model, previousModel } : `setModel returned false for ${target} -- no configured auth`;
	} catch (err) {
		return `setModel threw switching to ${target}: ${String(err)}`;
	}
}

/** NEVER THROWS: best-effort record, written after `setModel` succeeded so a failed write cannot turn a switch into an error. */
function writeEscalationRecord(
	cwd: string,
	input: { mode: ModeName; escalated: boolean; previousModel: string | undefined; newModel: string },
): void {
	try {
		appendJsonl(cwd, ESCALATION_LOG_BASE, { ts: Date.now(), ...input });
	} catch {
		// Best-effort.
	}
}

/** Persists the switch, logs it to escalation-*.jsonl when `log`, and announces it. */
function recordSwitch(pi: ExtensionAPI, cwd: string, data: KyModeData, switched: Switched, log: boolean): void {
	pi.appendEntry(MODE_ENTRY_TYPE, data);
	const newModel = refOf(switched.model);
	if (log) writeEscalationRecord(cwd, { mode: data.mode, escalated: data.escalated, previousModel: switched.previousModel, newModel });
	pi.events.emit(ROUTING_EVENT, { mode: data.mode, escalated: data.escalated, model: newModel });
}

/**
 * Idle first: `waitForIdle` exists only on `ExtensionCommandContext` (`dist/core/extensions/types.d.ts`). An explicit mode pick
 * clears any sticky escalation and re-pins the subagents; a pin refusal is reported, never written anyway.
 */
async function applyMode(pi: ExtensionAPI, ctx: ExtensionCommandContext, mode: ModeName, testOverrides?: RoutingTestOptions): Promise<void> {
	await ctx.waitForIdle();
	const wasEscalated = getModeState().escalated;
	const switched = await switchExecutor(pi, ctx, { mode, escalated: false });
	if (typeof switched === "string") return ctx.ui.notify(`cannot switch to ${mode}: ${switched}`, "error");
	setMode(mode);
	setEscalated(false);
	// Clearing a real escalation needs a durable record, else escalation-*.jsonl shows ON and never OFF.
	recordSwitch(pi, ctx.cwd, { mode, escalated: false, at: Date.now() }, switched, wasEscalated);

	const pins = agentOverridesFor({ mode }, { ...testOverrides?.agentOverridesFor, registry: ctx.modelRegistry });
	const written = pins.ok ? writeAgentOverrides(pins.overrides) : pins;
	const pinNote = written.ok ? "" : ` subagent pins unchanged because ${written.reason}`;
	ctx.ui.notify(`mode switched to ${mode}; executor is now ${refOf(switched.model)}.${pinNote}`, "info");
}

/** `/escalate` two-way switch: never changes the mode, only whether its executor is lifted. */
async function applyEscalate(pi: ExtensionAPI, ctx: ExtensionCommandContext, escalate: boolean): Promise<void> {
	await ctx.waitForIdle();
	const { mode } = getModeState();
	const switched = await switchExecutor(pi, ctx, { mode, escalated: escalate });
	if (typeof switched === "string") return ctx.ui.notify(`cannot ${escalate ? "escalate" : "clear escalation"}: ${switched}`, "error");
	// Set only after the switch took effect, so state never claims an escalation that did not happen.
	const escalatedFrom = escalate ? mode : undefined;
	setEscalated(escalate, escalatedFrom);
	recordSwitch(pi, ctx.cwd, { mode, escalated: escalate, escalatedFrom, at: Date.now() }, switched, true);
	const target = refOf(switched.model);
	ctx.ui.notify(
		escalate
			? `escalated -- executor is now ${target} (from ${mode}).`
			: `escalation cleared -- executor restored to ${mode}'s own model: ${target}.`,
		"info",
	);
}

/** Read-only `/mode` status: mode, escalation, and each role's resolved model. */
function reportMode(ctx: ExtensionCommandContext): void {
	const state = getModeState();
	const lines = [
		state.escalated ? `mode: ${state.mode} (escalated from ${state.escalatedFrom ?? state.mode})` : `mode: ${state.mode} (not escalated)`,
		`executor: ${ctx.model === undefined ? "(no model selected)" : refOf(ctx.model)}`,
	];
	const expectedPins = agentOverridesFor({ mode: state.mode }, { registry: ctx.modelRegistry });
	for (const role of ROLES) {
		if (role === "executor") continue;
		const candidate = pickConfiguredCandidate(ctx.modelRegistry, resolveRoute(role, state).candidates);
		const routed = candidate.ok ? refOf(candidate.model) : undefined;
		const agent = AGENT_NAME_BY_ROLE[role];
		// pi-subagents runs whatever the shared settings file pins, which another session may have written since.
		const pinned = agent === undefined ? undefined : readAgentOverride(agent);
		const expected = agent === undefined || !expectedPins.ok ? routed : expectedPins.overrides[agent]?.model;
		const runs = pinned !== undefined && pinned !== expected ? ` -- but subagents run ${pinned}, pinned in the user settings; re-run /${state.mode} to re-pin` : "";
		lines.push(`${role}: ${candidate.ok ? routed : `unavailable (${candidate.reason})`}${runs}`);
	}
	ctx.ui.notify(lines.join("\n"), "info");
}

/**
 * Restores mode name and escalation bookkeeping from a session branch (root-to-leaf).
 * Deliberately never calls `setModel`: Pi already restores the executor from its native `model_change` entry
 * (pi 1.1.0 `dist/core/session-manager.js:146-161`); a second source of truth could disagree.
 * NEVER THROWS on a malformed payload: an invalid mode falls back to {@link DEFAULT_MODE}, an invalid `escalatedFrom` is dropped.
 * Exported because `session_start` does not fire in a headless `createAgentSession`.
 */
export function restoreModeFromBranch(branch: readonly SessionEntry[]): void {
	const latest = branch.findLast(
		(entry): entry is CustomEntry<KyModeData> => entry.type === "custom" && entry.customType === MODE_ENTRY_TYPE,
	);
	const data: unknown = latest?.data;
	if (data === null || typeof data !== "object") return;
	// A hand-edited session file must not smuggle in an unresolvable mode.
	const { mode, escalated, escalatedFrom } = data as Partial<Record<keyof KyModeData, unknown>>;
	setMode(isModeName(mode) ? mode : DEFAULT_MODE);
	setEscalated(escalated === true, escalated === true && isModeName(escalatedFrom) ? escalatedFrom : undefined);
}

/** Puts the default mode's executor on a fresh session; any refusal leaves the model alone and says why once. NEVER THROWS. */
async function applyDefaultExecutor(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const switched = await switchExecutor(pi, ctx, { mode: DEFAULT_MODE, escalated: false }, true).catch((err: unknown) => String(err));
	// NEVER THROWS: a failed notice must not fail session start.
	try {
		if (typeof switched === "string" && ctx.hasUI) ctx.ui.notify(`default mode ${DEFAULT_MODE}: executor not applied: ${switched}`, "warning");
	} catch {
		// Swallowed deliberately.
	}
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
		handler: async (_args, ctx) => reportMode(ctx),
	});

	// Pi fires model_select after the switch and ignores the return value, so enforcement is undo plus refuse.
	pi.on("model_select", async (event, ctx) => {
		const slot = globalThis as Record<string, unknown>;
		if (slot[REVERTING_KEY] === true || event.source === "restore") return;
		// NEVER THROWS: a guard bug must not break a model switch Pi already completed.
		try {
			const need = deriveNeed(ctx, { usesToolLoop: true });
			const verdict = guardRoute(event.model, "executor", need);
			if (verdict.ok) return;
			const ref = refOf(event.model);
			// Pi resets thinking to the default on every switch, so the user cannot turn it off first; turning it off here is the only way in.
			if (guardRoute(event.model, "executor", { ...need, thinkingRequested: false }).ok) {
				pi.setThinkingLevel("off");
				ctx.ui.notify(`${ref} receives no thinking field on Bedrock, so thinking is now off for it.`, "warning");
				return;
			}
			const settings = pi.getSettings();
			const savedDefault =
				settings.defaultProvider === event.model.provider && settings.defaultModel === event.model.id
					? ` ${ref} is still saved as your default model, so the next start boots on it; pick another default in /model.`
					: "";
			const previous = event.previousModel;
			if (previous === undefined || !guardRoute(previous, "executor", need).ok) {
				ctx.ui.notify(`${verdict.reason}. Switch to a capable model with /cheap, /balanced or /max.${savedDefault}`, "error");
				return;
			}
			const back = refOf(previous);
			slot[REVERTING_KEY] = true;
			let reverted: boolean | string;
			try {
				reverted = await pi.setModel(previous);
			} catch (err) {
				reverted = String(err);
			} finally {
				slot[REVERTING_KEY] = false;
			}
			ctx.ui.notify(
				reverted === true
					? `${verdict.reason}. Reverted to ${back}; thinking is now ${pi.getThinkingLevel()}.${savedDefault}`
					: `${verdict.reason}. Reverting to ${back} failed (${reverted === false ? "no configured auth" : reverted}); switch with /cheap, /balanced or /max.${savedDefault}`,
				"error",
			);
		} catch {
			return;
		}
	});
	// Covers a restored session whose model fails the guard, and any switch the revert could not undo.
	pi.on("input", (event, ctx) => {
		// NEVER THROWS: a guard bug must not block a prompt.
		try {
			// Extension prompts are checked too; a refused workflow run stays pending and records nothing.
			if (ctx.model === undefined) return;
			const need = deriveNeed(ctx, { usesToolLoop: true, promptChars: event.text.length, image: (event.images?.length ?? 0) > 0 });
			// An overfull context is left to Pi's own compaction and retry; only the other three blocks refuse a prompt.
			const verdict = guardRoute(ctx.model, "executor", { ...need, estimatedInputTokens: undefined });
			if (verdict.ok) {
				if (!guardRoute(ctx.model, "executor", need).ok) ctx.ui.notify(`about ${need.estimatedInputTokens} tokens against a ${ctx.model.contextWindow}-token window; run /compact if Pi does not compact first.`, "warning");
				return;
			}
			ctx.ui.notify(`${verdict.reason}. Prompt not sent; switch with /cheap, /balanced or /max.`, "error");
			return { action: "handled" as const };
		} catch {
			return;
		}
	});
	registerBgLoader(pi);
	pi.registerFlag("ky-profile", { description: "Tool profile: recon, review, implement (default) or full", type: "string", default: "implement" });
	// Pi gives extensions no view of a `--tools` allowlist, so read argv; the user's named tools must never be narrowed.
	const narrow = (active: readonly string[]) => (hasExplicitToolAllowlist(process.argv) ? undefined : applyProfile(active, resolveProfile(pi.getFlag("ky-profile"))));
	pi.on("session_start", async (event, ctx) => {
		let applying: Promise<void> | undefined;
		// NEVER THROWS: a bad payload must not stop session start.
		try {
			const branch = ctx.sessionManager.getBranch();
			const hasMessages = branch.some((entry) => entry.type === "message");
			const plan = freshSessionPlan({
				reason: event.reason,
				hasModeEntry: branch.some((entry) => entry.type === "custom" && entry.customType === MODE_ENTRY_TYPE),
				hasMessages,
				isChild: isSubagentChild(),
				argv: process.argv,
			});
			// A process outlives /new, so mode state from the previous session must not carry over.
			if (plan.reset) {
				setMode(DEFAULT_MODE);
				setEscalated(false);
			}
			// Pins whose owners have all ended are undone; while another session's pin stands, this one writes its own mode's, default included.
			const pinBookkeeping = event.reason !== "reload" && !isSubagentChild();
			if (pinBookkeeping) restorePlannerPin();
			restoreModeFromBranch(branch);
			if (pinBookkeeping && (getModeState().mode !== DEFAULT_MODE || plannerPinHeld())) {
				const pins = agentOverridesFor({ mode: getModeState().mode }, { ...testOverrides?.agentOverridesFor, registry: ctx.modelRegistry });
				if (pins.ok) writeAgentOverrides(pins.overrides);
			}
			if (plan.reset && plan.applyExecutor) applying = applyDefaultExecutor(pi, ctx);
			const flag = pi.getFlag("ky-profile");
			if (typeof flag === "string" && resolveProfile(flag) !== flag && ctx.hasUI) ctx.ui.notify(`unknown --ky-profile "${flag}"; using ${DEFAULT_PROFILE}`, "warning");
			// A transcript already declared its tools (Pi restores them before session_start); removing any re-prices the cached prefix.
			if (event.reason === "reload" || hasMessages) return;
			const next = narrow(pi.getActiveTools());
			if (next !== undefined) pi.setActiveTools(next);
		} catch {
			// Swallowed deliberately.
		} finally {
			await applying;
		}
	});
	// The pin lives in the user-level settings file shared by every repo, so it ends with the session.
	pi.on("session_shutdown", (event) => {
		if (event.reason === "reload" || isSubagentChild()) return;
		// NEVER THROWS: a settings file that cannot be restored must not stop the session from ending.
		try {
			restorePlannerPin();
		} catch {
			// Best-effort.
		}
	});
	// Drop out-of-profile tools not yet declared (no removal recorded); `input` precedes before_agent_start, so no prompt section sees them.
	pi.on("input", (_event, ctx) => {
		// NEVER THROWS: a failed narrowing must not block the prompt; the wider loadout is the safe fallback.
		try {
			const active = pi.getActiveTools();
			const next = ctx.isIdle() ? narrow(active) : undefined;
			if (next === undefined) return;
			const declared = new Set(getCurrentTools(ctx.sessionManager.buildSessionProjection().messages).map((t) => t.name));
			const kept = active.filter((name) => next.includes(name) || declared.has(name));
			if (kept.length !== active.length) pi.setActiveTools(kept);
		} catch {
			// Swallowed deliberately.
		}
	});
}
