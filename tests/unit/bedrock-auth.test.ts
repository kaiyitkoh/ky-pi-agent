/**
 * PROV-04 — the Bedrock credential path Pi actually uses, proven offline in both
 * directions.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS, AND WHAT IT IS NOT — the [RUNBOOK] honesty paragraph
 * ---------------------------------------------------------------------------
 * This file proves Pi's *resolution* of a stored `AWS_PROFILE`: that an
 * `auth.json` entry of the shape this repository ships resolves as a Bedrock
 * credential, that the file beats the ambient variable, that nothing resolves
 * when neither is present, and that an empty placeholder is an outage.
 *
 * It says NOTHING about whether a live SSO token resolves on the work laptop.
 * No request is issued, no AWS SDK is loaded, no profile store is read. The
 * live half is `RB-03-03` in `docs/RUNBOOK.md`, status **OUTSTANDING**, and a
 * green run here may never be used to mark PROV-04 as passing (Trap T12).
 *
 * The gap is the entire reason PROV-04 is a `[RUNBOOK]` requirement:
 * `aws sso login` sets **no** environment variable. It writes a token cache
 * under the AWS CLI's own SSO cache directory in the user's home, so without
 * `AWS_PROFILE` literally set Pi reports no Bedrock credentials even though the
 * SDK's own chain would resolve fine. `credential.env.AWS_PROFILE` is checked
 * before process env, survives a fresh shell, and contains no secret — which is
 * why it is templatable in a public repository.
 *
 * ---------------------------------------------------------------------------
 * CLOSED DOORS — recorded so they are not re-derived
 * ---------------------------------------------------------------------------
 *   - `pi auth login` → Amazon Bedrock → **"Existing AWS credential chain"**
 *     stores `{ type: "api_key" }` with no `key` and no `env`
 *     [VERIFIED: pi-ai 0.84.1 src/providers/amazon-bedrock.ts:46-52]. That is a
 *     stored no-op that *looks* like configuration. The persisting choice is
 *     **"AWS profile"**, which is what writes the `env.AWS_PROFILE` this file
 *     tests.
 *   - There is no EC2 instance-profile / IMDS branch anywhere in `resolve()`
 *     [VERIFIED: same file, :54-79 — the full chain is `credential.key` →
 *     `AWS_BEARER_TOKEN_BEDROCK` → `credential.env.AWS_PROFILE ?? ambient
 *     AWS_PROFILE` → access keys → the two container URIs → web identity →
 *     `undefined`]. Do not write a check that expects one.
 *
 * ---------------------------------------------------------------------------
 * TWO LITERALS DELIBERATELY NOT SPELLED
 * ---------------------------------------------------------------------------
 * The acceptance gate for this file greps it for the AWS SDK's npm scope and
 * for the AWS CLI's dot-directory name and requires both counts to be zero, so
 * that "this test never touches the developer's real credentials" is a machine
 * check rather than a promise. A comment is text like any other, so both are
 * described here rather than written. The meaning survives; neither literal
 * does. (Same reasoning, same house precedent, as the out-of-scope vendor name
 * in `.pi/templates/models-template.json`.)
 *
 * ---------------------------------------------------------------------------
 * ISOLATION — why every case blanks the whole chain
 * ---------------------------------------------------------------------------
 * Pi's auth context treats an empty or whitespace-only variable as absent
 * [VERIFIED: pi-ai 0.84.1 dist/auth/context.js — `defaultProviderAuthContext`
 * returns `undefined` unless `value.trim().length > 0`], so blanking a variable
 * through `withModelsConfig`'s `env` option is how this file says "the
 * developer's machine does not have this set" without reading, mutating or
 * reporting what the developer's machine actually has. Every one of the seven
 * variables in the chain is blanked in every case; a case that cares about one
 * of them overrides exactly that one. Without this, a run on the work laptop
 * would resolve through an ambient bearer token or an ambient profile and
 * report the developer's machine state as a property of this repository.
 * [threat T-03-05-01]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { describe, expect, it } from "vitest";

import { resolveProfileName } from "../../.pi/extensions/providers/index.ts";
import {
	AWS_PROFILE_ENV,
	PROFILE_PLACEHOLDER,
	PROFILE_TEMPLATE_SENTINEL,
	TEMPLATE_SENTINEL_PREFIX,
} from "../../.pi/extensions/providers/schema.ts";
import { repoRoot } from "../helpers/git.ts";
import { withModelsConfig } from "../helpers/models.ts";

/** Pi's built-in provider id. Not defined by this repo's models template. */
const BEDROCK = "amazon-bedrock";

