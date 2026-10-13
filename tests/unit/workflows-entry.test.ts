/**
 * `/quick`'s entry-point SHAPE, and WR-04's `session_start` wiring, checked
 * offline against a recording stub of `ExtensionAPI` -- mirrors
 * `tests/unit/safety-entry.test.ts`'s `stubPi()` pattern.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `quick-workflow.test.ts`. Per
 * `.pi/extensions/routing/index.ts`'s own docstring, `session_start` does
 * NOT fire in a headless `createAgentSession` -- the mechanism every
 * `tests/integration/*.test.ts` session-level fixture uses. WR-04's fix
 * (`pi.on("session_start", ...)` wiring `pruneEvidenceLogs`) is therefore
 * unreachable from a session-level test; this file drives the REGISTERED
 * handler directly, offline, in milliseconds, the same way
 * `safety-entry.test.ts` proves its own `session_start` retention hook.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { describe, expect, it } from "vitest";

import { logDir } from "../../.pi/lib/jsonl.ts";
import workflows from "../../.pi/extensions/workflows/index.ts";
import { endRun, isRunArmed, isRunPending, recordToolResult, startRun } from "../../.pi/extensions/workflows/evidence.ts";
import { armQuickSettle, notePrompt, settleQuickRun } from "../../.pi/extensions/workflows/settle.ts";
import { currentSha, currentTree } from "../../.pi/extensions/safety/git.ts";
import { commitFile, makeTempRepo } from "../helpers/git.ts";
import { logFilesIn, withTempLogCwd } from "../helpers/logs.ts";

/** A recording stub of exactly the `ExtensionAPI` surface `workflows/index.ts` touches. */
function stubPi(): {
	pi: ExtensionAPI;
	hooks: string[];
	commandNames: string[];
	handlers: Map<string, (...args: unknown[]) => unknown>;
} {
	const hooks: string[] = [];
	const commandNames: string[] = [];
	const handlers = new Map<string, (...args: unknown[]) => unknown>();

	const pi = {
		on(event: string, handler: (...args: unknown[]) => unknown) {
			hooks.push(event);
			handlers.set(event, handler);
		},
		registerCommand(name: string) {
			commandNames.push(name);
		},
	} as unknown as ExtensionAPI;

	return { pi, hooks, commandNames, handlers };
}

describe("/quick's entry point registers exactly what it claims to", () => {
	const { pi, hooks, commandNames } = stubPi();
	workflows(pi);

	it("registers exactly one command: quick", () => {
		expect(commandNames).toEqual(["quick"]);
	});

	it("registers exactly five hooks: input, before_agent_start, tool_execution_end, agent_settled, session_start", () => {
		expect(
			hooks,
			"an extra hook here is new surface this test did not expect; a missing session_start means " +
				"WR-04's retention wiring silently stopped registering, tool_result instead of " +
				"tool_execution_end means CR-01 iteration 3's capture-point move regressed, and a missing " +
				"input/before_agent_start lets an unrelated turn settle a run whose prompt never started",
		).toEqual(["input", "before_agent_start", "tool_execution_end", "agent_settled", "session_start"]);
	});
});

describe("a run is bound to the prompt that starts it", () => {
	const record = { ts: 0, toolName: "bash", command: "x", isError: false, sha: "s" };

	it("records nothing until its own prompt starts, then records", () => {
		startRun(".", "base", "tree", "do the task");
		expect(isRunPending()).toBe(true);
		recordToolResult(record);
		notePrompt("do the task", false);
		expect(isRunPending(), "input alone is not a start").toBe(true);
		notePrompt("do the task", true);
		expect(isRunPending()).toBe(false);
		recordToolResult(record);
		expect(endRun("", "")?.run.recordCount).toBe(1);
	});

	it("a different prompt reaching input or before_agent_start first disarms the pending run", () => {
		for (const starting of [false, true]) {
			startRun(".", "base", "tree", "do the task");
			notePrompt("hi, what's the status", starting);
			expect(isRunArmed(), `starting=${starting}`).toBe(false);
		}
	});

	it("a started run ignores later prompts, such as a steer typed mid-run", () => {
		startRun(".", "base", "tree", "do the task");
		notePrompt("do the task", true);
		notePrompt("also fix the typo", false);
		expect(isRunArmed()).toBe(true);
		endRun("", "");
	});
});

