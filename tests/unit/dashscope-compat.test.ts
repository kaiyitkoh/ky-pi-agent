/**
 * PROV-03 — the DashScope `compat` block, asserted where it TAKES EFFECT rather
 * than where it is written.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS: A TYPO VALIDATES SILENTLY (Trap T6)
 * ---------------------------------------------------------------------------
 * Pi validates `models.json` with typebox, and `Type.Object` permits additional
 * properties [VERIFIED: executed 2026-08-13 —
 * `Compile(Type.Object({a:…})).Check({a:true,zzz:1}) === true`]. A template
 * carrying `supportsStoore: false` therefore parses, validates, composes, and
 * configures NOTHING. Every byte-level assertion ever written about that
 * template stays green. That is the single most likely way this phase ships a
 * broken provider, so nothing below reads the template's text: every assertion
 * runs against the `compat` object Pi actually COMPOSED, obtained through
 * `withModelsConfig` from `tests/helpers/models.ts`, and the misspelling case
 * proves the deep-equality is live rather than decorative.
 *
 * What a wrong `compat` costs, restated because both failures are invisible
 * from the UI: `detectCompat` keys on a hard-coded provider-id list and a
 * hard-coded base-URL-substring list and has NO branch for DashScope, Model
 * Studio, `aliyuncs.com` or Qwen [VERIFIED: pi-ai 0.84.1
 * src/api/openai-completions.ts:1443-1536, and the canary at the bottom of this
 * file re-checks it against the INSTALLED artifact on every run]. A field left
 * to detection silently takes the generic OpenAI default, which means
 * `thinkingFormat` becomes `"openai"` and thinking is never enabled at all, and
 * `requiresReasoningContentOnAssistantMessages` becomes `false` so the SECOND
 * turn of a tool sequence returns HTTP 400 while the first succeeds — which is
 * exactly why the user's original experience read as intermittent.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT PROVE — the live half is RB-03-01
 * ---------------------------------------------------------------------------
 * This proves what Pi COMPOSES from the shipped template. It says nothing
 * whatsoever about whether DashScope ACCEPTS any of it: no request left this
 * machine, no credential exists on it, and `withModelsConfig` is constructed
 * with `refreshOnCreate: false` precisely so that none can. Whether the
 * resulting body is accepted by `dashscope-intl.aliyuncs.com` is `RB-03-01` in
 * `docs/RUNBOOK.md` and it is OUTSTANDING. A green run here may never be read
 * as PROV-03 passing (Trap T12).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Api, Model } from "@earendil-works/pi-ai";
import { beforeAll, describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { withModelsConfig } from "../helpers/models.ts";

/** The template plan 03-02 shipped. Loaded through Pi, never read as text here. */
const TEMPLATE = join(repoRoot(), ".pi", "templates", "models-template.json");

/**
 * The provider-level `compat` every templated model inherits, with the reason
 * for each field beside it. Transcribed from `03-RESEARCH.md` §Q2.2, whose table
 * carries the generic default and the emission site for every one of them.
 *
 * Three of these (`supportsReasoningEffort`, and the two that happen to agree
 * with no default at all) are written out even where a default would do, because
 * the point of PROV-03 is that nothing is left for detection to decide.
 */
const PROVIDER_COMPAT = {
	// Generic default `true`, and the emission SENDS `store: false` rather than
	// omitting the key [pi-ai src/api/openai-completions.ts:711-713]. `store` is
	// absent from Alibaba's supported-parameter list, so `false` here omits it.
	supportsStore: false,
	// Generic default `true`. The `developer` role is unlisted by Alibaba and the
	// emission is gated on `model.reasoning` [:1083-1085] — it bites on exactly
	// the models this template defines.
	supportsDeveloperRole: false,
	// Generic default `true` already, set explicitly so detection never decides
	// it [:754, :763, :802, :837].
	supportsReasoningEffort: true,
	// Generic default `"max_completion_tokens"` [:715-721]. Alibaba's
	// compatibility table lists `max_tokens` and does not list the other.
	maxTokensField: "max_tokens",
	// Generic default `true` [:1360, :1368]. `strict` is unlisted; suppressing it
	// removes one unlisted field from the PROV-10 request.
	supportsStrictMode: false,
	// Generic default `true`, which sends `prompt_cache_key` +
	// `prompt_cache_retention: "24h"` [:699-704]. Neither is in Alibaba's list.
	supportsLongCacheRetention: false,
	// Generic default `"openai"`, i.e. thinking NEVER enabled. Pi's "qwen" branch
	// emits top-level `enable_thinking` + `reasoning_effort` [:761-768], which is
	// what Alibaba's own DeepSeek-on-Model-Studio page documents; upstream issue
	// earendil-works/pi#6998 is closed in favour of "qwen".
	thinkingFormat: "qwen",
} as const;

