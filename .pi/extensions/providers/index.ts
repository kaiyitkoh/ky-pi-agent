/**
 * ky-pi-agent — PROV-05: an expired AWS credential says what to type.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS EXTENSION IS
 * ---------------------------------------------------------------------------
 * One hook. When a finalized assistant message stopped with an error whose text
 * is a dead or missing AWS credential, this replaces its `errorMessage` with a
 * single actionable line naming the exact `aws sso login --profile <resolved>`
 * command. Nothing else is registered — no provider, no command, and never a
 * tool (BOOT-10, and the call's name is not spelled anywhere here, comments
 * included; `harness/index.ts:36` is the sanctioned way to refer to it in prose).
 *
 * ---------------------------------------------------------------------------
 * THE MECHANISM, AND THE CLOSED DOOR NEXT TO IT
 * ---------------------------------------------------------------------------
 * `message_end`, not `after_provider_response`. That hook cannot see a provider
 * error at all, twice over: `onResponse` is called only after `client.send()`
 * RETURNS, inside the `try`, so a credential failure throws straight past it to
 * the catch [VERIFIED: pi-ai 0.84.1 dist/api/bedrock-converse-stream.js:218 —
 * `output.errorMessage = formatBedrockError(error)` is reached from the catch,
 * with no `onResponse` call on that path], and Phase 2 already recorded the
 * general case as closed in `docs/DIAGNOSTICS.md:341-354`. A handler written
 * there would be dead code whose test had to fake the event to pass
 * (03-RESEARCH.md Trap T2). Do not re-litigate this.
 *
 * `message_end` works because of a verified ordering:
 *
 *   1. `_handleAgentEvent` awaits `_emitExtensionEvent(event)` FIRST
 *      [VERIFIED: pi 0.84.1 dist/core/agent-session.js:364].
 *   2. `emitMessageEnd` chains every handler, rejects a replacement whose role
 *      differs, and returns the final message
 *      [VERIFIED: dist/core/extensions/runner.js:610-648].
 *   3. The replacement is applied by `_replaceMessageInPlace`, which DELETES
 *      every key of the live object and `Object.assign`s the replacement onto
 *      it [VERIFIED: dist/core/agent-session.js:425-438] — hence the complete
 *      message below; a patch would erase `content`, `usage` and `role`.
 *   4. Only afterwards does the session set `_lastAssistantMessage =
 *      event.message` — the mutated object — and persist it
 *      [VERIFIED: dist/core/agent-session.js:382-384, :369-372].
 *   5. `_handlePostAgentRun` reads that object and asks `_isRetryableError`,
 *      i.e. `isRetryableAssistantError`, whether to retry
 *      [VERIFIED: dist/core/agent-session.js:758-766; pi-ai
 *      dist/utils/retry.js:165-172].
 *
 * So a `message_end` rewrite of `errorMessage` reaches the user's terminal AND
 * Pi's retry decision, in one edit.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ACTUALLY BEING FIXED, STATED HONESTLY
 * ---------------------------------------------------------------------------
 * The six credential strings in `schema.ts` are ALREADY non-retryable under Pi
 * 0.84.1 [VERIFIED: executed 2026-08-13; 03-RESEARCH.md §Q4.3]. The verified
 * gap is the MESSAGE. This handler must therefore be careful not to undo what
 * was already true: the original SDK text is kept OUT of `errorMessage` and
 * carried on the message's `diagnostics[]` instead, because a credential
 * failure whose text contains `timed out`, `fetch failed`, `socket hang up`,
 * `getaddrinfo` or a 5xx status matches Pi's retryable pattern and would buy
 * three retries at 2 s/4 s/8 s against a credential that cannot become valid
 * (Trap T4). [threat T-03-08-02]
 *
 * ---------------------------------------------------------------------------
 * WHY A NEW DIRECTORY RATHER THAN AN ADDITION TO `diagnostics/`
 * ---------------------------------------------------------------------------
 * `tests/unit/diagnostics-entry.test.ts` asserts the exact hook count and the
 * single command registered by `diagnostics/index.ts`. A ninth hook there is a
 * deliberate edit of that test, and Phase 2's instrument is meant to stay
 * sealed. Nothing under `.pi/extensions/diagnostics/` is modified by this
 * plan. [threat T-03-08-07]
 *
 * `safeHandler` is IMPORTED from that sealed subsystem rather than copied: a
 * second failure-containment wrapper is how two copies drift, and Pi routes
 * every exception thrown by an extension handler to `emitError`, which produces
 * no visible output — an unwrapped handler that dies looks exactly like one
 * with nothing to say [VERIFIED: pi 0.84.1 dist/core/extensions/runner.js:635-644,
 * the catch inside `emitMessageEnd`]. Its `null → undefined` coercion is
 * load-bearing here in a way it is not for diagnostics: for `message_end` a
 * non-`undefined` return IS a message replacement, so a `?? null` typo would
 * hand Pi a null message. [threat T-03-08-05]
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DISCLOSED, AND WHAT IS NOT
 * ---------------------------------------------------------------------------
 * The surfaced line carries the AWS profile NAME and nothing else. A profile
 * name is not a secret — it is already templatable in this public repository
 * (03-CONTEXT decision 3) — and it is the one datum that makes the command
 * copy-pasteable. The raw SDK text, which is the part that could carry account
 * or request detail, goes to the diagnostic instead of the terminal.
 * [threat T-03-08-04]
 *
 * LAYOUT. `.pi/extensions/<dir>/index.ts` is an auto-discovered shape
 * [CITED: pi 0.84.1 docs/extensions.md:115-120], which is the precondition for
 * `/reload`. No build step: jiti loads this `.ts` directly.
 */
