/**
 * The role-to-model map is complete, resolvable, vision-capable and classification-free. Candidates resolve through
 * withModelsConfig, a real offline registry over the shipped template that also serves Pi's built-in catalogue, so the
 * composed Model is checked, not two spellings of an id. Exports are pinned and matched against a classifier-name
 * regex, so a classifyRole-style export fails twice. Every loop first proves its set is non-empty.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

/** The shipped models template. Composed through Pi for every assertion. */
const TEMPLATE = `${repoRoot()}/.pi/templates/models-template.json`;

/** `docs/ROUTING.md` — the user-facing document the table below is checked against. */
const ROUTING_DOC_PATH = join(repoRoot(), "docs", "ROUTING.md");

/** The six ROADMAP names, in the exact order ROADMAP criterion 1 states them. */
const EXPECTED_ROLES = ["executor", "planner", "reviewer", "advisor", "vision", "summariser"] as const;

/** `/cheap`, `/balanced`, `/max` — the three modes this phase switches between. */
const EXPECTED_MODES = ["cheap", "balanced", "max"] as const;

/** Every value export permitted, sorted; type exports are erased under verbatimModuleSyntax and never appear. */
const PINNED_EXPORTS = [
	"AGENT_NAME_BY_ROLE",
	"BEDROCK_PROFILE_PREFIX_DEFAULT",
	"BEDROCK_PROFILE_PREFIX_SETTING",
	"DEFAULT_MODE",
	"ESCALATION_MODE",
	"MODES",
	"MODE_ENTRY_TYPE",
	"ROLES",
	"ROLE_MAP",
	"ROLE_MECHANISM",
	"ROUTING_EVENT",
].sort();

/** A classifier's name shape: independent of PINNED_EXPORTS, which the same change could extend. */
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

		// Non-vacuity: an emptied map would skip this loop entirely.
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
		// The concrete case: cheap runs the executor on deepseek-v4-flash, max on deepseek-v4-pro.
		expect(ROLE_MAP.cheap.executor.candidates[0].id).toBe("deepseek-flash");
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
		// A regex checked only against a clean export list could be broken unnoticed, so prove it fires.
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

// ---------------------------------------------------------------------------
// docs/ROUTING.md's table agrees with ROLE_MAP in both directions, so the doc never becomes a second source of truth
// ---------------------------------------------------------------------------

/** A `provider/id` token in the three namespaces schema.ts names; the deny-listed R1 ids in §4 carry no prefix. */
const PROVIDER_MODEL_RE = /\b(?:deepseek|dashscope|amazon-bedrock)\/[A-Za-z0-9._:-]+/g;

/** `${provider}/${id}` for a {@link ModelRef}, matching {@link PROVIDER_MODEL_RE}'s own shape. */
function refKey(ref: ModelRef): string {
	return `${ref.provider}/${ref.id}`;
}

/** Every distinct candidate `{provider,id}` named anywhere in `ROLE_MAP`, as `provider/id` strings. */
function everyRoleMapCandidateKey(): Set<string> {
	const keys = new Set<string>();
	for (const mode of MODES) {
		for (const role of ROLES) {
			for (const candidate of ROLE_MAP[mode][role].candidates) {
				keys.add(refKey(candidate));
			}
		}
	}
	return keys;
}

/** The "## 2. The role→model table" section, so a §4 mention of a Bedrock id cannot satisfy or break the check. */
function roleModelTableSection(doc: string): string {
	const start = doc.indexOf("\n## 2. The role→model table");
	expect(
		start,
		"docs/ROUTING.md has no `## 2. The role→model table` heading -- every assertion below scans " +
			"that section, so an absent or renamed heading would make this whole group vacuous",
	).toBeGreaterThan(-1);
	const rest = doc.slice(start + 1);
	const end = rest.indexOf("\n## ");
	return end === -1 ? rest : rest.slice(0, end);
}

describe("ROUTE-01 — docs/ROUTING.md exists and publishes the role→model table", () => {
	it("exists", () => {
		expect(
			existsSync(ROUTING_DOC_PATH),
			"docs/ROUTING.md is the user-facing document the role→model table, the mechanisms, the " +
				"refusals and the foreign-agent caveat are published in",
		).toBe(true);
	});

	const doc = readFileSync(ROUTING_DOC_PATH, "utf-8");
	const tableSection = roleModelTableSection(doc);
	const expectedKeys = everyRoleMapCandidateKey();

	it("collected more than one distinct ROLE_MAP candidate (non-vacuity)", () => {
		expect(
			expectedKeys.size,
			"no distinct {provider,id} pairs were collected from ROLE_MAP -- the checks below would " +
				"iterate nothing and pass without checking a single row",
		).toBeGreaterThan(1);
	});

	it("every ROLE_MAP candidate appears in the document's role→model table", () => {
		const missing = Array.from(expectedKeys).filter((key) => !tableSection.includes(key));
		expect(
			missing,
			"docs/ROUTING.md's role->model table does not name these ROLE_MAP candidates -- a reader of " +
				"the document would not know these routes exist",
		).toEqual([]);
	});

	it("every provider/id token the table names is a real ROLE_MAP candidate (the converse)", () => {
		const found = tableSection.match(PROVIDER_MODEL_RE) ?? [];
		expect(
			found.length,
			"no provider/id-shaped token found in docs/ROUTING.md's table section -- this assertion " +
				"scans that set, so an empty one would pass while verifying nothing",
		).toBeGreaterThan(0);

		const invented = Array.from(new Set(found)).filter((key) => !expectedKeys.has(key));
		expect(
			invented,
			"docs/ROUTING.md's table names these provider/id pairs and ROLE_MAP has no candidate " +
				"matching any of them -- the document has grown a row the code does not have, which is " +
				"exactly how a doc becomes a second, driftable source of truth",
		).toEqual([]);
	});

	it("names all six ROADMAP roles", () => {
		for (const role of ROLES) {
			expect(doc, `docs/ROUTING.md does not name the "${role}" role`).toContain(role);
		}
	});

	it("names the three mode-switch commands", () => {
		for (const mode of MODES) {
			expect(doc, `docs/ROUTING.md does not name the "/${mode}" command`).toContain(`/${mode}`);
		}
	});

	it("names /escalate and /mode", () => {
		expect(doc, "docs/ROUTING.md does not name /escalate").toContain("/escalate");
		expect(doc, "docs/ROUTING.md does not name /mode").toContain("/mode");
	});

	it("states the foreign-agent bypass names all four controls it bypasses", () => {
		for (const cue of ["Pi's own tools", "AGENTS.md", "safety guard", "wire inspector"]) {
			expect(
				doc,
				`docs/ROUTING.md's foreign-agent section must name ${JSON.stringify(cue)} as bypassed`,
			).toContain(cue);
		}
	});

	it("states plainly that Qoder is never a routable model, models.json entry, fallback hop, or guard entry", () => {
		expect(doc).toContain("no `models.json`");
		expect(doc).toContain("no role→model map");
		expect(doc).toContain("no fallback chain");
		expect(doc).toContain("no capability guard");
	});
});
