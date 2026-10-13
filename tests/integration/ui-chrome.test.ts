import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHeaderComponent, formatHeaderLines } from "../../.pi/extensions/ui/header.ts";
import { createHarnessSession, type HarnessHandle, type HarnessSessionOptions } from "../helpers/harness-session.ts";
import { createRecordingUI } from "../helpers/recording-ui.ts";

const identityFg = (_color: string, text: string): string => text;

describe("header", () => {
	it("renders the title and hint lines", () => {
		const lines = formatHeaderLines(
			{ harnessVersion: "0.1.0", piVersion: "1.1.0", mode: "cheap", escalated: false, interruptKey: "esc" },
			identityFg,
		);
		expect(lines).toEqual(["ky-pi-agent 0.1.0 · pi 1.1.0 · cheap", "/ commands · ! bash · esc interrupt"]);
	});

	it("omits a missing harness version and marks escalation", () => {
		const lines = formatHeaderLines(
			{ piVersion: "1.1.0", mode: "max", escalated: true, interruptKey: "esc" },
			identityFg,
		);
		expect(lines[0]).toBe("ky-pi-agent · pi 1.1.0 · max↑");
	});

	it("never lets an escape sequence in the mode reach the output", () => {
		const lines = formatHeaderLines({ piVersion: "1.1.0", mode: "\u001b[31mred\u001b[0m" }, identityFg);
		expect(lines.join("\n")).not.toContain("\u001b");
		expect(lines[0]).toContain("red");
	});

	it("truncates to the width and reflects live info on the next render", () => {
		let info: { mode: string; escalated: boolean } = { mode: "cheap", escalated: false };
		const component = createHeaderComponent(() => ({ piVersion: "1.1.0", ...info }), { fg: identityFg });
		const first = component.render(20);
		expect(first.length).toBe(2);
		for (const line of first) expect(visibleWidth(line)).toBeLessThanOrEqual(20);
		info = { mode: "max", escalated: true };
		expect(component.render(80)[0]).toContain("max↑");
	});
});

const STASH_KEY = "__kyUiTestPi";
const UI_ENTRY = ".pi/extensions/ui/index.ts";
const sessions: HarnessHandle[] = [];

afterEach(async () => {
	delete (globalThis as Record<string, unknown>)[STASH_KEY];
	while (sessions.length > 0) await sessions.pop()!.dispose();
});

const STASH_SRC = `
export default function (pi) {
  globalThis.${STASH_KEY} = pi;
  pi.registerTool({
    name: "subagent",
    label: "subagent",
    description: "stub",
    parameters: { type: "object", properties: {} },
    async execute() { return { content: [{ type: "text", text: "done" }], details: {} }; },
  });
}`;

type Bus = { events: { emit(channel: string, data: unknown): void } };
const bus = (): Bus => (globalThis as Record<string, unknown>)[STASH_KEY] as Bus;

const stubTheme = { fg: identityFg };
type HeaderFactory = (tui: unknown, theme: unknown) => { render(width: number): string[] };

async function open(
	mode: "tui" | "rpc" | "json" | "print",
	extra: Partial<HarnessSessionOptions> = {},
) {
	const rec = createRecordingUI();
	const handle = await createHarnessSession({
		entryPoints: [UI_ENTRY],
		extraExtensionSource: STASH_SRC,
		uiContext: rec.ui,
		mode,
		...extra,
	});
	sessions.push(handle);
	return { rec, handle };
}

const last = (xs: (string | undefined)[]): string | undefined => xs[xs.length - 1];

