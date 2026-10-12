/**
 * The vendored shell-policy guidance is omitted when bg_run is not offered
 * (PROVENANCE deviation 9) and unchanged when it is.
 */
import { describe, expect, it } from "vitest";

import {
	SHELL_POLICY_SECTION,
	createShellPolicyGuidanceHandler,
	initializeShellPolicy,
	shellPolicyGuidance,
} from "../../.pi/extensions/background-tasks/src/core/shell-policy.ts";

const policy = initializeShellPolicy({ platform: "linux", env: {}, activationCwd: "/work" });
const handler = createShellPolicyGuidanceHandler(policy);

function event(selectedTools: string[] | undefined, forced?: string) {
	const options: Record<string, unknown> = { sections: {} };
	if (selectedTools) options.selectedTools = selectedTools;
	if (forced !== undefined) options.forceSystemPrompt = forced;
	return { systemPrompt: "base", systemPromptOptions: options } as never;
}

function sectionsOf(e: { systemPromptOptions: { sections: Record<string, string> } }) {
	return e.systemPromptOptions.sections;
}

describe("shell-policy gate", () => {
	it("omits the section and leaves a forced prompt alone when bg_run is not selected", () => {
		const e = event(["read", "bash"], "forced") as never as { systemPromptOptions: any };
		expect(handler(e as never)).toBeUndefined();
		expect(sectionsOf(e)[SHELL_POLICY_SECTION]).toBeUndefined();
		expect(e.systemPromptOptions.forceSystemPrompt).toBe("forced");
	});

	it("keeps the section byte-identical when bg_run is selected", () => {
		const e = event(["read", "bg_run"], "forced") as never as { systemPromptOptions: any };
		expect(handler(e as never)).toBeUndefined();
		expect(sectionsOf(e)[SHELL_POLICY_SECTION]).toBe(shellPolicyGuidance(policy));
		expect(e.systemPromptOptions.forceSystemPrompt).toContain(shellPolicyGuidance(policy));
	});

	it("fails open when selectedTools is absent", () => {
		const e = event(undefined) as never as { systemPromptOptions: any };
		handler(e as never);
		expect(sectionsOf(e)[SHELL_POLICY_SECTION]).toBe(shellPolicyGuidance(policy));
	});
});
