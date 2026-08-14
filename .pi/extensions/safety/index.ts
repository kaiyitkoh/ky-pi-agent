/**
 * ky-pi-agent — Phase 4 safety extension entry point.
 *
 * PURPOSE. This file wires `policy.ts#evaluate` into Pi TWICE, and registers
 * the one tool that turns a "requires confirmation" verdict into a
 * structured, re-issuable protocol instead of a blocking dialog:
 *
 *   1. The `tool_call` HOOK — UX and early rejection. Fast, and what the
 *      model sees first when a command is denied.
 *   2. Each WRAPPED built-in tool's own `execute()` — the actual last
 *      checkpoint. It re-evaluates policy against whatever `params` really
 *      reach execution, not against what the hook saw.
 *   3. `approve_ky_command` — the only registered tool that is not a
 *      wrapper. It drives `ctx.ui.select()` under a real UI only, records a
 *      one-shot grant, and tells the model to re-issue the identical call.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO LAYERS, NOT ONE (CONTEXT.md decision 5, SAFE-09)
 * ---------------------------------------------------------------------------
 * Pi's own extension types document it: "`event.input` is mutable... Later
 * `tool_call` handlers see earlier mutations. No re-validation is performed
 * after mutation." [`dist/core/extensions/types.d.ts:687-688`]. A later-loaded
 * extension can rewrite `event.input.command` after this file's hook already
 * allowed it, and Pi never re-checks. A hook-only guard is defeated by that
 * mutation; the wrapped tool's `execute()` is not, because it evaluates the
 * params that actually reach execution, independent of what any hook saw.
 * `tests/integration/double-enforcement.test.ts` proves this by mutating
 * `event.input.command` from a hook-allowed value to a blocked one in a
 * SECOND `tool_call` handler and showing the wrapper still stops it
 * [T-04-02, mitigate].
 *
 * ---------------------------------------------------------------------------
 * REGISTRATION ORDER (CONTEXT.md decision 5's other half, RESEARCH Pattern 5)
 * ---------------------------------------------------------------------------
 * Tool-name collisions across extensions resolve FIRST-REGISTRATION-WINS
 * [VERIFIED: `dist/core/extensions/runner.js:280-291`]. The four wrapped
 * tools are therefore registered before the `tool_call` hook, before
 * `approve_ky_command`, before anything else in this file — if some other
 * extension in this repo's own `.pi/extensions/` auto-discovery order
 * registers a tool literally named "bash" (or "read"/"write"/"edit") before
 * this file's default export runs, this wrapper never executes at all,
 * silently, with no error anywhere. `tests/unit/safety-entry.test.ts` pins
 * this file's OWN source order; load order ACROSS extensions is a residual
 * risk this file cannot close alone, tracked as T-04-08 and documented in
 * `docs/SAFETY.md` (Plan 11), compensated by SAFE-01's server-side branch
 * protection.
 *
 * ---------------------------------------------------------------------------
 * LOCAL FAILURE CONTAINMENT, NOT AN IMPORT OF diagnostics/index.ts#safeHandler
 * ---------------------------------------------------------------------------
 * CONTEXT.md decision 7 requires `safety/` to stay source-reviewable in
 * isolation, on a laptop where merging to `main` auto-deploys; 04-PATTERNS.md
 * flagged this composition choice as deferred to this plan, and it is decided
 * here. {@link classifyAtWrapper} is this file's own minimal equivalent: it
 * NEVER throws — a classification bug converts to a `block` VERDICT, exactly
 * mirroring `policy.ts#evaluate`'s own "a classifier throwing is caught and
 * converted to a block, never left to propagate" contract — because Pi
 * swallows every exception an extension handler throws
 * [VERIFIED: `dist/core/extensions/runner.js:861-870`, the same citation
 * `diagnostics/index.ts:87-93` already verified for this codebase], and a
 * guard whose bug silently returns `undefined` from a swallowed hook
 * exception is a guard that allows [T-04-42, mitigate]. The HOOK then returns
 * `{block:true,reason}` for that verdict (never lets Pi swallow it into
 * silence); the WRAPPER throws (a throw is what Pi's own agent loop turns
 * into `isError:true` for the model
 * [VERIFIED: `pi-agent-core/dist/agent-loop.js:444-449`,
 * `createErrorToolResult`]). Every call path — allow, confirm, block, and the
 * exception-converted-to-block case — writes EXACTLY ONE audit row, at the
 * single point where the verdict is finally acted on.
 *
 * ---------------------------------------------------------------------------
 * THE CONFIRMATION PROTOCOL NEVER USES AN INLINE DIALOG (CONTEXT.md decision 4)
 * ---------------------------------------------------------------------------
 * `noOpUIContext.confirm` returns `false` and `noOpUIContext.select` returns
 * `undefined` under `--mode json`/`-p`/a spawned subagent
 * [VERIFIED: `dist/core/extensions/runner.js:88-119`, `hasUI()` an
 * object-identity check at `:274-276`]. This file never calls
 * `ctx.ui.confirm(` anywhere (`tests/unit/safety-entry.test.ts` greps for it);
 * `ctx.ui.select(` appears exactly once, inside `approve_ky_command`'s own
 * `execute()`, gated behind `ctx.hasUI`, and is written as "approve ONLY on an
 * explicit affirmative" rather than "refuse only when the UI said no"
 * [T-04-03, mitigate] — the inversion CONTEXT.md decision 4 and RESEARCH
 * Pattern 4 both name as the failure that falls open headless.
 *
 * ---------------------------------------------------------------------------
 * LAYOUT. Sibling modules this file composes, and what each owns:
 * ---------------------------------------------------------------------------
 *   shell.ts, paths.ts, git.ts, infra.ts — the pure classifiers (Plans 03-06)
 *   policy.ts    — evaluate(): the single deny-by-default decision (Plan 07)
 *   approvals.ts — the one-shot, command-bound, expiring grant store (Plan 07)
 *   audit.ts     — writeAuditRow / pruneAuditLogs, SAFE-14 (Plan 02)
 *
 * BOUNDARY RULE (BOOT-10), extended rather than broken by this file. Per
 * CONTRIBUTING.md's boundary rule, registering a tool requires answering (a)
 * must the model call this mid-turn, (b) the measured schema token cost, (c)
 * why a skill cannot carry it — see the `TOOL_REGISTRATION_ALLOWLIST` entry
 * this plan adds to `tests/unit/contributing-boundary.test.ts`, in the same
 * commit, with all three answers written there.
 */
