/**
 * Which workflow command armed last. /grill and /plan keep per-turn hooks alive across turns, so a later command
 * must be able to retire them; held on globalThis because each extension loads through its own jiti module graph.
 */
const ACTIVE_WORKFLOW_KEY = "__kypiActiveWorkflow";

/** Record `name` as the workflow whose per-turn hooks may act; any other armed workflow stands down. */
export function claimWorkflow(name: string): void {
	(globalThis as Record<string, unknown>)[ACTIVE_WORKFLOW_KEY] = name;
}

export function isActiveWorkflow(name: string): boolean {
	return (globalThis as Record<string, unknown>)[ACTIVE_WORKFLOW_KEY] === name;
}
