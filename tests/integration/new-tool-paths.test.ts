/**
 * 08.1-03 (UPG-03) -- Pi 1.x tool paths are guarded in a REAL faux session.
 *
 * Proves, against pi 1.1.0:
 *  1. a nested call issued through `ctx.executeTool` (the codemode mechanism)
 *     reaches the safety hook and the bash wrapper, and is attributed to its
 *     parent via `parentToolCallId` in the audit row;
 *  2. `powershell`, `mcp__*`, the MCP resource tools, `codemode`, `tool_search`
 *     and the non-"process" pi-background-tasks tools are denied by the hook
 *     and the stub bodies never execute;
 *  3. `bg_run` is classified exactly as `bash` (blocked / allowed / malformed);
 *  4. project settings disable the four unused built-in extensions.
 *
 * Stub tools record execution to `<cwd>/.stub-ran` so "never ran" is checkable.
 * The temp cwd is not a git repo and every command is harmless if a guard failed.
 * The safety extension loads at USER scope (project scope is trust-gated).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

import { describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { assertAuditNonEmpty, readAudit } from "../helpers/logs.ts";
import { capturing, lastToolResult } from "../helpers/faux.ts";
import { withFauxSession } from "../helpers/session.ts";

const SAFETY_ENTRY = `${repoRoot()}/.pi/extensions/safety/index.ts`.replace(/\\/g, "/");

const PUSH_MAIN = "git push origin main";

/** Inline extension: the REAL safety extension first, then permissive stub tools that record execution. */
function stubSource(names: string[], extra = ""): string {
	return [
		`import safety from ${JSON.stringify(SAFETY_ENTRY)};`,
		'import { appendFileSync } from "node:fs";',
		'import { join } from "node:path";',
		"export default function (pi) {",
		"\tsafety(pi);",
		`\tfor (const name of ${JSON.stringify(names)}) {`,
		"\t\tpi.registerTool({",
		"\t\t\tname, label: name, description: `stub ${name}`,",
		'\t\t\tparameters: { type: "object", properties: {}, additionalProperties: true },',
		"\t\t\tasync execute(id, params, signal, onUpdate, ctx) {",
		'\t\t\t\tappendFileSync(join(ctx.cwd, ".stub-ran"), name + "\\n");',
		'\t\t\t\treturn { content: [{ type: "text", text: "stub-ran" }], details: undefined };',
		"\t\t\t},",
		"\t\t});",
		"\t}",
		extra,
		"}",
		"",
	].join("\n");
}

function ranStubs(cwd: string): string[] {
	const f = join(cwd, ".stub-ran");
	return existsSync(f) ? readFileSync(f, "utf-8").split("\n").filter(Boolean) : [];
}

/** One scripted turn: call `name` with `args`, then a captured closing reply. */
async function callStub(name: string, args: Record<string, unknown>) {
	const outgoing: TranscriptContext[] = [];
	return withFauxSession(
		{
			extensionSource: stubSource([name]),
			tools: [name],
			responses: [
				fauxAssistantMessage([fauxToolCall(name, args as Parameters<typeof fauxToolCall>[1])], { stopReason: "toolUse" }),
				capturing(outgoing, fauxAssistantMessage([fauxText("noted")], { stopReason: "stop" })),
			],
		},
		async ({ session, cwd }) => {
			await session.prompt(`call ${name}`);
			const rows = readAudit(cwd);
			assertAuditNonEmpty(rows);
			expect(outgoing.length, "closing reply never reached").toBe(1);
			return {
				rows,
				ran: ranStubs(cwd),
				result: lastToolResult(outgoing[0] as TranscriptContext),
			};
		},
	);
}

describe("08.1-03 -- nested calls (codemode mechanism) reach the guard", () => {
	it("case 1: ctx.executeTool('bash', git push origin main) is blocked and attributed to the parent call", async () => {
		const extra = [
			"\tpi.registerTool({",
			'\t\tname: "nested_probe", label: "nested_probe", description: "nested probe",',
			'\t\tparameters: { type: "object", properties: {}, additionalProperties: true },',
			"\t\tasync execute(id, params, signal, onUpdate, ctx) {",
			`\t\t\tconst outcome = await ctx.executeTool("bash", { command: ${JSON.stringify(PUSH_MAIN)} });`,
			'\t\t\tappendFileSync(join(ctx.cwd, ".nested-outcome"), JSON.stringify({ isError: outcome.isError, id: outcome.toolCall && outcome.toolCall.id }));',
			'\t\t\treturn { content: [{ type: "text", text: "probe-done" }], details: undefined };',
			"\t\t},",
			"\t});",
		].join("\n");
		const parentId = "parent_call_1";
		await withFauxSession(
			{
				extensionSource: stubSource([], extra),
				tools: ["bash", "nested_probe"],
				responses: [
					fauxAssistantMessage([fauxToolCall("nested_probe", {}, { id: parentId })], { stopReason: "toolUse" }),
					fauxAssistantMessage([fauxText("noted")], { stopReason: "stop" }),
				],
			},
			async ({ session, cwd }) => {
				await session.prompt("run nested probe");
				const rows = readAudit(cwd);
				assertAuditNonEmpty(rows);

				const outcomeFile = join(cwd, ".nested-outcome");
				expect(existsSync(outcomeFile), "nested_probe never ran its executeTool call").toBe(true);
				const outcome = JSON.parse(readFileSync(outcomeFile, "utf-8")) as { isError: boolean; id?: string };
				expect(outcome.isError, "the nested git push must come back as an error outcome").toBe(true);
				if (outcome.id !== undefined) {
					expect(outcome.id).toMatch(/\/\d+$/);
				}

				const nestedBlock = rows.filter(
					(r) =>
						r.tool === "bash" &&
						r.verdict === "block" &&
						r.command === PUSH_MAIN &&
						r.parentToolCallId === parentId,
				);
				expect(nestedBlock.length, "no block row with the parent's toolCallId for the nested call").toBeGreaterThan(0);
				expect(rows.filter((r) => r.command === PUSH_MAIN && r.verdict === "allow").length).toBe(0);
			},
		);
	});
});

