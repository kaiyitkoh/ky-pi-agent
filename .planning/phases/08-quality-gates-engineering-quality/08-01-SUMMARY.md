---
phase: 08-quality-gates-engineering-quality
plan: 01
subsystem: routing
tags: [typescript, vitest, pi-ai, bedrock, routing, gate-10]

# Dependency graph
requires:
  - phase: 05-routing-model-provider-selection
    provides: "routing/modes.ts's runSingleShotRole, routing/schema.ts's ROLE_MAP, providers/schema.ts's CHAIN"
  - phase: 02-diagnostics-instrumentation-cost-accounting
    provides: "the callModel() chokepoint (CallModelOptions.tools existed since Phase 2, unused until this plan)"
provides:
  - "buildNestedApiOptions(model, effort): the one producer of a nested call's api options bag, branching on model.api"
  - "RunSingleShotRoleOptions.tools threaded to both dispatch branches (callWithFallback and callModel)"
  - "tests/integration/gate10-nested-thinking.test.ts: the per-model.api outgoing-request proof GATE-10 needs"
affects: [08-quality-gates-engineering-quality later plans that build on GATE-10's nested proof]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One pure function producing a nested call's api options bag, switched on the RESOLVED model.api rather than assumed"
    - "Honest degradation via throw for a genuinely unhandled api (anthropic-messages) vs. a preserved historical default for every other/unknown api"

key-files:
  created:
    - tests/integration/gate10-nested-thinking.test.ts
  modified:
    - .pi/extensions/routing/modes.ts
    - tests/unit/routing-dispatch.test.ts
    - tests/unit/workflow-budgets.test.ts

key-decisions:
  - "buildNestedApiOptions's default branch (and the explicit openai-completions case) return the historical { reasoningEffort } shape rather than throwing, because a compile-time-exhaustive switch over Api (KnownApi | (string & {}), an intentionally open union) does not type-check, and a runtime throw broke the required-green tests/integration/single-shot-roles.test.ts, whose faux fixture omits `api` and gets a random id from pi-ai"
  - "The .pi/extensions/routing directory line-budget ratchet (WR-03) moved from 2230 to 2360 to reflect the measured total after this change"

requirements-completed: [GATE-10]

# Metrics
duration: ~35min
completed: 2026-08-15
---

# Phase 08 Plan 01: Nested-call thinking field fixed per model.api Summary

**`buildNestedApiOptions` replaces the unconditional openai-completions `{reasoningEffort}` shape `runSingleShotRole` sent to every nested call, including Bedrock-routed ones, with a per-`model.api` branch (`{reasoning}` for bedrock-converse-stream), proven RED-before-GREEN by a new fauxProvider-per-api integration test.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-15
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- Fixed the shipped Phase 5 defect at `.pi/extensions/routing/modes.ts:409`: nested single-shot calls (reviewer/advisor/vision/summariser) routed to `amazon-bedrock` now send `{reasoning: effort}` instead of the openai-completions-only `{reasoningEffort: effort}` shape, which `BedrockOptions` has no field for and a real adapter silently ignores.
- Proved the defect RED, before any fix landed, via `tests/integration/gate10-nested-thinking.test.ts`: two faux providers registered under the two real api ids `ROLE_MAP` actually resolves for `reviewer` (`cheap` -> openai-completions, `max` -> bedrock-converse-stream), capturing the outgoing options object each provider's response factory was handed.
- Threaded `RunSingleShotRoleOptions.tools` to both dispatch branches (`callWithFallback` and `callModel`) — `CallModelOptions.tools` has existed since Phase 2 with no caller until now.
- Extended `tests/unit/routing-dispatch.test.ts` with a table over `buildNestedApiOptions`'s three named api cases plus the historical-default case, the `effort === undefined` short circuit, and a CHAIN-hop homogeneity case resolving every `CHAIN` entry through a composed registry (`withModelsConfig` over the shipped template) and asserting each hop produces the same options-bag shape key as the chain head's.

## Task Commits

1. **Task 1: Write the per-api outgoing-request proof and record it RED against today's code** - `6dfd77e` (test)
2. **Task 2: Add buildNestedApiOptions and thread tools through runSingleShotRole** - `7ca2315` (feat)

_No plan-metadata commit yet — this SUMMARY's own commit follows below._

## RED Output (recorded per the plan's mandatory ordering)

`npx vitest run tests/integration/gate10-nested-thinking.test.ts`, run BEFORE `buildNestedApiOptions` existed (committed in `6dfd77e`):

```
❯ tests/integration/gate10-nested-thinking.test.ts (3 tests | 1 failed)
    × bedrock-converse-stream: options.reasoning === "high" and options.reasoningEffort is absent

FAIL  tests/integration/gate10-nested-thinking.test.ts > GATE-10 (nested half)
-- runSingleShotRole sends the api-appropriate thinking field >
bedrock-converse-stream: options.reasoning === "high" and
options.reasoningEffort is absent

AssertionError: the bedrock-converse-stream nested call did not receive
options.reasoning "high" -- BedrockOptions
(node_modules/@earendil-works/pi-ai/dist/api/bedrock-converse-stream.d.ts:6-11)
names this field "reasoning", not "reasoningEffort", and reviewer declares
reasoningEffort:"high" in every mode: expected undefined to be 'high'

Test Files  1 failed (1)
     Tests  1 failed | 2 passed (3)
```

The openai-completions case and the vacuity guard (`captures.length === 2`) both passed in the same run, proving the harness itself was sound and only the Bedrock branch was broken.

## Files Created/Modified

- `tests/integration/gate10-nested-thinking.test.ts` — new: registers two faux providers under `openai-completions` and `bedrock-converse-stream`, drives `runSingleShotRole` for `reviewer` in `cheap` and `max`, and asserts the per-api options shape at the response factory (no wire log, no diagnostics extension, no warm-up prompt needed).
- `.pi/extensions/routing/modes.ts` — added `buildNestedApiOptions`; replaced the inline ternary at the old line 409; added `RunSingleShotRoleOptions.tools` and threaded it to both dispatch branches; updated `runSingleShotRole`'s docstring.
- `tests/unit/routing-dispatch.test.ts` — added a `buildNestedApiOptions` describe block: the undefined-effort short circuit, the three named api cases, the historical-default case for an unrecognised api id, and the CHAIN-hop homogeneity case.
- `tests/unit/workflow-budgets.test.ts` — updated the `.pi/extensions/routing` directory line-budget ratchet from 2230 to 2360 (measured total after this change) with the `why` field's measured figure updated to match.

## Decisions Made

- **Register faux providers by their `ROLE_MAP`-resolved `{provider,id}`, never a hardcoded literal.** Both candidates in the integration test are read out of `ROLE_MAP.cheap.reviewer.candidates[0]` and `ROLE_MAP.max.reviewer.candidates[0]`, so the test tracks `schema.ts` rather than silently testing a candidate the router no longer resolves.
- **Interleave register → grant auth → wait per faux provider, never batch both registrations before authing either.** `ModelRuntime#registerNativeProvider` fires a fire-and-forget UNSCOPED `refresh()` that bumps every provider's internal availability sequence number, including one already mid-flight. Registering two faux providers back-to-back and only then awaiting `setRuntimeApiKey` for each raced the two unscoped refreshes against the targeted ones and left the first-registered provider (`deepseek`) permanently unconfigured — reproduced: still `false` after 4s of polling with no error recorded. Discovered and fixed via a throwaway debug harness (deleted before this commit) before writing the real fixture this way from the start.
- **`buildNestedApiOptions`'s `default` case is the openai-completions shape, not a throw**, despite the plan's action text asking for a `default: { const exhaustive: never = model.api; }` idiom. See Deviations below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `default: never` exhaustiveness idiom does not compile against `Api`**
- **Found during:** Task 2 (writing `buildNestedApiOptions`)
- **Issue:** The plan asked for a `default:` branch using `const exhaustive: never = model.api;`, copying `safety/shell.ts:576-579`'s idiom. `Api` is `KnownApi | (string & {})` (`pi-ai types.d.ts:16`) — an intentionally open union so a custom `models.json` entry can carry an api id outside pi-ai's own catalogue (PROV-06). Verified by compiling the exact idiom against this type in isolation: `tsc` reports TS2322, `"google-generative-ai" | (string & {})` is not assignable to `never`, because equality narrowing over literal `case`s cannot exclude the open `(string & {})` fallback arm. `safety/shell.ts`'s own `cause` type has no such open arm, which is why the idiom works there and not here.
- **Fix:** `buildNestedApiOptions`'s `default` case is documented as a runtime catch-all rather than a compile-time-exhaustive one, with the reasoning recorded in the function's own docstring.
- **Files modified:** `.pi/extensions/routing/modes.ts`
- **Verification:** `npx tsc --noEmit` clean.
- **Committed in:** `7ca2315` (Task 2 commit)

**2. [Rule 1 - Bug] A runtime-throwing `default` broke a required-green, plan-external test**
- **Found during:** Task 2, after wiring the throwing `default` in per (1) above
- **Issue:** `tests/integration/single-shot-roles.test.ts` (not in this plan's `files_modified`, and explicitly required to stay GREEN by the plan's own acceptance criteria) builds its `deepseekFaux` via `fauxProvider({provider:"deepseek", models:[...]})` with no `api` option. pi-ai's `fauxProvider` then assigns a RANDOM api id (`faux:<timestamp>:<random>`, `pi-ai src/providers/faux.js:297`) — neither `"openai-completions"` nor any other `KnownApi` member. A throwing `default` turned 2 of that file's previously-passing tests red with `buildNestedApiOptions: unrecognised model.api "faux:...:..."`.
- **Fix:** `default` (and the explicit `openai-completions` case) both return `{reasoningEffort: effort}` — the historical shape every api got before this fix, preserved for every api this function has not been told how to handle. Only `bedrock-converse-stream` changed behaviour; `anthropic-messages` still throws (a deliberate, narrow exception — see the plan's own Assumption A3 reasoning, unchanged). The fix's scope stayed exactly as narrow as the actual defect: one branch corrected, one branch added, everything else untouched.
- **Files modified:** `.pi/extensions/routing/modes.ts`
- **Verification:** `npx vitest run tests/integration/single-shot-roles.test.ts` green (9/9); `npx vitest run tests/integration/gate10-nested-thinking.test.ts` green (3/3); full suite (`tests/unit tests/integration`) green, 1800/1800.
- **Committed in:** `7ca2315` (Task 2 commit)

**3. [Rule 3 - Blocking] `.pi/extensions/routing` directory line-budget ratchet tripped by the new function**
- **Found during:** Task 2, running the full suite after the fix
- **Issue:** `tests/unit/workflow-budgets.test.ts`'s WR-03 anti-offloading ratchet asserts `.pi/extensions/routing`'s total raw line count against a pinned budget (2230). `buildNestedApiOptions` plus its docstring (including the Deviation 1/2 explanation above) pushed the directory to 2356 raw lines across 5 files, tripping the ratchet.
- **Fix:** Updated the budget entry to 2360 (measured total rounded up to the next ten) and updated the `why` field's measured figure and rationale, per the test's own instruction to do both in the same commit as the change that moved it.
- **Files modified:** `tests/unit/workflow-budgets.test.ts`
- **Verification:** `npx vitest run tests/unit/workflow-budgets.test.ts` green (49/49).
- **Committed in:** `7ca2315` (Task 2 commit)

**4. [Test-harness discovery, not a production bug] `ModelRuntime#registerNativeProvider`'s fire-and-forget unscoped refresh races a batched second registration**
- **Found during:** Task 1, building the integration test's two-faux-provider fixture
- **Issue:** Registering both faux providers (openai-completions and bedrock-converse-stream) back-to-back, then awaiting `setRuntimeApiKey` for each, left the first-registered provider (`deepseek`) permanently `hasConfiguredAuth() === false` — reproduced with a throwaway debug harness, deepseek stayed `false` after 4s of polling with `getError()` reporting no error. Root cause: `registerNativeProvider` fires `void this.refresh({ allowNetwork: false })` (`pi model-runtime.js:546-553`), an UNSCOPED refresh whose internal `queueAvailabilityRefresh` bumps every provider's availability sequence number, including one whose own targeted `refreshProviderAvailability` call is still in flight — a later bump discards the earlier call's result as stale even when that result was correct.
- **Fix:** The real fixture interleaves each provider's register → grant auth → wait cycle fully before registering the next, so no later registration's unscoped refresh can invalidate an earlier provider's already-settled state.
- **Files modified:** `tests/integration/gate10-nested-thinking.test.ts` (this is the shape the file was written in from the start; the debug harness that found this was created, used, and deleted, never committed)
- **Verification:** `npx vitest run tests/integration/gate10-nested-thinking.test.ts` green, both provider auth states remain `true` after the second provider's registration completes (asserted explicitly in the fixture).
- **Committed in:** `6dfd77e` (Task 1 commit)

---

**Total deviations:** 4 auto-fixed (2 Rule 3 blocking, 1 Rule 1 bug, 1 test-harness discovery documented for future authors)
**Impact on plan:** All four were necessary to land a compiling, fully-green fix without silently narrowing GATE-10's proof or breaking existing coverage. No scope creep — the production fix touches exactly the api this plan's objective names (Bedrock), and the `default`/`anthropic-messages` decisions are recorded rather than hidden.

## Issues Encountered

None beyond the four deviations above.

## User Setup Required

None — no external service configuration required. No `[RUNBOOK]` item executed; no provider inference request issued (all providers in this plan's tests are faux).

## Next Phase Readiness

- `buildNestedApiOptions` is now the sole producer of a nested call's `api` bag, exported and unit-tested; later GATE-10 plans in this phase can rely on it rather than re-deriving per-api shapes.
- `RunSingleShotRoleOptions.tools` is threaded and available for plans 03/07/08 (per the plan's own objective) to use for forced structured-output tool calls.
- No blockers carried forward.

---
*Phase: 08-quality-gates-engineering-quality*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `tests/integration/gate10-nested-thinking.test.ts`
- FOUND: `.planning/phases/08-quality-gates-engineering-quality/08-01-SUMMARY.md`
- FOUND: commit `6dfd77e`
- FOUND: commit `7ca2315`
