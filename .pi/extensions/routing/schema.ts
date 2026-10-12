/**
 * ky-pi-agent — the role→model map and mode vocabulary (ROUTE-01).
 *
 * ---------------------------------------------------------------------------
 * PURPOSE
 * ---------------------------------------------------------------------------
 * This is the phase. Every later routing plan reads it: the `/cheap`,
 * `/balanced`, `/max` and `/escalate` commands (ROUTE-02/03) resolve their
 * target model from {@link ROLE_MAP}; the capability guard's callers pass its
 * candidates through the guard before dispatch (ROUTE-06/07/08); the
 * single-shot dispatcher picks {@link ROLE_MECHANISM} to decide whether a role
 * is a `setModel`, a nested completion or a subagent (ROUTE-04/05); the
 * `settings.subagents.agentOverrides` writer reads {@link AGENT_NAME_BY_ROLE}
 * (ROUTE-05); and `docs/ROUTING.md` documents this table rather than
 * duplicating it. A map with an unresolvable model id, a missing role, or a
 * silently text-only vision entry produces a router that refuses at runtime
 * for reasons nobody planned — `tests/unit/routing-map.test.ts` is what makes
 * every entry provably resolvable before any of that code exists.
 *
 * Named exports only. No default export: a statement-position `export
 * default` would make `tests/unit/extension-layout.test.ts` classify this
 * file as an entry point that must sit at an auto-discovered path
 * (`.pi/extensions/routing.ts` or `.pi/extensions/routing/index.ts`), which
 * this file is not. No filesystem access, no environment reads, no `ctx` —
 * this module is a table, matching `.pi/extensions/providers/schema.ts` and
 * `.pi/extensions/diagnostics/schema.ts`'s purity discipline exactly.
 *
 * ---------------------------------------------------------------------------
 * THE THREE-MECHANISMS DECISION (05-CONTEXT.md decision 1)
 * ---------------------------------------------------------------------------
 * Routing is three mechanisms, not one, and which one applies is decided by
 * the ROLE, not per turn:
 *
 *   - executor + `/escalate` → a command handler calls Pi's own model-switch
 *     entry point after waiting for the session to go idle. The mutation is
 *     session-visible on purpose: the user can see what they are paying for.
 *   - reviewer / advisor / vision / summariser → a single-shot nested
 *     completion through Phase 2's diagnostics chokepoint, per-call reasoning
 *     effort, no session mutation.
 *   - planner → a subagent, because it reads files and therefore needs a tool
 *     loop that a single nested completion cannot provide. **Planner is the
 *     one role ROADMAP criterion 4 does not explicitly assign** — state that
 *     reasoning beside {@link ROLE_MECHANISM}'s `planner` entry so nobody
 *     "simplifies" it into a single-shot call later (ROUTE-05).
 *
 * ---------------------------------------------------------------------------
 * CANDIDATE ORDERING RULE
 * ---------------------------------------------------------------------------
 * Each {@link RoleRoute.candidates} array is an ORDERED list of
 * `{provider,id}`, and for DeepSeek models the order is DeepSeek-direct →
 * DashScope — the same order as `.pi/extensions/providers/schema.ts`'s
 * `CHAIN`. It exists because a model switch needs a target whose provider has
 * configured auth on THIS machine, and the two providers serve the same
 * model under different credentials.
 *
 * THIS IS NOT A SECOND FALLBACK CHAIN. No code in `routing/` re-implements
 * the retry/fallback machinery `providers/fallback.ts` already owns, and a
 * nested single-shot completion for a candidate still goes through the
 * diagnostics chokepoint unchanged (05-CONTEXT.md decision 10). This array
 * only orders which provider a caller tries first when more than one serves
 * the same model id; it carries no retry, backoff or classification logic of
 * its own.
 *
 * ---------------------------------------------------------------------------
 * REASONING-EFFORT RULE — MODES DIFFER BY MODEL, NEVER BY THINKING TIER
 * ---------------------------------------------------------------------------
 * `reasoningEffort` is a per-ROLE constant, never a per-mode one. `reviewer`
 * and `advisor` carry `"high"` in every mode; `executor`, `planner`, `vision`
 * and `summariser` carry none in every mode. This is binding, not a style
 * choice: STATE.md's open blocker R1 says `/cheap` must NOT be defined in
 * terms of a cheap thinking tier, because Pi 0.84.1 clamps `low` to `high`
 * for the daily-driver models anyway and the token-cost question
 * (`RB-03-04`) is still OUTSTANDING. `ROLE_MAP`'s three modes differ only in
 * WHICH MODEL serves each role — never in how hard that model is asked to
 * think.
 *
 * ---------------------------------------------------------------------------
 * LAYOUT — what the rest of `routing/` owns
 * ---------------------------------------------------------------------------
 *   - `schema.ts` (this file) — the pure role→model map and mode vocabulary.
 *     ROUTE-01.
 *   - `guard.ts` — the pure capability-guard predicate over a resolved
 *     `Model<Api>` and a role's needs. ROUTE-06/07/08.
 *   - `modes.ts` — the impure layer: mode/escalation state, the single-shot
 *     dispatcher that calls the diagnostics chokepoint, and the
 *     `pi.appendEntry`/`session_start` mode-name persistence recipe.
 *     ROUTE-02/03/04/09/10.
 *   - `agent-overrides.ts` — the `settings.subagents.agentOverrides`
 *     read-modify-write helper. ROUTE-05.
 *   - `index.ts` — the extension entry point: registers the mode commands and
 *     the `session_start` restore hook, composing the modules above.
 *
 * This file's own docstring must not spell the two forbidden direct-model
 * routes even in prose — `tests/unit/chokepoint-lint.test.ts` scans raw
 * source text, comments included, and grants `routing/` no exemption. They
 * are described here rather than named: the direct-completion method on the
 * model registry, and the method that hands back a raw provider object.
 * Every nested single-shot call this subsystem makes goes through Phase 2's
 * `callModel()` (or Phase 3's `callWithFallback()`, which itself calls
 * `callModel()`) — never a second chokepoint.
 */

