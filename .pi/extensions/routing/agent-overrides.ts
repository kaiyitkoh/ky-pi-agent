/**
 * Derives and writes `settings.subagents.agentOverrides` so a mode switch swaps the whole role-to-model map, not just the executor.
 * Writes the GLOBAL agent settings: the project `.pi/settings.json` is tracked and would dirty `git status`, and headless
 * subagents never get project trust. Chokepoint-lint scans comments, so no model route is named.
 * Shape `{ subagents: { agentOverrides: { <agent>: { model: "<provider>/<id>" } } } }` is unverified against the pinned `pi-subagents` schema.
 */
import type { Model } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

import { guardRoute } from "./guard.ts";
import { agentSettingsPath, resolveBedrockRef, type ModelRegistryLike } from "./modes.ts";
import { AGENT_NAME_BY_ROLE, type KyModeData, type ModelRef, ROLE_MAP, ROLE_MECHANISM, type Role } from "./schema.ts";

/** Structural fixture for `guardRoute`, no registry lookup. Sound because only `usesToolLoop` is set, so only the tool-loop deny-list block can fire; inert fields keep any new block failing safe. */
function candidateAsModelFixture(candidate: ModelRef): Model<"openai-completions"> {
	return {
		id: candidate.id,
		name: candidate.id,
		api: "openai-completions",
		provider: candidate.provider,
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: Number.MAX_SAFE_INTEGER,
		maxTokens: 0,
	};
}

/** The whole derived override object, keyed by agent name. */
export type AgentOverrides = Record<string, { readonly model: string }>;

export type AgentOverridesResult =
	| { readonly ok: true; readonly overrides: AgentOverrides }
	| { readonly ok: false; readonly reason: string };

/** Test-only seam so a fixture role map can be guard-blocked without mutating the shared `ROLE_MAP`. */
export interface AgentOverridesForOptions {
	readonly roleMap?: typeof ROLE_MAP;
	readonly roleMechanism?: typeof ROLE_MECHANISM;
	readonly agentNameByRole?: typeof AGENT_NAME_BY_ROLE;
	/** Settings file the Bedrock inference-profile prefix is read from. */
	readonly settingsPath?: string;
	/** When given, a candidate that resolves and has configured auth is preferred over the first guard-passing one. */
	readonly registry?: ModelRegistryLike;
}

/**
 * Derives the override object for `state.mode`: the first candidate per subagent role that passes `guardRoute` (`usesToolLoop: true`).
 * Returns `ok:false` with the last refusal when every candidate is blocked; callers must not write on `ok:false`.
 * Auth is checked only when a registry is passed, and only to prefer a usable candidate over an unusable one.
 */
export function agentOverridesFor(state: Pick<KyModeData, "mode">, opts: AgentOverridesForOptions = {}): AgentOverridesResult {
	const roleMechanism = opts.roleMechanism ?? ROLE_MECHANISM;
	const agentNameByRole = opts.agentNameByRole ?? AGENT_NAME_BY_ROLE;
	const modeMap = (opts.roleMap ?? ROLE_MAP)[state.mode];
	const { registry } = opts;
	const overrides: Record<string, { model: string }> = {};

	for (const roleKey of Object.keys(roleMechanism) as Role[]) {
		if (roleMechanism[roleKey] !== "subagent") continue;
		const agentName = agentNameByRole[roleKey];
		// A schema authoring bug; refuse rather than omit the role.
		if (agentName === undefined) {
			return { ok: false, reason: `role "${roleKey}" is ROLE_MECHANISM.subagent but has no AGENT_NAME_BY_ROLE entry` };
		}

		let lastReason = `no candidates configured for role "${roleKey}" in mode "${state.mode}"`;
		let picked: string | undefined;
		for (const candidate of modeMap[roleKey].candidates) {
			const resolved = resolveBedrockRef(candidate, opts.settingsPath);
			if (!resolved.ok) {
				lastReason = resolved.reason;
				continue;
			}
			const verdict = guardRoute(candidateAsModelFixture(resolved.ref), roleKey, { usesToolLoop: true });
			if (!verdict.ok) {
				lastReason = verdict.reason;
				continue;
			}
			const ref = `${resolved.ref.provider}/${resolved.ref.id}`;
			picked ??= ref;
			const model = registry?.find(resolved.ref.provider, resolved.ref.id);
			if (registry === undefined || (model !== undefined && registry.hasConfiguredAuth(model))) {
				picked = ref;
				break;
			}
		}

		if (picked === undefined) {
			return { ok: false, reason: `role "${roleKey}": every candidate is guard-blocked (${lastReason})` };
		}
		overrides[agentName] = { model: picked };
	}
	return { ok: true, overrides };
}

