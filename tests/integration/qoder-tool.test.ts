/**
 * WR-11 -- `.pi/extensions/qoder/index.ts`'s registered `qoder_delegate` TOOL
 * (as opposed to `tests/integration/qoder-delegate.test.ts`, which drives
 * `client.ts#delegateTask` directly and never touches this file at all): a
 * human confirmation gate in interactive mode, and a configuration gate that
 * deactivates the tool entirely on an unconfigured machine.
 *
 * ---------------------------------------------------------------------------
 * WHY `ctx.hasUI`/`ctx.ui` ARE STUBBED VIA `defineProperty`
 * ---------------------------------------------------------------------------
 * `ExtensionRunner#createCommandContext()` builds its returned object with
 * `Object.defineProperties({}, Object.getOwnPropertyDescriptors(this.
 * createContext()))` [VERIFIED: `dist/core/extensions/runner.js:538-542`],
 * and `createContext()`'s `hasUI`/`ui` are both GETTER-ONLY accessor
 * properties [VERIFIED: `dist/core/extensions/runner.js:472-475`]. Plain
 * assignment throws in strict mode against a getter-only accessor;
 * `defineProperty` replaces it with a writable, configurable data property --
 * exactly the technique `tests/integration/mode-switch.test.ts#
 * withCapturedNotify` already uses in this repository for the sibling `ui`
 * property.
 *
 * ---------------------------------------------------------------------------
 * WHY `session.extensionRunner.createCommandContext()` SATISFIES `execute()`'s
 * `ctx: ExtensionContext` PARAMETER
 * ---------------------------------------------------------------------------
 * `ExtensionCommandContext extends ExtensionContext`
 * [VERIFIED: `dist/core/extensions/types.d.ts:254`] -- a command context IS
 * an extension context, structurally. `tests/integration/single-shot-
 * roles.test.ts`'s own header makes the identical argument for calling
 * `runSingleShotRole(ctx, ...)`, which also expects `ExtensionContext`.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CONFIGURATION-GATE CASES NEVER CALL `execute()`
 * ---------------------------------------------------------------------------
 * They prove only whether `session.getActiveToolNames()` contains
 * `"qoder_delegate"` AFTER a real `session_start` is emitted. The gate is a
 * once-per-session decision made in a `session_start` HANDLER (CR-01: it
 * cannot live in the factory -- `pi.getActiveTools()`/`setActiveTools()`
 * throw there), reading `process.env` at that moment -- which is why
 * `process.env` is set BEFORE `createFauxSession` in those cases and
 * restored in each case's own `finally`.
 */
import { join } from "node:path";

import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { afterEach, describe, expect, it } from "vitest";

import { logDir } from "../../.pi/lib/jsonl.ts";
import {
	DEFAULT_QODER_BASE_URL,
	MAX_TASK_CHARS,
	QODER_AGENT_ID_ENV,
	QODER_BASE_URL_ENV,
	QODER_ENVIRONMENT_ID_ENV,
	QODER_TOKEN_ENV,
} from "../../.pi/extensions/qoder/client.ts";
import { repoRoot } from "../helpers/git.ts";
import { logFilesIn, readTornSafe, withTempLogCwd } from "../helpers/logs.ts";
import { withQoderLoopback } from "../helpers/qoder-loopback.ts";
import { createFauxSession, type FauxSessionHandle } from "../helpers/session.ts";

/**
 * Read the `qoder.delegate.confirm` records from `<agentCwd>/.pi/logs/qoder-*.jsonl`.
 * WR-03: `execute()` writes through `client.ts#writeQoderTranscript`, which
 * appends under the SESSION's own cwd (`ctx.cwd`, i.e. `handle.cwd` -- NOT
 * `withTempLogCwd`'s own throwaway directory, which this file's other cases
 * carry only for parity with `qoder-delegate.test.ts`'s pattern but do not
 * read from).
 */
function readConfirmRecords(agentCwd: string): { event?: unknown; hasUI?: unknown; approved?: unknown; taskChars?: unknown }[] {
	const dir = logDir(agentCwd);
	const files = logFilesIn(dir);
	const qoderFile = files.find((name) => name.startsWith("qoder-"));
	if (qoderFile === undefined) {
		return [];
	}
	const { records } = readTornSafe(join(dir, qoderFile));
	return (records as { event?: unknown }[]).filter((r) => r.event === "qoder.delegate.confirm");
}