/**
 * The six roles ROADMAP criterion 1 names, verbatim and in this exact order.
 *
 * Do not rename or add to this list — it is the phase's own spec, not an
 * implementation detail.
 */
export const ROLES = ["executor", "planner", "reviewer", "advisor", "vision", "summariser"] as const;

/** One of {@link ROLES}. */
export type Role = (typeof ROLES)[number];

/** The three modes `/cheap`, `/balanced` and `/max` switch between. */
export const MODES = ["cheap", "balanced", "max"] as const;

/** One of {@link MODES}. */
export type ModeName = (typeof MODES)[number];

/**
 * Which of the three mechanisms (see the THREE-MECHANISMS section above)
 * serves a role.
 */
export type Mechanism = "set-model" | "call-model" | "subagent";

/**
 * Every role's mechanism, explicit rather than inferred.
 *
 * `planner` is `"subagent"`: it is the one role ROADMAP criterion 4 does not
 * explicitly assign, and it needs a tool loop in any realistic reading — it
 * reads files — so it cannot be a single nested completion. `executor` is
 * `"set-model"`, the only role that mutates the session's own model.
 * `reviewer`, `advisor`, `vision` and `summariser` are the single-shot four
 * ROUTE-04 names explicitly.
 */
export const ROLE_MECHANISM: Record<Role, Mechanism> = {
	executor: "set-model",
	// See THREE-MECHANISMS above: planner needs a tool loop (it reads files),
	// so it is a subagent, never a single-shot nested completion. Do not
	// "simplify" this to call-model — a role that reads files cannot be served
	// by one request/response pair.
	planner: "subagent",
	reviewer: "call-model",
	advisor: "call-model",
	vision: "call-model",
	summariser: "call-model",
};

/** A resolvable model reference: the two arguments a registry lookup takes. */
export interface ModelRef {
	/** Pi's provider id — the first argument the registry's lookup takes. */
	readonly provider: string;
	/** The model id within that provider. */
	readonly id: string;
}

/**
 * One role's route for one mode: an ordered candidate list plus the role's
 * fixed reasoning effort (see REASONING-EFFORT RULE above — never varied by
 * mode).
 */
export interface RoleRoute {
	/**
	 * Ordered `{provider,id}` candidates. See CANDIDATE ORDERING RULE above:
	 * DeepSeek-direct before DashScope for DeepSeek models. Never empty.
	 */
	readonly candidates: readonly ModelRef[];
	/**
	 * The SAME value in every mode for a given role (asserted by
	 * `tests/unit/routing-map.test.ts`). Omitted for roles that never request
	 * elevated reasoning.
	 */
	readonly reasoningEffort?: "high" | "max";
}

