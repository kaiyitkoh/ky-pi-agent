/**
 * `/cheap`, `/balanced`, `/max` in a real Pi session, both directions: a switch takes effect or is refused with a reason.
 * A faux provider under a real id needs `setRuntimeApiKey` plus a poll, since `hasConfiguredAuth`'s cached snapshot lags
 * the awaited promise. Commands run through `extensionRunner` (registered at construction), and the `waitForIdle` /
 * `model_select` order is recorded in a `globalThis` log shared with the jiti-loaded extension, never inferred.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxProvider } from "@earendil-works/pi-ai";
import type { CustomEntry } from "@earendil-works/pi-coding-agent";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { AgentOverrides } from "../../.pi/extensions/routing/agent-overrides.ts";
import { getModeState, setEscalated, setMode } from "../../.pi/extensions/routing/modes.ts";
import { DEFAULT_MODE, MODE_ENTRY_TYPE, type KyModeData } from "../../.pi/extensions/routing/schema.ts";
import { repoRoot } from "../helpers/git.ts";
import { createFauxSession, type FauxSessionHandle, waitForConfiguredAuth, type Notification, withCapturedNotify } from "../helpers/session.ts";

/** Where the ordering log lives, shared across the test's and the extension's own module graphs. */
const LOG_KEY = "__kypiModeSwitchOrderLog";

/** Absolute path of the routing extension entry point this repository ships. */
const ROUTING_ENTRY = `${repoRoot()}/.pi/extensions/routing/index.ts`;

/** Absolute path of routing/schema.ts, for the guard-blocked-derivation extension source below. */
const SCHEMA_ENTRY = `${repoRoot()}/.pi/extensions/routing/schema.ts`;

/** The real routing entry point plus a probe recording every `model_select` into the shared log. */
const PROBE_SOURCE = [
	"// Generated for tests/integration/mode-switch.test.ts. Lives in a temp dir.",
	`import routing from ${JSON.stringify(ROUTING_ENTRY)};`,
	"",
	`const LOG_KEY = ${JSON.stringify(LOG_KEY)};`,
	"",
	"export default function (pi) {",
	"\trouting(pi);",
	'\tpi.on("model_select", (event) => {',
	"\t\tconst log = globalThis[LOG_KEY] ?? (globalThis[LOG_KEY] = []);",
	"\t\tlog.push(`model_select:${event.model.provider}/${event.model.id}`);",
	"\t});",
	"}",
].join("\n");

/**
 * The real routing entry point with `balanced.planner` swapped for a no-tool-calling Bedrock id, so the executor switch
 * still succeeds and only the subagent-pin write is blocked.
 */
const BLOCKED_PLANNER_SOURCE = [
	"// Generated for tests/integration/mode-switch.test.ts. Lives in a temp dir.",
	`import routing from ${JSON.stringify(ROUTING_ENTRY)};`,
	`import { ROLE_MAP } from ${JSON.stringify(SCHEMA_ENTRY)};`,
	"",
	"const blockedRoleMap = {",
	"\t...ROLE_MAP,",
	"\tbalanced: {",
	"\t\t...ROLE_MAP.balanced,",
	'\t\tplanner: { candidates: [{ provider: "amazon-bedrock", id: "us.deepseek.r1-v1:0" }] },',
	"\t},",
	"};",
	"",
	"export default function (pi) {",
	"\trouting(pi, { agentOverridesFor: { roleMap: blockedRoleMap } });",
	"}",
].join("\n");

/** Reset the shared ordering log to an empty array, owned by this test file. */
function resetOrderLog(): void {
	(globalThis as Record<string, unknown>)[LOG_KEY] = [];
}

/** Read the shared ordering log. */
function readOrderLog(): string[] {
	return ((globalThis as Record<string, unknown>)[LOG_KEY] as string[] | undefined) ?? [];
}

