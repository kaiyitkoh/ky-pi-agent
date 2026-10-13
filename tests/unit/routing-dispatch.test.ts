/**
 * ROUTE-01/04/06/07/08/09 — `.pi/extensions/routing/modes.ts`, the PURE half
 * (everything up to and including the mechanism decision), proven with no
 * session and no registry involved.
 *
 * ---------------------------------------------------------------------------
 * ONE FAKE REGISTRY, SCRIPTED PER CASE, SAME CANDIDATE LIST BOTH DIRECTIONS
 * ---------------------------------------------------------------------------
 * `pickConfiguredCandidate`'s registry parameter is the structural
 * `{find, hasConfiguredAuth}` interface `modes.ts` declares -- never
 * `ExtensionContext` -- so a plain object built from a small per-case script
 * satisfies it exactly. The "first resolves, no auth -> second" case and the
 * "first resolves, has auth -> first" case below share the SAME two
 * candidate refs; only the auth script differs. A one-directional test
 * (auth always true) would pass against an implementation that ignores
 * `hasConfiguredAuth` entirely and returns the first candidate that merely
 * resolves -- proving the skip is genuinely on auth, not on resolution,
 * needs both directions on one list.
 *
 * ---------------------------------------------------------------------------
 * THE GUARD-PRECEDENCE CASE COMPARES AGAINST `guardRoute`'S OWN REASON
 * ---------------------------------------------------------------------------
 * Asserting only `ok === false` would pass against an implementation that
 * refused for the WRONG reason (e.g. treating "no configured auth" as a
 * capability block) -- "refused with a reason" is the requirement, not
 * merely "refused". The vision/text-only case below calls `guardRoute`
 * directly with the identical model/role/need and asserts the two reason
 * STRINGS are equal.
 *
 * ---------------------------------------------------------------------------
 * VACUOUS-PASS GUARD (this project's house rule)
 * ---------------------------------------------------------------------------
 * Mode-state cases run a dedicated test
 * that mutates state and then proves the reset helper actually restores the
 * default, rather than trusting a `beforeEach` that might itself be a no-op.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Api, Model } from "@earendil-works/pi-ai";

import { guardRoute } from "../../.pi/extensions/routing/guard.ts";
import {
	bedrockProfilePrefix,
	buildNestedApiOptions,
	getModeState,
	pickConfiguredCandidate,
	planRoleCall,
	resolveRoute,
	setEscalated,
	setMode,
	usesToolLoop,
	type ModeState,
	type ModelRegistryLike,
	type RoleNeed,
} from "../../.pi/extensions/routing/modes.ts";
import { DEFAULT_MODE, ROLE_MAP, ROLES, type ModelRef, type Role } from "../../.pi/extensions/routing/schema.ts";
import { CHAIN } from "../../.pi/extensions/providers/schema.ts";
import { repoRoot } from "../helpers/git.ts";
import { withModelsConfig } from "../helpers/models.ts";

/** The template plan 03-02 shipped -- composed through Pi, never read as literal JSON. */
const TEMPLATE = `${repoRoot()}/.pi/templates/models-template.json`;

// -----------------------------------------------------------------------------
// Fixture builders
// -----------------------------------------------------------------------------

/** A minimal, valid `Model<Api>` -- every required field, overridable. */
function makeModel(overrides: Partial<Model<Api>> = {}): Model<Api> {
	return {
		id: "fixture-model",
		name: "Fixture Model",
		api: "openai-completions",
		provider: "fixture-provider",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
		...overrides,
	};
}

/** One candidate's scripted answer: whether it resolves, and if so, whether it carries auth. */
interface CandidateScript {
	readonly ref: ModelRef;
	readonly model?: Model<Api>;
	readonly authed?: boolean;
}

/** Builds a `ModelRegistryLike` whose `find`/`hasConfiguredAuth` answer exactly what `script` says, nothing inferred. */
function makeRegistry(script: readonly CandidateScript[]): ModelRegistryLike {
	return {
		find(provider, id) {
			const entry = script.find((s) => s.ref.provider === provider && s.ref.id === id);
			return entry?.model;
		},
		hasConfiguredAuth(model) {
			const entry = script.find((s) => s.model === model);
			return entry?.authed ?? false;
		},
	};
}

// -----------------------------------------------------------------------------
// resolveRoute -- ROUTE-03: escalation lifts the executor only
// -----------------------------------------------------------------------------

