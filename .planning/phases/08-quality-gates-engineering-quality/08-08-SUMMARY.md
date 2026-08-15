---
phase: 08-quality-gates-engineering-quality
plan: 08
subsystem: quality
tags: [gate-09, advisor, consult_advisor, boundary-rule, tool-schema, chokepoint]

# Dependency graph
requires:
  - phase: 08-quality-gates-engineering-quality
    provides: "08-01 (RunSingleShotRoleOptions.tools threaded through runSingleShotRole, buildNestedApiOptions per-model.api fix), 08-04 (addQualityCost -- the quality-cost ledger)"
provides:
  - "executeConsultAdvisor(ctx, {question, context}): Promise<string> -- dispatches through runSingleShotRole({role:\"advisor\"}), the Phase 2 chokepoint, no second route to a model"
  - "CONSULT_ADVISOR_TOOL_NAME / CONSULT_ADVISOR_DESCRIPTION / consultAdvisorParameters -- the future tool's name, description and typebox schema, measured at 584 bytes / 146 tokens"
  - "tests/integration/advisor-consult.test.ts: the fauxProvider proof the advisor's own model answers, the session model is unchanged, refusal costs zero, and cost is attributed"
  - "08-RESEARCH.md Open Question 1 closed with a dated RESOLVED line"
