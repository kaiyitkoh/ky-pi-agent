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
 * The prefix every unedited value in `.pi/templates/auth-template.json` carries.
 *
 * WHY A PREFIX AND NOT A WHOLE STRING. `bin/bootstrap.sh` refuses to install any
 * template entry that still carries a value beginning with this, so a second
 * templated placeholder added later is covered without a second edit in two
 * files. The one that exists today is {@link PROFILE_TEMPLATE_SENTINEL}.
 */
export const TEMPLATE_SENTINEL_PREFIX = "REPLACE_WITH_";

/**
 * The literal `.pi/templates/auth-template.json` ships as `env.AWS_PROFILE`,
 * which is NOT a profile name and must never be interpolated as one.
 *
 * THIS IS A SENTINEL, NOT A NAME, AND THE DISTINCTION IS LOAD-BEARING TWICE:
 *
 *   1. It is 29 characters with no whitespace, so it satisfies any shape bound
 *      {@link SAFE_PROFILE_NAME} could reasonably impose — including the
 *      tightened AWS charset, which is `[-_.@A-Za-z0-9]` and therefore matches
 *      this string exactly. Shape alone can never reject it; only an equality
 *      check can. Without one, `resolveProfileName` never reaches
 *      {@link PROFILE_PLACEHOLDER}, {@link PROFILE_PLACEHOLDER_HINT} never
 *      fires, and PROV-05 surfaces `aws sso login --profile
 *      REPLACE_WITH_AWS_PROFILE_NAME` — a copy-pasteable command that cannot
 *      work, with the RB-03-03 pointer suppressed. That is precisely the state
 *      {@link PROFILE_PLACEHOLDER} exists to make visible.
 *   2. Pi's Bedrock resolver prefers the STORED value over the ambient one —
 *      `credential?.env?.AWS_PROFILE ?? (await env("AWS_PROFILE"))` [VERIFIED:
 *      pi-ai 0.84.1 src/providers/amazon-bedrock.ts:65-71]. So an installed
 *      copy of this string does not merely fail to help, it SHADOWS a working
 *      `AWS_PROFILE` on a laptop where Bedrock worked before bootstrap ran.
 *      That is why `bin/bootstrap.sh`'s `merge_auth_json` refuses to install
 *      any entry whose values still begin with {@link TEMPLATE_SENTINEL_PREFIX}
 *      rather than relying on this check alone: one guard covers the message,
 *      the other covers the regression.
 */
export const PROFILE_TEMPLATE_SENTINEL = `${TEMPLATE_SENTINEL_PREFIX}AWS_PROFILE_NAME`;

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

/* ===========================================================================
 * PROV-08 — THE FALLBACK CHAIN AND ITS ERROR TAXONOMY
 * ===========================================================================
 *
 * Everything below is consumed by `fallback.ts` and by
 * `tests/integration/fallback-chain.test.ts`. It lives here for the reason the
 * file docstring gives: a literal spelled in both the writer and the assertion
 * is a literal that will one day differ in one of them.
 *
 * SCOPE CAVEAT, STATED ONCE HERE AND AGAIN IN `fallback.ts`: this is the chain
 * for three named failure classes. It is NOT routing. Which model handles a
 * request is Phase 5's decision and nothing here participates in it.
 */

/** One hop of the chain: a provider id and a model id, both as Pi spells them. */
export interface ChainEntry {
	/** Pi's provider id — the first argument the registry's lookup takes. */
	readonly provider: string;
	/** The model id within that provider. */
	readonly id: string;
}

/**
 * The fallback chain, in order. Exactly two hops, and deliberately not more.
 *
 * WHY THIS ORDER. DeepSeek-direct is the primary: it is the daily driver, and
 * its catalogue entry is Pi's own built-in [`pi-ai 0.84.1
 * dist/providers/data/deepseek.json` — `contextWindow: 1000000`,
 * `maxTokens: 384000`, `thinkingFormat: "deepseek"`]. DashScope is second
 * because it serves the same DeepSeek weights behind a different account,
 * different quota and different region — which is exactly what survives a quota
 * wall, a rate limit or an outage on the direct endpoint. A second hop on the
 * SAME vendor would survive none of the three.
 *
 * WHAT IS DELIBERATELY ABSENT. No Bedrock hop: Bedrock's DeepSeek line is
 * R1/V3/V3.2 with no V4, R1 does no tool calling, and non-Claude Bedrock models
 * report no reasoning tokens and take no thinking config, so a "cheap Bedrock
 * fallback" is not one (03-CONTEXT decision 6). Not `qwen-token-plan` either —
 * different host and a different key namespace, so a pay-as-you-go DashScope key
 * returns 401 against it (decision 7). And nothing from the vendor 03-CONTEXT
 * decision 8 rules out of v1 entirely — it publishes no inference endpoint at
 * all, only agent orchestration, so it is not a provider and cannot be a hop.
 * Its name is deliberately unspelled here: the acceptance gate for this plan
 * greps this directory for it and expects zero, which keeps decision 8 a machine
 * check rather than a promise.
 *
 * ASSUMPTION A7, RECORDED RATHER THAN ASSUMED (03-RESEARCH.md §Assumptions).
 * The second hop assumes DashScope serves this model under the SAME id. If it
 * does not, the registry lookup returns nothing and the hop would vanish in
 * silence — a two-provider chain reporting a one-provider failure. That is why
 * `callWithFallback` throws on an unresolved entry instead of skipping it, and
 * why the chain test asserts every entry resolves. [threat T-03-10-05]
 */