/**
 * WR-02 (iteration 3): the two silent refusal branches (unconfigured,
 * task-length) write `qoder.delegate.refused` records through the same
 * writer and file as `readConfirmRecords` above -- never the task text.
 */
function readRefusedRecords(agentCwd: string): { event?: unknown; cause?: unknown; taskChars?: unknown }[] {
	const dir = logDir(agentCwd);
	const files = logFilesIn(dir);
	const qoderFile = files.find((name) => name.startsWith("qoder-"));
	if (qoderFile === undefined) {
		return [];
	}
	const { records } = readTornSafe(join(dir, qoderFile));
	return (records as { event?: unknown }[]).filter((r) => r.event === "qoder.delegate.refused");
}

/** Absolute path of the Qoder tool entry point this repository ships. */
const QODER_ENTRY = `${repoRoot()}/.pi/extensions/qoder/index.ts`;

/** The user-scope extension under test: the real Qoder entry point, no probe needed. */
const EXTENSION_SOURCE = [
	"// Generated for tests/integration/qoder-tool.test.ts. Lives in a temp dir.",
	`import qoder from ${JSON.stringify(QODER_ENTRY)};`,
	"",
	"export default function (pi) {",
	"\tqoder(pi);",
	"}",
].join("\n");

/** Every env var this file's own fixture might set, for a byte-precise restore. */
const QODER_ENV_KEYS = [QODER_TOKEN_ENV, QODER_AGENT_ID_ENV, QODER_ENVIRONMENT_ID_ENV, QODER_BASE_URL_ENV] as const;

/** Snapshot and clear every Qoder env var before a case, restore the ORIGINAL values (or absence) after it. */
let savedEnv: Partial<Record<(typeof QODER_ENV_KEYS)[number], string | undefined>> = {};

function clearQoderEnv(): void {
	savedEnv = {};
	for (const key of QODER_ENV_KEYS) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
}