import { homedir } from "node:os";

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { approve, consume, createPending, peek, validate } from "./approvals.ts";
import { pruneAuditLogs, writeAuditRow } from "./audit.ts";
import { currentBranch } from "./git.ts";
import { canonicalisePathArg } from "./paths.ts";
import { evaluate, type PolicyFacts, type Verdict } from "./policy.ts";

// ---------------------------------------------------------------------------
// Exported literals — the house rule from `harness/index.ts:50-56`: a test
// imports these instead of retyping them, so a rename cannot silently stop
// an assertion from matching the real string.
// ---------------------------------------------------------------------------

/** The one tool this file registers that is not a wrapper over a built-in. */
export const APPROVE_TOOL_NAME = "approve_ky_command";

/** `event` on every row the `tool_call` hook writes. */
export const HOOK_AUDIT_EVENT = "safety.tool_call_hook";

/** `event` on every row a wrapped tool's `execute()` writes. */
export const WRAPPER_AUDIT_EVENT = "safety.wrapped_execute";

/** `event` on every row `approve_ky_command` writes. */
export const APPROVAL_AUDIT_EVENT = "safety.approve_ky_command";

/**
 * Branch names treated as protected, forwarded to `git.ts#classifyGitInvocation`
 * via {@link buildFacts}. `main` is this project's own default branch;
 * `master` is read too per 04-RESEARCH.md's Pitfall 5 remedy ("read `master`
 * too, and prefer whatever `git symbolic-ref refs/remotes/origin/HEAD`
 * reports if available" — the latter half is Claude's-discretion scope this
 * plan does not need, since both literal names are compared
 * case-insensitively in `git.ts#isProtected`).
 */
