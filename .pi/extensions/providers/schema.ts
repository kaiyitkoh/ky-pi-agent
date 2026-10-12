/**
 * Constants shared by the SSO classifier, the fallback chain and their tests; named exports only
 * (a default export makes extension-layout.test.ts treat this as an entry point).
 */

/** Pi's provider id for Amazon Bedrock (pi-ai dist/types.d.ts:19). */
export const BEDROCK_PROVIDER_ID = "amazon-bedrock";

/**
 * Env var Pi's Bedrock chain reads and the key a stored profile is reported under
 * (pi-ai src/providers/amazon-bedrock.ts:65-71).
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
 * equality rejects it, and installed it would shadow a working ambient AWS_PROFILE (amazon-bedrock.ts:65-71).
 */
export const PROFILE_TEMPLATE_SENTINEL = `${TEMPLATE_SENTINEL_PREFIX}AWS_PROFILE_NAME`;

/**
 * Allowed shape of a resolved profile name: AWS's own charset, because the value is pasted into a shell line.
 * Bounds shape only; a name like `timeout` still matches Pi's retryable pattern (pi-ai src/utils/retry.ts:26-89).
 */
export const SAFE_PROFILE_NAME = /^[A-Za-z0-9_.@-]{1,64}$/;

/**
 * `type` of the diagnostic carrying the original SDK text, kept out of `errorMessage` so Pi's retry classifier
 * never sees it (pi-ai dist/utils/retry.js:165-172).
 */
export const SSO_DIAGNOSTIC_TYPE = "kypi.sso_credential_expiry";

/** Key under which the original provider text is carried on that diagnostic. */
export const SSO_DIAGNOSTIC_ORIGINAL_KEY = "originalErrorMessage";

/** One provider error string, with the reason it is in the table. */
export interface ProviderErrorFixture {
	/** The `errorMessage` a provider failure of this kind arrives with. */
	readonly text: string;
	/** Why this string is here, and where it comes from. */
	readonly why: string;
	/** Pi 0.84.1's own retry verdict, asserted by tests/integration/sso-classifier.test.ts. */
	readonly retryableToday: boolean;
}

/** Credential-failure strings written from AWS exception wording; no live expiry produced them. */
export const SSO_FIXTURES: readonly ProviderErrorFixture[] = [
	{
		text: "ExpiredTokenException: The security token included in the request is expired",
		why: "STS's expiry exception, the commonest shape after an 8-12 hour SSO session lapses",
		retryableToday: false,
	},
	{
		text: "ExpiredToken: The provided token has expired.",
		why: "the same failure without the `Exception` suffix, as some SDK paths surface it",
		retryableToday: false,
	},
	{
		text: "InvalidGrantException: Invalid grant provided",
		why: "the SSO OIDC token-refresh failure: the refresh token itself is no longer valid",
		retryableToday: false,
	},
	{
		text: "CredentialsProviderError: Could not load credentials from any providers",
		why: "the chain resolved nothing at all — the shape a fresh shell with no AWS_PROFILE produces",
		retryableToday: false,
	},
	{
		text: "UnrecognizedClientException: The security token included in the request is invalid.",
		why: "a token that is present and rejected, which reads as a service fault and is not one",
		retryableToday: false,
	},
	{
		text:
			"The SSO session associated with this profile has expired or is otherwise invalid. " +
			"To refresh this SSO session run aws sso login with the corresponding profile.",
		why:
			"the AWS CLI's own wording, which names the remedy but NOT the profile — the near miss " +
			"that shows why PROV-05 is about the resolved name and not merely about mentioning the command",
		retryableToday: false,
	},
];

/** Provider errors that are not credential failures; the first two are retryable and must not be rewritten. */
export const NON_SSO_FIXTURES: readonly ProviderErrorFixture[] = [
	{
		text: "Error code: 503 - {'error': {'message': 'Service unavailable, please try again'}}",
		why: "the availability failure that must keep its retries; the negative control of the live session",
		retryableToday: true,
	},
	{
		text: "Throttling error: ThrottlingException: Too many requests, please wait before retrying",
		why: "Bedrock's own mapped throttle — retryable, and its text mentions neither SSO nor a token",
		retryableToday: true,
	},
	{
		text: "Error code: 400 - {'error': {'message': 'Invalid request: unsupported parameter'}}",
		why: "a deterministic failure that is neither retryable nor a credential problem: the third quadrant",
		retryableToday: false,
	},
];

/** Retryable non-SSO fixture that drives the live negative control. */
export const RETRYABLE_CONTROL_FIXTURE: ProviderErrorFixture = NON_SSO_FIXTURES[0];

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

/** The four failure class names; the union type derives from this array. */
export const FAILURE_CLASSES = ["quota", "transient", "unavailable", "fatal"] as const;

/** One of {@link FAILURE_CLASSES}. */
export type FailureClass = (typeof FAILURE_CLASSES)[number];

/** Classes that advance the chain: all except `fatal`. */
export const ADVANCING_CLASSES: readonly FailureClass[] = FAILURE_CLASSES.filter(
	(name) => name !== "fatal",
);