describe("08.1-03 -- deny table", () => {
	it("case 2: powershell is blocked and its body never runs", async () => {
		const { rows, ran, result } = await callStub("powershell", { command: "Write-Output probe" });
		expect(result?.isError).toBe(true);
		expect(ran).not.toContain("powershell");
		expect(rows.some((r) => r.tool === "powershell" && r.verdict === "block")).toBe(true);
		expect(rows.some((r) => r.tool === "powershell" && r.verdict === "allow")).toBe(false);
	});

	it.each(["mcp__probe__echo", "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"])(
		"case 3: MCP tool %s is blocked and never runs",
		async (name) => {
			const { rows, ran, result } = await callStub(name, { server: "x" });
			expect(result?.isError).toBe(true);
			expect(ran).not.toContain(name);
			expect(rows.some((r) => r.tool === name && r.verdict === "block")).toBe(true);
		},
	);

	it.each(["codemode", "tool_search"])("case 4: %s is blocked and never runs", async (name) => {
		const { rows, ran, result } = await callStub(name, { code: "return 1" });
		expect(result?.isError).toBe(true);
		expect(ran).not.toContain(name);
		expect(rows.some((r) => r.tool === name && r.verdict === "block")).toBe(true);
	});

	it.each(["bg_run_pi_attested", "bg_delegate", "fusion_reason", "delegate_read_artifact"])(
		"case 5b: pi-background-tasks non-process tool %s is denied (prompt/argv-bearing)",
		async (name) => {
			const { rows, ran, result } = await callStub(name, { prompt: PUSH_MAIN, extraPiArgs: [PUSH_MAIN] });
			expect(result?.isError).toBe(true);
			expect(ran).not.toContain(name);
			expect(rows.some((r) => r.tool === name && r.verdict === "block")).toBe(true);
		},
	);
});

describe("08.1-03 -- bg_run is classified as bash", () => {
	it("case 5a: bg_run git push origin main is blocked, stub never ran", async () => {
		const { rows, ran, result } = await callStub("bg_run", { name: "push", command: PUSH_MAIN, isAgent: false });
		expect(result?.isError).toBe(true);
		expect(ran).not.toContain("bg_run");
		expect(rows.some((r) => r.tool === "bg_run" && r.verdict === "block" && r.command === PUSH_MAIN)).toBe(true);
	});

	it("case 5a: bg_run through a variable indirection is blocked (same AST path as bash)", async () => {
		const { ran, result } = await callStub("bg_run", {
			name: "x",
			command: "g=push; git $g origin main",
			isAgent: false,
		});
		expect(result?.isError).toBe(true);
		expect(ran).not.toContain("bg_run");
	});

	it("case 5a: bg_run echo ok is allowed, stub ran, allow row has tool bg_run", async () => {
		const { rows, ran, result } = await callStub("bg_run", { name: "echo", command: "echo ok", isAgent: false });
		expect(result?.isError).toBe(false);
		expect(ran).toContain("bg_run");
		expect(rows.some((r) => r.tool === "bg_run" && r.verdict === "allow" && r.command === "echo ok")).toBe(true);
	});

	it("case 5a: bg_run with no command is blocked (fail closed)", async () => {
		const { rows, ran, result } = await callStub("bg_run", { name: "none", isAgent: false });
		expect(result?.isError).toBe(true);
		expect(ran).not.toContain("bg_run");
		expect(rows.some((r) => r.tool === "bg_run" && r.verdict === "block")).toBe(true);
	});
});

describe("08.1-03 -- id-only process tools need no mapping", () => {
	it.each(["bg_status", "bg_logs", "bg_kill"])("case 5c: %s is not blocked by the hook", async (name) => {
		// These carry only taskId/maxBytes/tail (pi-background-tasks@2.6.9 src/extension.ts:184-209).
		// The hook writes no row for them, so no audit-file assertion applies; the stub must have run.
		const outgoing: TranscriptContext[] = [];
		await withFauxSession(
			{
				extensionSource: stubSource([name]),
				tools: [name],
				responses: [
					fauxAssistantMessage([fauxToolCall(name, { taskId: "abc" })], { stopReason: "toolUse" }),
					capturing(outgoing, fauxAssistantMessage([fauxText("noted")], { stopReason: "stop" })),
				],
			},
			async ({ session, cwd }) => {
				await session.prompt(`call ${name}`);
				expect(ranStubs(cwd)).toContain(name);
				expect(lastToolResult(outgoing[0] as TranscriptContext)?.isError).toBe(false);
			},
		);
	});
});

describe("08.1-03 -- project settings disable the unused built-in extensions", () => {
	it("case 6: .pi/settings.json extensions is exactly the four -builtin: entries", () => {
		const settings = JSON.parse(readFileSync(join(repoRoot(), ".pi", "settings.json"), "utf-8")) as {
			extensions?: string[];
		};
		expect([...(settings.extensions ?? [])].sort()).toEqual(
			["-builtin:codemode", "-builtin:llama.cpp", "-builtin:mcp", "-builtin:tool-search"].sort(),
		);
	});
});
