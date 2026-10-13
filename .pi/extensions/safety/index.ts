/**
 * Safety entry: wires policy.evaluate into the tool_call hook AND each wrapped built-in's execute(); registers approve_ky_command.
 * Two layers because Pi never re-validates event.input after a later handler mutates it (core/extensions/types.d.ts ToolCallEvent).
 * Tools register before the hook: tool-name collisions resolve first-registration-wins (pi 1.1.0 runner.js:410-417).
 */
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";

import { approve, consume, createPending, grantConfirmed, markHookDeferred, peek, validate } from "./approvals.ts";
import { pruneAuditLogs, writeAuditRow } from "./audit.ts";
import type { AuditVerdict } from "./schema.ts";
import { currentBranch, gitConfigValues, resolveLocalBranch } from "./git.ts";
import { canonicalisePathArg } from "./paths.ts";
import { evaluate, type PolicyFacts, type Verdict } from "./policy.ts";
import { BUILTIN_PROTECTED, effectiveBranches } from "./branches.ts";
import { classifySubagentCall, disposeChildGuard, isChildGuardRegistered, registerChildGuard } from "./subagents.ts";

export { protectedBranchesFor } from "./branches.ts";

export const APPROVE_TOOL_NAME = "approve_ky_command";

export const HOOK_AUDIT_EVENT = "safety.tool_call_hook";

export const WRAPPER_AUDIT_EVENT = "safety.wrapped_execute";

export const APPROVAL_AUDIT_EVENT = "safety.approve_ky_command";

/** Forwarded to git.ts#classifyGitInvocation; compared case-insensitively there. */
export const PROTECTED_BRANCHES: readonly string[] = BUILTIN_PROTECTED;

/** An unanswered confirm refuses after this long; Pi dismisses the dialog with false on timeout. */
export const CONFIRM_TIMEOUT_MS = 300_000;

/** Only the TUI and an RPC front-end can answer a dialog; json, print and subagent children cannot. */
function canConfirm(ctx: ExtensionContext): boolean {
	return ctx.hasUI && (ctx.mode === "tui" || ctx.mode === "rpc");
}

async function askUser(ctx: ExtensionContext, title: string, message: string): Promise<boolean> {
	return (await ctx.ui.confirm(title, message, { timeout: CONFIRM_TIMEOUT_MS })) === true;
}

function orElse<T>(read: () => T, fallback: T): T {
	try {
		return read();
	} catch {
		return fallback;
	}
}

// No session id means no child guard to register, not a failed session start.
const sessionIdOf = (ctx: ExtensionContext): string | undefined => orElse<string | undefined>(() => ctx.sessionManager.getSessionId(), undefined);

// No tool listing means no path, and child-guard registration then fails closed.
const subagentSourcePaths = (pi: ExtensionAPI): string[] =>
	orElse(() => pi.getAllTools().filter((t) => t.name === "subagent").map((t) => t.sourceInfo.path), []);

const safeStringify = (value: unknown): string => orElse(() => JSON.stringify(value) ?? "", "");

const APPROVE_CHOICE = "Approve";
const DENY_CHOICE = "Deny";

/**
 * Reduce an absolute path to the canonical forward-slash form paths.ts compares against; unnormalised
 * Windows roots break containment (every write blocked) and the home-anchored rules (fail open).
 */
function toCanonicalRoot(absolutePath: string): string {
	return canonicalisePathArg({ text: absolutePath, value: absolutePath }, { cwd: absolutePath, home: absolutePath });
}

// Settings are re-read on every call, so a file broken mid-session is reported once per distinct warning, not once per call.
const reportedBranchWarnings = new Set<string>();

function reportBranchWarnings(ctx: ExtensionContext, warnings: readonly string[], always: boolean): void {
	if (warnings.length === 0) reportedBranchWarnings.clear();
	for (const warning of warnings) {
		if (!always && reportedBranchWarnings.has(warning)) continue;
		reportedBranchWarnings.add(warning);
		writeAuditRow(ctx.cwd, { event: HOOK_AUDIT_EVENT, tool: "settings", command: "", cwd: ctx.cwd, verdict: "block", reason: warning });
		if (ctx.hasUI) ctx.ui.notify(warning, "warning");
	}
}

