/**
 * ROUTE-01 — the role→model map is complete, resolvable, vision-capable and
 * classification-free.
 *
 * ---------------------------------------------------------------------------
 * WHY A COMPOSED REGISTRY, NOT THE TEMPLATE'S LITERAL JSON
 * ---------------------------------------------------------------------------
 * `.pi/extensions/routing/schema.ts` names model ids as plain strings. A test
 * that only checked those strings against `.pi/templates/models-template.json`
 * would prove the ids are spelled the same in two files, not that Pi can
 * actually resolve them into a real `Model<Api>`. `withModelsConfig` is the
 * honest oracle this repository already uses for exactly this reason
 * (`tests/unit/model-metadata.test.ts`, `tests/unit/r1-unclamp.test.ts`):
 * it builds a real, offline `ModelRuntime`/`ModelRegistry` pair over the
 * shipped template and returns the COMPOSED model — `contextWindow`, `input`
 * and `compat` as Pi built them, not as the JSON states them.
 *
 * ONE SURPRISE WORTH RECORDING: `withModelsConfig` over the shipped template
 * resolves BOTH the DashScope entries the template defines AND Pi's built-in
 * catalogue entries (DeepSeek-direct, every Bedrock model) through the same
 * `registry.find(provider, id)` call — verified live on this machine,
 * 2026-08-14, `node -e` against `ModelRuntime.create({..., refreshOnCreate:
 * false})`: `registry.find("amazon-bedrock",
 * "anthropic.claude-sonnet-4-5-20250929-v1:0")` returned a real model with
 * `input:["text","image"]`, and `rt.getModels().length` was 1220. So every
 * candidate in `ROLE_MAP` — DashScope, DeepSeek-direct and Bedrock alike —
 * resolves through the SAME oracle, with no second, hand-rolled reader of the
 * installed `pi-ai` catalogue JSON needed.
 *
 * ---------------------------------------------------------------------------
 * THE NO-AUTO-CLASSIFICATION ASSERTION IS A REAL GATE, NOT A SLOGAN
 * ---------------------------------------------------------------------------
 * "No auto-classification, explicit role→model mapping" is this project's
 * first Key Decision. `PINNED_EXPORTS` below is the machine check that keeps
 * it true: the module's exported names are compared against a pinned list,
 * and independently against a regex, so a future `classifyRole`/`detectRole`/
 * `inferRole` export fails on BOTH — one because it is not on the list, one
 * because it matches the shape a classifier's name always takes.
 *
 * ---------------------------------------------------------------------------
 * VACUOUS-PASS GUARDS (this repo's house rule)
 * ---------------------------------------------------------------------------
 * Every loop below iterates a non-empty set before it is trusted to say
 * anything: `ROLES`/`MODES` are asserted non-empty, the non-vacuity control
 * proves the map is not a single model copy-pasted six times, and the
 * candidate-resolution loop is asserted to have actually visited more than
 * one `{provider,id}` pair before its own negative assertion is trusted.
 */
import { describe, expect, it } from "vitest";

import {
	AGENT_NAME_BY_ROLE,
	DEFAULT_MODE,
	ESCALATION_MODE,
	MODE_ENTRY_TYPE,
	MODES,
	ROLE_MAP,
	ROLE_MECHANISM,
	ROLES,
	ROUTING_EVENT,
	type Mechanism,
	type ModeName,
	type ModelRef,
	type Role,
} from "../../.pi/extensions/routing/schema.ts";
import { repoRoot } from "../helpers/git.ts";
import { withModelsConfig } from "../helpers/models.ts";

/** The template plan 03-02 shipped. Composed through Pi for every assertion. */
const TEMPLATE = `${repoRoot()}/.pi/templates/models-template.json`;

/** The six ROADMAP names, in the exact order ROADMAP criterion 1 states them. */
const EXPECTED_ROLES = ["executor", "planner", "reviewer", "advisor", "vision", "summariser"] as const;

