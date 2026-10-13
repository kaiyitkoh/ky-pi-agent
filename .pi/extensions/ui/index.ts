// Chrome only: Pi's footer already shows model, provider, cost, branch, context percent and cache stats,
// so this adds just what it lacks (route, tokens left, changed files, running subagents).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { keyText, VERSION } from "@earendil-works/pi-coding-agent";

import { createAgentTracker, SUBAGENT_BUS_TOPICS } from "./agents.ts";
import { createGitProbe } from "./git-probe.ts";
import { createHeaderComponent } from "./header.ts";
import { formatStatusline, type StatuslineState } from "./statusline.ts";

const STATUS_KEY = "ky-statusline";
const DEFAULT_ROUTE = "cheap";

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

function restoreRoute(ctx: ExtensionContext): { mode: string; escalated: boolean } {
	let mode = DEFAULT_ROUTE;
	let escalated = false;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== "ky:mode") continue;
		const data = entry.data as { mode?: unknown; escalated?: unknown } | null | undefined;
		if (typeof data !== "object" || data === null || typeof data.mode !== "string") continue;
		mode = data.mode;
		escalated = data.escalated === true;
	}
	return { mode, escalated };
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
		try {
			if (!ctx.hasUI) return;
			const usage = ctx.getContextUsage();
			const left =
				usage === undefined || usage.tokens === null || usage.tokens === undefined
					? undefined
					: Math.max(0, usage.contextWindow - usage.tokens);
			const text = formatStatusline(
				{ ...state, contextLeftTokens: left, agentsRunning: tracker.running() },
				(color, s) => ctx.ui.theme.fg(color, s),
			);
			ctx.ui.setStatus(STATUS_KEY, text);
		} catch {
			// Swallowed deliberately: a stale context after /reload throws, and chrome must never break a turn.
		}
	}

	pi.on("session_start", (_event, ctx) => {
		try {
			generation += 1;
			const gen = generation;
			lastCtx = ctx;
			tracker.reset();
			probe?.dispose();
			const route = restoreRoute(ctx);
			state = { mode: route.mode, escalated: route.escalated };
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
				let interruptKey = "esc";
				try {
					interruptKey = keyText("app.interrupt");
				} catch {
					// Swallowed deliberately: the hint falls back to the default key name.
				}
				ctx.ui.setHeader((_tui, theme) =>
					createHeaderComponent(
						() => ({ harnessVersion, piVersion: VERSION, mode: state.mode, escalated: state.escalated, interruptKey }),
						theme,
					),
				);
			}
			refresh();
			probe?.trigger();
		} catch {
			// Swallowed deliberately.
		}
	});

	pi.on("session_shutdown", () => {
		try {
			generation += 1;
			probe?.dispose();
			lastCtx = undefined;
		} catch {
			// Swallowed deliberately.
		}
	});

	pi.on("turn_end", (_event, ctx) => {
		try {
			lastCtx = ctx;
			refresh();
			probe?.trigger();
		} catch {
			// Swallowed deliberately.
		}
	});

	pi.on("model_select", (_event, ctx) => {
		try {
			lastCtx = ctx;
			refresh();
		} catch {
			// Swallowed deliberately.
		}
	});

	pi.on("session_compact", (_event, ctx) => {
		try {
			lastCtx = ctx;
			refresh();
		} catch {
			// Swallowed deliberately.
		}
	});

	pi.on("tool_execution_start", (event, ctx) => {
		try {
			lastCtx = ctx;
			if (tracker.onToolStart(event.toolName, event.toolCallId, event.args)) refresh();
		} catch {
			// Swallowed deliberately.
		}
	});

	pi.on("tool_execution_end", (event, ctx) => {
		try {
			lastCtx = ctx;
			if (tracker.onToolEnd(event.toolName, event.toolCallId)) refresh();
			if (event.toolName === "edit" || event.toolName === "write" || event.toolName === "bash") probe?.trigger();
		} catch {
			// Swallowed deliberately.
		}
	});

	pi.events.on("ky.routing.mode_changed", (payload) => {
		try {
			if (typeof payload !== "object" || payload === null) return;
			const p = payload as { mode?: unknown; escalated?: unknown };
			if (typeof p.mode !== "string") return;
			state.mode = p.mode;
			state.escalated = p.escalated === true;
			refresh();
		} catch {
			// Swallowed deliberately.
		}
	});

	for (const topic of SUBAGENT_BUS_TOPICS) {
		pi.events.on(topic, (payload) => {
			try {
				if (tracker.onBusEvent(topic, payload)) refresh();
			} catch {
				// Swallowed deliberately.
			}
		});
	}
}
