/**
 * One redactor, for the one hazard a wire inspector creates.
 *
 * ---------------------------------------------------------------------------
 * Why any of this exists
 * ---------------------------------------------------------------------------
 * Phase 2 writes the exact JSON that went on the wire to a file inside a
 * working tree that is a public GitHub repository. Redaction therefore happens
 * at CAPTURE, never at read. A live key sitting on disk in this tree is a
 * breach the moment it is written -- a later reader that would have masked it
 * changes nothing, and neither does `.gitignore`, which one `git add -f` or one
 * careless rule edit defeats. The gitignored path is the second control; this
 * file is the first.
 *
 * ---------------------------------------------------------------------------
 * Why matching key names is not enough
 * ---------------------------------------------------------------------------
 * The naive threat model says "strip the API key from the request body". That
 * threat does not exist: no adapter puts the credential in the payload. The key
 * goes to `createClient(model, context, apiKey, ...)` one line above the
 * `onPayload` call, SigV4 is applied by Smithy middleware after the Bedrock
 * command is built, and Anthropic authenticates through client construction
 *   [VERIFIED: 02-RESEARCH.md §1.3 -- exhaustive grep of `onPayload` across
 *    pi-ai/src/api/*.ts, 12 call sites, all post-body-build and all pre-send].
 *
 * What the payload DOES carry is the whole `messages[]` array, including every
 * file the model read this session. On a machine holding live AWS SSO
 * credentials for an account where `main` auto-deploys, the realistic leak is a
 * `.env`, a `~/.aws/credentials` or a `*.tfstate` read into context and then
 * written to disk verbatim. Phase 4's SAFE-06 read-block would narrow that, and
 * Phase 4 has not shipped; these dumps start now. So the payload path needs
 * secret-SHAPED value matching, and the header path needs key-name matching,
 * and neither substitutes for the other.
 *
 * ---------------------------------------------------------------------------
 * Scope caveat, stated rather than overclaimed
 * ---------------------------------------------------------------------------
 * `SECRET_VALUE_PATTERNS` is a judgement call about which credential shapes are
 * worth matching, recorded as Assumption A2 and accepted as residual risk
 * T-02-02-03. A shape this list does not know about is a credential written to
 * disk. Nothing here changes that, and no amount of unit testing can: every
 * test in `tests/unit/redact.test.ts` is a fixture this file's author also
 * wrote. The real check is `RB-02-02` -- grepping actual dumps produced by
 * actual credentialed requests on the work laptop -- and it is OUTSTANDING.
 * This module proves the matcher is correct about what it matches. It says
 * nothing about coverage.
 *
 * ---------------------------------------------------------------------------
 * Bounded patterns, deliberately
 * ---------------------------------------------------------------------------
 * Every pattern below is a single quantifier over a character class, with no
 * nested quantifier and no unanchored `.*`. That is a hard requirement, not a
 * style: this matcher is pointed at untrusted model output of arbitrary size,
 * and catastrophic backtracking there is a denial of service on the instrument
 * itself (02-RESEARCH.md "Security Domain", ASVS V5 row and the ReDoS threat
 * row). `tests/unit/redact.test.ts` asserts a 1 MB adversarial input completes
 * under two seconds.
 *
 * PURITY. No imports, no I/O, no dependency -- 02-RESEARCH.md §10.4 found
 * nothing to reuse in Pi or pi-ai and forbids adding a package, so this is
 * hand-rolled and kept short enough to read end to end. `redactDeep` returns a
 * NEW structure and never mutates its argument, because `before_provider_request`
 * hands over the live payload and any in-place edit would change what the
 * provider actually receives (02-RESEARCH.md §1.2).
 */

/**
 * The masked form: the value is gone, its length survives.
 *
 * Keeping the length makes "was a credential present at all, and roughly which
 * one?" answerable from a dump without the dump containing the answer.
 */
export function redactionPlaceholder(length: number): string {
	return `[redacted:${length} chars]`;
}

/**
 * Sentinel written in place of a subtree that blew the depth or node budget.
 *
 * A truncated subtree is recorded as truncated and nothing else. Emitting a
 * partial walk would be worse than useless: it would look like data.
 */
