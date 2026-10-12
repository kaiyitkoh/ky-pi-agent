import { describe, expect, it } from "vitest";

import {
	applyProfile,
	classifiedToolNames,
	DEFAULT_PROFILE,
	findUnclassified,
	PROFILE_NAMES,
	PROFILE_NEUTRAL_TOOLS,
	resolveProfile,
	TOOL_PROFILES,
	type ProfileName,
} from "../../.pi/extensions/routing/profiles.ts";

const rows: Array<[string[], ProfileName[]]> = [
	[["read", "bash", "approve_ky_command", "web_enable"], ["recon", "review", "implement", "full"]],
	[["edit", "write", "todo"], ["implement", "full"]],
	[["consult_advisor", "lsp_diagnostics", "lsp_fix"], ["review", "implement", "full"]],
	[["subagent", "bg_wait", "subagent_supervisor", "subagents_enable"], ["review", "implement", "full"]],
	[["web_search", "fetch_content", "get_search_content", "source_check"], ["recon", "full"]],
	[["questionnaire", "bg_run", "bg_status", "bg_logs", "bg_kill", "qoder_delegate"], ["full"]],
];

describe("profile table", () => {
	it("defaults to implement", () => {
		expect(DEFAULT_PROFILE).toBe("implement");
	});

	for (const [names, profiles] of rows) {
		for (const name of names) {
			it(`${name} is kept by exactly ${profiles.join(",")}`, () => {
				expect([...TOOL_PROFILES[name]!]).toEqual(profiles);
			});
		}
	}

	it("lists every table tool for full", () => {
		for (const [name, profiles] of Object.entries(TOOL_PROFILES)) {
			expect(profiles, name).toContain("full");
		}
	});

	it("keeps approve_ky_command in every profile", () => {
		for (const p of PROFILE_NAMES) expect(TOOL_PROFILES.approve_ky_command).toContain(p);
	});

	it("treats grep, find and ls as neutral", () => {
		expect(PROFILE_NEUTRAL_TOOLS).toEqual(expect.arrayContaining(["grep", "find", "ls"]));
		expect(classifiedToolNames()).toContain("grep");
	});
});

describe("resolveProfile", () => {
	it("accepts the four names", () => {
		for (const p of PROFILE_NAMES) expect(resolveProfile(p)).toBe(p);
	});
	it("falls back to the default on anything else", () => {
		for (const v of [undefined, true, "", "nonsense", 3, null]) expect(resolveProfile(v)).toBe("implement");
	});
});

describe("applyProfile", () => {
	const active = ["read", "bash", "edit", "write", "bg_run", "questionnaire", "todo", "consult_advisor", "approve_ky_command"];

	it("does nothing for full", () => {
		expect(applyProfile(active, "full")).toBeUndefined();
	});
	it("narrows implement in input order", () => {
		expect(applyProfile(active, "implement")).toEqual([
			"read", "bash", "edit", "write", "todo", "consult_advisor", "approve_ky_command",
		]);
	});
	it("leaves a read-only loadout alone", () => {
		expect(applyProfile(["read", "bash", "grep", "questionnaire"], "recon")).toBeUndefined();
	});
	it("keeps neutral and unclassified names", () => {
		const out = applyProfile(["read", "edit", "grep", "brand_new_tool", "bg_run"], "recon");
		expect(out).toEqual(["read", "grep", "brand_new_tool"]);
	});
	it("never returns a name absent from its input", () => {
		for (const p of PROFILE_NAMES) {
			const out = applyProfile(active, p) ?? active;
			for (const n of out) expect(active).toContain(n);
		}
	});
	it("returns undefined when nothing is removed", () => {
		expect(applyProfile(["read", "edit"], "implement")).toBeUndefined();
	});
});

describe("findUnclassified", () => {
	it("reports a name missing from the table", () => {
		expect(findUnclassified(["brand_new_tool", "read", "grep"])).toEqual(["brand_new_tool"]);
	});
	it("mutation: a table without todo reports todo", () => {
		const { todo: _drop, ...without } = TOOL_PROFILES;
		expect(findUnclassified(["todo", "read"], without)).toEqual(["todo"]);
	});
});
