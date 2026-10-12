/**
 * Safety entry: wires policy.evaluate into the tool_call hook AND each wrapped built-in's execute(); registers approve_ky_command.
 * Two layers because Pi never re-validates event.input after a later handler mutates it (core/extensions/types.d.ts ToolCallEvent).
 * Tools register before the hook: tool-name collisions resolve first-registration-wins (pi 1.1.0 runner.js:410-417).
 */
import { homedir } from "node:os";

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { approve, consume, createPending, markHookDeferred, peek, validate } from "./approvals.ts";
import { pruneAuditLogs, writeAuditRow } from "./audit.ts";
import { currentBranch } from "./git.ts";
import { canonicalisePathArg } from "./paths.ts";
import { evaluate, type PolicyFacts, type Verdict } from "./policy.ts";

// Exported so tests import these literals instead of retyping them.
export const APPROVE_TOOL_NAME = "approve_ky_command";

export const HOOK_AUDIT_EVENT = "safety.tool_call_hook";

export const WRAPPER_AUDIT_EVENT = "safety.wrapped_execute";

export const APPROVAL_AUDIT_EVENT = "safety.approve_ky_command";

/** Forwarded to git.ts#classifyGitInvocation; compared case-insensitively there. */
export const PROTECTED_BRANCHES: readonly string[] = ["main", "master"];

const APPROVE_CHOICE = "Approve";
const DENY_CHOICE = "Deny";

/**
 * Reduce an absolute path to the canonical forward-slash form paths.ts compares against; unnormalised
 * Windows roots break containment (every write blocked) and the home-anchored rules (fail open).
 */
function toCanonicalRoot(absolutePath: string): string {
	return canonicalisePathArg({ text: absolutePath, value: absolutePath }, { cwd: absolutePath, home: absolutePath });
}

/** Plain-data facts for evaluate(); the one place impure ctx.cwd, homedir() and KUBECONFIG are read. */
function buildFacts(ctx: ExtensionContext): PolicyFacts {
	const cwd = toCanonicalRoot(ctx.cwd);
	return {
		cwd,
		projectRoot: cwd,
		home: toCanonicalRoot(homedir()),
		// Lazy: only invoked for an invocation whose executable is literally "git".
		currentBranchFor: (cwd: string) => currentBranch(cwd),
		protectedBranches: PROTECTED_BRANCHES,
		kubeconfigEnv: process.env.KUBECONFIG,
	};
}

/** Audit-only field extraction; grep falls back to glob then pattern since it can be blocked with no path. Malformed input yields "". */
function extractCommandOrPath(toolName: string, input: unknown): string {
	if (input === null || typeof input !== "object") {
		return "";
	}
	const record = input as Record<string, unknown>;
	if (toolName === "bash" && typeof record.command === "string") {
		return record.command;
	}
	if (typeof record.path === "string") {
		return record.path;
	}
	if (toolName === "grep") {
		if (typeof record.glob === "string") {
			return record.glob;
		}
		if (typeof record.pattern === "string") {
			return record.pattern;
		}
	}
	return "";
}

/**
 * NEVER THROWS: a classification bug becomes a block verdict, because Pi swallows handler exceptions
 * (core/extensions/runner.js) and a swallowed guard error would allow.
 */
function classifyAtWrapper(toolName: string, input: unknown, ctx: ExtensionContext): Verdict {
	try {
		return evaluate(toolName, input, buildFacts(ctx));
	} catch (err) {
		return {
			kind: "block",
			reason:
				`safety extension threw while classifying a "${toolName}" call: ${
					err instanceof Error ? err.message : String(err)
				} -- deny by construction, never allow on an exception`,
		};
	}
}

