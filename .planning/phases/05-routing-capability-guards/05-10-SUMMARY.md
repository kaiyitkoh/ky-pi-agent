---
phase: 05-routing-capability-guards
plan: 10
subsystem: routing
tags: [routing, session-persistence, session_start, jsonl-alternative, faux-session, pi-extensions, typescript, wire-capture]

# Dependency graph
requires:
  - phase: 05-09
    provides: ".pi/extensions/routing/index.ts's applyMode/applyEscalate shape, MODE_ENTRY_TYPE/KyModeData, and the escalate.test.ts session-setup pattern this plan's mode-persistence.test.ts mirrors"
  - phase: 05-07
    provides: "the pi.appendEntry(\"ky:mode\", ...) write half of ROUTE-09 -- this plan ships the read-back half"
  - phase: 05-04
    provides: "routing/modes.ts's getModeState/setMode/setEscalated -- the state slot restoreModeFromBranch writes into"
provides:
  - ".pi/extensions/routing/index.ts -- the exported restoreModeFromBranch(branch) function and the session_start hook that wraps it"
  - "tests/integration/mode-persistence.test.ts -- ROUTE-09's binding proof: restart restore (including last-write-wins and invalid-payload fallback), Pi's native model_change entry verified present, and the zero-context-token absence proof with a positive control"
