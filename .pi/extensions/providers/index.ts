/**
 * Rewrites an expired-AWS-credential error into one line naming `aws sso login --profile <resolved>`.
 * Uses `message_end`, not `after_provider_response`, which never sees a thrown provider error
 * (pi-ai dist/api/bedrock-converse-stream.js:218; docs/DIAGNOSTICS.md:341-354). Registers no tool, provider or command.
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
	PROFILE_TEMPLATE_SENTINEL,
	SAFE_PROFILE_NAME,
	SSO_DIAGNOSTIC_ORIGINAL_KEY,
	SSO_DIAGNOSTIC_TYPE,
	SSO_MESSAGE_LEAD,
} from "./schema.ts";
import { classifySso } from "./sso.ts";

/** `where` recorded on the turns row if this handler ever throws. */
const HANDLER_NAME = "providers.message_end";

/** Result type of `message_end`; derived because Pi does not re-export it (dist/index.d.ts:7, types.d.ts:801-804). */
interface MessageEndReplacement {
	message: MessageEndEvent["message"];
}

/**
 * A candidate profile name, or `undefined` when it is not one. A blank value counts as absent, as in Pi.
 * The template sentinel passes the shape check, so only the equality test rejects it.
 */
function usableProfileName(value: string | undefined): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	const trimmed = value.trim();
	if (trimmed === PROFILE_TEMPLATE_SENTINEL) {
		return undefined;
	}
	return SAFE_PROFILE_NAME.test(trimmed) ? trimmed : undefined;
}

/**
 * The profile name a stored Bedrock credential names, if any (pi dist/core/model-registry.d.ts:35).
 * Resolution failure falls through to the ambient variable: a degraded message beats the raw SDK string.
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
 * The profile to re-authenticate: stored credential, then ambient variable, then placeholder, which is Pi's own order
 * (pi-ai src/providers/amazon-bedrock.ts:65-71). Exported because the integration seam only reaches the ambient branch;
 * tests/unit/bedrock-auth.test.ts case 6 covers both with a stub.
 */
export async function resolveProfileName(ctx: ExtensionContext): Promise<string> {
	return (
		usableProfileName(await storedProfileName(ctx)) ??
		usableProfileName(process.env[AWS_PROFILE_ENV]) ??
		PROFILE_PLACEHOLDER
	);
}

export default function (pi: ExtensionAPI): void {
		// Importing safeHandler registers nothing; the diagnostics extension still loads once, from its own directory.
	pi.on(
		"message_end",
		safeHandler<MessageEndEvent, MessageEndReplacement>(HANDLER_NAME, async (event, ctx) => {
			// Role check first: message_end also fires for user and toolResult messages (types.d.ts:573-576).
			if (event.message.role !== "assistant") {
				return;
			}
			const message = event.message;

			// Only an error-stopped message with text can be a credential failure (pi-ai dist/utils/retry.js:166-167).
			if (message.stopReason !== "error") {
				return;
			}
			const original = message.errorMessage;
			if (original === undefined || original.length === 0) {
				return;
			}

			// Only Bedrock reaches the AWS credential chain; another vendor's body that quotes
			// `CredentialsProviderError` would lose its text, which survives only on diagnostics[].
			// The adapter sets `provider` before the try whose catch sets errorMessage (bedrock-converse-stream.js:22-25, :218).
			// An expired AWS_BEARER_TOKEN_BEDROCK (amazon-bedrock.js:63) has no profile and gets the placeholder hint.
			if (message.provider !== BEDROCK_PROVIDER_ID) {
				return;
			}

			const verdict = classifySso(original);
			if (verdict.kind !== "sso-credential") {
				// A transient failure keeps its text and its retries; see sso.ts.
				return;
			}

			const profile = await resolveProfileName(ctx);
			const hint = profile === PROFILE_PLACEHOLDER ? PROFILE_PLACEHOLDER_HINT : "";

			return {
				// A complete message, not a patch: the runner deletes every key of the live object
				// before assigning (agent-session.js:425-438), and the spread keeps the required
				// role (runner.js:624-631).
				message: {
					...message,
					// The original SDK text stays out: `timed out` or a 5xx would re-admit Pi's retry loop.
					errorMessage: `${SSO_MESSAGE_LEAD}${AWS_SSO_LOGIN_PREFIX}${profile}${hint}`,
					// Original text goes on diagnostics[], which the retry classifier ignores (types.d.ts:303); appended, never replaced.
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
