/**
 * Constants shared by the SSO classifier, the fallback chain and their tests; named exports only
 * (a default export makes extension-layout.test.ts treat this as an entry point).
 */

/** Pi's provider id for Amazon Bedrock (pi-ai dist/types.d.ts). */
export const BEDROCK_PROVIDER_ID = "amazon-bedrock";

/**
 * Env var Pi's Bedrock chain reads and the key a stored profile is reported under
 * (pi-ai 1.1.0 src/providers/amazon-bedrock.ts:65-71).
 */
export const AWS_PROFILE_ENV = "AWS_PROFILE";

/** Command prefix the message must carry; the trailing space is part of the constant. */
export const AWS_SSO_LOGIN_PREFIX = "aws sso login --profile ";

/** The sentence that precedes the command, so the line reads as an instruction. */
export const SSO_MESSAGE_LEAD = "AWS SSO credentials are expired or missing. Run: ";

/** Stands in for the profile name when none resolved; tests assert its absence from a resolved message. */
export const PROFILE_PLACEHOLDER = "<profile>";

/** Appended only when the placeholder was used, so the dead end has an exit. */
export const PROFILE_PLACEHOLDER_HINT =
	" — no AWS profile is configured; see RB-03-03 in docs/RUNBOOK.md";

/** Prefix of every unedited value in `.pi/templates/auth-template.json`; bin/bootstrap.sh refuses to install entries carrying it. */
export const TEMPLATE_SENTINEL_PREFIX = "REPLACE_WITH_";

/**
 * The `env.AWS_PROFILE` value the template ships: a sentinel, not a name. It passes SAFE_PROFILE_NAME's shape, so only
 * equality rejects it, and installed it would shadow a working ambient AWS_PROFILE (pi-ai 1.1.0 amazon-bedrock.ts:65-71).
 */
export const PROFILE_TEMPLATE_SENTINEL = `${TEMPLATE_SENTINEL_PREFIX}AWS_PROFILE_NAME`;

/**
 * Allowed shape of a resolved profile name: AWS's own charset, because the value is pasted into a shell line.
 * Bounds shape only; a name like `timeout` still matches Pi's retryable pattern (pi-ai src/utils/retry.ts#RETRYABLE_PROVIDER_ERROR_PATTERN).
 */
export const SAFE_PROFILE_NAME = /^[A-Za-z0-9_.@-]{1,64}$/;

/**
 * `type` of the diagnostic carrying the original SDK text, kept out of `errorMessage` so Pi's retry classifier
 * never sees it (pi-ai dist/utils/retry.js).
 */
export const SSO_DIAGNOSTIC_TYPE = "kypi.sso_credential_expiry";

/** Key under which the original provider text is carried on that diagnostic. */
export const SSO_DIAGNOSTIC_ORIGINAL_KEY = "originalErrorMessage";

/* Fallback chain and error taxonomy, consumed by fallback.ts and the chain test. This is not routing. */

/** One hop of the chain: a provider id and a model id, both as Pi spells them. */
export interface ChainEntry {
	/** Pi's provider id — the first argument the registry's lookup takes. */
	readonly provider: string;
	/** The model id within that provider. */
	readonly id: string;
}

/**
 * Fallback chain: DeepSeek-direct, then DashScope serving the same weights on a different account and quota.
 * No Bedrock hop (no V4; R1 has no tool calling) and not qwen-token-plan (different host and key namespace).
 * An unresolved entry throws rather than being skipped, so a missing DashScope model id cannot vanish silently.
 */
export const CHAIN: readonly ChainEntry[] = [
	{ provider: "deepseek", id: "deepseek-flash" },
	{ provider: "dashscope", id: "deepseek-v4-flash" },
];

export type FailureClass = "quota" | "transient" | "unavailable" | "fatal";

/**
 * Quota exhaustion, checked before the retryable predicate: Pi calls it non-retryable, but a second provider survives it.
 * Alternatives are anchored (no bare `billing`) because a match forwards the prompt to another vendor; compare
 * pi-ai src/utils/retry.ts#NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN. `arrearage` and `allocated quota` are DashScope wording. No `g` flag, no `.` wildcard.
 */
export const QUOTA_PATTERN =
	/insufficient_quota|out of budget|quota exceeded|exceeded your current quota|allocated quota|arrearage|billing (?:details|quota|limit)/i;

/** Availability and transport failures, from pi-ai src/utils/retry.ts#RETRYABLE_PROVIDER_ERROR_PATTERN; same chain action as transient. */
export const UNAVAILABLE_PATTERN =
	/503|service[ _-]?unavailable|overloaded|fetch failed|getaddrinfo|timed? out|ENOTFOUND/i;
