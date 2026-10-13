/** One timed, charged single-shot role call and the reply readers every quality pass shares. Registers nothing. */
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { addQualityCost } from "../diagnostics/quality-cost.ts";
import { runSingleShotRole } from "../routing/modes.ts";

type Block = AssistantMessage["content"][number];

/** A thrown routing refusal never reaches a model, so it propagates uncharged. */
export async function callRole(ctx: ExtensionContext, opts: Parameters<typeof runSingleShotRole>[1]): Promise<AssistantMessage> {
	const start = process.hrtime.bigint();
	const reply = await runSingleShotRole(ctx, opts);
	addQualityCost({ ms: Number(process.hrtime.bigint() - start) / 1_000_000, tokens: reply.usage.totalTokens });
	return reply;
}

export function toolCallNamed(message: AssistantMessage, name: string): Extract<Block, { type: "toolCall" }> | undefined {
	return message.content.find((b): b is Extract<Block, { type: "toolCall" }> => b.type === "toolCall" && b.name === name);
}

export function replyText(message: AssistantMessage): string {
	return message.content
		.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text")
		.map((b) => b.text)
		.join(" ")
		.trim();
}
