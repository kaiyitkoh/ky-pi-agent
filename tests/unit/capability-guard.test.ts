/**
 * ROUTE-06/07/08 — `.pi/extensions/routing/guard.ts`, table-driven with a
 * paired negative control for every block.
 *
 * ---------------------------------------------------------------------------
 * TWO ORACLES, AND WHY BOTH ARE THE SAME MECHANISM
 * ---------------------------------------------------------------------------
 * The text-only DashScope case and every Bedrock case below come from the
 * SAME `withModelsConfig({ models: TEMPLATE })` composition, in one
 * `beforeAll`. `05-01-SUMMARY.md` already established (and this file relies
 * on, rather than re-verifying) that `withModelsConfig` composes Pi's FULL
 * built-in catalogue — including every Bedrock entry — alongside the shipped
 * DashScope template, all resolvable through the identical
 * `handle.requireModel(provider, id)` call. There is therefore one honest
 * oracle for every provider this file needs, not a hand-built `Model<Api>`
 * literal for Bedrock and a composed one for DashScope: `requireModel`
 * THROWS naming both ids when a lookup fails (`tests/helpers/models.ts`'s own
 * docstring — "Throw, never opt out"), which is exactly the "assert the read
 * succeeded before using it" the plan requires. A silently-`undefined` R1
 * entry cannot reach any case below; the whole `beforeAll` would fail loudly
 * first.
 *
 * ---------------------------------------------------------------------------
 * FIXTURES, CATALOGUE-VERIFIED (2026-08-14, this machine's installed pi-ai)
 * ---------------------------------------------------------------------------
 *   dashscope/deepseek-v4-flash             input:["text"]           contextWindow:393216
 *   amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0
 *                                            input:["text","image"]  reasoning:true  contextWindow:200000
 *   [Pi 1.1.0: R1 ids removed from catalogue; built locally in beforeAll]
 *   amazon-bedrock/deepseek.r1-v1:0         input:["text"]  reasoning:true  contextWindow:128000
 *   amazon-bedrock/us.deepseek.r1-v1:0      same shape, region-qualified id
 *   amazon-bedrock/deepseek.v3-v1:0         input:["text"]  reasoning:true  contextWindow:163840
 *     — Bedrock, non-Claude, reasoning:true, and NOT on the R1 deny rule.
 *     This is the ROUTE-07 positive AND the "deny-list is not a blanket
 *     Bedrock block" negative control for ROUTE-08 — the same model proves
 *     both, because both blocks need a non-Claude reasoning Bedrock model
 *     that is not R1.
 *
 * ---------------------------------------------------------------------------
 * VACUOUS-PASS GUARD (this project's house rule)
 * ---------------------------------------------------------------------------
 * The row table asserts its own non-emptiness before use, and every
 * `ok:false` case asserts on the reason STRING (contains `${provider}/${id}`
 * plus a block-specific fragment), never merely on `ok === false` — a guard
 * that always names a hardcoded string but never inspects the input would
 * satisfy a bare boolean check.
 */
import { join } from "node:path";