describe("resolveRoute", () => {
	it("escalated executor differs from non-escalated executor", () => {
		const off = resolveRoute("executor", { mode: "cheap", escalated: false });
		const on = resolveRoute("executor", { mode: "cheap", escalated: true });
		expect(off).not.toEqual(on);
		expect(on).toEqual(ROLE_MAP.max.executor);
	});

	it("every non-executor role's route is identical whether or not escalated is true", () => {
		const nonExecutorRoles = ROLES.filter((role) => role !== "executor");
		expect(nonExecutorRoles.length, "vacuity guard -- ROLES must contain non-executor roles").toBeGreaterThan(0);
		for (const role of nonExecutorRoles) {
			const off = resolveRoute(role, { mode: "balanced", escalated: false });
			const on = resolveRoute(role, { mode: "balanced", escalated: true });
			expect(on, `role "${role}" must be unaffected by escalation`).toEqual(off);
		}
	});
});

// -----------------------------------------------------------------------------
// pickConfiguredCandidate -- ordering, auth-skipping (both directions, same list), refusal naming
// -----------------------------------------------------------------------------

describe("pickConfiguredCandidate", () => {
	const REF_A: ModelRef = { provider: "p", id: "a" };
	const REF_B: ModelRef = { provider: "p", id: "b" };
	const MODEL_A = makeModel({ provider: "p", id: "a" });
	const MODEL_B = makeModel({ provider: "p", id: "b" });

	it("returns the FIRST candidate when it resolves and has auth", () => {
		const registry = makeRegistry([
			{ ref: REF_A, model: MODEL_A, authed: true },
			{ ref: REF_B, model: MODEL_B, authed: true },
		]);
		const result = pickConfiguredCandidate(registry, [REF_A, REF_B]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.ref).toEqual(REF_A);
		}
	});

	it("skips to the SECOND candidate when the first resolves but has no auth -- same candidate list as the case above, auth direction flipped", () => {
		const registry = makeRegistry([
			{ ref: REF_A, model: MODEL_A, authed: false },
			{ ref: REF_B, model: MODEL_B, authed: true },
		]);
		const result = pickConfiguredCandidate(registry, [REF_A, REF_B]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.ref).toEqual(REF_B);
		}
	});

	it("refuses, naming EVERY candidate tried, when no candidate has auth", () => {
		const registry = makeRegistry([
			{ ref: REF_A, model: MODEL_A, authed: false },
			{ ref: REF_B, model: MODEL_B, authed: false },
		]);
		const result = pickConfiguredCandidate(registry, [REF_A, REF_B]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("p/a");
			expect(result.reason).toContain("p/b");
			expect(result.reason).toContain("no configured auth");
		}
	});

	it("names an unresolved candidate distinctly from an unauthenticated one", () => {
		const registry = makeRegistry([
			{ ref: REF_A, model: undefined },
			{ ref: REF_B, model: MODEL_B, authed: false },
		]);
		const result = pickConfiguredCandidate(registry, [REF_A, REF_B]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("did not resolve");
			expect(result.reason).toContain("no configured auth");
		}
	});
});

// -----------------------------------------------------------------------------
// planRoleCall -- guard precedence, and the reason-string comparison
// -----------------------------------------------------------------------------

