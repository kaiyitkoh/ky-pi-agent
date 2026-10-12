/**
 * ROUTE-09 — the restart half and the zero-context-tokens half, both proven
 * rather than asserted.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT PROVE, STATED PLAINLY
 * ---------------------------------------------------------------------------
 * `session_start` does NOT fire in a headless `createAgentSession`
 * [MEASURED: `tests/integration/call-model.test.ts`'s own header — a
 * five-event probe logged nothing before the first prompt; Pi emits
 * `session_start` from `AgentSession`'s extension-binding step,
 * `agent-session.ts:1761`, which the headless factory this repository's test
 * helpers use does not reach]. Every case below therefore simulates the
 * restart by calling `restoreModeFromBranch` directly against a branch read
 * from a real, live session — never by waiting for `session_start` to fire.
 * This proves the RESTORE FUNCTION is correct against real branch data; it
 * does NOT prove Pi's own event dispatch actually calls the `session_start`
 * hook in an interactive session — that half is Pi's own documented contract
 * (`routing/index.ts`'s module docstring cites the exact source lines for the
 * model-restoration half of the same claim) and is not re-verified here.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ABSENCE ASSERTION NEEDS A CONTROL, NOT JUST A CAPTURE
 * ---------------------------------------------------------------------------
 * `05-RESEARCH.md` and this plan both name the same trap Phase 3 already hit
 * once for the compat-block proof: an absence on a wire body is only evidence
 * when a control body proves the SAME instrument would have found the marker
 * if it were there. Case 4 below plants `MODE_ENTRY_TYPE` ("ky:mode" — the
 * `customType` string every persisted mode entry legitimately carries) as the
 * distinctive marker, asserts it is absent from every captured outgoing
 * payload after a mode switch and a real turn, and then sends the identical
 * string inside a user message as the positive control — proving the capture
 * instrument is live, not merely silent.
 *
 * ---------------------------------------------------------------------------
 * WHY `deepseek` CARRIES BOTH `deepseek-flash` AND `deepseek-v4-pro`,
 * WRAPPED FOR PAYLOAD CAPTURE
 * ---------------------------------------------------------------------------
 * `createFauxSession`'s own `buildPayload` option only wraps the DEFAULT faux
 * provider the session starts on (`faux/faux-flash`) — the payload-capturing
 * instrument this file needs lives on the `deepseek` provider the executor
 * switches TO, exactly like `mode-switch.test.ts`/`escalate.test.ts` register
 * it. So `deepseek`'s faux provider is wrapped with `wrapFauxWithPayload`
 * directly, here, rather than through `createFauxSession`'s option — the same
 * wrapper, applied at the second registration site instead of the first.
 */
import type { CustomEntry, ModelChangeEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";

import { describe, expect, it } from "vitest";

import { restoreModeFromBranch } from "../../.pi/extensions/routing/index.ts";
import { getModeState, setEscalated, setMode } from "../../.pi/extensions/routing/modes.ts";
import { DEFAULT_MODE, MODE_ENTRY_TYPE, type KyModeData } from "../../.pi/extensions/routing/schema.ts";
import { buildOpenAiFixturePayload, wrapFauxWithPayload } from "../helpers/faux.ts";
import { repoRoot } from "../helpers/git.ts";
import { createFauxSession, type FauxSessionHandle } from "../helpers/session.ts";

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

/** A notification `ctx.ui.notify` recorded -- unused here beyond satisfying `withCapturedNotify`'s signature. */
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
function withCapturedNotify(
	ctx: import("@earendil-works/pi-coding-agent").ExtensionCommandContext,
	notifications: Notification[],
): void {
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

/**
 * Build a fresh faux session with the real routing extension loaded at user
 * scope, `deepseek` registered under both the flash and pro ids AND wrapped
 * for payload capture, and the module-level mode/escalation slot reset to
 * `cheap`/not-escalated before the session is even created -- mirroring
 * `escalate.test.ts`'s own `withEscalateSession` setup.
 */
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

			// -- the model_change half: VERIFY Pi's own persistence exists, never
			// re-build it. If a future Pi version stopped writing this entry, this
			// assertion is what tells us before a user discovers their model
			// silently reset on resume.
			const modelChangeEntry = findModelChangeEntries(branch).at(-1);
			expect(
				modelChangeEntry,
				"no native model_change entry was found on the branch after a successful setModel -- " +
					"Pi's own persistence appears to be missing",
			).toBeDefined();
			expect(modelChangeEntry?.provider).toBe("deepseek");
			expect(modelChangeEntry?.modelId).toBe("deepseek-v4-pro");

			// -- the restart simulation: perturb the module state to something
			// OTHER than what the branch holds, so the restore below is observable
			// rather than a no-op that would pass by coincidence.
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

		// Perturb to a DIFFERENT valid mode first, so a successful fallback to
		// DEFAULT_MODE is observable rather than a no-op that would pass by
		// coincidence if DEFAULT_MODE happened to already be in force.
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
		// `latest?.data === undefined` (the pre-fix check) does NOT catch
		// `data: null` -- `null === undefined` is `false` in JavaScript.
		// Execution used to reach `isModeName(data.mode)` and dereference
		// `null`, throwing a TypeError straight past this function's own
		// "NEVER THROWS" doc comment. Case 3 above only exercises a malformed
		// MODE STRING inside an otherwise-well-formed payload object; this case
		// exercises a malformed PAYLOAD itself. The fix treats `data: null` as
		// "nothing to restore" (an early return, the same branch an absent
		// `data` field already takes) -- it does NOT force DEFAULT_MODE the way
		// case 3's malformed-mode-STRING path does, because that path only
		// runs once `data` is confirmed to be an object worth reading `mode`
		// off of. Perturbing to "balanced" (a mode DEFAULT_MODE is not) and
		// asserting it STAYS "balanced" is the stronger, non-vacuous proof:
		// asserting a fall-back TO DEFAULT_MODE here would pass just as well
		// for a buggy implementation that unconditionally reset state on any
		// malformed payload, which is not what "leave it untouched" means.
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

			// The ky:mode entry now exists on the branch, carrying MODE_ENTRY_TYPE
			// as its own customType -- the distinctive marker this case searches
			// for. Confirm the entry actually exists before claiming anything about
			// its absence from the wire: an absence claim about an entry that was
			// never written proves nothing.
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

			// -- the positive control: the SAME marker, sent as ordinary user
			// content, must be found by the SAME instrument. Without this, an
			// instrument that captured nothing (or captured but never serialised
			// content) would have passed the assertion above vacuously.
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
