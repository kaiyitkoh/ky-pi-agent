/**
 * Mode restore after restart, and zero context tokens for the persisted mode entry. `session_start` does not fire
 * headless, so the restart is simulated by calling `restoreModeFromBranch` on a real session's branch; Pi's own
 * dispatch of that hook is not re-verified here. The absence of the `ky:mode` marker on the wire is paired with a
 * positive control sending the same string as user content. `deepseek` is wrapped for payload capture directly.
 */
import type { CustomEntry, ModelChangeEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";

import { describe, expect, it } from "vitest";

import { restoreModeFromBranch } from "../../.pi/extensions/routing/index.ts";
import { getModeState, setEscalated, setMode } from "../../.pi/extensions/routing/modes.ts";
import { DEFAULT_MODE, MODE_ENTRY_TYPE, type KyModeData } from "../../.pi/extensions/routing/schema.ts";
import { buildOpenAiFixturePayload, wrapFauxWithPayload } from "../helpers/faux.ts";
import { repoRoot } from "../helpers/git.ts";
import { createFauxSession, type FauxSessionHandle, waitForConfiguredAuth, type Notification, withCapturedNotify } from "../helpers/session.ts";

/** Absolute path of the routing extension entry point this repository ships. */
const ROUTING_ENTRY = `${repoRoot()}/.pi/extensions/routing/index.ts`;

/** The user-scope extension under test: the real routing entry point, no probe needed. */
const EXTENSION_SOURCE = [
	"// Generated for tests/integration/mode-persistence.test.ts. Lives in a temp dir.",
	`import routing from ${JSON.stringify(ROUTING_ENTRY)};`,
	"",
	"export default function (pi) {",
	"\trouting(pi);",
	"}",
].join("\n");

/** Every `ky:mode` custom entry on `branch`, in path order. */
function findModeEntries(branch: readonly SessionEntry[]): CustomEntry<KyModeData>[] {
	return branch.filter(
		(entry): entry is CustomEntry<KyModeData> => entry.type === "custom" && entry.customType === MODE_ENTRY_TYPE,
	);
}

/** Every native `model_change` entry on `branch`, in path order. */
function findModelChangeEntries(branch: readonly SessionEntry[]): ModelChangeEntry[] {
	return branch.filter((entry): entry is ModelChangeEntry => entry.type === "model_change");
}

/** A fresh session with routing at user scope, deepseek under both ids wrapped for capture, and the mode slot reset. */
async function withPersistenceSession<T>(
	fn: (handle: FauxSessionHandle, captured: unknown[]) => Promise<T>,
): Promise<T> {
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
		const captured: unknown[] = [];
		const deepseekFaux = fauxProvider({
			provider: "deepseek",
			models: [
				{ id: "deepseek-flash", reasoning: true, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } },
				{ id: "deepseek-v4-pro", reasoning: true, cost: { input: 3, output: 6, cacheRead: 0.3, cacheWrite: 4.5 } },
			],
		});
		handle.modelRuntime.registerNativeProvider(
			wrapFauxWithPayload(deepseekFaux, (model, context, options) => {
				const payload = buildOpenAiFixturePayload(model, context, options);
				captured.push(payload);
				return payload;
			}),
		);
		await handle.modelRuntime.setRuntimeApiKey("deepseek", "kypi-fixture-not-a-real-key");
		await waitForConfiguredAuth(handle.modelRuntime, "deepseek");

		return await fn(handle, captured);
	} finally {
		await handle.dispose();
	}
}

