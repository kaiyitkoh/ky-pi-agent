/** Protected-branch lists are the built-ins plus branches added in the user and project settings files. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { effectiveBranches } from "../../.pi/extensions/safety/branches.ts";

let agentDir: string;
let project: string;

const write = (dir: string, body: string): void => {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "settings.json"), body);
};
const user = (safety: unknown): void => write(agentDir, JSON.stringify({ safety }));
const proj = (safety: unknown): void => write(join(project, ".pi"), JSON.stringify({ safety }));

beforeEach(() => {
	const root = mkdtempSync(join(tmpdir(), "ky-branches-"));
	agentDir = join(root, "agent");
	project = join(root, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(project, { recursive: true });
});

afterEach(() => {
	rmSync(join(agentDir, ".."), { recursive: true, force: true });
});

describe("effectiveBranches", () => {
	it("is the built-ins when no settings exist", () => {
		const r = effectiveBranches(project, agentDir);
		expect(r.protectedBranches).toEqual(["main", "master"]);
		expect(r.pushProtectedBranches).toEqual(["main", "master", "staging"]);
		expect(r.warnings).toEqual([]);
	});

	it("adds user then project branches, de-duplicated case-insensitively, protected ones also push-protected", () => {
		user({ protectedBranches: ["release"] });
		proj({ protectedBranches: ["Release", "prod"] });
		const r = effectiveBranches(project, agentDir);
		expect(r.protectedBranches).toEqual(["main", "master", "release", "prod"]);
		expect(r.pushProtectedBranches).toEqual(["main", "master", "staging", "release", "prod"]);
	});

	it("pushProtectedBranches adds to the push list only", () => {
		user({ pushProtectedBranches: ["develop"] });
		const r = effectiveBranches(project, agentDir);
		expect(r.protectedBranches).toEqual(["main", "master"]);
		expect(r.pushProtectedBranches).toEqual(["main", "master", "staging", "develop"]);
	});

	it("skips blank and non-string entries without a warning", () => {
		user({ protectedBranches: [" ", "", 3, null, "qa"] });
		const r = effectiveBranches(project, agentDir);
		expect(r.protectedBranches).toEqual(["main", "master", "qa"]);
		expect(r.warnings).toEqual([]);
	});

	it.each([["a string", "release"], ["an object", {}]])("keeps the defaults and warns when the value is %s", (_label, value) => {
		user({ protectedBranches: value });
		const r = effectiveBranches(project, agentDir);
		expect(r.protectedBranches).toEqual(["main", "master"]);
		expect(r.warnings).toHaveLength(1);
		expect(r.warnings[0]).toContain("settings.json");
		expect(r.warnings[0]).toContain("safety.protectedBranches");
	});

	it("keeps the defaults and warns when the file does not parse", () => {
		write(join(project, ".pi"), "{ nope");
		const r = effectiveBranches(project, agentDir);
		expect(r.protectedBranches).toEqual(["main", "master"]);
		expect(r.warnings.length).toBeGreaterThan(0);
		expect(r.warnings[0]).toContain("built-in branches only");
	});

	it("reads a settings file saved with a UTF-8 BOM, as Pi does", () => {
		write(agentDir, `${String.fromCharCode(0xfeff)}${JSON.stringify({ safety: { protectedBranches: ["production"] } })}`);
		const r = effectiveBranches(project, agentDir);
		expect(r.protectedBranches).toEqual(["main", "master", "production"]);
		expect(r.warnings).toEqual([]);
	});

	it.each([["does not parse", "{ nope"], ["holds a non-array", JSON.stringify({ safety: { protectedBranches: "x" } })]])(
		"keeps the last list read from a file that later %s, and warns",
		(_label, broken) => {
			user({ protectedBranches: ["production"], pushProtectedBranches: ["develop"] });
			expect(effectiveBranches(project, agentDir).protectedBranches).toEqual(["main", "master", "production"]);
			write(agentDir, broken);
			const r = effectiveBranches(project, agentDir);
			expect(r.protectedBranches).toEqual(["main", "master", "production"]);
			expect(r.protectedBranches[0]).toBe("main");
			expect(r.warnings.some((w) => w.includes("keeping the branches last read from it (production)"))).toBe(true);
			user({ protectedBranches: [] });
			expect(effectiveBranches(project, agentDir).protectedBranches).toEqual(["main", "master"]);
		},
	);

	it("never moves main from index 0 and has no removal syntax", () => {
		user({ protectedBranches: ["MAIN", "-main", "!master"] });
		const r = effectiveBranches(project, agentDir);
		expect(r.protectedBranches[0]).toBe("main");
		expect(r.protectedBranches).toEqual(expect.arrayContaining(["main", "master"]));
	});
});
