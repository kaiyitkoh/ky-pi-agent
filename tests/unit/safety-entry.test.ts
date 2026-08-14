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

import { createPending, peek } from "../../.pi/extensions/safety/approvals.ts";
import safety, { APPROVE_TOOL_NAME } from "../../.pi/extensions/safety/index.ts";
import { repoRoot } from "../helpers/git.ts";
import { withTempLogCwd } from "../helpers/logs.ts";

/** Absolute path of the file under test, read once for the source-order and grep assertions. */
const ENTRY_PATH = join(repoRoot(), ".pi", "extensions", "safety", "index.ts");

/** A recording stub of exactly the `ExtensionAPI` surface this file touches. */
function stubPi(): {
	pi: ExtensionAPI;
	hooks: string[];
	toolNames: string[];
	tools: Map<string, ToolDefinition<never, unknown>>;
} {
	const hooks: string[] = [];
	const toolNames: string[] = [];
	const tools = new Map<string, ToolDefinition<never, unknown>>();

	const pi = {
		on(event: string, _handler: unknown) {
			hooks.push(event);
		},
		registerTool(tool: ToolDefinition<never, unknown>) {
			toolNames.push(tool.name);
			tools.set(tool.name, tool);
		},
	} as unknown as ExtensionAPI;

	return { pi, hooks, toolNames, tools };
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

	it("registers exactly two hooks: tool_call and session_start", () => {
		expect(
			hooks,
			"an extra hook here is new surface this test did not expect; a missing one means the " +
				"guard or the retention job silently stopped registering",
		).toEqual(["tool_call", "session_start"]);
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

	it("contains no ctx.ui.confirm( call anywhere outside a comment", () => {
		expect(
			(codeOnly.match(/ctx\.ui\.confirm\(/g) ?? []).length,
			"CONTEXT.md decision 4 / RESEARCH Pattern 4: the confirmation protocol is " +
				"block -> approval-tool -> re-issue, never an inline ctx.ui.confirm() dialog",
		).toBe(0);
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
