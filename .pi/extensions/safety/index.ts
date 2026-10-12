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
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { approve, consume, createPending, markHookDeferred, peek, validate } from "./approvals.ts";
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
 * `read`/`write`/`edit`/`find`/`ls` carry `path`. `grep` can be blocked on
 * its `glob` (or `pattern`) field alone, with NO `path` present at all --
 * `policy.ts#evaluateGrep` checks `path` first, then `glob` (EV-53,
 * `{ pattern: "=", glob: ".env" }`, is exactly this shape) -- so `grep` falls
 * back to `glob`, then `pattern`, when `path` is absent: IN-04, without this
 * fallback the audit row for that shape recorded `command: ""`, losing the
 * exact field that caused the block. Malformed input (missing/non-string)
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
 * Wrap `bash`/`read`/`write`/`edit` via the spread-override shape
 * 04-RESEARCH.md verified (`pi.registerTool({ ...tool, execute: wrapped })`),
 * using the exported factories `createBashTool`/`createReadTool`/
 * `createWriteTool`/`createEditTool`. Each wrapped `execute()` re-evaluates
 * policy against the PARAMS IT ACTUALLY RECEIVES -- the second enforcement
 * layer CONTEXT.md decision 5 requires, closing the gap a `tool_call`-hook-
 * only guard leaves open to a later extension's `event.input` mutation.
 *
 * WR-09: `grep`/`find`/`ls` are deliberately NOT wrapped here, even though
 * `policy.ts#evaluate()` and {@link registerToolCallHook}'s own filter both
 * cover all seven of Pi's built-in tool names. CR-04 originally wrapped all
 * three, reasoning they were "default-active" -- wrong, checked at source:
 * Pi 0.84.1's default active tool set is `["read","bash","edit","write"]`
 * [VERIFIED: `dist/core/sdk.js:132,136`], and this repository's
 * `.pi/settings.json` is `{}`, so nothing overrides it -- `grep`/`find`/`ls`
 * are *registered* by Pi but not *active*; the model cannot call them at all
 * absent something ELSE activating them. Registering them as EXTENSION tools
 * flips that: `_refreshToolRegistry` runs with `includeAllExtensionTools:
 * true` at boot and on reload [`agent-session.js:158-161`, `:1993-2003`] and
 * pushes every extension tool into the active set -- so wrapping them to
 * GUARD them would ACTIVATE three tools the model could not otherwise call,
 * at a measured 532 tokens/turn (`grep` 260, `find` 154, `ls` 118 -- this
 * project's own `chars/4` estimator over the exact `tools[]` schema shape),
 * on a project whose stated core value is that the harness must not become
 * the bottleneck for a cheap model. The guard this file provides for
 * grep/find/ls is therefore SINGLE-layer: {@link registerToolCallHook}'s own
 * tool-name filter still audits/denies a call to any of the three IF some
 * other extension (or a future Pi default) ever activates them, at zero
 * schema cost -- but there is no wrapper re-check the way there is for the
 * four tools below. `docs/SAFETY.md`'s "What this guard does not register"
 * section states this trade-off; `tests/unit/contributing-boundary.test.ts`'s
 * BOOT-10 (b) justification is accurate again once these three are not
 * registered (its own 275-token, four-wrapped-tool accounting was true
 * before CR-04 activated grep/find/ls and is true again now).
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
// 08.1-03 -- Pi 1.x tool-path deny table (UPG-03)
// ---------------------------------------------------------------------------

/**
 * Exact tool names the hook denies outright. Derived at source:
 *  - "powershell": Pi 1.1.0 types.d.ts PowerShellToolCallEvent (922-925); unbash cannot parse it.
 *  - "codemode": pi-coding-agent dist/extensions/codemode/tool.js:31 (CODEMODE_TOOL_NAME).
 *  - "tool_search": dist/extensions/tool-search/tool.js:11 (TOOL_SEARCH_TOOL_NAME).
 *  - MCP resource tools: dist/extensions/mcp/resources.js:2-3,192,208,224.
 *  - Prefix "mcp__": dist/extensions/mcp/tools.js:46 (`mcp__<server>__<tool>`).
 *  - pi-background-tasks@2.6.9 tools OUTSIDE the "process" feature, and the one
 *    process-adjacent tool that takes a prompt/argv: bg_run_pi_attested
 *    (src/extension.ts:1036, params 159-181: prompt, extraPiArgs, reportPath),
 *    bg_delegate (src/core/delegate/types.ts:32), delegate_read_artifact
 *    (src/delegate-child-extension.ts:601), fusion_* (src/core/fusion/*.ts).
 *    bg_status/bg_logs/bg_kill take only taskId/maxBytes/tail (extension.ts:184-209)
 *    and bg_result is id-only: no mapping needed.
 * Codemode nested calls reach this hook too (agent-session.js:326-343, :388-416).
 * EV-42 still holds generically for OTHER extension tools; see docs/SAFETY.md.
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

// ---------------------------------------------------------------------------
// Task 1 — the tool_call hook: UX and early rejection
// ---------------------------------------------------------------------------

/**
 * 08.1-03: BEFORE the built-in filter, a deny table (DENIED_TOOL_NAMES /
 * DENIED_TOOL_PREFIXES, with 1.1.0 file:line citations) blocks powershell, MCP,
 * codemode and tool_search, and `bg_run` is classified as `bash` (confirm ->
 * block, no wrapper to consume grants). Nested codemode calls reach this hook
 * with `parentToolCallId` (agent-session.js:326-343), recorded in audit rows.
 *
 * Fires for `bash`/`read`/`write`/`edit`/`grep`/`find`/`ls` only -- every
 * other (non-denied) tool name returns `undefined` immediately, unaudited (EV-42), matching
 * `policy.ts#evaluate`'s own "this guard governs exactly these tool names"
 * contract (SAFE-15's published limits table names the gap for every OTHER
 * tool explicitly, rather than this file silently claiming coverage it does
 * not have). WR-09: this list DELIBERATELY stays wider than
 * {@link registerWrappedTools}'s own tool-name set -- `grep`/`find`/`ls` are
 * NOT wrapped (see that function's own WR-09 docstring section: wrapping
 * them would ACTIVATE three tools Pi does not activate by default, at a real
 * per-turn token cost), but this filter still names all seven, so a call to
 * any of the three is audited and denied at the HOOK layer alone -- at zero
 * schema cost -- if some other extension (or a future Pi default) ever
 * activates them. This list must stay in sync with `policy.ts#evaluate`'s
 * own `switch`, which is the thing that actually decides the verdict.
 *
 * On `allow`, returns `undefined` -- never mutates `event.input`. On
 * `confirm`:
 *   - if an approval grant ALREADY EXISTS for this exact command (CR-01: the
 *     model re-issuing a command a human just approved via
 *     {@link APPROVE_TOOL_NAME}) AND this is a deferral belonging to the SAME
 *     tool call as the first one (WR-12/CR-11: {@link markHookDeferred},
 *     keyed on BOTH `requestKey` and `event.toolCallId`, returns `true`), the
 *     hook returns `undefined` and lets the call proceed to the wrapped
 *     tool's own `execute()`, which performs the actual one-shot
 *     {@link consume} -- see `approvals.ts`'s module docstring, "THE PROTOCOL
 *     THIS STORE IMPLEMENTS", step 4. The hook itself NEVER consumes:
 *     `peek()` is a non-mutating read, so the SAME grant is still there for
 *     the wrapper to actually spend. If the hook consumed here, the
 *     wrapper's own `consume()` on this exact retry would always find
 *     nothing and block the just-approved command forever -- this is the bug
 *     CR-01 fixes: `approve_ky_command` was dead code because nothing ever
 *     reached this branch's now-removed unconditional re-block. CR-11: under
 *     WR-07/CR-09's accepted double load, EVERY loaded copy's hook fires for
 *     this SAME tool call and MUST be able to defer here -- keying purely on
 *     `requestKey` (the original WR-12 shape) let only the first copy defer
 *     and made the second one block, permanently defeating this protocol the
 *     moment a second copy loaded; see `docs/SAFETY.md`'s "Load order is
 *     part of this" section.
 *   - otherwise (no grant, OR a grant exists but a DIFFERENT tool call --
 *     i.e. a genuine re-issue -- already deferred to it once with no
 *     intervening `consume()` -- WR-12: the documented T-04-08/CR-06 shapes
 *     where the wrapper that would have consumed it never actually ran),
 *     creates a pending approval and blocks with a reason that embeds the
 *     request id and a literal instruction to call {@link APPROVE_TOOL_NAME}.
 *     This is what bounds an unconsumed grant's unguarded window to
 *     `HOOK_DEFER_TTL_MS` (seconds) instead of the grant's own
 *     `APPROVAL_TTL_MS` (10 minutes).
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
		const parentToolCallId = event.parentToolCallId;

		// 08.1-03 (a): DENY table -- fail closed, even on malformed input.
		if (isDeniedToolName(event.toolName)) {
			const rec = event.input !== null && typeof event.input === "object" ? (event.input as Record<string, unknown>) : {};
			const raw = typeof rec.command === "string" ? rec.command : safeStringify(event.input);
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

		// 08.1-03 (b): bg_run -> classified EXACTLY as bash with the same command.
		const isBgRun = event.toolName === "bg_run";
		if (isBgRun) {
			const rec = event.input !== null && typeof event.input === "object" ? (event.input as Record<string, unknown>) : {};
			if (typeof rec.command !== "string" || rec.command.trim() === "") {
				const reason = "bg_run called without a non-empty string command -- blocked (fail closed)";
				writeAuditRow(ctx.cwd, {
					event: HOOK_AUDIT_EVENT,
					tool: "bg_run",
					command: safeStringify(event.input).slice(0, DENY_COMMAND_MAX),
					cwd: ctx.cwd,
					verdict: "block",
					reason,
					parentToolCallId,
				});
				return { block: true, reason };
			}
			const bgVerdict = classifyAtWrapper("bash", { command: rec.command }, ctx);
			if (bgVerdict.kind === "allow") {
				writeAuditRow(ctx.cwd, {
					event: HOOK_AUDIT_EVENT,
					tool: "bg_run",
					command: rec.command,
					cwd: ctx.cwd,
					verdict: "allow",
					reason: "hook: allowed (bg_run classified as bash)",
					parentToolCallId,
				});
				return undefined;
			}
			// A confirm verdict BLOCKS for bg_run: the approve-and-reissue protocol
			// consumes grants in the bash wrapper's execute(), and bg_run has no
			// wrapper, so deferring would let it run unconsumed. Never defer here.
			const reason =
				bgVerdict.kind === "confirm"
					? `${bgVerdict.reason} -- bg_run cannot use the approval protocol; run it through bash instead`
					: bgVerdict.reason;
			writeAuditRow(ctx.cwd, {
				event: HOOK_AUDIT_EVENT,
				tool: "bg_run",
				command: rec.command,
				cwd: ctx.cwd,
				verdict: "block",
				reason,
				parentToolCallId,
			});
			return { block: true, reason };
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
			// CR-01: a grant already exists (the command was approved and is now
			// being re-issued) -- defer to the wrapper, which performs the actual
			// one-shot consume. NEVER consume here; see this function's own
			// docstring.
			//
			// WR-12/CR-11: deferral itself is now SELF-LIMITING, scoped to ONE
			// tool call. markHookDeferred() returns true for every hook
			// invocation that shares the SAME event.toolCallId as the first
			// defer for this requestKey -- which is exactly what happens when
			// this extension is loaded more than once in one process (WR-07/
			// CR-09's accepted double load): Pi drives every loaded copy's
			// tool_call hook for the SAME tool call, so all of them must be able
			// to defer, because only the single first-registered wrapper ever
			// actually consumes the grant. A DIFFERENT toolCallId -- a genuine
			// re-issue, a new tool call, while the marker is still live and
			// nothing consumed the grant -- returns false and falls through to
			// the normal mint-a-fresh-pending-request path below, exactly as if
			// no grant existed. CR-11: the earlier requestKey-only version of
			// this marker made the SECOND hook of the SAME double-loaded tool
			// call fail this check and block, which permanently defeated the
			// confirm -> approve -> re-issue protocol under a double load --
			// see approvals.ts#markHookDeferred's own docstring for the full
			// citation trail and `docs/SAFETY.md`'s "Load order is part of
			// this" section for the published account of the double-load trade.
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

		// verdict.kind === "block"
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

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * CR-06 -- there is DELIBERATELY no idempotency guard here anymore. The
 * WR-07 fix (iteration 1) added a `globalThis`-keyed "already installed"
 * flag that made this file a permanent PROCESS-WIDE no-op after its first
 * load. That broke `/reload`: `AgentSession#reload`
 * (`dist/core/agent-session.js:2052`) builds a brand-new `ExtensionRunner`
 * and tool registry, then calls `await factory(api)` again with a FRESH
 * `api`, in the SAME process -- `globalThis` is shared across every jiti
 * module instance in that process regardless of which runner build asked, so
 * the flag could not tell "two paths registering in one runner build" (the
 * real WR-07 hazard) apart from "one path registering again after
 * `/reload`" (a normal, expected re-registration). Executed, against the
 * real entry point: load #1 registered `["bash","read","write","edit",
 * "approve_ky_command"]` tools and `["tool_call","session_start"]` hooks;
 * load #2 (modelling `/reload`) registered `[]` and `[]` -- after any
 * `/reload` the session ran with Pi's UNWRAPPED built-in tools and no
 * `tool_call` hook at all, strictly worse than the duplicate audit rows
 * WR-07 set out to fix.
 *
 * The double-load hazard WR-07 named is real (`bin/bootstrap.sh`'s
 * user-scope stub re-exporting this file's default export, PLUS Pi
 * auto-discovering the project-scoped copy when this repository is the
 * trusted project) -- but it cannot be solved from INSIDE this file, because
 * both load paths execute the IDENTICAL `index.ts` as separate jiti module
 * instances (jiti's `moduleCache: false`) with no reference to `ExtensionAPI`
 * usable during factory execution to distinguish "a sibling extension in
 * this runner build already registered" from "a fresh runner build" (the
 * runtime's own `getAllTools()`/`getActiveTools()` throw "not initialized"
 * during extension loading -- `dist/core/extensions/loader.js:151-152`).
 *
 * CR-09 -- an earlier fix tried to solve the double-load hazard one level up
 * anyway, by having the STUB `bin/bootstrap.sh` generates check whether the
 * trusted project's OWN `.pi/extensions/safety/index.ts` exists on disk
 * before importing and calling this file's default export. That was wrong:
 * existence-on-disk is not a valid proxy for "Pi will actually load it" --
 * Pi only auto-discovers a project-scoped `.pi/extensions/` copy when the
 * project is TRUSTED [`dist/core/package-manager.js:1980`], and headless
 * trust resolves `false` with no UI bound
 * [`dist/core/project-trust.js#resolveProjectTrusted`] absent a persisted
 * `~/.pi/agent/trust.json` decision. So in an UNTRUSTED headless run rooted
 * at a repository that itself ships a project-scoped copy -- exactly this
 * repository, on a machine with no trust decision recorded -- the project
 * copy never loaded (filtered out for lack of trust) AND the stub's
 * existence check found the file on disk and returned early, so NEITHER copy
 * ever registered anything. Executed: the stub run with `cwd` set to this
 * repository's own root registered `[]` tools and `[]` events -- a total
 * fail-open, in exactly the scenario SAFE-11 exists to cover.
 *
 * The stub `bin/bootstrap.sh` now generates has NO dedupe of any kind: it
 * unconditionally imports and calls this file's default export, every time.
 * The residual double-load WR-07 named is therefore accepted rather than
 * "solved" -- see `bin/bootstrap.sh`'s own CR-09 docstring section and
 * `docs/SAFETY.md`'s "Load order is part of this" section for the full,
 * published account. This file's own default export is therefore
 * UNCONDITIONALLY idempotent-per-call: it always fully registers, every
 * single time it runs, which is exactly the property `/reload` needs AND
 * exactly what a stub with no dedupe of its own now relies on.
 *
 * CR-11 -- an earlier draft of this section claimed a duplicate `tool_call`
 * hook costs "at worst a duplicate block, never a missed one." Executed and
 * found FALSE: `approvals.ts#markHookDeferred` (WR-12) was keyed on
 * `requestKey` alone, which cannot tell "a second hook of the SAME tool call"
 * (harmless -- both must defer, only one wrapper ever consumes) from "a
 * second RE-ISSUE that never consumed its grant" (the case WR-12 exists to
 * bound). Under a real double load, the SECOND hook of every re-issue found
 * the marker already claimed and blocked -- so `approve_ky_command`'s grant
 * was never consumable and the confirm -> approve -> re-issue protocol
 * (SAFE-10) never completed, for any command, in exactly the double-loaded
 * configuration this trade creates. `markHookDeferred` is now ALSO keyed on
 * `event.toolCallId` (stable across every hook of one tool call, distinct
 * for a genuine re-issue), so every hook belonging to the SAME tool call may
 * defer, and only a DIFFERENT tool call re-using an unconsumed grant is
 * refused -- see `approvals.ts#markHookDeferred`'s own docstring for the
 * full mechanism and citation trail, and
 * `tests/integration/bootstrap-safety-stub.test.ts`'s CR-11 case for the
 * executed, single-process, two-independent-loads proof that block -> approve
 * -> re-issue now succeeds EXACTLY ONCE under a genuine double load.
 */
export default function (pi: ExtensionAPI): void {
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
