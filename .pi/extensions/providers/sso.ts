/**
 * Pure predicate: is this provider error a dead AWS credential? Bedrock maps no expiry exception, so it arrives raw
 * (pi-ai dist/api/bedrock-converse-stream.js:234-270). The profile name comes from the session and lives in index.ts.
 * No pattern may match anything Pi's RETRYABLE_PROVIDER_ERROR_PATTERN matches (retry.js:19-74): the rewrite only moves
 * retryable to non-retryable. Patterns are anchored to exception names, bounded, with no `.` and no `g` flag.
 */

/** One matcher anchored to a credential exception name. */
export interface SsoPattern {
	/** Stable label, carried into the diagnostic so a log says which rule fired. */
	readonly label: string;
	/** The matcher. Bounded, stateless, anchored to a credential exception name. */
	readonly pattern: RegExp;
	/** Why this string means "the credential is dead", and why it excludes transients. */
	readonly why: string;
}

/**
 * The pattern table, exported so tests prove both directions: each entry matches an SSO fixture and no non-SSO fixture.
 */
export const SSO_PATTERNS: readonly SsoPattern[] = [
	{
		label: "expired-token",
		// No trailing `\b`: `ExpiredTokenException` continues with a word character.
		pattern: /\bExpiredToken/i,
		why:
			"STS's expiry exception in both spellings. `ExpiredToken` is not a substring of any " +
			"transient-failure wording Pi treats as retryable",
	},
	{
		label: "invalid-grant",
		pattern: /\bInvalidGrantException\b/i,
		why:
			"the SSO OIDC refresh token is no longer valid — a re-login, never a retry. The whole " +
			"exception name is required so a message merely containing the word `grant` cannot fire",
	},
	{
		label: "credentials-provider-error",
		pattern: /\bCredentialsProviderError\b/i,
		why:
			"the credential chain resolved nothing at all. Note it is NOT `provider.?returned.?error`, " +
			"which is Pi's retryable upstream-failure pattern; the two read alike and mean opposite things",
	},
	{
		label: "unrecognized-client",
		pattern: /\bUnrecognizedClientException\b/i,
		why:
			"a token that is present and rejected. This one reads like a service fault, which is " +
			"precisely why it needs naming: without it the user is told nothing actionable",
	},
	{
		label: "sso-session",
		// Counted quantifier over untrusted text.
		pattern: /\bSSO[\s]{1,4}session\b/i,
		why:
			"the AWS CLI's own sentence, which names `aws sso login` but never the profile. Anchored " +
			"to the two-word phrase, so a message that merely mentions SSO somewhere cannot fire",
	},
];

/** Classifier result; `matched` is the rule label, not provider text. */
export type SsoVerdict =
	| { readonly kind: "sso-credential"; readonly matched: string }
	| { readonly kind: "not-sso" };

/** Is this error text a dead or missing AWS credential? Pure; the first matching rule wins. */
export function classifySso(errorText: string): SsoVerdict {
	for (const entry of SSO_PATTERNS) {
		// No `g` flag, so `.test()` is stateless in a loop.
		if (entry.pattern.test(errorText)) {
			return { kind: "sso-credential", matched: entry.label };
		}
	}
	return { kind: "not-sso" };
}
