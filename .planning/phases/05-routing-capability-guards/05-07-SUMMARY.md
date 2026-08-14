---
phase: 05-routing-capability-guards
plan: 07
subsystem: routing
tags: [routing, extension-entry-point, commands, setModel, session-entries, faux-session, pi-extensions, typescript]

# Dependency graph
requires:
  - phase: 05-01
    provides: "routing/schema.ts's ROLE_MAP, MODES, MODE_ENTRY_TYPE, KyModeData, ROUTING_EVENT"
  - phase: 05-02
    provides: "routing/guard.ts's guardRoute()"
  - phase: 05-04
    provides: "routing/modes.ts's resolveRoute, pickConfiguredCandidate, ModeState, setMode, setEscalated"
  - phase: 05-05
    provides: "routing/agent-overrides.ts's agentOverridesFor, writeAgentOverrides"
provides:
  - ".pi/extensions/routing/index.ts -- the extension entry point, registering /cheap, /balanced, /max through one shared applyMode helper"
  - "tests/integration/mode-switch.test.ts -- ROUTE-02's session-driven proof, both directions, against a real createAgentSession"
affects: [05-08, 05-09, 05-10, 05-11, docs/ROUTING.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Command handlers invoked directly via AgentSession#extensionRunner.getCommand(name).handler(args, ctx) + extensionRunner.createCommandContext(), with no session.prompt() warm-up needed -- command registration and createCommandContext() are both available immediately after createAgentSession returns, unlike the event-hook probes earlier integration tests needed"
    - "ctx.ui overridden via Object.defineProperty (it is a getter-only accessor transplanted from createContext()); ctx.waitForIdle overridden via plain reassignment (it is a plain writable data property assigned inside createCommandContext() itself) -- two different override techniques for two differently-shaped properties on the same object"
    - "Ordering proven via a globalThis-keyed shared log written from two separate jiti module graphs (the test file's ctx.waitForIdle wrapper, and the loaded extension's own model_select probe hook), non-emptiness asserted before the ordering comparison"

key-files:
  created:
    - .pi/extensions/routing/index.ts
    - tests/integration/mode-switch.test.ts
  modified: []

key-decisions:
  - "applyMode calls resolveRoute + pickConfiguredCandidate + guardRoute directly (not modes.ts's combined planRoleCall) so the four-step order the plan specifies (resolve/pick, guard, setModel, mode-state-then-overrides) is legible in index.ts's own body rather than folded into a helper written for a different caller"
  - "an explicit mode switch (/cheap, /balanced, /max) clears any sticky /escalate state -- resolveRoute is always called with escalated:false, and setEscalated(false) runs alongside setMode(mode) on a successful switch, per the plan's own step-5 instruction to 'clear any escalation'"
  - "the ky:mode payload never carries a model id, matching schema.ts's own MODE_ENTRY_TYPE docstring -- Pi's native model_change session entry already persists and restores the executor model"
  - "a faux provider registered under a real provider id (\"deepseek\") still resolves ModelRuntime#hasConfiguredAuth false, exactly as tests/helpers/session.ts's own docstring warns -- the working seam is ModelRuntime#setRuntimeApiKey(providerId, apiKey) (no network: synchronizeCredentialState explicitly calls models.refresh({allowNetwork:false})), but the awaited promise resolving is NOT sufficient by itself: hasConfiguredAuth reads a CACHED snapshot that lags the live, uncached checkAuth() by a few milliseconds (measured: 5 consecutive runs against a bare ModelRuntime, 1-6ms setRuntimeApiKey duration, hasConfiguredAuth false immediately after, true after 1-2ms of polling). mode-switch.test.ts polls with a real timeout (waitForConfiguredAuth) rather than a fixed sleep guess."
  - "the session under test starts on a DIFFERENT model (faux's own default, faux/faux-flash) than any mode's executor target (deepseek/deepseek-v4-flash) -- AgentSession#_emitModelSelect skips the model_select event ENTIRELY when modelsAreEqual(previousModel, nextModel) (dist/core/agent-session.js:1182-1191), so a session that already started on the switch target would report pi.setModel()===true while firing NO event at all, an actual failure the first run of this file caught (log length 1, not 2)"
  - "the plan's 'pi.setModel returning false is surfaced as a refusal' and 'no configured candidate' behaviors are proven as ONE scenario, not two, because pi.setModel's own wrapper pre-check and pickConfiguredCandidate both read the identical ModelRuntime#hasConfiguredAuth(provider) state -- a candidate pickConfiguredCandidate accepts can never independently make pi.setModel return false in this harness outside the TOCTOU race index.ts's try/catch defends against defensively but which needs a real race to exercise, not a fixture. Task 1's own acceptance criteria (a static grep) separately proves every pi.setModel call site is wrapped and boolean-checked; this file proves the runtime behavior that wrapping exists for."
  - "ROUTE-09 is left PARTIAL, not marked complete by this plan, even though it is in this plan's requirements frontmatter -- this plan's own read_first note says index.ts's session_start hook is extended 'in plan 09', and RESEARCH's own Wave-0 gap list assigns the 'zero context tokens' proof (asserting the ky:mode payload appears in no outgoing captured request) to a separate tests/integration/mode-persistence.test.ts this plan does not create. Only the persist half (pi.appendEntry writing a real ky:mode entry into a real session's branch) is proven here."

patterns-established:
  - "A command-registering extension entry point can be driven end to end offline via extensionRunner.getCommand + createCommandContext, with property-level overrides (defineProperty for accessors, plain assignment for data properties) standing in for a real UI/idle-wait, rather than a stubbed ExtensionCommandContext object built by hand"

requirements-completed: [ROUTE-02]
requirements-partial: [ROUTE-09]
# ROUTE-05 was already [x] complete in REQUIREMENTS.md from plan 05-05; this
# plan wires its write into the live command flow and proves it end-to-end
# against a real session (case 2), but does not itself flip a checkbox that
# was already flipped.
# ROUTE-09 stays partial: the persist half (pi.appendEntry writing a real
# ky:mode entry) is proven; the session_start restore hook (explicitly
# deferred to "plan 09" per this plan's own read_first note) and the
# "zero context tokens" wire-capture proof (assigned to a separate
# mode-persistence.test.ts in 05-RESEARCH.md's own Wave-0 gap list) are not
# built by this plan.

# Metrics
duration: ~50min
completed: 2026-08-14
---

# Phase 5 Plan 7: Routing Extension Entry Point and Mode Commands Summary

**`.pi/extensions/routing/index.ts` registers `/cheap`, `/balanced`, `/max` through one shared `applyMode` helper (waitForIdle → resolve+pick-candidate → guard → `setModel` try/catch-and-boolean-checked → mode state → `ky:mode` entry → `agentOverrides` write → `ROUTING_EVENT` → one notify), proven in a real `createAgentSession` in both directions by a 5-case integration test that measures — rather than assumes — how a faux provider registered under a real provider id gets configured auth in this harness.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-08-14T14:30:00Z
- **Completed:** 2026-08-14T14:38:30Z
- **Tasks:** 2 completed
- **Files modified:** 2 (both created)

## Accomplishments

- `.pi/extensions/routing/index.ts` — the routing extension's only entry point, registering exactly the invocation names `cheap`, `balanced`, `max` from `schema.ts`'s `MODES` constant in a single loop, so the three commands cannot drift from one another. `applyMode` executes the plan's exact six-step order: `await ctx.waitForIdle()` first; `resolveRoute("executor", {mode, escalated:false})` + `pickConfiguredCandidate(ctx.modelRegistry, route.candidates)`, refusing with every candidate named on failure; `guardRoute(candidate.model, "executor", {usesToolLoop:true})`, refusing with the guard's own reason verbatim; `pi.setModel(candidate.model)` inside `try`/`catch` with the boolean return checked explicitly, neither failure mode swallowed or followed by a silent substitution; on `true`, `setMode`/`setEscalated(false)` (an explicit mode switch clears any sticky escalation), a `ky:mode` entry via `pi.appendEntry` carrying no model id, `agentOverridesFor`/`writeAgentOverrides` with a refusal carried into the final message rather than written anyway, and `pi.events.emit(ROUTING_EVENT, ...)`; and finally one `ctx.ui.notify` naming the mode and the concrete `provider/id`, with any subagent-pin refusal appended to the same message.
- `tests/integration/mode-switch.test.ts` (5 cases) drives the real commands via `session.extensionRunner.getCommand(name).handler(args, ctx)` and `session.extensionRunner.createCommandContext()`, with the routing extension loaded at user scope through a probe extension source that also records every `model_select` event. Case 0 proves the three commands are really registered (fails loudly on `undefined`, never skips). Case 1 proves a switch with configured auth changes the executor, in the recorded order `waitForIdle` then `model_select` (non-emptiness of the shared ordering log asserted before the ordering comparison), and that the `ky:mode` entry lands on the real branch with `mode:"balanced"`, `escalated:false`. Case 2 proves the same successful switch writes `subagents.agentOverrides` (a non-empty object with a `planner` entry shaped `"<provider>/<id>"`) to a settings file at an injected `PI_CODING_AGENT_DIR` temp path. Case 3 proves a mode whose every executor candidate lacks configured auth is refused with a message naming BOTH `deepseek/deepseek-v4-flash` (registered, no auth) and `dashscope/deepseek-v4-flash` (never registered, does not resolve), leaves the session's model provider/id unchanged, still records `waitForIdle` as having run, records no `model_select` event, and writes no `ky:mode` entry. Case 4 proves the same refusal never creates a settings.json file at all.
- **Measured, not assumed**: a faux provider registered under a real provider id (`"deepseek"`) still resolves `ModelRuntime#hasConfiguredAuth` `false` — confirmed by direct probe against a bare `ModelRuntime`, matching `tests/helpers/session.ts`'s own docstring warning. The working seam, also measured rather than trusted from the type signature alone: `ModelRuntime#setRuntimeApiKey(providerId, apiKey)` performs no network call, but the awaited promise resolving is not sufficient — `hasConfiguredAuth` reads a cached snapshot that lags the live, uncached `checkAuth()` result by a handful of milliseconds (five consecutive runs: 1-6ms `setRuntimeApiKey` duration, `hasConfiguredAuth` false in the same tick the await returns, true after 1-2ms of polling). `mode-switch.test.ts`'s `waitForConfiguredAuth` polls with a real timeout rather than trusting a fixed sleep guess.
- **Falsification executed** per the acceptance criteria: `await ctx.waitForIdle()` was removed from `applyMode`'s step 1, `npx vitest run tests/integration/mode-switch.test.ts` was re-run, and exactly two targeted cases went red — case 1 (`"the ordering log is empty..."`, `expected 1 to be greater than or equal to 2`, since only the model-select side of the log filled and waitForIdle's own entry never did — actually the reverse also occurred symmetrically in case 3, `"waitForIdle was never recorded even though the command ran"`, `expected 0 to be greater than or equal to 1`), with the other 3 cases unaffected. The mutation was reverted; `git diff --stat .pi/extensions/routing/index.ts` after restoration was empty, and the full 5-case file re-ran green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write `.pi/extensions/routing/index.ts`** — `e3ca4b1` (feat)
2. **Task 2: `tests/integration/mode-switch.test.ts`** — `79afa70` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `.pi/extensions/routing/index.ts` — ROUTE-02/09's mode-switch commands and the ROUTE-05 write's live call site
- `tests/integration/mode-switch.test.ts` — session-driven proof, both directions, 5 cases