/**
 * What a template value must look like to be recognised as an unedited one.
 *
 * Built from the exported prefix rather than typed out, so the pattern cannot
 * drift from the literal `bin/bootstrap.sh` and the SSO classifier both key on.
 */
const SENTINEL_SHAPE = new RegExp(`^${TEMPLATE_SENTINEL_PREFIX}`);

/** The artifact under test, at the filename Trap T1 forced. */
const AUTH_TEMPLATE_PATH = join(repoRoot(), ".pi", "templates", "auth-template.json");

/**
 * The shipped template, parsed. Read from disk on every call rather than
 * memoised into a literal: the point of case 1 is that the *committed bytes*
 * resolve, so a hand-copied fixture would assert this file's own typing.
 */
function authTemplate(): Record<string, unknown> {
	return JSON.parse(readFileSync(AUTH_TEMPLATE_PATH, "utf-8")) as Record<string, unknown>;
}

/** The profile placeholder the template actually ships, whatever it is today. */
function templatePlaceholder(): unknown {
	const entry = authTemplate()[BEDROCK] as { env?: Record<string, unknown> } | undefined;
	return entry?.env?.AWS_PROFILE;
}

/**
 * Every environment variable Bedrock's `resolve()` consults, in its own order
 * [VERIFIED: pi-ai 0.84.1 src/providers/amazon-bedrock.ts:54-79]. Listed in
 * full, not just `AWS_PROFILE`: a case that blanked only the variable it talks
 * about would still resolve through an ambient bearer token on a machine that
 * has one, and would then pass for the wrong reason.
 */
const AWS_CHAIN_VARIABLES = [
	"AWS_BEARER_TOKEN_BEDROCK",
	"AWS_PROFILE",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
	"AWS_CONTAINER_CREDENTIALS_FULL_URI",
	"AWS_WEB_IDENTITY_TOKEN_FILE",
] as const;

/** The whole chain blanked, then the caller's overrides applied on top. */
function scopedAwsEnv(overrides: Record<string, string> = {}): Record<string, string> {
	const env: Record<string, string> = {};
	for (const name of AWS_CHAIN_VARIABLES) {
		env[name] = "";
	}
	return { ...env, ...overrides };
}

/**
 * Distinctive fixture values. Distinct from each other on purpose: case 2's
 * whole claim is precedence, and two equal values would satisfy it whichever
 * source won.
 */
const PROFILE_FROM_FILE = "kypi-fixture-profile-from-auth-json";
const PROFILE_FROM_AMBIENT = "kypi-fixture-profile-from-environment";

/**
 * `amazon-bedrock` is a built-in provider, so this file needs no models entry
 * for it — and deliberately declares none. PROV-06 forbids redefining a
 * catalogued model, and a Bedrock block here would be exactly that drift.
 */
const NO_MODELS_CONFIG = {} as const;

