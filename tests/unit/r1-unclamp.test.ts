/**
 * The R1 experiment is executable: one `modelOverrides` entry lets Pi select reasoning_effort "low" for
 * deepseek/deepseek-flash, which the catalogue's null mapping clamps to "high" (pi-ai src/models.ts clampThinkingLevel).
 * Whether DeepSeek accepts it and spends fewer tokens is RB-03-04, outstanding; no request is made here. The override
 * merges the map (provider-composer applyModelOverride), and the clamp is Pi's own function, never a local copy.
 */
import { describe, expect, it } from "vitest";

import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";

import { withModelsConfig } from "../helpers/models.ts";

/** The DeepSeek-direct executor. Bounded impact: see the note below. */
const PROVIDER = "deepseek";
const MODEL = "deepseek-flash";

/** Typed as a ModelThinkingLevel, so a renamed level in a future Pi is a compile error rather than a silent clamp. */
const LOW: ModelThinkingLevel = "low";

/** The unclamp exactly as RB-03-04 writes it into models.json; DashScope maps low to high server-side anyway. */
const UNCLAMP_OVERRIDE = {
	providers: {
		[PROVIDER]: {
			modelOverrides: {
				[MODEL]: { thinkingLevelMap: { low: "low" } },
			},
		},
	},
} as const;

/** A config that declares nothing, so the model resolves from Pi's built-in catalogue. */
const NO_OVERRIDE = {} as const;

/** Read `thinkingLevelMap` off a composed model without pretending to narrow it. */
function levelMap(model: Model<Api>): Record<string, unknown> {
	return (model.thinkingLevelMap ?? {}) as Record<string, unknown>;
}