describe("planRoleCall", () => {
	let agentDir: string;
	let savedAgentDir: string | undefined;
	beforeEach(() => {
		savedAgentDir = process.env.PI_CODING_AGENT_DIR;
		agentDir = mkdtempSync(join(tmpdir(), "kypi-plan-agent-"));
		process.env.PI_CODING_AGENT_DIR = agentDir;
	});
	afterEach(() => {
		if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
		rmSync(agentDir, { recursive: true, force: true });
	});

	it("returns the GUARD's own reason for a vision role planned against a text-only model", () => {
		const ref: ModelRef = { provider: "amazon-bedrock", id: "apac.anthropic.claude-sonnet-4-5-20250929-v1:0" };
		const textOnlyVisionModel = makeModel({ provider: ref.provider, id: ref.id, input: ["text"] });
		const registry = makeRegistry([{ ref, model: textOnlyVisionModel, authed: true }]);
		const need: RoleNeed = { image: true };
		const state: ModeState = { mode: "cheap", escalated: false };

		const result = planRoleCall(registry, { role: "vision", state, need });
		expect(result.ok, `expected a refusal, got ${JSON.stringify(result)}`).toBe(false);

		const directVerdict = guardRoute(textOnlyVisionModel, "vision", { ...need, usesToolLoop: usesToolLoop("vision") });
		expect(directVerdict.ok, "vacuity guard -- the direct guardRoute call must itself refuse for this comparison to mean anything").toBe(false);

		if (!result.ok && !directVerdict.ok) {
			expect(result.reason).toBe(directVerdict.reason);
		}
	});

	it("guard precedence: a role whose only configured candidate is blocked by the guard returns ok:false and NEVER reports a mechanism", () => {
		const executorRoute = ROLE_MAP.cheap.executor;
		expect(executorRoute.candidates.length, "vacuity guard").toBeGreaterThan(0);
		const ref = executorRoute.candidates[0]!;
		// The model's OWN id is the deny-listed one, regardless of which ref was
		// requested -- pickConfiguredCandidate never checks that find() honoured
		// the id it was asked for, and this fake registry is free to answer with
		// whatever fixture the case needs.
		const deniedModel = makeModel({ provider: ref.provider, id: "deepseek.r1-v1:0" });
		const registry = makeRegistry([{ ref, model: deniedModel, authed: true }]);

		const result = planRoleCall(registry, { role: "executor", state: { mode: "cheap", escalated: false }, need: {} });

		expect(result.ok).toBe(false);
		expect("mechanism" in result, "a refusal must never carry a mechanism field").toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("tool calling");
		}
	});

	it("succeeds and reports a mechanism when the guard allows the resolved candidate", () => {
		const summariserRoute = ROLE_MAP.cheap.summariser;
		const ref = summariserRoute.candidates[0]!;
		const okModel = makeModel({ provider: ref.provider, id: ref.id, input: ["text"] });
		const registry = makeRegistry([{ ref, model: okModel, authed: true }]);

		const result = planRoleCall(registry, { role: "summariser", state: { mode: "cheap", escalated: false }, need: {} });

		expect(result.ok, `expected ok:true, got ${JSON.stringify(result)}`).toBe(true);
		if (result.ok) {
			expect(result.mechanism).toBe("call-model");
			expect(result.model).toBe(okModel);
		}
	});
});

// -----------------------------------------------------------------------------
// usesToolLoop -- pure mechanism helper
// -----------------------------------------------------------------------------

describe("usesToolLoop", () => {
	it("is true for executor and planner, false for the four single-shot roles", () => {
		expect(usesToolLoop("executor")).toBe(true);
		expect(usesToolLoop("planner")).toBe(true);
		const singleShotRoles: readonly Role[] = ["reviewer", "advisor", "vision", "summariser"];
		for (const role of singleShotRoles) {
			expect(usesToolLoop(role), `role "${role}" must not use a tool loop`).toBe(false);
		}
	});
});

// -----------------------------------------------------------------------------
// buildNestedApiOptions -- 08-01: the per-model.api nested options bag, proven
// per api id, plus the undefined-effort short circuit and the CHAIN-hop
// homogeneity case (T-08-07).
// -----------------------------------------------------------------------------

