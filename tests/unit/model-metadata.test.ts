/**
 * PROV-06 — no templated model inherits another provider's numbers, and no
 * placeholder price ships unlisted.
 *
 * ---------------------------------------------------------------------------
 * TRAP T9: THE IDS ARE IDENTICAL ON PURPOSE
 * ---------------------------------------------------------------------------
 * `.pi/templates/models-template.json` defines `deepseek-v4-flash` and
 * `deepseek-v4-pro` under `dashscope`, and Pi's built-in catalogue defines the
 * SAME TWO IDS under `deepseek` with a different context window (1,000,000 vs
 * 393,216), a different output cap (384,000 vs 65,536) and a real cost table
 * [VERIFIED: pi-ai 0.84.1 dist/providers/data/deepseek.json]. Copying
 * `contextWindow: 1000000` across is one keystroke, produces a file that parses,
 * validates and composes, and is invisible in review — the failure surfaces much
 * later as an overflow error from the provider instead of as clean compaction.
 * That collision is deliberate: renaming the DashScope ids would dodge the test
 * rather than the bug. This file is the invariant that makes the collision safe.
 *
 * ---------------------------------------------------------------------------
 * THE COST PLACEHOLDER, AND WHY IT IS ASSERTED IN BOTH DIRECTIONS
 * ---------------------------------------------------------------------------
 * Alibaba's public English documentation gives no per-token price for these
 * models — the figure lives in the Model Studio console — so the template ships
 * an all-zero `cost` block as a VISIBLE placeholder. An all-zero cost renders as
 * "free" in a cost report, so the risk is that a number nobody sourced is
 * eventually believed. {@link COST_UNVERIFIED} is asserted both ways: everything
 * on the list really is all-zero, and everything all-zero is on the list, so a
 * new placeholder cannot ship silently and an entry that quietly gained a real
 * price stops being listed as having none. [threat T-03-04-03]
 *
 * DISCHARGED, AND NOW AN ASSERTION. The other half of that coupling — every id
 * on the list is also named in `docs/RUNBOOK.md` under `RB-03-05` — could not be
 * written when this file was created, because `RB-03-05` did not exist until
 * plan 03-11 and a knowingly-red case spanning two waves of an unattended run is
 * worse than a late one. Plan 03-11 created the entry and added the case in the
 * same commit; it is the third describe block below. A placeholder price can
 * therefore no longer ship without a named live check that will replace it: the
 * allowlist is asserted against the composed registry in both directions AND
 * against the runbook.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT PROVE — the live half is RB-03-05
 * ---------------------------------------------------------------------------
 * Everything below is what Pi COMPOSED from the shipped template. The real
 * output cap and the real per-token price cannot be learned on this machine:
 * there is no credential here and no request was issued. They are `RB-03-05` in
 * `docs/RUNBOOK.md` and that entry is OUTSTANDING. A green run here is not
 * evidence that 65,536 is the true cap or that these models are free.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Api, Model } from "@earendil-works/pi-ai";
import { beforeAll, describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { withModelsConfig } from "../helpers/models.ts";

/** The template plan 03-02 shipped. Composed through Pi for every assertion. */
const TEMPLATE = join(repoRoot(), ".pi", "templates", "models-template.json");

/**
 * Every templated model whose `cost` is all zeros, with the reason beside it —
 * the "table of record" shape of `tests/unit/pinning.test.ts:95-102`.
 *
 * Nothing may be added here without a reason, and nothing all-zero may be
 * missing from it; both directions are asserted below.
 */
const COST_UNVERIFIED: string[] = [
	// Alibaba's public English docs give no per-token price for the DeepSeek V4
	// models on Model Studio ("see the Model Studio console"), so zeros are a
	// declared gap rather than a fabricated figure. `RB-03-05` measures the real
	// price on the work laptop and replaces them.
	"dashscope/deepseek-v4-flash",
	"dashscope/deepseek-v4-pro",
];