// ---------------------------------------------------------------------------
// Model ids — catalogue-verified, not invented.
// ---------------------------------------------------------------------------
//
// DashScope ids come from `.pi/templates/models-template.json`
// (`deepseek-v4-flash`, `deepseek-v4-pro`, both `"input":["text"]`,
// `contextWindow: 393216` — the daily drivers). DeepSeek-direct ids come from
// Pi's built-in `deepseek` catalogue (flash is `deepseek-flash` since Pi 1.1.0; pro is identically named)
// at `contextWindow: 1000000` (PROV-06's deliberate collision).
//
// The Bedrock Claude id was enumerated, not guessed:
//
//   node -e "const m = require('<pi-ai>/dist/providers/data/amazon-bedrock.json');
//     const entries = Object.values(m['bedrock-converse-stream']);
//     console.log(entries.filter(x => /claude/i.test(x.id)).map(x => x.id));"
//
// run against this machine's installed
// `@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/data/amazon-bedrock.json`
// on 2026-08-14. `anthropic.claude-sonnet-4-5-20250929-v1:0` is present,
// `"input":["text","image"]`, `reasoning:true`, `contextWindow:200000` — the
// vision role's only real answer, since both DashScope daily-driver models
// are text-only (RESEARCH §A.6). Never write a Bedrock id here that has not
// been seen in that catalogue: `tests/unit/routing-map.test.ts` resolves
// every one of them and will fail on a fabricated id.

/** DeepSeek V4.1 Flash, direct (Pi 1.1.0 built-in id `deepseek-flash`; `deepseek-v4-flash` was retired upstream) -- first hop. */
const DEEPSEEK_DIRECT_FLASH: ModelRef = { provider: "deepseek", id: "deepseek-flash" };

/** DeepSeek V4 Pro, direct. */
const DEEPSEEK_DIRECT_PRO: ModelRef = { provider: "deepseek", id: "deepseek-v4-pro" };

/** DeepSeek V4 Flash, served by DashScope under an identical id (PROV-06). */
const DASHSCOPE_FLASH: ModelRef = { provider: "dashscope", id: "deepseek-v4-flash" };

/** DeepSeek V4 Pro, served by DashScope under an identical id (PROV-06). */
const DASHSCOPE_PRO: ModelRef = { provider: "dashscope", id: "deepseek-v4-pro" };

/**
 * Claude Sonnet 4.5 on Bedrock — the only vision-capable model this project
 * has verified in the catalogue. No DashScope/DeepSeek fallback exists for
 * it, so its candidate list has exactly one entry.
 */
const BEDROCK_CLAUDE: ModelRef = { provider: "amazon-bedrock", id: "anthropic.claude-sonnet-4-5-20250929-v1:0" };

/** DeepSeek-direct then DashScope — the flash tier's ordered candidates. */
const FLASH_CANDIDATES: readonly ModelRef[] = [DEEPSEEK_DIRECT_FLASH, DASHSCOPE_FLASH];

/** DeepSeek-direct then DashScope — the pro tier's ordered candidates. */
const PRO_CANDIDATES: readonly ModelRef[] = [DEEPSEEK_DIRECT_PRO, DASHSCOPE_PRO];

/** The one vision-capable candidate. No DeepSeek fallback exists for it. */
const VISION_CANDIDATES: readonly ModelRef[] = [BEDROCK_CLAUDE];

/**
 * The role→model map: every mode covers every role, explicitly, with no
 * inheritance or merging between modes. A reader must be able to answer
 * "what serves `reviewer` in `max`?" by reading one line — nothing here is
 * computed from a neighbouring mode.
 *
 * Shape, verbatim from the plan (05-01-PLAN.md):
 *   - `cheap`: executor/planner/reviewer/summariser on the flash tier;
 *     advisor on the pro tier; vision on Bedrock Claude.
 *   - `balanced`: executor and summariser on the flash tier; planner and
 *     reviewer on the pro tier; advisor and vision on Bedrock Claude.
 *   - `max`: executor and summariser on the pro tier; planner, reviewer,
 *     advisor and vision on Bedrock Claude.
 *
 * `reviewer` and `advisor` carry `reasoningEffort: "high"` in every mode —
 * see REASONING-EFFORT RULE above. Every other role omits it in every mode.
 */