describe("buildNestedApiOptions", () => {
	it("returns undefined when effort is undefined, regardless of model.api", () => {
		const openAiModel = makeModel({ api: "openai-completions" });
		const bedrockModel = makeModel({ api: "bedrock-converse-stream" });
		expect(buildNestedApiOptions(openAiModel, undefined)).toBeUndefined();
		expect(buildNestedApiOptions(bedrockModel, undefined)).toBeUndefined();
	});

	it('openai-completions -> { reasoningEffort: effort }, with no "reasoning" field', () => {
		const model = makeModel({ api: "openai-completions" });
		const options = buildNestedApiOptions(model, "high");
		expect(options).toEqual({ reasoningEffort: "high" });
		expect("reasoning" in (options ?? {}), "the openai-completions shape must not also carry the bedrock field name").toBe(false);
	});

	it('bedrock-converse-stream -> { reasoning: effort }, with no "reasoningEffort" field -- the 08-01 fix itself', () => {
		const model = makeModel({ api: "bedrock-converse-stream" });
		const options = buildNestedApiOptions(model, "high");
		expect(options).toEqual({ reasoning: "high" });
		expect(
			"reasoningEffort" in (options ?? {}),
			"the bedrock-converse-stream shape must not carry reasoningEffort -- BedrockOptions has no such " +
				"field and a real adapter would silently ignore it, which is the defect this function fixes",
		).toBe(false);
	});

	it("anthropic-messages throws, naming the model id, rather than inventing a token budget", () => {
		const model = makeModel({ api: "anthropic-messages", provider: "some-anthropic-provider", id: "some-claude-id" });
		expect(() => buildNestedApiOptions(model, "high")).toThrowError(/some-anthropic-provider\/some-claude-id/);
		expect(() => buildNestedApiOptions(model, "high")).toThrowError(/anthropic-messages/);
	});

	it("an api id outside the known three falls back to the openai-completions shape (the historical default, preserved deliberately)", () => {
		// See buildNestedApiOptions's own docstring's DEVIATION section: a faux
		// test fixture that omits `api` gets a RANDOM id from pi-ai
		// (`faux:<timestamp>:<random>`), and single-shot-roles.test.ts relies on
		// this function still treating that the way the pre-08-01 code treated
		// every api -- as the openai-completions shape.
		const model = makeModel({ api: "faux:1234:abcdef" });
		expect(buildNestedApiOptions(model, "max")).toEqual({ reasoningEffort: "max" });
	});

	describe("CHAIN-hop homogeneity (T-08-07)", () => {
		it("every CHAIN entry's resolved model.api produces the SAME shape key as the chain head's", async () => {
			expect(CHAIN.length, "vacuity guard -- an empty CHAIN would make the loop below pass on nothing").toBeGreaterThan(0);

			await withModelsConfig({ models: TEMPLATE }, (handle) => {
				const shapeKeys = CHAIN.map((entry) => {
					const model = handle.requireModel(entry.provider, entry.id);
					const options = buildNestedApiOptions(model, "high");
					expect(options, `${entry.provider}/${entry.id} produced no options for a declared effort`).toBeDefined();
					const keys = Object.keys(options as Record<string, unknown>);
					expect(keys.length, `${entry.provider}/${entry.id}'s nested options bag carried more than one key`).toBe(1);
					return { entry, key: keys[0] };
				});

				const headKey = shapeKeys[0]?.key;
				expect(headKey, "vacuity guard -- CHAIN must have resolved at least one shape key").toBeDefined();

				for (const { entry, key } of shapeKeys) {
					expect(
						key,
						`${entry.provider}/${entry.id}'s nested-call shape key ("${key}") does not match the chain ` +
							`head's ("${headKey}") -- runSingleShotRole computes ONE api options object and ` +
							"callWithFallback reuses it across every hop, so a chain that mixed apis would " +
							"silently mis-shape a later hop's request",
					).toBe(headKey);
				}
			});
		});
	});
});

// -----------------------------------------------------------------------------
// Mode / escalation state -- process-wide slot round-trips, reset proven
// -----------------------------------------------------------------------------

/** Returns the slot to its default via the PUBLIC API only -- no direct globalThis reach-in from a test. */
function resetModeState(): void {
	setEscalated(false);
	setMode(DEFAULT_MODE);
}