/** Wraps `ctx.waitForIdle` to record into the shared log; it is a plain writable property (runner.js `createCommandContext`). */
function withRecordedWaitForIdle(
	ctx: import("@earendil-works/pi-coding-agent").ExtensionCommandContext,
): void {
	const original = ctx.waitForIdle;
	ctx.waitForIdle = async () => {
		const log = readOrderLog();
		log.push("waitForIdle");
		await original();
	};
}

/** Everything a temp-dir-backed test case owns, torn down in `afterEach`. */
let tempDirs: string[] = [];

function freshTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

/** The suite-wide agent-dir value from tests/setup/agent-dir.ts, restored (never deleted) by the cases that change it. */
let suiteAgentDir: string | undefined;
beforeAll(() => {
	suiteAgentDir = process.env.PI_CODING_AGENT_DIR;
});

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	}
	tempDirs = [];
	if (suiteAgentDir === undefined) {
		delete process.env.PI_CODING_AGENT_DIR;
	} else {
		process.env.PI_CODING_AGENT_DIR = suiteAgentDir;
	}
});

/** A `ky:mode` entry as read back off `ctx.sessionManager.getBranch()`. */
function findModeEntry(branch: readonly unknown[]): CustomEntry<KyModeData> | undefined {
	return branch.find(
		(entry): entry is CustomEntry<KyModeData> =>
			typeof entry === "object" &&
			entry !== null &&
			(entry as { type?: unknown }).type === "custom" &&
			(entry as { customType?: unknown }).customType === MODE_ENTRY_TYPE,
	);
}