export const ROLE_MAP: Record<ModeName, Record<Role, RoleRoute>> = {
	cheap: {
		executor: { candidates: FLASH_CANDIDATES },
		planner: { candidates: FLASH_CANDIDATES },
		reviewer: { candidates: FLASH_CANDIDATES, reasoningEffort: "high" },
		advisor: { candidates: PRO_CANDIDATES, reasoningEffort: "high" },
		vision: { candidates: VISION_CANDIDATES },
		summariser: { candidates: FLASH_CANDIDATES },
	},
	balanced: {
		executor: { candidates: FLASH_CANDIDATES },
		planner: { candidates: PRO_CANDIDATES },
		reviewer: { candidates: PRO_CANDIDATES, reasoningEffort: "high" },
		advisor: { candidates: VISION_CANDIDATES, reasoningEffort: "high" },
		vision: { candidates: VISION_CANDIDATES },
		summariser: { candidates: FLASH_CANDIDATES },
	},
	max: {
		executor: { candidates: PRO_CANDIDATES },
		planner: { candidates: VISION_CANDIDATES },
		reviewer: { candidates: VISION_CANDIDATES, reasoningEffort: "high" },
		advisor: { candidates: VISION_CANDIDATES, reasoningEffort: "high" },
		vision: { candidates: VISION_CANDIDATES },
		summariser: { candidates: PRO_CANDIDATES },
	},
};

/**
 * The mode a fresh session starts in, absent any persisted `ky:mode` entry.
 *
 * The project's daily driver is the cheap model — that is the whole premise
 * of the harness (PROJECT.md's Core Value).
 */
export const DEFAULT_MODE: ModeName = "cheap";

/** The mode `/escalate` (with no explicit target) pulls the executor from. */
export const ESCALATION_MODE: ModeName = "max";

/**
 * The `pi.appendEntry` custom-entry namespace this project persists mode
 * state under (05-CONTEXT.md decision 3).
 *
 * SCOPED NARROWLY, ON PURPOSE. Pi's own `model_change` session entry already
 * persists and restores the executor's actual model across a restart with
 * zero code in this repository — `AgentSession#setModel` writes it on every
 * successful switch, and session resume already derives the effective model
 * from the last one on the branch. What this entry type carries is only the
 * MODE NAME (for redisplay — a raw model id alone cannot say whether it came
 * from `cheap` or `balanced` if two modes ever share an executor model) and
 * the `/escalate` sticky bookkeeping. Re-implementing model restoration here
 * would be exactly the mistake this project's own "Don't Hand-Roll" table
 * warns against.
 */
export const MODE_ENTRY_TYPE = "ky:mode";

/**
 * The entire persisted `ky:mode` payload — nothing more.
 *
 * See {@link MODE_ENTRY_TYPE}'s docstring for why this is deliberately
 * narrow: the executor MODEL is Pi's own concern, not this shape's.
 */
export interface KyModeData {
	/** The mode name in force, independent of any escalation. */
	readonly mode: ModeName;
	/** Whether `/escalate` is currently active and sticky. */
	readonly escalated: boolean;
	/** The mode `/escalate` was invoked from, so `/escalate off` can restore it. */
	readonly escalatedFrom?: ModeName;
	/** `Date.now()` at the moment this entry was written. */
	readonly at: number;
}

/**
 * The `pi.events` topic a mode switch (or an escalation change) emits on.
 *
 * Cross-subsystem signalling is an event, never an import (05-CONTEXT.md
 * decision 8) — Phase 11's statusline subscribes to this rather than
 * `routing/` growing a rendering dependency.
 */
export const ROUTING_EVENT = "ky.routing.mode_changed";

/**
 * Subagent-role → agent name, for `settings.subagents.agentOverrides`.
 *
 * Only roles whose {@link ROLE_MECHANISM} is `"subagent"` appear here —
 * today, only `planner`. A role that never spawns a subagent has no override
 * to write.
 */
export const AGENT_NAME_BY_ROLE: Partial<Record<Role, string>> = {
	planner: "planner",
};