export const CHAIN: readonly ChainEntry[] = [
	{ provider: "deepseek", id: "deepseek-v4-flash" },
	{ provider: "dashscope", id: "deepseek-v4-flash" },
];

/**
 * The four failure classes, and the only names the chain knows.
 *
 * `as const` so the union below is derived from the array rather than typed
 * beside it: two spellings of the same list is how a class silently stops being
 * handled.
 */
export const FAILURE_CLASSES = ["quota", "transient", "unavailable", "fatal"] as const;

/** One of {@link FAILURE_CLASSES}. */
export type FailureClass = (typeof FAILURE_CLASSES)[number];

/**
 * The classes that advance the chain — every class except `fatal`.
 *
 * Derived by filtering {@link FAILURE_CLASSES}, so adding a fifth class makes a
 * deliberate decision about it unavoidable rather than defaulting it to "stop".
 */
export const ADVANCING_CLASSES: readonly FailureClass[] = FAILURE_CLASSES.filter(
	(name) => name !== "fatal",
);

/**
 * Quota, budget and billing exhaustion — the subdivision Pi's own predicate
 * cannot express, and the reason this table exists at all.
 *
 * THE ONE PLACE THE HARNESS DELIBERATELY DISAGREES WITH PI, AND WHY. Pi reports
 * every string here as NOT retryable, and it is right to: retrying the same
 * provider cannot refill an exhausted account. But "do not retry" and "do not
 * try somebody else" are different decisions, and Pi only makes the first one. A
 * quota wall is the single failure a second provider is most certain to survive,
 * so the chain advances on it. This table is therefore checked BEFORE the
 * retryable predicate, not after it.
 *
 * The first four alternatives are transcribed from Pi's own
 * `NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN` [VERIFIED: pi-ai 0.84.1
 * src/utils/retry.ts:7-23 — `insufficient_quota`, `out of budget`,
 * `quota exceeded`, `billing`] so the two agree about the strings they share.
 * The last two are DashScope's own wording, which Pi's table does not carry:
 * against DashScope, `Arrearage` is the account-balance failure and
 * `Allocated quota exceeded` the rate/quota one, and both are EXECUTED as
 * non-retryable under Pi today (see {@link CLASS_FIXTURES}).
 *
 * No `g` flag and no `.`: a `g` pattern carries a persistent `lastIndex` and
 * makes `.test()` lie on every other call (`sso.ts`'s recorded lesson), and a
 * `.` in an alternation over provider-controlled text is how a pattern starts
 * matching things nobody wrote it for. [threat T-03-10-03]
 */
export const QUOTA_PATTERN =
	/insufficient_quota|out of budget|quota exceeded|billing|arrearage|allocated quota/i;

/**
 * Availability and transport failures, within the set Pi already calls
 * retryable.
 *
 * PURELY DESCRIPTIVE. `unavailable` and `transient` take the SAME chain action —
 * advance, no backoff — so nothing behavioural turns on which of the two a
 * string lands in. They are separate because PROV-08 names three classes and
 * CONTEXT requires a test for each; keeping them apart makes the turns row and
 * the test name say which kind of failure moved the request, which is what a
 * human reading the log the next morning actually needs.
 *
 * Every alternative is drawn from Pi's `RETRYABLE_PROVIDER_ERROR_PATTERN`
 * [VERIFIED: pi-ai 0.84.1 src/utils/retry.ts:25-88]. `[ _-]?` stands in for Pi's
 * `.?` for the reason above.
 */
export const UNAVAILABLE_PATTERN =
	/503|service[ _-]?unavailable|overloaded|fetch failed|getaddrinfo|timed? out|ENOTFOUND/i;

/**
 * One representative provider error per class, with Pi's own verdict recorded.
 *
 * THE TEST IMPORTS THESE RATHER THAN RETYPING THEM. A duplicated fixture string
 * is how an assertion silently stops matching the thing it checks — and here it
 * would do so in the worst possible direction, since a string that no longer
 * classifies as the test's chosen class would still produce a green run against
 * whatever class it does land in.
 *
 * `retryableToday` is Pi 0.84.1's verdict BEFORE this harness classifies
 * anything, EXECUTED over `isRetryableAssistantError` on 2026-08-13 (node
 * 24.16.0) and asserted by the chain test. A Pi bump that moves one of these
 * turns a green file red and names the claim that expired — which is the whole
 * point of writing it down rather than trusting it.
 *
 * Note the shape of the evidence: `quota` and `fatal` are BOTH non-retryable to
 * Pi and take OPPOSITE chain actions, which is precisely why the quota table
 * above cannot be dispensed with.
 */
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

/**
 * Extra quota strings this repository must handle and Pi's table does not name.
 *
 * Kept beside {@link CLASS_FIXTURES} rather than folded into it because the
 * chain test drives one fixture per class through a live session; these are
 * asserted against the classifier directly. Both are DashScope's own wording.
 */
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
