/**
 * ROUTE-03 — `/escalate` and `/escalate off` in a real Pi session: the
 * elevated state is sticky across turns, visible through `/mode`,
 * executor-scoped only, and never claimed on a refused switch.
 *
 * ---------------------------------------------------------------------------
 * WHY STICKINESS IS ASSERTED AFTER A REAL TURN, NOT ONLY AFTER THE COMMAND
 * ---------------------------------------------------------------------------
 * ARCHITECTURE:55 rejected auto-restore deliberately (05-CONTEXT.md's
 * `<specifics>` bullet on the same decision): an escalation that reverted on
 * its own would make "why was this turn expensive?" unanswerable after the
 * fact. An assertion taken only immediately after `escalate`'s command
 * handler returns would pass against a one-shot implementation that quietly
 * un-escalates on the very next turn -- exactly the design the plan rejects.
 * Every stickiness assertion below therefore runs `session.prompt(...)`
 * AFTER the switch and re-reads `ctx.model` afterwards, mirroring
 * `tests/integration/single-shot-roles.test.ts`'s own live-context proof
 * (`ctx.model` is a live getter reflecting the session's real state, not a
 * snapshot -- see that file's header, itself citing `mode-switch.test.ts`).
 *
 * ---------------------------------------------------------------------------
 * WHY THE MODULE-LEVEL MODE/ESCALATION STATE IS RESET BEFORE EVERY CASE
 * ---------------------------------------------------------------------------
 * `routing/modes.ts` keeps mode/escalation state on a `globalThis` slot,
 * shared across every jiti module instance in this process (that file's own
 * STATE-SLOT HAZARD section). `setMode`/`setEscalated`/`getModeState` are
 * imported directly here -- never through a loaded extension -- exactly the
 * pattern `tests/integration/single-shot-roles.test.ts#runFixture` already
 * established, so each `it` below starts from a deterministic `cheap`,
 * non-escalated state regardless of what an earlier case in this file (or a
 * sibling file in the same worker) left behind.
 *
 * ---------------------------------------------------------------------------
 * WHY `deepseek` CARRIES BOTH `deepseek-v4-flash` AND `deepseek-v4-pro`
 * ---------------------------------------------------------------------------
 * `ROLE_MAP.cheap.executor` resolves to the flash tier (`FLASH_CANDIDATES`);
 * `ROLE_MAP.max.executor` (the `ESCALATION_MODE`) resolves to the pro tier
 * (`PRO_CANDIDATES`). Both tiers' first candidate is `provider:"deepseek"`,
 * so a single `setRuntimeApiKey("deepseek", ...)` grant (measured, polled --
 * see `mode-switch.test.ts`'s own header for the cached-snapshot gap this
 * closes) configures auth for both models at once, and a real escalate
 * therefore changes the executor from `deepseek/deepseek-v4-flash` to
 * `deepseek/deepseek-v4-pro` -- a genuine model change, not a same-model
 * no-op.
 */
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { CustomEntry, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { describe, expect, it } from "vitest";

import { getModeState, setEscalated, setMode } from "../../.pi/extensions/routing/modes.ts";
import { MODE_ENTRY_TYPE, type KyModeData } from "../../.pi/extensions/routing/schema.ts";
import { repoRoot } from "../helpers/git.ts";
import { createFauxSession, type FauxSessionHandle } from "../helpers/session.ts";

/** Absolute path of the routing extension entry point this repository ships. */
const ROUTING_ENTRY = `${repoRoot()}/.pi/extensions/routing/index.ts`;

/** The user-scope extension under test: the real routing entry point, no probe needed. */
const EXTENSION_SOURCE = [
	"// Generated for tests/integration/escalate.test.ts. Lives in a temp dir.",
	`import routing from ${JSON.stringify(ROUTING_ENTRY)};`,
	"",
	"export default function (pi) {",
	"\trouting(pi);",
	"}",
].join("\n");

/**
 * Poll `modelRuntime.hasConfiguredAuth(providerId)` until it reports `true`.
 * Copied from `tests/integration/mode-switch.test.ts` -- see that file's
 * header for the measured cached-snapshot gap this closes.
 */
async function waitForConfiguredAuth(
	modelRuntime: FauxSessionHandle["modelRuntime"],
	providerId: string,
	timeoutMs = 2000,
): Promise<void> {
	const start = Date.now();
	while (!modelRuntime.hasConfiguredAuth(providerId)) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(
				`waitForConfiguredAuth: ${providerId} never reported configured auth within ${timeoutMs}ms ` +
					"after setRuntimeApiKey resolved. See mode-switch.test.ts's header for the measured async gap.",
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

/** A notification `ctx.ui.notify` recorded. */
interface Notification {
	text: string;
	level?: string;
}

/**
 * Replace `ctx.ui` with a recording stand-in, via `defineProperty` -- copied
 * from `tests/integration/mode-switch.test.ts`, which explains why
 * `defineProperty` (not plain assignment) is required for this particular
 * property.
 */
function withCapturedNotify(ctx: ExtensionCommandContext, notifications: Notification[]): void {
	Object.defineProperty(ctx, "ui", {
		value: {
			notify: (text: string, level?: string) => {
				notifications.push({ text, level });
			},
		},
		writable: true,
		configurable: true,
		enumerable: true,
	});
}

/** A `ky:mode` entry as read back off `ctx.sessionManager.getBranch()`. */
function findLatestModeEntry(branch: readonly unknown[]): CustomEntry<KyModeData> | undefined {
	const entries = branch.filter(
		(entry): entry is CustomEntry<KyModeData> =>
			typeof entry === "object" &&
			entry !== null &&
			(entry as { type?: unknown }).type === "custom" &&
			(entry as { customType?: unknown }).customType === MODE_ENTRY_TYPE,
	);
	return entries.at(-1);
}

/**
 * Build a fresh faux session with the real routing extension loaded at user
 * scope, `deepseek` registered under BOTH the flash and pro ids, and the
 * module-level mode/escalation slot reset to `cheap`/not-escalated before
 * the session is even created. Three responses queued -- generous headroom
 * for every case below, at most two of which ever call `session.prompt`.
 */
async function withEscalateSession<T>(fn: (handle: FauxSessionHandle) => Promise<T>): Promise<T> {
	setMode("cheap");
	setEscalated(false);
	expect(getModeState().mode, "test setup did not reset the mode slot to cheap").toBe("cheap");
	expect(getModeState().escalated, "test setup did not clear escalation").toBe(false);

	const handle = await createFauxSession({
		extensionSource: EXTENSION_SOURCE,
		responses: [
			fauxAssistantMessage("turn-1", { stopReason: "stop" }),
			fauxAssistantMessage("turn-2", { stopReason: "stop" }),
			fauxAssistantMessage("turn-3", { stopReason: "stop" }),
		],
	});
	try {
		const deepseekFaux = fauxProvider({
			provider: "deepseek",
			models: [
				{ id: "deepseek-v4-flash", reasoning: true, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } },
				{ id: "deepseek-v4-pro", reasoning: true, cost: { input: 3, output: 6, cacheRead: 0.3, cacheWrite: 4.5 } },
			],
		});
		handle.modelRuntime.registerNativeProvider(deepseekFaux.provider);
		await handle.modelRuntime.setRuntimeApiKey("deepseek", "kypi-fixture-not-a-real-key");
		await waitForConfiguredAuth(handle.modelRuntime, "deepseek");

		return await fn(handle);
	} finally {
		await handle.dispose();
	}
}

describe("ROUTE-03 -- /escalate and /escalate off in a real Pi session", () => {
	it("case 1 -- escalate lifts the executor from cheap's flash model to max's pro model, sticky across a further turn", async () => {
		await withEscalateSession(async ({ session }) => {
			const command = session.extensionRunner.getCommand("escalate");
			expect(command, 'getCommand("escalate") returned undefined').toBeDefined();
			if (command === undefined) {
				return;
			}

			const ctx = session.extensionRunner.createCommandContext();
			const notifications: Notification[] = [];
			withCapturedNotify(ctx, notifications);

			const before = ctx.model;
			expect(before?.provider, "the session did not start on a model distinct from the escalation target").not.toBe(
				"deepseek",
			);

			await command.handler("", ctx);

			const afterCommand = ctx.model;
			expect(afterCommand?.provider, "escalate did not switch the executor's provider").toBe("deepseek");
			expect(afterCommand?.id, "escalate did not switch the executor to the pro tier").toBe("deepseek-v4-pro");

			expect(notifications.length, "a successful escalation must still report an outcome").toBeGreaterThan(0);
			expect(notifications.at(-1)?.level).toBe("info");
			expect(notifications.at(-1)?.text).toContain("deepseek/deepseek-v4-pro");

			expect(getModeState().escalated, "the module state does not report the escalation as active").toBe(true);
			expect(getModeState().escalatedFrom, "escalatedFrom does not name the mode escalation was invoked from").toBe(
				"cheap",
			);
			// The MODE itself is untouched by escalation -- only the executor and
			// the escalation flag change (05-CONTEXT.md decision 1's "not a second
			// whole-mode switch").
			expect(getModeState().mode).toBe("cheap");

			const branch = session.sessionManager.getBranch();
			const modeEntry = findLatestModeEntry(branch);
			expect(modeEntry, "no ky:mode entry was written for the escalation").toBeDefined();
			expect(modeEntry?.data?.escalated).toBe(true);
			expect(modeEntry?.data?.escalatedFrom).toBe("cheap");

			// ---- stickiness: a FURTHER turn, not merely a re-read immediately
			// after the command -- see this file's own header for why an
			// immediately-after assertion would pass against a design
			// ARCHITECTURE:55 already rejected.
			await session.prompt("a further turn after escalation");

			const afterTurn = ctx.model;
			expect(
				afterTurn?.provider,
				"the escalated executor reverted on its own after a further turn -- stickiness is broken",
			).toBe("deepseek");
			expect(afterTurn?.id).toBe("deepseek-v4-pro");
			expect(getModeState().escalated, "the escalation flag reverted after a further turn").toBe(true);
		});
	});

	it("case 2 -- the mode command names the escalated state and the concrete provider/id serving the executor", async () => {
		await withEscalateSession(async ({ session }) => {
			const escalateCommand = session.extensionRunner.getCommand("escalate");
			const modeCommand = session.extensionRunner.getCommand("mode");
			expect(escalateCommand, 'getCommand("escalate") returned undefined').toBeDefined();
			expect(modeCommand, 'getCommand("mode") returned undefined').toBeDefined();
			if (escalateCommand === undefined || modeCommand === undefined) {
				return;
			}

			const ctx = session.extensionRunner.createCommandContext();
			const notifications: Notification[] = [];
			withCapturedNotify(ctx, notifications);

			await escalateCommand.handler("", ctx);
			notifications.length = 0;

			await modeCommand.handler("", ctx);

			expect(notifications.length, "the mode command must report an outcome").toBeGreaterThan(0);
			const text = notifications.at(-1)?.text ?? "";
			expect(text, "the mode command output does not mention escalation").toContain("escalated");
			expect(text, "the mode command output does not name the current mode (cheap)").toContain("cheap");
			expect(
				text,
				"the mode command output does not name the concrete provider/id serving the executor",
			).toContain("deepseek/deepseek-v4-pro");
		});
	});

	it("case 3 -- escalate off restores the current mode's own executor model, and a further turn still uses the restored model", async () => {
		await withEscalateSession(async ({ session }) => {
			const command = session.extensionRunner.getCommand("escalate");
			expect(command, 'getCommand("escalate") returned undefined').toBeDefined();
			if (command === undefined) {
				return;
			}

			const ctx = session.extensionRunner.createCommandContext();
			const notifications: Notification[] = [];
			withCapturedNotify(ctx, notifications);

			await command.handler("", ctx);
			expect(ctx.model?.id, "setup for the off-case did not actually escalate first").toBe("deepseek-v4-pro");

			await command.handler("off", ctx);

			expect(ctx.model?.provider, "escalate off did not restore the executor's provider").toBe("deepseek");
			expect(ctx.model?.id, "escalate off did not restore the flash tier").toBe("deepseek-v4-flash");

			expect(notifications.length).toBeGreaterThan(0);
			expect(notifications.at(-1)?.level).toBe("info");
			expect(notifications.at(-1)?.text).toContain("deepseek/deepseek-v4-flash");

			expect(getModeState().escalated, "the module state still reports an active escalation after off").toBe(false);
			expect(getModeState().escalatedFrom, "escalatedFrom was not cleared by escalate off").toBeUndefined();
			expect(getModeState().mode, "the mode itself changed, which off must never do").toBe("cheap");

			// ---- a further turn still reflects the restored (non-escalated)
			// model -- the mirror of case 1's stickiness proof, in the other
			// direction.
			await session.prompt("a further turn after clearing escalation");

			expect(ctx.model?.provider).toBe("deepseek");
			expect(ctx.model?.id, "the restored model did not survive a further turn").toBe("deepseek-v4-flash");
			expect(getModeState().escalated).toBe(false);
		});
	});

	it("case 4 -- escalation lifts the executor only: the other five roles' resolved routes are unchanged before and after", async () => {
		await withEscalateSession(async ({ session }) => {
			const escalateCommand = session.extensionRunner.getCommand("escalate");
			const modeCommand = session.extensionRunner.getCommand("mode");
			if (escalateCommand === undefined || modeCommand === undefined) {
				throw new Error("escalate or mode command did not register");
			}

			const ctx = session.extensionRunner.createCommandContext();
			const beforeNotifications: Notification[] = [];
			withCapturedNotify(ctx, beforeNotifications);
			await modeCommand.handler("", ctx);
			const before = (beforeNotifications.at(-1)?.text ?? "").split("\n");

			await escalateCommand.handler("", ctx);

			const afterNotifications: Notification[] = [];
			withCapturedNotify(ctx, afterNotifications);
			await modeCommand.handler("", ctx);
			const after = (afterNotifications.at(-1)?.text ?? "").split("\n");

			expect(before.length, "the mode command's output shape changed between calls").toBe(after.length);

			const nonExecutorRoles = ["planner", "reviewer", "advisor", "vision", "summariser"];
			for (const role of nonExecutorRoles) {
				const beforeLine = before.find((line) => line.startsWith(`${role}:`));
				const afterLine = after.find((line) => line.startsWith(`${role}:`));
				expect(beforeLine, `no "${role}:" line in the pre-escalation mode output`).toBeDefined();
				expect(
					afterLine,
					`role "${role}"'s reported route changed between non-escalated and escalated state -- ` +
						`escalation must lift the executor only. before=${JSON.stringify(beforeLine)} ` +
						`after=${JSON.stringify(afterLine)}`,
				).toBe(beforeLine);
			}

			// The executor line and the mode/escalation line are EXPECTED to
			// differ -- this is the paired positive that proves the comparison
			// above is not vacuously comparing two identical blobs.
			const beforeExecutorLine = before.find((line) => line.startsWith("executor:"));
			const afterExecutorLine = after.find((line) => line.startsWith("executor:"));
			expect(
				beforeExecutorLine === afterExecutorLine,
				"the executor line did not change at all -- this run never actually escalated, so the " +
					"non-executor comparison above proves nothing",
			).toBe(false);
		});
	});

	it("case 5 -- an escalate whose target has no configured auth is refused, the model is unchanged, and escalated stays false", async () => {
		setMode("cheap");
		setEscalated(false);

		const handle = await createFauxSession({
			extensionSource: EXTENSION_SOURCE,
			responses: [fauxAssistantMessage("unused", { stopReason: "stop" })],
		});
		try {
			// Deliberately register ONLY the flash model under "deepseek" -- the
			// escalation target (max's executor, the PRO tier) has no candidate
			// that resolves at all, so pi.setModel is never reached and the
			// refusal happens at candidate selection, exactly like
			// mode-switch.test.ts's case 3.
			const deepseekFaux = fauxProvider({
				provider: "deepseek",
				models: [{ id: "deepseek-v4-flash", reasoning: true, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } }],
			});
			handle.modelRuntime.registerNativeProvider(deepseekFaux.provider);

			const command = handle.session.extensionRunner.getCommand("escalate");
			expect(command, 'getCommand("escalate") returned undefined').toBeDefined();
			if (command === undefined) {
				return;
			}

			const ctx = handle.session.extensionRunner.createCommandContext();
			const notifications: Notification[] = [];
			withCapturedNotify(ctx, notifications);

			const before = ctx.model;
			await command.handler("", ctx);
			const after = ctx.model;

			expect(after?.provider, "the model changed despite no configured candidate for the escalation target").toBe(
				before?.provider,
			);
			expect(after?.id).toBe(before?.id);

			expect(notifications.length, "a refusal must still report an outcome").toBeGreaterThan(0);
			expect(notifications.at(-1)?.level, "a refusal is an error, not an info message").toBe("error");

			expect(
				getModeState().escalated,
				"the state claims an escalation that never took effect -- T-05-33",
			).toBe(false);

			const branch = handle.session.sessionManager.getBranch();
			expect(
				findLatestModeEntry(branch),
				"a ky:mode entry was written even though the escalation was refused",
			).toBeUndefined();
		} finally {
			await handle.dispose();
		}
	});

	it("case 6 -- an invalid escalate argument is refused, naming the accepted forms, and changes nothing", async () => {
		await withEscalateSession(async ({ session }) => {
			const command = session.extensionRunner.getCommand("escalate");
			expect(command, 'getCommand("escalate") returned undefined').toBeDefined();
			if (command === undefined) {
				return;
			}

			const ctx = session.extensionRunner.createCommandContext();
			const notifications: Notification[] = [];
			withCapturedNotify(ctx, notifications);

			const before = ctx.model;
			await command.handler("sideways", ctx);
			const after = ctx.model;

			expect(after?.provider, "an invalid argument changed the session's model").toBe(before?.provider);
			expect(after?.id).toBe(before?.id);

			expect(notifications.length, "an invalid argument must still report an outcome").toBeGreaterThan(0);
			expect(notifications.at(-1)?.level).toBe("error");
			const text = notifications.at(-1)?.text ?? "";
			expect(text, 'the refusal does not name "on" as an accepted form').toContain("on");
			expect(text, 'the refusal does not name "off" as an accepted form').toContain("off");

			expect(getModeState().escalated, "an invalid argument must never set the escalation flag").toBe(false);

			const branch = session.sessionManager.getBranch();
			expect(
				findLatestModeEntry(branch),
				"a ky:mode entry was written despite the invalid argument being refused",
			).toBeUndefined();
		});
	});
});
