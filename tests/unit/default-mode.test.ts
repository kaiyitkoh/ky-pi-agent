/** A fresh session or /new starts in the default mode and applies its executor unless a model was chosen explicitly. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { freshSessionPlan, savedDefaultModel, type FreshSessionInput } from "../../.pi/extensions/routing/modes.ts";

const base: FreshSessionInput = {
	reason: "startup",
	hasModeEntry: false,
	hasMessages: false,
	isChild: false,
	argv: ["node", "pi"],
	settings: {},
};
const plan = (over: Partial<FreshSessionInput>) => freshSessionPlan({ ...base, ...over });

describe("freshSessionPlan", () => {
	it("a reload resets nothing", () => {
		expect(plan({ reason: "reload" })).toEqual({ reset: false, applyExecutor: false });
	});

	it.each(["startup", "new", "resume", "fork"])("%s without a mode entry resets", (reason) => {
		expect(plan({ reason }).reset).toBe(true);
	});

	it.each(["startup", "new", "resume", "fork"])("%s with a mode entry leaves restore to the branch", (reason) => {
		expect(plan({ reason, hasModeEntry: true })).toEqual({ reset: false, applyExecutor: false });
	});

	it("applies the executor on a fresh, empty, top-level session", () => {
		expect(plan({})).toEqual({ reset: true, applyExecutor: true });
	});

	it("resets without applying when the transcript already has messages or this is a subagent child", () => {
		expect(plan({ hasMessages: true })).toEqual({ reset: true, applyExecutor: false });
		expect(plan({ isChild: true })).toEqual({ reset: true, applyExecutor: false });
	});

	it.each([["--model"], ["--provider"], ["--models"]])("%s on the command line is an explicit choice", (flag) => {
		for (const argv of [["pi", flag, "x"], ["pi", `${flag}=x`]]) {
			const p = plan({ argv });
			expect(p).toMatchObject({ reset: true, applyExecutor: false });
			expect(p.explicit).toBe(flag);
		}
	});

	it("a saved default model or provider is an explicit choice that names its source", () => {
		for (const settings of [{ defaultModel: "m" }, { defaultProvider: "p" }]) {
			const p = plan({ settings });
			expect(p).toMatchObject({ reset: true, applyExecutor: false });
			expect(p.explicit).toContain("settings");
		}
	});

	it("does not mistake a longer flag for a model flag", () => {
		expect(plan({ argv: ["pi", "--model-thinking"] }).applyExecutor).toBe(true);
	});
});

describe("savedDefaultModel", () => {
	let root: string | undefined;
	afterEach(() => {
		if (root !== undefined) rmSync(root, { recursive: true, force: true });
		root = undefined;
	});

	it("reads either settings file and ignores missing ones", () => {
		root = mkdtempSync(join(tmpdir(), "ky-default-model-"));
		const agentDir = join(root, "agent");
		const project = join(root, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(project, ".pi"), { recursive: true });
		expect(savedDefaultModel(project, agentDir)).toEqual({ defaultModel: undefined, defaultProvider: undefined });
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "deepseek" }));
		writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ defaultModel: "deepseek-flash" }));
		expect(savedDefaultModel(project, agentDir)).toEqual({ defaultModel: "deepseek-flash", defaultProvider: "deepseek" });
	});
});