/** `/cheap`, `/balanced`, `/max` — the three modes this phase switches between. */
const EXPECTED_MODES = ["cheap", "balanced", "max"] as const;

/**
 * Every value this module is permitted to export, sorted.
 *
 * A NEW EXPORT NOT ON THIS LIST FAILS HERE FIRST. `export type` declarations
 * (`Role`, `ModeName`, `Mechanism`, `ModelRef`, `RoleRoute`, `KyModeData`) are
 * erased at the type-only import boundary and never appear as runtime keys of
 * the imported namespace — `verbatimModuleSyntax` guarantees this, so the
 * list below only needs the VALUE exports.
 */
const PINNED_EXPORTS = [
	"AGENT_NAME_BY_ROLE",
	"DEFAULT_MODE",
	"ESCALATION_MODE",
	"MODES",
	"MODE_ENTRY_TYPE",
	"ROLES",
	"ROLE_MAP",
	"ROLE_MECHANISM",
	"ROUTING_EVENT",
].sort();

/**
 * The shape a classifier's own name always takes. Independent of
 * {@link PINNED_EXPORTS}: a new export could in principle be added to the
 * pinned list by the same change that introduces it, so the regex is the
 * second, independent guard this project's first Key Decision gets.
 */
const CLASSIFIER_NAME_RE = /classif|detect|infer|guess/i;

/** `${provider}/${id}`, the key used to dedupe candidates before resolving. */
function keyOf(ref: ModelRef): string {
	return `${ref.provider}/${ref.id}`;
}

describe("ROUTE-01 — ROLES and MODES are the exact, stable ROADMAP vocabulary", () => {
	it("ROLES equals the six ROADMAP names, in this exact order", () => {
		expect(ROLES.length, "ROLES must not be empty — every loop below iterates it").toBeGreaterThan(0);
		expect(ROLES).toEqual(EXPECTED_ROLES);
	});

	it("MODES equals cheap/balanced/max, in this exact order", () => {
		expect(MODES.length, "MODES must not be empty — every loop below iterates it").toBeGreaterThan(0);
		expect(MODES).toEqual(EXPECTED_MODES);
	});
});

describe("ROUTE-01 — every mode covers every role with a non-empty candidate list", () => {
	for (const mode of MODES) {
		for (const role of ROLES) {
			it(`${mode}.${role} has a RoleRoute with a non-empty candidates array`, () => {
				const route = ROLE_MAP[mode][role];
				expect(route, `ROLE_MAP.${mode}.${role} is missing entirely`).toBeDefined();
				expect(
					route.candidates.length,
					`ROLE_MAP.${mode}.${role}.candidates is empty — a role with no candidate is unroutable by construction`,
				).toBeGreaterThan(0);
			});
		}
	}
});

describe("ROUTE-01 — every candidate resolves through the same composed registry oracle", () => {
	it("every {provider,id} in ROLE_MAP resolves via withModelsConfig over the shipped template", async () => {
		const seen = new Map<string, ModelRef>();
		for (const mode of MODES) {
			for (const role of ROLES) {
				for (const candidate of ROLE_MAP[mode][role].candidates) {
					seen.set(keyOf(candidate), candidate);
				}
			}
		}

		// Non-vacuity: a map with one shared candidate list per role would still
		// exercise this loop, but an empty map (every route emptied) would not —
		// the earlier "non-empty candidates" describe block already forbids that,
		// this is the belt-and-braces guard for THIS test file specifically.
		expect(
			seen.size,
			"no distinct {provider,id} pairs were collected from ROLE_MAP — the resolution loop below " +
				"would iterate nothing and this test would pass without checking a single model id",
		).toBeGreaterThan(1);

		await withModelsConfig({ models: TEMPLATE }, (handle) => {
			const unresolved: string[] = [];
			for (const ref of seen.values()) {
				const model = handle.registry.find(ref.provider, ref.id);
				if (!model) {
					unresolved.push(keyOf(ref));
				}
			}
			expect(
				unresolved,
				"these ROLE_MAP candidates did not resolve against a registry composed from the shipped " +
					"models template — a router built against them would refuse at runtime for a reason " +
					"nobody planned",
			).toEqual([]);
		});
	});
});