describe("PROV-04 — Bedrock credential resolution from auth.json (offline; RB-03-03 is the live half)", () => {
	it("guard — the shipped template really carries an amazon-bedrock entry", () => {
		const template = authTemplate();

		expect(
			Object.keys(template).length,
			"the shipped auth template parsed to zero entries. Every case below resolves a " +
				"provider id out of this document, so an empty one turns the whole file into a " +
				"pass that verified nothing -- assert it non-empty before using it, never after",
		).toBeGreaterThan(0);

		expect(
			Object.hasOwn(template, BEDROCK),
			`the shipped auth template has no \`${BEDROCK}\` entry, so case 1 below would be ` +
				"asserting that Pi resolves a credential this repository does not ship. PROV-04's " +
				"whole mechanism is that entry; if it was renamed, rename it here too rather than " +
				"softening the assertion",
		).toBe(true);
	});

	it("case 1 — the shipped auth-template.json resolves as a stored Bedrock credential", async () => {
		await withModelsConfig(
			{ models: NO_MODELS_CONFIG, auth: authTemplate(), env: scopedAwsEnv() },
			async (handle) => {
				const result = await handle.registry.getProviderAuth(BEDROCK);

				expect(
					result,
					"Pi resolved NO credential from the auth template this repository ships. That " +
						"is not a cosmetic failure: it means a fresh clone that installs this file " +
						"gets `pi` reporting no Bedrock credentials, which is the exact symptom " +
						"PROV-04 exists to prevent. The template is a valid credential document " +
						"only if this resolves",
				).toBeDefined();

				expect(
					result?.source,
					"the credential must be reported as coming from the stored file. Any other " +
						"source string means the resolution fell through the auth.json branch and " +
						"was satisfied by something on this machine instead -- the assertion would " +
						"then be about the developer's environment, not about the shipped template",
				).toBe("stored credential");

				expect(
					result?.env?.AWS_PROFILE,
					"the resolved profile name must be the one the template ships. Pi returns " +
						"`credential.env` verbatim on this branch, so a different value means the " +
						"template was not the document that answered",
				).toBe(templatePlaceholder());
			},
		);
	});

	it("case 1b -- the shipped placeholder is recognisably a placeholder", () => {
		// WHY THE ROUND TRIP ABOVE IS NOT ENOUGH. Case 1 feeds `authTemplate()` in
		// and asserts the result equals `templatePlaceholder()`, which re-reads the
		// SAME file. Both sides derive from one source, so the assertion is
		// "whatever the template says, Pi echoed it back" -- true for ANY value,
		// including a plausible-looking profile name. It does prove one real
		// property (Pi returns `credential.env` verbatim on that branch) so it is
		// not vacuous, but it is not the assertion this file needs, and it is why
		// the CR-01 hazard sat here unnoticed: case 5 asserts the placeholder is
		// non-empty and nothing asserts anything else about it. [WR-08]
		const placeholder = templatePlaceholder();

		expect(
			typeof placeholder,
			"the template's env.AWS_PROFILE is not a string, so Pi would hand a non-string to " +
				"its Bedrock resolver and the assertion below is about the wrong kind of value",
		).toBe("string");

		expect(
			SENTINEL_SHAPE.test(placeholder as string),
			`the shipped placeholder ${JSON.stringify(placeholder)} is not recognisably a ` +
				"placeholder. It must be, for two independent reasons: (a) an installed copy WINS " +
				"over the ambient AWS_PROFILE (pi-ai amazon-bedrock.js:64), so a value that merely " +
				"looks like a profile name silently breaks Bedrock on a machine where it already " +
				"worked; (b) bin/bootstrap.sh withholds template entries by exactly this prefix, " +
				"and the SSO classifier rejects this exact string before interpolating it into a " +
				"copy-pasteable command. Renaming it here without renaming it there re-opens both " +
				"[WR-08, CR-01]",
		).toBe(true);

		expect(
			placeholder,
			"the placeholder must be the literal the extension checks for. Two spellings of one " +
				"sentinel is how the classifier stops recognising the value the template ships",
		).toBe(PROFILE_TEMPLATE_SENTINEL);
	});

	it("case 2 — the profile comes from the file, not from the environment", async () => {
		await withModelsConfig(
			{
				models: NO_MODELS_CONFIG,
				auth: { [BEDROCK]: { type: "api_key", env: { AWS_PROFILE: PROFILE_FROM_FILE } } },
				env: scopedAwsEnv({ AWS_PROFILE: PROFILE_FROM_AMBIENT }),
			},
			async (handle) => {
				const result = await handle.registry.getProviderAuth(BEDROCK);

				expect(
					result?.env?.AWS_PROFILE,
					`the file said ${PROFILE_FROM_FILE} and the environment said ` +
						`${PROFILE_FROM_AMBIENT}; the file must win. This is precedence, not ` +
						"presence: the reason auth.json can carry the profile at all is that Pi " +
						"consults it BEFORE process env, so a fresh shell with no exported variable " +
						"still authenticates. If the environment wins here, the whole design " +
						"reduces to `export AWS_PROFILE=...` in a dotfile",
				).toBe(PROFILE_FROM_FILE);

				expect(
					result?.source,
					"a profile supplied by the file must be reported as a stored credential. " +
						'Reporting "AWS_PROFILE" would mean the ambient variable answered and the ' +
						"previous assertion passed by coincidence of the two values",
				).toBe("stored credential");
			},
		);
	});

	it("case 3 — the negative control: no entry and no ambient variable resolves nothing", async () => {
		// Without this case, a resolver that returned a credential unconditionally
		// -- a stub, a wrong provider id, a chain that fell through to something on
		// this machine -- would satisfy cases 1 and 2 perfectly. [threat T-03-05-03]
		await withModelsConfig(
			{ models: NO_MODELS_CONFIG, auth: { dashscope: { type: "api_key", key: "$KYPI_UNSET" } }, env: scopedAwsEnv() },
			async (handle) => {
				const result = await handle.registry.getProviderAuth(BEDROCK);

				expect(
					result,
					"Pi resolved a Bedrock credential with no auth.json entry and every variable " +
						"in the chain blank. Something answered that this file did not supply, so " +
						"the positive cases above prove nothing about the mechanism they claim to " +
						"test. Check that the environment scoping still covers the whole chain " +
						"before assuming Pi changed",
				).toBeUndefined();
			},
		);
	});

	it("case 4 — the paired positive: an ambient AWS_PROFILE alone still resolves", async () => {
		// Paired with case 3 so that "absent" is proven to mean absent rather than
		// broken: the same construction, the same blanked chain, one variable set.
		await withModelsConfig(
			{ models: NO_MODELS_CONFIG, env: scopedAwsEnv({ AWS_PROFILE: PROFILE_FROM_AMBIENT }) },
			async (handle) => {
				const result = await handle.registry.getProviderAuth(BEDROCK);

				expect(
					result,
					"an exported AWS_PROFILE with no auth.json at all must still resolve. If it " +
						"does not, case 3's `undefined` is not evidence of an absent credential -- " +
						"it is evidence that this test's environment scoping breaks resolution " +
						"outright, and the negative control is vacuous",
				).toBeDefined();

				expect(
					result?.source,
					"the ambient branch must report itself as the ambient branch. Pi returns " +
						'`credential?.env` on this path, which is undefined here, so `source` is ' +
						"the only signal distinguishing it from the stored-credential branch",
				).toBe("AWS_PROFILE");
			},
		);
	});

	it("case 5 — Trap T8: an empty-string env.AWS_PROFILE defeats the ambient variable", async () => {
		// `credential?.env?.AWS_PROFILE ?? (await env("AWS_PROFILE"))`: `??` falls
		// through on null/undefined ONLY, so `""` is "present" and the ambient
		// variable is never consulted -- and `""` is then falsy, so the branch is
		// not taken at all and resolution falls off the end of the chain.
		// [VERIFIED: pi-ai 0.84.1 src/providers/amazon-bedrock.ts:65-71]
		await withModelsConfig(
			{
				models: NO_MODELS_CONFIG,
				auth: { [BEDROCK]: { type: "api_key", env: { AWS_PROFILE: "" } } },
				env: scopedAwsEnv({ AWS_PROFILE: PROFILE_FROM_AMBIENT }),
			},
			async (handle) => {
				const result = await handle.registry.getProviderAuth(BEDROCK);

				expect(
					result?.env?.AWS_PROFILE,
					`the environment said ${PROFILE_FROM_AMBIENT} and an empty placeholder in the ` +
						"file swallowed it. If this ever equals the ambient value, `??` has started " +
						"treating the empty string as absent and the shipped placeholder could " +
						"safely be blank",
				).not.toBe(PROFILE_FROM_AMBIENT);

				expect(
					result,
					"an empty `env.AWS_PROFILE` must resolve NOTHING even with a perfectly good " +
						"ambient AWS_PROFILE exported. This is why the shipped placeholder is a " +
						"non-empty literal: a blank one would present to the user as a Bedrock " +
						"outage -- `pi` reporting no credentials on a machine where `aws sso login` " +
						"just succeeded -- rather than as a file they forgot to edit. " +
						"[threat T-03-05-04]",
				).toBeUndefined();
			},
		);

		// The demonstration above and the shipped artifact are only linked if the
		// shipped placeholder is asserted here too. Otherwise this case proves a
		// hazard nobody has checked the template against.
		const placeholder = templatePlaceholder();
		expect(
			typeof placeholder === "string" && placeholder.length > 0,
			"the shipped auth template's `env.AWS_PROFILE` placeholder is empty or missing. " +
				"The case immediately above just demonstrated what that costs: the entry wins " +
				"over the ambient variable through `??` and then resolves nothing at all. Ship a " +
				`non-empty literal the user is meant to replace (it is ${JSON.stringify(placeholder)} today)`,
		).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Case 6 — WR-03: the HARNESS mirrors Pi's order, asserted directly
	// -------------------------------------------------------------------------
	// Cases 2 and 4 prove PI's order. Nothing proved that the message PROV-05
	// surfaces follows it, and it is the message the user acts on: a laptop with
	// `export AWS_PROFILE=personal` and a stored Bedrock credential naming `work`
	// has Pi dialling `work` while an inverted handler prints `aws sso login
	// --profile personal`. The user re-authenticates the profile that did not
	// fail, the next turn fails identically, and PROV-05 has made the failure
	// MORE confusing than the raw SDK string. Verified: swapping the two lines of
	// `resolveProfileName` left the whole suite at 649/649 green.
	//
	// WHY A STUB AND NOT THE SESSION. `tests/integration/sso-classifier.test.ts`
	// reaches the ambient branch on every single run — `withFauxSession` aims
	// `ModelRuntime.create` at an `auth.json` that does not exist and faux's own
	// auth resolves empty — and since the WR-05 fix the faux provider is
	// registered under `amazon-bedrock`, which SHADOWS Pi's real Bedrock
	// resolver, so `getProviderAuth("amazon-bedrock")` cannot be made to answer
	// through that seam at all. `resolveProfileName` reads nothing but
	// `ctx.modelRegistry.getProviderAuth`, so a stub covers both branches with no
	// session, no temp directory and no faux provider. [WR-03]

	/** Every call `resolveProfileName` made, so a wrong provider id cannot hide. */
	interface StubbedRegistry {
		ctx: ExtensionContext;
		asked: string[];
	}

	/**
	 * An `ExtensionContext` that is nothing but `modelRegistry.getProviderAuth`.
	 *
	 * `stored === undefined` means "no credential for this provider", which is
	 * what Pi's registry returns when `auth.json` has no entry. Any provider id
	 * other than Bedrock's answers `undefined` too, so a handler that asked for
	 * the wrong provider would fall through to the ambient branch and the
	 * precedence assertion would fail rather than pass by coincidence.
	 */
	function stubCtx(stored: string | undefined): StubbedRegistry {
		const asked: string[] = [];
		const ctx = {
			modelRegistry: {
				getProviderAuth: (provider: string): Promise<unknown> => {
					asked.push(provider);
					if (provider !== BEDROCK || stored === undefined) {
						return Promise.resolve(undefined);
					}
					return Promise.resolve({ source: "stored credential", env: { AWS_PROFILE: stored } });
				},
			},
		} as unknown as ExtensionContext;
		return { ctx, asked };
	}

	/**
	 * Scope the ambient `AWS_PROFILE` around one call, then put it back.
	 *
	 * A key that did not exist beforehand is DELETED, never set to `""`: Pi's
	 * auth context reads an empty value as absent, and so does
	 * `usableProfileName`, so `""` and "unset" would be indistinguishable here
	 * while meaning different things one layer down (Trap T8, and the same
	 * reasoning as `scopedAwsEnv` above).
	 */
	async function withAmbientProfile<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
		const had = Object.hasOwn(process.env, AWS_PROFILE_ENV);
		const previous = process.env[AWS_PROFILE_ENV];
		if (value === undefined) {
			delete process.env[AWS_PROFILE_ENV];
		} else {
			process.env[AWS_PROFILE_ENV] = value;
		}
		try {
			return await fn();
		} finally {
			if (had) {
				process.env[AWS_PROFILE_ENV] = previous as string;
			} else {
				delete process.env[AWS_PROFILE_ENV];
			}
		}
	}

	const STORED_PROFILE = "kypi-fixture-stored-profile";
	const AMBIENT_PROFILE = "kypi-fixture-ambient-profile";

	it("case 6 — WR-03: the surfaced profile is the STORED one when both are present", async () => {
		const { ctx, asked } = stubCtx(STORED_PROFILE);

		const resolved = await withAmbientProfile(AMBIENT_PROFILE, async () =>
			resolveProfileName(ctx),
		);

		expect(
			asked,
			`resolveProfileName did not ask the registry for ${BEDROCK}. If it asked for nothing ` +
				"the stored branch is unreachable and the assertion below passes only because the " +
				"ambient value happens to be second; if it asked for a different provider it is " +
				"reading somebody else's credential [WR-03]",
		).toContain(BEDROCK);

		expect(
			resolved,
			`the stored credential names ${STORED_PROFILE} and the environment names ` +
				`${AMBIENT_PROFILE}; the stored one must win, because that is the one Pi itself ` +
				"would have dialled (pi-ai amazon-bedrock.ts:65, proven by cases 2 and 4 above). " +
				"Surfacing the ambient name sends the user to re-authenticate the profile that did " +
				"NOT fail: the next turn fails identically, and the message has made the failure " +
				"more confusing than the raw SDK string it replaced [WR-03, PROV-05]",
		).toBe(STORED_PROFILE);
	});

	it("case 6b — the paired positive: with no stored credential the AMBIENT one is surfaced", async () => {
		// WITHOUT THIS, CASE 6 IS SATISFIED BY A FUNCTION THAT NEVER READS THE
		// ENVIRONMENT AT ALL. The ambient branch is the one that fires on the
		// target machine today — nothing writes a Bedrock entry, because
		// bin/bootstrap.sh deliberately withholds the placeholder one — so a
		// regression here is the common case, not the corner.
		const { ctx } = stubCtx(undefined);

		const resolved = await withAmbientProfile(AMBIENT_PROFILE, async () =>
			resolveProfileName(ctx),
		);

		expect(
			resolved,
			"with no stored Bedrock credential the exported AWS_PROFILE must be surfaced. If this " +
				"is the placeholder instead, the ambient branch is dead and case 6's precedence " +
				"result is a function that only ever reads one source [WR-03]",
		).toBe(AMBIENT_PROFILE);
	});

	it("case 6c — with neither source the placeholder is surfaced, not an empty command", async () => {
		// The floor. `aws sso login --profile ` with nothing after it is a command
		// the user can paste and cannot use, and it is what a chain that returned
		// `undefined ?? ""` would produce.
		const { ctx } = stubCtx(undefined);

		const resolved = await withAmbientProfile(undefined, async () => resolveProfileName(ctx));

		expect(
			resolved,
			"with no stored credential and no ambient AWS_PROFILE the placeholder must be " +
				"returned, so PROFILE_PLACEHOLDER_HINT fires and the message points at RB-03-03 " +
				"instead of trailing off after `--profile `",
		).toBe(PROFILE_PLACEHOLDER);
	});
});
