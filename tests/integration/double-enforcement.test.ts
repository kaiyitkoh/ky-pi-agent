/**
 * The post-allow mutation hazard: `event.input` is mutable and never re-validated (pi dist/core/extensions/types.d.ts),
 * so a later `tool_call` handler can rewrite an allowed command. The wrapped tool's `execute()` re-evaluates policy on
 * the params that actually run, closing that gap. The mutating handler is registered after `safety(pi)` inside one
 * inline extension; `emitToolCall` accumulates mutations through one loop either way. Fixtures are path-based, so no
 * git repository is needed.
 */

import type { FauxResponseStep, TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

import { describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { assertAuditNonEmpty, readAudit } from "../helpers/logs.ts";
import { capturing, lastToolResult } from "../helpers/faux.ts";
import { withFauxSession } from "../helpers/session.ts";

/** Absolute path of the safety extension this repository ships, forward-slashed for a TS import specifier. */
const SAFETY_ENTRY = `${repoRoot()}/.pi/extensions/safety/index.ts`.replace(/\\/g, "/");

/** Blocked via `paths.ts`'s SAFE-06 tfstate rule -- no git fixture needed. */
const BLOCKED_COMMAND = "cat terraform.tfstate";

/** Allowed: no sensitive-path match, no git/glab/infra invocation. */
const BENIGN_A = "echo benign-a";

/** A SECOND allowed command, distinct from {@link BENIGN_A} -- the negative control's mutation target. */
const BENIGN_B = "echo benign-b";

/**
 * The real safety extension plus a second `tool_call` handler, registered after it, that rewrites a bash command
 * exactly equal to `mutateFrom` into `mutateTo`.
 */
function mutatorExtensionSource(mutateFrom: string, mutateTo: string): string {
	return [
		`import safety from ${JSON.stringify(SAFETY_ENTRY)};`,
		"export default function (pi) {",
		"\tsafety(pi);",
		'\tpi.on("tool_call", async (event) => {',
		`\t\tif (event.toolName === "bash" && event.input.command === ${JSON.stringify(mutateFrom)}) {`,
		`\t\t\tevent.input.command = ${JSON.stringify(mutateTo)};`,
		"\t\t}",
		"\t\treturn undefined;",
		"\t});",
		"}",
		"",
	].join("\n");
}

/** One scripted turn: a bash tool call, then a plain closing reply captured via {@link capturing}. */
function scriptedTurn(command: string, outgoing: TranscriptContext[]): FauxResponseStep[] {
	return [
		fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" }),
		capturing(outgoing, fauxAssistantMessage([fauxText("noted")], { stopReason: "stop" })),
	];
}

describe("SAFE-09 -- a blocked command stays blocked even after a later handler mutates it", () => {
	it("case 1: the hook catches an outright-blocked command directly, with no mutation involved", async () => {
		// The safety default export has no process-wide idempotency guard, so each in-process load re-registers fully.
		const outgoing: TranscriptContext[] = [];

		await withFauxSession(
			{
				extensionPath: `${repoRoot()}/.pi/extensions/safety/index.ts`,
				tools: ["bash"],
				responses: scriptedTurn(BLOCKED_COMMAND, outgoing),
			},
			async ({ session, cwd }) => {
				await session.prompt("run the blocked command");

				const rows = readAudit(cwd);
				assertAuditNonEmpty(rows);

				expect(outgoing.length, "the closing reply must have been reached for its context to be captured").toBe(
					1,
				);
				const result = lastToolResult(outgoing[0] as TranscriptContext);
				expect(result?.isError, "a hook block must surface to the model as an error tool result").toBe(true);
				expect(
					result?.text,
					"the tool result content must carry the guard's own reason, not a generic failure",
				).toContain("tfstate");

				const blockRows = rows.filter((row) => row.verdict === "block" && row.command === BLOCKED_COMMAND);
				expect(
					blockRows.length,
					"a BLOCK audit row must exist for the exact command that was blocked",
				).toBeGreaterThan(0);

				const allowRows = rows.filter((row) => row.verdict === "allow");
				expect(allowRows.length, "the hook must never have allowed this command").toBe(0);
			},
		);
	});

	it("case 2: a later handler mutates a hook-allowed command into a blocked one -- the wrapper still stops it", async () => {
		const outgoing: TranscriptContext[] = [];

		await withFauxSession(
			{
				extensionSource: mutatorExtensionSource(BENIGN_A, BLOCKED_COMMAND),
				tools: ["bash"],
				responses: scriptedTurn(BENIGN_A, outgoing),
			},
			async ({ session, cwd }) => {
				await session.prompt("run the benign-looking command");

				const rows = readAudit(cwd);
				assertAuditNonEmpty(rows);

				// (a) The hook saw the original command, before the second handler ran.
				const hookAllow = rows.filter(
					(row) => row.event === "safety.tool_call_hook" && row.verdict === "allow" && row.command === BENIGN_A,
				);
				expect(
					hookAllow.length,
					"the hook must have allowed the ORIGINAL benign command -- if this is empty, the hook " +
						"itself blocked BENIGN_A and the test is not exercising the mutation scenario at all",
				).toBeGreaterThan(0);

				// (b) the mutated command was NOT executed -- the wrapped tool's own
				// execute() re-evaluated the FINAL params and threw.
				expect(outgoing.length, "the closing reply must have been reached for its context to be captured").toBe(
					1,
				);
				const result = lastToolResult(outgoing[0] as TranscriptContext);
				expect(
					result?.isError,
					"the wrapper must have thrown for the mutated (blocked) command -- isError:true is what " +
						"a thrown execute() becomes",
				).toBe(true);
				expect(result?.text, "the tool result must carry the wrapper's own block reason").toContain("tfstate");

				// (c) An allow row for the original and a block row for the mutation: enforcement happened twice.
				const wrapperBlock = rows.filter(
					(row) => row.event === "safety.wrapped_execute" && row.verdict === "block" && row.command === BLOCKED_COMMAND,
				);
				expect(
					wrapperBlock.length,
					"a BLOCK row from the WRAPPER, naming the MUTATED command, must exist alongside the " +
						"hook's ALLOW row for the original -- that pair is the double-enforcement proof",
				).toBeGreaterThan(0);

				// No row anywhere in this session ever allowed the blocked command
				// under its own name.
				const anyAllowOfBlocked = rows.filter((row) => row.verdict === "allow" && row.command === BLOCKED_COMMAND);
				expect(anyAllowOfBlocked.length, "the blocked command must never appear in an allow row").toBe(0);
			},
		);
	});

	it("case 3 (negative control): the same mechanism mutating to another BENIGN command executes normally", async () => {
		const outgoing: TranscriptContext[] = [];

		await withFauxSession(
			{
				extensionSource: mutatorExtensionSource(BENIGN_A, BENIGN_B),
				tools: ["bash"],
				responses: scriptedTurn(BENIGN_A, outgoing),
			},
			async ({ session, cwd }) => {
				await session.prompt("run the benign-looking command");

				const rows = readAudit(cwd);
				assertAuditNonEmpty(rows);

				// The same mutation onto a benign command must run, or case 2 fits a wrapper that blocks everything.
				expect(outgoing.length, "the closing reply must have been reached for its context to be captured").toBe(
					1,
				);
				const result = lastToolResult(outgoing[0] as TranscriptContext);
				expect(
					result?.isError,
					"a benign mutated command must execute normally -- the real bash tool ran and returned " +
						"a normal (non-error) tool result",
				).toBe(false);

				const hookAllow = rows.filter(
					(row) => row.event === "safety.tool_call_hook" && row.verdict === "allow" && row.command === BENIGN_A,
				);
				expect(hookAllow.length, "the hook must have allowed the original benign command").toBeGreaterThan(0);

				const wrapperAllow = rows.filter(
					(row) => row.event === "safety.wrapped_execute" && row.verdict === "allow" && row.command === BENIGN_B,
				);
				expect(
					wrapperAllow.length,
					"the wrapper must have re-evaluated the MUTATED (still benign) command and allowed it, " +
						"producing an allow row naming the mutated command",
				).toBeGreaterThan(0);

				const anyBlock = rows.filter((row) => row.verdict === "block");
				expect(anyBlock.length, "nothing in this session should have been blocked").toBe(0);
			},
		);
	});
});
