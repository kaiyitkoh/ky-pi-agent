/**
 * BOOT-10 — the boundary rule is stated, and this phase does not break it.
 *
 * THE RULE. A new capability defaults to a command or skill; registering a tool
 * requires justifying its per-request schema cost. `CONTRIBUTING.md` carries the
 * rule and its evidence; this file is the enforcement point. A rule written in
 * markdown and asserted nowhere is a rule that gets broken by phase 4.
 *
 * WHY IT IS ECONOMIC, NOT STYLISTIC — the three facts, each read out of Pi
 * 0.84.1's own published TypeScript (recovered from `dist/**\/*.js.map`):
 *   - a tool's name, description and complete JSON Schema are serialised into
 *     `tools[]` on every provider request
 *     [VERIFIED: pi-ai src/api/openai-completions.ts:1337-1372, called at :731]
 *   - a command costs zero: `src/core/system-prompt.ts` is 163 lines and holds
 *     no reference to registered commands
 *     [VERIFIED: pi src/core/system-prompt.ts, whole file]
 *   - a skill costs name + description + location only, body on read
 *     [VERIFIED: pi src/core/skills.ts:350-356, :344]
 *
 * SCOPE, STATED RATHER THAN IMPLIED. This test applies to Phase 1's
 * `.pi/extensions/**` and to nothing else. A later phase that genuinely needs a
 * tool does not delete this file: it extends `TOOL_REGISTRATION_ALLOWLIST`
 * below, in the same change, with the written answers to (a), (b) and (c) from
 * CONTRIBUTING's boundary rule. Making the exception visible and argued is the
 * entire point; an unenforced rule and a silently-edited test are the same
 * thing.
 *
 * THE VACUOUS-PASS GUARD. Assertion 2 scans a file set for a forbidden string.
 * On an empty set it would pass while proving nothing — the exact failure shape
 * this phase has already tripped over twice (a `check-ignore` without
 * `--no-index`, and an npm probe reading its launcher's environment). So the set
 * is asserted non-empty first, and assertion 3 requires the positive half of the
 * rule to be genuinely exercised rather than merely permitted.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot, trackedFiles } from "../helpers/git.ts";

const EXT_DIR = ".pi/extensions";

/**
 * The rule, as a grep. `/default.*command or skill/i` is the regex named in
 * `01-VALIDATION.md`'s BOOT-10 row; keep the two identical.
 */
const RULE_PATTERN = /default.*command or skill/i;

/**
 * The evidence the rule must keep carrying.
 *
 * Without a citation the rule decays into an unsupported style preference, and
 * the first person who finds it inconvenient deletes it. Asserting the citation
 * string means the claim stays falsifiable: anyone can open that file at that
 * line and check.
 */
const EVIDENCE_CITATION = "openai-completions.ts:1337";

/**
 * The call that puts a tool's schema into every provider request.
 *
 * Matched as a plain substring, deliberately. `01-VALIDATION.md`'s BOOT-10 row
 * says the string "appears nowhere under `.pi/extensions/**`", and a substring
 * is the only form that survives `pi["registerTool"]`, a destructured alias or
 * a `const t = "registerTool"` indirection. The cost is that an extension may
 * not name the call even in a comment — `.pi/extensions/harness/index.ts`
 * describes it as "the tool-registration call" for exactly that reason.
 */
const TOOL_REGISTRATION = "registerTool";

/** The sanctioned zero-cost surface. */
const COMMAND_REGISTRATION = "registerCommand";

