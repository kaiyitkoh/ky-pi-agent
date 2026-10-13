/**
 * No templated model inherits another provider's numbers, and no placeholder price ships unlisted. The DashScope ids
 * deliberately collide with Pi's built-in direct-DeepSeek ids, which carry a larger window, cap and real cost; copying
 * one across parses and composes and surfaces only as a provider overflow. COST_UNVERIFIED is asserted against the
 * composed registry both ways and against RB-03-05 in docs/RUNBOOK.md, which measures the real cap and price (OUTSTANDING).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Api, Model } from "@earendil-works/pi-ai";
import { beforeAll, describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { withModelsConfig } from "../helpers/models.ts";

/** Composed through Pi for every assertion. */
const TEMPLATE = join(repoRoot(), ".pi", "templates", "models-template.json");

/** Every templated model whose cost is all zeros, each with its reason; asserted in both directions. */
const COST_UNVERIFIED: string[] = [
	// Alibaba's public docs give no per-token price ("see the Model Studio console"); RB-03-05 replaces the zeros.
	"dashscope/deepseek-v4-flash",
	"dashscope/deepseek-v4-pro",
];

/** The shipped output cap: unverified and conservative, since a low value costs a truncation and a high one a 400. */
const TEMPLATED_MAX_TOKENS = 65536;

