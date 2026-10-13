/**
 * The confirm -> approve -> re-issue protocol completes: a confirm-blocked command, once approved, reaches the wrapped
 * tool's execute() exactly once, and a third identical retry with no new approval is blocked again. Approval calls
 * approve() directly, since a faux session has no UI for approve_ky_command. `terraform apply` is confirm-classified
 * unconditionally; only the guard's audit trail is asserted, never the real command's exit.
 */

import type { AssistantMessage, Context, FauxResponseStep } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

import { describe, expect, it } from "vitest";

import { approve } from "../../.pi/extensions/safety/approvals.ts";
import { repoRoot } from "../helpers/git.ts";
import { readAudit } from "../helpers/logs.ts";
import { capturing, lastToolResult } from "../helpers/faux.ts";
import { withFauxSession } from "../helpers/session.ts";

/** Classified `confirm` unconditionally by `infra.ts`, no HEAD/branch fixture needed. */
const CONFIRM_COMMAND = "terraform apply";

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

/**
 * Three turns: issue the command; read the block reason, approve() it and re-issue the identical command; a closing
 * reply whose context is captured.
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

				// (b) after the grant, the hook's second look must allow and name it, never mint a second pending request.
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

				// (c) the second enforcement layer consumed the grant and let the wrapped execute() run.
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

				// (d) the retry reached the real bash tool: its result is never the wrapper's block reason.
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
