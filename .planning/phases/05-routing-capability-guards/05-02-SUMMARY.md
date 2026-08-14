---
phase: 05-routing-capability-guards
plan: 02
subsystem: routing
tags: [routing, capability-guard, pure-predicates, pi-extensions, typescript]

# Dependency graph
requires:
  - phase: 03-provider-config
    provides: .pi/templates/models-template.json (DashScope text-only daily drivers), tests/helpers/models.ts#withModelsConfig
  - phase: 05-01
    provides: "routing/schema.ts's ROLE_MECHANISM vocabulary (set-model/call-model/subagent), which later plans use to derive the need.usesToolLoop flag guard.ts consumes"
provides:
  - ".pi/extensions/routing/guard.ts — GuardVerdict, GuardNeed, guardRoute(), isAnthropicClaudeModel(), NO_TOOL_CALLING_MODEL_IDS: the four ROUTE-06/07/08 hard blocks as one pure predicate function"
  - "tests/unit/capability-guard.test.ts — 19-case fixture table proving all four blocks in both directions against a single composed-registry oracle"
affects: [05-03, 05-04, 05-05, docs/ROUTING.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure predicate module (guard.ts), named exports only, no default export — matches safety/policy.ts's evaluate() shape exactly (deny-shaped, no ctx, no process.env, facts supplied by caller)"
    - "Residual-coupling comment for a borrowed-not-imported predicate (isAnthropicClaudeModel) — same trade-off Phase 3 documented for providers/schema.ts's QUOTA_PATTERN"
    - "One composed-registry oracle (withModelsConfig over the shipped template) resolves both DashScope and every Bedrock fixture through the same requireModel() call — no second hand-built Model<Api> literal, continuing 05-01's established pattern"

key-files:
  created:
    - .pi/extensions/routing/guard.ts
    - tests/unit/capability-guard.test.ts
  modified: []

key-decisions:
  - "ROUTE-08's deny-list is scoped by need.usesToolLoop (a caller-supplied boolean, set from ROLE_MECHANISM), never by a role name literal — resolves 05-RESEARCH.md Open Question 1 as instructed by the plan rather than deferring it. R1 blocks only when the target role needs a tool loop; a tool-less single-shot role (e.g. summariser) is not over-blocked"
  - "guardRoute() returns on the FIRST matching block rather than composing a 'strongest wins' reduction like safety/policy.ts — it evaluates exactly one (model, role, need) triple, not a sequence of sub-invocations, so there is no multi-segment composition to reduce"
  - "isAnthropicClaudeModel is a local re-implementation of pi-ai's unexported bedrock-converse-stream.js predicate (not importable — verified against dist/index.d.ts's export list), with a residual-coupling comment naming the exact file:line and the mitigation (behaviour pinned by this file's own tests, not by Pi's internals)"
  - "The Bedrock non-Claude fixture for ROUTE-07/ROUTE-08's negative controls is amazon-bedrock/deepseek.v3-v1:0 (reasoning:true, input:[\"text\"], contextWindow:163840, catalogue-verified live) — the same model proves both 'thinking is silently dropped for this model' and 'the R1 deny-list is not a blanket Bedrock ban', since both blocks need a non-Claude reasoning Bedrock model that is not on the deny-list"

patterns-established:
  - "A capability-guard refusal is always a { ok:false, reason } value naming ${provider}/${id} plus block-specific numbers/facts — never a substituted model, never a log-only side effect. Every ok:false case in the test asserts on the reason STRING, not merely on ok===false"

requirements-completed: [ROUTE-06, ROUTE-07, ROUTE-08]

# Metrics
duration: ~20min
completed: 2026-08-14
---

# Phase 5 Plan 2: Capability Guard Summary

**Pure `routing/guard.ts` predicate (`guardRoute`) refusing four impossible routes — image-to-text-only, oversized-context, Bedrock non-Claude+thinking (silently dropped by Pi), and Bedrock DeepSeek R1 as a tool-loop role — each proven in both directions against a single composed-registry oracle.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-14
- **Tasks:** 2 completed
- **Files modified:** 2 (both created)

## Accomplishments

- `.pi/extensions/routing/guard.ts` exports `GuardVerdict`, `GuardNeed`, `guardRoute(model, role, need)`, `isAnthropicClaudeModel(model)` and `NO_TOOL_CALLING_MODEL_IDS`. Four blocks run in order (image → context-window → Bedrock-thinking → tool-calling deny-list), each returning `{ ok:false, reason }` naming `${provider}/${id}` and the concrete numbers/facts involved; `guardRoute` never substitutes a model and never logs.
- `NO_TOOL_CALLING_MODEL_IDS` is an explicit deny-list (`["deepseek.r1-v1:0", "us.deepseek.r1-v1:0"]`) with an in-file comment stating that `Model<TApi>` (pi-ai `dist/types.d.ts:661-682`) carries no tool-calling-support field anywhere, so no catalogue predicate can express ROUTE-08 — verified against the interface listing on 2026-08-14.
- The deny-list is scoped by `need.usesToolLoop`, a caller-supplied flag (set from `routing/schema.ts`'s `ROLE_MECHANISM` in a later plan), not by a hardcoded role name — the decision RESEARCH's Open Question 1 left open, taken here per the plan's explicit instruction.
- `isAnthropicClaudeModel` reproduces pi-ai's unexported `bedrock-converse-stream.js:542-550` predicate (three branches: id contains `anthropic.claude`/`anthropic/claude`, or name contains either of those or bare `claude`), with a residual-coupling comment matching `providers/schema.ts`'s `QUOTA_PATTERN` precedent.
- `tests/unit/capability-guard.test.ts` (19 cases) proves all four blocks with a paired negative control on the same fixture for every block: image block (text-only vs. `input:["text","image"]`), context-window (one-above/at/one-below the window, plus an absent-need control), Bedrock-thinking (non-Claude+requested vs. non-Claude+not-requested vs. Claude+requested), and the R1 deny-list (both ids × both `usesToolLoop` directions, plus a non-R1 Bedrock model proving the deny-list is not a blanket Bedrock ban). Every `ok:false` case asserts on the reason string, not merely on `ok===false`.
- One composed-registry oracle (`withModelsConfig({ models: TEMPLATE })`, matching the pattern 05-01 established) resolves both the DashScope daily-driver fixture and every Bedrock fixture through the identical `handle.requireModel()` call, which throws (never returns `undefined`) on an unresolved lookup — no hand-built `Model<Api>` literal was needed.
- Falsification executed per the plan's acceptance criteria: dropped `!isAnthropicClaudeModel(model)` from block 3, ran `capability-guard.test.ts`, and got exactly one targeted red failure — `"Bedrock Claude with thinking requested -- ok (Claude is exempt from block 3, ...)"` failed with `expected ok:true ..., got {"ok":false,"reason":"amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0 silently DROPS thinking configuration on non-Claude Bedrock models — ..."}`. Restored the exact original line via `Edit` (no `git checkout --`, per the project's own recorded lesson about losing uncommitted edits to that command); `git diff` after restoration was empty, confirming byte-identical recovery. Re-ran the full targeted set and it was green again.
- Both structural gates pass: `chokepoint-lint.test.ts` (no forbidden `modelRegistry.complete`/`.stream`/`.getProvider` calls, including in comments) and `extension-layout.test.ts` (named-exports-only module correctly classified as a nested, non-entry-point file).

## Task Commits

Each task was committed atomically:

1. **Task 1: Write `.pi/extensions/routing/guard.ts`** — `ee03fe0` (feat)
2. **Task 2: `tests/unit/capability-guard.test.ts`** — `99b431f` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `.pi/extensions/routing/guard.ts` — ROUTE-06/07/08's capability guard, pure predicate, no I/O
- `tests/unit/capability-guard.test.ts` — fixture-table proof of all four blocks with paired negative controls, 19 cases

## Verification Evidence

- `npx vitest run tests/unit/capability-guard.test.ts tests/unit/chokepoint-lint.test.ts tests/unit/extension-layout.test.ts` — 3 files, all green
- `npx vitest run tests/unit/capability-guard.test.ts tests/unit/model-metadata.test.ts tests/unit/r1-unclamp.test.ts` — 3 files / 34 tests, no regression in the pre-existing R1/metadata tests
- `npx vitest run` (full suite) — **69 test files, 1244 tests, all passed**
- `npm run typecheck` (`tsc --noEmit`) — clean, no output

## Decisions Made

- **ROUTE-08's deny-list block is scoped by `need.usesToolLoop`, not by `role === "executor"`.** RESEARCH's Open Question 1 asked whether the block should apply only to the executor role or to every role. The plan's own wording resolves this: the caller sets `usesToolLoop` from `ROLE_MECHANISM` (`true` for `set-model`/`subagent`, `false` for `call-model`), matching ROUTE-08's "as an executor" wording while also correctly allowing R1 to serve a tool-less role like `summariser` — over-blocking a technically-fine use is the same silent-degradation failure category this guard exists to prevent, pointed the other way.
- **`guardRoute` returns on first match rather than reducing a "strongest verdict wins" composition like `safety/policy.ts`.** The two modules differ in shape: `policy.ts#evaluate` composes verdicts across multiple sub-invocations extracted from one shell command, while `guardRoute` evaluates exactly one `(model, role, need)` triple — there is nothing to reduce across.
- **The Bedrock non-Claude fixture is `deepseek.v3-v1:0`, chosen to serve two negative controls at once** (ROUTE-07's "thinking dropped" positive AND ROUTE-08's "not a blanket Bedrock ban" negative), rather than introducing a second synthetic Bedrock fixture — verified live against the installed catalogue (`reasoning:true`, `input:["text"]`, `contextWindow:163840`, no tool-calling-related `compat` key, unlike `deepseek.v3-v1:0`'s sibling `deepseek.v3.2` — neither actually carries one either, confirming neither is silently exempted by an accidental `compat` flag).

## Deviations from Plan

None — plan executed exactly as written. The falsification restore used `Edit` (reverting the exact inverted line back to its original text) rather than `git checkout --`, per this project's own recorded STATE.md lesson ("a falsification restore via `git checkout --` silently DELETED uncommitted Task 2 edits" — Phase 03 plan 11). Since Task 1's `guard.ts` was already committed before the falsification ran (per the plan's own instruction to commit before mutating), either restore method would have been byte-safe here; `Edit` was used anyway to keep the discipline uniform across the project.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- ROUTE-06, ROUTE-07 and ROUTE-08 are complete. `guardRoute`, `GuardVerdict`, `GuardNeed`, `isAnthropicClaudeModel` and `NO_TOOL_CALLING_MODEL_IDS` are all in place for the mode-switch commands and single-shot dispatcher (05-0X, ROUTE-02/03/04/09/10) to call before every `setModel`/`callModel`/subagent dispatch: each candidate from `routing/schema.ts`'s `ROLE_MAP` should be run through `guardRoute` before dispatch, with `need.usesToolLoop` derived from `ROLE_MECHANISM[role] !== "call-model"`.
- Full repo suite verified green after this plan: 1244 tests / 69 files, `tsc --noEmit` clean.
- No blockers for the next plan in wave 1/2.

## Self-Check: PASSED

- FOUND: `.pi/extensions/routing/guard.ts`
- FOUND: `tests/unit/capability-guard.test.ts`
- FOUND: `.planning/phases/05-routing-capability-guards/05-02-SUMMARY.md`
- FOUND commit: `ee03fe0` (Task 1)
- FOUND commit: `99b431f` (Task 2)

---
*Phase: 05-routing-capability-guards*
*Completed: 2026-08-14*
