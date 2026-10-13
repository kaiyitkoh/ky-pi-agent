/**
 * Role-to-model map and mode vocabulary: a pure table (no fs, env or `ctx`), named exports only so `extension-layout` does not treat it as an entry point.
 * Three mechanisms, chosen by role: executor via `/escalate`-style `setModel`; reviewer/advisor/vision/summariser via a single-shot nested completion;
 * planner via a subagent because it reads files and needs a tool loop. Candidates are ordered DeepSeek-direct then DashScope (same order as `providers/schema.ts` `CHAIN`),
 * which is provider ordering only, not a second fallback chain. Modes differ by model, never by thinking tier: `reasoningEffort` is a per-role constant.
 * Chokepoint-lint scans comments, so the direct-model routes are not named here.
 */

/** The six routing roles, in this order. */
export const ROLES = ["executor", "planner", "reviewer", "advisor", "vision", "summariser"] as const;

/** One of {@link ROLES}. */
export type Role = (typeof ROLES)[number];

/** The three modes `/cheap`, `/balanced` and `/max` switch between. */
export const MODES = ["cheap", "balanced", "max"] as const;

/** One of {@link MODES}. */
export type ModeName = (typeof MODES)[number];

/** Which mechanism serves a role. */
export type Mechanism = "set-model" | "call-model" | "subagent";

/** Every role's mechanism, explicit. `planner` is a subagent: it reads files, so one nested completion cannot serve it. */
export const ROLE_MECHANISM: Record<Role, Mechanism> = {
	executor: "set-model",
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

/** One role's route for one mode; `reasoningEffort` is identical in every mode for a given role. */
export interface RoleRoute {
	/** Ordered `{provider,id}` candidates, never empty. */
	readonly candidates: readonly ModelRef[];
	/** Omitted for roles that never request elevated reasoning. */
	readonly reasoningEffort?: "high" | "max";
}

// Ids are catalogue-verified: DashScope ids from `.pi/templates/models-template.json`, DeepSeek-direct from Pi's built-in `deepseek` catalogue,
// Bedrock Claude from `pi-ai/dist/providers/data/amazon-bedrock.json` (text+image; both DashScope models are text-only). `routing-map.test.ts` resolves every id.
/** DeepSeek Flash, direct (Pi 1.1.0 id `deepseek-flash`). */
const DEEPSEEK_DIRECT_FLASH: ModelRef = { provider: "deepseek", id: "deepseek-flash" };

/** DeepSeek V4 Pro, direct. */
const DEEPSEEK_DIRECT_PRO: ModelRef = { provider: "deepseek", id: "deepseek-v4-pro" };

/** DeepSeek V4 Flash on DashScope. */
const DASHSCOPE_FLASH: ModelRef = { provider: "dashscope", id: "deepseek-v4-flash" };

/** DeepSeek V4 Pro on DashScope. */
const DASHSCOPE_PRO: ModelRef = { provider: "dashscope", id: "deepseek-v4-pro" };

/** Settings key under `kyPiAgent` holding the Bedrock inference-profile prefix. */
export const BEDROCK_PROFILE_PREFIX_SETTING = "kyPiAgent.bedrockProfilePrefix";

/** Prefix used when the setting is absent. */
export const BEDROCK_PROFILE_PREFIX_DEFAULT = "apac.";

/** Claude Sonnet 4.5 on Bedrock, base id: the resolver prepends the inference-profile prefix. The only verified vision-capable model, so a one-entry candidate list. */
const BEDROCK_CLAUDE: ModelRef = { provider: "amazon-bedrock", id: "anthropic.claude-sonnet-4-5-20250929-v1:0" };

const FLASH_CANDIDATES: readonly ModelRef[] = [DEEPSEEK_DIRECT_FLASH, DASHSCOPE_FLASH];

const PRO_CANDIDATES: readonly ModelRef[] = [DEEPSEEK_DIRECT_PRO, DASHSCOPE_PRO];

const VISION_CANDIDATES: readonly ModelRef[] = [BEDROCK_CLAUDE];

/** Every mode covers every role explicitly, no inheritance between modes. */
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

/** Mode of a fresh session with no persisted `ky:mode` entry. */
export const DEFAULT_MODE: ModeName = "cheap";

/** Mode `/escalate` lifts the executor to. */
export const ESCALATION_MODE: ModeName = "max";

/** Custom-entry type for mode state. Carries only the mode name and escalation bookkeeping: Pi's own `model_change` entry already restores the executor model. */
export const MODE_ENTRY_TYPE = "ky:mode";

/** The whole persisted `ky:mode` payload; deliberately holds no model id. */
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

/** `pi.events` topic emitted on a mode or escalation change; signalling is an event, never an import. */
export const ROUTING_EVENT = "ky.routing.mode_changed";

/** Subagent-role to agent name for `settings.subagents.agentOverrides`. */
export const AGENT_NAME_BY_ROLE: Partial<Record<Role, string>> = {
	planner: "planner",
};