describe("ROUTE-01 — the vision role is routable, not a refusal by construction", () => {
	it("every mode's vision route's first candidate resolves to a model whose input includes \"image\"", async () => {
		await withModelsConfig({ models: TEMPLATE }, (handle) => {
			for (const mode of MODES) {
				const first = ROLE_MAP[mode].vision.candidates[0];
				expect(first, `ROLE_MAP.${mode}.vision has no first candidate`).toBeDefined();
				const model = handle.requireModel(first.provider, first.id);
				expect(
					model.input,
					`ROLE_MAP.${mode}.vision's first candidate (${keyOf(first)}) does not carry "image" in ` +
						"its composed input — the vision role would be a silent refusal, not a routed request",
				).toContain("image");
			}
		});
	});

	it("no mode assigns vision to a dashscope model (both daily-driver models are text-only)", () => {
		for (const mode of MODES) {
			const dashscopeVisionCandidates = ROLE_MAP[mode].vision.candidates.filter(
				(ref) => ref.provider === "dashscope",
			);
			expect(
				dashscopeVisionCandidates,
				`ROLE_MAP.${mode}.vision names a dashscope candidate. Both DashScope daily-driver models ` +
					'are "input":["text"] (RESEARCH §A.6) — a dashscope vision candidate is unroutable by ' +
					"construction, not merely undesirable",
			).toEqual([]);
		}
	});
});

describe("ROUTE-01 — ROLE_MECHANISM assigns exactly the mechanism THREE-MECHANISMS names", () => {
	it("covers every role with no gaps", () => {
		for (const role of ROLES) {
			expect(ROLE_MECHANISM[role], `ROLE_MECHANISM has no entry for ${role}`).toBeDefined();
		}
	});

	const expected: Record<Role, Mechanism> = {
		executor: "set-model",
		planner: "subagent",
		reviewer: "call-model",
		advisor: "call-model",
		vision: "call-model",
		summariser: "call-model",
	};

	for (const role of ROLES) {
		it(`${role} is "${expected[role]}"`, () => {
			expect(ROLE_MECHANISM[role]).toBe(expected[role]);
		});
	}
});

describe("ROUTE-01 — reasoningEffort is a per-ROLE constant, never a per-mode one", () => {
	for (const role of ROLES) {
		it(`${role} carries the same reasoningEffort in every mode`, () => {
			const efforts = MODES.map((mode) => ROLE_MAP[mode][role].reasoningEffort);
			const distinct = new Set(efforts);
			expect(
				distinct.size,
				`${role}'s reasoningEffort differs across modes (${JSON.stringify(efforts)}) — STATE.md's ` +
					"open blocker R1 says modes must differ by MODEL, never by thinking tier",
			).toBe(1);
		});
	}

	it("reviewer and advisor both request high effort; the other four request none", () => {
		for (const mode of MODES) {
			expect(ROLE_MAP[mode].reviewer.reasoningEffort).toBe("high");
			expect(ROLE_MAP[mode].advisor.reasoningEffort).toBe("high");
			for (const role of ["executor", "planner", "vision", "summariser"] as const) {
				expect(
					ROLE_MAP[mode][role].reasoningEffort,
					`${mode}.${role} carries a reasoningEffort; only reviewer and advisor should`,
				).toBeUndefined();
			}
		}
	});
});

