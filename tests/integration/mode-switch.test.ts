/**
 * ROUTE-02 — `/cheap`, `/balanced`, `/max` in a real Pi session, both
 * directions: a switch either takes effect or is refused with a reason.
 *
 * ---------------------------------------------------------------------------
 * WHY A FAUX PROVIDER REGISTERED UNDER A REAL PROVIDER ID STILL NEEDS AN
 * EXPLICIT AUTH GRANT, MEASURED HERE RATHER THAN ASSUMED
 * ---------------------------------------------------------------------------
 * `tests/helpers/session.ts`'s own docstring warns that a faux provider
 * registered under a real provider id "still resolves auth empty". Measured
 * directly against `ModelRuntime` (not inferred): registering a faux
 * provider under `"deepseek"` and calling `hasConfiguredAuth("deepseek")`
 * returns `false`, exactly as documented — `createFauxSession` never writes
 * anything to `authPath` and passes `refreshOnCreate: false`, so nothing
 * populates the auth snapshot.
 *
 * The seam that works, ALSO MEASURED rather than assumed: `ModelRuntime`
 * exposes a public `setRuntimeApiKey(providerId, apiKey)` — no network
 * involved (`synchronizeCredentialState` explicitly calls
 * `this.models.refresh({ allowNetwork: false, ... })`)
 * [VERIFIED: `dist/core/model-runtime.js:374-393`, `:394-400`]. Calling it and
 * awaiting the returned promise is NOT sufficient by itself, though: five
 * back-to-back runs against a bare `ModelRuntime` showed
 * `hasConfiguredAuth(providerId)` still `false` in the same microtask the
 * await returns in, and `true` after a handful of milliseconds of polling —
 * `checkAuth(providerId)` (a live, uncached per-call check) is already `true`
 * at that same point, so the gap is specific to the CACHED availability
 * snapshot `hasConfiguredAuth` reads, not to whether the credential itself
 * "took". {@link waitForConfiguredAuth} below polls with a real timeout for
 * exactly this reason — a fixed `setTimeout` guess would be exactly the kind
 * of flaky, undocumented magic-number this project's own conventions forbid.
 * This finding, and the seam it justifies, is recorded in
 * `05-07-SUMMARY.md` per the plan's own instruction.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PLAN'S TWO "SETMODEL RETURNS FALSE" AND "NO CONFIGURED CANDIDATE"
 * BEHAVIORS ARE ONE SCENARIO HERE, NOT TWO
 * ---------------------------------------------------------------------------
 * `pi.setModel`'s own wrapper pre-check and `routing/modes.ts`'s
 * `pickConfiguredCandidate` both read the IDENTICAL underlying state —
 * `ModelRuntime#hasConfiguredAuth(provider)`
 * [VERIFIED: `dist/core/agent-session.js:1886`, `dist/core/model-registry.js:
 * 27-28`]. A candidate that `pickConfiguredCandidate` accepts can therefore
 * never make `pi.setModel` return `false` for want of auth in this harness:
 * the refusal always surfaces at candidate-selection, before `pi.setModel` is
 * ever called. Case 3 below drives exactly that path — a mode whose every
 * candidate lacks configured auth — and it is the same scenario the plan's
 * "pi.setModel returning false" bullet describes, because there is no
 * reachable state in Pi 0.84.1's public extension API where the two checks
 * disagree outside the TOCTOU race `05-index.ts`'s own `try`/`catch` defends
 * against defensively (not exercised here — it needs a race, not a fixture).
 * Task 1's own acceptance criteria separately proves, by static grep, that
 * every `pi.setModel` call site is wrapped in `try`/`catch` with the boolean
 * checked; this file proves the RUNTIME behavior the wrapping exists for.
 *
 * ---------------------------------------------------------------------------
 * WHY THE COMMAND IS INVOKED VIA `extensionRunner`, NOT `session.prompt`
 * ---------------------------------------------------------------------------
 * `AgentSession#extensionRunner` is a public getter
 * [VERIFIED: `dist/core/agent-session.d.ts:642`]. `ExtensionRunner` exposes
 * `getCommand(name)` and `createCommandContext()` as public methods
 * [VERIFIED: `dist/core/extensions/runner.d.ts:132,144`], and
 * `createCommandContext()` is available immediately after
 * `createAgentSession` returns — extension loading (and therefore command
 * registration) happens at SESSION CONSTRUCTION, not at the first prompt.
 * `waitForIdleFn` is the no-op `async () => {}` in a headless session
 * [VERIFIED: `dist/core/extensions/runner.js:547-550`, `:81-119`'s
 * `bindCommandContext` called with no actions] — the command context exists
 * and the handler runs; nothing here needs a warm-up prompt the way
 * `tests/integration/call-model.test.ts` did (that file needed a prompt to
 * make an EVENT fire; this file drives a COMMAND directly).
 *
 * ---------------------------------------------------------------------------
 * ORDERING IS RECORDED, NEVER INFERRED
 * ---------------------------------------------------------------------------
 * Because `waitForIdleFn` is a no-op, its position in the call sequence
 * cannot be observed by its side effects — only by RECORDING that it ran.
 * `ctx.waitForIdle` is overridden with a wrapper that pushes to a shared,
 * `globalThis`-keyed log before delegating to the real (no-op) function; the
 * routing extension's own `model_select` handler (loaded via the probe
 * source below) pushes to the SAME log when Pi fires the event inside
 * `pi.setModel`. Two module graphs — the test file and the jiti-loaded
 * extension — share exactly one channel: the process-wide object, the same
 * reason `tests/integration/call-model.test.ts` parks its `ExtensionContext`
 * there. Per Phase 1's recorded lesson, every ordering comparison below is
 * preceded by a non-emptiness assertion on the log itself.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxProvider } from "@earendil-works/pi-ai";
import type { CustomEntry } from "@earendil-works/pi-coding-agent";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { AgentOverrides } from "../../.pi/extensions/routing/agent-overrides.ts";
import { MODE_ENTRY_TYPE, type KyModeData } from "../../.pi/extensions/routing/schema.ts";
import { repoRoot } from "../helpers/git.ts";
import { createFauxSession, type FauxSessionHandle } from "../helpers/session.ts";

/** Where the ordering log lives, shared across the test's and the extension's own module graphs. */
const LOG_KEY = "__kypiModeSwitchOrderLog";