export interface AgentOverridesPathOptions {
	/** Injected path, for tests. */
	settingsPath?: string;
	/** The pin owner recorded in the marker; defaults to this process. */
	pid?: number;
	/** Liveness probe for recorded owners; defaults to `process.kill(pid, 0)`. */
	isAlive?: (pid: number) => boolean;
	/** Injected clock, for tests. */
	now?: number;
}

/** Target settings path: `opts.settingsPath` if given, else the global agent `settings.json`. */
export function resolveSettingsPath(opts: AgentOverridesPathOptions = {}): string {
	return opts.settingsPath ?? agentSettingsPath();
}

const PLANNER_PIN_MARKER = "plannerPinRestore";

/** A session holding the pin, and when it last wrote it. */
interface PinOwner {
	readonly pid: number;
	readonly at: number;
}

/** Per pinned agent key, its value before the first pin; `owners` are the sessions that still hold the pin. */
interface PinMarker {
	readonly hadOverrides: boolean;
	readonly keys: Record<string, { readonly had: boolean; readonly value?: unknown }>;
	readonly owners: readonly PinOwner[];
}

// 24 h: Windows reuses pids and a service's pid answers EPERM, so an owner unseen this long counts as gone even when its pid answers.
const OWNER_TTL_MS = 86_400_000;
// 1 h: a re-pin within this window keeps the recorded time, so repeating an identical pin stays a no-op write.
const OWNER_REFRESH_MS = 3_600_000;
// An owner time more than a minute ahead means the clock stepped back since, so it counts as expired.
const ownerAge = (o: PinOwner, now: number): number => (o.at > now + 60_000 ? Infinity : now - o.at);

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A bare-pid owner from an older marker has no time, so it counts as expired. */
function ownersOf(marker: Record<string, unknown>): PinOwner[] {
	if (!Array.isArray(marker.owners)) return [];
	return marker.owners.flatMap((o: unknown) => {
		if (isRecord(o) && Number.isInteger(o.pid) && typeof o.at === "number") return [{ pid: o.pid as number, at: o.at }];
		return Number.isInteger(o) ? [{ pid: o as number, at: 0 }] : [];
	});
}

/** EPERM means the process exists but belongs to someone else. */
function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const toJsonText = (root: unknown): string => `${JSON.stringify(root, null, 2)}\n`;

/** The file's text, or undefined when it does not exist; any other read failure throws. */
function readIfPresent(path: string): string | undefined {
	try {
		return readFileSync(path, "utf-8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw err;
	}
}

const BOM = "﻿";

/** Pi strips a leading BOM before parsing settings (pi 1.1.0 dist/core/settings-manager.js:269); blank text is `{}`. */
function parseSettings(text: string): unknown {
	const body = text.startsWith(BOM) ? text.slice(1) : text;
	return JSON.parse(body.trim() === "" ? "{}" : body);
}

/** NEVER THROWS: the parsed settings root, or undefined when absent or unreadable. */
function readSettingsRoot(opts: AgentOverridesPathOptions): unknown {
	try {
		const text = readIfPresent(resolveSettingsPath(opts));
		return text === undefined ? undefined : parseSettings(text);
	} catch {
		return undefined;
	}
}

/** Temp file beside the target, then atomic rename: a direct write can truncate the user's settings on a crash. */
function atomicWrite(path: string, text: string): void {
	// The uuid avoids pid collisions between two jiti copies in one process.
	const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(tmpPath, text, "utf-8");
		renameSync(tmpPath, path);
	} catch (err) {
		// NEVER THROWS: a failed cleanup must not mask the original failure, which the caller reports.
		try {
			rmSync(tmpPath, { force: true });
		} catch {
			// Swallowed deliberately.
		}
		throw err;
	}
}