describe("PROV-07 — the R1 unclamp (offline; the answer is RB-03-04, OUTSTANDING)", () => {
	it("case 1 — as shipped (Pi 1.1.0), the built-in entry already maps `low`: no clamp to `high`", async () => {
		await withModelsConfig({ models: NO_OVERRIDE }, (handle) => {
			const model = handle.requireModel(PROVIDER, MODEL);
			const map = levelMap(model);

			// Vacuity guard: a model with no thinking-level map would pass both assertions below.
			expect(
				Object.keys(map).length,
				`the built-in ${PROVIDER}/${MODEL} entry composed with no thinkingLevelMap at ` +
					"all. Both assertions below are about that map, so an empty one turns this " +
					"case into a pass that verified nothing. Re-read the catalogue entry before " +
					"assuming the finding still holds",
			).toBeGreaterThan(0);

			expect(
				getSupportedThinkingLevels(model),
				"[Pi 1.1.0: deepseek-flash ships low:\"low\" upstream, so the unclamp is no longer needed for this tier; was [off, high, max] on 0.84.1.] the levels Pi offers for the built-in entry. This is the finding that settles " +
					'the "what will Pi actually send" half of R1, and it must be an assertion ' +
					"rather than a comment: `low`, `minimal` and `medium` map to null, and " +
					"getSupportedThinkingLevels drops every null-mapped level. If `low` appears " +
					"here, the catalogue changed and RB-03-04's preparation step is unnecessary",
			).toEqual(["off", "low", "high", "max"]);

			expect(
				clampThinkingLevel(model, LOW),
				"[Pi 1.1.0: asking for `low` now yields `low`; on 0.84.1 it clamped to `high`.] This was why " +
					"PROV-07 cannot be answered by reading DeepSeek's API docs: the API admits " +
					'"low", and Pi 0.84.1 with the built-in catalogue can never send it. A ' +
					"`/cheap` route defined on a cheap thinking tier would silently be a `high` " +
					"tier at `high` prices",
			).toBe("low");
		});
	});

	it("case 2 — with the modelOverrides unclamp, `low` becomes selectable and unclamped", async () => {
		await withModelsConfig({ models: UNCLAMP_OVERRIDE }, (handle) => {
			const model = handle.requireModel(PROVIDER, MODEL);

			expect(
				getSupportedThinkingLevels(model),
				"the override must make `low` an offered level. This is the known-good " +
					"counterpart to RB-03-04 step 2 -- \"if the picker does not offer `low`, the " +
					'override did not apply, stop" -- and without it that instruction is a check ' +
					"with no reference behaviour to compare against",
			).toContain(LOW);

			expect(
				clampThinkingLevel(model, LOW),
				"with the override applied, asking for `low` must return `low` rather than " +
					"walking forward to `high`. If this returns `high`, the experiment cannot be " +
					"run at all: every leg of RB-03-04 would send the same effort and the " +
					"comparison would be between a request and itself",
			).toBe(LOW);
		});

		const marker = "override-marker";
		await withModelsConfig(
			{ models: { providers: { [PROVIDER]: { modelOverrides: { [MODEL]: { thinkingLevelMap: { low: marker } } } } } } },
			(handle) => {
				expect(
					levelMap(handle.requireModel(PROVIDER, MODEL)).low,
					"the built-in map already carries `low` on this Pi version, so only a value the " +
						"catalogue cannot produce proves the override entry is what composed the model",
				).toBe(marker);
			},
		);
	});

	it("case 3 — the merge is a merge: high, max, compat and cost all survive", async () => {
		// Built-in values are read from the baseline, never retyped, so this asserts the catalogue itself.
		const baseline = await withModelsConfig({ models: NO_OVERRIDE }, (handle) => {
			const model = handle.requireModel(PROVIDER, MODEL);
			return {
				map: levelMap(model),
				compat: model.compat,
				cost: model.cost,
				contextWindow: model.contextWindow,
			};
		});

		await withModelsConfig({ models: UNCLAMP_OVERRIDE }, (handle) => {
			const model = handle.requireModel(PROVIDER, MODEL);
			const map = levelMap(model);

			expect(
				map.high,
				"`high` is the level the harness actually uses today and the level RB-03-04's " +
					"control leg sends. An override that REPLACED thinkingLevelMap instead of " +
					"merging it would drop this key, satisfy case 2 perfectly, and quietly make " +
					"the model's only working thinking tier unavailable",
			).toBe(baseline.map.high);

			expect(
				map.max,
				"`max` must survive the override for the same reason `high` must. Both come " +
					"from the built-in catalogue and neither is mentioned in the override block",
			).toBe(baseline.map.max);

			expect(
				model.compat,
				"the compat block must be byte-for-byte what the built-in entry composes. It " +
					"carries `thinkingFormat: deepseek` and " +
					"`requiresReasoningContentOnAssistantMessages`, and losing either one turns " +
					"thinking off or 400s the second turn of a tool sequence -- silently, in both " +
					"cases. A `modelOverrides` entry must not be able to do that",
			).toEqual(baseline.compat);

			expect(
				model.cost,
				"the cost table must survive the override, or every /budget figure for this " +
					"model becomes wrong at exactly the moment the experiment starts measuring it",
			).toEqual(baseline.cost);

			expect(
				model.contextWindow,
				"the context window must survive too. PROV-06's invariant is that no model " +
					"inherits a number from somewhere it did not come from, and an override that " +
					"reset this would breach it from the other direction",
			).toBe(baseline.contextWindow);

			// Without this, a baseline that failed to compose would satisfy every equality above.
			expect(
				baseline.compat,
				"the BASELINE model composed no compat block, so the equalities above compared " +
					"undefined with undefined and verified nothing. Fix the baseline composition " +
					"before trusting a green run of this case",
			).toBeDefined();

			expect(
				Object.keys(baseline.map),
				"the baseline thinkingLevelMap must be non-empty for the `high`/`max` " +
					"assertions above to mean anything -- comparing undefined to undefined is not " +
					"a survival check",
			).toContain("high");
		});
	});
});
