---
phase: 05-routing-capability-guards
plan: 04
subsystem: routing
tags: [routing, dispatch, mode-state, globalThis, pi-extensions, typescript]

# Dependency graph
requires:
  - phase: 05-01
    provides: "routing/schema.ts's ROLE_MAP, ROLE_MECHANISM, ModelRef, KyModeData, DEFAULT_MODE, ESCALATION_MODE"
  - phase: 05-02
    provides: "routing/guard.ts's guardRoute(), GuardNeed -- the capability guard planRoleCall runs before reporting a mechanism"
  - phase: 02-diagnostics-chokepoint
    provides: "diagnostics/call-model.ts#callModel() -- the chokepoint runSingleShotRole dispatches through"
  - phase: 03-provider-config
    provides: "providers/fallback.ts#callWithFallback() and providers/schema.ts#CHAIN -- the fixed two-hop fallback chain runSingleShotRole consults via usesFallbackChain()"
provides:
  - ".pi/extensions/routing/modes.ts -- getModeState, setMode, setEscalated, resolveRoute, pickConfiguredCandidate, planRoleCall, runSingleShotRole, usesFallbackChain, usesToolLoop"
  - "tests/unit/routing-dispatch.test.ts -- 15 cases proving resolution, auth-skipping, guard precedence and chain selection with no session"
