/**
 * The safety extension's registration shape, offline against a recording ExtensionAPI stub: what is registered, in what
 * order, with what schema. Enforcement against a real session is tests/integration/double-enforcement.test.ts.
 * Source order is asserted textually because tool-name collisions resolve first-registration-wins.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

import { describe, expect, it } from "vitest";

import { logPath } from "../../.pi/lib/jsonl.ts";
import { approve, createPending, peek } from "../../.pi/extensions/safety/approvals.ts";
import safety, { APPROVE_TOOL_NAME } from "../../.pi/extensions/safety/index.ts";
import { AUDIT_LOG_BASE, type AuditRow } from "../../.pi/extensions/safety/schema.ts";
import { repoRoot } from "../helpers/git.ts";
import { readJsonl, withTempLogCwd } from "../helpers/logs.ts";

/** Absolute path of the file under test, read once for the source-order and grep assertions. */
const ENTRY_PATH = join(repoRoot(), ".pi", "extensions", "safety", "index.ts");

/** A recording stub of exactly the `ExtensionAPI` surface this file touches. */
function stubPi(): {
	pi: ExtensionAPI;
	hooks: string[];
	toolNames: string[];
	tools: Map<string, ToolDefinition<never, unknown>>;
	/** The real handler registered for each event, so a test can invoke `tool_call` directly. */
	handlers: Map<string, (...args: unknown[]) => unknown>;
} {
	const hooks: string[] = [];
	const toolNames: string[] = [];
	const tools = new Map<string, ToolDefinition<never, unknown>>();
	const handlers = new Map<string, (...args: unknown[]) => unknown>();

	const pi = {
		on(event: string, handler: (...args: unknown[]) => unknown) {
			hooks.push(event);
			handlers.set(event, handler);
		},
		registerTool(tool: ToolDefinition<never, unknown>) {
			toolNames.push(tool.name);
			tools.set(tool.name, tool);
		},
	} as unknown as ExtensionAPI;

	return { pi, hooks, toolNames, tools, handlers };
}

describe("the safety extension's entry point registers exactly what it claims to", () => {
	// The default export has no process-wide idempotency guard, so each fresh stub fully registers.
	const { pi, hooks, toolNames, tools } = stubPi();
	safety(pi);

	it("registers exactly four wrapped tools plus approve_ky_command, in that order (WR-09: grep/find/ls stay unwrapped)", () => {
		expect(
			toolNames,
			"the four built-in wrappers, then approve_ky_command -- see the module docstring's " +
				"REGISTRATION ORDER section. WR-09: grep/find/ls are deliberately NOT registered here -- " +
				"wrapping them would ACTIVATE three tools Pi does not activate by default " +
				"(registerWrappedTools's own WR-09 docstring section), at a real per-turn token cost. " +
				"They are still governed by policy.ts#evaluate() and audited/denied by the tool_call " +
				"hook's own filter if ever activated some other way. If this list changes, a later plan " +
				"is adding or removing a tool and this assertion should grow with it, not be deleted",
		).toEqual(["bash", "read", "write", "edit", "approve_ky_command"]);
	});

	it("registers exactly three hooks: tool_call, session_start and session_shutdown", () => {
		expect(
			hooks,
			"an extra hook here is new surface this test did not expect; a missing one means the " +
				"guard or the retention job silently stopped registering",
		).toEqual(["tool_call", "session_start", "session_shutdown"]);
	});

	it("names APPROVE_TOOL_NAME consistently with what was actually registered", () => {
		expect(
			toolNames,
			"the exported constant and the real registration must agree, or a test importing the " +
				"constant would silently check the wrong tool name forever",
		).toContain(APPROVE_TOOL_NAME);
	});

	it("registers approve_ky_command with no promptSnippet and no promptGuidelines", () => {
		const approveTool = tools.get(APPROVE_TOOL_NAME);
		expect(approveTool, "approve_ky_command must have been captured by the stub above").toBeDefined();

		expect(
			(approveTool as unknown as { promptSnippet?: unknown }).promptSnippet,
			"CONTRIBUTING.md's corollary: a promptSnippet on a lazily-loaded tool rebuilds the " +
				"system prompt and invalidates the provider cache prefix the moment the tool activates",
		).toBeUndefined();
		expect(
			(approveTool as unknown as { promptGuidelines?: unknown }).promptGuidelines,
			"same corollary, for promptGuidelines",
		).toBeUndefined();
	});

	it("gives approve_ky_command a parameter schema requiring request_id, command, reason, summary, blast_radius", () => {
		const approveTool = tools.get(APPROVE_TOOL_NAME);
		const schema = approveTool?.parameters as unknown as { required?: string[]; properties?: Record<string, unknown> };

		expect(
			schema.required?.slice().sort(),
			"the approval protocol's byte-for-byte check (approvals.ts#validate) needs request_id, " +
				"command and reason; summary and blast_radius are what a human approver reads",
		).toEqual(["blast_radius", "command", "reason", "request_id", "summary"]);
	});
});