export const PROTECTED_BRANCHES: readonly string[] = ["main", "master"];

/** The two choices `approve_ky_command`'s `ctx.ui.select()` offers. */
const APPROVE_CHOICE = "Approve";
const DENY_CHOICE = "Deny";

// ---------------------------------------------------------------------------
// PolicyFacts assembly — the one place this file touches the environment
// ---------------------------------------------------------------------------

/**
 * CR-02: reduce an already-absolute path (`ctx.cwd`, `os.homedir()`) to the
 * SAME canonical forward-slash form `paths.ts#classifyPathWrite`'s
 * containment check and its `DETONATION_TARGETS` home-anchored rules compare
 * against. On Windows both `ctx.cwd` and `homedir()` are backslash strings
 * (`C:\Users\Admin\...`); `paths.ts` canonicalises the TARGET path it is
 * given but never re-normalises a caller-supplied `facts.projectRoot`/
 * `facts.home` -- so handing either through unnormalised makes
 * `rootedSegmentsOf()` parse a `C:\...` root as root `"/"` with one giant
 * segment (fail-closed but harness-breaking: every write blocked) and makes
 * the home-anchored detonation rules build a comparand
 * (`` `${facts.home}/.bashrc` ``) that can never match the canonicalised
 * target (fail-open: a real `~/.bashrc` write stops being caught by the
 * `bashrc` rule at all, and instead only accidentally blocks via the
 * containment rule for the wrong reason).
 *
 * `cwd`/`home` are already absolute here, so `canonicalisePathArg` is called
 * with a resolution context that is the path itself -- `isAbsolutePath` short-
 * circuits the relative-join branch, so the self-referential `cwd`/`home`
 * values passed as context are never actually used to resolve anything.
 */
function toCanonicalRoot(absolutePath: string): string {
	return canonicalisePathArg({ text: absolutePath, value: absolutePath }, { cwd: absolutePath, home: absolutePath });
}

/**
 * Build the caller-supplied facts `evaluate()` needs, from a real
 * `ExtensionContext`. `policy.ts`/`git.ts`/`paths.ts` all stay pure; this
 * function is where `ctx.cwd`, `os.homedir()` and `process.env.KUBECONFIG`
 * — the impure world — become the plain data object those modules read.
 *
 * `projectRoot` is `ctx.cwd`, canonicalised: this extension has no separate
 * notion of "the project" beyond the session's own working directory, which
 * is exactly what `paths.ts#classifyPathWrite`'s containment check needs to
 * compare a write target against -- and that comparison is only correct when
 * both sides went through the SAME canonicalisation (CR-02).
 */
function buildFacts(ctx: ExtensionContext): PolicyFacts {
	const cwd = toCanonicalRoot(ctx.cwd);
	return {
		cwd,
		projectRoot: cwd,
		home: toCanonicalRoot(homedir()),
		// Called lazily by evaluate() -- ONLY for an invocation whose executable
		// is literally "git", per git.ts's own module docstring. A command with
		// no git invocation never triggers this spawnSync call.
		currentBranchFor: (cwd: string) => currentBranch(cwd),
		protectedBranches: PROTECTED_BRANCHES,
		kubeconfigEnv: process.env.KUBECONFIG,
	};
}

/**
 * Pull the one field `evaluate()`'s malformed-input check cares about out of
 * a tool call's `input`/`params`, for AUDIT purposes only — never re-parsed,
 * never re-validated, just read for the row. `bash` carries `command`;
 * `read`/`write`/`edit` carry `path`. Malformed input (missing/non-string)
 * yields `""`, which is exactly what `policy.ts#extractStringField` would
 * also call malformed -- `evaluate()` blocks it independently; this function
 * only decides what the audit row's `command` column says.
 */
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
	return "";
}

// ---------------------------------------------------------------------------
// The local failure-containment wrapper (see module docstring)
// ---------------------------------------------------------------------------

