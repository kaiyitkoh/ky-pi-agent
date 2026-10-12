/**
 * ky-pi-agent — Phase 1 load-path sentinel.
 *
 * PURPOSE. This extension exists to be *observable*, and for nothing else. It
 * is the only credential-free, TTY-free way found to prove that Pi actually
 * loaded an extension: `pi --list-models` renders the models of every provider
 * registered by a loaded extension, so a provider whose model id is a unique
 * string turns "did it load?" into an exit code.
 *   [VERIFIED: pi 0.84.1 docs/extensions.md:1709 — registerProvider calls made
 *    during the factory are queued and flushed once the runner binds its
 *    context, which is what makes them visible to --list-models.]
 *
 * LIFETIME. Remove this once Phase 3 lands real providers. Until then the
 * dead-endpoint model does appear in anyone's `/model` picker, and selecting it
 * fails with a connection error.
 *
 * NOT gated behind an env seam, deliberately (code review IN-05). Registration
 * IS the observation: `pi --list-models` on an untouched checkout is the whole
 * BOOT-02/BOOT-05 proof, and it is also the sentinel a human looks for when
 * running the `/reload` check in docs/RUNBOOK.md (RB-01-03). Gating it would
 * mean the default run no longer demonstrates the load path, which trades a
 * cosmetic problem for a verification one. What IS fixed is the picker text:
 * the display name now says what the entry is and that it cannot be routed to,
 * so a reader who meets it in the picker is not left guessing. The `id` stays
 * `ky-harness-selftest` because every load-path assertion greps for it.
 *
 * BOUNDARY RULE (BOOT-10), dogfooded on the first commit of real code. This
 * file registers a COMMAND and a PROVIDER. It must NEVER register a tool. A
 * tool's name, description and complete JSON Schema are serialised into
 * `tools[]` on every single provider request
 *   [VERIFIED: pi-ai 0.84.1 src/api/openai-completions.ts:1337-1370],
 * whereas a command costs exactly zero per-turn tokens — commands are never
 * rendered into the system prompt
 *   [VERIFIED: pi 0.84.1 src/core/system-prompt.ts has no reference to
 *    registered commands; they are read only by interactive-mode.ts:626,694].
 * Plan 09's test greps `.pi/extensions/**` for the tool-registration call and
 * fails the build if it appears.
 *
 * LAYOUT. `.pi/extensions/<dir>/index.ts` is one of the four auto-discovered
 * shapes [CITED: docs/extensions.md:115-120], which is the documented
 * precondition for `/reload` hot-reload [CITED: docs/extensions.md:7]. Do not
 * add a build step — jiti loads this `.ts` directly and a `dist/` breaks
 * `/reload`. Do not add a `.gitignore` anywhere under `.pi/extensions/`: the
 * package-discovery path honours one (package-manager.ts:571) while the
 * project-local path does not (loader.ts:652-684), so one would make BOOT-05
 * pass and BOOT-02 fail with no error message anywhere.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { COMMENT_RULES_HEADING, COMMENT_RULES_SECTION, COMMENT_RULES_TEXT } from "./comment-rules.ts";

/**
 * The sentinel string every load-path assertion greps for.
 *
 * Exported so tests import it instead of duplicating a literal — a duplicated
 * literal is how an assertion silently stops matching the thing it checks.
 */
export const SELFTEST_MODEL_ID = "ky-harness-selftest";

/** Provider name under which the sentinel model is registered. */
export const SELFTEST_PROVIDER_ID = "ky-harness";

/**
 * Deliberately dead endpoint. Port 1 is unassignable; nothing listens there and
 * nothing ever should. The sentinel model is never routed to, so no credential
 * and no real host is involved.
 */
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

	// A command, not a tool. Zero per-turn tokens. See BOUNDARY RULE above.
	pi.registerCommand("ky-hello", {
		description: "ky-pi-agent liveness check",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`ky-pi-agent loaded (sentinel: ${SELFTEST_MODEL_ID})`, "info");
		},
	});

	// Observable-only provider. Its sole job is to put SELFTEST_MODEL_ID into
	// `pi --list-models` output so both load paths can be asserted by exit code.
	pi.registerProvider(SELFTEST_PROVIDER_ID, {
		baseUrl: DEAD_ENDPOINT,
		apiKey: "unused",
		api: "openai-completions",
		models: [
			{
				id: SELFTEST_MODEL_ID,
				// The picker's secondary detail text. Says what this is and that
				// choosing it will fail, because it otherwise reads as a real
				// model pointing at a host that refuses every connection.
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
