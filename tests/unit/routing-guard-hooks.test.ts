/**
 * The routing extension's model_select and input hooks, driven through a stub `pi` so a Bedrock reasoning model,
 * a persisted default and a failing revert can be staged without a provider.
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import routing from "../../.pi/extensions/routing/index.ts";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

function model(provider: string, id: string, extra: Partial<Model<Api>> = {}): Model<Api> {
	return {
		id,
		name: id,
		api: "openai-completions",
		provider,
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
		...extra,
	} as Model<Api>;
}

const CAPABLE = model("deepseek", "deepseek-flash");
const QWEN = model("amazon-bedrock", "qwen.qwen3-32b-v1:0", { api: "bedrock-converse-stream", reasoning: true });
const R1 = model("amazon-bedrock", "deepseek.r1-v1:0", { api: "bedrock-converse-stream", reasoning: true });

function load(opts: { setModel?: () => Promise<boolean>; settings?: Record<string, unknown> } = {}) {
	const handlers = new Map<string, Handler[]>();
	const calls = { setModel: 0, thinking: [] as string[] };
	const pi = {
		registerCommand: () => undefined,
		registerTool: () => undefined,
		registerFlag: () => undefined,
		getFlag: () => undefined,
		on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		setModel: async () => {
			calls.setModel += 1;
			return opts.setModel === undefined ? true : opts.setModel();
		},
		setThinkingLevel: (level: string) => calls.thinking.push(level),
		getThinkingLevel: () => "medium",
		getSettings: () => opts.settings ?? {},
		getActiveTools: () => [],
		setActiveTools: () => undefined,
		events: { emit: () => undefined },
	};
	routing(pi as never);
	const notes: { text: string; level: string }[] = [];
	const ctx = (extra: Record<string, unknown> = {}) => ({
		ui: { notify: (text: string, level: string) => notes.push({ text, level }) },
		getContextUsage: () => ({ tokens: 0 }),
		thinkingLevel: "medium",
		isIdle: () => false,
		...extra,
	});
	const fire = async (name: string, event: Record<string, unknown>, extra?: Record<string, unknown>) => {
		const results = [];
		for (const handler of handlers.get(name) ?? []) results.push(await handler(event, ctx(extra)));
		return results;
	};
	return { fire, notes, calls };
}

describe("model_select", () => {
	it("a Bedrock reasoning model that only fails on thinking is kept, with thinking turned off", async () => {
		const { fire, notes, calls } = load();
		await fire("model_select", { model: QWEN, previousModel: CAPABLE, source: "set" });
		expect(calls.setModel).toBe(0);
		expect(calls.thinking).toEqual(["off"]);
		expect(notes.map((n) => n.text).join("\n")).toContain("thinking is now off");
	});

	it("a failed revert says so instead of claiming it reverted", async () => {
		const { fire, notes } = load({ setModel: async () => false });
		await fire("model_select", { model: R1, previousModel: CAPABLE, source: "set" });
		const text = notes.map((n) => n.text).join("\n");
		expect(text).toContain("failed");
		expect(text).not.toContain("Reverted to");
	});

	it("a successful revert names the model and the resulting thinking level", async () => {
		const { fire, notes } = load();
		await fire("model_select", { model: R1, previousModel: CAPABLE, source: "set" });
		expect(notes.map((n) => n.text).join("\n")).toContain("Reverted to deepseek/deepseek-flash; thinking is now medium");
	});

	it("warns when the refused model is still the saved default", async () => {
		const { fire, notes } = load({ settings: { defaultProvider: "amazon-bedrock", defaultModel: R1.id } });
		await fire("model_select", { model: R1, previousModel: CAPABLE, source: "set" });
		expect(notes.map((n) => n.text).join("\n")).toContain("still saved as your default model");
	});
});

describe("input backstop", () => {
	it("refuses a prompt an extension sends on R1, as /grill and /plan do with no guard of their own", async () => {
		const { fire, notes } = load();
		const results = await fire("input", { text: "Interview me about the spec", source: "extension" }, { model: R1 });
		expect(results).toContainEqual({ action: "handled" });
		expect(notes.map((n) => n.text).join("\n")).toContain("Prompt not sent");
	});

	it("lets an extension prompt through on a capable model", async () => {
		const { fire } = load();
		const results = await fire("input", { text: "do the task", source: "extension" }, { model: CAPABLE });
		expect(results).not.toContainEqual({ action: "handled" });
	});

	it("an interactive prompt on R1 is still refused", async () => {
		const { fire } = load();
		const results = await fire("input", { text: "hello", source: "interactive" }, { model: R1 });
		expect(results).toContainEqual({ action: "handled" });
	});

	it("an overfull context warns and points at /compact instead of refusing", async () => {
		const { fire, notes } = load();
		const results = await fire("input", { text: "hello", source: "interactive" }, { model: CAPABLE, getContextUsage: () => ({ tokens: 5000 }) });
		expect(results).not.toContainEqual({ action: "handled" });
		expect(notes.map((n) => n.text).join("\n")).toContain("/compact");
	});
});