/**
 * Files under `.pi/extensions/` permitted to register a tool.
 *
 * EMPTY BY DESIGN, for the whole of Phase 1. To add an entry you must also add
 * the (a)/(b)/(c) justification from CONTRIBUTING.md next to it, in the same
 * commit. See the SCOPE note in this file's header.
 *
 * `.pi/extensions/safety/index.ts` (Phase 4, plan 08) is the first extension
 * to earn an entry:
 *
 * (a) The model must call `approve_ky_command` MID-TURN, never the user.
 *     It is the resumption step of a `tool_call` hook block: the hook returns
 *     `{block:true, reason}` embedding a request id, and the model itself
 *     invokes the approval tool with that id, the exact command and the exact
 *     reason to move the pending request forward. There is no user-initiated
 *     entry point for this action -- a user cannot "resume a blocked
 *     `tool_call`" from a command palette, because the block already
 *     happened inside the model's own turn and the retry has to come from
 *     the same place the original call did.
 * (b) MEASURED, not estimated: serialised as
 *     `{type:"function",function:{name,description,parameters}}` -- the
 *     shape `openai-completions.ts:1337-1372` actually sends -- the schema is
 *     1099 bytes. `Math.ceil(1099 / 4) = 275` tokens by this project's own
 *     estimator (`diagnostics/budget.ts:223-224`, Pi's own `chars/4`
 *     formula, the only token-cost arithmetic this codebase has -- no
 *     tokenizer dependency exists or may be added per that file's own
 *     docstring). The four WRAPPED tools (`bash`/`read`/`write`/`edit`) add
 *     ZERO net schema cost: they are registrations of tools Pi already ships
 *     and would already be serialised into every request whether or not this
 *     file wraps them, so `approve_ky_command`'s 275 tokens is the entire
 *     per-turn cost this file adds.
 * (c) A skill cannot carry this because a skill is text the MODEL reads and
 *     interprets -- it has no mechanism to validate a presented command
 *     byte-for-byte against server-side state (`approvals.ts#validate`), no
 *     mechanism to consume a one-shot grant keyed on a content fingerprint
 *     (`approvals.ts#approve`/`#consume`), and no mechanism to drive
 *     `ctx.ui.select()` for a real human confirmation. This needs a
 *     structured, validated round trip through code the model cannot see or
 *     alter, not a procedure the model follows on its own word.
 *
 * `.pi/extensions/qoder/index.ts` (Phase 5, plan 03, ROUTE-11) is the second
 * entry:
 *
 * (a) The model must invoke `qoder_delegate` MID-TURN -- delegation is a
 *     decision the model makes inside its own turn, about work it is
 *     currently doing, and there is no user-initiated entry point that could
 *     hand a delegated result back into the SAME turn. A command cannot do
 *     this: `ctx.waitForIdle()` and the rest of the command-only surface
 *     exist precisely because a command runs BETWEEN turns, not inside one.
 * (b) MEASURED, not estimated: serialised as the exact
 *     `{type:"function",function:{name,description,parameters}}` shape
 *     `openai-completions.ts:1337-1372` sends, this tool's schema is 1315
 *     bytes. `Math.ceil(1315 / 4) = 329` tokens by this project's own
 *     estimator (`diagnostics/budget.ts:223-224`), under the ~400-token
 *     budget the plan set for this description. Computed by running the
 *     tool's real `typebox` schema and description text through
 *     `Buffer.byteLength(JSON.stringify(payload), "utf8")` against a
 *     `require("typebox")` loaded via the repo's own `package.json` --
 *     the exact node one-liner is recorded in `05-03-SUMMARY.md`.
 * (c) A skill cannot carry this because a skill is text the model reads and
 *     interprets -- it has no mechanism to make an authenticated HTTP round
 *     trip with a bearer credential (`Authorization: Bearer <PAT>`), no
 *     mechanism to stream and incrementally parse an SSE response
 *     (`client.ts#parseSseFrames`/`#foldDelegatedResult`), and no mechanism
 *     to refuse actionably, in a way the model can read and act on, when the
 *     credential is absent (`client.ts#resolveQoderConfig`). This needs a
 *     structured network round trip through code the model cannot see or
 *     alter, not a procedure the model follows on its own word.
 *
 * `.pi/extensions/todo.ts` (Phase 7, plan 08, EXT-05/EXT-06, vendored from
 * Pi's own bundled `examples/extensions/todo.ts`) is the third entry:
 *
 * (a) The model must call `todo` MID-TURN -- it is the mechanism the model
 *     uses to maintain its own working list of steps WHILE it works, adding,
 *     toggling and clearing items as its own plan changes over the course of
 *     a turn. `/todos` (the command this same file also registers) is a
 *     read-only VIEWER for a human, and runs BETWEEN turns like every other
 *     command; it has no path back into the model's own reasoning.
 * (b) MEASURED, not estimated: serialised as the exact
 *     `{type:"function",function:{name,description,parameters}}` shape
 *     `openai-completions.ts:1337-1372` sends, this tool's schema is 383
 *     bytes. `Math.ceil(383 / 4) = 96` tokens by this project's own estimator
 *     (`diagnostics/budget.ts:223-224`). Computed with the same method as the
 *     two entries above: `Buffer.byteLength(JSON.stringify(payload), "utf8")`
 *     over `{type:"function",function:{name:"todo",description:"Manage a
 *     todo list. Actions: list, add (text), toggle (id), clear",
 *     parameters:TodoParams}}`, where `TodoParams` is the tool's own real
 *     `typebox` schema (including the `StringEnum` import from
 *     `@earendil-works/pi-ai`, which the tool itself uses), loaded via a
 *     `node --input-type=module` script run from this repo's own root so
 *     bare-specifier ESM resolution (`typebox`, `@earendil-works/pi-ai`)
 *     goes through this repo's own `node_modules` -- recorded verbatim in
 *     `07-08-SUMMARY.md`.
 * (c) A skill cannot carry this because a skill is text the MODEL reads and
 *     interprets -- it has no mechanism to hold branch-scoped state across
 *     turns (`todo.ts#reconstructState` replays session entries keyed on
 *     `msg.toolName === "todo"` so a `/tree` branch sees the todo state that
 *     was actually true at that point in history) and no mechanism to render
 *     a live `/todos` overlay a human can open between turns. A skill's
 *     "procedure" has no server-side memory at all; this needs one.
 *
 * `.pi/extensions/questionnaire.ts` (Phase 7, plan 08, EXT-05/EXT-06,
 * vendored from Pi's own bundled `examples/extensions/questionnaire.ts`) is
 * the fourth entry:
 *
 * (a) The model must invoke `questionnaire` MID-TURN -- the model reaches a
 *     decision point where it genuinely does not know the answer (scope,
 *     preference, which of several valid approaches) and must stop and ask
 *     BEFORE continuing the same turn's work. There is no user-initiated
 *     entry point that could hand a structured multi-question answer back
 *     into a turn already in progress; a command runs between turns and
 *     cannot originate from inside the model's own reasoning.
 * (b) MEASURED, not estimated: serialised as the exact
 *     `{type:"function",function:{name,description,parameters}}` shape
 *     `openai-completions.ts:1337-1372` sends, this tool's schema is 1258
 *     bytes. `Math.ceil(1258 / 4) = 315` tokens by this project's own
 *     estimator (`diagnostics/budget.ts:223-224`). Computed with the same
 *     method as the three entries above, over the tool's own real
 *     `QuestionnaireParams` typebox schema and its real description text,
 *     via the same `node --input-type=module` script run from this repo's
 *     own root -- recorded verbatim in `07-08-SUMMARY.md`.
 * (c) A skill cannot carry this because a skill is text the model reads and
 *     interprets -- it has no mechanism to block a turn awaiting genuine
 *     real-time user input (`ctx.ui.custom<QuestionnaireResult>` suspends
 *     `execute()` until the user answers or cancels), no mechanism to render
 *     a tab-bar selection overlay with keyboard navigation, and no mechanism
 *     to return a STRUCTURED answer (`{id,value,label,wasCustom,index}` per
 *     question) the model can branch on afterward. A skill can only ask the
 *     model to write a question as ordinary text; it cannot suspend the turn
 *     for a real human to answer it.
 *
 * PHASE 7'S OWN HONESTY ABOUT WHAT THIS COSTS. `todo` and `questionnaire` are
 * the FIRST two tools this phase adds to the per-turn schema bill (`safety`
 * and `qoder` predate Phase 7). Phase 2 measured a ~1,850 tok/turn floor for
 * a 7-tool session; these two entries alone add 96 + 315 = 411 tokens on top
 * of that, on every turn, whether or not either tool is ever called. Phase 10
 * -- not Phase 7 -- owns deciding whether that is acceptable and cutting it
 * if not (`pi.setActiveTools()`/dynamic loading per `docs/EXTENSIONS.md`).
 * `tests/unit/tool-count-baseline.test.ts` (plan 07-11, not yet written at
 * the time this entry was added) is the registry Phase 10 will measure the
 * cut against -- this comment is Phase 7's own count showing its work.
 *
 * `.pi/extensions/quality/index.ts` (Phase 8, plan 11, GATE-09) is the fifth
 * entry -- registers `consult_advisor`, built as a plain, unregistered module
 * by plan 08-08's `advisor.ts` and wired to `pi.registerTool` here, in the
 * same commit as this allowlist entry:
 *
 * (a) The model must call `consult_advisor` MID-TURN -- the consult happens
 *     at a decision point INSIDE the executor's own turn, about work it is
 *     currently doing, and the advisor's answer must return into that SAME
 *     turn so the executor can act on it before finishing. A command cannot
 *     originate here: `system-prompt.ts` carries no reference to registered
 *     commands, so a command runs BETWEEN turns and has no path back into
 *     the model's own reasoning while it is still working. `/escalate`
 *     (ROUTE-03) is not a substitute -- it lifts the EXECUTOR's own model
 *     for every subsequent turn; it does not let the executor keep its own
 *     model while asking a second one a single question.
 * (b) MEASURED, not estimated: serialised as the exact
 *     `{type:"function",function:{name,description,parameters}}` shape
 *     `openai-completions.ts:1337-1372` sends, this tool's schema is 584
 *     bytes. `Math.ceil(584 / 4) = 146` tokens by this project's own
 *     estimator (`diagnostics/budget.ts:223-224`), under the plan's 200-token
 *     hard limit. Computed by running the tool's real `typebox` schema and
 *     description text through
 *     `Buffer.byteLength(JSON.stringify(payload), "utf8")` via a
 *     `node --input-type=module -e` one-liner run from this repo's own root
 *     -- the exact command and output are recorded in `08-08-SUMMARY.md`'s
 *     Measurement section.
 * (c) A skill cannot carry this because a skill is text the model reads and
 *     interprets -- it has no mechanism to make a nested, routed, guarded
 *     model call through the Phase 2 chokepoint whose result comes back as
 *     structured tool output the executor can branch on inside the SAME
 *     turn. The best a skill can do is tell the model to WRITE a question as
 *     ordinary prose, which the prose retry / prose-tool-call detector
 *     (Phase 2, DIAG-05) already treats as a failure mode, not a feature.
 *
 * THIS PHASE'S OWN HONESTY ABOUT WHAT THIS COSTS. `consult_advisor` is the
 * FIFTH tool registered anywhere in this repository and the first Phase 8
 * adds. The new LIVE TOTAL this commit produces: 5 tools, Phase 7's own
 * 1015-token, 4-tool figure (the paragraph above) plus this tool's 146 =
 * 1161 tokens per turn, whether or not `consult_advisor` is ever called.
 * Phase 10 -- not this plan -- owns deciding whether that is acceptable and
 * cutting it if not.
 */