import type { Api, Model } from "@earendil-works/pi-ai";
import { beforeAll, describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { withModelsConfig } from "../helpers/models.ts";
import {
	guardRoute,
	isAnthropicClaudeModel,
	deriveNeed,
	type GuardNeed,
	type GuardVerdict,
} from "../../.pi/extensions/routing/guard.ts";

const TEMPLATE = join(repoRoot(), ".pi", "templates", "models-template.json");

let dashscopeFlash: Model<Api>;
let bedrockClaude: Model<Api>;
let bedrockR1: Model<Api>;
let bedrockR1Us: Model<Api>;
let bedrockR1Global: Model<Api>;
let bedrockR1Eu: Model<Api>;
let bedrockGptOss: Model<Api>;
/** Bedrock, non-Claude, reasoning:true, NOT on the deny-list — see file docstring. */
let bedrockNonClaudeReasoning: Model<Api>;

beforeAll(async () => {
	await withModelsConfig({ models: TEMPLATE }, (handle) => {
		dashscopeFlash = handle.requireModel("dashscope", "deepseek-v4-flash");
		bedrockClaude = handle.requireModel("amazon-bedrock", "anthropic.claude-sonnet-4-5-20250929-v1:0");
		bedrockNonClaudeReasoning = handle.requireModel("amazon-bedrock", "deepseek.v3-v1:0");
		// Pi 1.1.0 dropped deepseek.r1-v1:0 / us.deepseek.r1-v1:0 from the Bedrock
		// catalogue (verified: only deepseek.v3-v1:0 and deepseek.v3.2 remain). The
		// deny-list in guard.ts is id-based and still protects anyone who supplies
		// those ids (custom models.json entry, older Pi), so the fixtures are built
		// locally: same shape as the former catalogue entries (text-only, reasoning).
		const r1Shape = { ...bedrockNonClaudeReasoning, input: ["text"], reasoning: true, contextWindow: 128000 };
		bedrockR1 = { ...r1Shape, id: "deepseek.r1-v1:0", name: "DeepSeek-R1" } as Model<Api>;
		bedrockR1Global = { ...r1Shape, id: "global.deepseek.r1-v1:0", name: "DeepSeek-R1 (Global)" } as Model<Api>;
		bedrockR1Eu = { ...r1Shape, id: "eu.deepseek.r1-v1:0", name: "DeepSeek-R1 (EU)" } as Model<Api>;
		bedrockGptOss = handle.requireModel("amazon-bedrock", "openai.gpt-oss-120b-1:0");
		bedrockR1Us = { ...r1Shape, id: "us.deepseek.r1-v1:0", name: "DeepSeek-R1 (US)" } as Model<Api>;
	});
});

function keyOf(model: Model<Api>): string {
	return `${model.provider}/${model.id}`;
}

interface Row {
	readonly name: string;
	readonly model: () => Model<Api>;
	readonly role: string;
	readonly need: GuardNeed;
	readonly expected: "ok" | "block";
	/** Extra substrings the reason must contain, beyond `${provider}/${id}` (asserted for every "block" row regardless). */
	readonly reasonIncludes?: readonly string[];
}

const ROWS: readonly Row[] = [
	// ---------------------------------------------------------------------
	// ROUTE-06, block 1 — image needed against a text-only model
	// ---------------------------------------------------------------------
	{
		name: 'image needed against dashscope/deepseek-v4-flash (real input:["text"]) -- block',
		model: () => dashscopeFlash,
		role: "vision",
		need: { image: true },
		expected: "block",
		reasonIncludes: ["text"],
	},
	{
		name: 'image needed against a model whose input includes "image" -- ok (paired positive; without it block 1 could be a blanket refusal)',
		model: () => bedrockClaude,
		role: "vision",
		need: { image: true },
		expected: "ok",
	},

	// ---------------------------------------------------------------------
	// ROUTE-07, block 3 — Bedrock non-Claude + thinking, three-way control
	// ---------------------------------------------------------------------
	{
		name: "Bedrock non-Claude, reasoning:true, thinkingRequested:true -- block, the configuration is silently dropped",
		model: () => bedrockNonClaudeReasoning,
		role: "reviewer",
		need: { thinkingRequested: true },
		expected: "block",
		reasonIncludes: ["silently", "bedrock-converse-stream.js:1011"],
	},
	{
		name: "same Bedrock non-Claude model, thinkingRequested:false -- ok (paired negative control)",
		model: () => bedrockNonClaudeReasoning,
		role: "reviewer",
		need: { thinkingRequested: false },
		expected: "ok",
	},
	{
		name: "Bedrock Claude with thinking requested -- ok (Claude is exempt from block 3, it is the model buildAdditionalModelRequestFields actually serves)",
		model: () => bedrockClaude,
		role: "reviewer",
		need: { thinkingRequested: true },
		expected: "ok",
	},

	// ---------------------------------------------------------------------
	// ROUTE-08, block 4 — the R1 deny-list, both ids, both usesToolLoop directions
	// ---------------------------------------------------------------------
	{
		name: "deepseek.r1-v1:0 with usesToolLoop:true -- block",
		model: () => bedrockR1,
		role: "executor",
		need: { usesToolLoop: true },
		expected: "block",
		reasonIncludes: ["tool calling"],
	},
	{
		name: "deepseek.r1-v1:0 with usesToolLoop:false -- ok (the deny-list is role-scoped, not a blanket ban -- RESEARCH Open Question 1)",
		model: () => bedrockR1,
		role: "summariser",
		need: { usesToolLoop: false },
		expected: "ok",
	},
	{
		name: "us.deepseek.r1-v1:0 with usesToolLoop:true -- block (the region-qualified id is covered too)",
		model: () => bedrockR1Us,
		role: "planner",
		need: { usesToolLoop: true },
		expected: "block",
		reasonIncludes: ["tool calling"],
	},
	{
		name: "us.deepseek.r1-v1:0 with usesToolLoop:false -- ok",
		model: () => bedrockR1Us,
		role: "summariser",
		need: { usesToolLoop: false },
		expected: "ok",
	},
	{
		name: "global.deepseek.r1-v1:0 as executor -- block (any inference-profile prefix is covered)",
		model: () => bedrockR1Global,
		role: "executor",
		need: { usesToolLoop: true },
		expected: "block",
		reasonIncludes: ["tool calling"],
	},
	{
		name: "eu.deepseek.r1-v1:0 as executor -- block",
		model: () => bedrockR1Eu,
		role: "executor",
		need: { usesToolLoop: true },
		expected: "block",
		reasonIncludes: ["tool calling"],
	},
	{
		name: "Bedrock gpt-oss with thinking requested -- ok (the request builder sends reasoning_effort for it)",
		model: () => bedrockGptOss,
		role: "reviewer",
		need: { thinkingRequested: true },
		expected: "ok",
	},
	{
		name: "a non-R1 Bedrock model with usesToolLoop:true -- ok (the deny-list is not a blanket Bedrock block)",
		model: () => bedrockNonClaudeReasoning,
		role: "planner",
		need: { usesToolLoop: true },
		expected: "ok",
	},
];

describe("ROUTE-06/07/08 -- guardRoute()", () => {
	it("the fixture table is non-empty (vacuity guard)", () => {
		expect(ROWS.length).toBeGreaterThan(0);
	});

	for (const row of ROWS) {
		it(row.name, () => {
			const model = row.model();
			const verdict: GuardVerdict = guardRoute(model, row.role, row.need);

			if (row.expected === "ok") {
				expect(verdict.ok, `expected ok:true for ${row.name}, got ${JSON.stringify(verdict)}`).toBe(true);
				return;
			}

			expect(verdict.ok, `expected ok:false for ${row.name}, got ${JSON.stringify(verdict)}`).toBe(false);
			if (verdict.ok) {
				return; // unreachable, narrows the type for the reason checks below
			}
			expect(verdict.reason.length, "a block reason must be a non-empty string -- an empty reason is a silent degradation with extra steps").toBeGreaterThan(0);
			expect(verdict.reason, `the reason must name ${keyOf(model)}`).toContain(keyOf(model));
			for (const fragment of row.reasonIncludes ?? []) {
				expect(verdict.reason, `the reason must contain "${fragment}"`).toContain(fragment);
			}
		});
	}
});

describe("ROUTE-06, block 2 -- the context-window block, at-or-below control", () => {
	it("estimatedInputTokens one ABOVE contextWindow -- block, reason names both numbers", () => {
		const model = dashscopeFlash;
		const verdict = guardRoute(model, "summariser", { estimatedInputTokens: model.contextWindow + 1 });
		expect(verdict.ok).toBe(false);
		if (verdict.ok) return;
		expect(verdict.reason).toContain(keyOf(model));
		expect(verdict.reason).toContain(String(model.contextWindow));
		expect(verdict.reason).toContain(String(model.contextWindow + 1));
	});

	it("estimatedInputTokens exactly AT contextWindow -- ok (the boundary itself is not a refusal)", () => {
		const model = dashscopeFlash;
		const verdict = guardRoute(model, "summariser", { estimatedInputTokens: model.contextWindow });
		expect(verdict.ok).toBe(true);
	});

	it("estimatedInputTokens one BELOW contextWindow -- ok (paired negative control)", () => {
		const model = dashscopeFlash;
		const verdict = guardRoute(model, "summariser", { estimatedInputTokens: model.contextWindow - 1 });
		expect(verdict.ok).toBe(true);
	});

	it("no estimatedInputTokens supplied at all -- ok (an absent need must never trigger a block)", () => {
		const model = dashscopeFlash;
		const verdict = guardRoute(model, "summariser", {});
		expect(verdict.ok).toBe(true);
	});
});

describe("isAnthropicClaudeModel -- the three branches of the borrowed predicate", () => {
	it("true for an id containing anthropic.claude", () => {
		expect(bedrockClaude.id.toLowerCase()).toContain("anthropic.claude"); // vacuity guard on the fixture itself
		expect(isAnthropicClaudeModel(bedrockClaude)).toBe(true);
	});

	it('true for a name containing "claude" even when the id does not', () => {
		const synthetic: Model<Api> = { ...bedrockR1, id: "custom.some-model-v1:0", name: "My Claude Variant" };
		expect(isAnthropicClaudeModel(synthetic)).toBe(true);
	});

	it("false for deepseek.r1-v1:0 (neither id nor name mentions Claude)", () => {
		expect(isAnthropicClaudeModel(bedrockR1)).toBe(false);
	});
});

describe("deriveNeed", () => {
	function ctxOf(opts: { tokens?: number | null; thinking?: string; branch?: unknown[] }) {
		return {
			getContextUsage: () => (opts.tokens === undefined ? undefined : { tokens: opts.tokens }),
			thinkingLevel: opts.thinking,
			sessionManager: { getBranch: () => opts.branch ?? [] },
		};
	}
	const imageEntry = { type: "message", message: { role: "user", content: [{ type: "text", text: "x" }, { type: "image", data: "", mimeType: "image/png" }] } };
	const textEntry = { type: "message", message: { role: "user", content: [{ type: "text", text: "x" }] } };

	it("context usage above the window makes a 393216-window model refuse, naming the window", () => {
		const need = deriveNeed(ctxOf({ tokens: 400000 }));
		expect(need.estimatedInputTokens).toBeGreaterThanOrEqual(400000);
		const verdict = guardRoute(dashscopeFlash, "executor", need);
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) expect(verdict.reason).toContain("393216");
	});

	it("adds prompt chars (4 per token) and extra tokens to the usage", () => {
		const need = deriveNeed(ctxOf({ tokens: 100 }), { promptChars: 40, extraTokens: 5 });
		expect(need.estimatedInputTokens).toBe(115);
	});

	it("unknown usage counts as zero", () => {
		expect(deriveNeed(ctxOf({ tokens: null })).estimatedInputTokens).toBe(0);
		expect(deriveNeed(ctxOf({})).estimatedInputTokens).toBe(0);
	});

	it("an image block anywhere in the branch sets image, and a text-only model refuses", () => {
		const need = deriveNeed(ctxOf({ branch: [textEntry, imageEntry] }));
		expect(need.image).toBe(true);
		expect(guardRoute(dashscopeFlash, "executor", need).ok).toBe(false);
		expect(deriveNeed(ctxOf({ branch: [textEntry] })).image).toBe(false);
	});

	it("thinking level off is not a request, any other level is", () => {
		expect(deriveNeed(ctxOf({ thinking: "off" })).thinkingRequested).toBe(false);
		expect(deriveNeed(ctxOf({ thinking: "high" })).thinkingRequested).toBe(true);
		expect(deriveNeed(ctxOf({})).thinkingRequested).toBe(false);
	});

	it("passes usesToolLoop through", () => {
		expect(deriveNeed(ctxOf({}), { usesToolLoop: true }).usesToolLoop).toBe(true);
	});
});