affects: [05-11, docs/ROUTING.md, Phase 11 statusline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "restoreModeFromBranch(branch) is a plain function of the branch entry array, never of ctx -- exported specifically so the test can call it directly against a real branch instead of waiting for session_start, which is measured not to fire in a headless createAgentSession (tests/integration/call-model.test.ts's own header)"
    - "the session_start hook is a thin try/catch wrapper around restoreModeFromBranch, mirroring safety/index.ts's own best-effort session_start pruning hook (safety/index.ts:832-838) -- a restore failure can never stop a session from starting (T-05-39)"
    - "restoreModeFromBranch never calls setModel or reaches for the executor model at all -- Pi's own model_change entry (written by every successful pi.setModel call, agent-session.js:1204) already survives a restart via getSessionContextSettings (session-manager.js:146-161), and this function's own doc comment cites both lines so a future edit does not reintroduce a second source of truth (T-05-38)"
    - "mode-persistence.test.ts's zero-context-token proof plants MODE_ENTRY_TYPE (the literal string \"ky:mode\") as the distinctive marker -- the customType every persisted mode entry legitimately carries -- and pairs the absence assertion with a positive control: the identical string sent as ordinary user-message content must be found by the SAME captured-payload instrument, or the absence claim is vacuous"
    - "the deepseek faux provider is wrapped with wrapFauxWithPayload directly at its own registration site (not through createFauxSession's buildPayload option, which only wraps the session's default starting provider) -- the payload-capturing instrument has to live on the provider the executor actually switches TO"

key-files:
  created:
    - tests/integration/mode-persistence.test.ts
  modified:
    - .pi/extensions/routing/index.ts

key-decisions:
  - "restoreModeFromBranch validates BOTH the persisted mode (falls back to DEFAULT_MODE if not a member of MODES) and escalatedFrom (dropped, not propagated, if invalid) -- T-05-36's tampering mitigation covers the whole payload shape, not only the field the plan's acceptance criteria names explicitly"
  - "the restart is simulated by perturbing the module-level state slot to a value distinct from what the branch holds, then calling restoreModeFromBranch and asserting the state changed back -- an un-perturbed call would pass even if the function were a no-op, which falsification (case 1/2/3 all mutated to a no-op restoreModeFromBranch) confirmed by turning all three red"
  - "case 2's last-write-wins proof drives two REAL mode switches (balanced, then max) through the live commands rather than hand-constructing two custom entries -- the branch shape this produces is byte-identical to what a real session leaves behind, and the two switches are asserted to have actually produced different mode values before the restore claim is tested"

patterns-established:
  - "an absence-on-the-wire proof for a session-persistence artifact is only evidence when paired with a positive control using the identical marker string sent through ordinary message content -- proven necessary by falsification: removing the control's own marker (substituting a markerless prompt) turned the control assertion red, confirming an instrument that captured nothing distinctive would otherwise pass the absence claim vacuously"
  - "session_start-dependent restore logic is split into a pure, exported, branch-shaped function plus a thin event-handler wrapper specifically so the untestable half (Pi's own event dispatch, measured not to fire headless) is isolated from the testable half (the restore logic itself, which takes plain data)"

requirements-completed: [ROUTE-09]

# Metrics
duration: ~25min
completed: 2026-08-14
---

# Phase 5 Plan 10: Mode Persistence Restore Summary

**`restoreModeFromBranch(branch)` restores the mode name and `/escalate` bookkeeping from a session's branch on `session_start`, wrapped in the same best-effort try/catch shape `safety/index.ts` already established, and `tests/integration/mode-persistence.test.ts` proves both halves of ROUTE-09: the state comes back after a simulated restart (including last-write-wins and a corrupt-payload fallback to `DEFAULT_MODE`), and the persisted payload is proven — with a positive control — to never reach a provider request.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-14T18:35:00Z
- **Completed:** 2026-08-14T18:43:00Z
- **Tasks:** 2 completed
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments

- `.pi/extensions/routing/index.ts` now exports `restoreModeFromBranch(branch: readonly SessionEntry[])`: filters `getBranch()`'s output for `type === "custom" && customType === MODE_ENTRY_TYPE`, takes the last matching entry (last write wins), validates `data.mode` against `MODES` (falling back to `DEFAULT_MODE` rather than propagating an unresolvable value — T-05-36), validates `data.escalatedFrom` the same way, and restores only the mode name and escalation bookkeeping via `setMode`/`setEscalated`. It never calls `pi.setModel` or reaches for the executor model at all — the function's own doc comment cites `agent-session.js:1204` (every successful `setModel` writes a native `model_change` entry) and `session-manager.js:146-161` (`getSessionContextSettings` already derives the effective model from that entry on resume) as the reason a second source of truth here would be exactly the Spoofing threat T-05-38 names.
- The `session_start` handler registered in the extension's default export is a thin wrapper: `try { restoreModeFromBranch(ctx.sessionManager.getBranch()); } catch { /* swallowed */ }`, mirroring `safety/index.ts:832-838`'s own best-effort pruning hook shape verbatim — a restore failure can never stop a session from starting (T-05-39).
- The module docstring gained a new "RESTORE ON `session_start`" section stating, in the same place the model-restoration citations live, that `session_start` does not fire in a headless `createAgentSession` (measured by `tests/integration/call-model.test.ts`'s own five-event probe) and that this plan's test therefore exercises `restoreModeFromBranch` directly against a real branch rather than waiting for an event this repository's test harness cannot trigger.
- `tests/integration/mode-persistence.test.ts` (4 cases): case 1 drives a real `max` switch, asserts both the `ky:mode` entry (`mode: "max"`) and Pi's own native `model_change` entry (`provider: "deepseek"`, `modelId: "deepseek-v4-pro"`) exist on the branch — verifying Pi's persistence rather than re-building it — then perturbs the module state slot and calls `restoreModeFromBranch` to prove the restart simulation actually restores `"max"`. Case 2 drives two real switches (`balanced` then `max`) and proves restore resolves to the LAST entry, not the first. Case 3 fabricates a branch with an out-of-range `mode` value and proves `restoreModeFromBranch` neither throws nor propagates it, falling back to `DEFAULT_MODE`. Case 4 is the zero-context-tokens proof: after a `balanced` switch and a real `session.prompt()` turn against the now-switched `deepseek` executor (captured via `wrapFauxWithPayload` registered directly on the `deepseek` faux provider, since `createFauxSession`'s own `buildPayload` option only wraps the session's default starting provider), it asserts `MODE_ENTRY_TYPE` ("ky:mode") appears in no captured payload, then sends the identical marker string as ordinary user-message content and asserts it IS found — proving the capture instrument is live rather than silently broken.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the `session_start` restore hook to routing/index.ts** — `e68f8e2` (feat)
2. **Task 2: `tests/integration/mode-persistence.test.ts`** — `e83b0dd` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `.pi/extensions/routing/index.ts` — `restoreModeFromBranch` (exported) + the `session_start` hook that wraps it, plus a new module-docstring section
- `tests/integration/mode-persistence.test.ts` — session-driven proof, 4 cases

## Verification Evidence

- `npx vitest run tests/unit/extension-layout.test.ts tests/unit/chokepoint-lint.test.ts tests/integration/mode-switch.test.ts tests/integration/escalate.test.ts` — 4 files / 27 tests, all green
- `npx vitest run tests/integration/mode-persistence.test.ts` — 1 file / 4 tests, all green
- `npx vitest run tests/integration/mode-persistence.test.ts tests/integration/mode-switch.test.ts tests/integration/escalate.test.ts` — 3 files / 15 tests, all green
- `npm run typecheck` (`tsc --noEmit`) — clean, run repeatedly across both tasks and after every falsification restore
- `npx vitest run` (full suite) — **77 test files, 1325 tests, all passed** (~32s)
- **Falsification executed** (BE SUSPICIOUS OF GREEN, standing policy):
  1. Removed the `isModeName` validation in `restoreModeFromBranch` (`data.mode as ModeName` instead of the validated fallback) — re-ran the test file: case 3 went red (`expected 'not-a-real-mode' to be 'cheap'`). Reverted via `git checkout --`; re-ran green.
  2. Made `restoreModeFromBranch` an unconditional no-op (`return;` as the first statement) — re-ran the test file: cases 1, 2 AND 3 all went red (each expected `"max"`/`DEFAULT_MODE` and got the perturbed `"cheap"`/`"balanced"` instead), proving the restart-simulation assertions are not vacuous. Reverted via `git checkout --`; re-ran green.
  3. Removed the marker from case 4's positive-control prompt (substituted a markerless string) — re-ran the test file: the control assertion itself went red (`the positive control failed: a marker sent explicitly in a user message did not appear in any captured payload`), proving the control is load-bearing rather than a tautological pass. Reverted the test file's own line via `Edit`; re-ran green.
  - `git diff --stat` after each restore was empty (the `.ts` source mutations); the test-file mutation was made outside the Edit tool (a `node -e` script) and reverted with a matching `Edit` call since the file was untracked at that point and `git checkout --` had nothing to restore from. `npm run typecheck` and the full suite were re-verified green after all three reverts.

## Decisions Made

See `key-decisions` in the frontmatter for the full list. Summarized:

- `restoreModeFromBranch` validates both `mode` and `escalatedFrom` against `MODES`, not only `mode` — the acceptance criteria named only `mode`, but the same tampering threat (T-05-36) applies to both fields of the same untrusted payload.
- The restart simulation deliberately perturbs the module state slot before calling `restoreModeFromBranch`, so the restore assertion is observable rather than a coincidental pass — confirmed necessary by falsification #2 above.
- Case 2's last-write-wins proof drives two real commands rather than hand-constructing a two-entry branch, producing byte-identical shape to a genuine session.

## Deviations from Plan

None — plan executed exactly as written. `restoreModeFromBranch`'s validation of `escalatedFrom` in addition to `mode` was within the plan's own stated scope ("validate the payload's shape before trusting it") and is documented above as a deliberate widening within that scope, not a deviation from it.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. Every auth grant in this plan's test is `ModelRuntime#setRuntimeApiKey` against a faux provider, never a real key.

## Next Phase Readiness

- ROUTE-09 is now complete in both halves: the `pi.appendEntry("ky:mode", ...)` write (05-07) and the `session_start` restore (this plan), plus the zero-context-token proof this plan's own acceptance criteria required.
- The one thing this plan's test explicitly does NOT prove — that Pi's own `session_start` event dispatch actually invokes the registered hook in a real interactive session — remains stated plainly in both the test file's header and the module docstring, rather than implied as covered. No later plan in this phase depends on closing that gap; it is Pi's own documented contract (`docs/extensions.md`, the `dist/**/*.js.map` sourcesContent citations already in this file), not this repository's code.
- Full repo suite verified green after this plan: 1325 tests / 77 files, `tsc --noEmit` clean.
- No blockers for the next plan in this phase's wave.

## Self-Check: PASSED

- FOUND: `.pi/extensions/routing/index.ts`
- FOUND: `tests/integration/mode-persistence.test.ts`
- FOUND: `.planning/phases/05-routing-capability-guards/05-10-SUMMARY.md`
- FOUND commit: `e68f8e2` (Task 1)
- FOUND commit: `e83b0dd` (Task 2)

---
*Phase: 05-routing-capability-guards*
*Completed: 2026-08-14*
