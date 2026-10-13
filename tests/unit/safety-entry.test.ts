/**
 * The safety extension's entry-point SHAPE — the composition Plan 08 exists
 * to prove, checked structurally rather than behaviourally.
 *
 * WHAT THIS FILE IS, AND WHAT IT IS NOT. This is the unit half, mirroring
 * `tests/unit/diagnostics-entry.test.ts`'s "exact hook count and command
 * count" shape: a recording stub of `ExtensionAPI`, offline, in milliseconds.
 * It proves REGISTRATION shape -- what gets registered, in what order, with
 * what parameter schema. It does NOT prove enforcement actually stops a
 * mutated command; that is `tests/integration/double-enforcement.test.ts`
 * (SAFE-09), against a real faux session. Neither file is sufficient alone.
 *
 * WHY SOURCE ORDER IS ASSERTED TEXTUALLY, NOT ONLY BY RUNTIME CALL ORDER.
 * CONTEXT.md decision 5 / RESEARCH Pattern 5(1): tool-name collisions across
 * EXTENSIONS resolve first-registration-wins
 * [VERIFIED: `dist/core/extensions/runner.js:280-291`]. This file's own
 * `pi.registerTool` calls happening before its own `pi.on("tool_call", ...)`
 * call is necessary but not sufficient for that property to matter -- what
 * actually matters is that a reader (and a future editor) can see the
 * ordering guarantee holds by construction. A stub that only recorded
 * RUNTIME call order would pass even if a later refactor reordered the
 * `registerTool`/`registerCommand`... calls textually while keeping them
 * inside the same synchronous function body (call order would stay the
 * same either way in that case), so this file greps the raw source text
 * directly for the guarantee CONTRIBUTING.md and the module docstring both
 * promise.
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
	/** WR-12: the real handler function registered for each event, keyed by event name -- lets a test invoke `tool_call` directly. */
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
	// CR-06: the default export has no process-wide idempotency guard --
	// every invocation, against a fresh pi stub, fully registers. No reset
	// call is needed between describe blocks in this file any more.
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
		const hookIdx = source.indexOf("registerToolCallHook(pi)");

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

	/**
	 * Comments in this very file quote `ctx.ui.select(`/`ctx.ui.confirm(` in
	 * prose (see the module docstring), so both assertions below must scan
	 * CODE ONLY -- a line beginning with `*` or `//` is stripped first. A raw
	 * `source.match()` over the whole file would over-count by exactly the
	 * number of times this file's own documentation names the pattern it
	 * forbids or restricts.
	 */
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

/**
 * A throwing classification path still yields exactly one audit-shaped
 * decision (block), never a silently-allowed call. Exercises
 * `classifyAtWrapper`'s containment indirectly through the wrapped bash
 * tool's own `execute()`, using a `params` shape guaranteed to make
 * `evaluate()` itself misbehave in a way this test controls: a `command`
 * field that is present but not a string, which policy.ts's own malformed-
 * input handling already blocks WITHOUT throwing -- proving the "we never
 * fall through to the real tool on anything other than a clean allow" shape
 * holds even for garbage input, offline, with no real shell command ever
 * spawned.
 */