import type {
	ExtensionAPI,
	ExtensionContext,
	MessageEndEvent,
} from "@earendil-works/pi-coding-agent";

import { safeHandler } from "../diagnostics/index.ts";
import {
	AWS_PROFILE_ENV,
	AWS_SSO_LOGIN_PREFIX,
	BEDROCK_PROVIDER_ID,
	PROFILE_PLACEHOLDER,
	PROFILE_PLACEHOLDER_HINT,
	SAFE_PROFILE_NAME,
	SSO_DIAGNOSTIC_ORIGINAL_KEY,
	SSO_DIAGNOSTIC_TYPE,
	SSO_MESSAGE_LEAD,
} from "./schema.ts";
import { classifySso } from "./sso.ts";

/** `where` recorded on the turns row if this handler ever throws. */
const HANDLER_NAME = "providers.message_end";

/**
 * What this hook may return: a replacement for the finalized message.
 *
 * DERIVED FROM THE EVENT, NOT IMPORTED. Pi declares the result type as
 * `MessageEndEventResult` but does not re-export it from the package root
 * [VERIFIED: pi 0.84.1 dist/index.d.ts:7 re-exports `MessageEndEvent` and not
 * its result type; the declaration itself is at
 * dist/core/extensions/types.d.ts:801-804]. Deriving the message type from the
 * event keeps the two in lockstep without reaching into a deep, unexported
 * module path that a Pi bump may move. `message` is required here because this
 * handler either returns a whole replacement or returns nothing at all.
 */
interface MessageEndReplacement {
	message: MessageEndEvent["message"];
}

/**
 * A candidate profile name, or `undefined` when it is not one.
 *
 * The value comes from `auth.json` or the process environment and is about to
 * be interpolated into text Pi will regex-match and render, so its shape is
 * bounded before it is trusted. An empty or whitespace-only value is treated as
 * absent — which is also Pi's own reading of a blank environment variable
 * [VERIFIED: pi-ai 0.84.1 dist/auth/context.js — a value is returned only when
 * `value.trim().length > 0`]. [threat T-03-08-04]
 */
function usableProfileName(value: string | undefined): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	const trimmed = value.trim();
	return SAFE_PROFILE_NAME.test(trimmed) ? trimmed : undefined;
}

/**
 * The profile name a stored Bedrock credential names, if there is one.
 *
 * Asking the registry for a provider's resolved auth takes a provider ID
 * string: it loads no model and prepares no request
 * [VERIFIED: pi 0.84.1 dist/core/model-registry.d.ts:35 — `getProviderAuth(provider:
 * string): Promise<AuthResult | undefined>`], so this costs nothing on the one
 * turn in a day that reaches it.
 *
 * The `catch` is deliberate and is NOT the same as `safeHandler`'s. If auth
 * resolution fails, the right outcome is still to rewrite the message using the
 * ambient variable or the placeholder — letting the exception escape would hand
 * the whole turn back to `safeHandler`, which returns `undefined`, which means
 * no rewrite at all and the user gets the raw SDK string. A degraded message
 * beats no message.
 */