const TOOL_REGISTRATION_ALLOWLIST: readonly string[] = [
	".pi/extensions/safety/index.ts",
	".pi/extensions/qoder/index.ts",
	".pi/extensions/todo.ts",
	".pi/extensions/questionnaire.ts",
	".pi/extensions/quality/index.ts",
	// 08.1-05 (UPG-04): vendored pi-background-tasks@2.6.9, process-only. (a) the model must start, poll, read and
	// stop long-running commands mid-turn, which no command or skill can do; (b) four tools, schema cost measured
	// by tests/unit/tool-count-baseline.test.ts (all four carry promptSnippet/promptGuidelines); (c) a skill
	// cannot hold a live process handle. The 7 delegate/fusion tools of the npm package are NOT vendored.
	".pi/extensions/background-tasks/src/extension.ts",
	// bg_enable loader. (a) the model decides mid-turn that it needs a background command or a structured question,
	// and the loader makes those tools appear on its next request; a user command cannot act inside the model's turn.
	// (b) measured: the serialised {type:"function",function:{name,description,parameters}} is 358 bytes, 90 tokens;
	// it replaces bg_run, bg_status, bg_logs, bg_kill and questionnaire in the implement floor (4177 -> 2342 tokens).
	// (c) a skill cannot change the active tool set; only pi.setActiveTools can, and only from extension code.
	".pi/extensions/routing/loader.ts",
];

