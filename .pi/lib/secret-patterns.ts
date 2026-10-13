/**
 * The one credential-shape table, shared by the wire-capture redactor and the safety audit so neither is weaker than the other.
 * Each pattern is a single quantifier over a character class (no nesting, no unanchored `.*`) against ReDoS on untrusted text.
 * A named `keep` group is a non-secret prefix (a key name, `Bearer `, `-u `) written back verbatim; the rest of the match is masked.
 * The `g` flag is load-bearing: use through `replace` only, never `.test()`, since `lastIndex` persists.
 */
export const SECRET_PATTERNS: readonly RegExp[] = [
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
	// PEM private key header; `{0,40}` bounds backtracking.
	/-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/g,
	// A bearer credential of any length; `\s` and the token class are disjoint.
	/(?<keep>bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
	// JWT: three base64url segments, the first starting with the encoded `{"`.
	/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
	// The password in URL userinfo, `scheme://user:pass@host`.
	/(?<keep>:\/\/[^\s/:@]+:)[^\s/@]+(?=@)/g,
	// `curl -u user:pass` and `--user user:pass`.
	/(?<keep>(?<![\w-])(?:-u|--user)[ =]+)[^\s:'"]+:[^\s'"]+/g,
	// `mysql -pPASSWORD`: the attached form only, scoped to the mysql family so `mkdir -p` and `find -path` survive.
	/(?<=\bmysql(?:dump|admin)?\b[^\n|;&]{0,200}\s)(?<keep>-p)\S+/g,
	// A credential-named assignment in env, YAML or JSON form, snake or camel case; a value already masked is skipped.
	/(?<keep>(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization|credential)[A-Za-z0-9_-]*["']?\s*[=:]\s*)(?!\[(?:redacted|REDACTED)\b)(?:"[^"]*"|'[^']*'|[^\s"'&;]+)/gi,
];

/** Replaces every credential-shaped run with `mask(secret)`, keeping each pattern's `keep` prefix. */
export function maskSecrets(text: string, mask: (secret: string) => string): string {
	let out = text;
	for (const pattern of SECRET_PATTERNS) {
		out = out.replace(pattern, (...args: unknown[]) => {
			const match = args[0] as string;
			const groups = args.at(-1) as { keep?: string } | undefined;
			const keep = typeof groups === "object" && groups !== null && typeof groups.keep === "string" ? groups.keep : "";
			return keep + mask(match.slice(keep.length));
		});
	}
	return out;
}