describe("WR-04 -- the registered session_start handler actually prunes the evidence stream", () => {
	it("deletes an aged evidence-*.jsonl file when the captured handler is invoked directly", async () => {
		const { pi, handlers } = stubPi();
		workflows(pi);
		const sessionStartHandler = handlers.get("session_start");
		expect(sessionStartHandler, "the session_start hook must have registered").toBeDefined();

		await withTempLogCwd(async (cwd) => {
			const dir = logDir(cwd);
			mkdirSync(dir, { recursive: true });
			// Far older than pruneEvidenceLogs's default 14-day retention window.
			const agedFile = join(dir, "evidence-2000-01-01.jsonl");
			writeFileSync(agedFile, `${JSON.stringify({ event: "workflows.evidence", verdict: "accept" })}\n`, "utf-8");
			expect(logFilesIn(dir), "the fixture file must exist before the handler runs").toContain("evidence-2000-01-01.jsonl");

			const fakeCtx = { cwd } as unknown as ExtensionContext;
			await (sessionStartHandler as (...args: unknown[]) => unknown)(undefined, fakeCtx);

			expect(
				logFilesIn(dir),
				"WR-04: the aged evidence log must have been deleted by pruneEvidenceLogs, called from the " +
					"REAL registered session_start handler -- without the fix this file survives forever",
			).not.toContain("evidence-2000-01-01.jsonl");
		});
	});
});

describe("WR-02 (iteration 3) -- the registered session_start handler disarms a run orphaned before agent_settled", () => {
	it("frees a run left armed by a prior session that never reached agent_settled", async () => {
		const { pi, handlers } = stubPi();
		workflows(pi);
		const sessionStartHandler = handlers.get("session_start");
		expect(sessionStartHandler, "the session_start hook must have registered").toBeDefined();

		await withTempLogCwd(async (cwd) => {
			startRun(cwd, "fixture-base-sha", "fixture-base-tree");
			expect(isRunArmed(), "the fixture must actually arm a run, or this test proves nothing").toBe(true);

			const fakeCtx = { cwd } as unknown as ExtensionContext;
			await (sessionStartHandler as (...args: unknown[]) => unknown)(undefined, fakeCtx);

			expect(
				isRunArmed(),
				"WR-02 (iteration 3): an orphaned run must be freed by the REAL registered session_start " +
					"handler -- without endRun(''), a new session inherits a permanently armed slot",
			).toBe(false);
		});
	});
});

describe("/quick's command handler is a real async function (vacuous-pass guard for the stub above)", () => {
	it("the quick command's handler is callable", () => {
		const { pi } = stubPi();
		const commands = new Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
		const recordingPi = {
			...pi,
			registerCommand(name: string, def: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) {
				commands.set(name, def);
			},
		} as unknown as ExtensionAPI;
		workflows(recordingPi);
		expect(typeof commands.get("quick")?.handler).toBe("function");
	});
});

describe("settleQuickRun", () => {
	it("an aborted settle disarms the run without a verdict, a notification or an evidence row", () => {
		const repo = makeTempRepo("quick-abort-");
		commitFile(repo, "seed.txt", "seed", "seed");
		const base = currentSha(repo);
		startRun(repo, base, currentTree(repo));
		armQuickSettle({ baseSha: base, baseTypecheckFailed: false });
		commitFile(repo, "a.txt", "a", "change");
		const notes: string[] = [];
		settleQuickRun({ fallbackCwd: repo, projectTrusted: false, aborted: true, notify: (t) => void notes.push(t) });
		expect(isRunArmed()).toBe(false);
		expect(notes).toHaveLength(0);
		expect(logFilesIn(logDir(repo))).toEqual([]);
	});

	it("a settle with nothing armed does nothing", () => {
		const notes: string[] = [];
		settleQuickRun({ fallbackCwd: ".", projectTrusted: false, aborted: false, notify: (t) => void notes.push(t) });
		expect(notes).toHaveLength(0);
	});
});
