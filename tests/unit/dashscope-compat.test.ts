/**
 * The DashScope `compat` block, asserted on the object Pi COMPOSES, never the template text: typebox's Type.Object
 * accepts unknown keys, so a misspelled key validates and configures nothing. detectCompat has no DashScope branch,
 * so any field left to detection takes the generic OpenAI default (thinking off, second tool turn HTTP 400).
 * Whether DashScope accepts the result is RB-03-01 in docs/RUNBOOK.md, OUTSTANDING.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Api, Model } from "@earendil-works/pi-ai";
import { beforeAll, describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { withModelsConfig } from "../helpers/models.ts";

/** Loaded through Pi, never read as text. */
const TEMPLATE = join(repoRoot(), ".pi", "templates", "models-template.json");

/** The provider-level compat every templated model inherits; every field is explicit so detection decides nothing. */
const PROVIDER_COMPAT = {
	// Default true SENDS `store: false` [pi-ai src/api/openai-completions.ts:711-713]; `store` is not in Alibaba's list.
	supportsStore: false,
	// Default true; the unlisted `developer` role is emitted for reasoning models [:1083-1085].
	supportsDeveloperRole: false,
	// Already the default, set so detection never decides it [:754, :763, :802, :837].
	supportsReasoningEffort: true,
	// Default "max_completion_tokens" [:715-721]; Alibaba lists only `max_tokens`.
	maxTokensField: "max_tokens",
	// Default true [:1360, :1368]; `strict` is not in Alibaba's list.
	supportsStrictMode: false,
	// Default true sends `prompt_cache_key` and `prompt_cache_retention` [:699-704]; neither is in Alibaba's list.
	supportsLongCacheRetention: false,
	// Default "openai" never enables thinking; "qwen" emits top-level `enable_thinking` + `reasoning_effort` [:761-768].
	// https://github.com/earendil-works/pi/issues/6998
	thinkingFormat: "qwen",
} as const;

/** Merged compat per model: the provider block plus each model's one addition (pi src/core/provider-composer.ts:81-101). */
const INTENDED_COMPAT: Record<string, Record<string, unknown>> = {
	"deepseek-v4-flash": {
		...PROVIDER_COMPAT,
		// Model-level (a DeepSeek property): replayed assistant messages get `reasoning_content: ""` [:1223-1229], without
		// which the second turn of a tool sequence returns HTTP 400.
		requiresReasoningContentOnAssistantMessages: true,
	},
	"deepseek-v4-pro": {
		...PROVIDER_COMPAT,
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

/** The models the template contributes: a registry composed over empty `providers` subtracted from the full one. */
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
		// Every case below iterates this set, so an empty one would assert nothing.
		expect(
			templatedIds.length,
			`${TEMPLATE} contributed NO models to a composed registry. Nothing below this ` +
				"line can fail, so the whole PROV-03 gate is vacuous until this is fixed. " +
				"Check the `providers` key spelling: typebox accepts an unknown key in " +
				"silence, so a misspelling produces exactly this with no parse error.",
		).toBeGreaterThan(0);
	});

	it("every templated model has an INTENDED_COMPAT entry, and nothing else does", () => {
		// Both directions: a model without a table entry ships unasserted; a stale entry looks like coverage.
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

			// Against what Pi built, so a misspelled template key goes red (the misspelling case below proves it).
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

			// Implied by deep equality, but an unexpected key should name itself rather than hide in a large diff.
			expect(
				Object.keys(compat ?? {}).sort(),
				`${key} composed a compat key set that is not the intended one. An extra ` +
					"key came from a layer this file does not model (provider compat, model " +
					"compat, modelOverrides, or Pi itself), and it will reach the wire.",
			).toEqual(Object.keys(intended).sort());
		});

		it(`${key} is a reasoning model (Trap T5)`, () => {
			// `reasoning` defaults to false [pi src/core/provider-composer.ts:156], and every thinking branch and the
			// reasoning_content fix also require it, so omitting it silently disables both.
			expect(
				composed.get(key)?.reasoning,
				`${key} composed with reasoning=false. Every compat assertion above it is ` +
					"still green and every one of them is now inert: the thinkingFormat " +
					"branches and the reasoning_content fix are all gated on this flag.",
			).toBe(true);
		});
	}

	it("a deliberately misspelled compat key does NOT reach the composed object", async () => {
		// Inline, never under .pi/templates/: a fixture there would ship as real configuration.
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
			// requireModel throws, so a fixture that failed to compose cannot satisfy the negatives below.
			compat: handle.requireModel(PROVIDER_ID, "deepseek-v4-flash").compat,
			configError: handle.modelRuntime.getError(),
		}));

		// Positive control: the typo really validated and composed, or the absence below would prove nothing.
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

		// The intended key is simply absent, which is what makes the deep-equality assertions live.
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
			// Throw, never skip: a skipped canary is a dead canary nobody notices.
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

		// Paired positive: `deepseek.com` is one of detectCompat's base-URL substrings, so the read is the real code.
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
