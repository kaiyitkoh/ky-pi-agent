/**
 * Derives and writes `settings.subagents.agentOverrides` so a mode switch swaps the whole role-to-model map, not just the executor.
 * Writes the GLOBAL agent settings (`getAgentDir()`, honours `PI_CODING_AGENT_DIR`, `dist/config.d.ts` getAgentDir): the project `.pi/settings.json`
 * is tracked and would dirty `git status`, and headless subagents never get project trust. Chokepoint-lint scans comments, so no model route is named.
 * Shape `{ subagents: { agentOverrides: { <agent>: { model: "<provider>/<id>" } } } }` is unverified against the pinned `pi-subagents` schema.
 */
import type { Model } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { guardRoute } from "./guard.ts";
import { resolveBedrockRef } from "./modes.ts";
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


/** One entry of the written `agentOverrides` object. */
export interface AgentOverrideEntry {
	readonly model: string;
}

/** The whole derived override object, keyed by agent name. */
export type AgentOverrides = Record<string, AgentOverrideEntry>;

/** The result of deriving the override object for one mode. */
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
}

/**
 * Derives the override object for `state.mode`: the first candidate per subagent role that passes `guardRoute` (`usesToolLoop: true`).
 * Returns `ok:false` with the last guard refusal when every candidate is blocked; callers must not write on `ok:false`.
 * Auth is deliberately not checked: this stays pure (no `ctx`) and the pin is inert until read.
 */
export function agentOverridesFor(
	state: Pick<KyModeData, "mode">,
	opts: AgentOverridesForOptions = {},
): AgentOverridesResult {
	const roleMap = opts.roleMap ?? ROLE_MAP;
	const roleMechanism = opts.roleMechanism ?? ROLE_MECHANISM;
	const agentNameByRole = opts.agentNameByRole ?? AGENT_NAME_BY_ROLE;

	const overrides: Record<string, AgentOverrideEntry> = {};
	const modeMap = roleMap[state.mode];

	for (const roleKey of Object.keys(roleMechanism) as Role[]) {
		if (roleMechanism[roleKey] !== "subagent") {
			continue;
		}
		const agentName = agentNameByRole[roleKey];
		if (agentName === undefined) {
			// A subagent role missing from AGENT_NAME_BY_ROLE is a schema authoring bug; refuse rather than omit it.
			return {
				ok: false,
				reason: `role "${roleKey}" is ROLE_MECHANISM.subagent but has no AGENT_NAME_BY_ROLE entry`,
			};
		}

		const route = modeMap[roleKey];
		let lastReason = `no candidates configured for role "${roleKey}" in mode "${state.mode}"`;
		let picked: string | undefined;

		for (const candidate of route.candidates) {
			const ref = resolveBedrockRef(candidate, opts.settingsPath);
			if (!ref.ok) {
				lastReason = ref.reason;
				continue;
			}
			const verdict = guardRoute(candidateAsModelFixture(ref.ref), roleKey, { usesToolLoop: true });
			if (verdict.ok) {
				picked = `${ref.ref.provider}/${ref.ref.id}`;
				break;
			}
			lastReason = verdict.reason;
		}

		if (picked === undefined) {
			return {
				ok: false,
				reason: `role "${roleKey}": every candidate is guard-blocked (${lastReason})`,
			};
		}
		overrides[agentName] = { model: picked };
	}

	return { ok: true, overrides };
}

/** Options accepted by {@link resolveSettingsPath} and {@link writeAgentOverrides}. */
export interface AgentOverridesPathOptions {
	/** Injected path, for tests. */
	settingsPath?: string;
	/** The pin owner recorded in the marker; defaults to this process. */
	pid?: number;
	/** Liveness probe for recorded owners; defaults to `process.kill(pid, 0)`. */
	isAlive?: (pid: number) => boolean;
}

