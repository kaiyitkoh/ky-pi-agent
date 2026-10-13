/**
 * Subagent guard support: classifies `subagent` tool calls and registers the safety extension as a
 * host-required child extension, so every child loads the guard whatever its agent config says.
 * pi-subagents is a separate module root, so it is imported by file URL from its install root, never by bare specifier.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

/** Actions that only inspect or control an existing run; every other action string is treated as a management change. */
export const SUBAGENT_READ_ONLY_ACTIONS: ReadonlySet<string> = new Set([
	"guide",
	"list",
	"get",
	"models",
	"status",
	"children.list",
	"validate",
	"doctor",
	"inspector.status",
	"project.status",
	"steer",
	"resume",
	"stop",
]);

export type SubagentCallKind = { kind: "launch" } | { kind: "read"; action: string } | { kind: "manage"; action: string };

/** An absent action launches children; a non-string action is not trusted and counts as management. */
export function classifySubagentCall(input: unknown): SubagentCallKind {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		return { kind: "manage", action: "" };
	}
	const action = (input as Record<string, unknown>).action;
	if (action === undefined) {
		return { kind: "launch" };
	}
	if (typeof action !== "string") {
		return { kind: "manage", action: "" };
	}
	return SUBAGENT_READ_ONLY_ACTIONS.has(action) ? { kind: "read", action } : { kind: "manage", action };
}

interface RequiredChildModule {
	registerRequiredChildExtensions(input: {
		sessionId: string;
		extensions: { id: string; path: string }[];
		requireForAllRunners: true;
	}): { dispose(): void };
}

export const CHILD_GUARD_ID = "ky-safety";

const REGISTRY_ENTRY = ["node_modules", "pi-subagents", "src", "api", "required-child-extensions.js"];
const GUARD_SLOT = Symbol.for("ky-pi-agent.safety.child-guard.v1");

// Two jiti instances of this file must agree on which sessions hold a registration.
function guards(): Map<string, { dispose(): void }> {
	const root = globalThis as unknown as Record<symbol, Map<string, { dispose(): void }> | undefined>;
	root[GUARD_SLOT] ??= new Map();
	return root[GUARD_SLOT];
}

let testLoader: ((cwd: string) => Promise<unknown>) | undefined;

/** Replace the pi-subagents module loader; pass undefined to restore the file-URL loader. */
export function setRequiredChildLoaderForTests(loader: ((cwd: string) => Promise<unknown>) | undefined): void {
	testLoader = loader;
}

const REGISTRY_FILE = ["src", "api", "required-child-extensions.js"];

function packageRootNamed(start: string, name: string): string | undefined {
	for (let dir = dirname(start); ; dir = dirname(dir)) {
		const manifest = join(dir, "package.json");
		if (existsSync(manifest)) {
			try {
				const found = (JSON.parse(readFileSync(manifest, "utf-8")) as { name?: unknown }).name;
				if (found === name) return dir;
				if (typeof found === "string") return undefined;
			} catch {
				return undefined;
			}
		}
		if (dirname(dir) === dir) return undefined;
	}
}

/** The child-extension registry of the pi-subagents Pi loaded (found from the tool's own source path), else of the user or project npm install. */
export function resolveRequiredChildModule(sourcePaths: readonly string[], cwd: string): string | undefined {
	for (const source of sourcePaths) {
		const root = packageRootNamed(source, "pi-subagents");
		const file = root === undefined ? undefined : join(root, ...REGISTRY_FILE);
		if (file !== undefined && existsSync(file)) return file;
	}
	return [join(getAgentDir(), "npm"), join(cwd, CONFIG_DIR_NAME, "npm")].map((root) => join(root, ...REGISTRY_ENTRY)).find((f) => existsSync(f));
}

async function loadRequiredChildModule(cwd: string, sourcePaths: readonly string[]): Promise<RequiredChildModule> {
	if (testLoader !== undefined) {
		return (await testLoader(cwd)) as RequiredChildModule;
	}
	const file = resolveRequiredChildModule(sourcePaths, cwd);
	if (file === undefined) throw new Error("pi-subagents was not found from the loaded subagent tool or under the user or project npm root");
	return (await import(pathToFileURL(file).href)) as RequiredChildModule;
}

/** Register `safetyEntryPath` as a required extension for every child of `sessionId`; an existing registration counts as success. */
export async function registerChildGuard(
	sessionId: string,
	safetyEntryPath: string,
	cwd: string,
	subagentSourcePaths: readonly string[] = [],
): Promise<{ ok: true } | { ok: false; reason: string }> {
	if (guards().has(sessionId)) {
		return { ok: true };
	}
	try {
		const mod = await loadRequiredChildModule(cwd, subagentSourcePaths);
		const handle = mod.registerRequiredChildExtensions({
			sessionId,
			extensions: [{ id: CHILD_GUARD_ID, path: safetyEntryPath }],
			requireForAllRunners: true,
		});
		guards().set(sessionId, handle);
		return { ok: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("already registered")) {
			guards().set(sessionId, { dispose() {} });
			return { ok: true };
		}
		return { ok: false, reason: message };
	}
}

export function isChildGuardRegistered(sessionId: string): boolean {
	return guards().has(sessionId);
}

export function disposeChildGuard(sessionId: string): void {
	const handle = guards().get(sessionId);
	guards().delete(sessionId);
	// NEVER THROWS: disposal runs at shutdown, when there is nothing left to protect.
	try {
		handle?.dispose();
	} catch {
		// Best-effort.
	}
}
