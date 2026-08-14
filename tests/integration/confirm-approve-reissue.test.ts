/**
 * CR-01 -- the confirm -> approve -> re-issue protocol can actually complete:
 * a command blocked with `confirm`, then approved, then re-issued, reaches
 * the wrapped tool's own `execute()` exactly once, and the SAME retry a
 * third time (with no NEW approval) is blocked again.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS BROKEN, AND WHY THIS FILE PROVES IT DIFFERENTLY FROM
 * `headless-deny.test.ts`
 * ---------------------------------------------------------------------------
 * `tests/integration/headless-deny.test.ts:70-79` claimed this path was
 * "unit-proven in `tests/unit/safety-entry.test.ts` and
 * `tests/integration/double-enforcement.test.ts`" -- neither file touches it.
 * The `tool_call` hook handled a `confirm` verdict by UNCONDITIONALLY calling
 * `createPending()` and blocking, every single time, even when a valid grant
 * already existed for the exact command -- `approve_ky_command` could never
 * unblock anything: the model would re-issue the identical command, the hook
 * would mint a FRESH pending request and block again, forever.
 *
 * ---------------------------------------------------------------------------
 * WHY APPROVAL IS SIMULATED BY CALLING `approve()` DIRECTLY, NOT THROUGH
 * `approve_ky_command`'s OWN `ctx.ui.select()`
 * ---------------------------------------------------------------------------
 * `createFauxSession` never binds a UI context (`tests/helpers/session.ts`),
 * so `ctx.hasUI` is `false` and `approve_ky_command` would always refuse --
 * that gating (`ctx.ui.select` only under a real UI, "approve ONLY on an
 * explicit affirmative") is a SEPARATE property, already covered by this
 * file's own read of `index.ts`'s docstring and by
 * `tests/unit/safety-entry.test.ts`'s greps for `ctx.ui.confirm(`/`ctx.ui.select(`.
 * CR-01 is specifically about what happens AFTER a grant exists: does the
 * hook/wrapper pair actually let the retry through exactly once? Calling
 * `approve()` directly -- the same store `approve_ky_command`'s own
 * `execute()` calls on a real "Approve" selection -- isolates that question
 * from the UI-gating question, which this file does not re-prove.
 *
 * ---------------------------------------------------------------------------
 * WHY THE COMMAND IS `terraform apply`
 * ---------------------------------------------------------------------------
 * `infra.ts#TERRAFORM_CONFIRM_SUBCOMMANDS` classifies it `confirm`
 * unconditionally, with no branch/HEAD fixture needed -- the same fixture
 * `tests/unit/policy-compose.test.ts` already uses for its own confirm rows.
 * Whether `terraform` is actually installed on the machine running this test
 * is irrelevant: every assertion below is about the GUARD's own audit trail
 * (`safety.tool_call_hook` / `safety.wrapped_execute` verdicts and reasons),
 * never about the real command's exit code.
 */
import { existsSync } from "node:fs";

import type { AssistantMessage, Context, FauxResponseStep } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

import { describe, expect, it } from "vitest";

import { approve } from "../../.pi/extensions/safety/approvals.ts";
import { logPath } from "../../.pi/lib/jsonl.ts";
import { AUDIT_LOG_BASE } from "../../.pi/extensions/safety/schema.ts";
import { repoRoot } from "../helpers/git.ts";
import { readJsonl } from "../helpers/logs.ts";
import { withFauxSession } from "../helpers/session.ts";

const SAFETY_ENTRY = `${repoRoot()}/.pi/extensions/safety/index.ts`.replace(/\\/g, "/");

/** Classified `confirm` unconditionally by `infra.ts`, no HEAD/branch fixture needed. */
const CONFIRM_COMMAND = "terraform apply";

interface AuditRowShape {
	event?: string;
	tool?: string;
	command?: string;
	verdict?: "allow" | "block";
	reason?: string;
}

function readAudit(cwd: string): AuditRowShape[] {
	const file = logPath(cwd, AUDIT_LOG_BASE);
	if (!existsSync(file)) {
		throw new Error(
			`${file} does not exist: the session wrote no safety audit log at all -- the safety extension ` +
				"likely failed to load at user scope.",
		);
	}
	return readJsonl(file) as AuditRowShape[];
}

/** Extract a `field="<json-quoted string>"` value from the hook's block-reason text, unescaping it via JSON.parse. */
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

function lastToolResult(context: Context): { isError: boolean; text: string } | undefined {
	const msg = [...context.messages].reverse().find((m) => m.role === "toolResult");
	if (msg === undefined || msg.role !== "toolResult") {
		return undefined;
	}
	const text = msg.content.map((block) => (block.type === "text" ? block.text : "")).join("");
	return { isError: msg.isError, text };
}

function capturing(into: Context[], reply: AssistantMessage): FauxResponseStep {
	return ((context: Context): AssistantMessage => {
		into.push(context);
		return reply;
	}) as FauxResponseStep;
}

