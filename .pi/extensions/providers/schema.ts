/**
 * ky-pi-agent — the literals the SSO classifier and its tests both spell.
 *
 * ---------------------------------------------------------------------------
 * PURPOSE
 * ---------------------------------------------------------------------------
 * One place for every constant that appears in both the writer and an
 * assertion. The house rule (`.pi/extensions/harness/index.ts:50-56`,
 * `.pi/extensions/diagnostics/schema.ts:1-24`) is that a duplicated literal is
 * how an assertion silently stops matching the thing it checks, so nothing
 * below may be re-typed in a test: import it.
 *
 * Named exports only. A sibling module in an extension directory must carry no
 * default export, or `tests/unit/extension-layout.test.ts` reclassifies it as
 * an entry point and demands it sit at an auto-discovered path. The phrase
 * itself is described rather than spelled, so the acceptance grep for it over
 * this file is zero and stays a machine check rather than a promise.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SUBSYSTEM EXISTS (PROV-05)
 * ---------------------------------------------------------------------------
 * `formatBedrockError` maps exactly five exception names — `InternalServerException`,
 * `ModelStreamErrorException`, `ValidationException`, `ThrottlingException`,
 * `ServiceUnavailableException` — and none of them is credential expiry
 * [VERIFIED: pi-ai 0.84.1 dist/api/bedrock-converse-stream.js:234-240, and the
 * formatter itself at :254-270; `= src/api/bedrock-converse-stream.ts:335-341,
 * :357-374`]. An SSO/STS credential failure is not a
 * `BedrockRuntimeServiceException`, so it arrives as a raw SDK string with no
 * reauth instruction. SSO sessions are 8-12 hours, so this fires roughly daily
 * on a working day — it is not an edge case, it is the commonest failure the
 * user will meet.
 *
 * ---------------------------------------------------------------------------
 * THE HONEST CORRECTION, CARRIED IN THE CODE RATHER THAN LEFT IN A PLAN
 * ---------------------------------------------------------------------------
 * All six strings in {@link SSO_FIXTURES} are **already** non-retryable under
 * Pi 0.84.1 — `03-RESEARCH.md` §Q4.3 executed the two regexes over them
 * [VERIFIED: executed 2026-08-13]. PITFALLS Pitfall 11's claim that "a
 * 5xx-shaped expiry could be retried" is, for these strings, false. The
 * verified gap PROV-05 closes is the **message**, not the retry.
 *
 * The residual retry risk is real but narrow, and it is why the rewrite still
 * has to be careful: a credential failure whose text happens to contain
 * `timed out`, `fetch failed`, `socket hang up`, `getaddrinfo` or a 5xx status —
 * all plausible for an STS/SSO token-refresh network call — matches
 * `RETRYABLE_PROVIDER_ERROR_PATTERN` [VERIFIED: pi-ai 0.84.1
 * dist/utils/retry.js:19-74] and would be retried 3× at 2 s/4 s/8 s
 * [VERIFIED: pi 0.84.1 dist/core/settings-manager.js:539-555 — `retry.enabled`
 * defaults to `true`, `maxRetries` to 3, `baseDelayMs` to 2000] against a
 * credential that cannot become valid. That is ~14 s of wall clock bought with
 * nothing. Keeping the original SDK text OUT of the rewritten `errorMessage` is
 * what prevents it (Trap T4). [threat T-03-08-02]
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULES
 * ---------------------------------------------------------------------------
 * This file declares constants. It registers nothing, and in particular it does
 * not spell the tool-registration call even in prose —
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`, comments
 * included (BOOT-10). The chokepoint lint (DIAG-03) applies here too: this
 * directory is outside `.pi/extensions/diagnostics/`, so the direct-completion
 * and raw-provider routes may not be named here either.
 */

/**
 * Pi's provider id for Amazon Bedrock.
 *
 * Spelled once, here, because `index.ts` asks Pi's registry for this provider's
 * resolved auth and a test asserts on the name that comes back.
 * [VERIFIED: pi-ai 0.84.1 dist/types.d.ts:19 — `KnownProvider` opens with
 * `"amazon-bedrock"`.]
 */
export const BEDROCK_PROVIDER_ID = "amazon-bedrock";

/**
 * The environment variable Pi's Bedrock chain consults, and the key it reports
 * a stored profile under.
 *
 * `resolve()` is `credential?.env?.AWS_PROFILE ?? (await env("AWS_PROFILE"))`
 * [VERIFIED: pi-ai 0.84.1 src/providers/amazon-bedrock.ts:65-71, recorded in
 * `tests/unit/bedrock-auth.test.ts` and re-proven there in both directions].
 * `aws sso login` sets no environment variable at all, which is the whole
 * reason the stored form exists — see `docs/RUNBOOK.md` RB-03-03.
 */
export const AWS_PROFILE_ENV = "AWS_PROFILE";

