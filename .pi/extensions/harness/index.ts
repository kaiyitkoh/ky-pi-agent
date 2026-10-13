/**
 * Load-path sentinel: the provider's unique model id makes `pi --list-models` prove the extension loaded,
 * because factory registerProvider calls are queued and flushed (pi 1.1.0 loader.js:163-166, runner.js:248-267).
 * Commands and a provider only, never a tool: tools[] is serialised into every request.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { COMMENT_RULES_SECTION, COMMENT_RULES_TEXT, hasCommentRulesHeading } from "./comment-rules.ts";

/** The sentinel string every load-path assertion greps for. */
export const SELFTEST_MODEL_ID = "ky-harness-selftest";

/** Provider name under which the sentinel model is registered. */
export const SELFTEST_PROVIDER_ID = "ky-harness";

/** Deliberately dead endpoint (port 1): the sentinel model is never routed to. */
const DEAD_ENDPOINT = "http://127.0.0.1:1/v1";

export default function (pi: ExtensionAPI): void {
	// Forced, not defaulted: bash children inherit process.env, and an inherited OPENSPEC_TELEMETRY=1 would re-enable reporting.
	// NO_UPDATE_CHECK also suppresses the unpinned self-upgrade offer.
	Object.assign(process.env, { OPENSPEC_TELEMETRY: "0", DO_NOT_TRACK: "1", OPENSPEC_NO_UPDATE_CHECK: "1", OPENSPEC_NO_AUTO_CONFIG: "1" });

	// A context file with its own "## Code comments" section replaces these rules, so they appear once.
	pi.on("before_agent_start", (event) => {
		const o = event.systemPromptOptions;
		if (o.contextFiles.some((f) => hasCommentRulesHeading(f.content))) return undefined;
		// Pi persists sections even while a forced prompt is projected (agent-session.js#_preparePromptAndToolLoadout), so set both.
		o.sections[COMMENT_RULES_SECTION] = COMMENT_RULES_TEXT;
		const forced = o.forceSystemPrompt;
		// An empty forced prompt is a deliberate choice; leave it empty.
		if (typeof forced === "string" && forced.trim() !== "" && !hasCommentRulesHeading(forced)) {
			o.forceSystemPrompt = `${forced}\n\n${COMMENT_RULES_TEXT}`;
		}
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
