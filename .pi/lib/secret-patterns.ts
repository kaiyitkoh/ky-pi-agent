/**
 * The one credential table, shared by the wire redactor, the safety audit and every prompt or MR body built from source.
 * Linear on untrusted text: an unbounded run either ends its rule, so it cannot fail, or is anchored so that one run has one start.
 */

/** Credentials recognised by their own form. Safe on source code, so model prompts and MR bodies use only these. */
export const SHAPE_PATTERNS: readonly RegExp[] = [
	// `sk-` and `pt-` need a word boundary: `risk-assessment` contains `sk-`.
	/\bsk-[A-Za-z0-9_-]{16,}/g,
	/AKIA[0-9A-Z]{16}/g,
	// AWS temporary (STS / SSO) access key id.
	/ASIA[0-9A-Z]{16}/g,
	/gh[pousr]_[A-Za-z0-9_-]{10,}/g,
	/github_pat_[A-Za-z0-9_]{20,}/g,
	/glpat-[A-Za-z0-9_-]{10,}/g,
	/xox[abprs]-[A-Za-z0-9-]{10,}/g,
	/AIza[0-9A-Za-z_-]{35}/g,
	/\bpt-[A-Za-z0-9]{16,}/g,
	// Bedrock API key (`AWS_BEARER_TOKEN_BEDROCK`).
	/ABSK[A-Za-z0-9+/=]{20,}/g,
	/-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/g,
	// Token-length only, so prose and code that say "Bearer token" survive; `\s` and the token class are disjoint.
	/(?<keep>bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi,
	// JWT: three base64url segments, the first starting with the encoded `{"`.
	/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
	// The password in URL userinfo, `scheme://user:pass@host`.
	/(?<keep>:\/\/[^\s/:@]+:)[^\s/@]+(?=@)/g,
	// `curl -u user:pass` and `--user user:pass`. The separator and the user are disjoint and the user is bounded, so `-u=-u=...` cannot rescan.
	/(?<keep>(?<![\w-])(?:-u|--user)(?: +|=))[^\s:'"=][^\s:'"]{0,256}:[^\s'"]+/g,
	// `mysql -pPASSWORD`: the attached form only, scoped to the mysql family so `mkdir -p` and `find -path` survive.
	/(?<=\bmysql(?:dump|admin)?\b[^\n|;&]{0,200}\s)(?<keep>-p)\S+/g,
];

/** Credentials recognised by the name beside them. These also hit ordinary code (`const token = req.headers.authorization`), so only on-disk logs use them. */
export const LOG_ONLY_PATTERNS: readonly RegExp[] = [
	/(?<keep>bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
	// The suffix and spacing are bounded; the value is not, but with its closing quote optional it cannot fail, so nothing rescans.
	/(?<keep>(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization|credential)[A-Za-z0-9_-]{0,40}["']?[ \t]{0,16}[=:][ \t]{0,16}(?:\r?\n[ \t]{0,16})?)(?!\[(?:redacted|REDACTED)\b)(?:"[^"\n]*"?|'[^'\n]*'?|[^\s"'&;]+)/gi,
];

/** Every pattern, shape rules first, for logs. */
export const SECRET_PATTERNS: readonly RegExp[] = [...SHAPE_PATTERNS, ...LOG_ONLY_PATTERNS];

// The `g` flag is load-bearing: `lastIndex` persists, so these go through `replace` only, never `.test()`.
function maskWith(patterns: readonly RegExp[], text: string, mask: (secret: string) => string): string {
	let out = text;
	for (const pattern of patterns) {
		out = out.replace(pattern, (...args: unknown[]) => {
			const match = args[0] as string;
			// A named `keep` group is a non-secret prefix (a key name, `Bearer `, `-u `) written back verbatim.
			const groups = args.at(-1) as { keep?: string } | undefined;
			const keep = typeof groups === "object" && groups !== null && typeof groups.keep === "string" ? groups.keep : "";
			return keep + mask(match.slice(keep.length));
		});
	}
	return out;
}

/** Masks every credential, by shape or by name, for text written to a log. */
export function maskSecrets(text: string, mask: (secret: string) => string): string {
	return maskWith(SECRET_PATTERNS, text, mask);
}

/** Masks only shape-recognised credentials, for text a model or a human must still read as code. */
export function maskSecretShapes(text: string, mask: (secret: string) => string): string {
	return maskWith(SHAPE_PATTERNS, text, mask);
}