describe("mode/escalation state", () => {
	beforeEach(() => {
		resetModeState();
	});

	it("the reset helper is not a no-op: a mutated state genuinely returns to default after reset", () => {
		setMode("max");
		setEscalated(true, "cheap");
		expect(getModeState().mode, "vacuity guard -- the mutation itself must be observable before testing the reset").toBe("max");
		expect(getModeState().escalated).toBe(true);

		resetModeState();

		expect(getModeState().mode).toBe(DEFAULT_MODE);
		expect(getModeState().escalated).toBe(false);
	});

	it("setMode(\"max\") then getModeState().mode === \"max\"", () => {
		setMode("max");
		expect(getModeState().mode).toBe("max");
	});

	it('setEscalated(true, "cheap") records escalatedFrom', () => {
		setEscalated(true, "cheap");
		const state = getModeState();
		expect(state.escalated).toBe(true);
		expect(state.escalatedFrom).toBe("cheap");
	});

	it("setEscalated(false) clears escalatedFrom", () => {
		setEscalated(true, "cheap");
		setEscalated(false);
		const state = getModeState();
		expect(state.escalated).toBe(false);
		expect(state.escalatedFrom).toBeUndefined();
	});

	it("WR-03: a stale/corrupted globalThis slot with an out-of-range mode falls back to DEFAULT_MODE, and resolveRoute never throws on it", () => {
		// Simulate "a stale shape from a version this module no longer writes"
		// -- modes.ts's own getModeState docstring anticipates exactly this.
		// Reaching directly into the process-wide slot by its documented key
		// name is the ONLY way to construct this state: no public setter
		// (setMode/setEscalated) accepts an out-of-range mode, by construction
		// of ModeName -- the bug this case guards is specifically about a value
		// that bypassed that type-level guarantee (a hand-edited session, or an
		// older version of this module that wrote a different mode vocabulary).
		(globalThis as Record<string, unknown>)["__kypiRoutingModeState"] = {
			mode: "turbo",
			escalated: false,
			at: Date.now(),
		};

		const state = getModeState();
		expect(
			state.mode,
			"an out-of-range mode value in the globalThis slot was returned verbatim instead of falling " +
				'back to DEFAULT_MODE -- resolveRoute would then evaluate ROLE_MAP["turbo"][role] -> ' +
				"undefined[role] and throw",
		).toBe(DEFAULT_MODE);
		expect(state.escalated, "the shape check itself must still accept a structurally valid slot").toBe(false);

		// The fix closes the actual crash, not just the symptom: resolveRoute
		// must not throw for ANY role given this corrupted slot.
		for (const role of ROLES) {
			expect(() => resolveRoute(role, state)).not.toThrow();
		}

		resetModeState();
	});
});

describe("Bedrock inference-profile prefix", () => {
	const BASE = "anthropic.claude-sonnet-4-5-20250929-v1:0";
	const candidates: ModelRef[] = [{ provider: "amazon-bedrock", id: BASE }];
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "kypi-prefix-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function settings(body: unknown): string {
		const path = join(dir, "settings.json");
		writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body), "utf-8");
		return path;
	}

	function registryHolding(id: string): ModelRegistryLike {
		const model = makeModel({ provider: "amazon-bedrock", id });
		return makeRegistry([{ ref: { provider: "amazon-bedrock", id }, model, authed: true }]);
	}

	it("defaults to apac. when there is no settings file", () => {
		const result = pickConfiguredCandidate(registryHolding(`apac.${BASE}`), candidates, { settingsPath: join(dir, "none.json") });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.model.id).toBe(`apac.${BASE}`);
	});

	it("defaults to apac. when the key is absent", () => {
		expect(bedrockProfilePrefix(settings({ kyPiAgent: {} }))).toEqual({ ok: true, prefix: "apac." });
	});

	it("uses the configured prefix", () => {
		const path = settings({ kyPiAgent: { bedrockProfilePrefix: "us." } });
		const result = pickConfiguredCandidate(registryHolding(`us.${BASE}`), candidates, { settingsPath: path });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.model.id).toBe(`us.${BASE}`);
	});

	it("an empty prefix selects the bare id", () => {
		const path = settings({ kyPiAgent: { bedrockProfilePrefix: "" } });
		const result = pickConfiguredCandidate(registryHolding(BASE), candidates, { settingsPath: path });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.model.id).toBe(BASE);
	});

	it.each(["us", "x y.", "US.", "toolongprefix.", 7])("refuses an invalid value %j and names the setting", (value) => {
		const path = settings({ kyPiAgent: { bedrockProfilePrefix: value } });
		const result = pickConfiguredCandidate(registryHolding(BASE), candidates, { settingsPath: path });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain("kyPiAgent.bedrockProfilePrefix");
	});

	it("a prefixed id the registry cannot find names the setting and the catalogue prefixes", () => {
		const path = settings({ kyPiAgent: { bedrockProfilePrefix: "apac." } });
		const result = pickConfiguredCandidate(registryHolding(BASE), candidates, { settingsPath: path });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("kyPiAgent.bedrockProfilePrefix");
			for (const prefix of ["au.", "eu.", "global.", "jp.", "us."]) expect(result.reason).toContain(prefix);
		}
	});

	it("leaves non-Bedrock candidates untouched", () => {
		const ref: ModelRef = { provider: "deepseek", id: "deepseek-flash" };
		const model = makeModel({ provider: ref.provider, id: ref.id });
		const result = pickConfiguredCandidate(makeRegistry([{ ref, model, authed: true }]), [ref], { settingsPath: join(dir, "none.json") });
		expect(result.ok).toBe(true);
	});
});