## Verification Evidence

- `npx vitest run tests/unit/extension-layout.test.ts tests/unit/chokepoint-lint.test.ts tests/unit/contributing-boundary.test.ts` — 3 files / 21 tests, all green (run both before AND after staging `index.ts` with `git add`, since `contributing-boundary`/`chokepoint-lint` scan `git ls-files` — an untracked file is invisible to them, so the post-stage run is the one that actually proves the file's prose never spells `registerTool` or a forbidden chokepoint route)
- `npx vitest run tests/integration/mode-switch.test.ts` — 1 file / 5 tests, all green
- `npm run typecheck` (`tsc --noEmit`) — clean, no output, run three times (after Task 1, after Task 2, after the falsification restore)
- `npx vitest run` (full suite) — **74 test files, 1307 tests, all passed** (31.30s)
- `git status --porcelain .pi/settings.json` — empty after the full run (every write in this plan's tests targets an injected `PI_CODING_AGENT_DIR`, never this repository's own tracked `.pi/settings.json`)
- Acceptance-criteria greps against `index.ts`: `grep -c "registerTool"` → 0; `grep -nE "modelRegistry\s*\.\s*(complete|completeSimple|stream|streamSimple|getProvider)|getRegisteredNativeProvider|ModelRuntime"` → no output

## Decisions Made

See `key-decisions` in the frontmatter for the full list with citations. Summarized:

- `applyMode` calls `resolveRoute`/`pickConfiguredCandidate`/`guardRoute` directly rather than `modes.ts`'s combined `planRoleCall`, keeping the plan's exact step order legible in one function body.
- An explicit mode switch clears any sticky `/escalate` state (`resolveRoute` always called with `escalated:false`; `setEscalated(false)` runs alongside `setMode`).
- The `ky:mode` entry never carries a model id (Pi's native `model_change` entry already persists/restores it).
- Auth for a faux provider under a real id requires `ModelRuntime#setRuntimeApiKey` **plus** a polled wait, not just an awaited call — a measured async gap between the cached `hasConfiguredAuth` snapshot and the live `checkAuth` result.
- The test session starts on a model DIFFERENT from every mode's executor target, because `AgentSession#_emitModelSelect` skips the event entirely when the model does not actually change — an actual failure this file's first run caught.
- The plan's two "setModel returns false" / "no configured candidate" behaviors collapse into one scenario in this harness, because both checks read identical `ModelRuntime` state; this is stated explicitly in the test file's own header rather than silently narrowing scope.
- **ROUTE-09 stays PARTIAL**, not marked complete, despite appearing in this plan's requirements frontmatter — the session_start restore hook and the "zero context tokens" wire-capture proof are explicitly out of this plan's scope per its own `read_first` note ("this file will extend [the session_start hook] in plan 09") and per `05-RESEARCH.md`'s own Wave-0 gap list (which assigns that proof to a separate `mode-persistence.test.ts`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The routing extension's own docstring initially spelled the literal substring `registerTool`**
- **Found during:** Task 1, immediately after writing `index.ts` and running the acceptance-criteria grep
- **Issue:** The BOUNDARY RULE section's prose ("No `pi.registerTool` call appears anywhere...") contained the exact substring `tests/unit/contributing-boundary.test.ts` matches across every tracked `.ts` under `.pi/extensions/` — since `routing/` carries no allowlist entry, this would fail that test's build-failing gate the moment the file was staged. The very first `vitest run` against the three structural gates passed only because the new file was still untracked (`git ls-files`-backed, so invisible pre-stage) — a vacuous pass, not a real one.
- **Fix:** Rewrote the section to describe the mechanism ("this file does not spell the call even in prose, to say it does not use it") without ever writing the contiguous string `registerTool`, matching the same dodge every sibling `routing/` file already uses for the chokepoint-lint equivalent.
- **Files modified:** `.pi/extensions/routing/index.ts`
- **Verification:** `grep -n "registerTool" .pi/extensions/routing/index.ts` → no output; `git add` the file then re-ran the three structural tests (21/21 green) — this time a real proof, since `git ls-files` now includes it.
- **Committed in:** `e3ca4b1` (Task 1 commit; caught and fixed before that commit was made)

---

**Total deviations:** 1 auto-fixed (1 bug, caught by the plan's own acceptance criteria before committing)
**Impact on plan:** No scope creep. The fix is entirely within Task 1's own stated acceptance criteria (the `registerTool` grep), caught by running that exact grep before committing rather than after.

## Issues Encountered

- The first run of `mode-switch.test.ts` (before the session's starting model was moved off the switch target) failed case 1 with an empty-past-index-0 ordering log — not a bug in the extension, but a bug in the test fixture: the session started on `deepseek/deepseek-v4-flash`, and every mode this file drives also resolves the executor to that same model, so `AgentSession#_emitModelSelect`'s `modelsAreEqual` short-circuit skipped the event entirely. Fixed by starting the session on the unrelated default faux model and registering `deepseek/deepseek-v4-flash` as a second, separate native provider after construction. Documented at length in the test file's own header so a future reader does not "simplify" the fixture back into a no-op switch.

## User Setup Required

None — no external service configuration required. This machine has no live credentials and none were needed: every auth grant in this plan's tests is a `ModelRuntime#setRuntimeApiKey` call against a faux provider, never a real key.

## Next Phase Readiness

- ROUTE-02 is complete: `/cheap`, `/balanced`, `/max` swap the executor via `pi.setModel()` from a command after `waitForIdle()`, proven in both directions against a real session.
- ROUTE-05's write is now wired into the live command flow and proven end-to-end (a real settings file, a real command, a real temp `PI_CODING_AGENT_DIR`) — the requirement itself was already `[x]` complete from plan 05-05.
- ROUTE-09 remains partial. What is proven: the `ky:mode` entry is written into a real session's branch on a successful switch, with no model id, and never written on a refusal. What is NOT yet built: the `session_start` restore hook (this plan's own `read_first` note names "plan 09" as the file that adds it) and the "zero context tokens" wire-capture proof (assigned by `05-RESEARCH.md`'s Wave-0 gap list to a separate `tests/integration/mode-persistence.test.ts`). A later plan in this phase must build both before ROUTE-09 can be marked complete.
- `/escalate` itself (ROUTE-03) is not this plan's scope — `index.ts`'s own docstring names it as "a later plan's command."
- Full repo suite verified green after this plan: 1307 tests / 74 files, `tsc --noEmit` clean.
- No blockers for the next plan in this phase's wave.

## Self-Check: PASSED

- FOUND: `.pi/extensions/routing/index.ts`
- FOUND: `tests/integration/mode-switch.test.ts`
- FOUND: `.planning/phases/05-routing-capability-guards/05-07-SUMMARY.md`
- FOUND commit: `e3ca4b1` (Task 1)
- FOUND commit: `79afa70` (Task 2)

---
*Phase: 05-routing-capability-guards*
*Completed: 2026-08-14*
