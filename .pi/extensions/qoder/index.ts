/**
 * ky-pi-agent — the Qoder delegate tool entry point. (ROUTE-11)
 *
 * PURPOSE. Registers exactly one tool, `qoder_delegate`, on top of the pure
 * config resolver and HTTP client `client.ts` (this directory's sibling)
 * already exports. This file's own job is narrow: build the schema, write
 * the description that tells the model and the user what invoking this tool
 * actually means, read `QODER_PERSONAL_ACCESS_TOKEN`/`QODER_AGENT_ID`/
 * `QODER_ENVIRONMENT_ID` at the ONE call site this repository ever reads
 * them, and turn a refusal or a failure into a message the model can act on.
 *
 * ---------------------------------------------------------------------------
 * THIS EXTENSION REGISTERS A TOOL ON PURPOSE
 * ---------------------------------------------------------------------------
 * CONTRIBUTING.md's boundary rule says a new capability defaults to a
 * command or a skill, and registering a tool must justify its per-request
 * schema cost. This one does, and the justification lives beside the
 * `TOOL_REGISTRATION_ALLOWLIST` entry in
 * `tests/unit/contributing-boundary.test.ts`, added in the same commit as
 * this file, in the (a)/(b)/(c) shape that file's own worked example uses.
 * The short version: the model must be able to delegate MID-TURN, a skill
 * has no mechanism to make an authenticated HTTP round trip and fold a
 * streamed result, and the measured schema cost is 1315 bytes / 329 tokens
 * -- see the allowlist comment for exactly how that was computed.
 *
 * ---------------------------------------------------------------------------
 * THE DESCRIPTION IS A FIRST-CLASS STATEMENT, NOT A COMMENT
 * ---------------------------------------------------------------------------
 * `qoder_delegate`'s own `description` names all four controls it bypasses --
 * Pi's own tools, this project's AGENTS.md and system prompt, the Phase 4
 * safety hooks, and the Phase 2 wire inspector -- and states the auto-deploy
 * consequence plainly, because the model reads the description and the user
 * may never read `docs/`. See `client.ts`'s own module docstring for the
 * fuller foreign-agent statement, and `docs/ROUTING.md` (a later plan) for
 * the full user-facing paragraph this description points to.
 *
 * ---------------------------------------------------------------------------
 * THE REFUSAL PATH IS THE PATH THAT ACTUALLY RUNS HERE
 * ---------------------------------------------------------------------------
 * This machine holds no `QODER_PERSONAL_ACCESS_TOKEN` and has no network
 * egress (05-CONTEXT.md). `execute()` therefore spends most of its life on
 * the `resolveQoderConfig` refusal branch, which is why that branch throws
 * an ACTIONABLE error -- naming the missing variable and the exact one-time
 * setup step -- rather than an opaque failure. Pi's own agent loop turns a
 * thrown `Error` into `isError:true` for the model
 * [VERIFIED: `.pi/extensions/safety/index.ts`'s own citation of
 * `pi-agent-core/dist/agent-loop.js:444-449`, `createErrorToolResult`],
 * exactly the same mechanism `safety/index.ts#registerApprovalTool` already
 * uses in this codebase for its own refusal paths.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (BOOT-10)
 * ---------------------------------------------------------------------------
 * `pi.registerTool` is called exactly once below. This file is the ONLY
 * entry in `TOOL_REGISTRATION_ALLOWLIST` besides `safety/index.ts` --
 * `tests/unit/contributing-boundary.test.ts` fails the build otherwise.
 *
 * ---------------------------------------------------------------------------
 * LAYOUT
 * ---------------------------------------------------------------------------
 *   client.ts (sibling) — config resolution, SSE parsing, the HTTP client.
 *   index.ts (this file) — the registered tool, its schema and description.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { delegateTask, MAX_TASK_CHARS, resolveQoderConfig } from "./client.ts";

/** How much of `task` is ever shown inside the confirmation dialog. See WR-04. */
const CONFIRM_EXCERPT_CHARS = 500;

/**
 * `task` is the only required parameter. Every added field is per-request
 * tokens on every turn this tool stays active -- see the allowlist's (b)
 * answer for the measured cost of this single-field schema.
 */
const qoderDelegateSchema = Type.Object({
	task: Type.String({
		description: "The task to delegate to Qoder's own hosted agent loop, in plain language.",
	}),
});