/**
 * Classify one `bash`/`read`/`write`/`edit` call, at either enforcement
 * point. NEVER THROWS -- a bug anywhere in this file's OWN classification
 * path (not `evaluate()` itself, which already converts a classifier
 * exception to a block per its own module docstring) converts to a `block`
 * verdict here, so the caller's own single allow/confirm/block dispatch
 * writes exactly one audit row for the exception path too, same as every
 * other path. [T-04-42]
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

/**
 * Act on a wrapped tool's verdict: write exactly one audit row, then either
 * return normally (allow, or a confirm verdict whose one-shot grant was just
 * consumed) or THROW (block, or confirm with nothing to consume). A throw
 * from a tool's `execute()` is what Pi's agent loop turns into `isError:true`
 * for the model [VERIFIED: `pi-agent-core/dist/agent-loop.js:444-449`], which
 * is the behaviour this project wants -- never `ctx.ui.confirm()`, never a
 * silent no-op.
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

	// Either an outright block, or a confirm verdict with no matching one-shot
	// grant (never approved, already consumed, expired, or -- the SAFE-09
	// mutation case -- a DIFFERENT command than the one that was approved,
	// which computes a different requestKey and was therefore never granted
	// at all). Either way: block, and throw.
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

// ---------------------------------------------------------------------------
// Task 1 — the four wrapped built-in tools, registered FIRST
// ---------------------------------------------------------------------------

/**
 * Wrap `bash`/`read`/`write`/`edit`/`grep`/`find`/`ls` via the spread-override
 * shape 04-RESEARCH.md verified (`pi.registerTool({ ...tool, execute: wrapped
 * })`), using the exported factories `createBashTool`/`createReadTool`/
 * `createWriteTool`/`createEditTool`/`createGrepTool`/`createFindTool`/
 * `createLsTool`. Each wrapped `execute()` re-evaluates policy against the
 * PARAMS IT ACTUALLY RECEIVES -- the second enforcement layer CONTEXT.md
 * decision 5 requires, closing the gap a `tool_call`-hook-only guard leaves
 * open to a later extension's `event.input` mutation. CR-04: `grep`/`find`/
 * `ls` are three of Pi's seven built-in tools
 * [VERIFIED: `dist/core/tools/index.js`, `allToolNames`] and were previously
 * unguarded and unaudited entirely -- `grep { pattern: ".", path:
 * "~/.aws/credentials" }` returned the secret straight into the model's
 * context with no verdict at all, reachable with no shell involved.
 *
 * The delegate call omits `ctx` (`bashTool.execute(toolCallId, params,
 * signal, onUpdate)`, four arguments): `AgentTool.execute`'s own declared
 * type carries no fifth `ctx` parameter
 * [VERIFIED: `pi-agent-core/dist/types.d.ts:348`], and the runtime adapter
 * that produces these factories treats a missing `ctx` as `undefined` and
 * degrades gracefully -- the bash tool's own `resolveSpawnContext` only
 * reads `ctx` to decorate the child environment with session metadata when
 * `ctx` is truthy [VERIFIED: `dist/core/tools/bash.js:124`], and the path
 * tools resolve every path against their OWN closed-over `cwd`, never `ctx`
 * [VERIFIED: `dist/core/tools/read.js:134,158`].
 *
 * WR-02: EVERY delegate is constructed FRESH, from `ctx.cwd`, INSIDE each
 * call's own `execute()` -- never from a single `process.cwd()`-closed-over
 * instance built once at registration time. `registerTool` still needs one
 * definition object up front for its static metadata (name/description/
 * parameter schema), built from `process.cwd()` at registration time because
 * no `ctx` exists yet at that point -- but that instance's own `execute` is
 * NEVER what actually runs; it exists only to be spread for its schema. The
 * REAL work always goes through a tool built from `ctx.cwd`, the exact same
 * root `classifyAtWrapper`/`buildFacts` just evaluated policy against. Without
 * this, a session whose `ctx.cwd` diverges from the extension's own
 * `process.cwd()` (a subagent process, or -- proven by
 * `tests/integration/double-enforcement.test.ts`'s own faux-session harness,
 * whose session cwd is a temp dir while the vitest process's own cwd is the
 * repo root) would have policy check ONE root while the real tool acted
 * against ANOTHER -- a genuine check-here/act-there split. The factories are
 * cheap, pure constructors (`createBashTool` etc. just close over `cwd` and
 * return a plain object -- no I/O, no subprocess) so re-creating one per call
 * costs nothing measurable.
 */
