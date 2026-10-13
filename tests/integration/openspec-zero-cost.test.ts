import type { TranscriptContext } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import {
	OPENSPEC_SKILL_NAMES,
	OPENSPEC_WORKFLOWS,
	openspecPromptMd,
	openspecSkillMd,
} from "../fixtures/openspec-skills.ts";
import { transcriptView } from "../helpers/faux.ts";
import {
	type HarnessSessionOptions,
	normalisePaths,
	withHarnessSession,
} from "../helpers/harness-session.ts";

const FLAGGED: Record<string, string> = Object.fromEntries(
	OPENSPEC_SKILL_NAMES.map((n) => [n, openspecSkillMd(n, "true")]),
);
const UNFLAGGED: Record<string, string> = Object.fromEntries(
	OPENSPEC_SKILL_NAMES.map((n) => [n, openspecSkillMd(n)]),
);
const PROMPTS: Record<string, string> = Object.fromEntries(
	OPENSPEC_WORKFLOWS.map((w) => [`opsx-${w.workflow}`, openspecPromptMd(w.workflow)]),
);

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((c) => (typeof c === "object" && c !== null && "text" in c ? String(c.text) : "")).join(" ");
}

async function firstRequest(
	opts: HarnessSessionOptions,
	input = "hi",
): Promise<{ systemPrompt: string; tools: string[]; lastUser: string }> {
	return withHarnessSession(opts, async (h) => {
		await h.session.prompt(input);
		const ctx: TranscriptContext | undefined = h.captured[0];
		if (ctx === undefined) throw new Error("no request reached the faux provider");
		const view = transcriptView(ctx);
		const users = view.messages.filter((m) => m.role === "user");
		return {
			systemPrompt: normalisePaths(view.systemPrompt, h),
			tools: view.tools.map((t) => t.name),
			lastUser: textOf(users[users.length - 1]?.content),
		};
	});
}

describe("openspec skills and prompt templates cost nothing per turn", () => {
	it("a session with flagged skills and opsx templates is byte-identical to one without", async () => {
		const bare = await firstRequest({});
		const loaded = await firstRequest({ agentSkills: FLAGGED, agentPrompts: PROMPTS });
		expect(loaded.systemPrompt).toBe(bare.systemPrompt);
		expect(loaded.tools).toEqual(bare.tools);
	});

	it("unflagged skills do change the prompt (negative control)", async () => {
		const bare = await firstRequest({});
		const loaded = await firstRequest({ agentSkills: UNFLAGGED });
		expect(loaded.systemPrompt).not.toBe(bare.systemPrompt);
		expect(loaded.systemPrompt).toContain("openspec-explore");
	});

	it("a flagged skill is still injected on /skill:", async () => {
		const r = await firstRequest({ agentSkills: FLAGGED, agentPrompts: PROMPTS }, "/skill:openspec-explore");
		expect(r.lastUser).toContain('skill name="openspec-explore"');
	});

	it("an opsx template still expands when typed", async () => {
		const r = await firstRequest({ agentSkills: FLAGGED, agentPrompts: PROMPTS }, "/opsx-explore");
		expect(r.lastUser).toContain("OPSX-TEMPLATE-explore");
	});
});
