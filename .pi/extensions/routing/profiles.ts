/**
 * Named tool profiles. Pure table and resolver; the routing entry point applies one at session start and on each idle prompt.
 * Profiles are a cost control, not an access control: the safety hook still gates every call.
 * Named exports only: a default export would reclassify this file as an extension entry point.
 */

export const PROFILE_NAMES = ["recon", "review", "implement", "full"] as const;
export type ProfileName = (typeof PROFILE_NAMES)[number];
export const DEFAULT_PROFILE: ProfileName = "implement";

const ALL: readonly ProfileName[] = ["recon", "review", "implement", "full"];
const NOT_RECON: readonly ProfileName[] = ["review", "implement", "full"];
const WRITERS: readonly ProfileName[] = ["implement", "full"];

/** Tool name to the profiles that keep it active. */
export const TOOL_PROFILES: Readonly<Record<string, readonly ProfileName[]>> = {
	read: ALL,
	bash: ALL,
	approve_ky_command: ALL,
	web_enable: ALL,
	edit: WRITERS,
	write: WRITERS,
	todo: WRITERS,
	consult_advisor: NOT_RECON,
	lsp_diagnostics: NOT_RECON,
	lsp_fix: ["full"],
	subagent: NOT_RECON,
	bg_wait: NOT_RECON,
	subagent_supervisor: NOT_RECON,
	subagents_enable: NOT_RECON,
	web_search: ["recon", "full"],
	fetch_content: ["recon", "full"],
	get_search_content: ["recon", "full"],
	source_check: ["recon", "full"],
	// Out of `implement` so it does not carry their schemas and the shell-policy section every turn; `bg_enable` loads them.
	bg_enable: WRITERS,
	questionnaire: ["full"],
	bg_run: ["full"],
	bg_status: ["full"],
	bg_logs: ["full"],
	bg_kill: ["full"],
	qoder_delegate: ["full"],
};

/** Pi built-ins that are inactive by default; when active, plan mode or a subagent chose them, so never remove them. */
export const PROFILE_NEUTRAL_TOOLS: readonly string[] = ["grep", "find", "ls", "powershell"];

export function classifiedToolNames(): string[] {
	return [...Object.keys(TOOL_PROFILES), ...PROFILE_NEUTRAL_TOOLS];
}

/** Names that are in neither the table nor the neutral list. */
export function findUnclassified(
	names: readonly string[],
	table: Readonly<Record<string, readonly ProfileName[]>> = TOOL_PROFILES,
): string[] {
	return names.filter((name) => !(name in table) && !PROFILE_NEUTRAL_TOOLS.includes(name));
}

/** True when a command line carries Pi's `--tools`/`-t` allowlist. */
export function hasExplicitToolAllowlist(argv: readonly string[]): boolean {
	return argv.some((arg) => arg === "--tools" || arg === "-t");
}

export function resolveProfile(flag: unknown): ProfileName {
	return typeof flag === "string" && (PROFILE_NAMES as readonly string[]).includes(flag)
		? (flag as ProfileName)
		: DEFAULT_PROFILE;
}

/**
 * The narrowed active set, or undefined when nothing should change. Only removes; keeps order;
 * unclassified names stay (a CI completeness check flags them). A set with neither edit nor write was
 * already chosen read-only, so it is left alone.
 */
export function applyProfile(active: readonly string[], profile: ProfileName): string[] | undefined {
	if (profile === "full") return undefined;
	if (!active.includes("edit") && !active.includes("write")) return undefined;
	const next = active.filter((name) => {
		const allowed = Object.hasOwn(TOOL_PROFILES, name) ? TOOL_PROFILES[name] : undefined;
		return allowed === undefined || allowed.includes(profile);
	});
	return next.length === active.length ? undefined : next;
}