/** Plain-data facts for evaluate(); the one place impure ctx.cwd, homedir() and KUBECONFIG are read. */
function buildFacts(ctx: ExtensionContext): PolicyFacts {
	const cwd = toCanonicalRoot(ctx.cwd);
	const branches = effectiveBranches(ctx.cwd);
	reportBranchWarnings(ctx, branches.warnings, false);
	return {
		cwd,
		projectRoot: cwd,
		home: toCanonicalRoot(homedir()),
		// Lazy: only invoked for an invocation whose executable is literally "git".
		currentBranchFor: currentBranch,
		protectedBranches: branches.protectedBranches,
		pushProtectedBranches: branches.pushProtectedBranches,
		gitConfigFor: gitConfigValues,
		gitBranchFor: resolveLocalBranch,
		kubeconfigEnv: process.env.KUBECONFIG,
		tempDir: toCanonicalRoot(tmpdir()),
	};
}

/** Audit-only field extraction; grep falls back to glob then pattern since it can be blocked with no path. Malformed input yields "". */
function extractCommandOrPath(toolName: string, input: unknown): string {
	if (input === null || typeof input !== "object") return "";
	const record = input as Record<string, unknown>;
	const fields = toolName === "bash" ? ["command", "path"] : toolName === "grep" ? ["path", "glob", "pattern"] : ["path"];
	const value = fields.map((f) => record[f]).find((v) => typeof v === "string");
	return typeof value === "string" ? value : "";
}

/** NEVER THROWS: a classification bug becomes an explicit block verdict instead of relying on Pi turning a handler failure into a block. */
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
	if (v.kind === "confirm" || v.kind === "ask") {
		return { kind: "block", reason: `${v.reason} -- bg_run cannot use the approval protocol; run it through bash instead` };
	}
	return v;
}

/**
 * Write one audit row, then return (allow, or consumed grant) or throw (block, or confirm with no grant).
 * A throw from execute() becomes isError:true for the model (pi-agent-core agent-loop.js).
 */
function wrapperOutcome(toolName: string, command: string, ctx: ExtensionContext, verdict: Verdict): void {
	const row = { event: WRAPPER_AUDIT_EVENT, tool: toolName, command, cwd: ctx.cwd };
	if (verdict.kind === "allow") {
		writeAuditRow(ctx.cwd, { ...row, verdict: "allow", reason: "wrapper: re-evaluated the params that actually reached execution and allowed" });
		return;
	}
	if ((verdict.kind === "confirm" || verdict.kind === "ask") && consume(verdict.requestKey)) {
		writeAuditRow(ctx.cwd, { ...row, verdict: "allow", reason: `wrapper: one-shot approval grant consumed -- ${verdict.reason}` });
		return;
	}
	// Block, or confirm with no matching grant (unapproved, consumed, expired, or a mutated command with a different requestKey).
	writeAuditRow(ctx.cwd, { ...row, verdict: "block", reason: verdict.reason });
	throw new Error(verdict.reason);
}

/**
 * Wrap one built-in so execute() re-evaluates the params that actually arrive (second enforcement layer). The delegate is
 * built fresh from ctx.cwd per call so policy and the real tool act on the same root; the process.cwd() instance only
 * supplies static metadata. The delegate call omits ctx: AgentTool.execute declares no fifth parameter (agent-core types.d.ts).
 */
