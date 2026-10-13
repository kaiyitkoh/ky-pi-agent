/**
 * Predicate for a cheap model *describing* a tool call in text instead of emitting one: `finish_reason: "stop"`,
 * no tool call, call syntax in `content`. Pure so `tests/unit/prose-detector.test.ts` needs no session; the retry
 * effect lives in `index.ts`. Nothing here parses arguments: promoting scraped prose to a real call would run an
 * unvetted tool. It reports a name and a verdict.
 *
 * Four gates, all required: `stopReason === "stop"` (pi-ai `dist/types.d.ts` StopReason); no `toolCall` content block
 * (`dist/types.d.ts` ToolCall); a non-empty active-tool list; text matching a pattern anchored to those names.
 * `rawStopReason` is not a gate, since `fauxAssistantMessage` never sets it. A miss is cheap and a false positive
 * corrupts the measured rate, so the pattern needs `name(` and `{` and every gate is a conjunction.
 * Matching is bounded (counted quantifiers, no `.*`) against ReDoS on untrusted output.
 */
import type { AssistantMessage } from "./schema.ts";

/** Longest whitespace run tolerated between name, paren and brace; a counted bound, since an unbounded quantifier would be a ReDoS risk. */
const MAX_GAP = 8;

/** Escape regex metacharacters so a registered tool name cannot widen the pattern it is spliced into. */
export function escapeRegExpLiteral(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

/**
 * Build the tool-name-anchored matcher, or `undefined` for an empty list (a generic call pattern would match every
 * printed code block). No `g` flag: used with `.exec()`, so it must be stateless.
 */
export function buildProseToolCallPattern(activeToolNames: readonly string[]): RegExp | undefined {
	if (activeToolNames.length === 0) {
		return undefined;
	}
	const names = activeToolNames.map(escapeRegExpLiteral).join("|");
	// Counted quantifiers and no `.`: ReDoS on a megabyte of model output would take the instrument down.
	return new RegExp(`\\b(${names})[\\s]{0,${MAX_GAP}}\\([\\s]{0,${MAX_GAP}}\\{`);
}

/** The text a reader would see: every `text` block, joined, in order. */
export function collectText(message: AssistantMessage): string {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

/** Which tool was described in prose, or `undefined` when any gate fails. Builds the pattern and joins the text once. */
export function proseToolCallName(
	message: AssistantMessage,
	activeToolNames: readonly string[],
): string | undefined {
	// Gate 1: only a clean stop can be a silently incomplete turn.
	// Gate 2: a model that emitted the call and also narrated it did its job.
	if (message.stopReason !== "stop" || message.content.some((block) => block.type === "toolCall")) {
		return undefined;
	}
	// Gate 3: with no active tool any hit is a false positive.
	// Gate 4: a bare mention, a mention with a paren and an unregistered name do not match.
	return buildProseToolCallPattern(activeToolNames)?.exec(collectText(message))?.[1];
}

/** Did this finalized assistant message describe a tool call instead of making one? */
export function isProseToolCall(message: AssistantMessage, activeToolNames: readonly string[]): boolean {
	return proseToolCallName(message, activeToolNames) !== undefined;
}