/** Absolute path of the routing extension entry point this repository ships. */
const ROUTING_ENTRY = `${repoRoot()}/.pi/extensions/routing/index.ts`;

/** Absolute path of routing/schema.ts, needed by the WR-10 guard-blocked-derivation extension source below. */
const SCHEMA_ENTRY = `${repoRoot()}/.pi/extensions/routing/schema.ts`;

/**
 * The user-scope extension under test: the real routing entry point, plus a
 * one-line probe that records every `model_select` into the shared log.
 *
 * `event.model` is a real `Model<Api>` on `model_select`
 * [VERIFIED: `dist/core/extensions/types.d.ts:602-607`], so `provider`/`id`
 * are always present -- no optional chaining needed on those two fields.
 */
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
 * WR-10: the user-scope extension for the guard-blocked-derivation case --
 * the real routing entry point, wired through {@link RoutingTestOptions}'s
 * own `agentOverridesFor` seam with a role map whose `balanced.planner`
 * candidate is `amazon-bedrock/us.deepseek.r1-v1:0` (the same no-tool-calling
 * fixture id `tests/unit/agent-overrides.test.ts`'s own guard-blocked case
 * uses) -- everything else about `balanced` (crucially, its `executor`
 * candidate) is left as the REAL `ROLE_MAP.balanced` entry, so the executor
 * switch itself still succeeds and only the subagent-pin write is blocked.
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

/**
 * Poll `modelRuntime.hasConfiguredAuth(providerId)` until it reports `true`,
 * or throw naming the timeout. See the module docstring's measured-gap
 * section for why a poll is needed at all rather than trusting the awaited
 * `setRuntimeApiKey` promise alone.
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
					"after setRuntimeApiKey resolved. See this file's header for the measured async gap.",
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
 * Replace `ctx.ui` with a recording stand-in, via `defineProperty` rather
 * than assignment.
 *
 * `ExtensionRunner#createCommandContext()` builds its returned object with
 * `Object.defineProperties({}, Object.getOwnPropertyDescriptors(this.
 * createContext()))` [VERIFIED: `dist/core/extensions/runner.js:538-542`],
 * and `createContext()`'s `ui` is a GETTER-ONLY accessor property (an object
 * literal `get ui() {...}` with no setter)
 * [VERIFIED: `dist/core/extensions/runner.js:463-467`]. Plain assignment
 * (`ctx.ui = ...`) throws in strict mode against a getter-only accessor;
 * `defineProperty` replaces the accessor with a writable, configurable data
 * property instead, exactly the technique
 * `tests/integration/fallback-chain.test.ts#withShadowedRegistry` already
 * uses in this repository for the sibling `modelRegistry` property.
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

/**
 * Replace `ctx.waitForIdle` with a wrapper that records into the shared log
 * before delegating to the real (no-op, headless) function.
 *
 * Unlike `ui`, `waitForIdle` is assigned as a plain, writable, configurable
 * data property inside `createCommandContext()` itself
 * [VERIFIED: `dist/core/extensions/runner.js:547-550`,
 * `context.waitForIdle = () => {...}`], so direct reassignment is sound here
 * -- no `defineProperty` needed for this one property.
 */
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

