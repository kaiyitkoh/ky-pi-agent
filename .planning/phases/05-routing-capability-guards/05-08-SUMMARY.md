---
phase: 05-routing-capability-guards
plan: 08
subsystem: routing
tags: [routing, single-shot, callModel, faux-session, wire-proof, capability-guard, pi-extensions, typescript]

# Dependency graph
requires:
  - phase: 05-04
    provides: "routing/modes.ts's runSingleShotRole, getModeState, setMode, setEscalated, usesFallbackChain -- the pure plan/dispatch pipeline this plan drives against a real session"
  - phase: 02-diagnostics-the-instrument
    provides: "diagnostics/call-model.ts's callModel() chokepoint -- what runSingleShotRole dispatches through, and what actually writes the wire/turns rows this plan reads back"
  - phase: 03-provider-config
    provides: "providers/fallback.ts's callWithFallback() and providers/schema.ts's CHAIN -- the two-hop chain runSingleShotRole enters for a role whose first candidate is a CHAIN member"
provides:
  - "tests/integration/single-shot-roles.test.ts -- ROUTE-04's session-level [FAUX] proof: nested-row identity, no-session-mutation, per-call reasoning effort on the wire (both directions), and a guard refusal that costs zero requests"
affects: [docs/ROUTING.md, REQUIREMENTS.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ExtensionContext obtained via AgentSession#extensionRunner.createCommandContext(), not a globalThis-parking probe -- routing/modes.ts is a plain named-export module (never loaded as an extension), so the only thing needing a live context is the direct call to runSingleShotRole, and createCommandContext() hands one back synchronously with no warm-up prompt required for that purpose"
    - "the diagnostics extension is still loaded (via extensionSource, still no probe) purely so the main-loop warm-up prompt writes a role:\"session\" turns row -- callModel itself needs no extension registered at all, since it writes wire-*/turns-* directly"
    - "a second faux provider is registered under the real \"deepseek\" provider id, separately from the session's own default faux model, then granted auth via ModelRuntime#setRuntimeApiKey + a polled waitForConfiguredAuth -- the exact seam mode-switch.test.ts (05-07) measured and documented"

key-files:
  created:
    - tests/integration/single-shot-roles.test.ts
  modified: []

key-decisions:
  - "the deepseek faux model's input is explicitly pinned to [\"text\"] rather than left at fauxProvider's own default of [\"text\",\"image\"] -- the guard-refusal case needs a candidate that resolves AND has configured auth AND still fails the capability guard, and fauxProvider's default input would make an image-need guard block impossible to construct against this fixture"
  - "the guard-refusal case reuses the \"summariser\" role (rather than \"vision\", the plan's own example) so the SAME candidate order (FLASH_CANDIDATES) that the reviewer/summariser positive cases already exercise is what the guard blocks -- \"vision\" always resolves to Bedrock Claude in ROLE_MAP, which supports image input by construction and could never demonstrate this refusal"
  - "no model_change / ky:mode delta assertion is against an ABSOLUTE zero before the call, only a DELTA of zero across it -- session construction itself writes one model_change entry recording the session's own initial model (found by the first run of this exact assertion failing: 'expected 1 to be +0'), so an absolute-zero claim would have been false of the fixture, not of runSingleShotRole"
  - "the reviewer role's candidate is byte-identical to CHAIN[0] in providers/schema.ts, so usesFallbackChain reports true and runSingleShotRole dispatches through callWithFallback rather than a direct callModel -- only the deepseek faux registration exists in this fixture (dashscope is never registered), which is sufficient because the first hop always succeeds and the chain never needs to advance"

patterns-established:
  - "A test needing a live ExtensionContext to call a plain (non-extension) routing module directly does not need call-model.test.ts's globalThis-probe machinery at all -- session.extensionRunner.createCommandContext() is simpler and sufficient whenever the context is consumed directly in the test body rather than inside an extension's own event handler"

requirements-completed: [ROUTE-04]
requirements-partial: []
# ROUTE-04 moves from Partial (05-04: pure plan/dispatch pipeline proven at
# the unit level, [FAUX] session-level proof explicitly deferred) to Complete
# with this plan: tests/integration/single-shot-roles.test.ts is the
# session-level proof 05-04-SUMMARY.md named as outstanding.

# Metrics
duration: ~35min
completed: 2026-08-14
---

# Phase 5 Plan 8: Single-Shot Roles Session Proof Summary

**`tests/integration/single-shot-roles.test.ts` drives `runSingleShotRole` against a real `createAgentSession`, obtaining its `ExtensionContext` via `createCommandContext()` rather than a probe, and proves all three of ROUTE-04's properties with a paired control each: one `kind:"nested"` row under the caller's own role name, the session's active model unchanged (provider+id, never object identity) with no new `model_change`/`ky:mode` entry, per-call `reasoningEffort` reaching the wire only for the roles that declare it, and a capability-guard refusal that issues zero requests.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-14T18:10:17+08:00
- **Tasks:** 2 completed (implemented together in one file — see Deviations)
- **Files modified:** 1 (created)

## Accomplishments

- `tests/integration/single-shot-roles.test.ts` (7 `it` cases plus one vacuity/identity case) proves, against one shared fixture built in a single `beforeAll`:
  - **Case 0** — the `deepseek` faux registration really replaced Pi's built-in catalogue entry for that provider id (the resolved model's `api` matches this run's faux `api`), mirroring `fallback-chain.test.ts`'s own identity guard.
  - **Case 0b** — the main-loop warm-up prompt's `kind:"turn"` row carries `role: "session"` (`SESSION_TURN_ROLE`), stated explicitly per `05-RESEARCH.md` Pitfall 1 so a later reader cannot mistake the executor path for a role-filtered one.
  - **Case 1** — driving `runSingleShotRole` for the `reviewer` role writes exactly one `kind:"nested"` row with `role: "reviewer"`, with a non-vacuity check on the turns log preceding the row lookup and a failure message naming every `(kind, role)` pair actually found.
  - **Case 2** — `ctx.model?.provider`/`ctx.model?.id` are byte-identical before and after the call (never object identity, per the plan's own instruction).
  - **Case 3** — no `model_change` and no `ky:mode` session entry resulted from the call, asserted as a delta across the call (not an absolute zero before it — see Decisions).
  - **Case 4** — the reviewer call's captured `nested.request` wire payload carries `reasoning_effort: "high"`, cross-checked by a second, independent oracle: the faux provider's own response-factory saw `reasoningEffort: "high"` as an outgoing option.
  - **Case 5** — the paired negative: a `summariser` call (no declared reasoning effort in `routing/schema.ts`) produces a captured payload with no `reasoning_effort` field at all, and the same two-oracle cross-check confirms it. This is the case that would catch an implementation hardcoding `reasoningEffort: "high"` on every nested call.
  - **Case 6** — `runSingleShotRole("summariser", {need:{image:true}})` against the registered text-only `deepseek` fixture throws the capability guard's own reason verbatim (`"deepseek/deepseek-v4-flash is text-only... the summariser role needs image input"`), and both the turns log and the wire log are byte-identical in length before and after the throw — zero new requests, not merely "the specific role/kind is absent."
- The `ExtensionContext` this file drives `runSingleShotRole` with comes from `session.extensionRunner.createCommandContext()`, not from `call-model.test.ts`'s `globalThis`-parking probe extension — `routing/modes.ts` is a plain named-export module the test imports directly (never loaded as a Pi extension itself), so nothing needs to observe a context handed to an extension's own hook. `mode-switch.test.ts` (05-07) already proved this context reflects live session mutations (`ctx.model` changes after a real `pi.setModel`), which is the property the model-unchanged assertion in case 2 depends on. The diagnostics extension is still loaded via `extensionSource` (still with no probe) purely so the warm-up prompt's main-loop turn row exists for case 0b — `callModel` itself needs no extension registered at all.
- A second `deepseek` faux provider is registered separately from the session's own default faux model, exactly following `mode-switch.test.ts`'s measured `setRuntimeApiKey` + polled `waitForConfiguredAuth` seam (a faux provider under a real provider id still resolves `hasConfiguredAuth` `false` until the cached availability snapshot catches up).

## Task Commits

Both plan tasks were implemented in a single coherent file and committed together (see Deviations for why):

1. **Tasks 1 & 2: `tests/integration/single-shot-roles.test.ts`** — `0bf94b4` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `tests/integration/single-shot-roles.test.ts` — ROUTE-04's session-level proof: nested-row identity, no-session-mutation, per-call reasoning effort on the wire (both directions), guard refusal costs nothing

## Verification Evidence

- `npx vitest run tests/integration/single-shot-roles.test.ts tests/integration/call-model.test.ts` — 2 files / 16 tests, all green
- `npm run typecheck` (`tsc --noEmit`) — clean, no output
- `npx vitest run` (full suite) — **75 test files, 1315 tests, all passed** (29.25s)

## Decisions Made

See `key-decisions` in the frontmatter for the full list with citations. Summarized:

- The `deepseek` fixture model's `input` is pinned to `["text"]` explicitly, because `fauxProvider`'s own default (`["text","image"]`) would make the guard-refusal case unconstructible against a candidate that both resolves and carries configured auth.
- The guard-refusal case uses role `"summariser"` rather than the plan's own `"vision"` example, because `"vision"` always resolves to Bedrock Claude in `ROLE_MAP` (image-capable by construction) and could never demonstrate an image-need refusal.
- The no-mutation assertion (case 3) is a delta-of-zero across the call, not an absolute-zero before it — the first run of an absolute-zero assertion failed (`expected 1 to be +0`) because session construction itself writes one `model_change` entry for the session's own initial model. Corrected to the honest claim: nothing changed as a *result of* `runSingleShotRole`.
- The reviewer call's resolved candidate (`deepseek/deepseek-v4-flash`) is byte-identical to `CHAIN[0]`, so `runSingleShotRole` dispatches through `callWithFallback` rather than a direct `callModel` — only the `deepseek` faux registration is needed in this fixture since the first hop always succeeds.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The "no session mutation" assertion was initially written against an absolute-zero baseline that does not hold**
- **Found during:** first test run, case 3 ("no model_change entry and no ky:mode entry resulted from the call")
- **Issue:** The assertion claimed `modelChangeCountBefore` must be `0`. It was `1`, because `createAgentSession` itself writes a `model_change` entry recording the session's initial model at construction time — a fact about session construction, not about `runSingleShotRole`.
- **Fix:** Rewrote the assertion to check the DELTA across the call (`after - before === 0`) for both `model_change` and `ky:mode` entries, with a comment explaining why an absolute baseline is the wrong claim to make.
- **Files modified:** `tests/integration/single-shot-roles.test.ts`
- **Verification:** re-ran the file; all 8 cases green.
- **Committed in:** `0bf94b4` (fixed before the commit was made — the failing intermediate state was never committed)

### Scope note (not a deviation from acceptance criteria, but from the plan's literal task split)

The plan describes Task 1 (nested-row identity / no-mutation) and Task 2 (payload capture / guard refusal) as separable commits extending the same file. Both were implemented together in one `Write` because they share one `beforeAll` fixture (`runFixture()`) whose reviewer/summariser/guard-refusal calls are interdependent (the guard-refusal case's "zero new rows" claim is measured relative to the reviewer call's own row count, and the no-effort negative reuses the same fixture's summariser call). Splitting the commit would have required either a contrived intermediate file that duplicated fixture setup, or committing a half-finished fixture that did not itself satisfy Task 1's acceptance criteria in isolation. All of Task 1's and Task 2's acceptance criteria are independently satisfied by the single committed file; both `npx vitest run` invocations named in the plan's per-task `<verify>` blocks pass against it.

**Total deviations:** 1 auto-fixed (1 bug in the test's own first-draft assertion, caught and fixed before committing) plus 1 scope note (task-split-to-commit-split, not an acceptance-criteria gap).
**Impact on plan:** None on the requirement. ROUTE-04's full acceptance criteria (both tasks') are met by the committed file, and the full suite is green.

## Issues Encountered

None beyond the one auto-fixed assertion above, caught by running the test itself rather than by inspection.

## User Setup Required

None — no external service configuration required. Every auth grant in this file is a `ModelRuntime#setRuntimeApiKey` call against a faux provider; this machine has no live credentials and none were needed.

## Next Phase Readiness

- ROUTE-04 is now complete: the pure plan/dispatch pipeline (05-04, unit-proven) plus this plan's session-level proof together cover both halves the requirement names — dispatch through the chokepoint with per-call reasoning effort, and no session mutation.
- `REQUIREMENTS.md` line 78/279 should be updated from `[~]` Partial to `[x]` Complete for ROUTE-04 (handled in this plan's state-update step via `requirements mark-complete`).
- What this plan does NOT prove, stated explicitly in the test file's own header: whether DeepSeek V4 Flash actually HONOURS `reasoning_effort` (that is `RB-02-01`, OUTSTANDING) and whether a cheaper thinking tier is viable (`RB-03-04`, OUTSTANDING, and the reason `routing/schema.ts` fixes `reasoningEffort` per role rather than per mode per STATE.md's blocker R1). Neither is reported as passing here.
- Full repo suite verified green after this plan: 1315 tests / 75 files, `tsc --noEmit` clean.
- No blockers for the next plan in this phase's wave.

## Self-Check: PASSED

- FOUND: `tests/integration/single-shot-roles.test.ts`
- FOUND: `.planning/phases/05-routing-capability-guards/05-08-SUMMARY.md`
- FOUND commit: `0bf94b4` (Tasks 1 & 2)

---
*Phase: 05-routing-capability-guards*
*Completed: 2026-08-14*