/**
 * The output cap the template ships, and the mark it must keep.
 *
 * UNVERIFIED and deliberately conservative: Pi sends `max_tokens` only when the
 * caller sets `options.maxTokens`, so a low value costs at most a truncation
 * while a high one risks a 400. `RB-03-05` measures the real cap.
 */
const TEMPLATED_MAX_TOKENS = 65536;

/**
 * The specific collision PROV-06 names, with BOTH sides pinned.
 *
 * Asserting only the DashScope number would still pass if Pi's own catalogue
 * changed underneath — and a catalogue change is exactly the event that should
 * make somebody re-read this file.
 */
const CONTEXT_WINDOW_OF_RECORD: { model: string; dashscope: number; deepseek: number }[] = [
	{
		model: "deepseek-v4-flash",
		// VERIFIED-with-URL: "393,216 in total"
		// [CITED: alibabacloud.com/help/en/model-studio/deepseek-api].
		dashscope: 393216,
		// Pi's built-in direct-DeepSeek entry
		// [VERIFIED: pi-ai 0.84.1 dist/providers/data/deepseek.json].
		deepseek: 1000000,
	},
	{
		model: "deepseek-v4-pro",
		dashscope: 393216,
		deepseek: 1000000,
	},
];

/** The provider the template defines, and the built-in it collides with. */
const TEMPLATED_PROVIDER = "dashscope";
const BUILTIN_PROVIDER = "deepseek";

/** `${provider}/${id}`, the key every table and every set in this file uses. */
function keyOf(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}

/**
 * The models the TEMPLATE contributes, discovered by difference.
 *
 * Pi's registry carries 1,220 built-in models before this template adds
 * anything, so a blanket "no two providers may share a context window for the
 * same id" over the whole registry would be false by design (Bedrock and
 * Anthropic legitimately serve the same Claude models at 200,000). The invariant
 * is about what THIS repository writes, so the enumeration is the difference
 * between a registry composed with the template and one composed without it —
 * no literal to fall out of date, and a third model added to the template is
 * covered automatically.
 *
 * Deliberately not shared with `tests/unit/dashscope-compat.test.ts`, which
 * needs the same difference: a helper in `tests/helpers/` carries a standing
 * obligation to be covered in `tests/unit/helpers.test.ts`, and a duplicated
 * block is a cheaper price than an untested helper.
 */
async function composeRegistrySnapshot(): Promise<{
	all: readonly Model<Api>[];
	templated: Model<Api>[];
}> {
	const baselineKeys = await withModelsConfig({ models: { providers: {} } }, (handle) => {
		return new Set(handle.modelRuntime.getModels().map(keyOf));
	});
	return await withModelsConfig({ models: TEMPLATE }, (handle) => {
		const all = handle.modelRuntime.getModels();
		return { all, templated: all.filter((model) => !baselineKeys.has(keyOf(model))) };
	});
}

let all: readonly Model<Api>[] = [];
let templated: Model<Api>[] = [];

beforeAll(async () => {
	const snapshot = await composeRegistrySnapshot();
	all = snapshot.all;
	templated = snapshot.templated;
});

