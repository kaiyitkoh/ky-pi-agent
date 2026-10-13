/** `bg_enable` activates the background-task tools and questionnaire on demand, through `pi.setActiveTools`. */
import { describe, expect, it } from "vitest";

import { BG_LOADED_TOOLS, BG_LOADER_NAME, registerBgLoader } from "../../.pi/extensions/routing/loader.ts";

interface Registered {
	name: string;
	execute: () => Promise<{ isError: boolean; content: { text: string }[] }>;
}

function stub(registered: string[], initiallyActive: string[]) {
	let active = [...initiallyActive];
	const tools: Registered[] = [];
	const pi = {
		registerTool: (tool: Registered) => tools.push(tool),
		getAllTools: () => [...registered, ...tools.map((t) => t.name)].map((name) => ({ name })),
		getActiveTools: () => active,
		setActiveTools: (next: string[]) => {
			active = next;
		},
	};
	registerBgLoader(pi as never);
	return { tool: tools[0] as Registered, active: () => active };
}

describe("bg_enable", () => {
	it("registers one tool with no prompt metadata", () => {
		const { tool } = stub([], []);
		expect(tool.name).toBe(BG_LOADER_NAME);
		expect(tool).not.toHaveProperty("promptSnippet");
		expect(tool).not.toHaveProperty("promptGuidelines");
	});

	it("adds every installed loaded tool to the active set and keeps the rest", async () => {
		const { tool, active } = stub([...BG_LOADED_TOOLS, "read"], ["read", BG_LOADER_NAME]);
		const out = await tool.execute();
		expect(out.isError).toBe(false);
		expect(active()).toEqual(["read", BG_LOADER_NAME, ...BG_LOADED_TOOLS]);
	});

	it("reports an error when none of the tools is installed", async () => {
		const { tool, active } = stub(["read"], ["read"]);
		expect((await tool.execute()).isError).toBe(true);
		expect(active()).toEqual(["read"]);
	});
});