/**
 * The first-class, user- and model-facing bypass statement. Names all four
 * bypassed controls and the auto-deploy consequence, and points to the full
 * statement in `docs/ROUTING.md`. Kept under the ~400-token budget stated in
 * the plan: measured at 1315 bytes / 329 tokens as the whole serialised
 * `{type:"function",function:{name,description,parameters}}` tool object
 * (`openai-completions.ts:1337-1372`'s own shape), computed with
 * `Math.ceil(bytes / 4)` per `diagnostics/budget.ts:223-224` -- see the
 * `TOOL_REGISTRATION_ALLOWLIST` comment for the exact command run.
 */
const QODER_DELEGATE_DESCRIPTION =
	"Delegates a task to Qoder's own hosted agent loop -- a FOREIGN AGENT, not a Pi tool call. " +
	"It runs inside Qoder's own container with Qoder's own Read/Write/Edit/Glob/Grep/Bash tools, " +
	"entirely outside this harness. Invoking it bypasses Pi's own tools, this project's AGENTS.md " +
	"and system prompt, the Phase 4 safety guard (branch protection, terraform/kubectl confirmation, " +
	".env/*.tfstate read blocks, the audit log) and the Phase 2 wire inspector -- none of them see or " +
	"govern what Qoder does. On a laptop where merging to main auto-deploys to AWS, delegating a task " +
	"means trusting Qoder's own agent loop with whatever repository access its environment is " +
	"configured with, outside every control this harness builds. Requires QODER_PERSONAL_ACCESS_TOKEN, " +
	"QODER_AGENT_ID and QODER_ENVIRONMENT_ID to already be configured (one-time console/API setup); " +
	"refuses actionably if any is unset. Treat its result the way you would a pull request from an " +
	"unfamiliar contributor -- reviewed, never merged on the strength of 'an agent said so'. Full " +
	"statement: docs/ROUTING.md.";