/** Reason when the effective bg shell is not bash/POSIX; local so safety/ loads in isolation. */
export function bgShellProblem(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | undefined {
	if (platform === "win32") {
		const requested = env.PI_BG_SHELL;
		return requested === undefined || requested === "bash"
			? undefined
			: `PI_BG_SHELL=${requested} runs commands outside the bash dialect the guard parses`;
	}
	const configured = env.PI_BG_POSIX_SHELL;
	if (configured === "bash" || configured === "sh") return undefined;
	if (configured !== undefined && configured !== "inherit") return `PI_BG_POSIX_SHELL=${configured} is not recognised`;
	const name = (env.SHELL && env.SHELL.length > 0 ? env.SHELL : "/bin/sh").split(/[\\/]/).pop()?.toLowerCase() ?? "";
	return ["bash", "sh", "dash", "ash", "ksh", "zsh"].includes(name)
		? undefined
		: `the inherited shell "${name}" is not a POSIX-family shell`;
}

/**
 * The single bg_run policy, called from the hook and bg_run's execute() so a later event.input mutation is still caught.
 * Requires a bash/POSIX shell (cmd.exe escapes must never be parsed as bash), denies isAgent (a child pi may start
 * unguarded), then classifies as bash; confirm blocks because there is no grant wrapper.
 */
export function guardBgRun(input: unknown, ctx: ExtensionContext): Verdict {
	const rec = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
	if (typeof rec.command !== "string" || rec.command.trim() === "") {
		return { kind: "block", reason: "bg_run called without a non-empty string command -- blocked (fail closed)" };
	}
	if (rec.isAgent !== false) {
		return {
			kind: "block",
			reason: "bg_run with isAgent other than false is blocked: a child agent may start without the ky-pi-agent guard",
		};
	}
	const shellProblem = bgShellProblem(process.platform, process.env);
	if (shellProblem !== undefined) {
		return { kind: "block", reason: `bg_run is blocked: ${shellProblem} (fail closed)` };
	}
	const v = classifyAtWrapper("bash", { command: rec.command }, ctx);
	if (v.kind === "confirm") {
		return { kind: "block", reason: `${v.reason} -- bg_run cannot use the approval protocol; run it through bash instead` };
	}
	return v;
}

/**
 * Write one audit row, then return (allow, or consumed grant) or throw (block, or confirm with no grant).
 * A throw from execute() becomes isError:true for the model (pi-agent-core agent-loop.js).
 */
function wrapperOutcome(toolName: string, command: string, ctx: ExtensionContext, verdict: Verdict): void {
	if (verdict.kind === "allow") {
		writeAuditRow(ctx.cwd, {
			event: WRAPPER_AUDIT_EVENT,
			tool: toolName,
			command,
			cwd: ctx.cwd,
			verdict: "allow",
			reason: "wrapper: re-evaluated the params that actually reached execution and allowed",
		});
		return;
	}

	if (verdict.kind === "confirm" && consume(verdict.requestKey)) {
		writeAuditRow(ctx.cwd, {
			event: WRAPPER_AUDIT_EVENT,
			tool: toolName,
			command,
			cwd: ctx.cwd,
			verdict: "allow",
			reason: `wrapper: one-shot approval grant consumed -- ${verdict.reason}`,
		});
		return;
	}

	// Block, or confirm with no matching grant (unapproved, consumed, expired, or a mutated command with a different requestKey).
	writeAuditRow(ctx.cwd, {
		event: WRAPPER_AUDIT_EVENT,
		tool: toolName,
		command,
		cwd: ctx.cwd,
		verdict: "block",
		reason: verdict.reason,
	});
	throw new Error(verdict.reason);
}

/**
 * Wrap bash/read/write/edit so execute() re-evaluates the params that actually arrive (second enforcement layer).
 * grep/find/ls are deliberately not wrapped: extension tools are force-activated (agent-session.js)
 * against Pi's default set (sdk.js), costing ~532 tokens/turn; they stay hook-only (docs/SAFETY.md).
 * Delegates are built fresh from ctx.cwd per call so policy and the real tool act on the same root.
 * The delegate call omits ctx: AgentTool.execute declares no fifth parameter (agent-core types.d.ts AgentTool).
 */
function registerWrappedTools(pi: ExtensionAPI): void {
	// Static metadata only (name/description/schema); this instance's execute never runs.
	const metadataCwd = process.cwd();

	pi.registerTool({
		...createBashTool(metadataCwd),
		execute: async (toolCallId, params, signal, onUpdate, ctx) => {
			const command = extractCommandOrPath("bash", params);
			wrapperOutcome("bash", command, ctx, classifyAtWrapper("bash", params, ctx));
			return createBashTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...createReadTool(metadataCwd),
		execute: async (toolCallId, params, signal, onUpdate, ctx) => {
			const command = extractCommandOrPath("read", params);
			wrapperOutcome("read", command, ctx, classifyAtWrapper("read", params, ctx));
			return createReadTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...createWriteTool(metadataCwd),
		execute: async (toolCallId, params, signal, onUpdate, ctx) => {
			const command = extractCommandOrPath("write", params);
			wrapperOutcome("write", command, ctx, classifyAtWrapper("write", params, ctx));
			return createWriteTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...createEditTool(metadataCwd),
		execute: async (toolCallId, params, signal, onUpdate, ctx) => {
			const command = extractCommandOrPath("edit", params);
			wrapperOutcome("edit", command, ctx, classifyAtWrapper("edit", params, ctx));
			return createEditTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
		},
	});
}

/** Parameter schema; blast_radius uses StringEnum because Type.Union/Literal breaks Google's API. 275 tokens measured. */
const approveSchema = Type.Object({
	request_id: Type.String({
		description: "The request_id from the block reason of the pending approval.",
	}),
	command: Type.String({
		description: "The exact command (or path) that was blocked, byte-for-byte.",
	}),
	reason: Type.String({
		description: "The exact block reason string, byte-for-byte, as given in the pending request.",
	}),
	summary: Type.String({
		description: "A one-sentence, human-readable summary of what this command does, for the person approving it.",
	}),
	blast_radius: StringEnum(["low", "medium", "high"], {
		description: "Your own honest assessment of how much damage a mistaken approval of this command could cause.",
	}),
});

/**
 * The one non-wrapper tool. No promptSnippet/promptGuidelines: they rebuild the system prompt and invalidate the cache prefix.
 * validate() needs request_id, command and reason byte-for-byte so an edited command cannot reuse a pending id;
 * approval needs an explicit "Approve" (undefined or no UI refuses). Every branch writes exactly one audit row.
 */
function registerApprovalTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: APPROVE_TOOL_NAME,
		label: "approve blocked command",
		description:
			"Request human approval to re-issue a command that safety blocked pending confirmation. Requires the " +
			"exact request_id, command and reason from the block message. Approval is one-shot and expires after " +
			"10 minutes; on approval, re-issue the identical command.",
		parameters: approveSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { request_id, command, reason, summary, blast_radius } = params;

			if (!validate(request_id, command, reason)) {
				writeAuditRow(ctx.cwd, {
					event: APPROVAL_AUDIT_EVENT,
					tool: APPROVE_TOOL_NAME,
					command,
					cwd: ctx.cwd,
					verdict: "block",
					reason:
						`validate() refused request_id="${request_id}": no matching unexpired pending entry, or the ` +
						"presented command/reason did not match byte-for-byte",
				});
				throw new Error(
					`Approval refused: request_id "${request_id}" does not match a pending, unexpired approval for ` +
						"this exact command and reason. Re-issue the ORIGINAL blocked command to get a fresh request id.",
				);
			}

			// Approve ONLY on an explicit affirmative; undefined (noOpUIContext, pi 1.1.0 runner.js:132) and no UI both refuse.
			const choice = ctx.hasUI
				? await ctx.ui.select(
						`Approve this command?\n\n  ${command}\n\nSummary: ${summary}\nBlast radius: ${blast_radius}\n` +
							`Blocked because: ${reason}`,
						[APPROVE_CHOICE, DENY_CHOICE],
					)
				: undefined;

			if (choice !== APPROVE_CHOICE) {
				writeAuditRow(ctx.cwd, {
					event: APPROVAL_AUDIT_EVENT,
					tool: APPROVE_TOOL_NAME,
					command,
					cwd: ctx.cwd,
					verdict: "block",
					reason: ctx.hasUI
						? `user did not select "${APPROVE_CHOICE}"`
						: "no UI bound -- approval requires an interactive confirmation and none is available",
				});
				throw new Error(`Approval refused for "${command}". It stays blocked.`);
			}

			if (!approve(request_id, command, reason)) {
				// Unreachable after validate(); denied rather than assumed.
				writeAuditRow(ctx.cwd, {
					event: APPROVAL_AUDIT_EVENT,
					tool: APPROVE_TOOL_NAME,
					command,
					cwd: ctx.cwd,
					verdict: "block",
					reason:
						"approve() returned false immediately after validate() returned true -- treated as a refusal, " +
						"never an allow",
				});
				throw new Error(`Approval could not be recorded for "${command}". It stays blocked.`);
			}

			writeAuditRow(ctx.cwd, {
				event: APPROVAL_AUDIT_EVENT,
				tool: APPROVE_TOOL_NAME,
				command,
				cwd: ctx.cwd,
				verdict: "allow",
				reason: `approved by explicit user selection -- ${summary}`,
			});

			return {
				content: [{ type: "text", text: `Approved. Re-issue the EXACT command now: ${command}` }],
				details: undefined,
			};
		},
	});
}

