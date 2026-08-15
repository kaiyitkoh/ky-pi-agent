/**
 * GATE-09 — advisor escalation: the executor consults a DIFFERENT, stronger
 * model at a genuine decision point, mid-turn, without changing its own
 * model.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE DEFINES A TOOL ON PURPOSE
 * ---------------------------------------------------------------------------
 * CONTRIBUTING.md's boundary rule says a new capability defaults to a command
 * or a skill, and a tool must answer three questions in writing before it is
 * built. This is the one place in Phase 8 that answer comes out "yes, a
 * tool" — see 08-RESEARCH.md's own Pitfall 4 and Q6.
 *
 * (a) MUST THE MODEL CALL THIS MID-TURN? Yes. The consult happens at a
 *     decision point INSIDE the executor's own turn, about work it is
 *     currently doing, and the advisor's answer must come back into that
 *     SAME turn so the executor can act on it before finishing. A command
 *     cannot originate here: `pi/src/core/system-prompt.ts` carries no
 *     reference to registered commands at all [CONTRIBUTING.md's own
 *     citation, restated by `qoder_delegate`'s identical (a) answer in
 *     `tests/unit/contributing-boundary.test.ts:116-121`], so a command runs
 *     BETWEEN turns and has no path back into the model's own reasoning
 *     while it is still working. `/escalate` (ROUTE-03) is not a substitute:
 *     it lifts the EXECUTOR's own model for every subsequent turn; it does
 *     not let the executor keep its own model while asking a second one a
 *     single question.
 * (b) MEASURED SCHEMA COST: 584 bytes, `Math.ceil(584 / 4) = 146` tokens —
 *     under the plan's 200-token hard limit (above, not under, the `todo`
 *     tool's 96-token floor the plan asked to try for first; two honestly
 *     described string fields plus a description naming what the tool does,
 *     what it does NOT do, and when to use it could not be shrunk further
 *     without dropping one of those). Computed exactly as `05-03-SUMMARY.md`
 *     and `07-08-SUMMARY.md` did: `Buffer.byteLength(JSON.stringify({
 *     type:"function",function:{name,description,parameters}}),"utf8")`,
 *     `Math.ceil(bytes / 4)` per `diagnostics/budget.ts:223-224`, run against
 *     THIS module's real `consultAdvisorParameters` and
 *     `CONSULT_ADVISOR_DESCRIPTION` via a `node --input-type=module -e`
 *     one-liner from the repo root (both `typebox` and
 *     `@earendil-works/pi-ai` are ESM-only with no CJS entry — the 07-08
 *     finding). Exact command and output recorded in 08-08-SUMMARY.md's
 *     Measurement section.
 * (c) WHY CAN A SKILL NOT CARRY THIS? A skill is text the model reads and
 *     interprets — it has no mechanism to make a nested, routed, guarded
 *     model call whose result comes back as structured tool output the
 *     executor can branch on inside the SAME turn. The best a skill can do
 *     is tell the model to WRITE a question as ordinary prose, which is the
 *     status quo this requirement exists to replace, and which the prose
 *     retry / prose-tool-call detector (Phase 2, DIAG-05) already treats as
 *     a failure mode rather than a feature.
 *
 * The REGISTRATION itself — the actual tool-registration call, the
 * `TOOL_REGISTRATION_ALLOWLIST` entry and the `TOOL_COUNT_BASELINE` row —
 * lands in `.pi/extensions/quality/index.ts`, plan 08-11, in the SAME commit
 * as that call. This file builds and proves the mechanism as a plain,
 * unregistered module: a reader who finds only this file, before 08-11
 * lands, can see the toll is paid in full — deferred by one plan within the
 * same phase, never evaded. This file does not spell the registration call
 * itself, in code or in prose — `tests/unit/contributing-boundary.test.ts`
 * matches it as a plain substring across every tracked source under
 * `.pi/extensions/`, comments included, and grants this file no exemption;
 * it is described above as "the actual tool-registration call".
 *
 * ---------------------------------------------------------------------------
 * DISPATCH — ONE ROUTE TO A MODEL, THE CHOKEPOINT'S
 * ---------------------------------------------------------------------------
 * {@link executeConsultAdvisor} calls `runSingleShotRole(ctx,
 * {role:"advisor", ...})` and nothing else. The `advisor` role already
 * exists in `ROLE_MAP` with `reasoningEffort:"high"` in every mode (05-01) —
 * this module invents no parallel role system and opens no second route to a
 * model. It never spells, even in prose, any of the direct-model-access
 * forms `tests/unit/chokepoint-lint.test.ts` bans across `.pi/extensions/`.
 *
 * ---------------------------------------------------------------------------
 * WHY NO `terminate` FIELD
 * ---------------------------------------------------------------------------
 * An advisor consult is mid-turn, not a final answer: the executor keeps
 * working the SAME turn after hearing the advisor's opinion, unlike Pi's own
 * `examples/extensions/structured-output.ts`, whose `terminate:true`
 * genuinely ends the turn on a final structured answer. {@link
 * executeConsultAdvisor} returns a plain `string`, not a tool-result object,
 * so there is nothing here that COULD carry a `terminate` field — but when
 * plan 08-11 wraps this function's return value into the real
 * `ToolDefinition.execute` result, that wrapper must never set
 * `terminate:true`. This answers 08-RESEARCH.md's Open Question 1 — see the
 * dated `RESOLVED:` line added to that question in this same commit for what
 * was decided versus what was actually verified (`ToolDefinition.execute`'s
 * own documented return-shape default was NOT exercised by this plan's
 * session-level proof, which never builds a real `ToolDefinition` — see
 * 08-08-SUMMARY.md).
 *
 * ---------------------------------------------------------------------------
 * REFUSAL — A THROWN ERROR, VERBATIM, NEVER SWALLOWED
 * ---------------------------------------------------------------------------
 * `runSingleShotRole` throws its own actionable `Error` on a routing refusal
 * (no configured candidate), a guard block, or an unresolvable route —
 * {@link executeConsultAdvisor} does not catch it. Pi's own agent loop
 * converts a thrown `Error` into `isError:true` for the model [VERIFIED:
 * `.pi/extensions/qoder/index.ts`'s own citation of
 * `pi-agent-core/dist/agent-loop.js:444-449`, `createErrorToolResult`] —
 * `AgentToolResult` carries no `isError` FIELD on this Pi version to return
 * instead (the 05-03 finding, restated by `reviewer.ts`'s identical choice).
 * A refused consult costs nothing: no request was ever issued, so nothing is
 * charged to QUAL-09's ledger either — see `runReview`'s own identical
 * reasoning in `.pi/extensions/quality/reviewer.ts`.
 */
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { addQualityCost } from "../diagnostics/quality-cost.ts";
import { runSingleShotRole } from "../routing/modes.ts";