function registerWrappedTools(pi: ExtensionAPI): void {
	// ONLY for registerTool's static metadata (name/description/schema) --
	// see the WR-02 section of this function's docstring. Never executed.
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

	// CR-04: grep/find/ls are three of Pi's seven built-in tools and were
	// previously unwrapped entirely -- see this function's own docstring.
	pi.registerTool({
		...createGrepTool(metadataCwd),
		execute: async (toolCallId, params, signal, onUpdate, ctx) => {
			const command = extractCommandOrPath("grep", params);
			wrapperOutcome("grep", command, ctx, classifyAtWrapper("grep", params, ctx));
			return createGrepTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...createFindTool(metadataCwd),
		execute: async (toolCallId, params, signal, onUpdate, ctx) => {
			const command = extractCommandOrPath("find", params);
			wrapperOutcome("find", command, ctx, classifyAtWrapper("find", params, ctx));
			return createFindTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...createLsTool(metadataCwd),
		execute: async (toolCallId, params, signal, onUpdate, ctx) => {
			const command = extractCommandOrPath("ls", params);
			wrapperOutcome("ls", command, ctx, classifyAtWrapper("ls", params, ctx));
			return createLsTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
		},
	});
}

// ---------------------------------------------------------------------------
// Task 1 — approve_ky_command: block -> approval-tool -> re-issue
// ---------------------------------------------------------------------------

/**
 * Parameter schema, `Type.Object` from unscoped `typebox`. `blast_radius`
 * uses `StringEnum` from `@earendil-works/pi-ai`, never `Type.Union`/
 * `Type.Literal` for a string enum -- CLAUDE.md's "What NOT to Use" states
 * that shape breaks against Google's API.
 *
 * MEASURED, NOT ESTIMATED (CONTRIBUTING.md's boundary rule, answer (b)):
 * serialised as `{type:"function",function:{name,description,parameters}}`
 * (the shape `openai-completions.ts:1337-1372` actually sends), this schema
 * is 1099 bytes -- `Math.ceil(1099 / 4) = 275` tokens by this project's own
 * estimator [`diagnostics/budget.ts:223-224`, Pi's own `chars/4` formula].
 * Recorded verbatim in `tests/unit/contributing-boundary.test.ts`'s
 * `TOOL_REGISTRATION_ALLOWLIST` comment and in this plan's SUMMARY.
 */
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
 * The one registered tool that is not a wrapper. No `promptSnippet`, no
 * `promptGuidelines` -- CONTRIBUTING.md's corollary: activating a tool that
 * carries either rebuilds the system prompt and invalidates the provider
 * cache prefix, and this tool is used rarely enough that its description
 * alone is sufficient (matching `docs/extensions.md`'s own guidance that
 * lazily-loaded tools "should usually rely on their tool `description` and
 * omit active-only prompt metadata").
 *
 * `execute()`:
 *   1. `validate(request_id, command, reason)` -- all three, byte-for-byte
 *      [T-04-09, mitigate: a model cannot launder an EDITED command through
 *      a legitimate pending request id].
 *   2. Approve ONLY on an explicit affirmative from `ctx.ui.select` --
 *      `undefined` (the headless `noOpUIContext` value) and `hasUI === false`
 *      both refuse. Written as "approve only when the choice is exactly
 *      `Approve`", never as "refuse only when the choice is exactly `Deny`"
 *      [T-04-03, mitigate].
 *   3. On approval, `approve(...)` and tell the model to re-issue the
 *      identical command -- the hook and the wrapper both recompute the same
 *      `requestKey` independently and consume the grant on the retry.
 *
 * Every branch writes exactly one audit row before returning or throwing.
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

			// Deny-by-default: approve ONLY on an explicit affirmative from
			// ctx.ui.select. Never `if (ctx.hasUI && choice !== "Approve") block`
			// written the other way round -- that shape falls through to allow
			// with no UI bound. `undefined` (noOpUIContext's headless value) and
			// `hasUI === false` both refuse via the SAME branch below.
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
				// Unreachable given validate() above just returned true and nothing
				// else in this single synchronous execute() call can race the store
				// -- denied anyway rather than assumed, mirroring approvals.ts's own
				// deny-shaped posture.
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

// ---------------------------------------------------------------------------
// Task 1 — the tool_call hook: UX and early rejection
// ---------------------------------------------------------------------------

/**
 * Fires for `bash`/`read`/`write`/`edit`/`grep`/`find`/`ls` only -- every
 * other tool name returns `undefined` immediately, unaudited, matching
 * `policy.ts#evaluate`'s own "this guard governs exactly these tool names"
 * contract (SAFE-15's published limits table names the gap for every OTHER
 * tool explicitly, rather than this file silently claiming coverage it does
 * not have). CR-04: `grep`/`find`/`ls` were added to close the gap where
 * three of Pi's seven built-in tools reached execution with no verdict and no
 * audit row at all -- this list MUST stay in sync with
 * {@link registerWrappedTools}'s own tool-name set and with `policy.ts#evaluate`'s
 * `switch`.
 *
 * On `allow`, returns `undefined` -- never mutates `event.input`. On
 * `confirm`:
 *   - if an approval grant ALREADY EXISTS for this exact command (CR-01: the
 *     model re-issuing a command a human just approved via
 *     {@link APPROVE_TOOL_NAME}), the hook returns `undefined` and lets the
 *     call proceed to the wrapped tool's own `execute()`, which performs the
 *     actual one-shot {@link consume} -- see `approvals.ts`'s module
 *     docstring, "THE PROTOCOL THIS STORE IMPLEMENTS", step 4. The hook itself
 *     NEVER consumes: `peek()` is a non-mutating read, so the SAME grant is
 *     still there for the wrapper to actually spend. If the hook consumed
 *     here, the wrapper's own `consume()` on this exact retry would always
 *     find nothing and block the just-approved command forever -- this is the
 *     bug CR-01 fixes: `approve_ky_command` was dead code because nothing
 *     ever reached this branch's now-removed unconditional re-block.
 *   - otherwise, creates a pending approval and blocks with a reason that
 *     embeds the request id and a literal instruction to call
 *     {@link APPROVE_TOOL_NAME}.
 * On `block`, blocks with the classifier's reason. `terminate` is never set
 * -- RESEARCH/CONTEXT both note it applies only to a blocked call and only
 * stops the agent when EVERY finalized result in the batch terminates, so it
 * is not an enforcement mechanism.
 *
 * Never calls `ctx.ui.confirm(` or `ctx.ui.select(` -- both live only inside
 * {@link registerApprovalTool}'s own `execute()`, gated behind a real UI.
 */
function registerToolCallHook(pi: ExtensionAPI): void {
	pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | undefined> => {
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
			});
			return undefined;
		}

		if (verdict.kind === "confirm") {
			// CR-01: a grant already exists (the command was approved and is now
			// being re-issued) -- defer to the wrapper, which performs the actual
			// one-shot consume. NEVER consume here; see this function's own
			// docstring.
			if (peek(verdict.requestKey)) {
				writeAuditRow(ctx.cwd, {
					event: HOOK_AUDIT_EVENT,
					tool: toolName,
					command,
					cwd: ctx.cwd,
					verdict: "allow",
					reason: `hook: an approval grant is present for this exact command -- deferring to the wrapper's one-shot consume -- ${verdict.reason}`,
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
			});
			return {
				block: true,
				reason:
					`${verdict.reason} -- this requires confirmation. Call ${APPROVE_TOOL_NAME} with ` +
					`request_id=${JSON.stringify(requestId)}, command=${JSON.stringify(command)} (byte-for-byte) and ` +
					`reason=${JSON.stringify(verdict.reason)} (byte-for-byte), then re-issue the identical ${toolName} call.`,
			};
		}

		// verdict.kind === "block"
		writeAuditRow(ctx.cwd, {
			event: HOOK_AUDIT_EVENT,
			tool: toolName,
			command,
			cwd: ctx.cwd,
			verdict: "block",
			reason: verdict.reason,
		});
		return { block: true, reason: verdict.reason };
	});
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * `globalThis` slot name guarding WR-07's double-registration hazard --
 * `bin/bootstrap.sh#install_safety_extension` writes a user-scope stub that
 * re-exports this file's default export, and Pi ALSO auto-discovers the
 * project-scoped copy at `.pi/extensions/safety/index.ts` when running inside
 * this trusted repository. Both default exports would otherwise run: harmless
 * for `pi.registerTool` (first-registration-wins silently discards the
 * second set), but NOT harmless for `pi.on("tool_call", ...)` -- Pi calls
 * EVERY registered handler for a given event, so a second `registerToolCallHook`
 * call registers a SECOND independent handler, producing two audit rows per
 * tool call and, worse, two `pending` entries minted per `confirm` block
 * (compounding WR-05). Exported so a test can assert against the real key
 * rather than retyping the literal, matching the house rule
 * `approvals.ts#APPROVALS_STORE_KEY` already follows for the identical
 * cross-instance hazard.
 */
export const SAFETY_INSTALLED_KEY = "__kyPiSafetyExtensionInstalled";

/**
 * Test-only: forget that the safety extension has already installed itself
 * into this process. A real `pi` process is one session, so production code
 * never calls this -- but a single vitest WORKER process legitimately
 * simulates several independent sessions in a row within one process
 * (`tests/unit/safety-entry.test.ts` and
 * `tests/integration/double-enforcement.test.ts` both invoke this file's
 * default export more than once), and the WR-07 guard below would otherwise
 * make every session after the first a silent no-op in exactly those tests.
 * Mirrors `.pi/lib/jsonl.ts#resetProducedPaths`'s own "exported for tests"
 * pattern for the identical class of hazard.
 */
export function resetSafetyInstalledForTests(): void {
	const globalSlot = globalThis as unknown as Record<string, boolean | undefined>;
	delete globalSlot[SAFETY_INSTALLED_KEY];
}

export default function (pi: ExtensionAPI): void {
	// WR-07: idempotent across the double-load this project's own bootstrap
	// deliberately causes (project-scope auto-discovery + user-scope stub).
	// `globalThis` is shared across every jiti module instance in one process
	// -- the same pattern `approvals.ts#getStore` already uses for the
	// identical class of hazard -- so the SECOND invocation, regardless of
	// which load path reached it, sees the flag and returns before
	// registering anything a second time.
	const globalSlot = globalThis as unknown as Record<string, boolean | undefined>;
	if (globalSlot[SAFETY_INSTALLED_KEY] === true) {
		return;
	}
	globalSlot[SAFETY_INSTALLED_KEY] = true;

	// Tool registrations FIRST -- see the module docstring's REGISTRATION
	// ORDER section. tests/unit/safety-entry.test.ts pins this source order.
	registerWrappedTools(pi);
	registerApprovalTool(pi);

	// The tool_call hook, registered after every tool this file owns.
	registerToolCallHook(pi);

	// Retention, mirroring diagnostics/index.ts's own session_start pruning:
	// cheap, deterministic, off the hot path. Best-effort -- a failure here
	// must not affect whether the session starts, and there is no command to
	// audit a pruning failure against.
	pi.on("session_start", async (_event, ctx) => {
		try {
			pruneAuditLogs(ctx.cwd);
		} catch {
			// Swallowed deliberately -- see the comment above.
		}
	});
}