describe("ROUTE-01 — non-vacuity: the map is not one model copy-pasted six times", () => {
	it("at least one role's first candidate model id differs between cheap and max", () => {
		const differing = ROLES.filter((role) => {
			const cheapFirst = ROLE_MAP.cheap[role].candidates[0];
			const maxFirst = ROLE_MAP.max[role].candidates[0];
			return keyOf(cheapFirst) !== keyOf(maxFirst);
		});
		expect(
			differing.length,
			"every role names the SAME first candidate in cheap and max — a map that never changes " +
				"model by mode would satisfy every other assertion in this file while doing nothing " +
				"ROUTE-01 asks for",
		).toBeGreaterThan(0);
	});

	it("executor's first candidate is the flash tier in cheap and the pro tier in max", () => {
		// Named directly, not just asserted generically: this is the concrete case
		// the plan itself states ("cheap ... executor ... on deepseek-v4-flash",
		// "max: executor ... on deepseek-v4-pro").
		expect(ROLE_MAP.cheap.executor.candidates[0].id).toBe("deepseek-v4-flash");
		expect(ROLE_MAP.max.executor.candidates[0].id).toBe("deepseek-v4-pro");
	});
});

describe("ROUTE-01 — no auto-classification path exists", () => {
	it("the module's exported names match the pinned list exactly", async () => {
		const namespace = (await import("../../.pi/extensions/routing/schema.ts")) as Record<string, unknown>;
		const actual = Object.keys(namespace).sort();
		expect(
			actual,
			"routing/schema.ts's runtime export list changed. This project's first Key Decision is " +
				'"explicit role→model mapping, no auto-classification" — a new export must be added to ' +
				"PINNED_EXPORTS deliberately, in the same review that adds it, not discovered here by accident",
		).toEqual(PINNED_EXPORTS);
	});

	it("no exported name matches the shape a classifier's own name takes", async () => {
		const namespace = (await import("../../.pi/extensions/routing/schema.ts")) as Record<string, unknown>;
		const suspicious = Object.keys(namespace).filter((name) => CLASSIFIER_NAME_RE.test(name));
		expect(
			suspicious,
			"an export matches /classif|detect|infer|guess/i — a classifyRole/detectRole/inferRole would " +
				"be exactly the auto-classification path ROUTE-01 forbids",
		).toEqual([]);
	});

	it("the regex fires against a classifier-shaped name (guards against a dead pattern)", () => {
		// Proven live, the same way tests/unit/chokepoint-lint.test.ts proves its
		// own FORBIDDEN patterns are live: a regex checked only against a clean
		// export list is a regex that could be silently broken and never noticed.
		for (const offending of ["classifyRole", "detectRole", "inferRole", "guessRole"]) {
			expect(CLASSIFIER_NAME_RE.test(offending), `${offending} did not match CLASSIFIER_NAME_RE`).toBe(true);
		}
		expect(CLASSIFIER_NAME_RE.test("ROLE_MAP"), "ROLE_MAP false-positived against CLASSIFIER_NAME_RE").toBe(
			false,
		);
	});
});

describe("ROUTE-01 — mode/escalation vocabulary the rest of the phase depends on", () => {
	it("DEFAULT_MODE is cheap and ESCALATION_MODE is max", () => {
		expect(DEFAULT_MODE).toBe("cheap" satisfies ModeName);
		expect(ESCALATION_MODE).toBe("max" satisfies ModeName);
	});

	it("MODE_ENTRY_TYPE and ROUTING_EVENT are non-empty, namespaced strings", () => {
		expect(MODE_ENTRY_TYPE).toBe("ky:mode");
		expect(ROUTING_EVENT).toBe("ky.routing.mode_changed");
	});

	it("AGENT_NAME_BY_ROLE names an override only for subagent-mechanism roles", () => {
		for (const role of Object.keys(AGENT_NAME_BY_ROLE) as Role[]) {
			expect(
				ROLE_MECHANISM[role],
				`AGENT_NAME_BY_ROLE names ${role}, but its mechanism is "${ROLE_MECHANISM[role]}", not "subagent"`,
			).toBe("subagent");
		}
		expect(AGENT_NAME_BY_ROLE.planner, "planner is the one role this phase assigns to a subagent").toBe(
			"planner",
		);
	});
});
