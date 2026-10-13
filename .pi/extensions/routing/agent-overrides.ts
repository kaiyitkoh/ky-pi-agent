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
			const verdict = guardRoute(candidateAsModelFixture(candidate), roleKey, { usesToolLoop: true });
			if (verdict.ok) {
				picked = `${candidate.provider}/${candidate.id}`;
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
}

/** Target settings path: `opts.settingsPath` if given, else the global agent `settings.json`. */
export function resolveSettingsPath(opts: AgentOverridesPathOptions = {}): string {
	if (opts.settingsPath !== undefined) {
		return opts.settingsPath;
	}
	return join(getAgentDir(), "settings.json");
}

const PLANNER_PIN_MARKER = "plannerPinRestore";

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
		const original = subagents.agentOverrides;
		const ky: Record<string, unknown> = { ...(existingKy as Record<string, unknown> | undefined) };
		if (ky[PLANNER_PIN_MARKER] === undefined && JSON.stringify(original) !== JSON.stringify(overrides)) {
			ky[PLANNER_PIN_MARKER] = original === undefined ? { had: false } : { had: true, value: original };
			root.kyPiAgent = ky;
		}
		subagents.agentOverrides = overrides;
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
 * Puts `subagents.agentOverrides` back to what it was before the first pin and removes the marker.
 * A no-op when no marker exists, so it is safe to call at every session start and shutdown.
 */
export function restorePlannerPin(opts: AgentOverridesPathOptions = {}): RestorePlannerPinResult {
	const path = resolveSettingsPath(opts);
	try {
		if (!existsSync(path)) return { ok: true, restored: false, path };
		const obj: unknown = JSON.parse(readFileSync(path, "utf-8"));
		if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
			return { ok: false, reason: `${path} is not a JSON object. Refusing to touch it.`, path };
		}
		const root = obj as Record<string, unknown>;
		const ky = root.kyPiAgent;
		if (ky === null || typeof ky !== "object" || Array.isArray(ky)) return { ok: true, restored: false, path };
		const { [PLANNER_PIN_MARKER]: marker, ...restOfKy } = ky as Record<string, unknown>;
		if (marker === null || typeof marker !== "object") return { ok: true, restored: false, path };

		const subagents = root.subagents;
		if (subagents !== null && typeof subagents === "object" && !Array.isArray(subagents)) {
			const next = { ...(subagents as Record<string, unknown>) };
			const { had, value } = marker as { had?: unknown; value?: unknown };
			if (had === true) next.agentOverrides = value;
			else delete next.agentOverrides;
			if (Object.keys(next).length === 0) delete root.subagents;
			else root.subagents = next;
		}
		if (Object.keys(restOfKy).length === 0) delete root.kyPiAgent;
		else root.kyPiAgent = restOfKy;

		atomicWrite(path, `${JSON.stringify(root, null, 2)}
`);
		return { ok: true, restored: true, path };
	} catch (err) {
		return {
			ok: false,
			reason: `${path} could not be restored (${err instanceof Error ? err.message : String(err)}).`,
			path,
		};
	}
}
