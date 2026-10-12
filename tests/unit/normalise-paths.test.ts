import { describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { measureFloor, normalisePaths } from "../helpers/harness-session.ts";

const handle = { cwd: "/tmp/kypi-harness-cwd-x", agentDir: "/tmp/kypi-harness-agent-x" };

describe("normalisePaths", () => {
	it("maps a back-slash skill location to the same text as a forward-slash one", () => {
		const back = repoRoot().replace(/\//g, "\\");
		const fwd = repoRoot().replace(/\\/g, "/");
		const fromBack = normalisePaths(`<location>${back}\\.pi\\skills\\grill\\SKILL.md</location>`, handle);
		const fromFwd = normalisePaths(`<location>${fwd}/.pi/skills/grill/SKILL.md</location>`, handle);
		expect(fromBack).toBe("<location><repo>/.pi/skills/grill/SKILL.md</location>");
		expect(fromFwd).toBe(fromBack);
	});

	it("replaces the shell executable whatever its path", () => {
		const win = normalisePaths('{"policy":"bash","executable":"C:\\\\Program Files\\\\Git\\\\usr\\\\bin\\\\bash.exe"}', handle);
		const mac = normalisePaths('{"policy":"bash","executable":"/bin/bash"}', handle);
		expect(win).toBe('{"policy":"bash","executable":"<shell>"}');
		expect(mac).toBe(win);
	});

	it("leaves no machine path in a measured prompt", async () => {
		const m = await measureFloor({ profile: "full" });
		const root = repoRoot();
		for (const form of [root, root.replace(/\\/g, "/"), root.replace(/\//g, "\\")]) {
			expect(m.systemPrompt).not.toContain(form);
		}
		expect(m.systemPrompt, "non-vacuity: skill locations are measured").toContain("<repo>/.pi/skills/");
		expect(m.systemPrompt).toContain('"executable":"<shell>"');
		expect(m.systemPrompt).not.toMatch(/<(?:repo|cwd|agent)>[^\s<]*\\/);
	}, 60_000);
});
