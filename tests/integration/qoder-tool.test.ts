/**
 * The registered qoder_delegate TOOL (qoder-delegate.test.ts drives the client directly): a human confirmation gate in
 * interactive mode, and a configuration gate that deactivates the tool on an unconfigured machine. The gate runs in a
 * session_start handler reading process.env, so env is set before the session and restored after. `ctx.hasUI`/`ctx.ui`
 * are getter-only accessors, so they are stubbed with defineProperty.
 */
import { join } from "node:path";

import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

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

/** The `qoder.delegate.confirm` records, written under the session's own cwd (`ctx.cwd`). */
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

/** The silent refusal branches' `qoder.delegate.refused` records, from the same writer and file; never the task text. */
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

/** Fixture credential: obviously fake, never dialled. */
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

/** Replaces `ctx.hasUI`/`ctx.ui` with stand-ins via defineProperty (getter-only accessors). */
function withStubbedUI(
	ctx: ExtensionContext,
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
	// `tools: []` maps to allowedToolNames, which wins over includeAllExtensionTools (pi dist/core/sdk.js:133), so these
	// cases start with `tools: ["qoder_delegate"]`, as a production session would. session_start does not fire headless,
	// so each case emits it through ExtensionRunner#emit to run the real handler.
	it("is NOT in the active tool list, after session_start fires, when QODER_PERSONAL_ACCESS_TOKEN/AGENT_ID/ENVIRONMENT_ID are unset", async () => {
		clearQoderEnv();
		const handle: FauxSessionHandle = await createFauxSession({
			extensionSource: EXTENSION_SOURCE,
			tools: ["qoder_delegate"],
		});
		try {
			// Non-vacuity: the definition must exist first, or a factory that threw would satisfy the absence below.
			const tool = handle.session.extensionRunner.getToolDefinition("qoder_delegate");
			expect(
				tool,
				"the extension failed to load at all (factory threw and Pi discarded it) -- the " +
					"active-tool-list absence assertion below would pass for the wrong reason",
			).toBeDefined();

			// Still active: deactivation happens only once session_start fires.
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

					const ctx = handle.session.extensionRunner.createToolContext("qoder-test-call", undefined);
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
					// Zero requests reached the loopback: a decline refuses before delegateTask opens a socket.
					expect(loop.received).toHaveLength(0);

					// The decline branch writes an audit record too.
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

					const ctx = handle.session.extensionRunner.createToolContext("qoder-test-call", undefined);
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

					const ctx = handle.session.extensionRunner.createToolContext("qoder-test-call", undefined);
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

					// Validation runs before the human decision: an unbounded task never reaches ctx.ui.select.
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

					const ctx = handle.session.extensionRunner.createToolContext("qoder-test-call", undefined);
					let capturedTitle: string | undefined;
					withStubbedUI(ctx, {
						hasUI: true,
						select: async (message) => {
							capturedTitle = message;
							return "Cancel"; // decline -- this case only proves the DIALOG SHAPE
						},
					});

					// Mid-task newlines (trim cannot remove them) would each add a dialog line; kept under CONFIRM_EXCERPT_CHARS so
					// truncation never hides the tail.
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
					// The flattened excerpt must still be readable.
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

					const ctx = handle.session.extensionRunner.createToolContext("qoder-test-call", undefined);
					withStubbedUI(ctx, { hasUI: true, select: async () => "Delegate to Qoder" });

					const result = await tool.execute(
						"call-1",
						{ task: "summarise the open PRs" },
						undefined,
						undefined,
						ctx,
					);

					// Non-vacuity: an approval that never reached the network would also not throw.
					expect(
						loop.received.length,
						"approving the confirmation did not result in any request reaching the loopback -- " +
							"delegateTask was never actually invoked",
					).toBeGreaterThan(0);
					expect(result.content.some((block) => block.type === "text")).toBe(true);

					// The approve branch writes the same event as the decline, distinguished only by `approved`.
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

				const ctx = handle.session.extensionRunner.createToolContext("qoder-test-call", undefined);
				withStubbedUI(ctx, { hasUI: true });

				await expect(
					tool.execute("call-1", { task: "summarise the open PRs" }, undefined, undefined, ctx),
				).rejects.toThrow(); // resolveQoderConfig's own actionable message

				// This branch must leave a trace.
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

					const ctx = handle.session.extensionRunner.createToolContext("qoder-test-call", undefined);
					withStubbedUI(ctx, { hasUI: true });

					const overLimitTask = "x".repeat(MAX_TASK_CHARS + 1);
					await expect(
						tool.execute("call-1", { task: overLimitTask }, undefined, undefined, ctx),
					).rejects.toThrow(new RegExp(`1\\.\\.${MAX_TASK_CHARS} characters`));

					// The branch an adversarial or looping model hits repeatedly must leave a trace.
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