affects: [08-11-tool-registration-and-baseline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A model-invocable capability built as a plain, unregistered module first (this plan), with the actual pi.registerTool call, TOOL_REGISTRATION_ALLOWLIST entry and TOOL_COUNT_BASELINE row deferred to the plan that owns registration (08-11) -- mirrors reviewer.ts's own split between capability and registration"
    - "Reusing the boundary-rule schema-cost measurement recipe verbatim: node --input-type=module -e, Buffer.byteLength(JSON.stringify({type:\"function\",function:{name,description,parameters}}),\"utf8\"), Math.ceil(bytes/4)"

key-files:
  created:
    - .pi/extensions/quality/advisor.ts
    - tests/integration/advisor-consult.test.ts
  modified:
    - .planning/phases/08-quality-gates-engineering-quality/08-RESEARCH.md

key-decisions:
  - "GATE-09's advisor tool is the one place in Phase 8 the boundary rule's answer is 'yes, a tool' -- the model must consult a second model mid-turn, in the same turn, and neither a command nor a skill has a mechanism for that (the plan's own (a)/(b)/(c) written into advisor.ts's own docstring)"
  - "No terminate field: an advisor consult is mid-turn continuation, not a final answer -- executeConsultAdvisor returns a plain string, and the eventual ToolDefinition.execute wrapper (08-11) must not introduce one either"
  - "A refusal (no configured candidate) is left to propagate uncaught from runSingleShotRole, never caught and rewrapped -- mirrors reviewer.ts#runReview's identical choice, and means a refused consult costs zero requests and zero QUAL-09 ledger entries"
  - "The two ROLE_MAP.max candidates (executor vs advisor) are the fixture's cross-provider proof -- deepseek vs amazon-bedrock -- following the 05-11 discipline that a nested row naming the right model proves nothing if the two roles could never resolve to different providers in the same mode"

requirements-completed: [GATE-09]

# Metrics
duration: "~12min"
completed: 2026-08-15
---

# Phase 08 Plan 08: Advisor Escalation (GATE-09) Summary

**`executeConsultAdvisor` lets the executor consult a DIFFERENT, stronger model configured for the `advisor` role at a genuine decision point, mid-turn, through the Phase 2 chokepoint only -- proven on a real `fauxProvider` session to reach the advisor's own resolved model (cross-provider in `max` mode), leave the session's own model and turn count untouched, cost zero on a routing refusal, and be charged to QUAL-09's ledger only when a request actually happened.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-08-15
- **Tasks:** 2 (both complete)
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- `.pi/extensions/quality/advisor.ts` -- `CONSULT_ADVISOR_TOOL_NAME`, `CONSULT_ADVISOR_DESCRIPTION`, `consultAdvisorParameters` (exactly two string fields, `question`/`context`), and the one impure export `executeConsultAdvisor(ctx, args): Promise<string>`, which builds a single user message from the two arguments, dispatches via `runSingleShotRole(ctx, {role:"advisor", systemPrompt: ADVISOR_SYSTEM_PROMPT, messages, need:{}})`, times the call, calls `addQualityCost({ms, tokens})`, and returns the advisor's text content joined and trimmed.
- The module docstring carries the boundary rule's (a)/(b)/(c) answers written out in full, states that the registration call, the `TOOL_REGISTRATION_ALLOWLIST` entry and the `TOOL_COUNT_BASELINE` row all land together in `.pi/extensions/quality/index.ts` (plan 08-11), and never spells the registration call itself (`grep -c "registerTool" .pi/extensions/quality/advisor.ts` returns `0`).
- `08-RESEARCH.md`'s Open Question 1 gained a dated `RESOLVED:` line naming this plan, the decision taken (no `terminate` field), and stating plainly what was verified (no session mutation, no other disturbance to the turn) versus what was only decided (`ToolDefinition.execute`'s own documented return-shape default was never exercised, because this plan's proof drives `executeConsultAdvisor` as a plain function and builds no real `ToolDefinition` -- that only happens in plan 08-11).
- `tests/integration/advisor-consult.test.ts` -- a real `createFauxSession()` fixture drives `executeConsultAdvisor` directly (no tool registration exists yet) in both `cheap` mode (advisor resolves to `deepseek`, `openai-completions` api) and `max` mode (advisor resolves to Bedrock Claude, `bedrock-converse-stream` api), capturing the outgoing request via the faux response FACTORY -- the same technique `gate10-nested-thinking.test.ts` uses, and for the same reason: the claim under test is what left the harness, not what a helper's return value says. A second, isolated fixture proves the refusal path with a registered-but-unauthed candidate.

## Task Commits

1. **Task 1: The consult_advisor definition, its dispatch, and its measured schema cost** - `c799a72` (feat)
2. **Task 2: Prove the consult reaches the advisor's own model and leaves the session alone** - `5cef74c` (test)

## Measurement

Computed with the same method `05-03-SUMMARY.md` and `07-08-SUMMARY.md` used: `Buffer.byteLength(JSON.stringify({type:"function",function:{name,description,parameters}}),"utf8")`, `Math.ceil(bytes/4)` per `diagnostics/budget.ts:223-224`, run against the real `consultAdvisorParameters` typebox schema and the real `CONSULT_ADVISOR_DESCRIPTION` text via `node --input-type=module -e` from the repo root (`typebox` and `@earendil-works/pi-ai` are both ESM-only with no CJS entry -- the 07-08 finding, though this tool never imports `pi-ai` at all).

```
node --input-type=module -e '
import { Type } from "typebox";
const consultAdvisorParameters = Type.Object({
	question: Type.String({
		description: "The genuine decision point to ask the advisor about.",
	}),
	context: Type.String({
		description: "Code, options considered, and the reason for uncertainty.",
	}),
});
const CONSULT_ADVISOR_DESCRIPTION =
	"Consult a DIFFERENT, stronger advisor model at a genuine decision point. Does NOT change your own model; " +
	"you keep working the same turn afterward. Costs one nested call. Use ONLY when genuinely uncertain -- " +
	"never for routine work.";
const payload = { type: "function", function: { name: "consult_advisor", description: CONSULT_ADVISOR_DESCRIPTION, parameters: consultAdvisorParameters } };
const json = JSON.stringify(payload);
const bytes = Buffer.byteLength(json, "utf8");
console.log(bytes, Math.ceil(bytes/4));
'
```

Result: **584 bytes, 146 tokens** -- under the plan's 200-token hard limit. Above (not under) the `todo` tool's 96-token floor the plan asked to try for first: two honestly described string fields plus a description naming what the tool does, does NOT do, and when to use it could not be shrunk further without dropping one of those three obligations. Plan 08-11 copies these two numbers verbatim into the `TOOL_REGISTRATION_ALLOWLIST` entry and the `TOOL_COUNT_BASELINE` row.

## Falsification (per the plan's own acceptance criteria)

Both working commits (`c799a72`, `5cef74c`) were made BEFORE either mutation, per the plan's own instruction ("Commit before falsifying").

1. Changed `executeConsultAdvisor`'s `runSingleShotRole` call from `role: "advisor"` to `role: "executor"`. Ran `npx vitest run tests/integration/advisor-consult.test.ts`: the fixture's own `beforeAll` threw (`runSingleShotRole: role "executor" resolves to mechanism "set-model", not "call-model"`), turning the whole suite red -- a stronger, earlier failure than case 1 alone, since `executor`'s mechanism is not `call-model` at all. Restored via `git checkout --`; confirmed `git diff --stat` empty; re-ran: 6/6 green.
2. Removed the `addQualityCost({ms, tokens})` call (replaced with a no-op `void elapsedMs;`). Ran the same test file: exactly 1 of 6 failed -- case 6 ("cost attribution"), with the expected assertion message (`peekQualityCost() reported nothing after a successful consult`). Every other case (1-5) stayed green. Restored via `git checkout --`; confirmed `git diff --stat` empty; re-ran: 6/6 green.

Final state: `npx tsc --noEmit` clean; `npx vitest run tests/integration/advisor-consult.test.ts tests/unit` 1626/1626 green across 66 files; full suite (`npx vitest run`) 1904/1904 green across 103 files, run once before falsification began.

## Files Created/Modified

- `.pi/extensions/quality/advisor.ts` (197 lines) -- `CONSULT_ADVISOR_TOOL_NAME`, `CONSULT_ADVISOR_DESCRIPTION`, `consultAdvisorParameters`, `ConsultAdvisorArgs`, `executeConsultAdvisor`.
- `tests/integration/advisor-consult.test.ts` (480 lines) -- the six-case session-level proof.
- `.planning/phases/08-quality-gates-engineering-quality/08-RESEARCH.md` -- Open Question 1's dated `RESOLVED:` line.

## Decisions Made

See `key-decisions` in the frontmatter. In addition:

- **The main fixture's two consult calls (`cheap` then `max` mode) double as a second, independent GATE-10 proof.** Rather than building a separate fixture for "case 1: reaches a different model" and a separate one for "case 4: per-api reasoning field", one `deepseek` faux carrying BOTH the cheap-mode executor's id and the cheap-mode advisor's id, plus one `amazon-bedrock` faux for the max-mode advisor's id, produce both proofs from the same two calls -- exercising `buildNestedApiOptions` (plan 08-01's fix) through a second, independent caller, exactly as the plan's action text asked.
- **Case 5's refusal fixture registers the `deepseek` faux provider but deliberately never calls `setRuntimeApiKey`** -- this reproduces "no configured auth" honestly (`pickConfiguredCandidate` resolves the candidate, then skips it), rather than simulating the refusal by never registering the provider at all (which would only prove "did not resolve", a different branch of the same function). `dashscope` (the second `PRO_CANDIDATES` entry) is never registered, so the refusal's own reason names both failure modes across its two candidates.
- **`peekQualityCost()`/`takeQualityCost()` are imported and called directly, not observed via a turns-log read** -- following `turns-log.test.ts`'s own QUAL-09 pattern: drain first (the accumulator is a process-wide `globalThis` slot shared across test files in one worker), then peek after the call under test.

## Deviations from Plan

None -- plan executed exactly as written. `executeConsultAdvisor`'s signature, dispatch, refusal handling, and the absence of a `terminate` field all match the plan's action text verbatim; the six test cases match the plan's own enumeration one-to-one.

## Known Stubs

None. `executeConsultAdvisor` is fully wired: it genuinely dispatches through `runSingleShotRole` and returns the advisor's real text. The actual `pi.registerTool` call that would make `consult_advisor` reachable by a live model does not exist yet -- this is not a stub, it is the explicitly deferred half of the plan (registration lands in plan 08-11, stated in `advisor.ts`'s own docstring and in this plan's own frontmatter objective).

## Threat Flags

None. All four T-08-27..T-08-30 mitigations named in the plan's threat register are exercised directly by `tests/integration/advisor-consult.test.ts`: T-08-27 (dispatch only via `runSingleShotRole`; `chokepoint-lint.test.ts` unweakened and unexempted, confirmed green), T-08-28 (the boundary rule paid in full in `advisor.ts`'s own docstring, with the MEASURED schema cost recorded), T-08-29 (the description scopes the tool to genuine decision points; cost is recorded per successful call via `addQualityCost`), T-08-30 (the nested call goes through `callModel`'s own existing redaction; no second redactor was added). No new network endpoint, auth path, file-access pattern, or schema change at a trust boundary was introduced beyond what the plan's own threat register already names -- `consultAdvisorParameters` itself is not yet reachable by any live model, since registration is deferred to 08-11.

## Issues Encountered

None beyond the deliberate falsification runs documented above.

## User Setup Required

None -- no external service configuration required. No `[RUNBOOK]` item executed; no real provider inference request issued (every provider in this plan's tests is faux, per the autonomous-run rules).

## Next Phase Readiness

- `executeConsultAdvisor`, `CONSULT_ADVISOR_TOOL_NAME`, `CONSULT_ADVISOR_DESCRIPTION` and `consultAdvisorParameters` are exported and ready for plan 08-11 to wrap into a real `pi.registerTool` call, copy the measured 584-byte/146-token figures verbatim into `TOOL_REGISTRATION_ALLOWLIST` and `TOOL_COUNT_BASELINE`, and extend the boundary-rule tests accordingly.
- `08-RESEARCH.md` Open Question 1 is closed; Open Question 2 (`pi.getAllTools()` semantics) remains open for a later plan in this phase (the LSP probe).
- No blockers carried forward.

---
*Phase: 08-quality-gates-engineering-quality*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `.pi/extensions/quality/advisor.ts`
- FOUND: `tests/integration/advisor-consult.test.ts`
- FOUND: `.planning/phases/08-quality-gates-engineering-quality/08-08-SUMMARY.md`
- FOUND: `.planning/phases/08-quality-gates-engineering-quality/08-RESEARCH.md` (RESOLVED line for Open Question 1)
- FOUND: commit `c799a72`
- FOUND: commit `5cef74c`