/**
 * The literal command prefix the surfaced message must carry.
 *
 * PROV-05 is a requirement about *this string*: the user must be told exactly
 * what to type, with the profile name filled in. The trailing space is part of
 * the constant so a caller cannot forget it and a test can assert
 * `AWS_SSO_LOGIN_PREFIX + profile` as one substring.
 */
export const AWS_SSO_LOGIN_PREFIX = "aws sso login --profile ";

/** The sentence that precedes the command, so the line reads as an instruction. */
export const SSO_MESSAGE_LEAD = "AWS SSO credentials are expired or missing. Run: ";

/**
 * What stands in for the profile name when nothing resolved one.
 *
 * THIS IS THE FAILURE MODE THE REQUIREMENT EXISTS TO PREVENT, kept as a named
 * constant precisely so a test can assert its ABSENCE from a resolved message.
 * A message reading `--profile <profile>` verbatim tells the user nothing they
 * did not already know, which is the state PROV-05 is closing.
 */
export const PROFILE_PLACEHOLDER = "<profile>";

/** Appended only when the placeholder was used, so the dead end has an exit. */
export const PROFILE_PLACEHOLDER_HINT =
	" — no AWS profile is configured; see RB-03-03 in docs/RUNBOOK.md";

/**
 * What a resolved profile name must look like before it is interpolated.
 *
 * Bounded on purpose: the value arrives from `auth.json` or the process
 * environment and lands in a string Pi will regex-match and render. One line,
 * no whitespace, at most 64 characters — AWS profile names are short
 * identifiers, and anything else is a configuration mistake, not a name.
 *
 * Counted quantifier, no `.`, no `g` flag, for the same reasons as the pattern
 * table in `sso.ts`. [threat T-03-08-01, T-03-08-04]
 *
 * KNOWN LIMIT, STATED RATHER THAN HIDDEN: this bounds the *shape* of the name,
 * not its content. A profile literally named `timeout` would be interpolated
 * and would re-admit the rewritten message to Pi's retryable pattern. Nothing
 * here can distinguish that from a legitimate name, and inventing a deny-list
 * of Pi's retryable tokens would be a second copy of a table this repo does not
 * own. Recorded as a residual of [threat T-03-08-02].
 */
export const SAFE_PROFILE_NAME = /^[^\s]{1,64}$/;

/**
 * `type` on the diagnostic that carries the original SDK text.
 *
 * The original must not go into `errorMessage` (Trap T4). It goes here instead,
 * on the message's own `diagnostics[]` array
 * [VERIFIED: pi-ai 0.84.1 dist/types.d.ts:303 — `diagnostics?:
 * AssistantMessageDiagnostic[]`; the shape is `{ type, timestamp, error?,
 * details? }` at dist/utils/diagnostics.d.ts:7-12]. Nothing in Pi's retry
 * classifier reads it: `isRetryableAssistantError` reads `stopReason` and
 * `errorMessage` and nothing else [VERIFIED: pi-ai 0.84.1
 * dist/utils/retry.js:165-172].
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
	/**
	 * Pi 0.84.1's OWN verdict on this string, before anything rewrites it.
	 *
	 * Recorded rather than assumed: `tests/integration/sso-classifier.test.ts`
	 * asserts `isRetryableAssistantError` agrees, so a Pi bump that moves one of
	 * these turns a green file red and tells the reader which claim expired.
	 * [VERIFIED: executed 2026-08-13, 03-RESEARCH.md §Q4.3]
	 */
	readonly retryableToday: boolean;
}

/**
 * The six credential-failure strings PROV-05 is written against.
 *
 * THESE ARE FIXTURES THIS REPOSITORY WROTE. They are drawn from AWS's own
 * exception names and message wording, but no live expiry produced them here —
 * this machine has no credentials and issues no provider request. Whether a
 * REAL expiry on the work laptop produces a string the matcher recognises is
 * folded into `docs/RUNBOOK.md` RB-03-03's expected output and is
 * **OUTSTANDING**. [threat T-03-08-06]
 */
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

/**
 * Provider errors that are NOT credential failures, and must survive untouched.
 *
 * THE EXCLUSION RULE, MADE TESTABLE. The classifier may not match anything
 * here. The first two are deliberately RETRYABLE: rewriting one would move a
 * genuinely transient failure to non-retryable and hide a recoverable error
 * behind an instruction to re-authenticate — the inverse of the requirement.
 * [threat T-03-08-03]
 */
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

/**
 * The non-SSO fixture the live negative control drives.
 *
 * Retryable ON PURPOSE. A session driven with it must show Pi retrying, which
 * is the live oracle that makes `callCount === 1` on an SSO run a measurement
 * rather than a property of a harness that never retries anything.
 */
export const RETRYABLE_CONTROL_FIXTURE: ProviderErrorFixture = NON_SSO_FIXTURES[0];
