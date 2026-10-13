/**
 * Registers the single `qoder_delegate` tool over client.ts; the justification for a registered tool sits beside its
 * allowlist entry in tests/unit/contributing-boundary.test.ts. Config is read only here, and a refusal throws an
 * actionable Error, which Pi turns into isError for the model (pi-agent-core dist/agent-loop.js).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { delegateTask, MAX_TASK_CHARS, resolveQoderConfig, writeQoderTranscript } from "./client.ts";

/** Bound on the task excerpt shown in the confirmation dialog. */
const CONFIRM_EXCERPT_CHARS = 500;

/** `task` is the only parameter: every added field costs request tokens each turn (see the allowlist entry). */
const qoderDelegateSchema = Type.Object({
	task: Type.String({
		description: "The task to delegate to Qoder's own hosted agent loop, in plain language.",
	}),
});

/** User- and model-facing bypass statement; its per-request size is recorded in the allowlist entry. Full text: docs/ROUTING.md. */
const QODER_DELEGATE_DESCRIPTION =
	"Delegates a task to Qoder's own hosted agent loop -- a FOREIGN AGENT, not a Pi tool call. " +
	"It runs inside Qoder's own container with Qoder's own Read/Write/Edit/Glob/Grep/Bash tools, " +
	"entirely outside this harness. Invoking it bypasses Pi's own tools, this project's AGENTS.md " +
	"and system prompt, this project's safety guard (branch protection, terraform/kubectl confirmation, " +
	".env/*.tfstate read blocks, the audit log) and the wire inspector -- none of them see or " +
	"govern what Qoder does. On a laptop where merging to main auto-deploys to AWS, delegating a task " +
	"means trusting Qoder's own agent loop with whatever repository access its environment is " +
	"configured with, outside every control this harness builds. Requires QODER_PERSONAL_ACCESS_TOKEN, " +
	"QODER_AGENT_ID and QODER_ENVIRONMENT_ID to already be configured (one-time console/API setup); " +
	"refuses actionably if any is unset. Treat its result the way you would a pull request from an " +
	"unfamiliar contributor -- reviewed, never merged on the strength of 'an agent said so'. Full " +
	"statement: docs/ROUTING.md.";

/** The confirmation choices; names mirror safety/index.ts APPROVE_CHOICE/DENY_CHOICE. */
const DELEGATE_CHOICE = "Delegate to Qoder";
const CANCEL_CHOICE = "Cancel";

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: "qoder_delegate",
		label: "delegate to Qoder (foreign agent)",
		description: QODER_DELEGATE_DESCRIPTION,
		parameters: qoderDelegateSchema,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			// The one place these variables are read.
			const configResult = resolveQoderConfig(process.env);
			if (!configResult.ok) {
				// Defence in depth (docs/ROUTING.md "two gates, not one"): the only trace if the session_start deactivation failed.
				writeQoderTranscript(ctx.cwd, { event: "qoder.delegate.refused", cause: "unconfigured" });
				// Actionable, never opaque.
				throw new Error(configResult.message);
			}

			// Validate at the tool boundary, before the confirmation prompt: an unbounded task would flood the
			// dialog and push the bypass warning out of view.
			const task = params.task.trim();
			if (task.length === 0 || task.length > MAX_TASK_CHARS) {
				// Adversarial or looping models land here; leave a trace, never the task text.
				writeQoderTranscript(ctx.cwd, {
					event: "qoder.delegate.refused",
					cause: "task-length",
					taskChars: task.length,
				});
				throw new Error(
					`Qoder delegate refused: task must be 1..${MAX_TASK_CHARS} characters after trimming ` +
						`(got ${task.length}).`,
				);
			}
			// Flatten control characters, then bound length: the selector renders the title uncapped above the options and
			// pre-highlights the first one (extension-selector.js), so task content must not change the dialog's shape.
			const flattened = Array.from(task)
				.map((ch) => {
					const cp = ch.codePointAt(0) ?? 0;
					return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) ? " " : ch;
				})
				.join("")
				.replace(/ {2,}/g, " ")
				.trim();
			const excerpt =
				flattened.length > CONFIRM_EXCERPT_CHARS
					? `${flattened.slice(0, CONFIRM_EXCERPT_CHARS)}… (${task.length} chars total)`
					: flattened;

			// Human in the loop, deny-by-default as in safety/index.ts; headless (no UI) refuses via the same branch.
			// Warning first, bounded one-line excerpt last, so task content cannot hide the warning or the choices.
			const choice = ctx.hasUI
				? await ctx.ui.select(
						"Delegate this task to Qoder's own hosted agent loop? This bypasses Pi's own tools, " +
							"this project's AGENTS.md and system prompt, the safety guard and the " +
							"wire inspector -- Qoder's own agent runs unsupervised inside its own " +
							`container with its own file/shell tools.\n\nTask:\n  ${excerpt}`,
						[DELEGATE_CHOICE, CANCEL_CHOICE],
					)
				: undefined;
			const approved = choice === DELEGATE_CHOICE;

			// Written on both branches through the redacted writer, before returning or throwing; length only, never the task text.
			writeQoderTranscript(ctx.cwd, {
				event: "qoder.delegate.confirm",
				hasUI: ctx.hasUI,
				approved,
				taskChars: task.length,
			});

			if (!approved) {
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

	// Gate from session_start, never the factory: get/setActiveTools throw until the runtime binds (extensions/loader.js;
	// the factory is awaited in loader.js, bound later by agent-session.js) and a throw discards the whole extension.
	// A new tool is active by default (agent-session.js) and costs ~329 tokens per request, so
	// deactivate it when unconfigured. Best-effort: on error it stays active and execute() still refuses.
	pi.on("session_start", () => {
		try {
			if (!resolveQoderConfig(process.env).ok) {
				pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "qoder_delegate"));
			}
		} catch {
				// Swallowed deliberately; execute() still refuses.
		}
	});
}