export const TRUNCATION_PLACEHOLDER = "[redacted:truncated]";

/** Deepest object/array nesting `redactDeep` will walk before truncating. */
const MAX_DEPTH = 24;

/** Total nodes `redactDeep` will visit before truncating the rest. */
const MAX_NODES = 200_000;

/**
 * Header keys whose value is a credential, lower-cased.
 *
 * Enumerated from the resolved provider auth headers that reach
 * `before_provider_headers`, which sees `mergeHeaders(resolution.auth.headers,
 * providerOptions.headers)` [VERIFIED: 02-RESEARCH.md §2.4, from
 * pi-ai src/providers/anthropic.ts:28, api/openai-completions.ts:72-76,
 * api/anthropic-messages.ts:287, providers/cloudflare-auth.ts:94-95,
 * api/openai-codex-responses.ts:1606].
 *
 * Pi's own attribution headers (`HTTP-Referer`, `X-OpenRouter-Title`,
 * `User-Agent`, `X-BILLING-INVOKE-ORIGIN`) are deliberately absent: they are
 * not secrets and masking them would cost the dump its provenance.
 */
export const REDACTED_HEADER_KEYS: readonly string[] = [
	"authorization",
	"x-api-key",
	"api-key",
	"cf-aig-authorization",
	"x-goog-api-key",
	"proxy-authorization",
	"cookie",
	"set-cookie",
];

/**
 * The open half of the header rule: any key that NAMES a credential.
 *
 * The list above is closed and will go stale the first time a provider invents
 * a header. This catches `x-session-token`, `openai_api_key`, `client-secret`
 * and their relatives without needing to have predicted them.
 */
export const REDACTED_HEADER_KEY_RE = /(^|[-_])(api[-_]?key|token|secret|credential|password)([-_]|$)/i;

/**
 * Credential shapes worth matching inside a value.
 *
 * Exactly the 02-RESEARCH.md §1.3 set, with the GitHub entry split in two
 * because the classic and fine-grained forms have different alphabets and
 * different lengths. `tests/unit/redact.test.ts` asserts one sample per entry,
 * so a pattern cannot be added here without a sample proving it fires.
 *
 * WORD BOUNDARIES, ONLY WHERE THEY EARN IT. `sk-` and `pt-` are three
 * characters of very low entropy and occur inside ordinary English and ordinary
 * paths -- `risk-assessment-documents` is `sk-` plus 24 token characters, and a
 * redactor that mangles prose fails its negative control just as surely as one
 * that leaks. Both therefore require a preceding word boundary; a real key is
 * always preceded by a quote, an `=`, a space or a line start. The
 * high-entropy prefixes (`AKIA`, `ASIA`, `AIza`, `gh?_`, `xox?-`) carry no
 * boundary, because a false positive on them is essentially impossible and
 * over-redaction is the right way to be wrong.
 *
 * THE `g` FLAG IS LOAD-BEARING AND ALSO A TRAP. These are used through
 * `String.prototype.replace`, which resets `lastIndex`. Never call `.test()` on
 * one: `lastIndex` persists between calls and every other call would lie.
 */
export const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
	// OpenAI / DeepSeek / DashScope / OpenRouter style.
	/\bsk-[A-Za-z0-9_-]{16,}/g,
	// AWS long-term access key id.
	/AKIA[0-9A-Z]{16}/g,
	// AWS temporary (STS / SSO) access key id -- the shape this laptop holds.
	/ASIA[0-9A-Z]{16}/g,
	// GitHub classic personal, OAuth, user-to-server and server-to-server.
	/gh[pous]_[A-Za-z0-9]{20,}/g,
	// GitHub fine-grained personal access token.
	/github_pat_[A-Za-z0-9_]{20,}/g,
	// Slack bot and user tokens.
	/xox[bp]-[A-Za-z0-9-]{10,}/g,
	// Google API key.
	/AIza[0-9A-Za-z_-]{35}/g,
	// Qoder personal access token.
	/\bpt-[A-Za-z0-9]{16,}/g,
	// PEM private key header. `{0,40}` rather than `*` so the overlap between
	// `[A-Z ]` and the literal `PRIVATE KEY` that follows it cannot backtrack
	// further than a fixed, tiny bound.
	/-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/g,
	// Any bearer credential, whatever issued it. `\s` and the token class are
	// disjoint, so the two quantifiers cannot trade characters.
	/Bearer\s+[A-Za-z0-9._-]{20,}/g,
	// An `~/.aws/credentials` or `.env` line read into context.
	/aws_secret_access_key\s*=\s*\S+/gi,
];