/** The two choices `qoder_delegate`'s own confirmation offers -- mirrors `safety/index.ts#registerApprovalTool`'s `APPROVE_CHOICE`/`DENY_CHOICE` naming exactly. */
const DELEGATE_CHOICE = "Delegate to Qoder";
const CANCEL_CHOICE = "Cancel";

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: "qoder_delegate",
		label: "delegate to Qoder (foreign agent)",
		description: QODER_DELEGATE_DESCRIPTION,
		parameters: qoderDelegateSchema,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			// The ONE place this repository reads these three variables. See
			// client.ts's module docstring: resolveQoderConfig itself never
			// touches the environment.
			const configResult = resolveQoderConfig(process.env);
			if (!configResult.ok) {
				// Actionable, never opaque -- see this file's own docstring
				// section on the refusal path.
				throw new Error(configResult.message);
			}

			// WR-04: ASVS V5 input validation, moved to the TOOL BOUNDARY -- BEFORE
			// the confirmation prompt below. `client.ts#delegateTask` already
			// enforces this same bound, but it used to run AFTER the human
			// decision, so an unbounded, model-controlled `task` was interpolated
			// into `ctx.ui.select`'s title first. Two consequences that made the
			// human decision -- the more security-relevant of the two checks --
			// LESS safe than the network call behind it: (1) a megabyte-long or
			// newline-stuffed task floods the dialog, pushing the bypass warning
			// below out of view, so the user approves a prompt whose warning they
			// never saw; (2) the length bound was documented as protecting
			// "before sending anything", which stopped being true of the human
			// decision the moment WR-11 added it. Refusing here, before `ctx.ui.
			// select` is ever called, closes both.
			const task = params.task.trim();
			if (task.length === 0 || task.length > MAX_TASK_CHARS) {
				throw new Error(
					`Qoder delegate refused: task must be 1..${MAX_TASK_CHARS} characters after trimming ` +
						`(got ${task.length}).`,
				);
			}
			const excerpt =
				task.length > CONFIRM_EXCERPT_CHARS
					? `${task.slice(0, CONFIRM_EXCERPT_CHARS)}… (${task.length} chars total)`
					: task;

			// WR-11: a human in the loop, mirroring `safety/index.ts#
			// registerApprovalTool`'s exact deny-by-default shape. This tool's
			// OWN description already states it bypasses Pi's own tools, this
			// project's AGENTS.md and system prompt, the Phase 4 safety guard
			// and the Phase 2 wire inspector -- on a laptop where merging to
			// main auto-deploys to AWS, a model invoking it unilaterally,
			// mid-turn, on the strength of a description alone is exactly the
			// failure mode this harness exists to prevent. `undefined` (no UI
			// bound -- headless/`-p`) and `hasUI === false` both refuse via the
			// SAME branch below, never via a separately-written headless
			// allow-path. WR-04: the bypass warning comes FIRST and the (now
			// bounded) task excerpt LAST, so a long task can push only its own
			// tail out of view, never the warning the user needs to read first.
			const choice = ctx.hasUI
				? await ctx.ui.select(
						"Delegate this task to Qoder's own hosted agent loop? This bypasses Pi's own tools, " +
							"this project's AGENTS.md and system prompt, the Phase 4 safety guard and the " +
							"Phase 2 wire inspector -- Qoder's own agent runs unsupervised inside its own " +
							`container with its own file/shell tools.\n\nTask:\n  ${excerpt}`,
						[DELEGATE_CHOICE, CANCEL_CHOICE],
					)
				: undefined;
			if (choice !== DELEGATE_CHOICE) {
				throw new Error(
					ctx.hasUI
						? `Qoder delegation declined by the user (did not select "${DELEGATE_CHOICE}").`
						: "Qoder delegation refused: no UI bound -- this tool requires an interactive " +
							"confirmation and none is available in this mode.",
				);
			}

			const result = await delegateTask({
				config: configResult.config,
				task,
				cwd: ctx.cwd,
				signal,
				onThinking: onUpdate
					? (thinkingText) => {
							onUpdate({ content: [{ type: "text", text: thinkingText }], details: undefined });
						}
					: undefined,
			});

			return {
				content: [{ type: "text", text: result.text }],
				details: undefined,
			};
		},
	});

	// CR-01: the configuration gate must run from a point where the extension
	// RUNTIME IS BOUND, never from the factory. `pi.getActiveTools()` and
	// `pi.setActiveTools()` are NOT callable during extension load -- Pi
	// installs throwing stubs for both until `Runner.bindCore()` runs
	// [VERIFIED: pi-coding-agent 0.84.1 `dist/core/extensions/loader.js:134-153`,
	// "Extension runtime not initialized. Action methods cannot be called
	// during extension loading."], and the factory is awaited strictly BEFORE
	// that bind (`loadExtensionFromFactory` awaits the factory at
	// `loader.js:425`; `this._bindExtensionCore(...)` does not run until
	// `agent-session.js:2041`, after `getExtensions()` at `:2031`). A call from
	// the factory throws, and Pi then discards the WHOLE extension -- including
	// the `registerTool` call above that had already succeeded -- exactly the
	// hazard `safety/index.ts` already documents at its own `:768-769`
	// ("the runtime's own `getAllTools()`/`getActiveTools()` throw 'not
	// initialized' during extension loading"). `session_start` is the
	// sanctioned point [CLAUDE.md's own "register everything, activate on
	// demand via `pi.setActiveTools`" pattern; `diagnostics/index.ts:502-506`
	// and `diagnostics/budget.ts:648` both call `getActiveTools()` from inside
	// a handler, never a factory]: the runtime is bound by then, and
	// `registerTool()` above already ran during load, so the tool exists to be
	// filtered. `registerTool` makes a NEWLY-registered tool active in the
	// session by default [VERIFIED: `dist/core/agent-session.js:2008-2014` --
	// every tool name not already in the previous registry is pushed onto
	// `nextActiveToolNames` when the session was not constructed with an
	// explicit `activeToolNames`/`allowedToolNames`/`includeAllExtensionTools`
	// option], so this tool costs its measured ~329 tokens on EVERY provider
	// request by default, including on this machine and in CI where
	// `resolveQoderConfig` can only ever refuse. Deactivating it when
	// unconfigured is applied here as an opt-OUT (deactivate when NOT
	// configured) rather than the more common opt-IN shape, because Pi's own
	// default is "active unless removed". Best-effort, mirroring
	// `safety/index.ts`'s and `routing/index.ts`'s own `session_start` hooks
	// (`safety/index.ts:832-838`, `routing/index.ts:673-679`): a failure here
	// must never stop the session itself from starting -- on an unexpected
	// error the tool stays active and `execute()`'s own `resolveQoderConfig`
	// check still refuses actionably at call time, which is strictly better
	// than a crashed session.
	pi.on("session_start", () => {
		try {
			if (!resolveQoderConfig(process.env).ok) {
				pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "qoder_delegate"));
			}
		} catch {
			// Swallowed deliberately -- see the comment above.
		}
	});
}