/** The tool name plan 08-11's registration will use. */
export const CONSULT_ADVISOR_TOOL_NAME = "consult_advisor";

/**
 * The first-class, model-facing statement of what this tool does, does NOT
 * do, and when to use it. Measured at 584 bytes / 146 tokens as the whole
 * serialised `{type:"function",function:{name,description,parameters}}` tool
 * object — see this module's own docstring (b) and 08-08-SUMMARY.md's
 * Measurement section for the exact command.
 */
export const CONSULT_ADVISOR_DESCRIPTION =
	"Consult a DIFFERENT, stronger advisor model at a genuine decision point. Does NOT change your own model; " +
	"you keep working the same turn afterward. Costs one nested call. Use ONLY when genuinely uncertain -- " +
	"never for routine work.";

/**
 * Two string fields only — every extra field is a permanent per-turn bill
 * (this module's own docstring (b)).
 */
export const consultAdvisorParameters = Type.Object({
	question: Type.String({
		description: "The genuine decision point to ask the advisor about.",
	}),
	context: Type.String({
		description: "Code, options considered, and the reason for uncertainty.",
	}),
});

/** What {@link executeConsultAdvisor} needs — the tool call's own two arguments. */
export interface ConsultAdvisorArgs {
	readonly question: string;
	readonly context: string;
}

/**
 * The advisor's own system prompt — short and scoped: answer the question
 * asked, state uncertainty plainly, and do not attempt the caller's own
 * work. The advisor sees only what the executor chose to share in
 * `context`, never the executor's full task.
 */
const ADVISOR_SYSTEM_PROMPT =
	"You are a stronger advisor model, consulted mid-turn by another agent that has reached a genuine decision " +
	"point and is uncertain how to proceed. Answer the question asked, directly. State your own uncertainty " +
	"plainly where it exists -- do not manufacture confidence you do not have. Do not attempt to do the " +
	"caller's underlying work for them: you were given only the question and the context they chose to " +
	"share, not their full task.";

/**
 * Dispatch one advisor consult through the Phase 2 chokepoint and return the
 * advisor's text.
 *
 * Times the call and reports `addQualityCost({ms, tokens})` — QUAL-09's
 * ledger, the same recipe `runReview` (`.pi/extensions/quality/reviewer.ts`)
 * already uses. A thrown guard/routing refusal propagates UNCAUGHT and is
 * never charged — see this module's own REFUSAL section above.
 */
export async function executeConsultAdvisor(ctx: ExtensionContext, args: ConsultAdvisorArgs): Promise<string> {
	const messages: Message[] = [
		{
			role: "user",
			content: `Question: ${args.question}\n\nContext:\n${args.context}`,
			timestamp: Date.now(),
		},
	];

	const start = process.hrtime.bigint();
	const message: AssistantMessage = await runSingleShotRole(ctx, {
		role: "advisor",
		systemPrompt: ADVISOR_SYSTEM_PROMPT,
		messages,
		need: {},
	});
	const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
	addQualityCost({ ms: elapsedMs, tokens: message.usage.totalTokens });

	// No `terminate` field anywhere near this function — see the module
	// docstring's WHY NO terminate FIELD section above. This function returns
	// a plain string; plan 08-11's real ToolDefinition.execute wrapper must
	// not introduce one either.
	return message.content
		.filter((block): block is Extract<AssistantMessage["content"][number], { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join(" ")
		.trim();
}
