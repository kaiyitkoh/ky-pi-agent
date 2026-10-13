/**
 * Subagent calls: launches need the required-child guard registered for the current session, management
 * actions need a human confirm, and the registration matches the pinned pi-subagents contract.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import safety from "../../.pi/extensions/safety/index.ts";
import {
	classifySubagentCall,
	disposeChildGuard,
	isChildGuardRegistered,
	registerChildGuard,
	setRequiredChildLoaderForTests,
	SUBAGENT_READ_ONLY_ACTIONS,
} from "../../.pi/extensions/safety/subagents.ts";
import { repoRoot } from "../helpers/git.ts";
import { withTempLogCwd } from "../helpers/logs.ts";

interface Contract {
	requiredChildExtensions: { parameterKeys: string[]; extensionEntryKeys: string[] };
	actions: { value: string; expected: "read" | "manage" }[];
}

const contract = JSON.parse(readFileSync(join(repoRoot(), "tests", "fixtures", "pi-subagents-0.76.1-contract.json"), "utf-8")) as Contract;

type Hook = (event: unknown, ctx: ExtensionContext) => Promise<{ block?: boolean; reason?: string } | undefined>;

function load(): { hook: Hook; handlers: Map<string, (...a: unknown[]) => unknown> } {
	const handlers = new Map<string, (...a: unknown[]) => unknown>();
	safety({ on: (e: string, h: (...a: unknown[]) => unknown) => handlers.set(e, h), registerTool: () => {} } as unknown as ExtensionAPI);
	return { hook: handlers.get("tool_call") as unknown as Hook, handlers };
}

interface FakeUi {
	hasUI: boolean;
	mode: string;
	confirm?: (title: string, message: string, opts?: { timeout?: number }) => Promise<boolean>;
}

function ctxOf(cwd: string, sessionId: string, ui: FakeUi): ExtensionContext {
	return {
		cwd,
		hasUI: ui.hasUI,
		mode: ui.mode,
		ui: { confirm: ui.confirm },
		sessionManager: { getSessionId: () => sessionId },
	} as unknown as ExtensionContext;
}

const SESSION = "guard-test-session";

interface Registration {
	sessionId: string;
	extensions: { id: string; path: string }[];
	requireForAllRunners: boolean;
}

let calls: Registration[];
let disposed: number;

function installFauxLoader(): void {
	setRequiredChildLoaderForTests(async () => ({
		registerRequiredChildExtensions: (input: Registration) => {
			calls.push(input);
			return {
				dispose: () => {
					disposed += 1;
				},
			};
		},
	}));
}

beforeEach(() => {
	calls = [];
	disposed = 0;
	installFauxLoader();
});

afterEach(() => {
	disposeChildGuard(SESSION);
	setRequiredChildLoaderForTests(undefined);
});

describe("classifySubagentCall against the pinned pi-subagents action set", () => {
	it("the fixture is not empty and covers both classes", () => {
		expect(contract.actions.filter((a) => a.expected === "read").length).toBeGreaterThan(5);
		expect(contract.actions.filter((a) => a.expected === "manage").length).toBeGreaterThan(5);
	});

	it.each(contract.actions)("action $value is $expected", ({ value, expected }) => {
		expect(classifySubagentCall({ action: value }).kind).toBe(expected);
	});

	it("the read-only set is exactly the fixture's read actions", () => {
		const fixtureReads = contract.actions.filter((a) => a.expected === "read").map((a) => a.value);
		expect([...SUBAGENT_READ_ONLY_ACTIONS].sort()).toEqual(fixtureReads.sort());
	});

	it("no action is a launch; an absent action launches", () => {
		expect(classifySubagentCall({ agent: "worker", task: "x" }).kind).toBe("launch");
		expect(classifySubagentCall({}).kind).toBe("launch");
	});

	it.each([[null], ["list"], [[]], [{ action: 7 }], [{ action: "" }], [{ action: "unknown-thing" }], [{ action: " create" }]])(
		"%j is a management call",
		(input) => {
			expect(classifySubagentCall(input).kind).toBe("manage");
		},
	);
});

describe("registerChildGuard", () => {
	it("registers once with the pinned parameter shape and requireForAllRunners", async () => {
		const result = await registerChildGuard(SESSION, "/abs/safety/index.ts", "/work");
		expect(result).toEqual({ ok: true });
		expect(calls).toHaveLength(1);
		expect(Object.keys(calls[0]).sort()).toEqual([...contract.requiredChildExtensions.parameterKeys].sort());
		expect(Object.keys(calls[0].extensions[0]).sort()).toEqual([...contract.requiredChildExtensions.extensionEntryKeys].sort());
		expect(calls[0].sessionId).toBe(SESSION);
		expect(calls[0].extensions[0]).toEqual({ id: "ky-safety", path: "/abs/safety/index.ts" });
		expect(calls[0].requireForAllRunners).toBe(true);
		expect(isChildGuardRegistered(SESSION)).toBe(true);
	});

	it("an 'already registered' error still counts as registered", async () => {
		setRequiredChildLoaderForTests(async () => ({
			registerRequiredChildExtensions: () => {
				throw new Error("Required child extensions are already registered for session 'x'; dispose them first.");
			},
		}));
		expect(await registerChildGuard(SESSION, "/abs/index.ts", "/work")).toEqual({ ok: true });
		expect(isChildGuardRegistered(SESSION)).toBe(true);
	});

	it("any other failure, or a missing package, leaves the session unregistered", async () => {
		setRequiredChildLoaderForTests(async () => {
			throw new Error("pi-subagents is not installed");
		});
		const result = await registerChildGuard(SESSION, "/abs/index.ts", "/work");
		expect(result.ok).toBe(false);
		expect(isChildGuardRegistered(SESSION)).toBe(false);
	});

	it("disposeChildGuard calls the stored handle and clears the registration", async () => {
		await registerChildGuard(SESSION, "/abs/index.ts", "/work");
		disposeChildGuard(SESSION);
		expect(disposed).toBe(1);
		expect(isChildGuardRegistered(SESSION)).toBe(false);
	});
});

describe("tool_call hook for the subagent tool", () => {
	it("a launch is blocked until the guard is registered, then allowed", async () => {
		const { hook } = load();
		await withTempLogCwd(async (cwd) => {
			const ui = { hasUI: false, mode: "print" };
			const input = { agent: "worker", task: "x", extensions: [] };
			const before = await hook({ toolName: "subagent", input, toolCallId: "t1" }, ctxOf(cwd, SESSION, ui));
			expect(before?.block).toBe(true);
			expect(before?.reason).toContain("guard");
			await registerChildGuard(SESSION, "/abs/index.ts", cwd);
			const after = await hook({ toolName: "subagent", input, toolCallId: "t2" }, ctxOf(cwd, SESSION, ui));
			expect(after).toBeUndefined();
		});
	});

	it("a launch with no session manager fails closed", async () => {
		const { hook } = load();
		await withTempLogCwd(async (cwd) => {
			const ctx = { cwd, hasUI: false, mode: "print" } as unknown as ExtensionContext;
			const result = await hook({ toolName: "subagent", input: {}, toolCallId: "t" }, ctx);
			expect(result?.block).toBe(true);
		});
	});

	it.each(["list", "status", "get"])("read action %s needs no confirm", async (action) => {
		const { hook } = load();
		await withTempLogCwd(async (cwd) => {
			const result = await hook({ toolName: "subagent", input: { action }, toolCallId: "t" }, ctxOf(cwd, SESSION, { hasUI: false, mode: "print" }));
			expect(result).toBeUndefined();
		});
	});

	it.each(["create", "update", "eject", "delete", "schedule.create", "made-up"])("management action %s with no UI is refused", async (action) => {
		const { hook } = load();
		await withTempLogCwd(async (cwd) => {
			let asked = 0;
			const confirm = async () => (asked++, true);
			const result = await hook({ toolName: "subagent", input: { action }, toolCallId: "t" }, ctxOf(cwd, SESSION, { hasUI: false, mode: "json", confirm }));
			expect(result?.block).toBe(true);
			expect(asked).toBe(0);
		});
	});

	it.each(["tui", "rpc"])("management action in %s follows the confirm answer, with the timeout", async (mode) => {
		const { hook } = load();
		await withTempLogCwd(async (cwd) => {
			const seen: (number | undefined)[] = [];
			const answer = (value: boolean) => async (_t: string, _m: string, opts?: { timeout?: number }) => (seen.push(opts?.timeout), value);
			const input = { action: "create", config: { name: "x" } };
			const denied = await hook({ toolName: "subagent", input, toolCallId: "t1" }, ctxOf(cwd, SESSION, { hasUI: true, mode, confirm: answer(false) }));
			expect(denied?.block).toBe(true);
			const allowed = await hook({ toolName: "subagent", input, toolCallId: "t2" }, ctxOf(cwd, SESSION, { hasUI: true, mode, confirm: answer(true) }));
			expect(allowed).toBeUndefined();
			expect(seen).toEqual([300000, 300000]);
		});
	});

	it("a management input too long to show in full is refused without asking", async () => {
		const { hook } = load();
		await withTempLogCwd(async (cwd) => {
			let asked = 0;
			const input = { action: "create", config: { name: "x", systemPrompt: "y".repeat(3000) } };
			const result = await hook({ toolName: "subagent", input, toolCallId: "t" }, ctxOf(cwd, SESSION, { hasUI: true, mode: "tui", confirm: async () => (asked++, true) }));
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("too long");
			expect(asked).toBe(0);
		});
	});
});

describe("lifecycle handlers", () => {
	it("session_start registers with the safety entry file and session_shutdown disposes", async () => {
		const { handlers } = load();
		await withTempLogCwd(async (cwd) => {
			const ctx = ctxOf(cwd, SESSION, { hasUI: false, mode: "print" });
			await (handlers.get("session_start") as (e: unknown, c: ExtensionContext) => Promise<void>)({}, ctx);
			expect(calls).toHaveLength(1);
			expect(calls[0].sessionId).toBe(SESSION);
			expect(calls[0].extensions[0].path.replaceAll("\\", "/")).toMatch(/\.pi\/extensions\/safety\/index\.ts$/);
			expect(isChildGuardRegistered(SESSION)).toBe(true);
			await (handlers.get("session_shutdown") as (e: unknown, c: ExtensionContext) => Promise<void>)({}, ctx);
			expect(disposed).toBe(1);
			expect(isChildGuardRegistered(SESSION)).toBe(false);
		});
	});

	it("a failed registration is audited and shown when a UI is present", async () => {
		setRequiredChildLoaderForTests(async () => {
			throw new Error("no pi-subagents");
		});
		const { handlers } = load();
		await withTempLogCwd(async (cwd) => {
			const notes: string[] = [];
			const ctx = { ...ctxOf(cwd, SESSION, { hasUI: true, mode: "tui" }), ui: { notify: (m: string) => notes.push(m) } } as unknown as ExtensionContext;
			await (handlers.get("session_start") as (e: unknown, c: ExtensionContext) => Promise<void>)({}, ctx);
			expect(isChildGuardRegistered(SESSION)).toBe(false);
			expect(notes.join(" ")).toContain("subagent launches are refused");
		});
	});
});
