/**
 * DIAG-07 — the redactor, asserted in both directions.
 *
 * WHY BOTH DIRECTIONS. A redactor is trivially easy to test wrong. Assert only
 * that secrets disappear and `redactString = () => "[redacted]"` passes every
 * case while destroying the instrument the phase exists to build. Assert only
 * that clean text survives and a redactor that does nothing passes. So this
 * file carries a positive table (`SECRET_SAMPLES`, one entry per pattern) and a
 * negative control (`CLEAN_SAMPLES`, byte-identical round trips), and neither
 * half is optional.
 *
 * THE VACUOUS-PASS GUARD. `SECRET_SAMPLES.length` is asserted equal to
 * `SECRET_VALUE_PATTERNS.length`, and each sample is asserted against the
 * pattern at its own index. Without that, a pattern could be added to the
 * module with no sample proving it ever fires, and the loop below would report
 * green having never exercised it — the failure shape this project has already
 * tripped over three times.
 *
 * SAMPLES ARE ASSEMBLED AT RUNTIME. Every credential-shaped string below is
 * built by joining short parts. This repository is public; a committed
 * 20-plus-character run over a token alphabet is indistinguishable from a
 * pasted credential to a scanner, to a reader, and to a future grep of
 * `.pi/logs/`. Same rule as `tests/helpers/faux.ts:113`.
 *
 * SCOPE, STATED RATHER THAN IMPLIED. This file proves the matcher is correct
 * about what it matches. It says nothing about coverage: every fixture here was
 * written by the same person who wrote the pattern list. The real check is
 * `RB-02-02` — grepping actual dumps from actual credentialed requests on the
 * work laptop — and it is OUTSTANDING.
 */
import { describe, expect, it } from "vitest";
import {
	REDACTED_HEADER_KEYS,
	SECRET_VALUE_PATTERNS,
	TRUNCATION_PLACEHOLDER,
	redactDeep,
	redactHeaders,
	redactForModel,
	redactString,
	redactionPlaceholder,
} from "../../.pi/extensions/diagnostics/redact.ts";
import { LOG_ONLY_PATTERNS, SHAPE_PATTERNS } from "../../.pi/lib/secret-patterns.ts";

interface Sample {
	readonly label: string;
	readonly value: string;
}

/**
 * One credential-shaped sample per entry in `SECRET_VALUE_PATTERNS`, in the
 * same order.
 *
 * Order is load-bearing: the loop below asserts sample `i` against pattern `i`,
 * so deleting or reordering a pattern without touching this table fails loudly
 * instead of quietly shrinking what the redactor covers.
 */
