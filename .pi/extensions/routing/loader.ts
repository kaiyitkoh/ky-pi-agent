/**
 * `bg_enable`: the loader that activates the background-task tools and `questionnaire` on demand, so the `implement`
 * profile does not pay their schemas and the shell-policy prompt section on every turn. Same shape as pi-web-access's
 * `web_enable` (pi-web-access 0.38.0 `tool-activation.ts:73`): no prompt metadata, activation through `pi.setActiveTools`, visible on
 * the next model request (pi 1.1.0 `docs/extensions.md`, dynamic tool loading). Named exports only.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const BG_LOADER_NAME = "bg_enable";

/** The tools the loader activates; each stays out of `implement` until then. */
export const BG_LOADED_TOOLS: readonly string[] = ["bg_run", "bg_status", "bg_logs", "bg_kill", "questionnaire"];

const parameters = Type.Object({}, { additionalProperties: false });

function result(text: string, isError: boolean) {
	return { isError, content: [{ type: "text" as const, text }], details: {} };
}

export function registerBgLoader(pi: ExtensionAPI): void {
	pi.registerTool({
		name: BG_LOADER_NAME,
		label: "Enable background tasks",
		description:
			"Enable bg_run, bg_status, bg_logs and bg_kill (long-running shell commands in the background) and questionnaire " +
			"(ask the user structured questions). Call it first when you need one; they appear on the next request.",
		parameters,
		async execute() {
			const registered = new Set(pi.getAllTools().map((tool) => tool.name));
			const names = BG_LOADED_TOOLS.filter((name) => registered.has(name));
			if (names.length === 0) return result("None of these tools is installed in this session.", true);
			pi.setActiveTools([...new Set([...pi.getActiveTools(), ...names])]);
			const active = new Set(pi.getActiveTools());
			const missing = names.filter((name) => !active.has(name));
			return missing.length > 0 ? result(`Still inactive: ${missing.join(", ")}.`, true) : result(`Enabled: ${names.join(", ")}.`, false);
		},
	});
}