/**
 * The fully merged `compat` each templated model must end up with, keyed by
 * model id — the "table of record" shape `tests/unit/pinning.test.ts:95-102`
 * uses for its pins.
 *
 * `mergeCompat` is `{...providerCompat, ...modelCompat}` plus a nested merge of
 * four routing/template objects we do not use [VERIFIED: pi 0.84.1
 * src/core/provider-composer.ts:81-101], so the intended object is the provider
 * block plus each model's one addition.
 */
const INTENDED_COMPAT: Record<string, Record<string, unknown>> = {
	"deepseek-v4-flash": {
		...PROVIDER_COMPAT,
		// THE PROV-10 FIX, model-level because it is a DeepSeek property and not a
		// DashScope one. Replayed assistant messages get `reasoning_content: ""`
		// [:1223-1229, gated on `model.reasoning`]. Without it the first turn of a
		// tool sequence succeeds and the second returns HTTP 400.
		requiresReasoningContentOnAssistantMessages: true,
	},
	"deepseek-v4-pro": {
		...PROVIDER_COMPAT,
		// See the flash entry: same provider, same model family, same fix.
		requiresReasoningContentOnAssistantMessages: true,
	},
};

/** The provider the template defines. `requireModel` throws if it is renamed. */
const PROVIDER_ID = "dashscope";

/**
 * The installed adapter the canary reads. Not a source file and not a mirror of
 * one: the point is to check the artifact that will actually run.
 */
const ADAPTER = join(
	repoRoot(),
	"node_modules",
	"@earendil-works",
	"pi-ai",
	"dist",
	"api",
	"openai-completions.js",
);

/**
 * The models the TEMPLATE contributes, discovered by difference rather than by a
 * hardcoded list.
 *
 * Pi's registry carries 1,220 built-in models before this template adds
 * anything, so "everything in the registry" is the wrong set and "the two ids I
 * happen to remember" is a set that silently stops covering a third model
 * somebody adds. Composing a second registry over an empty `providers` object
 * and subtracting gives exactly what the template introduced, with no literal to
 * fall out of date.
 *
 * Deliberately not shared with `tests/unit/model-metadata.test.ts`, which needs
 * the same difference: a helper in `tests/helpers/` carries a standing
 * obligation to be covered in `tests/unit/helpers.test.ts`, and fifteen
 * duplicated lines are a cheaper price than an untested helper.
 */
async function templatedModelIds(): Promise<string[]> {
	const baseline = await withModelsConfig({ models: { providers: {} } }, (handle) =>
		handle.modelRuntime.getModels().map((model) => `${model.provider}/${model.id}`),
	);
	const baselineKeys = new Set(baseline);
	return await withModelsConfig({ models: TEMPLATE }, (handle) =>
		handle.modelRuntime
			.getModels()
			.map((model) => `${model.provider}/${model.id}`)
			.filter((key) => !baselineKeys.has(key) && key.startsWith("dashscope/"))
			.sort(),
	);
}

let templatedIds: string[] = [];
let composed: Map<string, Model<Api>> = new Map();

beforeAll(async () => {
	templatedIds = await templatedModelIds();
	composed = await withModelsConfig({ models: TEMPLATE }, (handle) => {
		const map = new Map<string, Model<Api>>();
		for (const key of templatedIds) {
			const [provider, ...rest] = key.split("/");
			map.set(key, handle.requireModel(provider ?? "", rest.join("/")));
		}
		return map;
	});
});