function git(cwd: string, ...args: string[]): void {
	const r = spawnSync(
		"git",
		["-c", "user.name=t", "-c", "user.email=t@test.invalid", "-c", "commit.gpgsign=false", ...args],
		{ cwd, encoding: "utf-8", shell: false, windowsHide: true },
	);
	if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function seedGit(session: AgentSession): void {
	const cwd = session.sessionManager.getCwd();
	git(cwd, "init", "-q");
	writeFileSync(join(cwd, "untracked.txt"), "x");
}

describe("ui extension in a session", () => {
	it("sets one header and a cheap statusline in tui mode", async () => {
		const { rec } = await open("tui");
		expect(rec.calls.filter((c) => c.method === "setHeader")).toHaveLength(1);
		const lines = (rec.lastHeaderFactory() as HeaderFactory)(undefined, stubTheme).render(80);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("ky-pi-agent");
		expect(lines[0]).toContain("cheap");
		expect(last(rec.statuses("ky-statusline"))).toContain("cheap");
	});

	it("follows routing mode changes in the status and the live header", async () => {
		const { rec } = await open("tui");
		bus().events.emit("ky.routing.mode_changed", { mode: "max", escalated: true, model: "faux/faux-flash" });
		expect(last(rec.statuses("ky-statusline"))).toContain("max↑");
		const lines = (rec.lastHeaderFactory() as HeaderFactory)(undefined, stubTheme).render(80);
		expect(lines[0]).toContain("max↑");
	});

	it("restores the persisted mode at session start", async () => {
		const { rec } = await open("tui", {
			beforeBind: (session) => {
				session.sessionManager.appendCustomEntry("ky:mode", { mode: "balanced", escalated: false, at: 0 });
			},
		});
		expect(rec.statuses("ky-statusline")[0]).toContain("balanced");
	});

	it("counts async subagents from bus stubs and ignores malformed payloads", async () => {
		const { rec } = await open("tui");
		const status = () => last(rec.statuses("ky-statusline"));
		bus().events.emit("subagent:async-started", { id: "run-a", agent: "scout" });
		expect(status()).toContain("1 agent");
		bus().events.emit("subagent:async-started", { id: "run-b" });
		expect(status()).toContain("2 agents");
		bus().events.emit("subagent:async-complete", { id: "run-a", state: "complete" });
		expect(status()).toContain("1 agent");
		bus().events.emit("subagent:async-complete", { runId: "run-b" });
		expect(status()).not.toContain("agent");

		const before = rec.statuses("ky-statusline").length;
		for (const bad of [null, 7, { id: 3 }]) {
			expect(() => bus().events.emit("subagent:async-started", bad)).not.toThrow();
		}
		expect(rec.statuses("ky-statusline")).toHaveLength(before);
	});

	it("shows a foreground subagent tool call while it runs", async () => {
		const { rec, handle } = await open("tui", {
			responses: [
				fauxAssistantMessage(fauxToolCall("subagent", {}, { id: "call-1" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("ok"),
			],
		});
		await handle.session.prompt("go");
		const seen = rec.statuses("ky-statusline");
		expect(seen.some((s) => s?.includes("1 agent"))).toBe(true);
		expect(last(seen)).not.toContain("agent");
	});

	it("does not count a subagent management call as a running agent", async () => {
		const { rec, handle } = await open("tui", {
			responses: [
				fauxAssistantMessage(fauxToolCall("subagent", { action: "status" }, { id: "call-1" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("ok"),
			],
		});
		await handle.session.prompt("go");
		expect(rec.statuses("ky-statusline").some((s) => s?.includes("agent"))).toBe(false);
	});

	it("shows the changed-file count in a git checkout", async () => {
		const { rec, handle } = await open("tui", { agentsMd: false, beforeBind: seedGit });
		await handle.session.prompt("hi");
		await vi.waitFor(() => expect(rec.statuses("ky-statusline").some((s) => s?.includes("1 changed"))).toBe(true), {
			timeout: 5000,
		});
	});

	it("omits the changed-file segment outside a git checkout", async () => {
		const { rec, handle } = await open("tui", { agentsMd: false });
		await handle.session.prompt("hi");
		expect(rec.statuses("ky-statusline").some((s) => s?.includes("changed"))).toBe(false);
	});

	it("gives rpc mode a statusline but no header", async () => {
		const { rec } = await open("rpc");
		expect(rec.statuses("ky-statusline").length).toBeGreaterThan(0);
		expect(rec.calls.filter((c) => c.method === "setHeader")).toHaveLength(0);
	});

	it("sets no header in json mode", async () => {
		const { rec } = await open("json");
		expect(rec.calls.filter((c) => c.method === "setHeader")).toHaveLength(0);
	});

	it("runs a prompt in print mode with the default no-op UI", async () => {
		const handle = await createHarnessSession({ entryPoints: [UI_ENTRY], mode: "print", agentsMd: false });
		sessions.push(handle);
		await expect(handle.session.prompt("hi")).resolves.toBeUndefined();
	});
});
