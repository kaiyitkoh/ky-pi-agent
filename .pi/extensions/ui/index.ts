// Chrome only: Pi's footer already shows model, provider, cost, branch, context percent and cache stats,
// so this adds just what it lacks (route, tokens left, changed files, running subagents).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { keyText, VERSION } from "@earendil-works/pi-coding-agent";

import { DEFAULT_MODE, MODE_ENTRY_TYPE, ROUTING_EVENT } from "../routing/schema.ts";
import { createAgentTracker, SUBAGENT_BUS_TOPICS } from "./agents.ts";
import { createGitProbe } from "./git-probe.ts";
import { createHeaderComponent } from "./header.ts";
import { formatStatusline, type StatuslineState } from "./statusline.ts";

const STATUS_KEY = "ky-statusline";
const PROBE_TRIGGER_TOOLS = new Set(["edit", "write", "bash"]);

// NEVER THROWS: a missing or malformed package.json only drops the version from the header.
function readHarnessVersion(): string | undefined {
	try {
		const path = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json");
		const version = (JSON.parse(readFileSync(path, "utf-8")) as { version?: unknown }).version;
		return typeof version === "string" ? version : undefined;
	} catch {
		return undefined;
	}
}

const harnessVersion = readHarnessVersion();

function routeOf(data: unknown): { mode: string; escalated: boolean } | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const { mode, escalated } = data as { mode?: unknown; escalated?: unknown };
	return typeof mode === "string" ? { mode, escalated: escalated === true } : undefined;
}

function restoreRoute(ctx: ExtensionContext): { mode: string; escalated: boolean } {
	let route = { mode: DEFAULT_MODE as string, escalated: false };
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "custom" && entry.customType === MODE_ENTRY_TYPE) route = routeOf(entry.data) ?? route;
	}
	return route;
}

// NEVER THROWS: an unknown keybinding falls back to the default key name.
function interruptKeyText(): string {
	try {
		return keyText("app.interrupt");
	} catch {
		return "esc";
	}
}

// NEVER THROWS: chrome must not break a turn, yet a stale context after /reload throws, as may a malformed event.
function guard(fn: () => void): void {
	try {
		fn();
	} catch {}
}

export default function (pi: ExtensionAPI): void {
	let generation = 0;
	let lastCtx: ExtensionContext | undefined;
	let state: StatuslineState = {};
	let probe: ReturnType<typeof createGitProbe> | undefined;
	const tracker = createAgentTracker();

	function refresh(): void {
		const ctx = lastCtx;
		if (ctx === undefined) return;
		guard(() => {
			if (!ctx.hasUI) return;
			const usage = ctx.getContextUsage();
			const left = typeof usage?.tokens === "number" ? Math.max(0, usage.contextWindow - usage.tokens) : undefined;
			const text = formatStatusline(
				{ ...state, contextLeftTokens: left, agentsRunning: tracker.running() },
				(color, s) => ctx.ui.theme.fg(color, s),
			);
			ctx.ui.setStatus(STATUS_KEY, text);
		});
	}

	function track(ctx: ExtensionContext, changed = true): void {
		lastCtx = ctx;
		if (changed) refresh();
	}

	pi.on("session_start", (_event, ctx) => guard(() => {
		const gen = ++generation;
		lastCtx = ctx;
		tracker.reset();
		probe?.dispose();
		state = restoreRoute(ctx);
		// Without a UI nothing shows the count, so headless and child sessions spawn no git at all.
		probe = ctx.hasUI
			? createGitProbe({
					exec: (args) => pi.exec("git", [...args], { cwd: ctx.cwd, timeout: 5000 }),
					onResult: (changed) => {
						if (gen !== generation) return;
						state.changedFiles = changed;
						refresh();
					},
				})
			: undefined;
		if (ctx.mode === "tui" && ctx.hasUI) {
			const interruptKey = interruptKeyText();
			ctx.ui.setHeader((_tui, theme) =>
				createHeaderComponent(
					() => ({ harnessVersion, piVersion: VERSION, mode: state.mode, escalated: state.escalated, interruptKey }),
					theme,
				),
			);
		}
		refresh();
		probe?.trigger();
	}));

	pi.on("session_shutdown", () => guard(() => {
		generation += 1;
		probe?.dispose();
		lastCtx = undefined;
	}));

	pi.on("turn_end", (_event, ctx) => guard(() => {
		track(ctx);
		probe?.trigger();
	}));
	pi.on("model_select", (_event, ctx) => guard(() => track(ctx)));
	pi.on("session_compact", (_event, ctx) => guard(() => track(ctx)));
	pi.on("tool_execution_start", (event, ctx) =>
		guard(() => track(ctx, tracker.onToolStart(event.toolName, event.toolCallId, event.args))),
	);
	pi.on("tool_execution_end", (event, ctx) => guard(() => {
		track(ctx, tracker.onToolEnd(event.toolName, event.toolCallId));
		if (PROBE_TRIGGER_TOOLS.has(event.toolName)) probe?.trigger();
	}));

	pi.events.on(ROUTING_EVENT, (payload) => guard(() => {
		const route = routeOf(payload);
		if (route === undefined) return;
		state.mode = route.mode;
		state.escalated = route.escalated;
		refresh();
	}));

	for (const topic of SUBAGENT_BUS_TOPICS) {
		pi.events.on(topic, (payload) => guard(() => {
			if (tracker.onBusEvent(topic, payload)) refresh();
		}));
	}
}