describe("PROV-06 — the cross-provider invariant", () => {
	it("the template contributes at least one model (guards against a vacuous pass)", () => {
		// Every loop below iterates this set. An empty one -- a renamed `providers`
		// key, a template that stopped validating, a helper composing the wrong
		// file -- would turn the whole invariant into a pass that executed nothing.
		expect(
			templated.length,
			`${TEMPLATE} contributed NO models to a composed registry, so every ` +
				"assertion in this file iterates an empty set and cannot fail. Note that " +
				"typebox accepts an unknown key in silence, so a misspelled `providers` " +
				"entry produces exactly this with no parse error to point at.",
		).toBeGreaterThan(0);
	});

	for (const record of CONTEXT_WINDOW_OF_RECORD) {
		it(`${TEMPLATED_PROVIDER}/${record.model} keeps its own context window, and ${BUILTIN_PROVIDER}/${record.model} keeps its`, () => {
			const ours = all.find(
				(model) => model.provider === TEMPLATED_PROVIDER && model.id === record.model,
			);
			const builtin = all.find(
				(model) => model.provider === BUILTIN_PROVIDER && model.id === record.model,
			);

			expect(
				ours,
				`${TEMPLATED_PROVIDER}/${record.model} did not compose at all. The invariant ` +
					"below cannot be checked, and an absent model is not a passing one.",
			).toBeDefined();
			expect(
				builtin,
				`${BUILTIN_PROVIDER}/${record.model} is not in Pi's built-in catalogue any more. ` +
					"That is the OTHER side of this invariant and its disappearance is a real " +
					"platform change: re-verify the template's numbers against whatever " +
					"replaced it rather than dropping this assertion.",
			).toBeDefined();

			expect(
				ours?.contextWindow,
				`${TEMPLATED_PROVIDER}/${record.model} must carry the sourced DashScope figure ` +
					`${record.dashscope} ("393,216 in total", alibabacloud.com/help/en/model-studio/` +
					"deepseek-api). Anything else -- and 1,000,000 in particular -- means the " +
					"identically-named DeepSeek-direct entry was copied across, which surfaces " +
					"as a provider overflow error instead of clean compaction.",
			).toBe(record.dashscope);

			expect(
				builtin?.contextWindow,
				`Pi's built-in ${BUILTIN_PROVIDER}/${record.model} no longer reports ` +
					`${record.deepseek}. Both sides are pinned deliberately: asserting only the ` +
					"DashScope number would leave this test green while the figure it is " +
					"supposed to differ FROM moved underneath it.",
			).toBe(record.deepseek);

			expect(
				ours?.contextWindow,
				"the two providers now report the SAME context window for the same model id. " +
					"That is the exact PROV-06 failure: one of them inherited the other's number.",
			).not.toBe(builtin?.contextWindow);
		});
	}

	it("no templated model shares a context window with another provider serving the same id", () => {
		const collisions: { templated: Model<Api>; other: Model<Api> }[] = [];
		for (const ours of templated) {
			for (const other of all) {
				if (other.id === ours.id && other.provider !== ours.provider) {
					collisions.push({ templated: ours, other });
				}
			}
		}

		// Non-empty BEFORE the loop that judges them. If nothing collides, the
		// general form of this invariant has nothing to say -- and the most likely
		// reason for that is that somebody renamed the DashScope ids to make the
		// problem go away, which dodges the test rather than the bug.
		expect(
			collisions.length,
			"no templated model id is served by any other provider, so this invariant " +
				"iterated nothing. The DashScope ids are deliberately identical to Pi's " +
				"built-in DeepSeek-direct ids; if they were renamed, PROV-06's real target " +
				"no longer exists and the named cases above are the only cover left.",
		).toBeGreaterThan(0);

		const shared = collisions
			.filter(({ templated: ours, other }) => ours.contextWindow === other.contextWindow)
			.map(
				({ templated: ours, other }) =>
					`${keyOf(ours)} and ${keyOf(other)} both report ${ours.contextWindow}`,
			);

		expect(
			shared,
			"a templated model reports the same context window as a DIFFERENT provider " +
				"serving the same model id. Either the number was copied across (PROV-06's " +
				"named failure) or the two really do agree -- in which case source both " +
				"figures in the template's comments and add the pair to " +
				"CONTEXT_WINDOW_OF_RECORD deliberately.",
		).toEqual([]);
	});

	for (const record of CONTEXT_WINDOW_OF_RECORD) {
		it(`${TEMPLATED_PROVIDER}/${record.model} does not inherit the DeepSeek-direct cost table`, () => {
			const ours = all.find(
				(model) => model.provider === TEMPLATED_PROVIDER && model.id === record.model,
			);
			const builtin = all.find(
				(model) => model.provider === BUILTIN_PROVIDER && model.id === record.model,
			);
			expect(ours, `${TEMPLATED_PROVIDER}/${record.model} did not compose`).toBeDefined();
			expect(builtin, `${BUILTIN_PROVIDER}/${record.model} is not in the catalogue`).toBeDefined();

			// Positive control: the built-in table has real numbers in it. Without
			// this, two all-zero cost blocks would satisfy the inequality below by
			// being equal to nothing, and the case would pass while proving the
			// opposite of its name.
			const builtinTotal = Object.values(builtin?.cost ?? {}).reduce(
				(sum, value) => sum + (typeof value === "number" ? value : 0),
				0,
			);
			expect(
				builtinTotal,
				`Pi's built-in ${BUILTIN_PROVIDER}/${record.model} now reports an all-zero cost, ` +
					"so the inequality below no longer distinguishes 'we kept our placeholder' " +
					"from 'we copied their table'. Re-verify the catalogue.",
			).toBeGreaterThan(0);

			expect(
				ours?.cost,
				`${TEMPLATED_PROVIDER}/${record.model} composed the SAME cost table as ` +
					`${BUILTIN_PROVIDER}/${record.model}. DashScope's per-token price is not ` +
					"published in the English docs (RB-03-05 measures it), so an identical " +
					"table means the direct-DeepSeek numbers were copied across and every " +
					"cost report from here on would quietly bill the wrong provider's rates.",
			).not.toEqual(builtin?.cost);
		});
	}
});

