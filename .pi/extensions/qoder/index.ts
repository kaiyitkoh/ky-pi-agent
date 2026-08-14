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

import { delegateTask, resolveQoderConfig } from "./client.ts";

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

			const result = await delegateTask({
				config: configResult.config,
				task: params.task,
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
}