const SECRET_SAMPLES: readonly Sample[] = [
	{ label: "OpenAI-style sk- key", value: ["sk", "abcdefghij0123456789"].join("-") },
	{ label: "AWS long-term access key id", value: ["AK", "IA"].join("") + "IOSFODNN7EXAMPLE" },
	{ label: "AWS temporary (STS/SSO) access key id", value: ["AS", "IA"].join("") + "JQKLMNOPQRST2345" },
	{ label: "GitHub classic personal token", value: ["ghp", "abcdefghij0123456789"].join("_") },
	{ label: "GitHub fine-grained token", value: ["github", "pat", "ABCdef0123456789ghij"].join("_") },
	{ label: "GitLab personal access token", value: ["glpat", "abcdefghij0123456789"].join("-") },
	{ label: "Slack bot token", value: ["xoxb", "123456789012"].join("-") },
	{ label: "Google API key", value: "AIza" + "b".repeat(35) },
	{ label: "Qoder personal access token", value: ["pt", "abcdef0123456789"].join("-") },
	{ label: "Bedrock API key", value: ["AB", "SK"].join("") + "QmVkcm9ja0FQSUtleS1leGFtcGxl" },
	{ label: "PEM private key header", value: ["-----BEGIN ", "RSA ", "PRIVATE KEY", "-----"].join("") },
	{ label: "token-length bearer credential", value: ["Bearer", ["abcdefgh", "ijklmnop", "1234"].join("")].join(" ") },
	{ label: "JWT", value: [["ey", "JhbGciOiJIUzI1NiJ9"].join(""), "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "c2lnbmF0dXJl"].join(".") },
	{ label: "URL userinfo password", value: "postgres://app:" + ["Pr0d", "pass"].join("") + "@db.internal:5432/app" },
	{ label: "curl user:password", value: "curl -u deploy:" + ["hunter", "2"].join("") + " https://example.com" },
	{ label: "mysql attached password", value: "mysql -h db -u root -p" + ["hunter", "2"].join("") + " app" },
	{ label: "short bearer credential", value: ["Bearer", "abc123"].join(" ") },
	{ label: "generic password assignment", value: "DATABASE_PASSWORD=" + ["Pr0d", "!pass"].join("") },
];

/**
 * Realistic strings that are NOT credentials and must survive untouched.
 *
 * The last two are the deliberate near-misses. `sk-` and `pt-` are three
 * low-entropy characters that occur inside ordinary English and ordinary
 * paths; they are the reason those two patterns — and only those two — require
 * a preceding word boundary.
 */
const CLEAN_SAMPLES: readonly Sample[] = [
	{ label: "a repo-relative log path", value: ".pi/logs/wire-2026-08-13.jsonl" },
	{ label: "a POSIX absolute path", value: "/home/runner/work/ky-pi-agent/tests/unit/redact.test.ts" },
	{ label: "an ISO timestamp", value: "2026-08-13T03:57:24.428Z" },
	{ label: "a git commit sha", value: "3320c12e7b4a1d9f0c6e2a8b5d3f7194ac0be215" },
	{ label: "a model id", value: "deepseek-chat" },
	{ label: "an ordinary sentence", value: "The model read the file and returned a summary of its contents." },
	{ label: "a JSON fragment", value: '{"model":"deepseek-chat","temperature":0,"stream":true}' },
	{ label: "a path containing sk- inside a word", value: "C:/work/risk-assessment-documents/summary.md" },
	{ label: "a filename containing pt- inside a word", value: "encrypt-payload-transformer.ts" },
];

describe("DIAG-07 — the sample table covers the pattern list", () => {
	it("has exactly one sample per pattern", () => {
		expect(
			SECRET_SAMPLES.length,
			"a pattern without a sample is a pattern nothing proves ever fires, and the loop below " +
				"would go green having never exercised it — add the sample in the same change as the " +
				"pattern, at the same index",
		).toBe(SECRET_VALUE_PATTERNS.length);
	});

	it("asserts a meaningful number of clean strings in the other direction", () => {
		expect(
			CLEAN_SAMPLES.length,
			"without a negative control a redactor that mangles everything passes every assertion " +
				"in this file",
		).toBeGreaterThanOrEqual(6);
	});
});

describe("DIAG-07 — every credential shape is redacted", () => {
	SECRET_SAMPLES.forEach((sample, index) => {
		it(`redacts ${sample.label}`, () => {
			// Pattern-to-sample pinning: this is what makes deleting a pattern a
			// failure rather than a silent loss of coverage.
			const pattern = SECRET_VALUE_PATTERNS[index] as RegExp;
			expect(
				sample.value.match(pattern),
				`SECRET_VALUE_PATTERNS[${index}] does not match its own sample "${sample.label}" — ` +
					"the table and the pattern list have drifted out of order",
			).not.toBeNull();

			const prose = `payload fragment: ${sample.value} -- end of fragment`;
			const out = redactString(prose);

			expect(out, `${sample.label} survived redaction into a dump on disk`).not.toContain(sample.value);
			expect(out, `${sample.label} was removed but left no placeholder behind`).toContain("[redacted:");
			expect(out, "the surrounding prose must survive; only the credential goes").toContain("payload fragment:");
		});
	});
});

describe("DIAG-07 — further credential shapes", () => {
	const cases: readonly (readonly [string, string, string])[] = [
		["secretAccessKey colon form", "secretAccessKey: " + ["wJalr", "XUtnFEMI"].join(""), "wJalrXUtnFEMI"],
		["sessionToken in JSON", `{"sessionToken":"${["Fwo", "GZXIvYXdz"].join("")}"}`, "FwoGZXIvYXdz"],
		["aws_session_token assignment", "aws_session_token = " + ["Fwo", "GZXIvYXdz"].join(""), "FwoGZXIvYXdz"],
		["lowercase bearer", "authorization: bearer " + ["abcdefghij", "klmnopqrstuv"].join(""), "abcdefghijklmnopqrstuv"],
		["long user option", "curl --user admin:" + ["s3cr", "etpw"].join(""), "s3cretpw"],
		["aws_secret_access_key assignment", `${["aws", "secret", "access", "key"].join("_")} = ${["wJalr", "XUtnFEMI"].join("")}`, "wJalrXUtnFEMI"],
		["api_key assignment", "API_KEY=" + ["k3y", "value"].join(""), "k3yvalue"],
		["JSON password field", `{"password": "${["hun", "ter22"].join("")}"}`, "hunter22"],
		["camelCase accessToken in JSON", `{"${["access", "Token"].join("")}":"${["abc", "def", "123456"].join("")}"}`, "abcdef123456"],
		["GITLAB_TOKEN in a read .env", "GITLAB_TOKEN=" + ["glpat", "xxxxxxxxxxxxxxxxxxxx"].join("-"), "xxxxxxxxxxxxxxxxxxxx"],
		["Bedrock bearer env", "AWS_BEARER_TOKEN_BEDROCK=" + ["AB", "SK"].join("") + "QmVkcm9ja0FQSUtleS1leGFtcGxl", "QmVkcm9ja0FQSUtleS1leGFtcGxl"],
	];
	for (const [label, input, secret] of cases) {
		it(`masks ${label}`, () => {
			const out = redactString(`x ${input} y`);
			expect(out).not.toContain(secret);
			expect(out).toContain("[redacted:");
		});
	}

	it("leaves mkdir -p and find -path alone", () => {
		const text = "mkdir -p build/out && find . -path ./node_modules -prune";
		expect(redactString(text)).toBe(text);
	});
});

describe("DIAG-07 — the negative control: clean text is byte-identical", () => {
	for (const sample of CLEAN_SAMPLES) {
		it(`leaves ${sample.label} alone`, () => {
			expect(
				redactString(sample.value),
				"a redactor that mangles ordinary text passes every positive assertion above while " +
					"making the wire dump useless — this half is what stops the patterns being widened " +
					"until they match everything",
			).toBe(sample.value);
		});
	}
});

describe("DIAG-07 — redactDeep walks a payload without mutating it", () => {
	const secret = SECRET_SAMPLES[0]?.value as string;

	function buildPayload(): Record<string, unknown> {
		return {
			model: "deepseek-chat",
			temperature: 0,
			stream: true,
			messages: [
				{ role: "system", content: "You are a coding agent." },
				{ role: "user", content: "read .env and tell me what is in it" },
				{ role: "assistant", content: "Reading the file now." },
				{ role: "user", content: `contents of .env:\nOPENAI_API_KEY=${secret}\n` },
			],
		};
	}

	it("redacts a secret buried in messages[3].content and leaves its siblings alone", () => {
		const out = redactDeep(buildPayload());
		const serialised = JSON.stringify(out);

		expect(
			serialised,
			"the dominant real leak is a .env or ~/.aws/credentials the model read into messages[] " +
				"(02-RESEARCH.md §1.3); if it survives redactDeep it is written to disk verbatim",
		).not.toContain(secret);
		expect(serialised, "the credential was removed but nothing recorded that it had been there").toContain(
			"[redacted:",
		);

		const messages = (out as { messages: { content: string }[] }).messages;
		expect(messages[0]?.content, "a message with no secret must be untouched").toBe("You are a coding agent.");
		expect((out as { model: string }).model, "provenance fields must survive or the dump is unreadable").toBe(
			"deepseek-chat",
		);
		expect((out as { temperature: number }).temperature, "numbers pass through unchanged").toBe(0);
		expect((out as { stream: boolean }).stream, "booleans pass through unchanged").toBe(true);
	});

	it("does not mutate its argument", () => {
		const payload = buildPayload();
		const before = JSON.stringify(payload);
		redactDeep(payload);
		expect(
			JSON.stringify(payload),
			"before_provider_request hands over the LIVE payload; an in-place edit would ship the " +
				"redacted text to the provider instead of to the log",
		).toBe(before);
	});

	it("returns a clean nested payload with its serialisation unchanged", () => {
		const clean = {
			model: "deepseek-chat",
			nested: { a: [1, 2, { b: "ordinary text" }], c: null, d: undefined },
			messages: [{ role: "user", content: "hello" }],
		};
		expect(
			JSON.stringify(redactDeep(clean)),
			"redactDeep must not reorder keys, drop values or mangle a payload that holds no secret",
		).toBe(JSON.stringify(clean));
	});

	it("truncates a hostile object graph instead of recursing without bound", () => {
		let deep: Record<string, unknown> = { leaf: "bottom" };
		for (let i = 0; i < 30; i += 1) {
			deep = { child: deep };
		}

		const out = redactDeep(deep);
		const serialised = JSON.stringify(out);

		expect(
			serialised,
			"a 30-level graph exceeds the depth cap of 24, so the tail must come back as the " +
				"truncation sentinel — unbounded recursion here is a denial of service on the instrument",
		).toContain(TRUNCATION_PLACEHOLDER);
		expect(serialised, "nothing below the cap may be reported as data").not.toContain("bottom");
		expect(
			(out as { child: { child: unknown } }).child.child,
			"the levels above the cap must still be walked, or the cap has eaten the whole payload",
		).toBeTypeOf("object");
	});
});

describe("DIAG-07 — the two holes redactDeep used to have", () => {
	/**
	 * SHORT AND UNREMARKABLE ON PURPOSE.
	 *
	 * On its own it matches NONE of the `SECRET_VALUE_PATTERNS` — that is the whole
	 * point. Shape matching cannot save a credential this plain; only the KEY that
	 * names it can, and the key rule used to fire on a string value only.
	 */
	const SHORT_SECRET = "s3cr3t42";

	it("the secret really is invisible to shape matching, so the key rule is what is under test", () => {
		expect(
			redactString(SHORT_SECRET),
			"if a pattern started matching this value, every case below would pass through the SHAPE " +
				"half of the redactor and prove nothing about the key half. Pick a duller secret rather " +
				"than deleting the assertion",
		).toBe(SHORT_SECRET);
	});

	it("redacts a credential nested UNDER a credential-named key", () => {
		const out = JSON.stringify(
			redactDeep({
				model: "deepseek-chat",
				authorization: { scheme: "Bearer", token: SHORT_SECRET },
				api_key: [SHORT_SECRET],
			}),
		);

		expect(
			out.includes(SHORT_SECRET),
			"a key that SAYS `authorization` or `api_key` is better evidence than any shape " +
				"heuristic, and the rule used to fire only when the value was a string — so " +
				"`{ authorization: { token } }` and `{ api_key: [secret] }` fell through to pattern " +
				"matching, and a credential too short or too unusual for the eleven patterns was " +
				"written to disk in full. Over-redaction is the right way to be wrong here",
		).toBe(false);

		expect(
			out,
			"and something must be recorded in its place, or the dump silently loses the fact that a " +
				"credential was there at all",
		).toContain(TRUNCATION_PLACEHOLDER);

		expect(
			out,
			"the paired positive: the provenance fields around it must survive, or a redactor that " +
				"blanked the whole payload would pass the assertion above",
		).toContain("deepseek-chat");
	});

	it("does not pass a non-plain object through un-walked", () => {
		class Credentialed {
			public note = "harmless";
			public secret = SHORT_SECRET;
			public awsKey = `${["AK", "IA"].join("")}IOSFODNN7EXAMPLE`;
		}

		const out = JSON.stringify(redactDeep({ model: "deepseek-chat", holder: new Credentialed() }));

		expect(
			out.includes(SHORT_SECRET),
			"`isPlainObject` accepts only Object.prototype and null prototypes, so a class instance " +
				"used to come back BY REFERENCE and un-walked — and JSON.stringify still serialises its " +
				"own enumerable properties, so every string inside it reached disk having never seen " +
				"the redactor. The old comment asserted `JSON payloads contain none of the latter`, " +
				"which is an assumption about every current and future adapter made in the one module " +
				"whose failure is a live key in a public repository",
		).toBe(false);

		expect(
			out.includes("IOSFODNN7EXAMPLE"),
			"the AWS-shaped key inside the same instance must be gone too. It would have leaked for " +
				"exactly the same reason — being inside an object the walk never entered",
		).toBe(false);

		expect(out, "and the subtree must be recorded as truncated").toContain(TRUNCATION_PLACEHOLDER);
		expect(out, "with the surrounding plain payload intact").toContain("deepseek-chat");
	});

	it("does not throw on a CIRCULAR non-plain object", () => {
		// The same hole, in its other failure mode: a circular non-plain object used
		// to survive the walk by reference and then make `JSON.stringify` throw inside
		// `appendJsonl` -- which, on the nested path, killed the request being
		// measured (CR-01's trigger list).
		class Looped {
			public self: unknown = undefined;
			public secret = SHORT_SECRET;
		}
		const looped = new Looped();
		looped.self = looped;

		const out = redactDeep({ payload: looped });

		expect(
			() => JSON.stringify(out),
			"the redacted structure must be serialisable. A cycle surviving the walk turns every " +
				"append into a throw, and on the nested path a throwing append used to fail the real " +
				"model request",
		).not.toThrow();

		expect(JSON.stringify(out).includes(SHORT_SECRET), "and the secret inside it is gone").toBe(
			false,
		);
	});

	it("keeps a Date as the string JSON.stringify would have produced", () => {
		// THE NEGATIVE CONTROL FOR THE CHANGE ABOVE. Over-redaction is a failure too,
		// just a quieter one: truncating everything object-like without exception
		// would turn every timestamp in a payload into a sentinel. An ISO timestamp
		// matches no credential shape and is what `JSON.stringify` emits anyway.
		const when = new Date(Date.UTC(2026, 7, 13, 3, 57, 24, 428));
		const out = redactDeep({ createdAt: when, model: "deepseek-chat" }) as {
			createdAt: unknown;
			model: string;
		};

		expect(
			out.createdAt,
			"a Date must survive as its own ISO form. Truncating it would mangle clean data, and " +
				"serialising it to `{}` — which a naive walk of its own enumerable properties yields — " +
				"would lose it entirely",
		).toBe(when.toISOString());

		expect(
			JSON.stringify(out).includes(TRUNCATION_PLACEHOLDER),
			"nothing in this clean payload may be reported as truncated",
		).toBe(false);
	});

	it("leaves null and undefined under a credential-named key alone", () => {
		// `null` means "delete this header" (pi-ai src/types.ts:110). Rewriting it to
		// a placeholder would misreport a deletion as a credential, which is the same
		// reason `redactHeaders` keeps it.
		const out = redactDeep({ authorization: null, "x-api-key": undefined }) as Record<
			string,
			unknown
		>;

		expect(out.authorization, "a deletion marker is not a secret").toBeNull();
		expect(Object.keys(out), "and an absent value stays absent-shaped").toContain("x-api-key");
		expect(out["x-api-key"]).toBeUndefined();
	});
});

describe("DIAG-07 — redactHeaders on resolved provider auth headers", () => {
	const bearer = ["Bearer", "abcdefghij.klmno-pqrst"].join(" ");

	const headers: Record<string, string | null> = {
		Authorization: bearer,
		"X-API-Key": "abc123def456",
		"Cf-Aig-Authorization": "gateway-value",
		"x-session-token": "caught-by-the-regex-half",
		"proxy-authorization": null,
		"user-agent": "pi/0.84.1",
		"http-referer": "https://pi.dev",
	};

	const out = redactHeaders(headers);

	it("names every key the source enumeration found", () => {
		expect(
			REDACTED_HEADER_KEYS.length,
			"the closed list came from an enumeration of pi-ai's auth paths (02-RESEARCH.md §2.4); " +
				"a shrunken list is a header whose value now reaches the log",
		).toBeGreaterThanOrEqual(8);
	});

	it("redacts credential-bearing keys case-insensitively", () => {
		for (const key of ["Authorization", "X-API-Key", "Cf-Aig-Authorization", "x-session-token"]) {
			expect(
				out[key],
				`${key} reached the log with its value intact — header keys arrive in whatever casing ` +
					"the provider used, so the match must be on the lower-cased form",
			).toMatch(/^\[redacted:\d+ chars\]$/);
		}
	});

	it("keeps the length so 'was a credential present' stays answerable", () => {
		expect(
			out.Authorization,
			"the placeholder reports the original length; if it reports its own, the dump silently " +
				"loses the one fact redaction is allowed to keep",
		).toBe(redactionPlaceholder(bearer.length));
	});

	it("leaves a null value as null rather than inventing a placeholder", () => {
		expect(
			out["proxy-authorization"],
			"null means 'delete this header' (pi-ai src/types.ts:110); rewriting it to a placeholder " +
				"would misreport a deletion as a credential",
		).toBeNull();
	});

	it("normalises a non-string, non-null value instead of throwing", () => {
		// [IN-04] The declared type is `Record<string, string | null>`, so this cannot
		// happen -- and a provider or another extension deleting a key by assigning
		// `undefined` rather than `null` makes it happen anyway. Both branches read
		// `value.length`, so it used to throw, and `safeHandler` would then discard
		// the WHOLE wire record for that hook: one loose value and the request
		// disappears from the dump entirely.
		const loose = { authorization: undefined, "x-count": 7 } as unknown as Record<
			string,
			string | null
		>;

		expect(
			() => redactHeaders(loose),
			"a header map carrying anything but a string or null must not take the record down with it",
		).not.toThrow();

		const normalised = redactHeaders(loose);
		expect(
			normalised,
			"both keys must still be PRESENT, normalised to the map's own spelling of `no value here`. " +
				"Dropping them would make the dump claim headers that were sent were not",
		).toEqual({ authorization: null, "x-count": null });
	});

	it("leaves non-credential headers intact", () => {
		expect(out["user-agent"], "attribution headers are not secrets and the dump needs them").toBe("pi/0.84.1");
		expect(out["http-referer"], "attribution headers are not secrets and the dump needs them").toBe(
			"https://pi.dev",
		);
	});

	it("returns a new object rather than editing the caller's", () => {
		expect(headers.Authorization, "before_provider_headers mutates in place; this function must not").toBe(bearer);
	});
});

describe("DIAG-07 — the pattern set is bounded against a hostile input", () => {
	/**
	 * A repeating unit built from the character classes every pattern uses,
	 * arranged so that not one of them completes. That is the expensive path:
	 * a matcher only backtracks on inputs that nearly match.
	 */
	const UNIT = "-----BEGIN AAAA Bearer, sk-AKIA ghp_ glpat- xoxb- AIza pt- ABSK ://a: aws_secret_access_key password ";

	it("redacts a 1 MB adversarial string in under two seconds", () => {
		const adversarial = UNIT.repeat(Math.ceil(1_000_000 / UNIT.length));
		expect(adversarial.length, "the input must actually be about a megabyte").toBeGreaterThanOrEqual(1_000_000);

		const start = Date.now();
		const out = redactString(adversarial);
		const elapsed = Date.now() - start;

		expect(
			elapsed,
			`redactString took ${elapsed} ms on a 1 MB input. An unbounded pattern on a large ` +
				"assistant message is a denial of service on the instrument itself — find the entry " +
				"in SECRET_VALUE_PATTERNS with a nested quantifier or an unanchored .* and bound it",
		).toBeLessThan(2000);

		expect(
			out,
			"the adversarial unit is built to nearly-match and never match; if anything was replaced " +
				"the timing above measured the cheap path and proves nothing about backtracking",
		).toBe(adversarial);
	});
});

describe("DIAG-07 — camelCase credential keys", () => {
	it("treats apiKey, accessToken and secretAccessKey as credential keys, but not maxTokens", () => {
		const secret = ["s3c", "r3t42"].join("");
		const out = redactDeep({ apiKey: secret, accessToken: secret, secretAccessKey: secret, maxTokens: 5 }) as Record<string, unknown>;
		expect(JSON.stringify(out)).not.toContain(secret);
		expect(out.maxTokens).toBe(5);
	});
});

describe("the two consumers: logs mask by name, model inputs by shape only", () => {
	const code = [
		"const token = req.headers.authorization;",
		"if (token === undefined) return;",
		"password: string;",
		"secret: process.env.JWT_SECRET",
		"password = var.db_password",
		"// the Bearer token is checked upstream",
	].join("\n");

	it("the shape rules come first in the log table and the name rules last", () => {
		expect(SECRET_VALUE_PATTERNS).toEqual([...SHAPE_PATTERNS, ...LOG_ONLY_PATTERNS]);
	});

	it("redactForModel leaves code that names a credential byte-identical", () => {
		expect(redactForModel(code)).toBe(code);
	});

	it("redactString still masks those names in a log", () => {
		expect(redactString(code)).toContain("[redacted:");
	});

	it("redactForModel still masks every shape sample", () => {
		for (const sample of SECRET_SAMPLES.slice(0, SHAPE_PATTERNS.length)) {
			expect(redactForModel(`x ${sample.value} y`), sample.label).not.toContain(sample.value);
		}
	});
});

describe("every rule is linear-time", () => {
	const SIZE = 200_000;
	const fill = (unit: string): string => unit.repeat(Math.ceil(SIZE / unit.length));
	// Near-matches are the expensive inputs, so each rule gets every prefix of its own sample three ways,
	// plus these units, which defeated earlier versions of the table.
	const HOSTILE_UNITS = ["eyJ", "-u=", " -u =", "--user=", "mysql ", "://a:", "token", 'token="', "-----BEGIN ", "bearer ", "a:"];
	const hostileFor = (sample: string): string[] => {
		const out: string[] = [];
		for (let k = 1; k <= sample.length; k++) {
			const prefix = sample.slice(0, k);
			out.push(fill(prefix), prefix + (sample[k - 1] as string).repeat(SIZE), ` ${prefix}${"=".repeat(SIZE)}`);
		}
		for (const unit of HOSTILE_UNITS) out.push(fill(unit), unit + (unit.at(-1) as string).repeat(SIZE), unit + "a".repeat(SIZE));
		return out;
	};

	SECRET_VALUE_PATTERNS.forEach((pattern, index) => {
		const sample = SECRET_SAMPLES[index] as Sample;
		it(`rule ${index} (${sample.label}) scans every 200 KB hostile input in under 100 ms`, () => {
			let worst = 0;
			let worstInput = "";
			for (const input of hostileFor(sample.value)) {
				const start = performance.now();
				input.replace(pattern, "");
				const elapsed = performance.now() - start;
				if (elapsed > worst) [worst, worstInput] = [elapsed, input];
			}
			expect(worst, `slowest input starts ${JSON.stringify(worstInput.slice(0, 24))}`).toBeLessThan(100);
		});
	});

	const whole: readonly (readonly [string, string])[] = [
		["a keyword run", "token".repeat(40_000)],
		["a keyword run with separators", "token_".repeat(34_000)],
		["unclosed quoted values", 'token="abc '.repeat(20_000)],
		["a long spacing run", `token${" ".repeat(200_000)}`],
		["a run of JWT starts", "eyJ".repeat(100_000)],
		["a run of curl user flags", "-u=".repeat(70_000)],
		["a curl flag before a run of equals signs", ` -u ${"=".repeat(200_000)}`],
	];
	for (const [label, input] of whole) {
		it(`redactString masks 200 KB of ${label} in under 100 ms`, () => {
			expect(input.length).toBeGreaterThanOrEqual(200_000);
			const start = performance.now();
			redactString(input);
			expect(performance.now() - start).toBeLessThan(100);
		});
	}
});

describe("a credential-named value is masked whole, at any length", () => {
	const long = ["Fwo", "GZXIvYXdz"].join("").repeat(60);
	const cases: readonly (readonly [string, string])[] = [
		["a 600-character double-quoted value", `password: "${long}"`],
		["a 600-character JSON value", `"client_secret": "${long}"`],
		["a 600-character unquoted value", `TOKEN=${long}`],
		["a value on the next line", `password:\n  ${long}`],
		["an unclosed quoted value", `aws_session_token = "${long}`],
	];
	for (const [label, input] of cases) {
		it(`masks ${label}`, () => {
			const out = redactString(`x ${input}\ny`);
			expect(out).not.toContain(long.slice(-12));
			expect(out).toContain("[redacted:");
		});
	}
});