affects: [05-05, 05-06, docs/ROUTING.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Plan/dispatch split: resolveRoute -> pickConfiguredCandidate -> planRoleCall are pure (no ctx, no I/O); only runSingleShotRole touches a session, and it is a thin wrapper that calls planRoleCall then dispatches through callModel()/callWithFallback()"
    - "Mode/escalation state on a globalThis-keyed slot, following diagnostics/index.ts's ROWS_WRITTEN_KEY pattern -- closes the same jiti dual-module-instance hazard for /max visibility instead of request counts"
    - "ROUTE-08's usesToolLoop(role) scope is computed in exactly one place (planRoleCall) and spliced into GuardNeed there -- a caller's RoleNeed type has no usesToolLoop field at all, so it cannot be set independently by mistake"

key-files:
  created:
    - .pi/extensions/routing/modes.ts
    - tests/unit/routing-dispatch.test.ts
  modified: []

key-decisions:
  - "usesToolLoop is derived from ROLE_MECHANISM inside planRoleCall itself, not accepted as a field on the caller-facing RoleNeed type (RoleNeed = Omit<GuardNeed, \"usesToolLoop\">) -- this makes 'ROUTE-08's scope is decided in one place' a type-level guarantee, not just a documented convention"
  - "pickConfiguredCandidate's refusal reason distinguishes '(did not resolve)' from '(no configured auth)' per candidate, rather than one generic 'unavailable' label -- proven by a dedicated test asserting both substrings appear for a mixed-failure candidate list"
  - "runSingleShotRole asserts plan.mechanism === \"call-model\" and throws otherwise, even though the plan's own routing (ROLE_MECHANISM) should never hand a tool-loop role to this dispatcher -- a defensive check against a future ROLE_MECHANISM edit that silently widens the set this function is called for"
  - "the falsification target was the SUCCESS branch, not the failure branch: moving 'compute mechanism' before the guard call alone changes nothing observable (the ok:false return still omits mechanism), so the mutation instead built the ok:true value before the guard ran and let the guard's verdict fall on the floor -- this is what a real 'guard runs after mechanism is decided' bug would look like, and it is the mutation that actually turned the guard-precedence tests red"

patterns-established:
  - "A refusal is a discriminated-union arm with no mechanism field at all, not an ok:true value with a null mechanism -- 'never reports a mechanism' is enforced by the type checker on every ok:false return, not just tested at runtime"

requirements-completed: [ROUTE-01, ROUTE-04]

# Metrics
duration: ~15min
completed: 2026-08-14
---

# Phase 5 Plan 4: Routing Dispatch (modes.ts) Summary

**Pure `routing/modes.ts` pipeline (resolve → pick a configured candidate → guard → report mechanism) plus a thin impure single-shot dispatcher that calls `callModel()`/`callWithFallback()` and mutates no session state — proven by a 15-case fixture table with a falsification that moves the guard after the mechanism decision and watches two tests go red.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-08-14T13:52Z
- **Tasks:** 2 completed
- **Files modified:** 2 (both created)

## Accomplishments

- `.pi/extensions/routing/modes.ts` exports `getModeState`, `setMode`, `setEscalated` (mode/escalation state on a single `globalThis`-keyed slot, citing `diagnostics/index.ts:192-224`'s jiti dual-module-instance fix), `resolveRoute` (escalation lifts the `executor` role only), `pickConfiguredCandidate` (structural `{find, hasConfiguredAuth}` registry, ordered candidate walk, auth-skip distinct from resolution-failure, refusal names every candidate tried), `planRoleCall` (binding order: resolve → pick candidate → `guardRoute()` → report mechanism, guard refusal returned verbatim), `runSingleShotRole` (dispatches through `callWithFallback()` when the resolved `{provider,id}` is a `CHAIN` member, `callModel()` directly otherwise, no `signal` override, no session mutation), and the two pure mechanism helpers `usesToolLoop`/`usesFallbackChain`.
- `tests/unit/routing-dispatch.test.ts` (15 cases) proves: escalated vs non-escalated executor routes differ while every other role's route is identical either way; the same two-candidate list exercised in both auth directions (first-authed-wins, then first-unauthed-second-wins) so the auth skip is proven on auth, not resolution; a refusal names every candidate tried and distinguishes "did not resolve" from "no configured auth"; `planRoleCall`'s guard-blocked reason is byte-identical to `guardRoute()`'s own reason for the same model/role/need; a guard-blocked plan is `ok:false` with no `mechanism` key at all (asserted via `"mechanism" in result`); `usesToolLoop` is true for executor/planner and false for the four single-shot roles; `usesFallbackChain` is asserted against the imported `CHAIN` (length-checked first) with no literal id list in the test; mode-state round-trips through the public `setMode`/`setEscalated`/`getModeState` API, reset between cases via a helper whose own no-op-ness is proven by a dedicated mutate-then-reset-then-assert-default test.
- Falsification executed per the plan's acceptance criteria: moved the `guardRoute()` call in `planRoleCall` to run AFTER the `ok:true` success value (including `mechanism`) was already built, so the guard's verdict was computed but discarded. Ran `tests/unit/routing-dispatch.test.ts` and got exactly the two targeted failures — `"returns the GUARD's own reason..."` (`expected a refusal, got {"ok":true,...,"mechanism":"call-model"}`) and `"guard precedence: ... NEVER reports a mechanism"` (`expected true to be false`) — with the other 13 cases unaffected. Restored via `git checkout --` (modes.ts was already committed from Task 1, so this was safe per the project's own recorded lesson about that command against uncommitted work); `git diff` after restoration was empty.
- Both structural gates pass: `chokepoint-lint.test.ts` (no forbidden `modelRegistry.complete`/`.stream`/`.getProvider`/`ModelRuntime`, including in comments) and `extension-layout.test.ts` (named-exports-only module correctly classified as a nested, non-entry-point file). The plan's own acceptance-criteria greps (`modelRegistry\s*\.\s*(complete|...)|ModelRuntime` and `ctx.model =\|setModel\|appendEntry`) both report zero matches against `modes.ts`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write `.pi/extensions/routing/modes.ts`** — `ad0914d` (feat)
2. **Task 2: `tests/unit/routing-dispatch.test.ts`** — `ab0c710` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `.pi/extensions/routing/modes.ts` — ROUTE-01/04/09's routing pipeline: state, resolution, guard invocation, single-shot dispatch
- `tests/unit/routing-dispatch.test.ts` — fixture-table proof of resolution, auth-skipping, guard precedence and chain selection, 15 cases

## Verification Evidence

- `npx vitest run tests/unit/routing-dispatch.test.ts tests/unit/routing-map.test.ts tests/unit/capability-guard.test.ts` — 3 files / 79 tests, all green
- `npx vitest run tests/unit/routing-dispatch.test.ts tests/unit/chokepoint-lint.test.ts tests/unit/extension-layout.test.ts` — 3 files / 31 tests, all green
- `npm run typecheck` (`tsc --noEmit`) — clean, no output, both before and after the falsification restore
- `npx vitest run` (full suite) — **71 test files, 1272 tests, all passed** (30.56s)
- Acceptance-criteria greps against `modes.ts`: `modelRegistry\s*\.\s*(complete|completeSimple|stream|streamSimple|getProvider)|getRegisteredNativeProvider|ModelRuntime` → 0 matches; `ctx.model =\|setModel\|appendEntry` → count 0

## Decisions Made

- **`RoleNeed` (the caller-facing need type) omits `usesToolLoop` entirely**, rather than accepting it and overwriting it. `GuardNeed` carries `usesToolLoop?`, but `planRoleCall`'s `opts.need: RoleNeed = Omit<GuardNeed, "usesToolLoop">` makes it a compile error for a future caller to pass one — the value is always `usesToolLoop(opts.role)`, computed fresh inside `planRoleCall`. This turns "ROUTE-08's scope is decided in one place" (05-02's own decision) from a documented convention into something the type checker enforces on this file's own call sites too.
- **The falsification target was chosen for real observable effect, not textual proximity to "guard after mechanism".** An initial mutation that only reordered *when* `ROLE_MECHANISM[opts.role]` was computed relative to the guard call changed nothing observable, because the `ok:false` return path never included `mechanism` regardless of ordering — that mutation would have produced a false "still green" result if run. The mutation actually used instead builds the full `ok:true` result (mechanism included) before the guard call, then discards the guard's verdict — which is what a real "guard doesn't gate the mechanism" regression looks like, and it is what turned the two targeted tests red.
- **`runSingleShotRole` defensively asserts `plan.mechanism === "call-model"`** and throws a named error otherwise, even though nothing in the current `ROLE_MECHANISM` table can produce a different mechanism for a role this function is meant to serve. This is Rule 2 (missing critical functionality: a wrong-mechanism dispatch would otherwise silently attempt a `callModel()` for a role that actually needs a tool loop, e.g. if a future edit to `schema.ts` reassigns `planner`'s mechanism without updating every caller).

## Deviations from Plan

None — plan executed exactly as written. The `RunSingleShotRoleOptions`/`PlanRoleCallOptions`/`ModeState`/`RoleNeed`/`ModelRegistryLike` type exports are additions beyond the plan's named export list (`getModeState, setMode, setEscalated, resolveRoute, pickConfiguredCandidate, planRoleCall, runSingleShotRole, usesFallbackChain, usesToolLoop`), but they are the option/result types those functions' own signatures require callers to reference — TypeScript would not let a downstream module call `planRoleCall` with a correctly-typed `opts` argument without them being exported, so this is scope required by the plan's own artifact rather than scope added to it.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- ROUTE-01 (resolution) and ROUTE-04 (single-shot dispatch through the chokepoint, per-call reasoning effort, no session mutation) are both exercised end-to-end at the pure-function level. `runSingleShotRole` itself is not exercised against a real or faux session in this plan — per the plan's own docstring note, that is `tests/integration/single-shot-roles.test.ts` (plan 06)'s job, and this plan's own test file only imports the functions it actually tests.
- `modes.ts` is ready for a later plan's `routing/index.ts` (the mode-switch commands `/cheap`/`/balanced`/`/max`/`/escalate` and the `session_start` restore hook) to import `getModeState`/`setMode`/`setEscalated`/`resolveRoute` — ROUTE-02/03/09 are not this plan's scope and remain for that later plan.
- Full repo suite verified green after this plan: 1272 tests / 71 files, `tsc --noEmit` clean.
- No blockers for the next plan in wave 2.

## Self-Check: PASSED

- FOUND: `.pi/extensions/routing/modes.ts`
- FOUND: `tests/unit/routing-dispatch.test.ts`
- FOUND: `.planning/phases/05-routing-capability-guards/05-04-SUMMARY.md`
- FOUND commit: `ad0914d` (Task 1)
- FOUND commit: `ab0c710` (Task 2)

---
*Phase: 05-routing-capability-guards*
*Completed: 2026-08-14*
