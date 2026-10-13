/**
 * Redaction at CAPTURE, never at read: wire dumps land in a working tree that is a public repo,
 * so a live key on disk is a breach the moment it is written (`.gitignore` is only the second control).
 * The payload carries the whole `messages[]` array (a read `.env`, `~/.aws/credentials` or `*.tfstate`),
 * so values are matched by SHAPE and header keys by NAME. The pattern list cannot prove coverage.
 * Patterns are single quantifiers over character classes (no nesting, no unanchored `.*`) against
 * ReDoS on untrusted output. No imports or I/O; `redactDeep` never mutates, since
 * `before_provider_request` hands over the live payload.
 */

/** The masked form: the value is gone, its length survives. */
export function redactionPlaceholder(length: number): string {
	return `[redacted:${length} chars]`;
}

/** Sentinel for a subtree that blew the depth or node budget; recorded as truncated, never partially walked. */
export const TRUNCATION_PLACEHOLDER = "[redacted:truncated]";

/** Deepest object/array nesting `redactDeep` will walk before truncating. */
const MAX_DEPTH = 24;

/** Total nodes `redactDeep` will visit before truncating the rest. */
const MAX_NODES = 200_000;

/** Header keys whose value is a credential, lower-cased. Pi's attribution headers are deliberately absent. */
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

/** Open half of the header rule: any key that NAMES a credential, so unpredicted headers are caught. */
export const REDACTED_HEADER_KEY_RE = /(^|[-_])(api[-_]?key|token|secret|credential|password)([-_]|$)/i;

/**
 * Credential shapes worth matching inside a value. `sk-` and `pt-` require a preceding word boundary
 * (`risk-assessment-documents` contains `sk-`); the high-entropy prefixes carry none.
 * The `g` flag is load-bearing: use through `replace` only, never `.test()`, since `lastIndex` persists.
 */
export const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
	/\bsk-[A-Za-z0-9_-]{16,}/g,
	/AKIA[0-9A-Z]{16}/g,
	// AWS temporary (STS / SSO) access key id.
	/ASIA[0-9A-Z]{16}/g,
	/gh[pous]_[A-Za-z0-9]{20,}/g,
	/github_pat_[A-Za-z0-9_]{20,}/g,
	/xox[bp]-[A-Za-z0-9-]{10,}/g,
	/AIza[0-9A-Za-z_-]{35}/g,
	/\bpt-[A-Za-z0-9]{16,}/g,
	// PEM private key header; `{0,40}` bounds backtracking.
	/-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/g,
	// Any bearer credential; `\s` and the token class are disjoint.
	/bearer\s+[A-Za-z0-9._-]{20,}/gi,
	/aws_secret_access_key\s*=\s*\S+/gi,
	// JWT: three base64url segments, the first starting with the encoded `{"`.
	/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
	// Credential-named assignment in env, YAML or JSON form, snake or camel case.
	/(?:access[_-]?token|refresh[_-]?token|session[_-]?token|secret[_-]?access[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']?[^\s"',;]+/gi,
	// `curl -u user:pass` and `--user user:pass`.
	/(?<![\w-])(?:-u|--user)[ =]+[^\s:'"]+:[^\s'"]+/g,
	// `mysql -pPASSWORD`: the attached form only, scoped to the mysql family so `mkdir -p` and `find -path` survive.
	/(?<=\bmysql(?:dump|admin)?\b[^\n|;&]{0,200}\s)-p\S+/g,
];

function isRedactedHeaderKey(key: string): boolean {
	const lower = key.toLowerCase();
	return REDACTED_HEADER_KEYS.includes(lower) || REDACTED_HEADER_KEY_RE.test(lower);
}

/** Replace every credential-shaped run, leaving everything else byte-identical. */
export function redactString(value: string): string {
	let out = value;
	for (const pattern of SECRET_VALUE_PATTERNS) {
		out = out.replace(pattern, (match) => redactionPlaceholder(match.length));
	}
	return out;
}

/** Redact a header map into a NEW map; `null` (delete this header, pi-ai `types.ts` ProviderHeaders) stays `null`. */
export function redactHeaders(headers: Record<string, string | null>): Record<string, string | null> {
	const out: Record<string, string | null> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (typeof value !== "string" && value !== null) {
				// Normalise a loose `undefined` to `null`; otherwise `value.length` throws and the whole wire record is lost.
			out[key] = null;
		} else if (value === null) {
			out[key] = null;
		} else if (isRedactedHeaderKey(key)) {
			out[key] = redactionPlaceholder(value.length);
		} else {
			out[key] = redactString(value);
		}
	}
	return out;
}

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
				// Header rule applies to object keys too: payloads can nest a header map.
			out[key] = isRedactedHeaderKey(key)
				? redactUnderCredentialKey(item, budget)
				: walk(item, depth + 1, budget);
		}
		return out;
	}
		// Keep a Date as the string `JSON.stringify` would produce, not `{}`.
	if (value instanceof Date) {
		return value.toISOString();
	}
		// Any other object-like value (class instance, Map, typed array) is truncated: `JSON.stringify` still
		// emits its enumerable properties, so a credential could reach disk, and a cycle would throw in the append.
	if (typeof value === "object" && value !== null) {
		return TRUNCATION_PLACEHOLDER;
	}
		// Primitives cannot carry a string.
	return value;
}

/** The value under a credential-named key: the whole subtree goes, since the key is better evidence than any shape. `null`/`undefined` pass (deletion). */
function redactUnderCredentialKey(item: unknown, budget: { nodes: number }): unknown {
	if (typeof item === "string") {
		return redactionPlaceholder(item.length);
	}
	if (item === null || item === undefined) {
		return item;
	}
	// Charge the budget so credential-named keys cannot escape the node cap.
	budget.nodes -= 1;
	return TRUNCATION_PLACEHOLDER;
}

/**
 * Redact every string leaf of a payload, returning a NEW structure; never mutates the input
 * (an in-place edit would ship redacted text to the model). Depth is capped at 24 and the walk at
 * 200,000 nodes; a subtree beyond either, or any non-plain object other than `Date`, becomes
 * `TRUNCATION_PLACEHOLDER`, so the `T` return is a convenience, not a truth.
 */
export function redactDeep<T>(value: T): T {
	return walk(value, 0, { nodes: MAX_NODES }) as T;
}