/** Target settings path: `opts.settingsPath` if given, else the global agent `settings.json`. */
export function resolveSettingsPath(opts: AgentOverridesPathOptions = {}): string {
	if (opts.settingsPath !== undefined) {
		return opts.settingsPath;
	}
	return join(getAgentDir(), "settings.json");
}

const PLANNER_PIN_MARKER = "plannerPinRestore";

/** Per pinned agent key, its value before the first pin; `owners` are the pids whose sessions still hold the pin. */
interface PinMarker {
	readonly hadOverrides: boolean;
	readonly keys: Record<string, { readonly had: boolean; readonly value?: unknown }>;
	readonly owners: readonly number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ownersOf(marker: Record<string, unknown>): number[] {
	return Array.isArray(marker.owners) ? marker.owners.filter((o): o is number => Number.isInteger(o)) : [];
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

/** Temp file beside the target, then atomic rename: a direct write can truncate the user's settings on a crash. */
function atomicWrite(path: string, text: string): void {
	// The uuid avoids pid collisions between two jiti copies in one process; the rm below removes the temp file if rename fails.
	const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(tmpPath, text, "utf-8");
		renameSync(tmpPath, path);
	} catch (err) {
		try {
			rmSync(tmpPath, { force: true });
		} catch {
			// Best-effort cleanup; the caller reports the original failure.
		}
		throw err;
	}
}

/** What {@link writeAgentOverrides} returns. */
export type WriteAgentOverridesResult =
	| { readonly ok: true; readonly written: boolean; readonly path: string }
	| { readonly ok: false; readonly reason: string; readonly path: string };

/**
 * Validated read-modify-write of `subagents.agentOverrides`, ported from `bin/bootstrap.sh#merge_settings`.
 * Refuses rather than throwing on invalid JSON, non-object roots or a non-object `subagents`; every sibling key survives.
 * Skips the write when the output is byte-identical. Trusts the caller to have refused on an `ok:false` derivation.
 */
export function writeAgentOverrides(
	overrides: AgentOverrides,
	opts: AgentOverridesPathOptions = {},
): WriteAgentOverridesResult {
	const path = resolveSettingsPath(opts);

	// Whole body is guarded: fs calls throw on EACCES, EISDIR, missing parent or a Windows lock, and the caller already switched the model.
	try {
		let raw = "{}";
		if (existsSync(path)) {
			const fileText = readFileSync(path, "utf-8").trim();
			raw = fileText === "" ? "{}" : fileText;
		}

		let obj: unknown;
		try {
			obj = JSON.parse(raw);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				ok: false,
				reason: `${path} is not valid JSON (${message}). Refusing to touch it.`,
				path,
			};
		}

		if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
			return {
				ok: false,
				reason: `${path} is not a JSON object. Refusing to touch it.`,
				path,
			};
		}

		const root = obj as Record<string, unknown>;
		const existingSubagents = root.subagents;
		if (
			existingSubagents !== undefined &&
			(existingSubagents === null || typeof existingSubagents !== "object" || Array.isArray(existingSubagents))
		) {
			return {
				ok: false,
				reason: `${path}'s "subagents" key is not a JSON object. Refusing to touch it.`,
				path,
			};
		}

		const existingKy = root.kyPiAgent;
		if (existingKy !== undefined && (existingKy === null || typeof existingKy !== "object" || Array.isArray(existingKy))) {
			return {
				ok: false,
				reason: `${path}'s "kyPiAgent" key is not a JSON object. Refusing to touch it.`,
				path,
			};
		}