/** The collision with both sides pinned, so a change to Pi's own catalogue also makes this file re-read. */
const CONTEXT_WINDOW_OF_RECORD: { model: string; builtin: string; dashscope: number; deepseek: number }[] = [
	{
		model: "deepseek-v4-flash",
		// Pi 1.1.0 renamed the direct-DeepSeek flash id; the DashScope id is unchanged.
		builtin: "deepseek-flash",
		// "393,216 in total": https://www.alibabacloud.com/help/en/model-studio/deepseek-api
		dashscope: 393216,
		// Pi's built-in direct-DeepSeek entry (pi-ai dist/providers/data/deepseek.json).
		deepseek: 1000000,
	},
	{
		model: "deepseek-v4-pro",
		builtin: "deepseek-v4-pro",
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
 * The models the template contributes, by registry difference: a registry-wide rule would be false by design (Bedrock
 * and Anthropic legitimately share Claude windows), and a new templated model is covered automatically.
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
		// Every loop below iterates this set, so an empty one would assert nothing.
		expect(
			templated.length,
			`${TEMPLATE} contributed NO models to a composed registry, so every ` +
				"assertion in this file iterates an empty set and cannot fail. Note that " +
				"typebox accepts an unknown key in silence, so a misspelled `providers` " +
				"entry produces exactly this with no parse error to point at.",
		).toBeGreaterThan(0);
	});

	for (const record of CONTEXT_WINDOW_OF_RECORD) {
		it(`${TEMPLATED_PROVIDER}/${record.model} keeps its own context window, and ${BUILTIN_PROVIDER}/${record.builtin} keeps its`, () => {
			const ours = all.find(
				(model) => model.provider === TEMPLATED_PROVIDER && model.id === record.model,
			);
			const builtin = all.find(
				(model) => model.provider === BUILTIN_PROVIDER && model.id === record.builtin,
			);

			expect(
				ours,
				`${TEMPLATED_PROVIDER}/${record.model} did not compose at all. The invariant ` +
					"below cannot be checked, and an absent model is not a passing one.",
			).toBeDefined();
			expect(
				builtin,
				`${BUILTIN_PROVIDER}/${record.builtin} is not in Pi's built-in catalogue any more. ` +
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
				`Pi's built-in ${BUILTIN_PROVIDER}/${record.builtin} no longer reports ` +
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

		// Non-empty first: renaming the DashScope ids to make the collision vanish dodges the test, not the bug.
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
				(model) => model.provider === BUILTIN_PROVIDER && model.id === record.builtin,
			);
			expect(ours, `${TEMPLATED_PROVIDER}/${record.model} did not compose`).toBeDefined();
			expect(builtin, `${BUILTIN_PROVIDER}/${record.builtin} is not in the catalogue`).toBeDefined();

			// Positive control: the built-in table has real numbers, or two zero blocks would satisfy the inequality.
			const builtinTotal = Object.values(builtin?.cost ?? {}).reduce(
				(sum, value) => sum + (typeof value === "number" ? value : 0),
				0,
			);
			expect(
				builtinTotal,
				`Pi's built-in ${BUILTIN_PROVIDER}/${record.builtin} now reports an all-zero cost, ` +
					"so the inequality below no longer distinguishes 'we kept our placeholder' " +
					"from 'we copied their table'. Re-verify the catalogue.",
			).toBeGreaterThan(0);

			expect(
				ours?.cost,
				`${TEMPLATED_PROVIDER}/${record.model} composed the SAME cost table as ` +
					`${BUILTIN_PROVIDER}/${record.builtin}. DashScope's per-token price is not ` +
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
	// Read once, as text: this block is about the runbook as a document.
	const RUNBOOK = readFileSync(join(repoRoot(), "docs", "RUNBOOK.md"), "utf-8");

	it("names RB-03-05 in docs/RUNBOOK.md", () => {
		// Positive control: the template also contains both ids, so the entry id pins this to the runbook.
		expect(
			RUNBOOK,
			"docs/RUNBOOK.md does not mention RB-03-05, the entry that measures the real DashScope " +
				"cap and price. Either the entry was removed -- in which case the placeholders below " +
				"have no owner and must not ship -- or this test is reading the wrong file, in which " +
				"case the case below proves nothing about the runbook.",
		).toContain("RB-03-05");
	});

	it("names every COST_UNVERIFIED model in docs/RUNBOOK.md", () => {
		// Non-empty first: an emptied allowlist would satisfy the case by having nothing to look for.
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
			.filter((model) => model.provider === TEMPLATED_PROVIDER && model.maxTokens !== TEMPLATED_MAX_TOKENS)
			.map((model) => `${keyOf(model)} = ${model.maxTokens}`);

		expect(
			wrong,
			`the templated output cap is deliberately conservative at ${TEMPLATED_MAX_TOKENS}: ` +
				"Pi sends `max_tokens` only when the caller sets `options.maxTokens`, so a low " +
				"value costs at most a truncation while a high one risks a 400 nobody can " +
				"explain. Raising it is RB-03-05's job, after the real cap is measured.",
		).toEqual([]);

		// Paired positive: the built-in entry caps at 384,000, so this figure was chosen, not inherited.
		const builtin = all.find(
			(model) => model.provider === BUILTIN_PROVIDER && model.id === "deepseek-flash",
		);
		expect(
			builtin?.maxTokens,
			"Pi's built-in deepseek-flash no longer caps at 384,000; the contrast that " +
				"makes the templated 65,536 visibly a choice has moved.",
		).toBe(384000);
	});

	it("the file carrying that number still marks it UNVERIFIED", () => {
		// The template as a document: an unsourced figure must keep its mark. Pi strips `//` comments from models.json
		// (stripJsonComments), so the mark costs nothing at runtime.
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
			`${TEMPLATE} no longer names the runbook check that measures the unverified figures ` +
				"(by its title, since comments carry no IDs). A gap with no named owner is a gap nobody closes.",
		).toContain("the real DashScope context cap and per-token price");
	});
});

describe("the templated Bedrock Sonnet 4.5 profile", () => {
	const APAC_ID = "apac.anthropic.claude-sonnet-4-5-20250929-v1:0";

	it("composes with image input and a Claude-matching name, next to the catalogued bare id", () => {
		const apac = all.find((model) => model.provider === "amazon-bedrock" && model.id === APAC_ID);
		expect(apac, `amazon-bedrock/${APAC_ID} did not compose from the template`).toBeDefined();
		expect(apac?.input).toContain("image");
		expect(apac?.name.toLowerCase()).toContain("claude");
		expect(apac?.reasoning).toBe(true);

		const bare = all.find(
			(model) => model.provider === "amazon-bedrock" && model.id === "anthropic.claude-sonnet-4-5-20250929-v1:0",
		);
		expect(bare, "the catalogued bare Sonnet 4.5 entry must survive the template merge").toBeDefined();
	});

	it("is the only Bedrock model the template adds", () => {
		const added = templated.filter((model) => model.provider === "amazon-bedrock").map(keyOf);
		expect(added).toEqual([`amazon-bedrock/${APAC_ID}`]);
	});
});