/**
 * Three scripted turns:
 *   1. issue the confirm-classified command.
 *   2. (a FauxResponseFactory) read the block reason the hook produced for
 *      turn 1, extract `request_id`/`command`/`reason`, `approve()` directly
 *      (see module docstring), then re-issue the IDENTICAL command.
 *   3. a plain closing reply, its outgoing context captured for inspection.
 */
function scriptedApprovalFlow(command: string, outgoing: Context[]): FauxResponseStep[] {
	const approvalRetry: FauxResponseStep = ((context: Context): AssistantMessage => {
		const result = lastToolResult(context);
		if (result === undefined) {
			throw new Error("scriptedApprovalFlow: no prior tool result to extract request_id from");
		}
		const requestId = extractQuotedField(result.text, "request_id");
		const approvedCommand = extractQuotedField(result.text, "command");
		const approvedReason = extractQuotedField(result.text, "reason");
		const granted = approve(requestId, approvedCommand, approvedReason);
		if (!granted) {
			throw new Error(
				`scriptedApprovalFlow: approve() refused request_id=${requestId} command=${approvedCommand} -- ` +
					`the extracted fields must match the pending entry's own command/reason byte-for-byte`,
			);
		}
		return fauxAssistantMessage([fauxToolCall("bash", { command: approvedCommand })], { stopReason: "toolUse" });
	}) as FauxResponseStep;

	return [
		fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" }),
		approvalRetry,
		capturing(outgoing, fauxAssistantMessage([fauxText("done")], { stopReason: "stop" })),
	];
}

describe("CR-01 -- confirm -> approve -> re-issue actually unblocks the retry, exactly once", () => {
	it("a confirm-classified command, approved, then re-issued identically, reaches the wrapped tool's execute()", async () => {
		const outgoing: Context[] = [];

		await withFauxSession(
			{
				extensionPath: `${repoRoot()}/.pi/extensions/safety/index.ts`,
				tools: ["bash"],
				responses: scriptedApprovalFlow(CONFIRM_COMMAND, outgoing),
			},
			async ({ session, cwd }) => {
				await session.prompt("run the confirm-classified command, then handle the approval flow");

				const rows = readAudit(cwd);
				expect(rows.length, "no audit rows at all -- the safety extension likely never loaded").toBeGreaterThan(0);

				// (a) The FIRST issue was blocked by the hook, minting a pending
				// request -- this is the starting state the approval flow needs.
				const firstHookBlock = rows.find(
					(r) =>
						r.event === "safety.tool_call_hook" &&
						r.verdict === "block" &&
						r.command === CONFIRM_COMMAND &&
						(r.reason ?? "").includes("cannot be trivially undone"),
				);
				expect(
					firstHookBlock,
					`no initial confirm-block hook row for "${CONFIRM_COMMAND}" was found. Rows:\n${JSON.stringify(rows, null, 2)}`,
				).toBeDefined();

				// (b) THE FIX ITSELF: after approve() granted the retry, the hook's
				// SECOND look at the identical command must be an ALLOW that names
				// the grant -- never a second block, and never a second freshly
				// minted pending request.
				const hookDeferRows = rows.filter(
					(r) =>
						r.event === "safety.tool_call_hook" &&
						r.verdict === "allow" &&
						r.command === CONFIRM_COMMAND &&
						(r.reason ?? "").includes("approval grant is present"),
				);
				expect(
					hookDeferRows.length,
					"CR-01: the hook must defer to the wrapper once an approval grant exists for this exact " +
						`command -- got no such row. Rows:\n${JSON.stringify(rows, null, 2)}`,
				).toBeGreaterThan(0);

				// (c) THE SECOND ENFORCEMENT LAYER actually consumed the grant and
				// let the call through -- this is what "approve_ky_command is not
				// dead code" cashes out to: the wrapped tool's own execute() ran.
				const wrapperConsumeRows = rows.filter(
					(r) =>
						r.event === "safety.wrapped_execute" &&
						r.verdict === "allow" &&
						r.command === CONFIRM_COMMAND &&
						(r.reason ?? "").includes("one-shot approval grant consumed"),
				);
				expect(
					wrapperConsumeRows.length,
					"CR-01: the wrapper must have consumed the one-shot grant and allowed the retry through -- " +
						`got no such row. Rows:\n${JSON.stringify(rows, null, 2)}`,
				).toBeGreaterThan(0);

				// (d) The retry genuinely reached the REAL bash tool's execute() --
				// the closing turn's captured context has a tool result for the
				// SECOND bash call, and that result is never the wrapper's own
				// (pre-fix) block reason text.
				expect(outgoing.length, "the closing reply must have been reached for its context to be captured").toBe(1);
				const finalResult = lastToolResult(outgoing[0] as Context);
				expect(finalResult, "no tool result was captured for the re-issued command").toBeDefined();
				expect(
					finalResult?.text.includes("this requires confirmation"),
					"the retry's own tool result must never carry the hook's confirm-block wording -- if it " +
						"does, the retry was blocked again rather than allowed through",
				).toBe(false);
			},
		);
	});
});