afterEach(() => {
	for (const key of QODER_ENV_KEYS) {
		const value = savedEnv[key];
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
});

/** Fixture credential -- obviously fake, never dialled (see qoder-delegate.test.ts's own identical discipline). [threat T-05-23] */
const FIXTURE_TOKEN = "pt-kypi-qoder-tool-fixture-not-a-credential";
const FIXTURE_AGENT_ID = "agent-kypi-qoder-tool-fixture";
const FIXTURE_ENVIRONMENT_ID = "env-kypi-qoder-tool-fixture";

/** Set every Qoder env var to a valid-shaped fixture config pointed at `baseUrl`. */
function setConfiguredQoderEnv(baseUrl: string): void {
	process.env[QODER_TOKEN_ENV] = FIXTURE_TOKEN;
	process.env[QODER_AGENT_ID_ENV] = FIXTURE_AGENT_ID;
	process.env[QODER_ENVIRONMENT_ID_ENV] = FIXTURE_ENVIRONMENT_ID;
	process.env[QODER_BASE_URL_ENV] = baseUrl;
}

/** Replace `ctx.hasUI`/`ctx.ui` with stand-ins, via `defineProperty` -- see this file's own header. */
function withStubbedUI(
	ctx: ExtensionCommandContext,
	opts: { hasUI: boolean; select?: (message: string, choices: string[]) => Promise<string> },
): void {
	Object.defineProperty(ctx, "hasUI", { value: opts.hasUI, writable: true, configurable: true, enumerable: true });
	Object.defineProperty(ctx, "ui", {
		value: {
			select: opts.select ?? (async () => {
				throw new Error("withStubbedUI: select() called but no stub was provided for this case");
			}),
			notify: () => {},
			confirm: async () => false,
			input: async () => undefined,
		},
		writable: true,
		configurable: true,
		enumerable: true,
	});
}

describe("qoder_delegate tool -- WR-11/CR-01: the configuration gate", () => {
	// MEASURED, NOT ASSUMED (WR-04, iteration 3 -- the prior citation here named
	// the wrong mechanism): `createFauxSession`'s default `tools: []` becomes
	// `options.tools` on `createAgentSession`'s SDK options, which
	// `createAgentSession` maps to `allowedToolNames` [VERIFIED:
	// `dist/core/sdk.js:133`, `options.tools ?? (options.noTools === "all" ? []
	// : undefined)`] -- and even an EMPTY array is truthy in JS, so
	// `_refreshToolRegistry`'s `if (allowedToolNames)` arm
	// (`dist/core/agent-session.js:1996-2002`) takes precedence over the
	// `else if (options?.includeAllExtensionTools)` arm that would otherwise
	// auto-activate every newly-registered extension tool. So under this
	// harness's own default, `qoder_delegate` would NEVER appear in
	// `getActiveToolNames()` regardless of whether the fix under test exists
	// -- both cases below therefore start the session with
	// `tools: ["qoder_delegate"]` explicitly, simulating the REAL starting
	// condition a production session's own default would produce (a newly
	// registered tool starts active), so the fix's `pi.setActiveTools(...
	// filter(...))` call has something to actually act on.
	//
	// CR-01: `session_start` DOES NOT FIRE from `createFauxSession`'s headless
	// factory -- MEASURED, not assumed: `tests/integration/call-model.test.ts`'s
	// own header ("a five-event probe logged nothing before the first prompt")
	// and `tests/integration/mode-persistence.test.ts`'s own header ("Pi emits
	// `session_start` from `AgentSession`'s extension-binding step ... which the
	// headless factory this repository's test helpers use does not reach") both
	// document this. The configuration gate now lives in a `session_start`
	// handler (CR-01 -- it MUST, since `pi.getActiveTools()`/`setActiveTools()`
	// throw "not initialized" if called from the factory instead), so a case
	// that only calls `createFauxSession` and reads `getActiveToolNames()`
	// immediately would prove nothing about the handler ever running. Every
	// case below therefore calls `handle.session.extensionRunner.emit({ type:
	// "session_start", reason: "startup" })` -- `ExtensionRunner#emit<TEvent
	// extends RunnerEmitEvent>()` [VERIFIED: pi-coding-agent 0.84.1
	// `dist/core/extensions/runner.d.ts:146`; `SessionStartEvent` is NOT among
	// the types `RunnerEmitEvent` excludes at `:22`, so this is a genuinely
	// public, typed way to fire the same event Pi's own real extension-binding
	// step fires, deterministically and in-process] -- to invoke every
	// registered `session_start` handler for real, rather than merely asserting
	// about the handler's source code. This proves the WIRING (the handler is
	// really registered and really runs) together with the LOGIC (it really
	// filters the active list), the same "call the real mechanism, don't just
	// read the source" discipline `headless-deny.test.ts` uses for SAFE-10.
	it("is NOT in the active tool list, after session_start fires, when QODER_PERSONAL_ACCESS_TOKEN/AGENT_ID/ENVIRONMENT_ID are unset", async () => {
		clearQoderEnv();
		const handle: FauxSessionHandle = await createFauxSession({
			extensionSource: EXTENSION_SOURCE,
			tools: ["qoder_delegate"],
		});
		try {
			// CR-01 NON-VACUITY GUARD: the active-list absence assertion below is
			// satisfied identically by "the configuration gate deactivated it" and
			// by "the extension's factory threw and Pi discarded the whole
			// extension, so the tool never existed at all" -- which is exactly
			// what happened when the configuration gate lived in the factory
			// (CR-01), and is unaffected by whether session_start ever fires.
			// Asserting the tool DEFINITION exists FIRST -- BEFORE emitting
			// session_start -- rules out the second, wrong-for-the-right-reasons
			// explanation before the absence assertion is allowed to pass.
			const tool = handle.session.extensionRunner.getToolDefinition("qoder_delegate");
			expect(
				tool,
				"the extension failed to load at all (factory threw and Pi discarded it) -- the " +
					"active-tool-list absence assertion below would pass for the wrong reason",
			).toBeDefined();

			// Still active here: registerTool() defaults a newly-registered tool
			// to active, and the deactivation only happens once session_start
			// fires -- see this describe block's own header.
			expect(
				handle.session.getActiveToolNames(),
				"qoder_delegate is already inactive BEFORE session_start fired -- something deactivated " +
					"it too early, which this test cannot explain",
			).toContain("qoder_delegate");

			await handle.session.extensionRunner.emit({ type: "session_start", reason: "startup" });

			const active = handle.session.getActiveToolNames();
			expect(
				active,
				"qoder_delegate is STILL active after session_start fired, on an unconfigured machine -- " +
					"it costs its measured ~329 tokens on every provider request for no reason on a machine " +
					"that can only ever refuse",
			).not.toContain("qoder_delegate");
		} finally {
			await handle.dispose();
		}
	});

	it("IS in the active tool list, after session_start fires, when all three variables are configured", async () => {
		clearQoderEnv();
		setConfiguredQoderEnv(DEFAULT_QODER_BASE_URL);
		const handle: FauxSessionHandle = await createFauxSession({
			extensionSource: EXTENSION_SOURCE,
			tools: ["qoder_delegate"],
		});
		try {
			await handle.session.extensionRunner.emit({ type: "session_start", reason: "startup" });

			const active = handle.session.getActiveToolNames();
			expect(
				active,
				"qoder_delegate is inactive despite a fully configured machine -- the configuration gate " +
					"over-refuses",
			).toContain("qoder_delegate");
		} finally {
			await handle.dispose();
		}
	});
});

describe("qoder_delegate tool -- WR-11: the human-in-the-loop confirmation gate", () => {
	it("declines (throws, never calls delegateTask) when the user does not select the delegate choice", async () => {
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({}, async (loop) => {
				clearQoderEnv();
				setConfiguredQoderEnv(loop.baseUrl);

				const handle = await createFauxSession({
					extensionSource: EXTENSION_SOURCE,
					responses: [fauxAssistantMessage("unused", { stopReason: "stop" })],
				});
				try {
					const tool = handle.session.extensionRunner.getToolDefinition("qoder_delegate");
					expect(tool, 'getToolDefinition("qoder_delegate") returned undefined').toBeDefined();
					if (tool === undefined) {
						return;
					}

					const ctx = handle.session.extensionRunner.createCommandContext();
					let selectCallCount = 0;
					withStubbedUI(ctx, {
						hasUI: true,
						select: async () => {
							selectCallCount += 1;
							return "Cancel"; // anything other than the delegate choice
						},
					});

					await expect(
						tool.execute("call-1", { task: "summarise the open PRs" }, undefined, undefined, ctx),
					).rejects.toThrow(/declined by the user/);

					expect(selectCallCount, "ctx.ui.select was never called -- the confirmation gate did not run at all").toBe(1);
					// THE LOAD-BEARING ASSERTION: zero requests reached the loopback --
					// a decline must refuse BEFORE delegateTask ever opens a socket.
					expect(loop.received).toHaveLength(0);

					// WR-03: the decline branch must ALSO write an audit record --
					// before this fix, this was the only decision point in the phase
					// with no record on any branch.
					const confirmRecords = readConfirmRecords(handle.cwd);
					expect(
						confirmRecords,
						"no qoder.delegate.confirm record was written for a DECLINED delegation",
					).toHaveLength(1);
					expect(confirmRecords[0]?.approved).toBe(false);
					expect(confirmRecords[0]?.hasUI).toBe(true);
				} finally {
					await handle.dispose();
				}
			});
		});
	});

	it("declines (throws, naming the missing UI) when hasUI is false, e.g. headless / -p mode", async () => {
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({}, async (loop) => {
				clearQoderEnv();
				setConfiguredQoderEnv(loop.baseUrl);

				const handle = await createFauxSession({
					extensionSource: EXTENSION_SOURCE,
					responses: [fauxAssistantMessage("unused", { stopReason: "stop" })],
				});
				try {
					const tool = handle.session.extensionRunner.getToolDefinition("qoder_delegate");
					expect(tool).toBeDefined();
					if (tool === undefined) {
						return;
					}

					const ctx = handle.session.extensionRunner.createCommandContext();
					withStubbedUI(ctx, { hasUI: false });

					await expect(
						tool.execute("call-1", { task: "summarise the open PRs" }, undefined, undefined, ctx),
					).rejects.toThrow(/no UI bound/);

					expect(loop.received).toHaveLength(0);
				} finally {
					await handle.dispose();
				}
			});
		});
	});

	it("WR-04: refuses an over-limit task BEFORE the confirmation prompt -- ctx.ui.select is never called", async () => {
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({}, async (loop) => {
				clearQoderEnv();
				setConfiguredQoderEnv(loop.baseUrl);

				const handle = await createFauxSession({
					extensionSource: EXTENSION_SOURCE,
					responses: [fauxAssistantMessage("unused", { stopReason: "stop" })],
				});
				try {
					const tool = handle.session.extensionRunner.getToolDefinition("qoder_delegate");
					expect(tool).toBeDefined();
					if (tool === undefined) {
						return;
					}

					const ctx = handle.session.extensionRunner.createCommandContext();
					let selectCallCount = 0;
					withStubbedUI(ctx, {
						hasUI: true,
						select: async () => {
							selectCallCount += 1;
							return "Delegate to Qoder";
						},
					});

					const overLimitTask = "x".repeat(MAX_TASK_CHARS + 1);
					await expect(
						tool.execute("call-1", { task: overLimitTask }, undefined, undefined, ctx),
					).rejects.toThrow(new RegExp(`1\\.\\.${MAX_TASK_CHARS} characters`));

					// THE LOAD-BEARING ASSERTION: WR-04's whole point is that the
					// validation now runs BEFORE the human decision -- an unbounded
					// task must never even reach ctx.ui.select, let alone the network.
					expect(
						selectCallCount,
						"ctx.ui.select was called for an over-limit task -- WR-04's validation must run " +
							"BEFORE the confirmation prompt, not after",
					).toBe(0);
					expect(loop.received).toHaveLength(0);
				} finally {
					await handle.dispose();
				}
			});
		});
	});

	it("WR-01: flattens a newline-stuffed task to one line before it reaches the confirmation dialog", async () => {
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({}, async (loop) => {
				clearQoderEnv();
				setConfiguredQoderEnv(loop.baseUrl);

				const handle = await createFauxSession({
					extensionSource: EXTENSION_SOURCE,
					responses: [fauxAssistantMessage("unused", { stopReason: "stop" })],
				});
				try {
					const tool = handle.session.extensionRunner.getToolDefinition("qoder_delegate");
					expect(tool).toBeDefined();
					if (tool === undefined) {
						return;
					}

					const ctx = handle.session.extensionRunner.createCommandContext();
					let capturedTitle: string | undefined;
					withStubbedUI(ctx, {
						hasUI: true,
						select: async (message) => {
							capturedTitle = message;
							return "Cancel"; // decline -- this case only proves the DIALOG SHAPE
						},
					});

					// Newlines placed in the MIDDLE (never leading/trailing, so
					// `task.trim()` cannot remove them) used to add one dialog line
					// each -- see this file's own module header and WR-01 in
					// `.pi/extensions/qoder/index.ts`. Kept under
					// CONFIRM_EXCERPT_CHARS so truncation never hides the tail.
					const newlineStuffedTask = `${"a".repeat(50)}${"\n".repeat(100)}walk the dog`;
					await expect(
						tool.execute("call-1", { task: newlineStuffedTask }, undefined, undefined, ctx),
					).rejects.toThrow(/declined by the user/);

					expect(capturedTitle, "select() was never called").toBeDefined();
					const titleLineCount = (capturedTitle ?? "").split("\n").length;
					expect(
						titleLineCount,
						"the confirmation dialog title grew past a handful of lines for a " +
							"newline-stuffed task -- WR-01's flattening did not run",
					).toBeLessThanOrEqual(10);
					// The flattened excerpt must still be present so the user can read
					// what they are approving.
					expect(capturedTitle).toContain("walk the dog");
				} finally {
					await handle.dispose();
				}
			});
		});
	});

	it("proceeds to delegateTask (a real request reaches the loopback) when the user selects the delegate choice", async () => {
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({}, async (loop) => {
				clearQoderEnv();
				setConfiguredQoderEnv(loop.baseUrl);

				const handle = await createFauxSession({
					extensionSource: EXTENSION_SOURCE,
					responses: [fauxAssistantMessage("unused", { stopReason: "stop" })],
				});
				try {
					const tool = handle.session.extensionRunner.getToolDefinition("qoder_delegate");
					expect(tool).toBeDefined();
					if (tool === undefined) {
						return;
					}

					const ctx = handle.session.extensionRunner.createCommandContext();
					withStubbedUI(ctx, { hasUI: true, select: async () => "Delegate to Qoder" });

					const result = await tool.execute(
						"call-1",
						{ task: "summarise the open PRs" },
						undefined,
						undefined,
						ctx,
					);

					// Non-vacuity: an approval that never reached the network would
					// satisfy "did not throw" just as well as a working approval path.
					expect(
						loop.received.length,
						"approving the confirmation did not result in any request reaching the loopback -- " +
							"delegateTask was never actually invoked",
					).toBeGreaterThan(0);
					expect(result.content.some((block) => block.type === "text")).toBe(true);

					// WR-03: the approve branch must ALSO write an audit record, with
					// the SAME event name as the decline branch, distinguished only by
					// `approved`.
					const confirmRecords = readConfirmRecords(handle.cwd);
					expect(
						confirmRecords,
						"no qoder.delegate.confirm record was written for an APPROVED delegation",
					).toHaveLength(1);
					expect(confirmRecords[0]?.approved).toBe(true);
					expect(confirmRecords[0]?.hasUI).toBe(true);
				} finally {
					await handle.dispose();
				}
			});
		});
	});
});