type Refusal = { readonly ok: false; readonly reason: string; readonly path: string };

const refuse = (path: string, problem: string): Refusal => ({ ok: false, reason: `${path}${problem} Refusing to touch it.`, path });

export type WriteAgentOverridesResult = { readonly ok: true; readonly written: boolean; readonly path: string } | Refusal;

/**
 * Validated read-modify-write of `subagents.agentOverrides`, ported from `bin/bootstrap.sh#merge_settings`.
 * Refuses rather than throwing on invalid JSON, non-object roots or a non-object `subagents`; every sibling key survives.
 * Skips the write when the output is byte-identical. Trusts the caller to have refused on an `ok:false` derivation.
 */
export function writeAgentOverrides(overrides: AgentOverrides, opts: AgentOverridesPathOptions = {}): WriteAgentOverridesResult {
	const path = resolveSettingsPath(opts);
	// Whole body is guarded: fs calls throw on EACCES, EISDIR, missing parent or a Windows lock, and the caller already switched the model.
	try {
		const text = readIfPresent(path);
		let root: unknown;
		try {
			root = parseSettings(text ?? "");
		} catch (err) {
			return refuse(path, ` is not valid JSON (${errorText(err)}).`);
		}
		if (!isRecord(root)) return refuse(path, " is not a JSON object.");
		for (const key of ["subagents", "kyPiAgent"]) {
			if (root[key] !== undefined && !isRecord(root[key])) return refuse(path, `'s "${key}" key is not a JSON object.`);
		}
		const subagents: Record<string, unknown> = { ...(root.subagents as Record<string, unknown> | undefined) };
		const current = subagents.agentOverrides;
		if (current !== undefined && !isRecord(current)) return refuse(path, `'s "subagents.agentOverrides" key is not a JSON object.`);

		const ky: Record<string, unknown> = { ...(root.kyPiAgent as Record<string, unknown> | undefined) };
		const prior = ky[PLANNER_PIN_MARKER];
		const marker: PinMarker =
			isRecord(prior) && isRecord(prior.keys)
				? { hadOverrides: prior.hadOverrides === true, keys: { ...(prior.keys as PinMarker["keys"]) }, owners: ownersOf(prior) }
				: { hadOverrides: current !== undefined, keys: {}, owners: [] };
		// Only keys this pin changes are recorded, each at its first pin, so a restore leaves every other override as the user left it.
		for (const key of Object.keys(overrides)) {
			if (key in marker.keys || JSON.stringify(current?.[key]) === JSON.stringify(overrides[key])) continue;
			marker.keys[key] = current !== undefined && key in current ? { had: true, value: current[key] } : { had: false };
		}
		if (Object.keys(marker.keys).length > 0) {
			const pid = opts.pid ?? process.pid;
			const now = opts.now ?? Date.now();
			const mine = marker.owners.find((o) => o.pid === pid && ownerAge(o, now) < OWNER_REFRESH_MS);
			ky[PLANNER_PIN_MARKER] = { ...marker, owners: [...marker.owners.filter((o) => o.pid !== pid), mine ?? { pid, at: now }] };
			root.kyPiAgent = ky;
		}
		subagents.agentOverrides = { ...current, ...overrides };
		root.subagents = subagents;

		const nextText = toJsonText(root);
		if (text === nextText) return { ok: true, written: false, path };
		atomicWrite(path, nextText);
		return { ok: true, written: true, path };
	} catch (err) {
		return { ok: false, reason: `${path} could not be written (${errorText(err)}).`, path };
	}
}