describe("PROV-06 — the COST_UNVERIFIED allowlist", () => {
	it("every model on the list really does compose an all-zero cost", () => {
		expect(
			COST_UNVERIFIED.length,
			"COST_UNVERIFIED is empty, so both directions below iterate nothing",
		).toBeGreaterThan(0);

		const priced: string[] = [];
		for (const key of COST_UNVERIFIED) {
			const model = all.find((candidate) => keyOf(candidate) === key);
			expect(
				model,
				`COST_UNVERIFIED names ${key}, which does not compose. A list entry for a ` +
					"model that no longer exists is coverage that silently stopped applying.",
			).toBeDefined();
			const total = Object.values(model?.cost ?? {}).reduce(
				(sum, value) => sum + (typeof value === "number" ? value : 0),
				0,
			);
			if (total !== 0) {
				priced.push(`${key} costs ${JSON.stringify(model?.cost)}`);
			}
		}

		expect(
			priced,
			"these models are on a list that says their price is unknown, and they now " +
				"carry a real one. Take them off the list in the same change that sources " +
				"the figure -- a stale 'unverified' mark on a real number is as misleading " +
				"as an unmarked placeholder.",
		).toEqual([]);
	});

	it("every all-zero-cost templated model is on the list", () => {
		const unlisted = templated
			.filter((model) => {
				const total = Object.values(model.cost ?? {}).reduce(
					(sum, value) => sum + (typeof value === "number" ? value : 0),
					0,
				);
				return total === 0;
			})
			.map(keyOf)
			.filter((key) => !COST_UNVERIFIED.includes(key));

		expect(
			unlisted,
			"these templated models ship an all-zero cost and are NOT on COST_UNVERIFIED. " +
				"An all-zero cost renders as 'free' in a cost report, so an unlisted one is " +
				"a number a human will eventually believe. Add each to COST_UNVERIFIED with " +
				"its reason, and name it in RB-03-05 so the gap gets measured rather than " +
				"inherited.",
		).toEqual([]);
	});
});