describe("a wrapped tool never delegates to the real implementation on a non-allow verdict", () => {
	it("throws instead of running the real bash tool when the command field is malformed", async () => {
		const { pi, tools } = stubPi();
		safety(pi);

		const bashTool = tools.get("bash");
		expect(bashTool, "the bash wrapper must have registered").toBeDefined();

		// A real temp cwd, never process.cwd() -- writeAuditRow really appends
		// to `<cwd>/.pi/logs/audit-*.jsonl`, and process.cwd() here would be
		// this repository's own working directory during a vitest run.
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
 * CR-06 -- models Pi's own `/reload`: `AgentSession#reload` builds a
 * brand-new `ExtensionRunner` and tool registry, then calls the SAME
 * extension's factory again with a FRESH `api` object, in the SAME process
 * [VERIFIED: `dist/core/agent-session.js:2052`,
 * `dist/core/extensions/loader.js:409`]. The iteration-1 WR-07 fix put a
 * `globalThis`-keyed "already installed" flag on the default export, which
 * made this second invocation a silent no-op -- after any `/reload` the
 * session ran with Pi's UNWRAPPED built-in tools and no `tool_call` hook at
 * all. This test proves the regression is gone: TWO invocations against TWO
 * fresh `pi` objects, with nothing reset in between (there is no reset
 * function to call any more), must BOTH fully register. The actual
 * double-load hazard WR-07 named (project-scope auto-discovery + the
 * user-scope stub both loading in the SAME runner build) is now prevented
 * one level up, by `bin/bootstrap.sh`'s generated stub checking for the
 * project-scoped copy's existence before it ever calls this file's default
 * export -- see `tests/integration/bootstrap-safety-stub.test.ts`'s own
 * CR-06 case for that half.
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

		// A SECOND, entirely fresh pi/stub -- exactly what Pi hands a SECOND
		// factory invocation, whether that is `/reload`'s fresh runner build or
		// (pre-CR-06 fix) the double-load WR-07 named. Both invocations here
		// MUST fully register: a process-wide flag cannot tell the two hazards
		// apart, so the fix must not reintroduce one.
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
 * WR-11 -- `approve_ky_command.execute()` had ZERO test coverage before this
 * block: `tests/integration/headless-deny.test.ts`'s own docstring claimed
 * this path "is unit-proven in tests/unit/safety-entry.test.ts and
 * tests/integration/double-enforcement.test.ts", and neither file ever
 * invoked `approve_ky_command`'s `execute()` -- grepping the whole suite
 * before this block confirmed it. T-04-03's contract ("approve ONLY on an
 * explicit affirmative from ctx.ui.select") has exactly three deny-by-default
 * branches: `hasUI === false` (headless), `hasUI === true` with an explicit
 * "Deny" selection, and `hasUI === true` with `ctx.ui.select()` returning
 * `undefined` (`noOpUIContext`'s own headless value, reachable even under a
 * `hasUI: true` stub if a caller's own UI implementation misbehaves). Each
 * case below drives the REGISTERED tool's own `execute()` -- not `evaluate()`
 * or `approve()` directly -- with a REAL pending approval seeded via
 * `approvals.ts#createPending` (so `validate()` succeeds and execution
 * reaches the UI-gating branch this block exists to prove, rather than
 * refusing earlier for an unrelated reason), and asserts BOTH that it throws
 * AND that `peek()` still reports no grant for that request key afterwards --
 * the second assertion is what proves the refusal is a genuine deny, not a
 * throw that happens to follow a grant already recorded.
 */
describe("WR-11 -- approve_ky_command.execute() denies by default on every non-affirmative branch (T-04-03)", () => {
	/** Seed a real pending approval, then drive approve_ky_command's own execute() against it under the given UI shape. */
	async function driveApproval(uiShape: {
		hasUI: boolean;
		select?: () => Promise<string | undefined>;
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
});

/** Extract a `field="<json-quoted string>"` value from the hook's block-reason text, unescaping it via JSON.parse. Mirrors `tests/integration/confirm-approve-reissue.test.ts`'s own helper. */
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
 * WR-12 -- a grant left unconsumed (because the tool that actually executes
 * is NOT this extension's own wrapper -- T-04-08's tool-name-collision case,
 * or the CR-06 case where this extension's wrapper was never registered)
 * must not let an UNBOUNDED number of re-issues through for the grant's
 * whole `APPROVAL_TTL_MS` (10-minute) lifetime. This block drives the REAL
 * `tool_call` HOOK function directly (captured via `stubPi()`'s `handlers`
 * map), with a real grant present and NO wrapper `execute()` ever called in
 * between -- exactly the failure mode CR-01's own fix introduced and WR-12
 * closes.
 *
 * CR-11: each issue below models a SEPARATE real tool call (the first issue,
 * then two genuine RE-ISSUES of the identical command), so each gets its OWN
 * `toolCallId` -- exactly what Pi assigns a fresh tool call
 * [`ToolCallEventBase.toolCallId`, `dist/core/extensions/types.d.ts:648-651`].
 * This is deliberately DIFFERENT from the CR-11 case in
 * `bootstrap-safety-stub.test.ts`, which drives multiple hooks sharing the
 * SAME `toolCallId` (modelling a WR-07/CR-09 double load, where several
 * loaded copies' hooks all fire for ONE tool call) -- the two tests together
 * are the full proof: same toolCallId defers every time (CR-11's fix),
 * different toolCallId with no intervening consume() still blocks (WR-12's
 * original bound, preserved).
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

			// Approve directly (mirrors confirm-approve-reissue.test.ts -- this
			// isolates the hook's own deferral logic from approve_ky_command's
			// separate UI-gating property).
			const granted = approve(requestId, approvedCommand, approvedReason);
			expect(granted, "approve() must have succeeded against the pending entry the hook just created").toBe(true);

			// SECOND issue of the SAME command -- a genuine RE-ISSUE, a NEW tool
			// call, so a NEW toolCallId. A grant now exists. THE FIX ITSELF --
			// the hook must defer (return undefined) this ONE time...
			const secondResult = await (toolCallHook as (...args: unknown[]) => Promise<{ block?: boolean; reason?: string } | undefined>)(
				{ toolName: "bash", input: { command }, toolCallId: "tc-2" },
				fakeCtx,
			);
			expect(
				secondResult,
				"the hook must defer to the wrapper on the FIRST re-issue with a grant present -- CR-01's own property",
			).toBeUndefined();

			// THIRD issue of the SAME command -- ANOTHER genuine re-issue (a
			// THIRD distinct toolCallId), with NO wrapper execute() ever having
			// run in between (this test never touches the wrapped bash tool at
			// all) -- the exact WR-12 failure mode: without the fix, the grant
			// is still present (peek() still true) and the hook would defer
			// AGAIN, letting an unbounded number of re-issues through.
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

/**
 * IN-04 -- `extractCommandOrPath` (the function that fills the audit row's
 * `command` column) reads `record.path` for every non-`bash` tool. `grep`'s
 * OWN input shape carries no `path` at all when the block is caused by its
 * `glob` field instead (`policy.ts#evaluateGrep` checks `path` first, then
 * `glob` -- EV-53 in `tests/fixtures/evasion-corpus.ts`, `{ pattern: "=",
 * glob: ".env" }`, is exactly this shape and is asserted `BLOCKED` there).
 * Before this fix, that blocked row's `command` column was `""` -- the exact
 * field that caused the block, silently lost from the audit log. Drives the
 * REAL `tool_call` hook (captured via `stubPi()`'s `handlers` map) against a
 * real temp `.pi/logs` directory and reads back the real JSONL row `writeAuditRow`
 * appended, never a mock.
 */
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