export type RestorePlannerPinResult = { readonly ok: true; readonly restored: boolean; readonly path: string } | Refusal;

/** Puts each key the marker recorded back to its value before the first pin. */
function restoreRecordedKeys(subagents: Record<string, unknown>, marker: Record<string, unknown>): Record<string, unknown> {
	const next = { ...subagents };
	if (isRecord(marker.keys)) {
		const restored: Record<string, unknown> = isRecord(next.agentOverrides) ? { ...next.agentOverrides } : {};
		for (const [key, entry] of Object.entries(marker.keys)) {
			if (isRecord(entry) && entry.had === true) restored[key] = entry.value;
			else delete restored[key];
		}
		if (Object.keys(restored).length === 0 && marker.hadOverrides !== true) delete next.agentOverrides;
		else next.agentOverrides = restored;
	} else if (marker.had === true) {
		// A marker written before per-key pins recorded the whole object.
		next.agentOverrides = marker.value;
	} else {
		delete next.agentOverrides;
	}
	return next;
}

/**
 * Ends this process's hold on the pin: drops its own, dead and expired owners, and restores each pinned key to its value before
 * the first pin only when none remain. A no-op without a marker.
 */
export function restorePlannerPin(opts: AgentOverridesPathOptions = {}): RestorePlannerPinResult {
	const path = resolveSettingsPath(opts);
	try {
		const text = readIfPresent(path);
		if (text === undefined) return { ok: true, restored: false, path };
		const root = parseSettings(text);
		if (!isRecord(root)) return refuse(path, " is not a JSON object.");
		const ky = root.kyPiAgent;
		if (!isRecord(ky)) return { ok: true, restored: false, path };
		const { [PLANNER_PIN_MARKER]: marker, ...restOfKy } = ky;
		if (!isRecord(marker)) return { ok: true, restored: false, path };

		const pid = opts.pid ?? process.pid;
		const isAlive = opts.isAlive ?? processAlive;
		const now = opts.now ?? Date.now();
		const recorded = ownersOf(marker);
		const owners = recorded.filter((o) => o.pid !== pid && ownerAge(o, now) < OWNER_TTL_MS && isAlive(o.pid));
		if (owners.length > 0) {
			if (owners.length !== recorded.length) {
				root.kyPiAgent = { ...ky, [PLANNER_PIN_MARKER]: { ...marker, owners } };
				atomicWrite(path, toJsonText(root));
			}
			return { ok: true, restored: false, path };
		}

		if (isRecord(root.subagents)) {
			const next = restoreRecordedKeys(root.subagents, marker);
			if (Object.keys(next).length === 0) delete root.subagents;
			else root.subagents = next;
		}
		if (Object.keys(restOfKy).length === 0) delete root.kyPiAgent;
		else root.kyPiAgent = restOfKy;

		atomicWrite(path, toJsonText(root));
		return { ok: true, restored: true, path };
	} catch (err) {
		return { ok: false, reason: `${path} could not be restored (${errorText(err)}).`, path };
	}
}

/** True when some session's planner pin is in the settings file, so a session that never pinned would otherwise inherit it. */
export function plannerPinHeld(opts: AgentOverridesPathOptions = {}): boolean {
	const root = readSettingsRoot(opts);
	return isRecord(root) && isRecord(root.kyPiAgent) && isRecord(root.kyPiAgent[PLANNER_PIN_MARKER]);
}

/** The model the settings file pins for `agent`, which is what pi-subagents actually runs. NEVER THROWS: undefined when none or unreadable. */
export function readAgentOverride(agent: string, opts: AgentOverridesPathOptions = {}): string | undefined {
	const root = readSettingsRoot(opts);
	const entry = isRecord(root) && isRecord(root.subagents) && isRecord(root.subagents.agentOverrides) ? root.subagents.agentOverrides[agent] : undefined;
	return isRecord(entry) && typeof entry.model === "string" ? entry.model : undefined;
}
