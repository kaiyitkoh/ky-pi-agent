/**
 * Load-path sentinel: a provider whose unique model id makes `pi --list-models` prove the extension loaded.
 * registerProvider calls in the factory are queued and flushed (docs/extensions.md:1709), which makes them listable.
 * Ungated on purpose: registration is the observation. The id stays `ky-harness-selftest`; every load-path assertion greps it.
 * Registers commands and a provider, never a tool: tools[] is serialised into every request
 * (pi-ai src/api/openai-completions.ts:1337-1370), commands cost zero per-turn tokens.
 * No build step and no .gitignore under .pi/extensions/: package-manager.ts:571 honours one, loader.ts:652-684 does not.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { COMMENT_RULES_HEADING, COMMENT_RULES_SECTION, COMMENT_RULES_TEXT } from "./comment-rules.ts";

/** The sentinel string every load-path assertion greps for; tests import it instead of duplicating it. */
export const SELFTEST_MODEL_ID = "ky-harness-selftest";

/** Provider name under which the sentinel model is registered. */
export const SELFTEST_PROVIDER_ID = "ky-harness";

/** Deliberately dead endpoint (port 1): the sentinel model is never routed to. */
const DEAD_ENDPOINT = "http://127.0.0.1:1/v1";

export default function (pi: ExtensionAPI): void {
	// Skip when a context file already carries the rules so they appear once.
	pi.on("before_agent_start", (event) => {
		const o = event.systemPromptOptions;
		if (o.contextFiles.some((f) => f.content.includes(COMMENT_RULES_HEADING))) return undefined;
		if (typeof o.forceSystemPrompt === "string") {
			if (!o.forceSystemPrompt.includes(COMMENT_RULES_HEADING)) {
				o.forceSystemPrompt += `

${COMMENT_RULES_TEXT}`;
			}
			return undefined;
		}
		o.sections[COMMENT_RULES_SECTION] = COMMENT_RULES_TEXT;
		return undefined;
	});

	pi.registerCommand("ky-hello", {
		description: "ky-pi-agent liveness check",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`ky-pi-agent loaded (sentinel: ${SELFTEST_MODEL_ID})`, "info");
		},
	});

	pi.registerProvider(SELFTEST_PROVIDER_ID, {
		baseUrl: DEAD_ENDPOINT,
		apiKey: "unused",
		api: "openai-completions",
		models: [
			{
				id: SELFTEST_MODEL_ID,
				// Picker detail text: says choosing it will fail.
				name: "ky-pi-agent load-path sentinel (diagnostic only, not routable)",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 8192,
				maxTokens: 1024,
			},
		],
	});
}