/**
 * Tools the hook denies outright (unparseable or unreviewed paths). Sources, each anchored to the version read:
 * pi 1.1.0: powershell types.d.ts:922-925; codemode extensions/codemode/tool.js:31; pi 1.1.0 tool_search extensions/tool-search/tool.js:11;
 * pi 1.1.0 MCP resources extensions/mcp/resources.js:2-3,192,208,224; pi 1.1.0 "mcp__" extensions/mcp/tools.js:46;
 * pi-background-tasks@2.6.9 prompt/argv tools (src/extension.ts:1036, src/core/delegate/types.ts:32,
 * pi-background-tasks@2.6.9 src/delegate-child-extension.ts:601, src/core/fusion/*.ts). Nested codemode calls reach the hook (pi 1.1.0 agent-session.js:326-343).
 */
const DENIED_TOOL_NAMES: ReadonlySet<string> = new Set([
	"powershell",
	"codemode",
	"tool_search",
	"list_mcp_resources",
	"list_mcp_resource_templates",
	"read_mcp_resource",
	"bg_run_pi_attested",
	"bg_delegate",
	"delegate_read_artifact",
	"fusion_reason",
	"fusion_investigate",
	"fusion_research",
	"fusion_validate",
	"fusion_brainstorm",
	"fusion_web_fetch",
]);
const DENIED_TOOL_PREFIXES: readonly string[] = ["mcp__"];
const DENY_COMMAND_MAX = 2000;