describe("the safety extension's source order matches its own documented guarantee", () => {
	const source = readFileSync(ENTRY_PATH, "utf-8");

	it("finds every registration call this test asserts on (guards against a vacuous pass)", () => {
		expect(
			source.includes("registerWrappedTools(pi)") &&
				source.includes("registerApprovalTool(pi)") &&
				source.includes("registerToolCallHook(pi)"),
			"the default export's own body must call all three of these by name, or the ordering " +
				"assertion below would compare indices that do not exist and silently pass at -1 === -1",
		).toBe(true);
	});

	it("calls registerWrappedTools and registerApprovalTool before registerToolCallHook, textually", () => {
		const wrappedIdx = source.indexOf("registerWrappedTools(pi)");
		const approvalIdx = source.indexOf("registerApprovalTool(pi)");
		// The last call is the full registration path; an earlier one is the hook-only second load.
		const hookIdx = source.lastIndexOf("registerToolCallHook(pi)");

		expect(wrappedIdx).toBeGreaterThan(-1);
		expect(approvalIdx).toBeGreaterThan(-1);
		expect(hookIdx).toBeGreaterThan(-1);

		expect(
			wrappedIdx < hookIdx,
			"tool-name collisions across extensions are first-registration-wins " +
				"(dist/core/extensions/runner.js:280-291) -- this file's own wrapped-tool registrations " +
				"must precede its tool_call hook registration in source order",
		).toBe(true);
		expect(approvalIdx < hookIdx, "approve_ky_command's registration must also precede the hook").toBe(true);
	});

	it("contains createBashTool, createReadTool, createWriteTool, createEditTool", () => {
		for (const factory of ["createBashTool", "createReadTool", "createWriteTool", "createEditTool"]) {
			expect(source.includes(factory), `expected ${factory} to appear in ${ENTRY_PATH}`).toBe(true);
		}
	});

	it("calls evaluate( at least twice -- once for the hook path, once for the wrapper path", () => {
		const matches = source.match(/\bevaluate\(/g) ?? [];
		expect(
			matches.length,
			"classifyAtWrapper() is the single call site that invokes evaluate(, reused by both the " +
				"hook and every wrapped tool's execute() -- at least ONE occurrence of the literal call " +
				"is required for either enforcement layer to exist at all",
		).toBeGreaterThanOrEqual(1);
	});

	it("calls writeAuditRow on more than one distinct verdict path (allow and block both present)", () => {
		const matches = source.match(/\bwriteAuditRow\(/g) ?? [];
		expect(
			matches.length,
			"the hook, the wrapper outcome, and approve_ky_command each write audit rows on multiple " +
				"branches -- a single occurrence would mean only one of allow/block/confirm is audited",
		).toBeGreaterThan(1);

		expect(source.includes('verdict: "allow"'), "at least one call site must write an allow row").toBe(true);
		expect(source.includes('verdict: "block"'), "at least one call site must write a block row").toBe(true);
	});

	/** Code only: the entry file's own comments quote the patterns counted below. */
	const codeOnly = source
		.split("\n")
		.filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
		.join("\n");

	it("finds a non-trivial amount of code once comment lines are stripped (guards against a vacuous pass)", () => {
		expect(
			codeOnly.length,
			"if comment-stripping ate the whole file, every assertion below would pass over nothing",
		).toBeGreaterThan(1000);
	});

	it("calls ctx.ui.confirm( exactly once in code, behind canConfirm for both the push ask and subagent management", () => {
		expect(
			(codeOnly.match(/ctx\.ui\.confirm\(/g) ?? []).length,
			"infra confirmations go block -> approval-tool -> re-issue; the one inline dialog helper serves the git push ask and subagent management",
		).toBe(1);
		expect((codeOnly.match(/askUser\(ctx,/g) ?? []).length, "both inline dialogs go through askUser").toBe(2);
		const askBranch = codeOnly.slice(codeOnly.indexOf('if (verdict.kind === "ask") {'));
		expect(askBranch, "the push dialog must sit behind the canConfirm gate").toContain("!canConfirm(ctx)");
		expect(codeOnly, "canConfirm admits only a UI in tui or rpc mode").toContain('ctx.hasUI && (ctx.mode === "tui" || ctx.mode === "rpc")');
	});

	it("calls ctx.ui.select( exactly once in code, inside approve_ky_command's own execute()", () => {
		const matches = codeOnly.match(/ctx\.ui\.select\(/g) ?? [];
		expect(
			matches.length,
			"the ONLY place this file may drive a real UI prompt is approve_ky_command's execute(), " +
				"gated behind ctx.hasUI -- the tool_call hook must never call it",
		).toBe(1);
	});
});

/** Garbage input (a non-string command) still yields one block decision, never a fall-through to the real tool. */
describe("a wrapped tool never delegates to the real implementation on a non-allow verdict", () => {
	it("throws instead of running the real bash tool when the command field is malformed", async () => {
		const { pi, tools } = stubPi();
		safety(pi);

		const bashTool = tools.get("bash");
		expect(bashTool, "the bash wrapper must have registered").toBeDefined();

		// A temp cwd: writeAuditRow really appends under <cwd>/.pi/logs.
		await withTempLogCwd(async (cwd) => {
			const fakeCtx = { cwd, hasUI: false } as unknown as ExtensionContext;

			await expect(
				(bashTool as unknown as { execute: (...args: unknown[]) => Promise<unknown> }).execute(
					"call-1",
					{ command: 12345 },
					undefined,
					undefined,
					fakeCtx,
				),
			).rejects.toThrow(/malformed/);
		});
	});
});

/**
 * /reload calls the factory again with a fresh api in the same process (pi dist/core/agent-session.js:2052), so every
 * invocation must fully register. The double-load hazard is prevented by bootstrap's generated stub instead.
 */
describe("CR-06 -- the entry point has no process-wide idempotency guard: it re-registers fully on every invocation (models /reload)", () => {
	it("two invocations of the default export, against two FRESH pi objects, BOTH fully register", () => {
		const first = stubPi();
		safety(first.pi);
		expect(
			first.toolNames.length,
			"the first invocation must have registered the full tool set, or this test proves nothing",
		).toBeGreaterThan(0);
		expect(
			first.hooks.length,
			"the first invocation must have registered its hooks, or this test proves nothing",
		).toBeGreaterThan(0);

		// A second fresh stub, as /reload hands the factory: a process-wide flag cannot tell this from a double load.
		const second = stubPi();
		safety(second.pi);
		expect(
			second.toolNames,
			"CR-06: a second invocation in the SAME process, against a fresh pi object, must register " +
				"the FULL tool set -- this is what /reload needs. A globalThis-keyed 'already installed' " +
				"flag would make this array empty, which is the exact regression this test catches",
		).toEqual(first.toolNames);
		expect(second.hooks, "the second invocation's own hooks array must also fully register").toEqual(first.hooks);
	});
});

/**
 * approve_ky_command's own execute() approves only on an explicit selection: headless, "Deny" and an undefined select()
 * must each throw AND leave no grant (a throw after a recorded grant would not be a deny).
 */
describe("WR-11 -- approve_ky_command.execute() denies by default on every non-affirmative branch (T-04-03)", () => {
	/** Seed a real pending approval, then drive approve_ky_command's own execute() against it under the given UI shape. */
	async function driveApproval(uiShape: {
		hasUI: boolean;
		mode?: string;
		select?: (title: string, options: string[], opts?: { timeout?: number }) => Promise<string | undefined>;
	}): Promise<{ threw: boolean; grantExistsAfter: boolean }> {
		const { pi, tools } = stubPi();
		safety(pi);
		const approveTool = tools.get(APPROVE_TOOL_NAME);
		expect(approveTool, "approve_ky_command must have registered").toBeDefined();

		const requestKey = `wr-11-test-request-key-${Math.random()}`;
		const command = "terraform apply";
		const reason = "cannot be trivially undone";
		const requestId = createPending(requestKey, command, reason);

		let threw = false;
		await withTempLogCwd(async (cwd) => {
			const fakeCtx = {
				cwd,
				hasUI: uiShape.hasUI,
				mode: uiShape.mode ?? "tui",
				ui: uiShape.select === undefined ? undefined : { select: uiShape.select },
			} as unknown as ExtensionContext;

			try {
				await (approveTool as unknown as { execute: (...args: unknown[]) => Promise<unknown> }).execute(
					"call-1",
					{ request_id: requestId, command, reason, summary: "WR-11 test", blast_radius: "low" },
					undefined,
					undefined,
					fakeCtx,
				);
			} catch {
				threw = true;
			}
		});

		return { threw, grantExistsAfter: peek(requestKey) };
	}

	it("hasUI: false (headless) -- refused, and no grant is created for the retry to find", async () => {
		const { threw, grantExistsAfter } = await driveApproval({ hasUI: false });
		expect(threw, "execute() must throw when no UI is bound -- headless can never approve").toBe(true);
		expect(grantExistsAfter, "no grant must exist after a headless refusal").toBe(false);
	});

	it('hasUI: true, ctx.ui.select() -> "Deny" -- refused, and no grant is created', async () => {
		const { threw, grantExistsAfter } = await driveApproval({ hasUI: true, select: async () => "Deny" });
		expect(threw, "execute() must throw when the user explicitly selects Deny").toBe(true);
		expect(grantExistsAfter, "no grant must exist after an explicit Deny").toBe(false);
	});

	it("hasUI: true, ctx.ui.select() -> undefined -- refused, and no grant is created", async () => {
		const { threw, grantExistsAfter } = await driveApproval({ hasUI: true, select: async () => undefined });
		expect(
			threw,
			"execute() must throw when ctx.ui.select() returns undefined -- the inversion T-04-03 rules " +
				"out is 'approve unless the choice is exactly Deny', which would wrongly approve here",
		).toBe(true);
		expect(grantExistsAfter, "no grant must exist when select() returned undefined").toBe(false);
	});

	it.each(["json", "print"])("hasUI: true in %s mode -- refused without opening the dialog", async (mode) => {
		let asked = 0;
		const { threw, grantExistsAfter } = await driveApproval({ hasUI: true, mode, select: async () => (asked++, "Approve") });
		expect(threw).toBe(true);
		expect(grantExistsAfter).toBe(false);
		expect(asked, "a mode that cannot answer a dialog must not be asked one").toBe(0);
	});

	it.each(["tui", "rpc"])("%s: Approve records the grant, and the dialog carries the confirm timeout", async (mode) => {
		const timeouts: (number | undefined)[] = [];
		const { threw, grantExistsAfter } = await driveApproval({
			hasUI: true,
			mode,
			select: async (_t, _o, opts) => (timeouts.push(opts?.timeout), "Approve"),
		});
		expect(threw).toBe(false);
		expect(grantExistsAfter).toBe(true);
		expect(timeouts).toEqual([300_000]);
	});
});

/** Extracts a `field="<json-quoted string>"` value from the hook's block-reason text. */
function extractQuotedField(text: string, field: string): string {
	const marker = `${field}=`;
	const start = text.indexOf(marker);
	if (start === -1) {
		throw new Error(`no "${marker}" found in block reason: ${text}`);
	}
	let i = start + marker.length;
	if (text[i] !== '"') {
		throw new Error(`expected a JSON-quoted string right after "${marker}" in: ${text}`);
	}
	let j = i + 1;
	while (j < text.length && text[j] !== '"') {
		if (text[j] === "\\") {
			j += 1;
		}
		j += 1;
	}
	return JSON.parse(text.slice(i, j + 1)) as string;
}

/**
 * An unconsumed grant (the executing tool is not this wrapper) lets one re-issue through, not every re-issue for the
 * grant's TTL. Each issue is a new tool call with its own toolCallId; the shared-id case is in bootstrap-safety-stub.
 */
describe("WR-12 -- the hook's deferral is self-limiting: a grant left unconsumed blocks on the SECOND re-issue", () => {
	it("calling the tool_call hook for three SEPARATE re-issues of the same grant, with no intervening wrapper consume, blocks the second re-issue", async () => {
		const { pi, handlers } = stubPi();
		safety(pi);
		const toolCallHook = handlers.get("tool_call");
		expect(toolCallHook, "the tool_call hook must have registered").toBeDefined();

		const command = "terraform apply";

		await withTempLogCwd(async (cwd) => {
			const fakeCtx = { cwd, hasUI: false } as unknown as ExtensionContext;

			// First issue: no grant yet -- classified confirm, hook mints a
			// pending request and blocks, embedding request_id/command/reason.
			const firstResult = (await (toolCallHook as (...args: unknown[]) => Promise<{ block?: boolean; reason?: string } | undefined>)(
				{ toolName: "bash", input: { command }, toolCallId: "tc-1" },
				fakeCtx,
			)) as { block?: boolean; reason?: string } | undefined;
			expect(firstResult?.block, "the first issue must block pending confirmation").toBe(true);
			const requestId = extractQuotedField(firstResult?.reason ?? "", "request_id");
			const approvedCommand = extractQuotedField(firstResult?.reason ?? "", "command");
			const approvedReason = extractQuotedField(firstResult?.reason ?? "", "reason");

			// Approve directly, isolating the hook's deferral from approve_ky_command's UI gating.
			const granted = approve(requestId, approvedCommand, approvedReason);
			expect(granted, "approve() must have succeeded against the pending entry the hook just created").toBe(true);

			// A re-issue (new toolCallId) with a grant present: the hook defers exactly once.
			const secondResult = await (toolCallHook as (...args: unknown[]) => Promise<{ block?: boolean; reason?: string } | undefined>)(
				{ toolName: "bash", input: { command }, toolCallId: "tc-2" },
				fakeCtx,
			);
			expect(
				secondResult,
				"the hook must defer to the wrapper on the FIRST re-issue with a grant present -- CR-01's own property",
			).toBeUndefined();

			// A third re-issue with no wrapper execute() in between: the grant must not defer again.
			const thirdResult = (await (toolCallHook as (...args: unknown[]) => Promise<{ block?: boolean; reason?: string } | undefined>)(
				{ toolName: "bash", input: { command }, toolCallId: "tc-3" },
				fakeCtx,
			)) as { block?: boolean; reason?: string } | undefined;
			expect(
				thirdResult?.block,
				"WR-12: a SECOND deferral attempt for the same requestKey under a DIFFERENT toolCallId, with " +
					"no intervening consume(), must BLOCK -- markHookDeferred() must have refused to defer " +
					"again for a genuinely different tool call. Without the fix this would be undefined " +
					"(deferred again), which is the unbounded-unguarded-window bug",
			).toBe(true);
		});
	});
});

/** A block caused by grep's `glob` alone (no `path`) still records the glob in the audit row's command column. */
describe("IN-04 -- a grep blocked on its glob (no path) still records what caused the block", () => {
	it("records the glob value in the audit row's command column, not an empty string", async () => {
		const { pi, handlers } = stubPi();
		safety(pi);
		const toolCallHook = handlers.get("tool_call");
		expect(toolCallHook, "the tool_call hook must have registered").toBeDefined();

		await withTempLogCwd(async (cwd) => {
			const fakeCtx = { cwd, hasUI: false } as unknown as ExtensionContext;

			// EV-53's own shape: no `path` field at all, blocked on `glob` alone.
			const result = (await (toolCallHook as (...args: unknown[]) => Promise<{ block?: boolean; reason?: string } | undefined>)(
				{ toolName: "grep", input: { pattern: "=", glob: ".env" }, toolCallId: "tc-in-04" },
				fakeCtx,
			)) as { block?: boolean; reason?: string } | undefined;
			expect(result?.block, "EV-53's shape must still block -- this test is not about the verdict changing").toBe(true);

			const written = logPath(cwd, AUDIT_LOG_BASE);
			const rows = readJsonl(written) as AuditRow[];
			const blockRow = rows.find((r) => r.tool === "grep" && r.verdict === "block");
			expect(blockRow, "a block row for the grep call must have been written").toBeDefined();
			expect(
				blockRow?.command,
				"the audit row must record the glob value (\".env\") that actually caused the block, not an " +
					"empty string -- extractCommandOrPath must fall back to `glob` (then `pattern`) for `grep` " +
					"when `path` is absent",
			).toBe(".env");
		});
	});
});
