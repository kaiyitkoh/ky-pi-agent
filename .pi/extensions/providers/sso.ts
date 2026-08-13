/**
 * One predicate: is this provider error a dead AWS credential?
 *
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS (PROV-05)
 * ---------------------------------------------------------------------------
 * An expired SSO session arrives from Bedrock as a raw SDK string with no
 * reauth instruction: `formatBedrockError` maps five exception names and none
 * of them is credential expiry [VERIFIED: pi-ai 0.84.1
 * dist/api/bedrock-converse-stream.js:234-240, :254-270]. SSO sessions last
 * 8-12 hours, so on a working day the user meets this roughly daily, reads a
 * sentence about a security token, and has to remember for themselves that the
 * remedy is `aws sso login --profile <their profile>`. Turning that into one
 * line that names the command is the whole requirement.
 *
 * ---------------------------------------------------------------------------
 * THE HONEST CORRECTION — WHICH HALF WAS ALREADY TRUE
 * ---------------------------------------------------------------------------
 * All six strings in `SSO_FIXTURES` are ALREADY non-retryable under Pi 0.84.1;
 * `03-RESEARCH.md` §Q4.3 executed both regexes over them
 * [VERIFIED: executed 2026-08-13]. So this module does not make them
 * non-retryable — the message is the verified gap, and the retry half of PROV-05
 * is a property that must be PRESERVED rather than created. That is why the
 * rewrite in `index.ts` keeps the original SDK text out of `errorMessage`
 * (Trap T4): a credential failure whose text happens to contain `timed out`,
 * `fetch failed`, `socket hang up`, `getaddrinfo` or a 5xx status matches
 * `RETRYABLE_PROVIDER_ERROR_PATTERN` [VERIFIED: pi-ai 0.84.1
 * dist/utils/retry.js:19-74] and would buy ~14 s of retries against a
 * credential that cannot become valid. [threat T-03-08-02]
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A PREDICATE AND NOT A HANDLER
 * ---------------------------------------------------------------------------
 * The effect — replacing the finalized message from inside `message_end`,
 * resolving the profile name from Pi's registry — lives in `index.ts` and needs
 * a live session to test. The interesting half needs none of that, so it is
 * here, pure and importable, exactly the split `prose.ts:22-31` states for the
 * prose detector.
 *
 * The profile name is deliberately NOT this module's job. It comes from the
 * session context (a stored Bedrock credential, then the ambient variable), and
 * mixing that lookup in here would make the predicate need a session.
 *
 * ---------------------------------------------------------------------------
 * THE EXCLUSION RULE — READ BEFORE ADDING A PATTERN
 * ---------------------------------------------------------------------------
 * NO PATTERN BELOW MAY MATCH A STRING THAT PI'S `RETRYABLE_PROVIDER_ERROR_PATTERN`
 * ALSO MATCHES. The rewrite this predicate gates produces a message that is
 * non-retryable, so a pattern that fired on a genuinely transient failure would
 * strip its retries and tell the user to re-authenticate against a service that
 * was merely busy — a recoverable failure hidden behind the wrong instruction.
 * The rewrite may therefore only ever move a message retryable → non-retryable,
 * never the reverse, and {@link SSO_PATTERNS} is exported so
 * `tests/integration/sso-classifier.test.ts` can assert that mechanically over
 * `NON_SSO_FIXTURES` instead of trusting this paragraph. [threat T-03-08-03]
 *
 * THE FALSE POSITIVE THAT MATTERS: a 503 or a throttle from Bedrock is a
 * service problem, and the user's credentials are fine. Firing on one costs the
 * retries that would have succeeded and sends the user to re-authenticate for
 * nothing. So every pattern here is anchored to an AWS credential exception
 * NAME, or to the AWS CLI's own SSO-session sentence — never to a generic word
 * like `token`, `invalid` or `expired`, each of which appears in failures that
 * have nothing to do with credentials.
 *
 * ---------------------------------------------------------------------------
 * BOUNDED MATCHING, DELIBERATELY
 * ---------------------------------------------------------------------------
 * These patterns run over untrusted provider text of arbitrary size inside the
 * agent loop. Every whitespace run is a COUNTED quantifier, there is no `.`
 * anywhere, and there is no `g` flag — a `g` pattern carries a persistent
 * `lastIndex` that makes `.test()` lie on every other call, which is the lesson
 * `prose.ts:130-135` records against `redact.ts`, and these are used through
 * `.test()` in a loop. [threat T-03-08-01]
 *
 * PURITY. No value imports, no I/O, no dependency: the `prose.ts:89-92`
 * posture, and `tests/unit/pinning.test.ts` fails the build if a package is
 * added. The pattern table lives HERE rather than in `schema.ts` for exactly
 * that reason — importing it would be a value import, and this module is
 * asserted to have none. `schema.ts` carries the fixtures and the literals that
 * the writer and the tests share.
 *
 * BOUNDARY RULES. Registers nothing; names neither the tool-registration call
 * (BOOT-10) nor any direct-completion route (DIAG-03), comments included.
 */

/** One matcher, with the failure it recognises and why it cannot overreach. */
export interface SsoPattern {
	/** Stable label, carried into the diagnostic so a log says which rule fired. */
	readonly label: string;
	/** The matcher. Bounded, stateless, anchored to a credential exception name. */
	readonly pattern: RegExp;
	/** Why this string means "the credential is dead", and why it excludes transients. */
	readonly why: string;
}

/**
 * The table, exported so the test can prove both directions rather than one.
 *
 * Each entry must match at least one `SSO_FIXTURES` string and no
 * `NON_SSO_FIXTURES` string. A pattern that matches nothing is dead and would
 * make the classifier quietly narrower than it reads; a pattern that matches a
 * transient breaks the exclusion rule above.
 */
export const SSO_PATTERNS: readonly SsoPattern[] = [
	{
		label: "expired-token",
		// No trailing `\b`: `ExpiredTokenException` continues with a word
		// character, so a trailing boundary would match the bare `ExpiredToken`
		// spelling and silently miss the commoner one.
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
		// `[\s]{1,4}` rather than `\s+`: a counted quantifier over untrusted text.
		pattern: /\bSSO[\s]{1,4}session\b/i,
		why:
			"the AWS CLI's own sentence, which names `aws sso login` but never the profile. Anchored " +
			"to the two-word phrase, so a message that merely mentions SSO somewhere cannot fire",
	},
];

/**
 * What the classifier concluded. Discriminated, and deliberately narrow.
 *
 * `matched` carries the LABEL of the rule that fired, for the diagnostic record
 * — not the provider's text, which the caller already holds, and not the
 * profile name, which this module knows nothing about.
 */
export type SsoVerdict =
	| { readonly kind: "sso-credential"; readonly matched: string }
	| { readonly kind: "not-sso" };

/**
 * Is this provider error text a dead or missing AWS credential?
 *
 * Pure: no session, no I/O, no clock. The first matching rule wins; the order
 * of {@link SSO_PATTERNS} is presentational, since every rule means the same
 * remedy.
 */
export function classifySso(errorText: string): SsoVerdict {
	for (const entry of SSO_PATTERNS) {
		// The patterns carry no `g` flag, so `.test()` is stateless and safe in
		// a loop. See the module docstring.
		if (entry.pattern.test(errorText)) {
			return { kind: "sso-credential", matched: entry.label };
		}
	}
	return { kind: "not-sso" };
}