function isDeniedToolName(name: string): boolean {
	return DENIED_TOOL_NAMES.has(name) || DENIED_TOOL_PREFIXES.some((p) => name.startsWith(p));
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
}

/**
 * Hook layer: deny table first (fail closed), bg_run classified as bash, then bash/read/write/edit/grep/find/ls via
 * classifyAtWrapper; any other tool returns undefined unaudited (docs/SAFETY.md limits). Keep the list in sync with
 * policy.ts#evaluate's switch. grep/find/ls are audited and denied here only (not wrapped).
 * On confirm with an existing grant the hook defers to the wrapper's one-shot consume and never consumes itself, or the
 * wrapper would find nothing and block the approved command. markHookDeferred keys on requestKey AND toolCallId so every
 * loaded copy's hook of one call defers under a double load, while a different call reusing an unconsumed grant is
 * re-blocked, bounding the unguarded window to HOOK_DEFER_TTL_MS. Otherwise mint a pending approval and block with its id.
 * `terminate` is never set: it only stops the agent when every result in the batch terminates.
 */
function registerToolCallHook(pi: ExtensionAPI): void {
	pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | undefined> => {
		const parentToolCallId = event.parentToolCallId;

		// Deny table: fail closed, even on malformed input.
		if (isDeniedToolName(event.toolName)) {
			const rec = event.input !== null && typeof event.input === "object" ? (event.input as Record<string, unknown>) : {};
			// Never persist raw input of a denied tool (may carry tokens): command string or top-level keys only.
			const raw = typeof rec.command === "string" ? rec.command : `[input keys: ${Object.keys(rec).join(",")}]`;
			const reason =
				`"${event.toolName}" is not covered by the ky-pi-agent guard (unparseable or unreviewed tool path) -- ` +
				"it is blocked. Use bash, read, write or edit instead.";
			writeAuditRow(ctx.cwd, {
				event: HOOK_AUDIT_EVENT,
				tool: event.toolName,
				command: raw.slice(0, DENY_COMMAND_MAX),
				cwd: ctx.cwd,
				verdict: "block",
				reason,
				parentToolCallId,
			});
			return { block: true, reason };
		}

		// bg_run is classified exactly as bash (see guardBgRun).
		if (event.toolName === "bg_run") {
			const rec = event.input !== null && typeof event.input === "object" ? (event.input as Record<string, unknown>) : {};
			const bg = guardBgRun(event.input, ctx);
			writeAuditRow(ctx.cwd, {
				event: HOOK_AUDIT_EVENT,
				tool: "bg_run",
				command: (typeof rec.command === "string" ? rec.command : safeStringify(event.input)).slice(0, DENY_COMMAND_MAX),
				cwd: ctx.cwd,
				verdict: bg.kind === "allow" ? "allow" : "block",
				reason: bg.kind === "allow" ? "hook: allowed (bg_run classified as bash)" : bg.reason,
				parentToolCallId,
			});
			return bg.kind === "allow" ? undefined : { block: true, reason: bg.reason };
		}

		if (
			event.toolName !== "bash" &&
			event.toolName !== "read" &&
			event.toolName !== "write" &&
			event.toolName !== "edit" &&
			event.toolName !== "grep" &&
			event.toolName !== "find" &&
			event.toolName !== "ls"
		) {
			return undefined;
		}

		const toolName = event.toolName;
		const command = extractCommandOrPath(toolName, event.input);
		const verdict = classifyAtWrapper(toolName, event.input, ctx);

		if (verdict.kind === "allow") {
			writeAuditRow(ctx.cwd, {
				event: HOOK_AUDIT_EVENT,
				tool: toolName,
				command,
				cwd: ctx.cwd,
				verdict: "allow",
				reason: "hook: allowed",
				parentToolCallId,
			});
			return undefined;
		}

		if (verdict.kind === "confirm") {
			// A grant exists: defer to the wrapper, which consumes it; never consume here. Deferral is scoped to one
			// toolCallId so every double-loaded copy of one call may defer (approvals.ts#markHookDeferred).
			if (peek(verdict.requestKey) && markHookDeferred(verdict.requestKey, event.toolCallId)) {
				writeAuditRow(ctx.cwd, {
					event: HOOK_AUDIT_EVENT,
					tool: toolName,
					command,
					cwd: ctx.cwd,
					verdict: "allow",
					reason: `hook: an approval grant is present for this exact command -- deferring to the wrapper's one-shot consume -- ${verdict.reason}`,
					parentToolCallId,
				});
				return undefined;
			}

			const requestId = createPending(verdict.requestKey, command, verdict.reason);
			writeAuditRow(ctx.cwd, {
				event: HOOK_AUDIT_EVENT,
				tool: toolName,
				command,
				cwd: ctx.cwd,
				verdict: "block",
				reason: verdict.reason,
				parentToolCallId,
			});
			return {
				block: true,
				reason:
					`${verdict.reason} -- this requires confirmation. Call ${APPROVE_TOOL_NAME} with ` +
					`request_id=${JSON.stringify(requestId)}, command=${JSON.stringify(command)} (byte-for-byte) and ` +
					`reason=${JSON.stringify(verdict.reason)} (byte-for-byte), then re-issue the identical ${toolName} call.`,
			};
		}

		writeAuditRow(ctx.cwd, {
			event: HOOK_AUDIT_EVENT,
			tool: toolName,
			command,
			cwd: ctx.cwd,
			verdict: "block",
			reason: verdict.reason,
			parentToolCallId,
		});
		return { block: true, reason: verdict.reason };
	});
}

/**
 * No idempotency guard: /reload rebuilds the runner and calls this factory again in-process (agent-session.js#reload),
 * so a once-per-process flag would leave a reloaded session unwrapped. The bootstrap stub does not dedupe either: file
 * existence is no proxy for Pi loading the project copy (untrusted headless runs skip it, package-manager.js),
 * and deduping on it left both copies unregistered. The resulting double load is accepted (docs/SAFETY.md "Load order").
 */
export default function (pi: ExtensionAPI): void {
	// Registrations first (first-registration-wins, pi 1.1.0 runner.js:410-417); safety-entry.test pins this order.
	registerWrappedTools(pi);
	registerApprovalTool(pi);

	registerToolCallHook(pi);

	// Best-effort retention; a failure must not affect session start.
	pi.on("session_start", async (_event, ctx) => {
		try {
			pruneAuditLogs(ctx.cwd);
		} catch {
			// Swallowed deliberately.
		}
	});
}
