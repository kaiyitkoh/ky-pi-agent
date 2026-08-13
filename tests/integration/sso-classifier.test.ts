/**
 * PROV-05 — an expired AWS credential names the exact command, and is attempted
 * exactly once.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS, AND WHAT IT IS NOT — read this before quoting a green run
 * ---------------------------------------------------------------------------
 * Every "SSO error" below is a FIXTURE THIS REPOSITORY WROTE. The six strings in
 * `schema.ts` are drawn from AWS's exception names and message wording, but no
 * live expiry produced them: this machine holds no credentials and issues no
 * provider request, and the provider here is `fauxProvider`. Whether a REAL
 * expiry on the work laptop produces a string the matcher recognises is the one
 * thing this file cannot answer. It is folded into `docs/RUNBOOK.md` RB-03-03's
 * expected output and is **OUTSTANDING**. [threat T-03-08-06]
 *
 * PROV-05 itself is `[FAUX]` and is discharged here — the mechanism is fully
 * verifiable offline. What stays outstanding is the fixture-fidelity question
 * above, and RB-03-03 is where it is recorded rather than assumed away.
 *
 * ---------------------------------------------------------------------------
 * THE HONEST CORRECTION THIS FILE IS BUILT AROUND
 * ---------------------------------------------------------------------------
 * All six credential strings are ALREADY non-retryable under Pi 0.84.1
 * [VERIFIED: executed 2026-08-13; 03-RESEARCH.md §Q4.3, re-executed while
 * writing this file]. So `callCount === 1` on an SSO run is NOT evidence that
 * the rewrite made it non-retryable — it would be true with this extension
 * uninstalled. Two things make the assertion worth making anyway, and both are
 * cases below:
 *
 *   1. The retryable NEGATIVE CONTROL. A 503-shaped error in the same harness
 *      is retried (`callCount === 2`), which is the live oracle proving the
 *      session retries when it should and that `1` is a measurement rather than
 *      a property of a harness that never retries anything.
 *   2. The DIRECTION table. What the rewrite must not do is re-admit the
 *      message to Pi's retryable pattern by carrying the original SDK text
 *      along (Trap T4). Case 5 asserts `isRetryableAssistantError` over the
 *      rewritten text for all six, AND records Pi's verdict on the ORIGINAL
 *      text beside it, so the table says what was already true instead of
 *      claiming credit for it.
 *
 * ---------------------------------------------------------------------------
 * HOW THE SURFACED MESSAGE IS OBSERVED
 * ---------------------------------------------------------------------------
 * The probe extension registers its own `message_end` AFTER the classifier's,
 * so it sees the chained value [VERIFIED: pi 0.84.1
 * dist/core/extensions/runner.js:610-648 — each handler receives
 * `{ ...event, message: currentMessage }`], and an `agent_end` hook records the
 * agent's own message list. Both are captured because they answer different
 * questions: `agent_end` is what the session ENDED with, i.e. what the user
 * sees and what `_handlePostAgentRun` hands to the retry classifier
 * [VERIFIED: dist/core/agent-session.js:425-438, :758-766 — the replacement is
 * applied in place, so agent state, listeners and persistence all hold the
 * same mutated object].
 *
 * The extension loads at USER scope through `extensionSource`: project-scoped
 * `.pi/extensions` is gated behind project trust, which resolves `false`
 * headless with no UI to answer the prompt, and a silently absent extension is
 * a green run over nothing (`tests/helpers/session.ts:146-161`).
 *
 * ---------------------------------------------------------------------------
 * WHICH LEG OF THE PROFILE CHAIN THIS EXERCISES
 * ---------------------------------------------------------------------------
 * The name is supplied through the AMBIENT `AWS_PROFILE`, scoped and restored
 * around each run. The faux session builds its own agent directory before the
 * callback runs, so there is no seam to plant an `auth.json` in — and there
 * does not need to be one: that the STORED credential wins over the ambient
 * variable is proven offline, in both directions, by
 * `tests/unit/bedrock-auth.test.ts` cases 2 and 4. What this file proves is the
 * part that file cannot: that the resolved name reaches the surfaced message.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssistantMessage, FauxResponseStep } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, isRetryableAssistantError } from "@earendil-works/pi-ai";

import { beforeAll, describe, expect, it } from "vitest";

import {
	AWS_PROFILE_ENV,
	AWS_SSO_LOGIN_PREFIX,
	NON_SSO_FIXTURES,
	PROFILE_PLACEHOLDER,
	PROFILE_TEMPLATE_SENTINEL,
	RETRYABLE_CONTROL_FIXTURE,
	SSO_DIAGNOSTIC_ORIGINAL_KEY,
	SSO_DIAGNOSTIC_TYPE,
	SSO_FIXTURES,
} from "../../.pi/extensions/providers/schema.ts";
import { SSO_PATTERNS } from "../../.pi/extensions/providers/sso.ts";
import { repoRoot } from "../helpers/git.ts";
import { withFauxSession } from "../helpers/session.ts";

/** Absolute path of the providers extension this repository ships. */
const EXTENSION_ENTRY = `${repoRoot()}/.pi/extensions/providers/index.ts`;