describe("ROUTE-02 -- /cheap, /balanced, /max in a real Pi session", () => {
	it("case 0 -- the routing extension really registers cheap/balanced/max as commands", async () => {
		await withModeSwitchSession(async ({ session }) => {
			for (const name of ["cheap", "balanced", "max"]) {
				const command = session.extensionRunner.getCommand(name);
				expect(
					command,
					`getCommand("${name}") returned undefined -- the routing extension did not register this ` +
						"command, so every assertion in the cases below would be exercising nothing. The " +
						"likeliest cause is the extension not loading at all: it must sit at USER scope headless",
				).toBeDefined();
			}
		});
	});

	it("case 1 -- a switch with configured auth changes the executor, in the recorded order waitForIdle-then-model-select", async () => {
		resetOrderLog();
		await withModeSwitchSession(async ({ session, modelRuntime }) => {
			await modelRuntime.setRuntimeApiKey("deepseek", "kypi-fixture-not-a-real-key");
			await waitForConfiguredAuth(modelRuntime, "deepseek");

			const command = session.extensionRunner.getCommand("balanced");
			expect(command, 'getCommand("balanced") returned undefined').toBeDefined();
			if (command === undefined) {
				return;
			}

			const ctx = session.extensionRunner.createCommandContext();
			withRecordedWaitForIdle(ctx);
			const notifications: Notification[] = [];
			withCapturedNotify(ctx, notifications);

			const before = ctx.model;
			await command.handler("", ctx);
			const after = ctx.model;

			// Non-vacuity first: an order comparison over an empty log passes whatever the indices default to.
			const log = readOrderLog();
			expect(
				log.length,
				`the ordering log is empty (before=${JSON.stringify(before)}, notifications=` +
					`${JSON.stringify(notifications)}) -- either waitForIdle never ran or the model never ` +
					"actually switched, and the ordering assertion below would be comparing two -1 indices",
			).toBeGreaterThanOrEqual(2);

			const waitForIdleIndex = log.indexOf("waitForIdle");
			const modelSelectIndex = log.findIndex((entry) => entry.startsWith("model_select:"));
			expect(waitForIdleIndex, "waitForIdle was never recorded").toBeGreaterThanOrEqual(0);
			expect(modelSelectIndex, "no model_select event was ever recorded").toBeGreaterThanOrEqual(0);
			expect(
				waitForIdleIndex < modelSelectIndex,
				`waitForIdle (index ${waitForIdleIndex}) did not precede the model switch (index ` +
					`${modelSelectIndex}) -- the race ROUTE-02 exists to close is back`,
			).toBe(true);

			expect(
				after?.provider,
				`the session's model did not become deepseek/deepseek-flash. Before: ` +
					`${JSON.stringify(before)}. Notifications: ${JSON.stringify(notifications)}`,
			).toBe("deepseek");
			expect(after?.id).toBe("deepseek-flash");

			expect(
				notifications.length,
				"a successful switch must still report an outcome to the user",
			).toBeGreaterThan(0);
			expect(
				notifications.at(-1)?.level,
				"a successful switch is informational, not an error",
			).toBe("info");
			expect(notifications.at(-1)?.text).toContain("balanced");
			expect(notifications.at(-1)?.text).toContain("deepseek/deepseek-flash");

			const branch = session.sessionManager.getBranch();
			const modeEntry = findModeEntry(branch);
			expect(
				modeEntry,
				"no ky:mode custom entry was found on the branch after a successful switch",
			).toBeDefined();
			expect(modeEntry?.data?.mode).toBe("balanced");
			expect(modeEntry?.data?.escalated).toBe(false);
		});
	});

	it("case 1b -- a new session starts in the default mode, unescalated, with the default executor", async () => {
		resetOrderLog();
		await withModeSwitchSession(async ({ session, modelRuntime }) => {
			await modelRuntime.setRuntimeApiKey("deepseek", "kypi-fixture-not-a-real-key");
			await waitForConfiguredAuth(modelRuntime, "deepseek");
			// State left by the previous session in this process; the new branch has no ky:mode entry.
			setMode("max");
			setEscalated(true, "balanced");

			await session.extensionRunner.emit({ type: "session_start", reason: "new" });

			expect(getModeState()).toMatchObject({ mode: DEFAULT_MODE, escalated: false });
			expect(session.model?.id, "the default mode's executor is applied").toBe("deepseek-flash");
		});
	});

	it("case 2 -- a successful switch writes subagents.agentOverrides to the injected temp settings file", async () => {
		resetOrderLog();
		const settingsDir = freshTempDir("kypi-mode-switch-settings-");
		process.env.PI_CODING_AGENT_DIR = settingsDir;

		await withModeSwitchSession(async ({ session, modelRuntime }) => {
			await modelRuntime.setRuntimeApiKey("deepseek", "kypi-fixture-not-a-real-key");
			await waitForConfiguredAuth(modelRuntime, "deepseek");

			const command = session.extensionRunner.getCommand("balanced");
			expect(command).toBeDefined();
			if (command === undefined) {
				return;
			}
			const ctx = session.extensionRunner.createCommandContext();
			withRecordedWaitForIdle(ctx);
			const notifications: Notification[] = [];
			withCapturedNotify(ctx, notifications);

			await command.handler("", ctx);

			const settingsPath = join(settingsDir, "settings.json");
			expect(
				existsSync(settingsPath),
				`no settings.json was written under the injected PI_CODING_AGENT_DIR (${settingsDir}). ` +
					`Notifications: ${JSON.stringify(notifications)}`,
			).toBe(true);

			const written = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
				subagents?: { agentOverrides?: AgentOverrides };
			};
			const overrides = written.subagents?.agentOverrides;
			expect(overrides, "settings.json has no subagents.agentOverrides key").toBeDefined();
			expect(
				Object.keys(overrides ?? {}).length,
				"subagents.agentOverrides is empty -- ROUTE-05's write produced no entries",
			).toBeGreaterThan(0);
			expect(
				overrides?.planner?.model,
				"the planner pin does not carry a '<provider>/<id>' model string",
			).toMatch(/^[^/]+\/[^/]+$/);
		});
	});

	it("case 2b -- the subagent pin does not outlive the session: shutdown restores the settings file", async () => {
		resetOrderLog();
		const settingsDir = freshTempDir("kypi-mode-switch-settings-");
		process.env.PI_CODING_AGENT_DIR = settingsDir;
		const settingsPath = join(settingsDir, "settings.json");
		const original = `${JSON.stringify({ theme: "ky" }, null, 2)}
`;
		writeFileSync(settingsPath, original, "utf-8");

		await withModeSwitchSession(async ({ session, modelRuntime }) => {
			await modelRuntime.setRuntimeApiKey("deepseek", "kypi-fixture-not-a-real-key");
			await waitForConfiguredAuth(modelRuntime, "deepseek");

			const command = session.extensionRunner.getCommand("balanced");
			expect(command).toBeDefined();
			if (command === undefined) {
				return;
			}
			const ctx = session.extensionRunner.createCommandContext();
			withRecordedWaitForIdle(ctx);
			await command.handler("", ctx);
			expect(readFileSync(settingsPath, "utf-8"), "the pin was never written, so the restore below proves nothing").toContain("agentOverrides");

			await session.extensionRunner.emit({ type: "session_shutdown", reason: "reload" });
			expect(readFileSync(settingsPath, "utf-8"), "a reload must keep the pin").toContain("agentOverrides");

			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			expect(readFileSync(settingsPath, "utf-8")).toBe(original);
		});
	});

	it("case 3 -- a mode with no configured candidate refuses, names both candidates, and leaves the model unchanged", async () => {
		resetOrderLog();
		await withModeSwitchSession(async ({ session, modelRuntime }) => {
			// No setRuntimeApiKey: "deepseek" resolves but has no auth and "dashscope" is unregistered, as on a partly
			// configured machine.
			expect(
				modelRuntime.hasConfiguredAuth("deepseek"),
				"the auth precondition for this case is wrong",
			).toBe(false);

			const command = session.extensionRunner.getCommand("cheap");
			expect(command, 'getCommand("cheap") returned undefined').toBeDefined();
			if (command === undefined) {
				return;
			}

			const ctx = session.extensionRunner.createCommandContext();
			withRecordedWaitForIdle(ctx);
			const notifications: Notification[] = [];
			withCapturedNotify(ctx, notifications);

			const before = ctx.model;
			await command.handler("", ctx);
			const after = ctx.model;

			expect(
				after?.provider,
				"the session's model provider changed despite every candidate lacking configured auth",
			).toBe(before?.provider);
			expect(
				after?.id,
				"the session's model id changed despite every candidate lacking configured auth",
			).toBe(before?.id);

			expect(
				notifications.length,
				"a refusal must still report an outcome to the user",
			).toBeGreaterThan(0);
			expect(notifications.at(-1)?.level, "a refusal is an error, not an info message").toBe(
				"error",
			);
			expect(
				notifications.at(-1)?.text,
				"the refusal does not name the deepseek candidate that was tried",
			).toContain("deepseek/deepseek-flash");
			expect(
				notifications.at(-1)?.text,
				"the refusal does not name the dashscope candidate that was tried",
			).toContain("dashscope/deepseek-v4-flash");

			// waitForIdle ran first even on a refusal: the race is closed before any branch of the outcome.
			const log = readOrderLog();
			expect(
				log.length,
				"waitForIdle was never recorded even though the command ran",
			).toBeGreaterThanOrEqual(1);
			expect(log[0]).toBe("waitForIdle");

			// No model_select on a refusal: setModel was never reached.
			expect(
				log.some((entry) => entry.startsWith("model_select:")),
				"a model_select event fired despite the refusal happening before pi.setModel was ever called",
			).toBe(false);

			const branch = session.sessionManager.getBranch();
			expect(
				findModeEntry(branch),
				"a ky:mode entry was written even though the switch was refused",
			).toBeUndefined();
		});
	});

	it("case 4 -- a refusal never touches the settings file at all", async () => {
		resetOrderLog();
		const settingsDir = freshTempDir("kypi-mode-switch-settings-refusal-");
		process.env.PI_CODING_AGENT_DIR = settingsDir;

		await withModeSwitchSession(async ({ session }) => {
			const command = session.extensionRunner.getCommand("cheap");
			expect(command).toBeDefined();
			if (command === undefined) {
				return;
			}
			const ctx = session.extensionRunner.createCommandContext();
			withRecordedWaitForIdle(ctx);
			const notifications: Notification[] = [];
			withCapturedNotify(ctx, notifications);

			await command.handler("", ctx);

			expect(notifications.at(-1)?.level).toBe("error");

			const settingsPath = join(settingsDir, "settings.json");
			expect(
				existsSync(settingsPath),
				"a refusal that never reached step 5 still created a settings.json file under the " +
					"injected PI_CODING_AGENT_DIR",
			).toBe(false);
		});
	});

	it("case 5 -- WR-10: a guard-blocked planner derivation switches the executor, reports the refusal by name, and writes NO subagents key", async () => {
		resetOrderLog();
		const settingsDir = freshTempDir("kypi-mode-switch-settings-blocked-planner-");
		process.env.PI_CODING_AGENT_DIR = settingsDir;

		await withModeSwitchSession(
			async ({ session, modelRuntime }) => {
				await modelRuntime.setRuntimeApiKey("deepseek", "kypi-fixture-not-a-real-key");
				await waitForConfiguredAuth(modelRuntime, "deepseek");

				const command = session.extensionRunner.getCommand("balanced");
				expect(command, 'getCommand("balanced") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}
				const ctx = session.extensionRunner.createCommandContext();
				const notifications: Notification[] = [];
				withCapturedNotify(ctx, notifications);

				await command.handler("", ctx);

				// The executor switch itself must still succeed; only the subagent pin is refused.
				expect(
					ctx.model?.provider,
					`the executor switch itself did not succeed (notifications: ${JSON.stringify(notifications)})`,
				).toBe("deepseek");
				expect(ctx.model?.id).toBe("deepseek-flash");

				// Driven through the real command path: the notification names the refusal and the blocked role.
				expect(notifications.length, "a successful switch must still report an outcome").toBeGreaterThan(0);
				const text = notifications.at(-1)?.text ?? "";
				expect(
					text,
					'the notification does not say subagent pins were left unchanged ("subagent pins ' +
						'unchanged because")',
				).toContain("subagent pins unchanged because");
				expect(text, 'the notification does not name the blocked role ("planner")').toContain("planner");
				expect(
					text.toLowerCase(),
					"the notification does not carry the guard's own reason (tool calling)",
				).toContain("tool calling");

				// A blocked derivation must never be written as subagents config, coerced or not.
				const settingsPath = join(settingsDir, "settings.json");
				if (existsSync(settingsPath)) {
					const written = JSON.parse(readFileSync(settingsPath, "utf-8")) as { subagents?: unknown };
					expect(
						written.subagents,
						`settings.json was written but carries a "subagents" key: ${JSON.stringify(written)}`,
					).toBeUndefined();
				}
				// No file at all is equally a pass: a blocked derivation should mean no write.
			},
			BLOCKED_PLANNER_SOURCE,
		);
	});
});

/**
 * A faux session with the routing extension and probe at user scope. It starts on `faux/faux-flash`, not deepseek:
 * `_emitModelSelect` skips equal models (agent-session.js `_emitModelSelect`), so starting on the target would make every
 * switch a silent no-op.
 */
async function withModeSwitchSession<T>(
	fn: (handle: FauxSessionHandle) => Promise<T>,
	extensionSource: string = PROBE_SOURCE,
): Promise<T> {
	const handle = await createFauxSession({
		extensionSource,
	});
	try {
		const deepseekFaux = fauxProvider({
			provider: "deepseek",
			models: [
				{
					id: "deepseek-flash",
					reasoning: true,
					cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 },
				},
			],
		});
		handle.modelRuntime.registerNativeProvider(deepseekFaux.provider);
		return await fn(handle);
	} finally {
		await handle.dispose();
	}
}