/**
 * Quota exhaustion, checked before the retryable predicate: Pi calls it non-retryable, but a second provider survives it.
 * Alternatives are anchored (no bare `billing`) because a match forwards the prompt to another vendor; compare
 * pi-ai src/utils/retry.ts:7-23. `arrearage` and `allocated quota` are DashScope wording. No `g` flag, no `.` wildcard.
 */
export const QUOTA_PATTERN =
	/insufficient_quota|out of budget|quota exceeded|exceeded your current quota|allocated quota|arrearage|billing (?:details|quota|limit)/i;

/** Availability and transport failures, from pi-ai src/utils/retry.ts:25-88; same chain action as transient. */
export const UNAVAILABLE_PATTERN =
	/503|service[ _-]?unavailable|overloaded|fetch failed|getaddrinfo|timed? out|ENOTFOUND/i;

/** One representative error per class with Pi's recorded retry verdict, asserted by the chain test. */
export const CLASS_FIXTURES: Readonly<Record<FailureClass, ProviderErrorFixture>> = {
	quota: {
		text:
			"Error code: 429 - {'error': {'message': 'You exceeded your current quota, please " +
			"check your plan and billing details', 'type': 'insufficient_quota'}}",
		why: "the quota wall itself: OpenAI-compatible wording, which DeepSeek-direct emits and Pi's limit table already claims",
		retryableToday: false,
	},
	transient: {
		text:
			"Error code: 429 - {'error': {'message': 'Rate limit reached for deepseek-v4-flash: " +
			"60 requests per minute'}}",
		why: "a rate limit, not a quota: the same 429 status with none of the billing wording, so Pi calls it retryable",
		retryableToday: true,
	},
	unavailable: {
		text: "Error code: 503 - {'error': {'message': 'Service unavailable, upstream is overloaded'}}",
		why: "the outage shape — the provider is up enough to answer and not up enough to serve",
		retryableToday: true,
	},
	fatal: {
		text:
			"Error code: 400 - {'error': {'message': 'Invalid request: unsupported parameter " +
			"reasoning_effort'}}",
		why:
			"THE CONTROL. A malformed request is malformed at every provider, so advancing would " +
			"send the user's whole prompt to a second vendor to be rejected a second time",
		retryableToday: false,
	},
};

/** DashScope quota wording missing from Pi's limit table. */
export const DASHSCOPE_QUOTA_FIXTURES: readonly ProviderErrorFixture[] = [
	{
		text: "Arrearage: Access denied, please make sure your account balance is sufficient",
		why: "DashScope's arrears failure — a quota wall that Pi's limit table does not recognise at all",
		retryableToday: false,
	},
	{
		text: "Allocated quota exceeded, please increase your quota limit",
		why: "DashScope's allocation failure; `quota exceeded` is in Pi's limit table, so Pi agrees it is not retryable",
		retryableToday: false,
	},
];

/** One alternative of {@link QUOTA_PATTERN} and a string only it matches. */
export interface QuotaAlternativeFixture {
	/** The alternative, spelled as it appears in the pattern source. */
	readonly alternative: string;
	/** A failure whose only quota wording is this alternative. */
	readonly text: string;
	readonly text: string;
}

/**
 * One minimal fixture per QUOTA_PATTERN alternative, so deleting an alternative fails a test.
 * fallback-chain.test.ts cases 3b and 3c hold this table in set equality with the pattern; edit both together.
 */
export const QUOTA_ALTERNATIVE_FIXTURES: readonly QuotaAlternativeFixture[] = [
	{
		alternative: "insufficient_quota",
		text: "Error code: 429 - {'error': {'message': 'Request rejected', 'type': 'insufficient_quota'}}",
	},
	{
		alternative: "out of budget",
		text: "Error code: 402 - {'error': {'message': 'This organisation is out of budget for the month'}}",
	},
	{
		alternative: "quota exceeded",
		text: "Error code: 429 - {'error': {'message': 'Model quota exceeded for this endpoint'}}",
	},
	{
		alternative: "exceeded your current quota",
		text: "Error code: 429 - {'error': {'message': 'You exceeded your current quota, please check your plan'}}",
	},
	{
		alternative: "allocated quota",
		text: "Allocated quota for this workspace has run out; raise the limit in the console",
	},
	{
		alternative: "arrearage",
		text: "Arrearage: access denied for this account",
	},
	{
		alternative: "billing (?:details|quota|limit)",
		text: "Error code: 429 - {'error': {'message': 'Please check your plan and billing details'}}",
	},
];

/**
 * Failures that mention billing without being quota failures; all must classify `fatal`.
 * Control for QUOTA_PATTERN's billing alternative.
 */
export const NON_QUOTA_BILLING_FIXTURES: readonly ProviderErrorFixture[] = [
	{
		text:
			"Error code: 400 - {'error': {'message': 'Invalid request: unsupported parameter " +
			"reasoning_effort. See https://platform.example.com/billing for plan limits.'}}",
		why: "a malformed request that merely LINKS a billing page: fatal at every vendor, so advancing spends a second one to be rejected again",
		retryableToday: false,
	},
	{
		text: "Error code: 403 - {'error': {'message': 'Your account is not enabled for billing on this API'}}",
		why: "an authorisation failure phrased in billing prose — a second vendor cannot enable an account on the first one",
		retryableToday: false,
	},
];