		const subagents: Record<string, unknown> = { ...(existingSubagents as Record<string, unknown> | undefined) };
		const current = subagents.agentOverrides;
		if (current !== undefined && !isRecord(current)) {
			return { ok: false, reason: `${path}'s "subagents.agentOverrides" key is not a JSON object. Refusing to touch it.`, path };
		}
		const ky: Record<string, unknown> = { ...(existingKy as Record<string, unknown> | undefined) };
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
			ky[PLANNER_PIN_MARKER] = { ...marker, owners: marker.owners.includes(pid) ? marker.owners : [...marker.owners, pid] };
			root.kyPiAgent = ky;
		}
		subagents.agentOverrides = { ...current, ...overrides };
		root.subagents = subagents;

		const nextText = `${JSON.stringify(root, null, 2)}\n`;

		if (existsSync(path)) {
			const currentText = readFileSync(path, "utf-8");
			if (currentText === nextText) {
				return { ok: true, written: false, path };
			}
		}

		atomicWrite(path, nextText);

		return { ok: true, written: true, path };
	} catch (err) {
		return {
			ok: false,
			reason: `${path} could not be written (${err instanceof Error ? err.message : String(err)}).`,
			path,
		};
	}
}

/** What {@link restorePlannerPin} returns. */
export type RestorePlannerPinResult =
	| { readonly ok: true; readonly restored: boolean; readonly path: string }
	| { readonly ok: false; readonly reason: string; readonly path: string };

/**
 * Ends this process's hold on the pin: drops its pid and every dead pid from the marker's owners, and only when none remain
 * restores each pinned key to its value before the first pin. A subagent child or a second terminal therefore never undoes a
 * live session's pin, and a crash-left marker is cleaned by the next process. A no-op without a marker.
 */
export function restorePlannerPin(opts: AgentOverridesPathOptions = {}): RestorePlannerPinResult {
	const path = resolveSettingsPath(opts);
	try {
		if (!existsSync(path)) return { ok: true, restored: false, path };
		const root: unknown = JSON.parse(readFileSync(path, "utf-8"));
		if (!isRecord(root)) {
			return { ok: false, reason: `${path} is not a JSON object. Refusing to touch it.`, path };
		}
		const ky = root.kyPiAgent;
		if (!isRecord(ky)) return { ok: true, restored: false, path };
		const { [PLANNER_PIN_MARKER]: marker, ...restOfKy } = ky;
		if (!isRecord(marker)) return { ok: true, restored: false, path };

		const pid = opts.pid ?? process.pid;
		const isAlive = opts.isAlive ?? processAlive;
		const recorded = ownersOf(marker);
		const owners = recorded.filter((o) => o !== pid && isAlive(o));
		if (owners.length > 0) {
			if (owners.length !== recorded.length) {
				root.kyPiAgent = { ...ky, [PLANNER_PIN_MARKER]: { ...marker, owners } };
				atomicWrite(path, `${JSON.stringify(root, null, 2)}\n`);
			}
			return { ok: true, restored: false, path };
		}

		const subagents = root.subagents;
		if (isRecord(subagents)) {
			const next = { ...subagents };
			if (isRecord(marker.keys)) {
				const restoredOverrides: Record<string, unknown> = isRecord(next.agentOverrides) ? { ...next.agentOverrides } : {};
				for (const [key, entry] of Object.entries(marker.keys)) {
					if (isRecord(entry) && entry.had === true) restoredOverrides[key] = entry.value;
					else delete restoredOverrides[key];
				}
				if (Object.keys(restoredOverrides).length === 0 && marker.hadOverrides !== true) delete next.agentOverrides;
				else next.agentOverrides = restoredOverrides;
			} else if (marker.had === true) {
				// A marker written before per-key pins recorded the whole object.
				next.agentOverrides = marker.value;
			} else {
				delete next.agentOverrides;
			}
			if (Object.keys(next).length === 0) delete root.subagents;
			else root.subagents = next;
		}
		if (Object.keys(restOfKy).length === 0) delete root.kyPiAgent;
		else root.kyPiAgent = restOfKy;

		atomicWrite(path, `${JSON.stringify(root, null, 2)}\n`);
		return { ok: true, restored: true, path };
	} catch (err) {
		return {
			ok: false,
			reason: `${path} could not be restored (${err instanceof Error ? err.message : String(err)}).`,
			path,
		};
	}
}
