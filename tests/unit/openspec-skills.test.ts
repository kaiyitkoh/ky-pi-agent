import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatSkillsForPrompt, loadSkills } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import {
	OPENSPEC_SKILL_NAMES,
	OPENSPEC_WORKFLOWS,
	openspecSkillMd,
} from "../fixtures/openspec-skills.ts";

const dirs: string[] = [];

afterEach(() => {
	while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function load(flagFor: (skill: string) => "true" | "quoted" | "false" | undefined) {
	const agentDir = mkdtempSync(join(tmpdir(), "kypi-ospec-agent-"));
	const cwd = mkdtempSync(join(tmpdir(), "kypi-ospec-cwd-"));
	dirs.push(agentDir, cwd);
	for (const skill of OPENSPEC_SKILL_NAMES) {
		mkdirSync(join(agentDir, "skills", skill), { recursive: true });
		writeFileSync(join(agentDir, "skills", skill, "SKILL.md"), openspecSkillMd(skill, flagFor(skill)), "utf-8");
	}
	const result = loadSkills({ cwd, agentDir, skillPaths: [], includeDefaults: true });
	const skills = result.skills.filter((s) => OPENSPEC_SKILL_NAMES.includes(s.name));
	expect(skills).toHaveLength(OPENSPEC_WORKFLOWS.length);
	return { skills, diagnostics: result.diagnostics };
}

describe("openspec skills in Pi's loader", () => {
	it("flagged skills load cleanly and index to an empty string", () => {
		const { skills, diagnostics } = load(() => "true");
		expect(diagnostics).toEqual([]);
		expect(skills.every((s) => s.disableModelInvocation === true)).toBe(true);
		expect(formatSkillsForPrompt(skills)).toBe("");
	});

	it("unflagged skills index every name", () => {
		const { skills } = load(() => undefined);
		const index = formatSkillsForPrompt(skills);
		expect(index).not.toBe("");
		for (const name of OPENSPEC_SKILL_NAMES) expect(index).toContain(name);
	});

	it("a quoted true is not honoured", () => {
		const { skills } = load((s) => (s === "openspec-explore" ? "quoted" : "true"));
		const index = formatSkillsForPrompt(skills);
		expect(index).not.toBe("");
		expect(index).toContain("openspec-explore");
		expect(OPENSPEC_SKILL_NAMES.filter((n) => index.includes(n))).toEqual(["openspec-explore"]);
	});

	it("fixture descriptions are realistic and colon-free", () => {
		for (const name of OPENSPEC_SKILL_NAMES) {
			const line = openspecSkillMd(name).split("\n").find((l) => l.startsWith("description: "))!;
			const desc = line.slice("description: ".length);
			expect(desc.length).toBeGreaterThanOrEqual(176);
			expect(desc.length).toBeLessThanOrEqual(1024);
			expect(desc).not.toContain(": ");
		}
	});
});
