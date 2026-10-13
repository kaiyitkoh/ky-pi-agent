/**
 * Redaction at CAPTURE, never at read: wire dumps land in a working tree that is a public repo,
 * so a live key on disk is a breach the moment it is written (`.gitignore` is only the second control).
 * The payload carries the whole `messages[]` array (a read `.env`, `~/.aws/credentials` or `*.tfstate`),
 * so values are matched by SHAPE and header keys by NAME. The pattern list cannot prove coverage.
 * The value shapes are `.pi/lib/secret-patterns.ts`, shared with the safety audit. No I/O; `redactDeep` never mutates,
 * since `before_provider_request` hands over the live payload.
 */
import { maskSecrets, maskSecretShapes, SECRET_PATTERNS } from "../../lib/secret-patterns.ts";

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
export const REDACTED_HEADER_KEYS: readonly string[] = Object.freeze([
	"authorization",
	"x-api-key",
	"api-key",
	"cf-aig-authorization",
	"x-goog-api-key",
	"proxy-authorization",
	"cookie",
	"set-cookie",
]);

/** Open half of the header rule: any key that NAMES a credential, so unpredicted headers are caught. */
export const REDACTED_HEADER_KEY_RE = /(^|[-_])(api[-_]?key|token|secret|credential|password)([-_]|$)/i;

/** Credential shapes matched inside a value; see `.pi/lib/secret-patterns.ts`. */
export const SECRET_VALUE_PATTERNS: readonly RegExp[] = SECRET_PATTERNS;

/** Payload walks test the same few dozen keys thousands of times; the memo is cleared at this size so it stays bounded. */
const MAX_MEMOISED_KEYS = 4096;
const keyVerdicts = new Map<string, boolean>();

/** camelCase keys (`apiKey`, `secretAccessKey`) are split to snake case too, so the delimiter in the key rule finds them. */
function isRedactedHeaderKey(key: string): boolean {
	const memoised = keyVerdicts.get(key);
	if (memoised !== undefined) {
		return memoised;
	}
	const lower = key.toLowerCase();
	const snake = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
	const verdict =
		REDACTED_HEADER_KEYS.includes(lower) || REDACTED_HEADER_KEY_RE.test(lower) || REDACTED_HEADER_KEY_RE.test(snake);
	if (keyVerdicts.size >= MAX_MEMOISED_KEYS) {
		keyVerdicts.clear();
	}
	keyVerdicts.set(key, verdict);
	return verdict;
}

/** Replace every credential-shaped run, leaving everything else byte-identical. */
export function redactString(value: string): string {
	return maskSecrets(value, (secret) => redactionPlaceholder(secret.length));
}

/** Like `redactString`, but by shape only, so source sent to a reviewer model or into an MR body stays readable code. */
export function redactForModel(value: string): string {
	return maskSecretShapes(value, (secret) => redactionPlaceholder(secret.length));
}

/** Redact a header map into a NEW map; `null` (delete this header, pi-ai `types.ts` ProviderHeaders) stays `null`. */
export function redactHeaders(headers: Record<string, string | null>): Record<string, string | null> {
	const out: Record<string, string | null> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (typeof value !== "string") {
			// A loose `undefined` is normalised to `null` too; otherwise `value.length` throws and the whole wire record is lost.
			out[key] = null;
		} else {
			out[key] = isRedactedHeaderKey(key) ? redactionPlaceholder(value.length) : redactString(value);
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
