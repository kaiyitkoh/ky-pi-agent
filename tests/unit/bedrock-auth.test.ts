/**
 * Pi's resolution of a stored Bedrock `AWS_PROFILE`, offline, both directions: the shipped entry resolves, the file beats
 * the ambient variable, nothing resolves when neither is set, and an empty placeholder is an outage. Whether a live SSO
 * token resolves is a runbook check. Every case blanks the whole credential chain (Pi treats an empty variable as
 * absent), so a run never reports this machine's state. The AWS SDK scope and CLI dot-directory are deliberately unspelled.
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

/** Built from the exported prefix, so it cannot drift from what bootstrap and the SSO classifier key on. */
const SENTINEL_SHAPE = new RegExp(`^${TEMPLATE_SENTINEL_PREFIX}`);

/** The artifact under test, at the filename Trap T1 forced. */
const AUTH_TEMPLATE_PATH = join(repoRoot(), ".pi", "templates", "auth-template.json");

/** The shipped template, read from disk each call: the claim is that the committed bytes resolve. */
function authTemplate(): Record<string, unknown> {
	return JSON.parse(readFileSync(AUTH_TEMPLATE_PATH, "utf-8")) as Record<string, unknown>;
}

/** The profile placeholder the template actually ships, whatever it is today. */
function templatePlaceholder(): unknown {
	const entry = authTemplate()[BEDROCK] as { env?: Record<string, unknown> } | undefined;
	return entry?.env?.AWS_PROFILE;
}

/**
 * Every variable Bedrock's `resolve()` consults (pi-ai src/providers/amazon-bedrock.ts `resolve`), all blanked: blanking
 * only AWS_PROFILE would still resolve through an ambient bearer token.
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

/** Distinct fixture values, so the precedence case cannot pass whichever source won. */
const PROFILE_FROM_FILE = "kypi-fixture-profile-from-auth-json";
const PROFILE_FROM_AMBIENT = "kypi-fixture-profile-from-environment";

/** Bedrock is built in, so no models entry is declared: redefining a catalogued model is forbidden drift. */
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
		// The round trip above re-reads the same file, so it holds for any value; this pins what the placeholder must be.
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
		// Without this, a resolver that always returned a credential would satisfy cases 1 and 2.
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
		// Paired with case 3: the same blanked chain with one variable set, so "absent" means absent, not broken.
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
		// `??` falls through only on null/undefined, so `""` blocks the ambient variable and then fails the truthy branch.
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

		// Links the demonstration to the shipped artifact.
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
	// Case 6 — the harness's profile message follows Pi's order, or the user re-authenticates the profile that did not fail
	// -------------------------------------------------------------------------
	// A stub: in a session the faux provider shadows Pi's Bedrock resolver, and resolveProfileName reads only getProviderAuth.

	/** Every call `resolveProfileName` made, so a wrong provider id cannot hide. */
	interface StubbedRegistry {
		ctx: ExtensionContext;
		asked: string[];
	}

	/** A context of nothing but `getProviderAuth`; any provider other than Bedrock answers undefined, so a wrong id fails. */
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

	/** Scopes the ambient AWS_PROFILE around one call; a previously absent key is deleted, not set to `""`. */
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
		// Without this, case 6 passes for a function that never reads the environment, which is the common path today.
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
		// The floor: `aws sso login --profile ` with nothing after it is unusable.
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