/** Is this header key one whose value must never be recorded? */
function isRedactedHeaderKey(key: string): boolean {
	const lower = key.toLowerCase();
	return REDACTED_HEADER_KEYS.includes(lower) || REDACTED_HEADER_KEY_RE.test(lower);
}

/**
 * Replace every credential-shaped run in `value`, leaving everything else
 * byte-identical.
 *
 * The second half of that sentence is the half that needs a test. A redactor
 * that mangles ordinary text passes every positive assertion and destroys the
 * instrument's value, which is why `CLEAN_SAMPLES` exists.
 */
export function redactString(value: string): string {
	let out = value;
	for (const pattern of SECRET_VALUE_PATTERNS) {
		out = out.replace(pattern, (match) => redactionPlaceholder(match.length));
	}
	return out;
}

/**
 * Redact a resolved provider header map into a NEW map.
 *
 * A credential-named key loses its value and keeps its length. A `null` value
 * stays `null` -- `null` means "delete this header"
 * [VERIFIED: 02-RESEARCH.md §2.1, pi-ai src/types.ts:110] and rewriting it to a
 * placeholder would misreport a deletion as a secret. Every other value still
 * goes through `redactString`, because a non-credential header can carry one
 * anyway (a proxy that echoes a token into a custom trace header, say).
 */
export function redactHeaders(headers: Record<string, string | null>): Record<string, string | null> {
	const out: Record<string, string | null> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (value === null) {
			out[key] = null;
		} else if (isRedactedHeaderKey(key)) {
			out[key] = redactionPlaceholder(value.length);
		} else {
			out[key] = redactString(value);
		}
	}
	return out;
}

/** Only walk objects that are plain records; anything else passes through. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const proto: unknown = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function walk(value: unknown, depth: number, budget: { nodes: number }): unknown {
	if (depth > MAX_DEPTH || budget.nodes <= 0) {
		return TRUNCATION_PLACEHOLDER;
	}
	budget.nodes -= 1;

	if (typeof value === "string") {
		return redactString(value);
	}
	if (Array.isArray(value)) {
		return value.map((item) => walk(item, depth + 1, budget));
	}
	if (isPlainObject(value)) {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			// The header rule applies to object keys too: a captured payload can
			// nest a header map, and `{ authorization: "..." }` there is the same
			// credential it would be in the header hook.
			out[key] =
				isRedactedHeaderKey(key) && typeof item === "string"
					? redactionPlaceholder(item.length)
					: walk(item, depth + 1, budget);
		}
		return out;
	}
	// Numbers, booleans, null, undefined, and anything with a non-plain
	// prototype (a Date, a class instance) pass through untouched. JSON payloads
	// contain none of the latter, and serialising a Date to `{}` would mangle
	// clean data -- the failure mode the negative control exists to catch.
	return value;
}

/**
 * Redact every string leaf of a payload, returning a NEW structure.
 *
 * NON-MUTATING BY CONTRACT. `before_provider_request` hands over the live
 * request payload and any handler that returns a non-`undefined` value replaces
 * it for every later handler and for the real request
 * [VERIFIED: 02-RESEARCH.md §1.2]. A capture path that edited the payload in
 * place would silently ship redacted text to the model. The test compares
 * `JSON.stringify` of the input before and after the call.
 *
 * BOUNDED BY CONTRACT. Depth is capped at 24 and the whole walk at 200,000
 * nodes; a subtree that exceeds either becomes `TRUNCATION_PLACEHOLDER`. The
 * input is an untrusted object graph and unbounded recursion on one is a
 * denial of service on the instrument (threat T-02-02-06).
 *
 * The `T` in and `T` out is a convenience for callers, not a truth: a truncated
 * subtree comes back as a string wherever it sat.
 */
export function redactDeep<T>(value: T): T {
	return walk(value, 0, { nodes: MAX_NODES }) as T;
}