describe("qoder_delegate tool -- WR-02: the two previously-silent refusal branches now write a record", () => {
	it("writes a qoder.delegate.refused record (cause: unconfigured) when the config gate refuses at call time", async () => {
		await withTempLogCwd(async (cwd) => {
			clearQoderEnv(); // deliberately unconfigured

			const handle = await createFauxSession({
				extensionSource: EXTENSION_SOURCE,
				responses: [fauxAssistantMessage("unused", { stopReason: "stop" })],
			});
			try {
				const tool = handle.session.extensionRunner.getToolDefinition("qoder_delegate");
				expect(tool).toBeDefined();
				if (tool === undefined) {
					return;
				}

				const ctx = handle.session.extensionRunner.createCommandContext();
				withStubbedUI(ctx, { hasUI: true });

				await expect(
					tool.execute("call-1", { task: "summarise the open PRs" }, undefined, undefined, ctx),
				).rejects.toThrow(); // resolveQoderConfig's own actionable message

				// Before WR-02 this branch left ZERO trace anywhere.
				const refused = readRefusedRecords(handle.cwd);
				expect(
					refused,
					"no qoder.delegate.refused record was written for the unconfigured refusal",
				).toHaveLength(1);
				expect(refused[0]?.cause).toBe("unconfigured");
			} finally {
				await handle.dispose();
			}
		});
	});

	it("writes a qoder.delegate.refused record (cause: task-length) for an over-limit task, before the confirmation prompt", async () => {
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({}, async (loop) => {
				clearQoderEnv();
				setConfiguredQoderEnv(loop.baseUrl);

				const handle = await createFauxSession({
					extensionSource: EXTENSION_SOURCE,
					responses: [fauxAssistantMessage("unused", { stopReason: "stop" })],
				});
				try {
					const tool = handle.session.extensionRunner.getToolDefinition("qoder_delegate");
					expect(tool).toBeDefined();
					if (tool === undefined) {
						return;
					}

					const ctx = handle.session.extensionRunner.createCommandContext();
					withStubbedUI(ctx, { hasUI: true });

					const overLimitTask = "x".repeat(MAX_TASK_CHARS + 1);
					await expect(
						tool.execute("call-1", { task: overLimitTask }, undefined, undefined, ctx),
					).rejects.toThrow(new RegExp(`1\\.\\.${MAX_TASK_CHARS} characters`));

					// Before WR-02 this branch -- the one an adversarial or looping
					// model hits repeatedly -- left ZERO trace anywhere.
					const refused = readRefusedRecords(handle.cwd);
					expect(
						refused,
						"no qoder.delegate.refused record was written for the task-length refusal",
					).toHaveLength(1);
					expect(refused[0]?.cause).toBe("task-length");
					expect(refused[0]?.taskChars).toBe(overLimitTask.length);
					expect(loop.received).toHaveLength(0);
				} finally {
					await handle.dispose();
				}
			});
		});
	});
});