describe("PROV-06 — every placeholder price names the live check that will replace it", () => {
	// Read once, as text. This block is about `docs/RUNBOOK.md` as a DOCUMENT --
	// whether the gap has a named owner -- and not about anything Pi composes.
	const RUNBOOK = readFileSync(join(repoRoot(), "docs", "RUNBOOK.md"), "utf-8");

	it("names RB-03-05 in docs/RUNBOOK.md", () => {
		// POSITIVE CONTROL for the case below, and it is not ceremonial. That case
		// passes vacuously if the allowlist is ever emptied, and it passes against
		// any file that happens to contain two model ids --
		// `.pi/templates/models-template.json` contains both, for instance.
		// Asserting that the file also carries the entry id is what pins the
		// assertion to the runbook rather than to any file with the right words in
		// it.
		expect(
			RUNBOOK,
			"docs/RUNBOOK.md does not mention RB-03-05, the entry that measures the real DashScope " +
				"cap and price. Either the entry was removed -- in which case the placeholders below " +
				"have no owner and must not ship -- or this test is reading the wrong file, in which " +
				"case the case below proves nothing about the runbook.",
		).toContain("RB-03-05");
	});

	it("names every COST_UNVERIFIED model in docs/RUNBOOK.md", () => {
		// Non-empty BEFORE the filter. An emptied allowlist would otherwise satisfy
		// this case by having nothing to look for, which is exactly the state in
		// which an unpriced model is most likely to be shipping unnoticed.
		expect(
			COST_UNVERIFIED.length,
			"COST_UNVERIFIED is empty, so the filter below iterates nothing and this case cannot fail",
		).toBeGreaterThan(0);

		const unnamed = COST_UNVERIFIED.filter((key) => !RUNBOOK.includes(key));

		expect(
			unnamed,
			"these models ship an all-zero cost that renders as 'free' in a cost report, and no entry " +
				"in docs/RUNBOOK.md names them -- so nothing on the work laptop will ever be asked to " +
				"measure the real price. A placeholder with no named live check is not a declared gap, " +
				"it is a number a human will eventually believe. Name each one in RB-03-05, or take it " +
				"off COST_UNVERIFIED in the same change that sources its price.",
		).toEqual([]);
	});
});

describe("PROV-06 — the unverified output cap keeps its mark", () => {
	it(`every templated model caps output at ${TEMPLATED_MAX_TOKENS}`, () => {
		const wrong = templated
			.filter((model) => model.maxTokens !== TEMPLATED_MAX_TOKENS)
			.map((model) => `${keyOf(model)} = ${model.maxTokens}`);

		expect(
			wrong,
			`the templated output cap is deliberately conservative at ${TEMPLATED_MAX_TOKENS}: ` +
				"Pi sends `max_tokens` only when the caller sets `options.maxTokens`, so a low " +
				"value costs at most a truncation while a high one risks a 400 nobody can " +
				"explain. Raising it is RB-03-05's job, after the real cap is measured.",
		).toEqual([]);

		// Paired positive: the built-in entry for the same ids caps at 384,000, so
		// this is a number the template chose rather than one it inherited.
		const builtin = all.find(
			(model) => model.provider === BUILTIN_PROVIDER && model.id === "deepseek-v4-flash",
		);
		expect(
			builtin?.maxTokens,
			"Pi's built-in deepseek-v4-flash no longer caps at 384,000; the contrast that " +
				"makes the templated 65,536 visibly a choice has moved.",
		).toBe(384000);
	});

	it("the file carrying that number still marks it UNVERIFIED", () => {
		// The one assertion in this file that reads the template as text, and it is
		// about the template as a DOCUMENT rather than as configuration: a figure
		// nobody sourced must not be able to lose its mark. Pi strips `//` comments
		// from models.json (`stripJsonComments`, model-config.ts:261), so the mark
		// costs nothing at runtime and is invisible to every other assertion here.
		const text = readFileSync(TEMPLATE, "utf-8");
		expect(
			text,
			`${TEMPLATE} no longer contains the word UNVERIFIED. The output cap and the ` +
				"cost block are both figures this project could not source, and the in-file " +
				"mark is what stops a later reader treating them as measured. If they HAVE " +
				"been measured, RB-03-05 is the entry that records it -- update both together.",
		).toContain("UNVERIFIED");
		expect(
			text,
			`${TEMPLATE} no longer mentions RB-03-05, the runbook entry that measures the ` +
				"unverified figures. A gap with no named owner is a gap nobody closes.",
		).toContain("RB-03-05");
	});
});