/** Tracked text sources under `.pi/extensions/`, read from the index's view. */
function extensionSources(): { path: string; text: string }[] {
	return trackedFiles(EXT_DIR)
		.filter((p) => p.endsWith(".ts") || p.endsWith(".js"))
		.sort()
		.map((path) => ({ path, text: readFileSync(join(repoRoot(), path), "utf-8") }));
}

describe("BOOT-10 — the boundary rule is stated", () => {
	const contributing = readFileSync(join(repoRoot(), "CONTRIBUTING.md"), "utf-8");

	it("states that a new capability defaults to a command or skill", () => {
		expect(
			RULE_PATTERN.test(contributing),
			`CONTRIBUTING.md must match ${RULE_PATTERN} — this is the literal regex the ` +
				"BOOT-10 validation row greps for, so rewording past it silently drops the requirement",
		).toBe(true);
	});

	it("keeps the source citation that makes the rule economic rather than stylistic", () => {
		expect(
			contributing,
			`CONTRIBUTING.md must cite ${EVIDENCE_CITATION} — a tool's full JSON Schema riding in ` +
				"every request payload is the reason for the rule; drop the citation and the rule " +
				"becomes an unsupported opinion that the next contributor is right to ignore",
		).toContain(EVIDENCE_CITATION);
	});
});