async function storedProfileName(ctx: ExtensionContext): Promise<string | undefined> {
	try {
		const resolved = await ctx.modelRegistry.getProviderAuth(BEDROCK_PROVIDER_ID);
		return resolved?.env?.[AWS_PROFILE_ENV];
	} catch {
		return undefined;
	}
}

/**
 * Which profile the user must re-authenticate: the stored credential first, the
 * ambient variable second, the placeholder last.
 *
 * That order is Pi's own Bedrock chain, `credential?.env?.AWS_PROFILE ??
 * (await env("AWS_PROFILE"))` [VERIFIED: pi-ai 0.84.1
 * src/providers/amazon-bedrock.ts:65-71, proven in both directions by
 * `tests/unit/bedrock-auth.test.ts`], so the name in the message is the name Pi
 * would actually have used. Naming a different profile than the one that failed
 * would be worse than naming none.
 */
async function resolveProfileName(ctx: ExtensionContext): Promise<string> {
	return (
		usableProfileName(await storedProfileName(ctx)) ??
		usableProfileName(process.env[AWS_PROFILE_ENV]) ??
		PROFILE_PLACEHOLDER
	);
}

export default function (pi: ExtensionAPI): void {
	// Importing `../diagnostics/index.ts` REGISTERS NOTHING. Only `safeHandler`
	// is taken from it; that module's default export is never called here, so
	// the diagnostics extension is loaded exactly once, by Pi, from its own
	// directory.
	pi.on(
		"message_end",
		safeHandler<MessageEndEvent, MessageEndReplacement>(HANDLER_NAME, async (event, ctx) => {
			// ROLE CHECK FIRST, ALWAYS. `message_end` fires for user and toolResult
			// messages too [pi 0.84.1 dist/core/extensions/types.d.ts:573-576], and
			// this is what stops a tool result being replaced by a message about AWS.
			if (event.message.role !== "assistant") {
				return;
			}
			const message = event.message;

			// Only an error-stopped message with text can be a credential failure.
			// `isRetryableAssistantError` gates on exactly these two fields too
			// [VERIFIED: pi-ai 0.84.1 dist/utils/retry.js:166-167], so a message
			// that fails this check is one Pi's retry logic ignores as well.
			if (message.stopReason !== "error") {
				return;
			}
			const original = message.errorMessage;
			if (original === undefined || original.length === 0) {
				return;
			}

			const verdict = classifySso(original);
			if (verdict.kind !== "sso-credential") {
				// A transient failure keeps its text AND its retries. See the
				// exclusion rule in `sso.ts`. [threat T-03-08-03]
				return;
			}

			const profile = await resolveProfileName(ctx);
			const hint = profile === PROFILE_PLACEHOLDER ? PROFILE_PLACEHOLDER_HINT : "";

			return {
				// A COMPLETE MESSAGE, not a patch: the runner deletes every key of
				// the live object and `Object.assign`s this onto it
				// [VERIFIED: pi 0.84.1 dist/core/agent-session.js:425-438], so a
				// partial object would erase `content`, `usage` and `model`. The
				// spread also keeps `role: "assistant"`, which the runner requires
				// on pain of rejecting the replacement outright
				// [VERIFIED: dist/core/extensions/runner.js:624-631].
				message: {
					...message,
					// ONE LINE, NAMING THE COMMAND. The original SDK text is
					// deliberately absent: including it re-admits `timed out`,
					// `fetch failed` or a 5xx to Pi's retryable pattern and silently
					// restores the retry loop this requirement forbids (Trap T4).
					errorMessage: `${SSO_MESSAGE_LEAD}${AWS_SSO_LOGIN_PREFIX}${profile}${hint}`,
					// WHERE THE ORIGINAL GOES INSTEAD. `diagnostics[]` is part of the
					// message contract [VERIFIED: pi-ai 0.84.1 dist/types.d.ts:303]
					// and is read by nothing in the retry classifier, so the evidence
					// for the rewrite survives without steering the retry decision.
					// Appended, never replaced: an adapter may already have recorded
					// its own diagnostic on this message.
					diagnostics: [
						...(message.diagnostics ?? []),
						{
							type: SSO_DIAGNOSTIC_TYPE,
							timestamp: Date.now(),
							details: {
								matched: verdict.matched,
								[SSO_DIAGNOSTIC_ORIGINAL_KEY]: original,
							},
						},
					],
				},
			};
		}),
	);
}
