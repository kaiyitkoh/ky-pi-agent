/** A fresh session or /new starts in the default mode and applies its executor unless a model flag was passed. */
import { describe, expect, it } from "vitest";

import { freshSessionPlan, type FreshSessionInput } from "../../.pi/extensions/routing/modes.ts";
import * as modes from "../../.pi/extensions/routing/modes.ts";

const base: FreshSessionInput = {
	reason: "startup",
	hasModeEntry: false,
	hasMessages: false,
	isChild: false,
	argv: ["node", "pi"],
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

	it.each([["--model"], ["--provider"], ["--models"]])("%s on the command line opts out, with no notice to show", (flag) => {
		for (const argv of [["pi", flag, "x"], ["pi", `${flag}=x`]]) {
			expect(plan({ argv })).toEqual({ reset: true, applyExecutor: false });
		}
	});

	it("does not mistake a longer flag for a model flag", () => {
		expect(plan({ argv: ["pi", "--model-thinking"] }).applyExecutor).toBe(true);
	});

	it("takes no settings input: a defaultModel Pi saved on /login cannot opt out", () => {
		expect(Object.keys(base).sort()).toEqual(["argv", "hasMessages", "hasModeEntry", "isChild", "reason"]);
		expect("savedDefaultModel" in modes).toBe(false);
		const withSaved = { ...base, settings: { defaultModel: "m", defaultProvider: "p" } } as FreshSessionInput;
		expect(freshSessionPlan(withSaved)).toEqual({ reset: true, applyExecutor: true });
	});
});