/**
 * CR-01: the suite-wide value `tests/setup/agent-dir.ts`'s `beforeAll`
 * already set for this file, captured here (in THIS file's own `beforeAll`,
 * which vitest runs AFTER the setup file's) so cases 2/4 below can restore it
 * instead of `delete`-ing the variable outright. Deleting would punch a hole
 * in the suite-wide guard for the rest of this file's cases -- see that
 * file's own docstring.
 */
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

			// Non-vacuity FIRST, per Phase 1's recorded lesson: an ordering
			// comparison over an empty log passes whatever the two indices
			// default to, so both entries must be shown to exist before their
			// order is compared.
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
			// Deliberately NOT calling setRuntimeApiKey at all -- "deepseek" is
			// registered (so it resolves) but carries no configured auth, and
			// "dashscope" is never registered (so it does not resolve either).
			// This is what a machine with partial credentials looks like on
			// every one of cheap's flash-tier candidates.
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

			// waitForIdle still ran, first, even on a refusal -- the race is
			// closed before ANY branch of the outcome, not only the success
			// branch.
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

				// The EXECUTOR switch itself must still succeed --
				// BLOCKED_PLANNER_SOURCE only corrupts balanced.planner, leaving
				// balanced.executor as the REAL (authed, guard-approved) ROLE_MAP
				// entry. A test that only checked the refusal text could pass
				// against an implementation that failed the WHOLE switch instead
				// of carrying the subagent refusal into step 6's message, which is
				// a materially different (and wrong) behaviour.
				expect(
					ctx.model?.provider,
					`the executor switch itself did not succeed (notifications: ${JSON.stringify(notifications)})`,
				).toBe("deepseek");
				expect(ctx.model?.id).toBe("deepseek-flash");

				// THE ASSERTION WR-10 EXISTS FOR: the notification names the
				// refusal AND the blocked role, driven through the REAL command
				// path -- not merely a test asserting its own choice not to call
				// writeAgentOverrides (tests/unit/agent-overrides.test.ts's prior,
				// self-fulfilling version of this case).
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

				// THE FILE ITSELF: no subagents key at all -- an agentOverridesFor
				// ok:false derivation must never be unwrapped, coerced to {}, or
				// written anyway (agent-overrides.ts's own CALLER DISCIPLINE
				// section).
				const settingsPath = join(settingsDir, "settings.json");
				if (existsSync(settingsPath)) {
					const written = JSON.parse(readFileSync(settingsPath, "utf-8")) as { subagents?: unknown };
					expect(
						written.subagents,
						`settings.json was written but carries a "subagents" key: ${JSON.stringify(written)}`,
					).toBeUndefined();
				}
				// existsSync(settingsPath) === false is ALSO an acceptable pass
				// here -- applyMode's step 5 only ever writes settings.json when
				// overridesResult is ok:true, so a guard-blocked derivation should
				// mean no write occurs at all. Either "no file" or "a file with no
				// subagents key" proves the same claim; only "a file WITH a
				// subagents key" would fail it.
			},
			BLOCKED_PLANNER_SOURCE,
		);
	});
});

/**
 * Build a fresh faux session with the routing extension (plus the
 * `model_select` probe) loaded at user scope, run `fn` against it, then
 * dispose.
 *
 * THE SESSION'S STARTING MODEL IS DELIBERATELY NOT `deepseek/deepseek-v4-
 * flash` -- MEASURED, NOT ASSUMED. `AgentSession#_emitModelSelect` skips the
 * event ENTIRELY when `modelsAreEqual(previousModel, nextModel)`
 * [VERIFIED: `dist/core/agent-session.js:1182-1191`]. Every mode this file
 * drives resolves the executor to `deepseek/deepseek-flash`, so if the
 * session already started there, a "successful" switch would still leave
 * `pi.setModel` returning `true` while firing NO `model_select` event at
 * all -- case 1 caught exactly this the first time this file was run: the
 * ordering log held only `"waitForIdle"`, because the switch was a genuine
 * no-op change. The session therefore starts on the DEFAULT faux model
 * (`faux/faux-flash`, `session.ts`'s own default, registered under faux's
 * own provider id rather than a real one), and `deepseek/deepseek-flash`
 * is registered SEPARATELY, after construction, as a second native
 * provider -- so every switch this file drives is a genuine change.
 *
 * Mirrors `withFauxSession`'s own callback-and-finally-dispose shape (this
 * file's own cases interleave `setRuntimeApiKey`/`waitForConfiguredAuth`
 * between session creation and command invocation INSIDE the callback,
 * which is exactly what a callback shape is for).
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
