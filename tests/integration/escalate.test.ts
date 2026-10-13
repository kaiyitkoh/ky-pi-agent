/**
 * `/escalate` and `/escalate off` in a real session: sticky across turns, visible through `/mode`, executor-scoped,
 * never claimed on a refused switch. Stickiness is asserted after a real further turn, or a one-shot implementation
 * would pass. Mode state lives on a globalThis slot, so each case resets it. `deepseek` carries both the flash and pro
 * ids, so one auth grant makes escalation a genuine model change.
 */
import { join } from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { CustomEntry } from "@earendil-works/pi-coding-agent";

import { describe, expect, it } from "vitest";

import { logDir } from "../../.pi/lib/jsonl.ts";
import { getModeState, setEscalated, setMode } from "../../.pi/extensions/routing/modes.ts";
import { MODE_ENTRY_TYPE, type KyModeData } from "../../.pi/extensions/routing/schema.ts";
import { repoRoot } from "../helpers/git.ts";
import { logFilesIn, readTornSafe } from "../helpers/logs.ts";
import { createFauxSession, type FauxSessionHandle, waitForConfiguredAuth, type Notification, withCapturedNotify } from "../helpers/session.ts";

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

/** A fresh session with routing at user scope, deepseek under both ids, and the mode slot reset before creation. */
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
				{ id: "deepseek-flash", reasoning: true, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } },
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
			// Escalation changes only the executor and the flag, never the mode.
			expect(getModeState().mode).toBe("cheap");

			const branch = session.sessionManager.getBranch();
			const modeEntry = findLatestModeEntry(branch);
			expect(modeEntry, "no ky:mode entry was written for the escalation").toBeDefined();
			expect(modeEntry?.data?.escalated).toBe(true);
			expect(modeEntry?.data?.escalatedFrom).toBe("cheap");

			// ---- stickiness: a further turn, not a re-read right after the command
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
			expect(ctx.model?.id, "escalate off did not restore the flash tier").toBe("deepseek-flash");

			expect(notifications.length).toBeGreaterThan(0);
			expect(notifications.at(-1)?.level).toBe("info");
			expect(notifications.at(-1)?.text).toContain("deepseek/deepseek-flash");

			expect(getModeState().escalated, "the module state still reports an active escalation after off").toBe(false);
			expect(getModeState().escalatedFrom, "escalatedFrom was not cleared by escalate off").toBeUndefined();
			expect(getModeState().mode, "the mode itself changed, which off must never do").toBe("cheap");

			// ---- a further turn still shows the restored model
			await session.prompt("a further turn after clearing escalation");

			expect(ctx.model?.provider).toBe("deepseek");
			expect(ctx.model?.id, "the restored model did not survive a further turn").toBe("deepseek-flash");
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

			// Paired positive: these two lines are expected to differ, so the comparison above is not vacuous.
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
			// Only flash is registered, so the escalation target resolves nothing and the refusal is at candidate selection.
			const deepseekFaux = fauxProvider({
				provider: "deepseek",
				models: [{ id: "deepseek-flash", reasoning: true, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } }],
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

	it("case 7 -- WR-05: a mode switch that clears a live escalation writes a durable escalation-*.jsonl record naming escalated:false", async () => {
		await withEscalateSession(async ({ session, cwd }) => {
			const escalateCommand = session.extensionRunner.getCommand("escalate");
			const cheapCommand = session.extensionRunner.getCommand("cheap");
			expect(escalateCommand, 'getCommand("escalate") returned undefined').toBeDefined();
			expect(cheapCommand, 'getCommand("cheap") returned undefined').toBeDefined();
			if (escalateCommand === undefined || cheapCommand === undefined) {
				return;
			}

			const ctx = session.extensionRunner.createCommandContext();
			const notifications: Notification[] = [];
			withCapturedNotify(ctx, notifications);

			// -- escalate on, then run a (nominally expensive) turn.
			await escalateCommand.handler("", ctx);
			expect(getModeState().escalated, "setup for this case did not actually escalate first").toBe(true);

			// A mode switch clears escalation. Switching to the same mode isolates the escalation change, so an implementation
			// that records only on a mode-name change fails.
			await cheapCommand.handler("", ctx);
			expect(notifications.at(-1)?.level, "the /cheap switch was refused").toBe("info");
			expect(getModeState().escalated, "the mode switch did not actually clear escalation").toBe(false);

			const dir = logDir(cwd);
			const files = logFilesIn(dir);
			const escalationFile = files.find((name) => name.startsWith("escalation-"));
			expect(
				escalationFile,
				`no escalation-*.jsonl transcript found under ${dir} (saw: ${files.join(", ") || "<none>"})`,
			).toBeDefined();

			const { records, unparseable } = readTornSafe(join(dir, escalationFile as string));
			expect(unparseable).toHaveLength(0);
			expect(
				records.length,
				"the escalation log exists but is empty -- the on-escalation record from step 1 (or the " +
					"off-record this case exists to prove) never reached disk",
			).toBeGreaterThan(0);

			// Paired positive: the ON record must exist, or ending on escalated:false is trivially true.
			const onRecords = records.filter(
				(record): record is { escalated: boolean } =>
					typeof record === "object" && record !== null && (record as { escalated?: unknown }).escalated === true,
			);
			expect(
				onRecords.length,
				"no escalated:true record exists in the log -- the ON half of this pairing never happened, " +
					"so the OFF assertion below would prove nothing about a real on-then-off sequence",
			).toBeGreaterThan(0);

			// The last record, written by the /cheap switch, must say escalated:false, or the log misreports the sequence as
			// still escalated.
			const last = records.at(-1) as { escalated?: unknown; mode?: unknown; previousModel?: unknown; newModel?: unknown } | undefined;
			expect(
				last?.escalated,
				"the LAST escalation record does not carry escalated:false -- the mode switch that cleared " +
					"a live escalation wrote no durable record of having done so",
			).toBe(false);
			expect(last?.mode, "the off-record does not name the mode the switch landed on").toBe("cheap");
			expect(last?.newModel, "the off-record does not name the model now serving the executor").toBe(
				"deepseek/deepseek-flash",
			);
			expect(
				last?.previousModel,
				"the off-record does not name the model that was serving the executor before the switch",
			).toBe("deepseek/deepseek-v4-pro");
		});
	});
});