describe("PROV-03 — the composed DashScope compat block", () => {
	it("the template contributes at least one model (guards against a vacuous pass)", () => {
		// Every case below iterates or indexes this set. An empty one -- a renamed
		// provider key, a template that stopped validating, a helper that composed
		// the wrong file -- would turn this entire file into a pass that executed
		// no assertion at all.
		expect(
			templatedIds.length,
			`${TEMPLATE} contributed NO models to a composed registry. Nothing below this ` +
				"line can fail, so the whole PROV-03 gate is vacuous until this is fixed. " +
				"Check the `providers` key spelling: typebox accepts an unknown key in " +
				"silence, so a misspelling produces exactly this with no parse error.",
		).toBeGreaterThan(0);
	});

	it("every templated model has an INTENDED_COMPAT entry, and nothing else does", () => {
		// Both directions. A third model added to the template without a table
		// entry would otherwise ship with its compat block entirely unasserted,
		// and a table entry left behind after a model is removed would look like
		// coverage that no longer exists.
		expect(
			templatedIds.sort(),
			"the set of models the template composes and the set of models this file " +
				"has an intended compat table for have diverged. Add or remove the table " +
				"entry deliberately; do not let a model ship with no assertion over it.",
		).toEqual(
			Object.keys(INTENDED_COMPAT)
				.map((id) => `${PROVIDER_ID}/${id}`)
				.sort(),
		);
	});

	for (const [modelId, intended] of Object.entries(INTENDED_COMPAT)) {
		const key = `${PROVIDER_ID}/${modelId}`;

		it(`${key} composes exactly the intended compat object`, () => {
			const model = composed.get(key);
			expect(model, `${key} was not composed; see the vacuity guard above`).toBeDefined();

			// THE ASSERTION THIS FILE EXISTS FOR. Against `model.compat` -- what Pi
			// built -- and never against the template's bytes. A misspelled key in
			// the template does not appear here under its intended name, so this
			// goes red; the misspelling case below proves that claim rather than
			// asserting it.
			expect(
				model?.compat,
				`the compat Pi COMPOSED for ${key} is not the intended object. Every field ` +
					"in it is invisible from the UI and degrades silently: a missing " +
					'`thinkingFormat` means thinking is never enabled, a missing ' +
					"`requiresReasoningContentOnAssistantMessages` means the SECOND turn of " +
					"every tool sequence returns HTTP 400 while the first succeeds. If this " +
					"changed on purpose, change the table and say why beside the field.",
			).toEqual(intended);
		});

		it(`${key} carries no compat key outside the table`, () => {
			const compat = composed.get(key)?.compat;
			expect(compat, `${key} composed without a compat object at all`).toBeDefined();

			// Deep equality already implies this, but stated separately because the
			// failure it catches is a different one: a key arriving from somewhere
			// unexpected -- a provider-level field nobody meant to inherit, a
			// `modelOverrides` block, a future Pi default written into the composed
			// object -- should name itself in the failure rather than appear as one
			// line of a large diff.
			expect(
				Object.keys(compat ?? {}).sort(),
				`${key} composed a compat key set that is not the intended one. An extra ` +
					"key came from a layer this file does not model (provider compat, model " +
					"compat, modelOverrides, or Pi itself), and it will reach the wire.",
			).toEqual(Object.keys(intended).sort());
		});

		it(`${key} is a reasoning model (Trap T5)`, () => {
			// `modelFromJson` defaults `reasoning` to FALSE when the key is omitted
			// [pi src/core/provider-composer.ts:156], and every thinkingFormat branch
			// is `compat.thinkingFormat === X && model.reasoning` [:748, :761, :796,
			// :837] while the reasoning_content fix is `&& model.reasoning` too
			// [:1225]. So an entry that forgets `reasoning: true` disables thinking
			// AND re-opens the PROV-10 400, together and silently -- with a perfectly
			// correct compat block sitting right next to it doing nothing.
			expect(
				composed.get(key)?.reasoning,
				`${key} composed with reasoning=false. Every compat assertion above it is ` +
					"still green and every one of them is now inert: the thinkingFormat " +
					"branches and the reasoning_content fix are all gated on this flag.",
			).toBe(true);
		});
	}

	it("a deliberately misspelled compat key does NOT reach the composed object", async () => {
		// The fixture is INLINE, never a file under `.pi/templates/`: a fixture in
		// the scanned/installed directory would be shipped as real configuration
		// and would fail the gate it exists to prove. `chokepoint-lint.test.ts:146-156`
		// keeps its offending fixture inline for the same stated reason.
		// [threat T-03-04-05]
		const misspelled = {
			providers: {
				[PROVIDER_ID]: {
					name: "typo fixture — never installed, never written to disk outside a temp dir",
					api: "openai-completions",
					baseUrl: "https://example.invalid/v1",
					apiKey: "$DASHSCOPE_API_KEY",
					compat: {
						// The typo. One transposed letter, and typebox says yes.
						supportsStoore: false,
						supportsDeveloperRole: false,
						supportsReasoningEffort: true,
						maxTokensField: "max_tokens",
						supportsStrictMode: false,
						supportsLongCacheRetention: false,
						thinkingFormat: "qwen",
					},
					models: [
						{
							id: "deepseek-v4-flash",
							name: "typo fixture",
							reasoning: true,
							input: ["text"],
							contextWindow: 393216,
							maxTokens: 65536,
							compat: { requiresReasoningContentOnAssistantMessages: true },
						},
					],
				},
			},
		};

		const { compat, configError } = await withModelsConfig({ models: misspelled }, (handle) => ({
			// `requireModel` throws rather than returning undefined, so a fixture
			// that failed to compose surfaces as an error naming both ids -- it can
			// never quietly satisfy the negative assertions below.
			compat: handle.requireModel(PROVIDER_ID, "deepseek-v4-flash").compat,
			configError: handle.modelRuntime.getError(),
		}));

		// Positive control first: the typo really did validate and really did
		// compose. Without this, "supportsStore is absent" would also be satisfied
		// by a fixture Pi rejected outright, which proves the opposite of the point.
		expect(
			configError,
			"Pi reported a models.json error for the misspelled fixture. If typebox has " +
				"started rejecting unknown compat keys that is GOOD NEWS and a real change " +
				"in the platform -- re-verify Trap T6 and rewrite this case; do not delete it.",
		).toBeUndefined();
		expect(
			(compat as Record<string, unknown> | undefined)?.supportsStoore,
			"the misspelled key did not survive into the composed object, so this " +
				"fixture no longer demonstrates the trap it exists to demonstrate",
		).toBe(false);

		// And the finding: the intended key is simply not there. This is what makes
		// the deep-equality assertions above live rather than decorative -- a real
		// typo in the shipped template produces exactly this shape and turns them red.
		expect(
			Object.hasOwn(compat ?? {}, "supportsStore"),
			"a misspelled compat key somehow still produced the intended key, which " +
				"would mean the deep-equality cases above cannot detect a typo",
		).toBe(false);
		expect(
			compat,
			"the misspelled fixture deep-equals the intended table, so the intended " +
				"table cannot distinguish a correct template from a typo'd one",
		).not.toEqual(INTENDED_COMPAT["deepseek-v4-flash"]);
	});
});