function registerWrapped<P extends TSchema, D>(pi: ExtensionAPI, create: (cwd: string) => AgentTool<P, D>): void {
	const metadata = create(process.cwd());
	const toolName = metadata.name;
	pi.registerTool({
		...metadata,
		execute: async (toolCallId, params, signal, onUpdate, ctx) => {
			wrapperOutcome(toolName, extractCommandOrPath(toolName, params), ctx, classifyAtWrapper(toolName, params, ctx));
			return create(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
		},
	});
}

/**
 * grep/find/ls are deliberately not wrapped: extension tools are force-activated (agent-session.js) against Pi's
 * default set (sdk.js), costing ~532 tokens/turn; they stay hook-only (docs/SAFETY.md).
 */
function registerWrappedTools(pi: ExtensionAPI): void {
	registerWrapped(pi, createBashTool);
	registerWrapped(pi, createReadTool);
	registerWrapped(pi, createWriteTool);
	registerWrapped(pi, createEditTool);
}

/** Parameter schema; blast_radius uses StringEnum because Type.Union/Literal breaks Google's API. 275 tokens measured. */
const approveSchema = Type.Object({
	request_id: Type.String({ description: "The request_id from the block reason of the pending approval." }),
	command: Type.String({ description: "The exact command (or path) that was blocked, byte-for-byte." }),
	reason: Type.String({ description: "The exact block reason string, byte-for-byte, as given in the pending request." }),
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
			const row = { event: APPROVAL_AUDIT_EVENT, tool: APPROVE_TOOL_NAME, command, cwd: ctx.cwd };
			const refuse: (why: string, message: string) => never = (why, message) => {
				writeAuditRow(ctx.cwd, { ...row, verdict: "block", reason: why });
				throw new Error(message);
			};
			if (!validate(request_id, command, reason)) {
				refuse(
					`validate() refused request_id="${request_id}": no matching unexpired pending entry, or the ` +
						"presented command/reason did not match byte-for-byte",
					`Approval refused: request_id "${request_id}" does not match a pending, unexpired approval for ` +
						"this exact command and reason. Re-issue the ORIGINAL blocked command to get a fresh request id.",
				);
			}

			// Approve ONLY on an explicit affirmative; undefined (noOpUIContext, pi 1.1.0 runner.js:132, or a timeout) and no UI refuse.
			const choice = canConfirm(ctx)
				? await ctx.ui.select(
						`Approve this command?\n\n  ${command}\n\nSummary: ${summary}\nBlast radius: ${blast_radius}\n` +
							`Blocked because: ${reason}`,
						[APPROVE_CHOICE, DENY_CHOICE],
						{ timeout: CONFIRM_TIMEOUT_MS },
					)
				: undefined;

			if (choice !== APPROVE_CHOICE) {
				refuse(
					canConfirm(ctx)
						? `user did not select "${APPROVE_CHOICE}" within ${CONFIRM_TIMEOUT_MS} ms`
						: `no UI that can answer a dialog (mode "${ctx.mode}") -- approval requires an interactive confirmation`,
					`Approval refused for "${command}". It stays blocked.`,
				);
			}

			if (!approve(request_id, command, reason)) {
				// Unreachable after validate(); denied rather than assumed.
				refuse(
					"approve() returned false immediately after validate() returned true -- treated as a refusal, never an allow",
					`Approval could not be recorded for "${command}". It stays blocked.`,
				);
			}

			writeAuditRow(ctx.cwd, { ...row, verdict: "allow", reason: `approved by explicit user selection -- ${summary}` });
			return { content: [{ type: "text", text: `Approved. Re-issue the EXACT command now: ${command}` }], details: undefined };
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
	...["powershell", "codemode", "tool_search", "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"],
	...["bg_run_pi_attested", "bg_delegate", "delegate_read_artifact"],
	...["fusion_reason", "fusion_investigate", "fusion_research", "fusion_validate", "fusion_brainstorm", "fusion_web_fetch"],
]);
/** Must match policy.ts#evaluate's switch; grep/find/ls are hook-only (not wrapped). */
const HOOKED_TOOL_NAMES: ReadonlySet<string> = new Set(["bash", "read", "write", "edit", "grep", "find", "ls"]);
const DENIED_TOOL_PREFIXES: readonly string[] = ["mcp__"];
const DENY_COMMAND_MAX = 2000;

function isDeniedToolName(name: string): boolean {
	return DENIED_TOOL_NAMES.has(name) || DENIED_TOOL_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * A subagent change confirmed by the full copy's hook, so the hook-only second load, and only it, does not ask again
 * for the same call and input. globalThis because each copy is its own module instance; short-lived and taken once.
 */
const SUBAGENT_CONFIRM_SLOT = Symbol.for("ky-pi-agent.safety.subagent-confirm.v1");
const SUBAGENT_CONFIRM_TTL_MS = 60_000;

function subagentConfirms(): Map<string, number> {
	const root = globalThis as unknown as Record<symbol, Map<string, number> | undefined>;
	root[SUBAGENT_CONFIRM_SLOT] ??= new Map();
	return root[SUBAGENT_CONFIRM_SLOT];
}

function recordSubagentConfirm(key: string): void {
	const confirms = subagentConfirms();
	const now = Date.now();
	for (const [k, at] of confirms) if (now - at > SUBAGENT_CONFIRM_TTL_MS) confirms.delete(k);
	confirms.set(key, now);
}

function takeSubagentConfirm(key: string): boolean {
	const confirms = subagentConfirms();
	const at = confirms.get(key);
	confirms.delete(key);
	return at !== undefined && Date.now() - at <= SUBAGENT_CONFIRM_TTL_MS;
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
function registerToolCallHook(pi: ExtensionAPI, secondLoad = false): void {
	pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | undefined> => {
		const audit = (tool: string, command: string, verdict: AuditVerdict, reason: string): void => {
			writeAuditRow(ctx.cwd, { event: HOOK_AUDIT_EVENT, tool, command, cwd: ctx.cwd, verdict, reason, parentToolCallId: event.parentToolCallId });
		};
		const allow = (tool: string, command: string, reason: string): undefined => {
			audit(tool, command, "allow", reason);
			return undefined;
		};
		const deny = (tool: string, command: string, reason: string): ToolCallEventResult => {
			audit(tool, command, "block", reason);
			return { block: true, reason };
		};
		const rec = event.input !== null && typeof event.input === "object" ? (event.input as Record<string, unknown>) : {};

		if (isDeniedToolName(event.toolName)) {
			// Never persist raw input of a denied tool (may carry tokens): command string or top-level keys only.
			const raw = typeof rec.command === "string" ? rec.command : `[input keys: ${Object.keys(rec).join(",")}]`;
			const reason =
				`"${event.toolName}" is not covered by the ky-pi-agent guard (unparseable or unreviewed tool path) -- ` +
				"it is blocked. Use bash, read, write or edit instead.";
			return deny(event.toolName, raw.slice(0, DENY_COMMAND_MAX), reason);
		}

		if (event.toolName === "bg_run") {
			const bg = guardBgRun(event.input, ctx);
			const command = (typeof rec.command === "string" ? rec.command : safeStringify(event.input)).slice(0, DENY_COMMAND_MAX);
			return bg.kind === "allow" ? allow("bg_run", command, "hook: allowed (bg_run classified as bash)") : deny("bg_run", command, bg.reason);
		}

		if (event.toolName === "subagent") {
			const call = classifySubagentCall(event.input);
			const full = safeStringify(event.input);
			const input = full.slice(0, DENY_COMMAND_MAX);
			if (call.kind === "read") return allow("subagent", input, `hook: read-only subagent action "${call.action}"`);
			if (call.kind === "launch") {
				const sessionId = sessionIdOf(ctx);
				return sessionId !== undefined && isChildGuardRegistered(sessionId)
					? allow("subagent", input, "hook: subagent launch with the required child guard registered")
					: deny("subagent", input, "subagent launch refused: the safety guard could not be registered as a required child extension, so children would run unguarded");
			}
			if (!canConfirm(ctx)) {
				return deny("subagent", input, `subagent action "${call.action}" changes agent definitions or schedules and needs a human confirm; none is available (mode "${ctx.mode}")`);
			}
			// The human must see the whole definition that would be written, so one too long to show is refused.
			if (full.length > DENY_COMMAND_MAX) {
				return deny("subagent", input, `subagent action "${call.action}" is longer than ${DENY_COMMAND_MAX} characters, too long to show in full for a confirm`);
			}
			const confirmKey = `${event.toolCallId}\0${full}`;
			if (secondLoad && takeSubagentConfirm(confirmKey)) {
				return allow("subagent", input, `hook: subagent action "${call.action}" already confirmed by the user in another loaded copy`);
			}
			if (!(await askUser(ctx, "Allow this subagent definition change?", `action: ${call.action}\n\n${input}`))) {
				return deny("subagent", input, `subagent action "${call.action}" was declined by the user`);
			}
			recordSubagentConfirm(confirmKey);
			return allow("subagent", input, `hook: subagent action "${call.action}" confirmed by the user`);
		}

		if (!HOOKED_TOOL_NAMES.has(event.toolName)) return undefined;
		const toolName = event.toolName;
		const command = extractCommandOrPath(toolName, event.input);
		const verdict = classifyAtWrapper(toolName, event.input, ctx);

		if (verdict.kind === "allow") return allow(toolName, command, "hook: allowed");

		if (verdict.kind === "ask") {
			if (peek(verdict.requestKey) && markHookDeferred(verdict.requestKey, event.toolCallId)) {
				return allow(toolName, command, `hook: a confirmation grant is present for this exact push -- deferring to the wrapper -- ${verdict.reason}`);
			}
			if (!canConfirm(ctx)) {
				return deny(toolName, command, `${verdict.reason} -- no interactive UI to confirm it (mode "${ctx.mode}"), so it is refused`);
			}
			if (!(await askUser(ctx, verdict.title, `${command}\n\n${verdict.prompt}`))) {
				return deny(toolName, command, `${verdict.reason} -- the user declined it`);
			}
			grantConfirmed(verdict.requestKey, command, verdict.reason);
			markHookDeferred(verdict.requestKey, event.toolCallId);
			return allow(toolName, command, `hook: confirmed by the user -- ${verdict.reason}`);
		}

		if (verdict.kind === "confirm") {
			// A grant exists: defer to the wrapper, which consumes it; never consume here. Deferral is scoped to one
			// toolCallId so every double-loaded copy of one call may defer (approvals.ts#markHookDeferred).
			if (peek(verdict.requestKey) && markHookDeferred(verdict.requestKey, event.toolCallId)) {
				return allow(toolName, command, `hook: an approval grant is present for this exact command -- deferring to the wrapper's one-shot consume -- ${verdict.reason}`);
			}
			const requestId = createPending(verdict.requestKey, command, verdict.reason);
			audit(toolName, command, "block", verdict.reason);
			return {
				block: true,
				reason:
					`${verdict.reason} -- this requires confirmation. Call ${APPROVE_TOOL_NAME} with ` +
					`request_id=${JSON.stringify(requestId)}, command=${JSON.stringify(command)} (byte-for-byte) and ` +
					`reason=${JSON.stringify(verdict.reason)} (byte-for-byte), then re-issue the identical ${toolName} call.`,
			};
		}

		return deny(toolName, command, verdict.reason);
	});
}

/** Event-bus channel a loaded copy answers on, so a second copy in the same runtime registers nothing. */
export const LOADED_CHANNEL = "ky-pi-agent.safety.loaded.v1";

interface LoadedProbe {
	loaded: boolean;
}

function isLoadedProbe(data: unknown): data is LoadedProbe {
	return data !== null && typeof data === "object" && "loaded" in data;
}

/**
 * Pi aborts startup when two extension paths register the same tool name (pi 1.1.0 core/resource-loader.js
 * detectExtensionConflicts; main.js exits on any load error), as the stub plus a trusted checkout did. A second copy
 * asks the shared event bus, which emits synchronously (core/event-bus.js), whether a complete copy already loaded,
 * and then registers its tool_call hook only: no tool to conflict, and the hook still guards should the answering
 * copy be dropped from the final extension set. A process flag would not do: /reload re-runs this factory
 * in-process, after Pi has unsubscribed the old runtime's bus handlers (agent-session.js#reload, loader.js invalidate).
 */
export default function (pi: ExtensionAPI): void {
	const probe: LoadedProbe = { loaded: false };
	pi.events?.emit(LOADED_CHANNEL, probe);
	if (probe.loaded) {
		registerToolCallHook(pi, true);
		return;
	}

	// Registrations first (first-registration-wins, pi 1.1.0 runner.js:410-417); safety-entry.test pins this order.
	registerWrappedTools(pi);
	registerApprovalTool(pi);

	registerToolCallHook(pi);

	pi.on("session_start", async (_event, ctx) => {
		// NEVER THROWS: retention only, so a failed prune must not affect session start.
		try {
			pruneAuditLogs(ctx.cwd);
		} catch {
			// Swallowed deliberately.
		}
		reportBranchWarnings(ctx, effectiveBranches(ctx.cwd).warnings, true);
		const sessionId = sessionIdOf(ctx);
		if (sessionId === undefined) return;
		// Not fatal: the subagent launch branch fails closed on its own, but the cause is recorded and shown.
		const registered = await registerChildGuard(sessionId, fileURLToPath(new URL("./index.ts", import.meta.url)), ctx.cwd, subagentSourcePaths(pi));
		if (!registered.ok) {
			const reason = `the safety guard could not be registered for subagent children, so subagent launches are refused: ${registered.reason}`;
			writeAuditRow(ctx.cwd, { event: HOOK_AUDIT_EVENT, tool: "subagent", command: "", cwd: ctx.cwd, verdict: "block", reason });
			if (ctx.hasUI) ctx.ui.notify(reason, "warning");
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const sessionId = sessionIdOf(ctx);
		if (sessionId !== undefined) disposeChildGuard(sessionId);
	});

	// Last, so only a copy whose every registration succeeded answers.
	pi.events?.on(LOADED_CHANNEL, (data) => {
		if (isLoadedProbe(data)) data.loaded = true;
	});
}
