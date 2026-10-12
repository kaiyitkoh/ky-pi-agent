/**
 * PROV-07 — the R1 experiment is *executable*. Nothing more.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS, AND WHAT IT IS NOT — the [RUNBOOK] honesty paragraph
 * ---------------------------------------------------------------------------
 * This file proves one preparation step works: that a one-line `modelOverrides`
 * entry in `models.json` makes Pi able to *select* `reasoning_effort: "low"` for
 * `deepseek/deepseek-flash`, which the built-in catalogue makes impossible.
 *
 * It does **not** answer whether `api.deepseek.com` accepts that value, and it
 * does not answer whether the value yields materially fewer reasoning tokens
 * than `"high"`. Neither question can be answered from a desk, and this file
 * issues no request to anything. That is `RB-03-04` in `docs/RUNBOOK.md`, status
 * **OUTSTANDING**, and a green run here may never be used to mark PROV-07 as
 * passing (Trap T12).
 *
 * **The threshold is pre-committed, deliberately:** "materially fewer" means
 * `low.reasoning <= 0.6 * high.reasoning`, measured from the two `turns-*.jsonl`
 * rows RB-03-04 collects. Pre-committing is the whole point — choosing the line
 * after seeing the numbers is how a null result becomes a positive one.
 *
 * **The fourth outcome is a result, not a failed run.** RB-03-04 enumerates
 * accepted-and-cheaper, accepted-but-not-cheaper and rejected; the fourth is an
 * absent `reasoning` key on BOTH legs, which means "DeepSeek V4 Flash reports no
 * reasoning-token breakdown through this adapter". That is worth recording and
 * settles PROV-07 just as firmly as a number would.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO RESEARCHERS DISAGREED, AND WHY BOTH WERE RIGHT
 * ---------------------------------------------------------------------------
 * They answered different questions. `api.deepseek.com` documents
 * `reasoning_effort` values `"low"`, `"high"` (default) and `"max"` — so the
 * API's contract admits `"low"`. But Pi 0.84.1's built-in catalogue ships
 * `thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high",
 * max: "max" }` for this model [VERIFIED: pi-ai 0.84.1
 * dist/providers/data/deepseek.json], `getSupportedThinkingLevels` drops every
 * null-mapped level, and `clampThinkingLevel(model, "low")` walks forward and
 * returns `"high"` [VERIFIED: pi-ai 0.84.1 src/models.ts:900-932]. So Pi *can
 * never send* `"low"` as shipped. Both statements are true; neither is the
 * token count PROV-07 wants.
 *
 * A mechanical detail that makes the fix a one-liner: if `"low"` did reach the
 * adapter, the deepseek branch emits `model.thinkingLevelMap?.[effort] ?? effort`
 * [VERIFIED: pi-ai 0.84.1 src/api/openai-completions.ts:802-805] and
 * `null ?? "low"` is `"low"`. **The null mapping suppresses selection, not
 * emission.** Unclamping is therefore sufficient and no adapter change is needed.
 *
 * ---------------------------------------------------------------------------
 * WHY `modelOverrides` AND NOT A MODEL ENTRY
 * ---------------------------------------------------------------------------
 * `applyModelOverride` **merges** the map — `{...model.thinkingLevelMap,
 * ...override.thinkingLevelMap}` [VERIFIED: pi 0.84.1
 * src/core/provider-composer.ts:108-110] — so the rest of the map, the compat
 * block and the cost table survive untouched. A full model entry would redefine
 * a catalogued model, which is exactly the cross-provider drift PROV-06 forbids.
 * Case 3 asserts the merge is a merge; without it, an override that clobbered
 * the map would satisfy case 2 while silently removing the two levels the
 * harness actually uses.
 *
 * ---------------------------------------------------------------------------
 * PI'S OWN FUNCTIONS, NOT A LOCAL CLAMP
 * ---------------------------------------------------------------------------
 * `clampThinkingLevel` and `getSupportedThinkingLevels` are imported from
 * `@earendil-works/pi-ai` and called on the model Pi *composed*. A local
 * reimplementation of the walk would assert this file's own arithmetic, and
 * would keep passing after Pi changed the rule underneath it.
 *
 * Pure by construction: no session, no provider, no network, no credentials.
 * `withModelsConfig` is used only because the composition step is what turns a
 * `modelOverrides` block into a `Model` — the thing under test is the
 * composition, so composing it is not incidental.
 */
import { describe, expect, it } from "vitest";

import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";

import { withModelsConfig } from "../helpers/models.ts";

/** The DeepSeek-direct executor. Bounded impact: see the note below. */
const PROVIDER = "deepseek";
const MODEL = "deepseek-flash";

/**
 * The level the whole question is about, spelled once. `"low"` is a
 * `ModelThinkingLevel`, so this is typed rather than stringly-typed and a
 * renamed level in a future Pi becomes a compile error rather than a silent
 * clamp to something else.
 */
const LOW: ModelThinkingLevel = "low";

/**
 * The unclamp exactly as `RB-03-04`'s preparation step writes it into
 * `~/.pi/agent/models.json`. One key, merged.
 *
 * Impact is bounded to the DeepSeek-direct path on purpose (CONTEXT decision 9):
 * DashScope maps `low` -> `high` server-side regardless, so unclamping there
 * would change the payload and nothing else.
 */
const UNCLAMP_OVERRIDE = {
	providers: {
		[PROVIDER]: {
			modelOverrides: {
				[MODEL]: { thinkingLevelMap: { low: "low" } },
			},
		},
	},
} as const;

/**
 * The baseline: a models config that declares nothing at all, so the model
 * resolves from Pi's built-in catalogue exactly as it does on a machine that
 * has never edited `models.json`.
 */
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

			// Vacuity guard first: every claim below is about this map, and a model
			// with no thinking-level map at all would make both assertions pass for
			// reasons that have nothing to do with the finding.
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
	});

	it("case 3 — the merge is a merge: high, max, compat and cost all survive", async () => {
		// The two registries are composed from configs that differ ONLY by the
		// override, and the built-in values are read from the baseline rather than
		// retyped here. A hand-copied expectation table would assert this file's
		// transcription of the catalogue, not the catalogue.
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

			// The paired positive: without it, a baseline that failed to compose --
			// leaving every value undefined on both sides -- would satisfy all five
			// deep-equalities above while proving nothing at all.
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