describe("ROUTE-09 -- mode persistence: branch restore and the zero-context-tokens proof", () => {
	it("case 1 -- a max switch writes a ky:mode entry AND Pi's own model_change entry, and restoreModeFromBranch restores both mode and escalation from that branch", async () => {
		await withPersistenceSession(async ({ session }) => {
			const command = session.extensionRunner.getCommand("max");
			expect(command, 'getCommand("max") returned undefined').toBeDefined();
			if (command === undefined) {
				return;
			}

			const ctx = session.extensionRunner.createCommandContext();
			const notifications: Notification[] = [];
			withCapturedNotify(ctx, notifications);

			await command.handler("", ctx);
			expect(notifications.at(-1)?.level, `max switch was refused: ${JSON.stringify(notifications)}`).toBe("info");

			const branch = session.sessionManager.getBranch();

			// -- the ky:mode half, this plan's own artifact.
			const modeEntry = findModeEntries(branch).at(-1);
			expect(modeEntry, "no ky:mode entry was written for the max switch").toBeDefined();
			expect(modeEntry?.data?.mode).toBe("max");
			expect(modeEntry?.data?.escalated).toBe(false);

			// Verify Pi's own model_change persistence exists rather than rebuilding it, so a Pi change shows up here.
			const modelChangeEntry = findModelChangeEntries(branch).at(-1);
			expect(
				modelChangeEntry,
				"no native model_change entry was found on the branch after a successful setModel -- " +
					"Pi's own persistence appears to be missing",
			).toBeDefined();
			expect(modelChangeEntry?.provider).toBe("deepseek");
			expect(modelChangeEntry?.modelId).toBe("deepseek-v4-pro");

			// Perturb the module state away from the branch's, so the restore is observable.
			setMode("cheap");
			setEscalated(false);
			expect(getModeState().mode, "perturbation before restore did not take").toBe("cheap");

			restoreModeFromBranch(branch);

			expect(getModeState().mode, "restoreModeFromBranch did not restore the persisted mode").toBe("max");
			expect(
				getModeState().escalated,
				"restoreModeFromBranch reported an escalation the persisted entry never carried",
			).toBe(false);
		});
	});

	it("case 2 -- two ky:mode entries on one branch (balanced, then max) restore to the LAST one, not the first", async () => {
		await withPersistenceSession(async ({ session }) => {
			const balancedCommand = session.extensionRunner.getCommand("balanced");
			const maxCommand = session.extensionRunner.getCommand("max");
			expect(balancedCommand, 'getCommand("balanced") returned undefined').toBeDefined();
			expect(maxCommand, 'getCommand("max") returned undefined').toBeDefined();
			if (balancedCommand === undefined || maxCommand === undefined) {
				return;
			}

			const ctx = session.extensionRunner.createCommandContext();
			const notifications: Notification[] = [];
			withCapturedNotify(ctx, notifications);

			await balancedCommand.handler("", ctx);
			expect(notifications.at(-1)?.level, "the balanced switch (setup) was refused").toBe("info");
			await maxCommand.handler("", ctx);
			expect(notifications.at(-1)?.level, "the max switch was refused").toBe("info");

			const branch = session.sessionManager.getBranch();
			const modeEntries = findModeEntries(branch);
			expect(
				modeEntries.length,
				"expected two ky:mode entries on the branch (balanced, then max) -- got a different count",
			).toBeGreaterThanOrEqual(2);
			// Non-vacuity: the two switches must actually have produced DIFFERENT
			// mode values, or "restores to the last one" is untestable here.
			expect(modeEntries[0]?.data?.mode).toBe("balanced");
			expect(modeEntries.at(-1)?.data?.mode).toBe("max");

			setMode("cheap");
			setEscalated(false);

			restoreModeFromBranch(branch);

			expect(
				getModeState().mode,
				"restoreModeFromBranch restored an earlier entry instead of the LAST write on the branch",
			).toBe("max");
		});
	});

	it("case 3 -- a branch whose latest ky:mode payload carries an out-of-range mode restores DEFAULT_MODE and never throws", () => {
		const fabricatedBranch: SessionEntry[] = [
			{
				type: "custom",
				id: "fabricated-1",
				parentId: null,
				timestamp: new Date().toISOString(),
				customType: MODE_ENTRY_TYPE,
				data: { mode: "not-a-real-mode", escalated: false, at: Date.now() } as unknown as KyModeData,
			} as unknown as SessionEntry,
		];

		// Perturb first, so a fallback to DEFAULT_MODE is observable.
		setMode("balanced");
		setEscalated(false);
		expect(getModeState().mode, "perturbation before restore did not take").toBe("balanced");

		expect(
			() => restoreModeFromBranch(fabricatedBranch),
			"restoreModeFromBranch threw on a malformed mode value -- a corrupt or hand-edited branch " +
				"must never be able to stop a session from starting (T-05-39)",
		).not.toThrow();

		expect(
			getModeState().mode,
			"an out-of-range mode value was propagated instead of falling back to DEFAULT_MODE (T-05-36)",
		).toBe(DEFAULT_MODE);
	});

	it("case 3b -- WR-04: a branch whose latest ky:mode payload carries data: null never throws, and leaves whatever state was already in force untouched", () => {
		// `data: null` must leave state untouched (`null === undefined` is false, so a naive check dereferences it).
		// Staying "balanced" is the non-vacuous proof: a fall-back to DEFAULT_MODE would also pass an implementation that
		// reset on any malformed payload.
		const fabricatedBranch: SessionEntry[] = [
			{
				type: "custom",
				id: "fabricated-null-data",
				parentId: null,
				timestamp: new Date().toISOString(),
				customType: MODE_ENTRY_TYPE,
				data: null,
			} as unknown as SessionEntry,
		];

		setMode("balanced");
		setEscalated(false);
		expect(getModeState().mode, "perturbation before restore did not take").toBe("balanced");

		expect(
			() => restoreModeFromBranch(fabricatedBranch),
			"restoreModeFromBranch threw on a data: null payload -- a corrupt or hand-edited branch must " +
				"never be able to stop a session from starting (T-05-39)",
		).not.toThrow();

		expect(
			getModeState().mode,
			'a null payload was not treated as "nothing to restore" -- the perturbed state was changed ' +
				"instead of being left alone",
		).toBe("balanced");
	});

	it("case 4 -- zero context tokens: the ky:mode marker never reaches a provider payload, proven with a positive control", async () => {
		await withPersistenceSession(async ({ session, modelRuntime }, captured) => {
			void modelRuntime;
			const command = session.extensionRunner.getCommand("balanced");
			expect(command, 'getCommand("balanced") returned undefined').toBeDefined();
			if (command === undefined) {
				return;
			}

			const ctx = session.extensionRunner.createCommandContext();
			const notifications: Notification[] = [];
			withCapturedNotify(ctx, notifications);

			await command.handler("", ctx);
			expect(notifications.at(-1)?.level, "the balanced switch was refused").toBe("info");

			// The entry must exist on the branch before its absence from the wire means anything.
			const branch = session.sessionManager.getBranch();
			expect(
				findModeEntries(branch).length,
				"no ky:mode entry exists on the branch -- the absence assertion below would be vacuous",
			).toBeGreaterThan(0);

			// -- a full turn against the now-switched (deepseek) executor.
			await session.prompt("a turn after the mode switch");

			expect(
				captured.length,
				"no outgoing payload was captured at all -- the absence assertion below would be vacuous",
			).toBeGreaterThan(0);

			const serializedBeforeControl = captured.map((payload) => JSON.stringify(payload));
			expect(
				serializedBeforeControl.some((text) => text.includes(MODE_ENTRY_TYPE)),
				`the ky:mode marker (${MODE_ENTRY_TYPE}) appeared in a captured outgoing payload -- the ` +
					"mode-persistence entry is not supposed to participate in LLM context at all",
			).toBe(false);

			// Positive control: the same marker as user content must be found by the same instrument.
			await session.prompt(`marker present in this message: ${MODE_ENTRY_TYPE}`);

			expect(
				captured.length,
				"the control turn produced no captured payload at all -- the instrument itself is dead",
			).toBeGreaterThan(1);

			const serializedAfterControl = captured.map((payload) => JSON.stringify(payload));
			expect(
				serializedAfterControl.some((text) => text.includes(MODE_ENTRY_TYPE)),
				"the positive control failed: a marker sent explicitly in a user message did not appear " +
					"in any captured payload, which means the absence assertion above proves nothing about " +
					"ky:mode specifically -- it would have passed even if the marker HAD been on the wire",
			).toBe(true);
		});
	});
});
