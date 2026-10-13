/**
 * The planner pin in the shared user settings, seen from a session that never pinned: session_start must not leave it
 * running on another session's pin, and /mode must report the planner that actually runs.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import routing from "../../.pi/extensions/routing/index.ts";
import { agentOverridesFor } from "../../.pi/extensions/routing/agent-overrides.ts";
import { setEscalated, setMode } from "../../.pi/extensions/routing/modes.ts";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

const OTHER = "example/someone-elses-planner";
let dir = "";
let savedDir: string | undefined;

function settingsFile(): string {
	return join(dir, "settings.json");
}

/** A pin written by another, still-running session (the parent process stands in for it). */
function seedForeignPin(): void {
	const marker = { hadOverrides: false, keys: { planner: { had: false } }, owners: [{ pid: process.ppid, at: Date.now() }] };
	writeFileSync(settingsFile(), `${JSON.stringify({ subagents: { agentOverrides: { planner: { model: OTHER } } }, kyPiAgent: { plannerPinRestore: marker } }, null, 2)}\n`);
}

function load() {
	const handlers = new Map<string, Handler[]>();
	const commands = new Map<string, (args: string, ctx: unknown) => Promise<void>>();
	const pi = {
		registerCommand: (name: string, def: { handler: (args: string, ctx: unknown) => Promise<void> }) => void commands.set(name, def.handler),
		registerTool: () => undefined,
		registerFlag: () => undefined,
		getFlag: () => undefined,
		on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		getActiveTools: () => [],
		setActiveTools: () => undefined,
		events: { emit: () => undefined },
	};
	routing(pi as never);
	const notes: string[] = [];
	const ctx = {
		ui: { notify: (text: string) => notes.push(text) },
		hasUI: false,
		sessionManager: { getBranch: () => [] },
		modelRegistry: { find: (provider: string, id: string) => ({ provider, id }), hasConfiguredAuth: () => true },
	};
	return { handlers, commands, notes, ctx };
}

const plannerNow = (): unknown => JSON.parse(readFileSync(settingsFile(), "utf-8")).subagents?.agentOverrides?.planner?.model;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "kypi-planner-pin-"));
	savedDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	setMode("cheap");
	setEscalated(false);
});

afterEach(() => {
	if (savedDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = savedDir;
	rmSync(dir, { recursive: true, force: true });
});

describe("a default-mode session and another session's planner pin", () => {
	it("session_start writes this session's own planner pin over another live session's", async () => {
		seedForeignPin();
		const { handlers, ctx } = load();
		for (const h of handlers.get("session_start") ?? []) await h({ reason: "startup" }, ctx);
		const cheap = agentOverridesFor({ mode: "cheap" });
		expect(cheap.ok).toBe(true);
		if (cheap.ok) expect(plannerNow()).toBe(cheap.overrides.planner?.model);
		expect(plannerNow()).not.toBe(OTHER);
	});

	it("session_start writes nothing when no session holds a pin", async () => {
		writeFileSync(settingsFile(), `${JSON.stringify({ theme: "ky" }, null, 2)}\n`);
		const { handlers, ctx } = load();
		for (const h of handlers.get("session_start") ?? []) await h({ reason: "startup" }, ctx);
		expect(JSON.parse(readFileSync(settingsFile(), "utf-8"))).toEqual({ theme: "ky" });
	});

	it("/mode reports the planner the settings file actually runs when it differs from the route", async () => {
		seedForeignPin();
		const { commands, notes, ctx } = load();
		await commands.get("mode")?.("", ctx);
		expect(notes.join("\n")).toContain(`subagents run ${OTHER}`);
	});
});
