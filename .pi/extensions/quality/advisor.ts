/**
 * Advisor escalation: the executor consults a stronger model mid-turn without changing its own model.
 * A tool, not a command, because the answer must return into the same turn. Registered in quality/index.ts;
 * this file only defines the mechanism. A thrown routing refusal propagates uncaught (Pi turns it into
 * `isError`, `pi-agent-core/dist/agent-loop.js:444-449`) and is never charged.
 */
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { addQualityCost } from "../diagnostics/quality-cost.ts";
import { runSingleShotRole } from "../routing/modes.ts";

/** Tool name used at registration. */
export const CONSULT_ADVISOR_TOOL_NAME = "consult_advisor";

/** Model-facing description; the whole serialised tool object measures 584 bytes / 146 tokens. */
export const CONSULT_ADVISOR_DESCRIPTION =
	"Consult a DIFFERENT, stronger advisor model at a genuine decision point. Does NOT change your own model; " +
	"you keep working the same turn afterward. Costs one nested call. Use ONLY when genuinely uncertain -- " +
	"never for routine work.";

/** Two string fields only: every extra field is a permanent per-turn cost. */
export const consultAdvisorParameters = Type.Object({
	question: Type.String({
		description: "The genuine decision point to ask the advisor about.",
	}),
	context: Type.String({
		description: "Code, options considered, and the reason for uncertainty.",
	}),
});

/** The tool call's two arguments. */
export interface ConsultAdvisorArgs {
	readonly question: string;
	readonly context: string;
}

/** Short and scoped; the advisor sees only the shared `context`, never the executor's full task. */
const ADVISOR_SYSTEM_PROMPT =
	"You are a stronger advisor model, consulted mid-turn by another agent that has reached a genuine decision " +
	"point and is uncertain how to proceed. Answer the question asked, directly. State your own uncertainty " +
	"plainly where it exists -- do not manufacture confidence you do not have. Do not attempt to do the " +
	"caller's underlying work for them: you were given only the question and the context they chose to " +
	"share, not their full task.";

/** Dispatches one consult through `runSingleShotRole` and returns the advisor's text; cost goes to `addQualityCost`. */
export async function executeConsultAdvisor(ctx: ExtensionContext, args: ConsultAdvisorArgs): Promise<string> {
	const messages: Message[] = [
		{
			role: "user",
			content: `Question: ${args.question}\n\nContext:\n${args.context}`,
			timestamp: Date.now(),
		},
	];

	const start = process.hrtime.bigint();
	const message: AssistantMessage = await runSingleShotRole(ctx, {
		role: "advisor",
		systemPrompt: ADVISOR_SYSTEM_PROMPT,
		messages,
		need: {},
	});
	const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
	addQualityCost({ ms: elapsedMs, tokens: message.usage.totalTokens });

	// Returns a plain string; the registration wrapper must not set `terminate`, since a consult continues the turn.
	return message.content
		.filter((block): block is Extract<AssistantMessage["content"][number], { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join(" ")
		.trim();
}