/**
 * The profile name every resolved run supplies.
 *
 * Distinctive on purpose: it appears in no fixture, in no Pi source and in no
 * other test, so finding it in a surfaced message can only mean the handler
 * resolved it and interpolated it.
 */
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
 * An extension that IS the shipped classifier, plus two observers.
 *
 * The observers append to files in `cwd` rather than incrementing a variable:
 * jiti gives the loaded extension its own module registry, so an in-process
 * counter this file could read would never move (Phase 2's finding, 02-05).
 *
 * The `message_end` observer is registered AFTER `providers(pi)`, which is what
 * makes it see the replacement rather than the original.
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

/**
 * Set an environment variable for the duration of `fn`, then put it back.
 *
 * A key that did not exist beforehand is DELETED, never set to `""` — Pi's
 * Bedrock chain is `credential.env.AWS_PROFILE ?? ambient AWS_PROFILE` and an
 * empty string satisfies `??` while naming no profile, which is Trap T8. Copied
 * from `tests/helpers/models.ts`, where the same reasoning is written out.
 */
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

/** Drive one session whose first provider response is an error carrying `errorText`. */
async function drive(options: {
	errorText: string;
	profile: string | undefined;
	/** Extra scripted responses after the error, for the retrying control. */
	then?: FauxResponseStep[];
}): Promise<Capture> {
	return await withEnv(AWS_PROFILE_ENV, options.profile, async () =>
		withFauxSession(
			{
				extensionSource: probeSource(),
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
 * Values that pass every SHAPE bound and are still not profile names.
 *
 * The unedited auth-template placeholder is 29 characters drawn entirely from
 * the AWS profile-name charset, so NO tightening of `SAFE_PROFILE_NAME` can
 * reject it — only the equality check added for CR-01 does. Interpolating it
 * produces `aws sso login --profile REPLACE_WITH_AWS_PROFILE_NAME`, a
 * copy-pasteable command that cannot work, with the RB-03-03 pointer
 * suppressed. That is the exact dead end `PROFILE_PLACEHOLDER` exists to
 * expose, reached by the one value the template itself ships.
 */
const NOT_A_PROFILE: ReadonlyArray<readonly [string, string]> = [
	["the unedited auth-template placeholder", PROFILE_TEMPLATE_SENTINEL],
];

let ssoRuns: SsoRun[];
let placeholderRun: Capture;
let notAProfileRuns: { label: string; value: string; capture: Capture }[];
let control: Capture;

describe("PROV-05 — the SSO classifier on a live in-memory session", () => {
	beforeAll(async () => {
		ssoRuns = [];
		for (const fixture of SSO_FIXTURES) {
			ssoRuns.push({
				fixture,
				capture: await drive({ errorText: fixture.text, profile: FIXTURE_PROFILE }),
			});
		}

		// The paired positive for "the placeholder is absent": with no profile
		// resolvable at all, the placeholder MUST appear. Without this run,
		// asserting its absence above would be satisfied by a string that never
		// occurs under any condition.
		placeholderRun = await drive({ errorText: SSO_FIXTURES[0].text, profile: undefined });

		notAProfileRuns = [];
		for (const [label, value] of NOT_A_PROFILE) {
			notAProfileRuns.push({
				label,
				value,
				capture: await drive({ errorText: SSO_FIXTURES[0].text, profile: value }),
			});
		}

		// The negative control. Retryable on purpose, and scripted with a second
		// response so the retry has somewhere to land.
		control = await drive({
			errorText: RETRYABLE_CONTROL_FIXTURE.text,
			profile: FIXTURE_PROFILE,
			then: [fauxAssistantMessage("recovered")],
		});
	});

	it("captured something at all (guards against a vacuous pass)", () => {
		// EVERY case below reads one of these captures. An empty one means the
		// probe never ran, which means the extension never loaded, which means
		// every "contains"/"does not contain" assertion below is about nothing.
		expect(
			ssoRuns.length,
			"no SSO fixture was driven at all, so the whole file asserts nothing",
		).toBe(SSO_FIXTURES.length);

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

			// THE REPLACEMENT MUST BE A COMPLETE MESSAGE. The runner applies it by
			// deleting every key of the live object and `Object.assign`-ing the
			// replacement onto it [VERIFIED: pi 0.84.1
			// dist/core/agent-session.js:425-438], so a patch object would leave a
			// message with an errorMessage and nothing else — no role for the
			// renderer, no usage for `/budget`, no model for the turns row. These
			// four fields are the ones a patch would silently erase.
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
		// TRAP T3: non-retryability is proven by ATTEMPTS, never by reading the
		// classifier. `state.callCount++` is the first statement of faux's
		// `stream()` [pi-ai 0.84.1 src/providers/faux.ts:506], so this counts
		// attempts and not successes.
		//
		// Read this WITH case 6. On its own a `1` here is weak: all six strings
		// are already non-retryable under Pi 0.84.1, so this would hold with the
		// extension uninstalled. Case 6 drives a retryable error through the same
		// harness and gets a `2`, which is what makes this number a measurement.
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
		// THE PAIRED POSITIVE for case 1's `not.toContain`. If the placeholder
		// could never appear under any condition, asserting its absence would be
		// a sentence about a string this repository happens not to emit.
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
		// THE FLOOR THAT MAKES THIS A TABLE RATHER THAN A LOOP OVER ITSELF. An
		// emptied NOT_A_PROFILE would iterate nothing and report green, which is
		// the same disarm-by-deletion the guard in 03-11 was written to close.
		expect(
			notAProfileRuns.length,
			"no not-a-profile value was driven, so every assertion below iterates nothing. " +
				"The table is the whole case; a truncated one removes coverage without turning " +
				"anything red",
		).toBeGreaterThanOrEqual(NOT_A_PROFILE.length);
		expect(NOT_A_PROFILE.length).toBeGreaterThanOrEqual(1);

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
		// TABLE-DRIVEN OVER ALL SIX, both columns. The second column is the
		// honest correction: `retryableToday` records Pi 0.84.1's verdict on the
		// ORIGINAL string, so this case cannot be read as "the rewrite made these
		// non-retryable" when it did not. If a Pi bump moves one of them, this
		// goes red and names which claim expired rather than quietly passing.
		//
		// FIRST, THE ORACLE. Every assertion below is a `false` from
		// `isRetryableAssistantError`, so a predicate that returned `false` for
		// everything — a Pi change, a bad import, a message shape it does not
		// recognise — would make this whole case vacuously green. The control's
		// unmodified 503 is the one string in this file that must come back `true`.
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
		// WITHOUT THIS THE WHOLE FILE IS SATISFIED BY A HANDLER THAT REWRITES
		// EVERYTHING. It is also the live oracle for case 2: a session that never
		// retries anything would report `callCount === 1` for every fixture and
		// prove nothing about non-retryability.
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

	it("case 7 — the exclusion rule holds pattern by pattern, in both directions", () => {
		// THE RULE THAT KEEPS CASE 6 FROM BEING ONE LUCKY STRING. Asserted over
		// the pattern table itself, so a future pattern that overreaches fails
		// here rather than in production.
		expect(
			SSO_PATTERNS.length,
			"the pattern table is empty, so the classifier matches nothing and every SSO case above " +
				"would have to be failing already — assert the set non-empty before looping over it",
		).toBeGreaterThanOrEqual(5);

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
