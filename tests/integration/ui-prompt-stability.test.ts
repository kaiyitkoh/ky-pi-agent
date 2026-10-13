import { appendFileSync } from "node:fs";
import { join } from "node:path";

import type { FauxResponseStep, TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { transcriptView } from "../helpers/faux.ts";
import { commitFile, gitInit, runGit } from "../helpers/git.ts";
import { createHarnessSession, type HarnessHandle } from "../helpers/harness-session.ts";
import { createRecordingUI } from "../helpers/recording-ui.ts";

const TRACKED = "ky-volatile-tracked-file.txt";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const STASH_KEY = "__kyUiTestPi";
const REC_KEY = "__kyUiTestRec";
const TURNS = 4;
const MODES = [
	{ mode: "balanced", escalated: false },
	{ mode: "max", escalated: true },
	{ mode: "cheap", escalated: false },
];

/** Empty string when every request shares one byte-equal prompt and tool list; otherwise the reason. */
function instabilityReason(contexts: readonly TranscriptContext[]): string {
	if (contexts.length < 2) return "fewer than two captured requests";
	const first = transcriptView(contexts[0]!);
	for (const [i, ctx] of contexts.entries()) {
		const view = transcriptView(ctx);
		const systemCount = ctx.messages.filter((m) => m.role === "system").length;
		if (systemCount !== 1) return `request ${i} carries ${systemCount} system messages`;
		if (view.systemPrompt !== first.systemPrompt) return `request ${i} system prompt differs from request 0`;
		const names = view.tools.map((t) => t.name).join(",");
		if (names !== first.tools.map((t) => t.name).join(",")) return `request ${i} tool names or order differ`;
	}
	return "";
}

const sessions: HarnessHandle[] = [];

afterEach(async () => {
	vi.useRealTimers();
	delete (globalThis as Record<string, unknown>)[STASH_KEY];
	delete (globalThis as Record<string, unknown>)[REC_KEY];
	while (sessions.length > 0) await sessions.pop()!.dispose();
});

function capturing(into: TranscriptContext[]): FauxResponseStep[] {
	const step: FauxResponseStep = (context) => {
		into.push(context);
		return fauxAssistantMessage("ok");
	};
	return Array.from({ length: TURNS }, () => step);
}

const extensionSource = (body: string): string => `
export default function (pi) {
  globalThis.${STASH_KEY} = pi;
${body}
}`;

type Bus = { events: { emit(channel: string, data: unknown): void } };

async function runTurns(opts: { body?: string } = {}) {
	const contexts: TranscriptContext[] = [];
	const rec = createRecordingUI();
	const handle = await createHarnessSession({
		profile: "full",
		fauxModels: ["faux-flash", "faux-pro"],
		mode: "tui",
		uiContext: rec.ui,
		extraExtensionSource: extensionSource(opts.body ?? ""),
		responses: capturing(contexts),
	});
	sessions.push(handle);
	(globalThis as Record<string, unknown>)[REC_KEY] = rec;
	const bus = (globalThis as Record<string, unknown>)[STASH_KEY] as Bus;

	gitInit(handle.cwd, "main", false);
	commitFile(handle.cwd, TRACKED, "one\n", "init");

	vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-01T12:00:00Z") });
	const tokens: number[] = [];
	for (let turn = 1; turn <= TURNS; turn++) {
		if (turn > 1) {
			vi.setSystemTime(Date.now() + WEEK_MS);
			runGit(["checkout", "-q", "-b", `ky-volatile-branch-${turn}`], handle.cwd);
			appendFileSync(join(handle.cwd, TRACKED), `edit ${turn}\n`);
			bus.events.emit("ky.routing.mode_changed", { ...MODES[(turn - 2) % MODES.length]!, model: "faux/faux-flash" });
			if (turn > 2) bus.events.emit("subagent:async-complete", { id: `ky-volatile-run-${turn - 1}` });
			bus.events.emit("subagent:async-started", { id: `ky-volatile-run-${turn}` });
		}
		if (turn === 3) {
			const current = handle.session.model;
			const pro = current && handle.session.modelRuntime.getModel(current.provider, "faux-pro");
			if (!pro) throw new Error("faux-pro did not resolve");
			await handle.session.setModel(pro);
		}
		await handle.session.prompt(`turn ${turn}`);
		tokens.push(handle.session.getSessionStats().tokens.total);
	}
	return { contexts, rec, tokens };
}

describe("system prompt byte stability with the full ui and changing state", () => {
	it("keeps prompt and tools identical across four turns of changing chrome", async () => {
		const { contexts, rec, tokens } = await runTurns();

		const distinct = new Set(rec.statuses("ky-statusline").filter((s) => s !== undefined));
		expect(distinct.size).toBeGreaterThanOrEqual(3);
		expect(rec.calls.filter((c) => c.method === "setHeader").length).toBeGreaterThanOrEqual(1);
		for (let i = 1; i < tokens.length; i++) expect(tokens[i]!).toBeGreaterThan(tokens[i - 1]!);

		expect(contexts).toHaveLength(TURNS);
		expect(instabilityReason(contexts)).toBe("");
		for (const ctx of contexts) {
			const prompt = transcriptView(ctx).systemPrompt;
			expect(prompt.length).toBeGreaterThan(0);
			expect(prompt).not.toContain("ky-volatile-branch");
			expect(prompt).not.toContain(TRACKED);
			expect(prompt).not.toContain("ky-volatile-run");
			expect(prompt).not.toMatch(/\b\d+(?:\.\d)?[kM]? left\b/);
			expect(prompt).not.toMatch(/\b\d+ changed\b/);
			expect(prompt).not.toMatch(/\b\d+ agents?\b/);
			expect(prompt).not.toMatch(/\$\d+\.\d{2}/);
			expect(prompt).not.toContain("max↑");
		}
	});

	it("a volatile section makes the same check fail (negative control)", async () => {
		const body = `
  pi.on("before_agent_start", (event) => {
    event.systemPromptOptions.sections.volatile = String(Date.now());
    return undefined;
  });`;
		const { contexts } = await runTurns({ body });
		expect(contexts).toHaveLength(TURNS);
		expect(instabilityReason(contexts)).not.toBe("");
	});

	it("a status-to-prompt leak makes the check fail (negative control)", async () => {
		const body = `
  pi.on("before_agent_start", (event) => {
    const statuses = globalThis.${REC_KEY}.statuses("ky-statusline");
    event.systemPromptOptions.sections.leak = String(statuses[statuses.length - 1]);
    return undefined;
  });`;
		const { contexts } = await runTurns({ body });
		expect(contexts).toHaveLength(TURNS);
		expect(instabilityReason(contexts)).not.toBe("");
	});
});