describe("PROV-03 — the detectCompat regression canary", () => {
	it("the installed openai-completions adapter still has no aliyuncs branch", () => {
		if (!existsSync(ADAPTER)) {
			// Throw, never skip: a skipped canary is a canary nobody will notice is
			// dead. [.planning/STATE.md — "throw, never skip"]
			throw new Error(
				[
					`The installed adapter is missing: ${ADAPTER}`,
					"",
					"This test asserts against the artifact that will actually run, not a",
					"copy of it, so it cannot fall back to anything. Restore it with:",
					"",
					"  npm ci",
					"",
					"If pi-ai has moved this file, find its new path and update ADAPTER --",
					"do not weaken the assertion to tolerate the absence.",
				].join("\n"),
			);
		}

		const source = readFileSync(ADAPTER, "utf-8");

		// Paired positive, and it is load-bearing: `deepseek.com` IS one of
		// detectCompat's base-URL substrings, so its presence proves this really is
		// the detection code and not a truncated read, a wrong path, or a file that
		// stopped containing the list. Without it, an empty string satisfies the
		// negative below perfectly.
		expect(
			source,
			`${ADAPTER} does not contain "deepseek.com", which is one of detectCompat's ` +
				"own base-URL substrings. The file read is not the detection code, so the " +
				"absence asserted below proves nothing.",
		).toContain("deepseek.com");

		expect(
			source.toLowerCase(),
			[
				"The installed pi-ai adapter now mentions `aliyuncs`, which means",
				"`detectCompat` has probably GAINED a DashScope / Model Studio branch.",
				"",
				"DO NOT DELETE THIS TEST. The explicit compat block in",
				".pi/templates/models-template.json was written on the verified fact that",
				"no such branch existed [VERIFIED: 2026-08-13], so every field in it was",
				"chosen against the GENERIC OpenAI defaults. New detection defaults may",
				"agree with those choices, contradict them, or double-configure them.",
				"",
				"Re-verify the block field by field against the new detection code, update",
				"INTENDED_COMPAT in this file with the reasons rewritten, and only then",
				"decide what this canary should assert next.",
			].join("\n"),
		).not.toContain("aliyuncs");
	});
});
