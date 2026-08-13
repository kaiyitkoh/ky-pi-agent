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
	redactString,
	redactionPlaceholder,
} from "../../.pi/extensions/diagnostics/redact.ts";

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
	{ label: "Slack bot token", value: ["xoxb", "123456789012"].join("-") },
	{ label: "Google API key", value: "AIza" + "b".repeat(35) },
	{ label: "Qoder personal access token", value: ["pt", "abcdef0123456789"].join("-") },
	{ label: "PEM private key header", value: ["-----BEGIN ", "RSA ", "PRIVATE KEY", "-----"].join("") },
	{ label: "bearer credential", value: ["Bearer", "abcdefghij.klmno-pqrst"].join(" ") },
	{
		label: "aws_secret_access_key assignment",
		value: `${["aws", "secret", "access", "key"].join("_")} = wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLE`,
	},
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
	const UNIT = "-----BEGIN AAAA Bearer sk-AKIA ghp_ xoxb- AIza pt- aws_secret_access_key ";

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