describe("BOOT-10 — the phase does not violate the rule in the commit that writes it", () => {
	const sources = extensionSources();

	it("finds at least one tracked extension source (guards against a vacuous pass)", () => {
		expect(
			sources.length,
			`no tracked .ts/.js under ${EXT_DIR}/ — every assertion below scans this set, so an ` +
				"empty one turns the whole gate into a pass that verified nothing",
		).toBeGreaterThanOrEqual(1);
	});

	it(`registers no tool anywhere under ${EXT_DIR}/`, () => {
		const offenders = sources
			.filter((s) => !TOOL_REGISTRATION_ALLOWLIST.includes(s.path))
			.filter((s) => s.text.includes(TOOL_REGISTRATION))
			.map((s) => s.path);

		expect(
			offenders,
			"these files register a tool. Per CONTRIBUTING.md's boundary rule, answer (a) must the " +
				"model call this mid-turn, (b) what is the measured schema cost, (c) why can a skill " +
				"not carry it as a procedure — then add the path to TOOL_REGISTRATION_ALLOWLIST with " +
				"those answers beside it",
		).toEqual([]);
	});

	it("exercises the sanctioned surface — at least one command is registered", () => {
		const withCommand = sources.filter((s) => s.text.includes(COMMAND_REGISTRATION)).map((s) => s.path);

		expect(
			withCommand.length,
			`no file under ${EXT_DIR}/ calls ${COMMAND_REGISTRATION}. The rule's negative half would ` +
				"then be satisfied by an extension that does nothing at all; the positive half has to " +
				"be genuinely exercised for the compliance above to mean the rule is workable",
		).toBeGreaterThanOrEqual(1);
	});
});
